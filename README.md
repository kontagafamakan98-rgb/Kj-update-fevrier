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
| Déploiement | Fly.io (backend, ~0 $/mois) + Vercel (frontend) |

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

### Backend — Fly.io (production actuelle, ~0 $/mois)

- **App** : `kojo-backend` — `https://kojo-backend.fly.dev`
- **Config** : `backend/fly.toml` (machine `shared-cpu-1x`, **256 Mo** — dans
  l'allocation gratuite de 3 VMs 256 Mo ; le backend tient en ~21 Mo RSS).
- **Déploiement** : poussé par la CI (`.github/workflows/ci.yml`, job
  `deploy-fly`) via `flyctl deploy --remote-only` — **uniquement quand le
  job `backend-tests` passe et que le push touche `backend/**`**.
- **Secret** : `FLY_API_TOKEN` (jeton deploy, généré par
  `flyctl tokens create deploy -n "GitHub Actions"`) dans les secrets GitHub.
- Guide pas à pas complet : `backend/DEPLOY_FLYIO.md`.

| Variable | Obligatoire ? | Notes |
|---|---|---|
| `MONGO_URL` | ✅ | URI Atlas/auto-hébergé (le boot échoue sans elle) |
| `JWT_SECRET` | ✅ en prod | Fail-fast : le serveur refuse de démarrer sans lui |
| `EMAIL_OTP_SECRET` | ✅ en prod | Fail-fast identique à `JWT_SECRET` |
| `APP_ENV` | ✅ | `production` (désactive `/docs`, active HSTS, CORS strict) |
| `BACKEND_PUBLIC_URL` | ✅ | **`https://kojo-backend.fly.dev`** — TrustedHost + callbacks IPN PayDunya |
| `DB_NAME` | | défaut `kojo_db` |
| `VERCEL_PROJECT_NAME` | recommandé | **`kj-update-fevrier`** — restreint le CORS aux seuls domaines du projet Vercel Kojo |
| `REDIS_URL` | | Rate-limiting partagé multi-workers (optionnel, 1 worker = mémoire suffit) |
| `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY` | ✅ | Push notifications web (les deux doivent correspondre) |

**Pièges à connaître (leçons du terrain)** :

- ⚠️ **`flyctl` n'est pas dans le PATH** après l'installation winget : il est
  dans `$LOCALAPPDATA/Microsoft/WinGet/Links/flyctl.exe`.
- ⚠️ **Le health check exige que `/health` réponde 200** — un `/health` qui
  renvoie 400 fait échouer le déploiement (`timeout reached waiting for
  health checks`). Vérifier que l'endpoint renvoie bien 200 avant de déployer.
- ⚠️ **Le compte trial Fly s'arrête après 5 min** tant qu'aucune carte n'est
  ajoutée — l'ajout d'une carte (même sans facturation) est requis pour
  garder la machine allumée.
- `EMAIL_OTP_SECRET` est **indispensable en prod** — l'ancien code utilisait
  un fallback silencieux sur `JWT_SECRET` (faille corrigée). Erreur typique :
  `RuntimeError: EMAIL_OTP_SECRET environment variable is not set...`.
- **Ne jamais changer (roter) `EMAIL_OTP_SECRET`** : il signe les jetons de
  vérification email et les hashes OTP — le changer invalide tous les jetons
  déjà émis.
- Le conteneur `python:3.11-slim` n'a **ni `free`, ni `pgrep`, ni `ps`** :
  pour surveiller la mémoire via `flyctl ssh console`, lire `/proc/meminfo`
  et `/proc/<pid>/status` (le console `-C` exécute sans shell — envelopper
  dans `sh -c` pour les globs/pipes).

### Backend — Fly.io (hébergement actuel)

- Le backend est déployé sur **Fly.io** (`kojo-backend` — voir `backend/fly.toml`
  et la section « Déploiement » ci-dessus). L'ancien hébergement Render
  (`kojo-backend-03az`) a été **retiré** ; ne pas le réutiliser.
- Start command : `uvicorn server:app --host 0.0.0.0 --port $PORT` (via le
  Dockerfile — cf. `backend/Dockerfile`).
- Les secrets (JWT_SECRET, EMAIL_OTP_SECRET, clés PayDunya…) se configurent
  dans les **variables d'environnement Fly** (`flyctl secrets set`).
- Garde-fou au démarrage : tout import manquant dans un module découpé
  (`kojo_*`) crashe le boot. Vérification par l'étape pyflakes de la CI
  (« undefined name » → build rouge).

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
  `VITE_API_URL=https://kojo-backend.fly.dev/api`

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
curl -s https://kojo-backend.fly.dev/health   # {"status":"healthy","database":"connected",...}
curl -s -o /dev/null -w '%{http_code}' https://kojo-backend.fly.dev/docs   # 404
curl -s -o /dev/null -w '%{http_code}' https://kojo-backend.fly.dev/api/stats  # 403/401 sans token

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

## Branches

- **`main`** — branche de référence et de production (déploiements
  automatiques Vercel + Fly.io via la CI). Tout le développement passe par
  des branches dédiées fusionnées ici (PR). C'est la **seule** branche
  restante du dépôt.

**Historique antérieur à la réécriture du 15/08/2026** : les anciennes
branches (`master`, `backup-pre-rewrite-20260815`) ont été remplacées par
**des tags Git immuables** (plus propre qu'une branche, l'historique reste
accessible mais n'apparaît pas dans les branches) :

- `backup/pre-rewrite-20260815` → snapshot de l'état du dépôt juste avant la
  réécriture (commit `e41538c`)
- `legacy/master-pre-rewrite` → ancien historique principal (commit
  `27285f7`)

> ⚠️ Les branches distantes `fix/pack4-native` (ancien travail i18n d'avril
> 2026) et `master` ont été **supprimées** : leur contenu est intégré ou
> préservé dans les tags ci-dessus.

## Comptes de test

Des comptes de démonstration existent en production (backend Fly.io) :

| Compte | Type | Mot de passe | Usage |
|---|---|---|---|
| `makemoney0598@gmail.com` | client | voir secret | Test du parcours client (profil, photo, création de mission) |
| `cesarijulies95@gmail.com` | worker | voir secret | Test du parcours worker (compétences, postulation) |

**Politique de rotation** :

- Les mots de passe des comptes de test sont stockés dans le gestionnaire de
  secrets de l'équipe (jamais dans le dépôt, jamais dans ce README).
- Ils doivent être **rotés** (1) à chaque fuite/échange via un canal non
  sécurisé, (2) au minimum tous les 90 jours, (3) avant un passage en
  démo publique.
- Rotation : connexion admin → page profil du compte → « Modifier » →
  changer le mot de passe (le champ `password_version` invalide alors tous
  les jetons émis avant).
- Après chaque test manuel, **restaurer les données de démo** : `skills:
  []`, `bio: ""`, suppression des missions/propositions de test créées.
