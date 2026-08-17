# AGENTS.md

Apprentissages non-obvies de session (pas récupérables en lisant le code seul).

## Déploiement & hébergement

- Backend migré de Render (payant) vers Fly.io : `backend/Dockerfile` + `backend/fly.toml`, guide complet dans `backend/DEPLOY_FLYIO.md`. Le frontend reste sur Vercel ; sa variable `VITE_API_URL` doit être basculée vers la nouvelle URL du backend.
- Quirk Fly.io : les health checks envoient un Host (souvent une IP interne) que le TrustedHostMiddleware rejette → 400 en boucle → déploiement échoué. Le motif `TRUSTED_HOSTS=*.internal` ne suffit PAS ; correctif fiable : secret `DISABLE_TRUSTED_HOST_MIDDLEWARE=true`.
- `fly launch` régénère `fly.toml` et écrase les entrées `[env]` ajoutées à la main — revérifier `BACKEND_PUBLIC_URL`/`TRUSTED_HOSTS` après chaque `fly launch`.
- Machines Fly en trial : arrêtées après 5 min tant qu'aucune carte bancaire n'est ajoutée au compte.
- Utilisateurs en Afrique de l'Ouest → héberger en Europe (Francfort, ~100 ms depuis Dakar), pas au Canada. La liste d'IP autorisées MongoDB Atlas doit inclure l'IP de sortie de chaque hébergeur (celle de Render était whitelistée, pas celle de Fly).

## Environnement & configuration

- `BACKEND_PUBLIC_URL` est OBLIGATOIRE hors Render : elle alimente à la fois la liste d'hôtes de confiance (TrustedHost) ET les URLs de callback IPN PayDunya (`build_payment_callback_url`/`build_disburse_callback_url`).
- `APP_ENV` défaut = `production` (kojo_settings.py) : `/docs` désactivé et `JWT_SECRET` + `EMAIL_OTP_SECRET` requis en fail-fast, sauf si mis à `development`.
- TrustedHostMiddleware activé par défaut ; le `.env` local de `backend/` pose `DISABLE_TRUSTED_HOST_MIDDLEWARE=true`, donc le local ne teste jamais les contrôles de Host actifs en prod.
- La construction d'URL backend du frontend est CENTRALISÉE dans `frontend/src/utils/backendUrl.js` (`buildApiUrl`/`buildBackendUrl`) : `api.js` et `jobProposalWorkflow.js` l'importent — ne jamais réimplémenter la dérivation de base ailleurs (bug historique `/api/api`). Ordre de priorité des sources : `window.__KOJO_API_URL__`/`__API_URL__` → `VITE_API_URL`/`VITE_API_BASE_URL`/`VITE_BACKEND_URL` → `REACT_APP_BACKEND_URL`/`REACT_APP_API_URL` → localhost:8000 (dev) → `https://kojo-backend.fly.dev`. `photo_url` est toujours une URL Cloudinary absolue (les branches relatives de ces helpers ne servent qu'aux données legacy).
- Géolocalisation : `frontend/src/services/geolocationService.js` est le SEUL module (fusion de `preciseGeolocationService.js`, supprimé). L'ancien `geolocationService.js` avait une classe `GeolocationService` et des bases de villes inline ENTIÈREMENT mortes (aucun consommateur n'importait son default ; les champs `color`/`majorCities`/`timeZone`/`internetPenetration` de son `COUNTRIES` n'étaient lus nulle part). Ne pas recréer de bases de villes côté frontend : la source de vérité est la base backend servie par `/api/geolocation/cities` (cache localStorage 7 j).

## Outillage local & vérification

- Binaire mongod Windows portable dans `.mongo-tmp/mongodb-win32-x86_64-windows-7.0.14` : le démarrer (ex. port 27018) puis lancer `backend/.venv` uvicorn avec `MONGO_URL` permet de tester le boot et `/health` en local avec une vraie base.
