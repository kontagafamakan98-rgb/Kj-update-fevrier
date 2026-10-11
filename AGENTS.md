# AGENTS.md

Conventions non évidentes du dépôt. Une règle qui a un garde ou un test le cite.
Historique (mesures, incidents) : `git log -p -- AGENTS.md`.

## Déploiement

- Backend : Fly.io (`backend/fly.toml`, `backend/DEPLOY_FLYIO.md`). Frontend : Vercel, `VITE_API_URL` pointe vers le backend.
- Health checks Fly rejetés en 400 par TrustedHost : secret `DISABLE_TRUSTED_HOST_MIDDLEWARE=true` (`TRUSTED_HOSTS=*.internal` ne suffit pas).
- `fly launch` réécrit `fly.toml` : revérifier `[env]` (`BACKEND_PUBLIC_URL`, `TRUSTED_HOSTS`).
- Machines Fly en trial arrêtées après 5 min sans carte bancaire.
- Utilisateurs d'Afrique de l'Ouest : héberger à Francfort. Ajouter l'IP de sortie de chaque hébergeur à MongoDB Atlas.

## Configuration backend

- `BACKEND_PUBLIC_URL` est obligatoire hors Render : TrustedHost ET callbacks IPN PayDunya.
- `APP_ENV=production` par défaut : `/docs` désactivé, `JWT_SECRET` et `EMAIL_OTP_SECRET` exigés (fail-fast), sauf `development`.
- `backend/.env` désactive TrustedHost : le local ne teste jamais le contrôle de Host.
- `pywebpush` (`backend/kojo_shared.py`) s'importe dans un try/except, jamais au niveau module.
- `PUT /users/profile` : `profile_photo` n'accepte que `https://res.cloudinary.com/`. Chaîne vide = no-op.
- Mot de passe : 8 caractères minimum, synchrone dans `backend/kojo_models.py` (`UserRegister`, `UserWithPayment`, `PasswordResetConfirmRequest`), `frontend/src/utils/validation.js`, `frontend/src/pages/Register.js`, `frontend/src/pages/ForgotPassword.js`, et la clé i18n `passwordTooShort` (5 langues).

## Données et métier backend

- Propositions : `job_proposals`. `db.proposals` est morte.
- `referral_withdrawal_in_progress` ne se libère que par `kojo_shared.apply_referral_payout_confirmed`. Ne jamais dupliquer ce chemin.
- Document legacy invalide : `get_current_user` répond 401 « contactez le support ». Corriger la donnée en base, pas le code.
- `serialize_payment_record` retire les payloads fournisseurs, à ne jamais réexposer. `disburse_token` reste en base pour l'IPN disburse.
- Vue publique des jobs (`GET /jobs`, `GET /jobs/{id}`) : allowlist `JobPublic` (`backend/kojo_models.py`), jamais un denylist. Coordonnées (`geo`, `location.latitude/longitude/coordinates`) jamais publiques.
- Vue connectée : document brut sans `_id`. Une fiche qui ne valide pas `JobPublic` est écartée avec un warning : corriger la donnée.
- Journal métier `business_events` (`backend/kojo_business_events.py`) : quatre jalons, `user_id` obligatoire. Lu par `GET /owner/missions/{job_id}/evenements`. Sort RGPD déclaré dans `backend/tests/test_export_deletion_inverse.py`.

## Frontend : URLs et API

- URL backend uniquement via `frontend/src/utils/backendUrl.js` (`buildApiUrl`, `buildBackendUrl`). Ne jamais la réimplémenter (bug `/api/api`).
- Ordre : `window.__KOJO_API_URL__` / `__API_URL__`, `VITE_API_URL` / `VITE_API_BASE_URL` / `VITE_BACKEND_URL`, `REACT_APP_BACKEND_URL` / `REACT_APP_API_URL`, localhost:8000 en dev, puis `https://api.kojoforafrica.cc.cd`.
- `photo_url` : toujours une URL Cloudinary absolue.
- `createResourceApi` (`frontend/src/services/api.js`) invente des URLs : seuls `users`, `workers`, `proposals` servent. Préférer `paymentAPI`, `reviewAPI`, `supportAPI`.
- Web : aucun jeton en stockage. Le cookie httpOnly est le seul canal ; `isNativeShell()` (`frontend/src/services/api.js`) limite l'écriture au shell Capacitor. Vérifier cross-site en préproduction.
- `handleUnauthorized` purge localStorage ET sessionStorage, sinon boucle de redirection.
- Géolocalisation : seul `frontend/src/services/geolocationService.js`. Source des villes : `/api/geolocation/cities` (cache 7 j), pas de base côté frontend.

## Frontend : interactions

- Surface qui se ferme sur appui extérieur : écouteur `mousedown` testé par `contains`, n'avale pas l'appui, ne s'enregistre que s'il y a quelque chose à fermer. Aucune `fixed inset-0` sans fond visible. Garde : `frontend/src/components/__tests__/appuis-exterieurs.test.jsx`, sonde `frontend/e2e/appuis-exterieurs.spec.js`.
- Couche décorative `absolute inset-0` sans contenu : `pointer-events-none`, sinon elle avale les clics. Sonde : `frontend/e2e/commandes-atteignables.spec.js`.
- Liens de navigation : `frontend/src/components/LienVue.js`, jamais le `Link` de React Router. Garde : `frontend/src/components/__tests__/LienVue.test.jsx`.
- Notifications : un panneau, monté dans `frontend/src/App.js`. Cloches sans état : barre du haut en desktop (`hidden md:flex`), barre du bas (`MobileBottomNav.js`) sur mobile. Côté d'ouverture : `notificationPanelPlacement.js`. Garde : `NotificationCenter.test.jsx`, sonde `frontend/e2e/notifications.spec.js`.
- Menu mobile : fermé quand la barre disparaît (rotation au-delà de 768 px). Sonde : `frontend/e2e/barres-rupture.spec.js`.
- Langues listées une seule fois, dans le composant. Aucun `<option>` en dur.
- Un filtre visible doit fonctionner. Une couleur d'état lit `data-statut` (`frontend/src/components/JobsResults.js`).

## Coquilles pré-rendues

- Chrome (`.App`, `.min-h-screen`, navbar 65 px, `main.flex-1`) publié une seule fois : `frontend/vite-plugins/prerender/app-chrome.js`. Ne jamais le recopier.
- Une coquille lit les classes React au domicile partagé (`frontend/src/config/page-sections.js`, `frontend/src/config/classes-chrome.js`). Garde : `frontend/scripts/check-classes-coquilles.js`.
- Géométrie LCP déclarée par route dans `frontend/src/config/page-sections.js`. Gardes : `frontend/scripts/__tests__/check-home-hero-lcp.test.js`, `check-contact-lcp.test.js`, `check-lcp-geometrie.test.js` ; sondes `frontend/e2e/lcp-geometrie.spec.js`, `lcp-geometrie-declaree.spec.js`.
- Texte de coquille = texte React, phrase entière, même bande verticale. Sonde : `frontend/e2e/texte-coquille-react.spec.js`. Glyphe publié (emoji, puce) : préférer une icône SVG déclarée.
- Coquille sans ressource tierce (`script`, `iframe`, `img` externe, `preconnect`, `dns-prefetch`). Garde : `frontend/scripts/check-shell-remote-resources.js`.
- Aucune URL tierce en clair dans le bundle sans interaction : `frontend/scripts/check-origines-bundles.js`, matrice `frontend/scripts/couverture-tiers.js`. Carte : façade au clic, ou différée (`frontend/src/components/DeferredMap.js`) avec hauteur réservée. Sondes : `frontend/e2e/aucun-tiers-avant-interaction.spec.js`, `tiers-apres-interaction.spec.js`, `carte-facade.spec.js`.
- Pages non livrées exclues du scan Tailwind (`@source not` dans `frontend/src/index.css`).

## Mise en page, style et typographie

- Alignement explicite : un bloc centré porte `text-center`. Garde : `frontend/scripts/__tests__/check-app-chrome.test.js` ; `check-prerender-shells.js`.
- Rythme vertical déclaré, pas recopié : `--rythme-page`, `.cadre-page`, `.carte-publique`, `.carte-editoriale`, `.titre-page` (`frontend/src/index.css`), valeurs dans `frontend/src/config/page-sections.js` et `frontend/src/config/app-cadres.js`.
- `content-visibility` de l'accueil : réserves indexées par `nth-of-type(N)`. Ajouter ou retirer une section au milieu : revérifier.
- Faits chiffrés de l'accueil : `7j/7`, jamais `6j/7`. Garde : `frontend/scripts/__tests__/faits-support.test.js`.
- Polices Inter et Cormorant servies par le site (`frontend/public/fonts/`). `frontend/src/index.css` possède la police de `body`.
- Une seule déclaration par propriété : une doublon déplace le propriétaire en silence.
- Tailwind v4 : `@source` et `@theme` dans `frontend/src/index.css`. `frontend/tailwind.config.cjs` ne porte que `darkMode`, `theme`, `plugins`.
- `darkMode: ['class']` est voulu : pas de thème sombre, un `dark:` ne doit pas s'activer seul.
- `gray` redirigé vers `stone` dans `frontend/tailwind.config.cjs`. Ne pas retirer : sinon le texte hérite de la couleur du parent.

## Héros et images

- Photos du héros : `frontend/src/config/photos-heros.js`, lues par `PhotoDuHeros.js` et `shells-home.js`. Un seul `<img>`, toutes en 720 × 960. Garde : `frontend/src/components/__tests__/PhotoDuHeros.test.jsx`.
- AVIF et WebP produits par `frontend/scripts/gen-hero-images.py`, vérifiés par `frontend/scripts/check-hero-images.js`. Ne jamais publier une variante sans la régénérer.
- Pause de l'alternance (WCAG 2.2.2) en place. Sondes : `frontend/e2e/heros-pause.spec.js`, `frontend/e2e/heros-rotation.spec.js`.
- Pas de `prefers-reduced-motion` sur la photo alternée : elle deviendrait invisible.
- Marque (favicon, icônes PWA, icône de barre) : `frontend/src/config/marque-kojo.json`, lue par `marque-kojo.js`, `frontend/vite-plugins/prerender/icons-serveur.js`, `frontend/public/icons/generate_icons.py`. Gardes : `frontend/scripts/check-marque-kojo.js`, `check-generated-icons.js`, `check-og-assets.js`.
- Artefact précaché par `frontend/public/push-sw.js` modifié : changer `CACHE_NAME` (actuellement `kojo-shell-v2`).

## CSS : sélecteurs et animations

- Aucun sélecteur sans porteur. Garde : `frontend/scripts/check-css-selecteurs-morts.js`. Un porteur se lit dans la position de classe (AST), jamais dans un commentaire.
- Une `@keyframes` doit être jouée, et une animation jouée déclarée. Garde : `frontend/scripts/check-keyframes-animations.js`.
- Un garde qui compte des porteurs compte des positions de classe, et refuse de juger sous un plancher de lecture.

## Mesures de performance

- Lighthouse : distribution, au moins 30 runs (`frontend/scripts/mesure-lighthouse-locale.mjs --runs N`), un seul build.
- Variantes comparées entrelacées, pas en blocs. Un outil d'optimisation se valide contre la feuille SERVIE.
- Préférer structure (nœuds, hauteurs, aire LCP) aux millisecondes. Garde : `frontend/e2e/style-layout-document.spec.js`, `frontend/scripts/style-layout-budgets.cjs`.
- Budget ou délai absolu : `frontend/scripts/check-juges-de-temps.js`, classe `PROPRIETE`, `VIVACITE`, `HOTE` ou `MESURE`. Timeout dérivé : `scripts/budget-de-vivacite.js`.
- CLS par route, en navigateur : `frontend/e2e/cls-coquille-react.spec.js`, `frontend/e2e/cadres-app.spec.js`. Budgets : `frontend/scripts/lhci-cls-budgets.cjs`.
- LHCI lit uniquement des configs `.cjs` (`frontend/lighthouserc.cjs`, `lighthouserc.desktop.cjs`). `js-yaml` 4 n'a plus `safeLoad`.

## Tests

- Patcher le module où la fonction est UTILISÉE (ex. `kojo_routers_payments.create_paydunya_invoice`), jamais celui où elle est définie.
- Tâche de fond : ne jamais attendre une horloge. Utiliser `circuit_background_tasks()` et `drain()` (`backend/tests/test_payout_sweeper.py`).
- Sous-processus Python : `PYTHONIOENCODING=utf-8` côté enfant, `encoding="utf-8", errors="replace"` côté parent.
- `pytest -k "Classe::test"` ne sélectionne rien (code 5) : passer l'identifiant de nœud, exiger le code 1 dans un harnais de mutation.
- Mutation d'un fichier réel : lecture et écriture en mode brut (`newline=""`), empreinte SHA-1 avant et après, `PYTHONDONTWRITEBYTECODE=1`.
- Python local 3.13, CI 3.11 : pas de `read_text(newline=…)`. Utiliser `open(p, "r", encoding="utf-8", newline="")`.
- Pytest sous Windows : `backend/.venv/Scripts/python.exe -m pytest`. `register_and_login` (`backend/tests/conftest.py`) exige des comptes de paiement et l'OTP.
- E2E : `VITE_API_URL=http://127.0.0.1:8123/api npm run build` puis `npm run test:e2e`. Un build nu embarque `127.0.0.1:8000`.
- Fixture `frontend/scripts/playtest-api-server.mjs` : état réinitialisé à chaque connexion. Un rouge qui disparaît au redémarrage du double est un rouge d'état.
- Aucune `waitForTimeout(N)` dans `frontend/e2e/`. Garde : `check-juges-de-temps.js`.
- Mutations des gardes : `.github/scripts/check-guard-mutations.py`, registre `.github/scripts/guard-proofs.json`, exhaustivité `backend/tests/test_guard_failure_proofs.py`. Ne jamais les rejouer pendant une suite complète.
- Garde qui audite le dépôt : sort en 1 sur un écart, vit dans `frontend/scripts/`. Test de composant : dans `src/`.
- Un test de composant ne voit ni mise en page ni réseau : sonde navigateur (`frontend/e2e/`) pour le fait, jsdom pour le comportement.

## Git et outillage

- `.githooks/pre-push` lance `frontend/scripts/check-test-environment.js --avant-push`.
- `git branch -d` refuse une branche fusionnée par squash : utiliser `-D`. Hygiène : `frontend/scripts/check-git-branches.js`.
- `fetch.prune=true` posé localement ; `fetch.pruneTags` volontairement non.
- Retard de `main` sur la production : `frontend/scripts/check-retard-main.js`.
- Mongo local portable : `.mongo-tmp/` (ex. port 27018), `MONGO_URL` pour uvicorn.
- `.github/workflows/lighthouse-mesure-locale.yml` : `workflow_dispatch` seul.
