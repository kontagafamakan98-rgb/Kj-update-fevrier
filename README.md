# Kojo — Plateforme de mise en relation artisans / clients

Kojo connecte clients et artisans en Afrique de l'Ouest (Sénégal, Mali, Côte d'Ivoire, Burkina Faso). Paiement sécurisé via PayDunya (Orange Money, Wave, carte bancaire).

## Stack technique

| Couche | Technologies |
|---|---|
| Frontend | React 18, Vite 7, Tailwind CSS, React Router 7, Capacitor |
| Backend | Python 3.11, FastAPI, Motor (MongoDB async) |
| Base de données | MongoDB Atlas |
| Paiements | PayDunya (Orange Money, Wave, carte) |
| Photos | Cloudinary |
| Emails | Brevo / Gmail OAuth2 (ou `EMAIL_PROVIDER=none`) |
| Notifications push | VAPID (pywebpush) |
| Déploiement | Render (backend) + Vercel (frontend) |

## Setup local

### Backend
```bash
cd backend
cp .env.example .env        # Remplir les valeurs
python -m venv .venv        # Optionnel mais recommandé
.venv/Scripts/pip install -r requirements.txt   # Windows ; .venv/bin/pip sur Unix
uvicorn server:app --reload --port 8000
```

Le backend est découpé par domaine (le monolithe `server.py` de 5 000+ lignes a
été éclaté) :

```
backend/
├── server.py              # Point d'entrée : app, middlewares, routers, lifespan
├── kojo_settings.py       # Config (env, logging, secrets, en-têtes sécurité)
├── kojo_models.py         # Modèles Pydantic + énumérations
├── kojo_core.py           # MongoDB, index, rate-limiting, sécurité, auth
├── kojo_email.py          # OTP / vérification email / Brevo / Gmail
├── kojo_shared.py         # Notifications (base + push web), adresses mission
├── kojo_payments.py       # Intégration PayDunya (factures, statuts, décaissements)
├── kojo_routers_*.py      # Endpoints HTTP par domaine (auth, users, jobs,
│                          #   messages, payments, notifications, geo, owner, support)
└── tests/                 # 69 tests pytest
```

### Frontend
```bash
cd frontend
cp .env.example .env.local  # Adapter VITE_API_URL si besoin
npm install
npm run dev
```

Prérequis frontend : Node >= 20.19 (CI : Node 24).

### Tests
```bash
# Backend — deux modes :
cd backend
.venv/Scripts/python -m pytest tests/ -v              # FakeDB locale (hermétique)
TEST_MONGO_URL=mongodb://localhost:27017 .venv/Scripts/python -m pytest tests/ -v   # vrai MongoDB

# Frontend
cd frontend && npm test
```

> Les tests backend passent par défaut sur une **fausse base en mémoire**
> (rapide, sans dépendance). En définissant `TEST_MONGO_URL`, la **même suite**
> s'exécute contre un vrai MongoDB (mode utilisé en CI via un service
> container) pour couvrir atomicité/indexes/opérateurs réels.

## Déploiement

> **Alternative Fly.io (recommandée si le free tier Render est épuisé)** :
> un Dockerfile (`backend/Dockerfile`), une config (`backend/fly.toml`) et un
> guide pas à pas (`backend/DEPLOY_FLYIO.md`) sont prêts — pas de spin-down,
> pas de limite d'heures, ~0–3 $/mois. La variable `BACKEND_PUBLIC_URL` y est
> **obligatoire** (TrustedHost + callbacks IPN PayDunya).

### Backend — Render (Web Service Python)

- **Service** : `kojo-backend-03az` — `https://kojo-backend-03az.onrender.com`
- **Start command** : `uvicorn server:app --host 0.0.0.0 --port $PORT`
- **Source** : lié à GitHub (branche `main`) — chaque push déclenche un
  déploiement automatique ; en cas d'échec au boot, **l'ancienne version reste
  servie** (vérifier le statut du déploiement, pas seulement le health check).

| Variable | Obligatoire ? | Notes |
|---|---|---|
| `MONGO_URL` | ✅ | URI Atlas/auto-hébergé (le boot échoue sans elle) |
| `JWT_SECRET` | ✅ en prod | Fail-fast : le serveur refuse de démarrer sans lui |
| `EMAIL_OTP_SECRET` | ✅ en prod | **Ajoutée par l'audit** : fail-fast identique à `JWT_SECRET` |
| `APP_ENV` | ✅ | `production` (désactive `/docs`, active HSTS, CORS strict) |
| `DB_NAME` | | défaut `kojo_db` |
| `RENDER_EXTERNAL_HOSTNAME` | 🔄 auto | Injecté par Render ; ajouté aux hôtes de confiance au boot |
| `VERCEL_PROJECT_NAME` | recommandé | **`kj-update-fevrier`** — restreint le CORS aux seuls domaines du projet Vercel Kojo (`kj-update-fevrier*.vercel.app`) au lieu de tout `*.vercel.app` (surface d'attaque évitable) |

**Pièges à connaître (leçons du terrain)** :

- `EMAIL_OTP_SECRET` est **indispensable en prod depuis l'audit** — l'ancien
  code utilisait un fallback silencieux sur `JWT_SECRET` (faille corrigée).
  Erreur typique au déploiement : `RuntimeError: EMAIL_OTP_SECRET
  environment variable is not set. Refusing to start in production...`.
  Générer : `python -c "import secrets; print(secrets.token_hex(32))"`.
- **Ne jamais changer (roter) `EMAIL_OTP_SECRET`** : il signe les jetons de
  vérification email et les hashes OTP — le changer invalide tous les jetons
  déjà émis. Le conserver avec les autres secrets du gestionnaire de mots de
  passe.
- `RENDER_EXTERNAL_HOSTNAME` étant injecté automatiquement, `build_trusted_hosts`
  s'exécute avec une URL non vide au boot : tout import manquant dans un
  module découpé (`kojo_*`) crashe le démarrage. Garde-fou : l'étape pyflakes
  de la CI (« undefined name » → build rouge).

### Frontend — Vercel

- **Projet** : `kj-update-fevrier` — **prod : `https://kj-update-fevrier.vercel.app`**
- **Root Directory = `frontend`** — réglage **du dashboard** (Settings →
  General → Root Directory). ⚠️ **Ce n'est PAS une clé valide de `vercel.json`**
  : l'ajouter au fichier casse le déploiement avec l'erreur de schéma
  *« should NOT have additional property `rootDirectory` »*.
- **`vercel.json` = `frontend/vercel.json`** : Vercel le lit **depuis le Root
  Directory** (`frontend/`), pas depuis la racine du repo. Le fichier à la
  racine du repo n'est qu'un filet de sécurité si le Root Directory est vidé.

```json
// frontend/vercel.json (lu par Vercel avec Root Directory = frontend)
{
  "framework": "vite",
  "outputDirectory": "build",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

- **Variables d'env** (dashboard, onglet Settings → Environment Variables) :
  `VITE_API_URL=https://kojo-backend-03az.onrender.com/api`

**Pièges à connaître (leçons du terrain)** :

- ⚠️ **Ne pas mettre `--prefix frontend`** dans `installCommand`/
  `buildCommand` **dans `frontend/vercel.json`** : les commandes s'exécutent
  déjà dans le Root Directory `frontend` → le préfixe crée le chemin doublé
  `frontend/frontend` et l'échec `ENOENT .../frontend/frontend/package.json`.
  (Le `--prefix frontend` n'est valable que dans le `vercel.json` à la racine
  du repo, utilisé uniquement si le Root Directory est vide.)
- ⚠️ **Le script `vercel-build` n'existe pas** — ne pas l'utiliser en
  `buildCommand` (utiliser `npm run build`, alias de `vite build`).
- ⚠️ `rootDirectory` n'est pas accepté par le schéma `vercel.json` (voir
  ci-dessus).
- ⚠️ **Le catch-all `rewrites` est indispensable** : sans lui, tout
  chargement direct d'une route SPA (`/payment`, `/register`, … retour du
  back bouton depuis PayDunya) renvoie un 404 `x-vercel-error: NOT_FOUND`.
  C'est le bug rencontré : le fichier de la racine n'était pas lu, donc le
  rewrite n'était jamais dans les métadonnées de routage.

### Vérification post-déploiement

```bash
# Backend — le nouveau code est en prod si :
curl -s https://kojo-backend-03az.onrender.com/api/health   # PAS de champ "environment"
curl -s -o /dev/null -w '%{http_code}' https://kojo-backend-03az.onrender.com/docs   # 404
curl -s -o /dev/null -w '%{http_code}' https://kojo-backend-03az.onrender.com/api/stats  # 403/401 sans token

# Frontend
curl -s -o /dev/null -w '%{http_code}' https://kj-update-fevrier.vercel.app   # 200
```

## Sécurité

- **Inscription** : seule la route `/api/auth/register-verified` existe ;
  elle exige un jeton de vérification email (flux OTP
  `/auth/email/send-otp` → `verify-otp`). L'ancien `/auth/register` sans
  vérification a été supprimé.
- IPN PayDunya : le statut du webhook est systématiquement reconfirmé auprès
  de PayDunya (jamais de confiance au payload).
- Rate-limiting par bucket (Redis partagé si `REDIS_URL` défini) ; les
  GET/HEAD/OPTIONS généraux ne comptent pas dans le bucket général
  (atténuation CGNAT Afrique de l'Ouest).
- `/api/stats`, `/api/users/{user_id}/profile-photo` et `/api/health` :
  requièrent une authentification / ne divulguent plus l'environnement.

## CI

`.github/workflows/ci.yml` (3 jobs) :
- **backend-tests** : tests contre un vrai MongoDB (service container),
  syntaxe Python (`py_compile`), **pyflakes (aucun nom non défini dans les
  modules `kojo_*` — garde-fou contre les imports manquants du découpage)**
- **frontend-build** : tests Vitest + build Vite sur Node 24
- **mobile-build** : `cap sync android` + build APK debug (Gradle 8.14 /
  AGP 8.13, **Java 21** — requis par Capacitor 8, SDK Android) — valide la
  config Capacitor à chaque push
