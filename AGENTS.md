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
- Longueur min de mot de passe = 8, à garder en synchro sur 5 endroits : `kojo_models.py` (`UserRegister`, `UserWithPayment`, `PasswordResetConfirmRequest`), frontend `utils/validation.js`, `pages/Register.js`, `pages/ForgotPassword.js`, et la clé i18n `passwordTooShort` (5 fichiers de langue).
- `PUT /users/profile` `profile_photo` n'accepte que des URLs `https://res.cloudinary.com/` (anti-pisteur) ; une chaîne vide est un no-op (avant : 400 latent car `''` ne commençait pas par http/https).

## Architecture & pièges métier

- Collection `db.proposals` est MORTE : la vraie collection est `job_proposals`. Les index de boot (`create_database_indexes`) visaient `proposals` (jamais utilisée) — les index de propositions doivent cibler `job_proposals`.
- Verrou anti double-retrait parrainage (`referral_withdrawal_in_progress`) : seul `kojo_shared.apply_referral_payout_confirmed` le libère (point unique de vérité solde + verrou). Une copie dupliquée dans `kojo_routers_payments` ne le libérait pas (bug bloquant) — ne jamais réintroduire de 2e copie ; le chemin succès de `withdraw_referral_rewards` doit appeler la version de `kojo_shared`.
- `get_current_user` reconstruit `User(**doc)` : un doc legacy invalide (ex. téléphone sans `+`) levait une ValidationError → 500 sur TOUS les endpoints authentifiés. Désormais 401 « contactez le support » — corriger la donnée en base, pas le code.
- `serialize_payment_record` retire les payloads fournisseurs bruts (`provider_confirm_payload`, `disburse_token`, `disburse_provider_response`, `disburse_verified_payload`, `disburse_callback_payload`, `disburse_error`, `provider_response_text`) des réponses API — ne pas les réexposer ; `disburse_token` reste stocké en base et sert à l'IPN disburse.
- La vue PUBLIQUE des jobs (découverte anonyme, `GET /jobs` et `GET /jobs/{id}`) passe par l'ALLOWLIST stricte `JobPublic` (kojo_models.py), jamais par un denylist ni par le document brut : tout champ ajouté au doc Mongo reste privé par défaut (extra='ignore' Pydantic v2), y compris `geo` et `location.latitude/longitude/coordinates` (coordonnées GPS jamais exposées publiquement). La vue CONNECTÉE, elle, renvoie toujours le doc brut sans `_id` — le frontend lit `created_at` en fallback d'affichage (`job.posted_at || job.created_at`) et la liste publique écarte (avec warning) une fiche legacy qui ne valide pas `JobPublic` ; corriger la donnée en base, pas le code.
- `kojo_shared.py` importe `pywebpush` au niveau module malgré `WEBPUSH_AVAILABLE` (find_spec) : avant, un paquet absent crashait tout le boot. L'import est maintenant dans un try/except — conserver ce garde-fou.

## Frontend

- Le proxy `createResourceApi` d'`api.js` génère des URLs qui ne correspondent PAS aux vraies routes backend pour la plupart des ressources. Seuls les proxies `users`/`workers`/`proposals` sont réellement utilisés (les autres — commissions/admin/wallet/search/stats/dashboard/settings — étaient morts, supprimés). Préférer des objets API explicites (`paymentAPI`, `reviewAPI`, `supportAPI`…).
- `handleUnauthorized` (api.js) doit purger localStorage ET sessionStorage : `getAuthToken` lit les deux buckets, donc un token stocké en sessionStorage survivait au 401 (boucle de redirection).

## Tests

- Les tests patchent le module où la fonction est UTILISÉE, pas où elle est définie : ex. `kojo_routers_payments.create_paydunya_invoice`, `kojo_routers_users.submit_paydunya_disburse_invoice`, `kojo_shared.notify_user_localized`.
- `register_and_login` (conftest) exige des comptes de paiement (client ≥1, worker ≥2) + vérif email OTP ; la fixture `client` désactive la validation `response_model`. Python système n'a pas pytest : utiliser `backend/.venv/Scripts/python.exe -m pytest` (Windows).

## Outillage local & vérification

- Binaire mongod Windows portable dans `.mongo-tmp/mongodb-win32-x86_64-windows-7.0.14` : le démarrer (ex. port 27018) puis lancer `backend/.venv` uvicorn avec `MONGO_URL` permet de tester le boot et `/health` en local avec une vraie base.
