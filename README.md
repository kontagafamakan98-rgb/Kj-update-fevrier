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
// frontend/vercel.json (lu par Vercel avec Root Directory = frontend) — extrait
{
  "framework": "vite",
  "outputDirectory": "build",
  "rewrites": [
    { "source": "/jobs", "destination": "/jobs.html" },
    { "source": "/jobs/", "destination": "/jobs.html" },
    { "source": "/jobs/(.*)", "destination": "https://kojo-backend.fly.dev/api/og/jobs/$1" },
    { "source": "/api/:path*", "destination": "https://kojo-backend.fly.dev/api/:path*" },
    { "source": "/dashboard", "destination": "/app.html" }
  ]
}
```

**Contrat de routage (il est vérifié par `check-spa-routes.js` à chaque push) :**

- **chaque route de `src/App.js` est déclarée nommément**, dans ses deux formes
  (`/route` et `/route/`) ; une route oubliée répondrait **404** en production ;
- **aucun catch-all `/(.*)` → `/index.html`** : il faisait répondre **200** à
  toute URL inconnue (« soft 404 » : des centaines d'URL vides indexables).
  Une URL inconnue tombe désormais sur `build/404.html` (statut **404**, noindex) ;
- **l'ordre compte** : `/jobs` et `/jobs/` doivent précéder `/jobs/(.*)`, sinon
  le motif les capture — c'était le cas jusqu'au 16/09/2026 et `/jobs/`
  répondait alors **404 en JSON** (la page publique la plus visitée du site,
  cassée pour tout lien avec slash final) ;
- **`/jobs/:id` n'est pas une page du build** : elle est pré-rendue par le
  backend (`GET /api/og/jobs/{id}`, méta OG de la mission + 404 noindex), et le
  cycle complet la concernant est exercé sur les PR par
  `backend/tests/test_job_og_cycle.py`.
- **deux gabarits, jamais confondus** : une page pré-rendue (`/jobs`, `/login`,
  `/register`, `/forgot-password`, `/payment`) est servie par **son** `.html` ;
  toute autre route cliente (`/dashboard`, `/profile`, `/support`,
  `/how-it-works`…) est servie par **`app.html`**, un gabarit nu (`#root` vide,
  pas de `<h1>`, pas de canonical, pas de JSON-LD). Servir `index.html` à ces
  routes publierait le contenu de l'accueil — h1, texte, liens — sous une
  dizaine d'adresses, avec un canonical statique « / » sur toutes : c'est du
  contenu dupliqué, et `check-spa-routes.js` échoue désormais dans ce cas ;
- **les routes privées ne sont pas indexables** : `/dashboard`, `/profile`,
  `/messages`, `/create-job`, `/photo-debug`, `/email-verification`,
  `/payment-verification`, `/commission-dashboard` et `/support-admin` portent
  `X-Robots-Tag: noindex` (vérifié : l'en-tête est absent → CI rouge). Un
  tableau de bord dans les résultats de recherche est une page vide.

- **Variables d'env** (dashboard, onglet Settings → Environment Variables) :
  `VITE_API_URL=https://kojo-backend.fly.dev/api`

**Variables optionnelles (SEO / analytics — aucune n'a de valeur par défaut,
rien n'est activé si elles sont absentes) :**

| Variable | Effet |
|---|---|
| `VITE_GA_MEASUREMENT_ID` (`G-XXXXXXX`) | Balise Google Analytics 4 injectée dans le HTML **statique** (donc visible des outils d'audit) + `gtag('config')` depuis `src/utils/analytics.js` (pas de script inline : la CSP est `script-src 'self'`) et événement `page_view` à chaque navigation SPA. Ajoute aussi les domaines GA à la CSP (`googletagmanager.com`, `google-analytics.com`). |
| `VITE_PLAUSIBLE_DOMAIN` | Analytics Plausible (script externe chargé par le bundle). |
| `VITE_GSC_VERIFICATION` | Jeton `google-site-verification` (Search Console) ajouté au HTML statique. |
| `VITE_SOCIAL_FACEBOOK`, `VITE_SOCIAL_INSTAGRAM`, `VITE_SOCIAL_TIKTOK`, `VITE_SOCIAL_LINKEDIN`, `VITE_SOCIAL_YOUTUBE`, `VITE_SOCIAL_X` | URL complète (`https://…`) du profil : affiché dans le footer **et** dans le `sameAs` du `LocalBusiness`. Un réseau sans valeur n'apparaît nulle part (aucun profil n'est inventé). |

Le contact publié (téléphone, e-mail, adresse) vit dans
**`frontend/src/config/contact.json`** : la page Support, le footer React, le
shell statique de l'accueil et le `LocalBusiness` le lisent tous — une seule
adresse, sinon `check-home-shell.js` échoue.

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
- ⚠️ **Les rewrites doivent être dans `frontend/vercel.json`** (celui du Root
  Directory) : le fichier à la racine du repo n'est pas lu, et un chargement
  direct d'une route SPA (`/payment`, `/register`, retour du bouton depuis
  PayDunya) renvoyait alors un 404 `x-vercel-error: NOT_FOUND`. C'est le bug
  d'origine — sa correction n'exigeait pas un catch-all, mais la déclaration
  explicite de chaque route (voir le contrat de routage ci-dessus).
- ⚠️ **Un catch-all `/(.*)` masque les règles suivantes ET rend 200 sur des URL
  inconnues** : ne pas le réintroduire pour « faire marcher » une route — la
  déclarer. `check-spa-routes.js` échoue si un catch-all réapparaît.

### Vérification post-déploiement

```bash
# Backend — le nouveau code est en prod si :
curl -s https://kojo-backend.fly.dev/health   # {"status":"healthy","database":"connected",...}
curl -s -o /dev/null -w '%{http_code}' https://kojo-backend.fly.dev/docs   # 404
curl -s -o /dev/null -w '%{http_code}' https://kojo-backend.fly.dev/api/stats  # 403/401 sans token

# Frontend
curl -s -o /dev/null -w '%{http_code}' https://kj-update-fevrier.vercel.app   # 200
curl -s -o /dev/null -w '%{http_code}' https://kj-update-fevrier.vercel.app/jobs   # 200 (jobs.html)
curl -s -o /dev/null -w '%{http_code}' https://kj-update-fevrier.vercel.app/jobs/  # 200 (jobs.html)
curl -s -o /dev/null -w '%{http_code}' https://kj-update-fevrier.vercel.app/inexistant-xyz  # 404 (404.html, noindex)
# Accueil : un crawler sans JavaScript doit voir un h1, du contenu et des liens
curl -s https://kj-update-fevrier.vercel.app/ | grep -c '<h1'                # 1
curl -s https://kj-update-fevrier.vercel.app/ | grep -c 'href="tel:'        # 2
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

`.github/workflows/ci.yml` (9 jobs, dont 8 requis sur `main`) :

- **audit-regression-test** — méta-test : injecte une régression et exige que
  chaque garde (docstrings, endpoints fantômes, `py_compile`, pyflakes) échoue.
  Sans lui, un garde devenu aveugle resterait vert.
- **workflow-lint** — `actionlint` sur les workflows + `shellcheck` sur les
  scripts shell.
- **fly-env-drift** — formats des références du dépôt (déterministe, sans
  réseau), puis `fly.toml` ↔ runtime Fly : secrets obligatoires, doublons,
  orphelins.
- **backend-tests** — `pytest` contre un vrai MongoDB (service container),
  syntaxe Python (`py_compile`), **pyflakes (aucun nom non défini dans les
  modules `kojo_*` — garde-fou contre les imports manquants du découpage)**
- **frontend-build** — tests Vitest + build Vite sur Node 24, puis 7 gardes sur
  les artefacts (shells de pré-rendu, splits i18n et `services/api`, cartes OG,
  famille d'icônes, manifeste PWA, budgets de bundle)
- **bundle-size-report** — publie en commentaire de PR les trois tailles
  mesurées (JS initial, plus gros chunk, build total) avec l'écart vs la
  dernière mesure de `main` et vs la mesure précédente de la PR. **Consultatif**
  (hors checks requis) : il informe, le garde qui bloque est `check-bundle-size`
- **lighthouse-ci** — budgets de performance sur l'accueil et les pages
  protégées, authentifiées via le compte CI dédié (droits sur l'URL Vercel)
- **mobile-build** — `cap sync android` + build APK debug (Gradle 8.14 /
  AGP 8.13, **Java 21** — requis par Capacitor 8, SDK Android) — valide la
  config Capacitor à chaque push
- **deploy-fly** — `flyctl deploy` sur `main` uniquement, et seulement si
  `backend/**` change

> Ce que chaque job **prouve** réellement — et les cas où il peut réussir sans
> rien vérifier (repli Lighthouse sur le build local, verrou `/jobs/:id`
> désactivé, `deploy-fly` sauté faute de changement backend, budgets très
> permissifs…) — est recensé dans [`CI-COVERAGE.md`](CI-COVERAGE.md), à relire
> avant de conclure qu'un ✓ suffit.

## Branches

- **`main`** — branche de référence et de production (déploiements
  automatiques Vercel + Fly.io via la CI). Tout le développement passe par
  des branches dédiées fusionnées ici (PR). C'est la **seule** branche
  permanente du dépôt : les branches de travail sont temporaires et
  disparaissent avec la PR (voir ci-dessous).

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

### Branches de travail : suppression automatique après fusion

Le dépôt est réglé avec **« Automatically delete head branches »**
(`delete_branch_on_merge = true`, activé le 16/09/2026) : une PR fusionnée
**via GitHub** (interface ou API) supprime elle-même sa branche d'origine. Le
nettoyage n'est donc plus une tâche manuelle qu'on peut oublier.

Ce réglage ne couvre **que** les fusions faites côté GitHub. Une fusion
faite en local puis poussée (`git merge` + `git push`) ne déclenche rien : la
branche reste sur `origin` et doit être retirée à la main — c'est exactement
ce qui est arrivé à `chore/ci-guards-assets-perf` et
`chore/exec-bits-guard`, fusionnées puis supprimées manuellement. Pour un
nettoyage immédiat :

```bash
# après une fusion locale, la branche est un ancêtre de main :
git branch -d <branche>                      # refusé si non fusionnée
git push origin --delete <branche>
git fetch --prune                            # purge les références locales
```

Vérifier l'état réel des branches distantes (et non la mémoire de `git`) :

```bash
git ls-remote --heads origin                  # source de vérité
git branch -r                                 # après un fetch --prune
```

Ce réglage est un paramètre du **dépôt**, pas du code : il n'est pas
versionné et ne peut pas être vérifié par la CI (il faudrait un jeton
administrateur). Pour le modifier : `Settings → General → Pull Requests`, ou
`PATCH /repos/{owner}/{repo}` avec `{"delete_branch_on_merge": true}`.

### Protection de `main` (branche protégée)

`main` est protégée par une règle GitHub : **aucun commit ne peut y entrer
autrement que par une PR dont les 8 checks CI sont verts**. Concrètement :

- **PR obligatoire** — les pushs directs sur `main` sont refusés par le serveur
  (`GH006: Protected branch update failed … Changes must be made through a pull
  request`), même pour l'administrateur du dépôt (protection appliquée aussi
  aux admins : impossible de la contourner « par erreur »).
- **8 checks requis** — le workflow en compte **9** : `Bundle size report (PR
  comment)` en est volontairement **exclu** (il publie des mesures, il ne juge
  rien) : `Audits détectent
  les régressions`, `Backend tests (Python + MongoDB)`, `Fly env doc-prod (drift
  + secrets)`, `Frontend tests + build (Node/Vite)`, `Lighthouse performance
  budgets`, `Mobile build (Capacitor + Android)`, `Workflow lint (actionlint +
  shellcheck)`, `Deploy backend to Fly.io`.
- **Branche à jour exigée** (`strict`) : une PR verte mais calculée sur une base
  périmée doit être mise à jour avant fusion — un vert obtenu sur un `main`
  ancien ne suffit pas.
- Pas d'approbation humaine exigée (contributeur unique, une auto-approbation
  GitHub est impossible) : le garde-fou est **entièrement automatisé**.
- Force-push et suppression de `main` désactivés.

> **Pourquoi `Deploy backend to Fly.io` figure aussi dans la liste** : ce job ne
> s'exécute que sur `main` ; sur une PR il est *skipped*, et GitHub considère
> `success`, `skipped` et `neutral` comme des statuts réussis pour un check
> requis. L'inclure ne bloque donc jamais une PR, mais garantit qu'un échec de
> déploiement est bien visible dans l'historique des checks.

Aucun filtre de chemins n'existe au niveau du workflow : **toute** PR vers
`main` déclenche ces 9 jobs, donc un check requis n'est jamais « en attente »
indéfiniment (cas typique de blocage avec une protection de branche).

Pour modifier temporairement la règle (par ex. débloquer une urgence), passer
par `Settings → Branches → main`, ou l'API
`PUT /repos/{owner}/{repo}/branches/main/protection`. Une modification
permanente de la règle se fait dans la même page et doit être reportée ici.

## Comptes de test

Des comptes de démonstration existent en production (backend Fly.io) :

| Compte | Type | Mot de passe | Usage |
|---|---|---|---|
| `makemoney0598@gmail.com` | client | voir secret | Test du parcours client (profil, photo, création de mission) |
| `cesarijulies95@gmail.com` | worker | voir secret | Test du parcours worker (compétences, postulation) |
| Compte client **dédié CI** (email du secret `LHCI_CI_EMAIL`) | client | voir secret `LHCI_CI_PASSWORD` | **Uniquement** pour le job Lighthouse CI (`lighthouse-ci`), qui audite `/dashboard`, `/jobs`, `/profile`. **Ne jamais l'utiliser à la main** : son isolation garantit des budgets Lighthouse déterministes. |

> **Isolation CI** : le compte Lighthouse CI est **distinct** des deux comptes
d'exécution manuelle ci-dessus. Les tests e2e manuels modifient le profil, la
photo et les missions des comptes partagés ; si la CI réutilisait l'un d'eux,
les pages auditées changeraient d'un run à l'autre et les budgets seraient
faussés. Le compte CI est provisionné via
`backend/scripts/provision_ci_test_account.py` (profil volontairement vide :
`skills: []`, `bio: null`) et n'est touché que par le workflow.

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
