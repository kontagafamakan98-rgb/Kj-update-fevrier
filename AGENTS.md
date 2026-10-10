# AGENTS.md

Conventions non évidentes du dépôt. Quand une règle a un garde ou un test, il est cité. L'historique détaillé (mesures, incidents, empreintes) est dans `git log -p -- AGENTS.md`.

## Déploiement

- Backend sur Fly.io (`backend/fly.toml`, `backend/DEPLOY_FLYIO.md`). Frontend sur Vercel, avec `VITE_API_URL` pointant vers le backend.
- Health checks Fly rejetés en 400 par TrustedHost. Correctif : secret `DISABLE_TRUSTED_HOST_MIDDLEWARE=true` (`TRUSTED_HOSTS=*.internal` ne suffit pas).
- `fly launch` réécrit `fly.toml` : revérifier `[env]` (`BACKEND_PUBLIC_URL`, `TRUSTED_HOSTS`) après chaque lancement.
- Machines Fly en trial arrêtées après 5 min sans carte bancaire sur le compte.
- Utilisateurs d'Afrique de l'Ouest : héberger en Europe (Francfort). Ajouter l'IP de sortie de chaque hébergeur à la liste d'IP MongoDB Atlas.

## Configuration backend

- `BACKEND_PUBLIC_URL` est obligatoire hors Render : elle sert à TrustedHost ET aux callbacks IPN PayDunya.
- `APP_ENV` vaut `production` par défaut : `/docs` désactivé, `JWT_SECRET` et `EMAIL_OTP_SECRET` exigés (fail-fast), sauf si `development`.
- `backend/.env` désactive TrustedHost : le local ne teste jamais le contrôle de Host de la production.
- L'import de `pywebpush` dans `backend/kojo_shared.py` reste dans un try/except, jamais au niveau module.
- `PUT /users/profile` : `profile_photo` n'accepte que `https://res.cloudinary.com/`. Une chaîne vide est un no-op.
- Longueur minimale de mot de passe : 8, à garder synchrone dans `backend/kojo_models.py` (`UserRegister`, `UserWithPayment`, `PasswordResetConfirmRequest`), `frontend/src/utils/validation.js`, `frontend/src/pages/Register.js`, `frontend/src/pages/ForgotPassword.js` et la clé i18n `passwordTooShort` (5 langues).

## Données et métier backend

- Les propositions vivent dans `job_proposals`. `db.proposals` est morte : les index de propositions ciblent `job_proposals`.
- Le verrou `referral_withdrawal_in_progress` n'est libéré que par `kojo_shared.apply_referral_payout_confirmed`. Ne jamais dupliquer ce chemin (une copie dans `kojo_routers_payments` bloquait les retraits).
- `get_current_user` répond 401 « contactez le support » à un document legacy invalide. Corriger la donnée en base, pas le code.
- `serialize_payment_record` retire les payloads fournisseurs. Ne jamais les réexposer. `disburse_token` reste en base pour l'IPN disburse.
- Vue publique des jobs (`GET /jobs`, `GET /jobs/{id}`) : allowlist `JobPublic` (`backend/kojo_models.py`), jamais un denylist ni le document brut. Les coordonnées (`geo`, `location.latitude/longitude/coordinates`) ne sont jamais publiques.
- Vue connectée : document brut sans `_id`. Une fiche legacy qui ne valide pas `JobPublic` est écartée avec un warning : corriger la donnée.

## Frontend : URLs et API

- L'URL backend se construit uniquement via `frontend/src/utils/backendUrl.js` (`buildApiUrl`, `buildBackendUrl`). Ne jamais la réimplémenter (bug historique `/api/api`).
- Ordre de priorité : `window.__KOJO_API_URL__` / `__API_URL__`, puis `VITE_API_URL` / `VITE_API_BASE_URL` / `VITE_BACKEND_URL`, puis `REACT_APP_BACKEND_URL` / `REACT_APP_API_URL`, puis localhost:8000 en dev, puis `https://api.kojoforafrica.cc.cd`.
- `photo_url` est toujours une URL Cloudinary absolue.
- `createResourceApi` (`frontend/src/services/api.js`) génère de fausses URLs pour la plupart des ressources. Seuls `users`, `workers` et `proposals` servent. Préférer les objets explicites (`paymentAPI`, `reviewAPI`, `supportAPI`).
- `handleUnauthorized` purge localStorage ET sessionStorage, sinon une boucle de redirection survit au 401.
- Géolocalisation : seul module `frontend/src/services/geolocationService.js`. Pas de base de villes côté frontend : la source est `/api/geolocation/cities` (cache 7 j).

## Frontend : interactions

- Une surface qui se ferme sur un appui extérieur ne doit pas avaler l'appui : écouteur `mousedown` testé par `contains`. Aucune surface `fixed inset-0` sans fond visible. L'écouteur ne s'enregistre que s'il y a quelque chose à fermer, et l'appui sur le déclencheur ne ferme pas. Garde : `frontend/src/components/__tests__/appuis-exterieurs.test.jsx`, sonde `frontend/e2e/appuis-exterieurs.spec.js`.
- Une couche décorative `absolute inset-0` sans contenu doit porter `pointer-events-none`, sinon elle avale les clics (c'est ce qui rendait les boutons du héros morts). Garde : `appuis-exterieurs.test.jsx`, sonde `frontend/e2e/commandes-atteignables.spec.js`.
- Les liens de navigation passent par `frontend/src/components/LienVue.js`, jamais par le `Link` de React Router. Garde : `frontend/src/components/__tests__/LienVue.test.jsx`.
- Notifications : un seul panneau, monté dans `frontend/src/App.js`. Les cloches sont des déclencheurs sans état, une par barre : barre du haut en desktop seulement (`hidden md:flex`), barre du bas (`MobileBottomNav.js`) sur mobile. Le côté d'ouverture vient de `notificationPanelPlacement.js`. Le panneau se ferme si son ancre n'est plus affichée. Garde : `NotificationCenter.test.jsx`, sonde `frontend/e2e/notifications.spec.js`.
- Menu mobile : il se ferme quand la barre n'est plus affichée, par exemple à la rotation qui franchit 768 px. Sonde : `frontend/e2e/barres-rupture.spec.js`.
- Les langues sont listées une seule fois, dans le composant. Le tiroir mobile la lit : aucun `<option>` écrit en dur.
- Un filtre visible doit être fonctionnel. Un compteur ou une couleur doit décrire une donnée : une couleur d'état lit `data-statut` (`frontend/src/components/JobsResults.js`).

## Coquilles pré-rendues

- Le chrome (`.App`, `.min-h-screen`, navbar de 65 px, `main.flex-1`) est publié une seule fois, dans `frontend/vite-plugins/prerender/app-chrome.js`. Ne jamais le recopier dans une coquille.
- Une coquille ne recopie pas les classes de React : elle les lit au domicile partagé (`frontend/src/config/page-sections.js`, `frontend/src/config/classes-chrome.js`). Garde : `frontend/scripts/check-classes-coquilles.js`.
- La géométrie du LCP est déclarée par route dans `frontend/src/config/page-sections.js`, lue par les deux canaux. Gardes : `frontend/scripts/__tests__/check-home-hero-lcp.test.js`, `check-contact-lcp.test.js`, `check-lcp-geometrie.test.js` ; sondes `frontend/e2e/lcp-geometrie.spec.js`, `lcp-geometrie-declaree.spec.js`.
- Le texte publié par une coquille doit correspondre à celui de React, phrase entière, même bande verticale. Sonde : `frontend/e2e/texte-coquille-react.spec.js`. Un glyphe publié (emoji, puce) a un pendant peint par React : préférer une icône SVG déclarée.
- Une coquille ne déclare aucune ressource tierce : ni `script`, `iframe`, `img` externe, ni `preconnect` ou `dns-prefetch`. Garde : `frontend/scripts/check-shell-remote-resources.js`.
- Aucune URL tierce ne doit être écrite en clair dans le bundle sans interaction : garde `frontend/scripts/check-origines-bundles.js`, matrice `frontend/scripts/couverture-tiers.js`. La carte est une façade au clic, ou différée à l'entrée dans le viewport (`frontend/src/components/DeferredMap.js`), avec sa hauteur réservée. Sondes : `frontend/e2e/aucun-tiers-avant-interaction.spec.js`, `tiers-apres-interaction.spec.js`, `carte-facade.spec.js`.
- Les pages non livrées sont exclues du scan Tailwind (`@source not` dans `frontend/src/index.css`). Leurs classes ne doivent pas rester dans la feuille servie.

## Mise en page, style et typographie

- L'alignement est explicite. Rien n'est centré par héritage : un bloc centré porte `text-center`. Garde : `frontend/scripts/__tests__/check-app-chrome.test.js` ; `check-prerender-shells.js` interdit de republier une centure par héritage.
- Le rythme vertical se déclare, il ne se recopie pas : `--rythme-page`, `.cadre-page`, `.carte-publique`, `.carte-editoriale`, `.titre-page` (`frontend/src/index.css`), valeurs dans `frontend/src/config/page-sections.js` et `frontend/src/config/app-cadres.js`.
- `content-visibility` : les réserves de hauteur de l'accueil sont indexées par rang (`nth-of-type(N)`). Ajouter ou retirer une section au milieu décale les suivantes : revérifier les réserves.
- Faits chiffrés de l'accueil : `7j/7`, jamais `6j/7` ni « lundi au samedi ». Garde : `frontend/scripts/__tests__/faits-support.test.js`.
- Polices Inter et Cormorant servies par le site (`frontend/public/fonts/`, licences OFL à côté). `frontend/src/index.css` est le seul propriétaire de la police de `body`.
- Une déclaration dupliquée déplace le propriétaire sans rien dire. Une seule par propriété.
- Tailwind v4 : sources et thème dans `frontend/src/index.css` (`@source`, `@theme`). `frontend/tailwind.config.cjs` ne porte que `darkMode`, `theme` et `plugins`.
- `darkMode: ['class']` est une décision : le site n'a pas de thème sombre, et un `dark:` ne doit pas s'activer seul.
- `gray` est redirigé vers `stone` dans `frontend/tailwind.config.cjs`. Ne pas retirer cette redirection : sans elle, la gamme froide est émise sans règle et le texte hérite de la couleur du parent.

## Héros et images

- Les photos du héros sont dans `frontend/src/config/photos-heros.js`, lues par React (`PhotoDuHeros.js`) et par la coquille (`shells-home.js`). Un seul `<img>` : un fondu à deux images doublerait le téléchargement. Toutes au même rapport 720 × 960, sinon décalage et LCP. Garde : `frontend/src/components/__tests__/PhotoDuHeros.test.jsx`.
- Les variantes AVIF et WebP sont produites par `frontend/scripts/gen-hero-images.py` et vérifiées par `frontend/scripts/check-hero-images.js` (lecture des en-têtes). Ne jamais publier une variante sans la régénérer.
- Le contrôle de pause de l'alternance est en place (WCAG 2.2.2). Sonde : `frontend/e2e/heros-pause.spec.js`, rotation : `frontend/e2e/heros-rotation.spec.js`.
- Ne pas remettre un garde `prefers-reduced-motion` sur la photo alternée : il la rendrait invisible.
- La marque (favicon, icônes PWA, icône de la barre) a une seule géométrie : `frontend/src/config/marque-kojo.json`, lue par `marque-kojo.js`, `frontend/vite-plugins/prerender/icons-serveur.js` et `frontend/public/icons/generate_icons.py`. Gardes : `frontend/scripts/check-marque-kojo.js`, `check-generated-icons.js`, `check-og-assets.js`.
- Tout changement d'un artefact précaché par `frontend/public/push-sw.js` impose de changer `CACHE_NAME` (actuellement `kojo-shell-v2`), sinon une installation ouverte garde l'ancien.

## CSS : sélecteurs et animations

- Aucun sélecteur sans porteur dans la feuille source. Garde : `frontend/scripts/check-css-selecteurs-morts.js`.
- Une classe posée doit exister dans la feuille servie : même garde, troisième direction. Un porteur se lit dans la position de classe (AST), jamais dans un mot de commentaire ou de corpus.
- Une `@keyframes` doit être jouée, et une animation jouée doit être déclarée. Garde : `frontend/scripts/check-keyframes-animations.js`.
- Un garde qui compte des porteurs compte des positions de classe, pas des occurrences de texte, et il refuse de juger en dessous d'un plancher de lecture.

## Mesures de performance

- Lighthouse se mesure en distribution, sur un seul build : au moins 30 runs (`frontend/scripts/mesure-lighthouse-locale.mjs --runs N`). Un run unique ne suffit pas : le Speed Index varie de plusieurs secondes sur un même artefact.
- Comparer des variantes entrelacées, pas en blocs : sinon la dérive de l'hôte se lit comme un gain.
- Un outil d'optimisation se valide contre la feuille SERVIE en production, pas seulement contre ses propres tests.
- Préférer les mesures de structure (nœuds, hauteurs, aire du LCP) aux millisecondes. Garde et table : `frontend/e2e/style-layout-document.spec.js`, `frontend/scripts/style-layout-budgets.cjs`.
- Un budget ou un délai absolu en ms ou en px se déclare dans `frontend/scripts/check-juges-de-temps.js`, avec sa classe : `PROPRIETE`, `VIVACITE`, `HOTE` ou `MESURE`.
- Un timeout de test se dérive d'une mesure (`scripts/budget-de-vivacite.js`), jamais d'une constante élargie.
- Le CLS se mesure par route, en navigateur, avec les sources des décalages : `frontend/e2e/cls-coquille-react.spec.js`, `frontend/e2e/cadres-app.spec.js`. Budgets : `frontend/scripts/lhci-cls-budgets.cjs`. Le montage de React seul ne décale rien : ce sont les réactions qui suivent le montage qui comptent.
- LHCI lit uniquement des configs `.cjs` (`frontend/lighthouserc.cjs`, `lighthouserc.desktop.cjs`). `js-yaml` 4 n'a plus `safeLoad` : une config YAML casserait LHCI.

## Tests

- Patcher le module où la fonction est UTILISÉE, pas celui où elle est définie (ex. `kojo_routers_payments.create_paydunya_invoice`).
- Ne jamais attendre une tâche de fond par une horloge : `circuit_background_tasks()` et `drain()` (`backend/tests/test_payout_sweeper.py`).
- Un sous-processus Python fixe l'encodage des deux côtés : `PYTHONIOENCODING=utf-8` sur l'enfant, `encoding="utf-8", errors="replace"` sur le parent.
- `pytest -k "Classe::test"` ne sélectionne rien (code 5) : passer l'identifiant de nœud, et exiger le code 1 dans un harnais de mutation.
- Mutation d'un fichier réel : lecture et écriture en mode brut (`newline=""`), empreinte SHA-1 avant et après, `PYTHONDONTWRITEBYTECODE=1`.
- Python local 3.13, CI 3.11 : pas de `read_text(newline=…)`. Utiliser `open(p, "r", encoding="utf-8", newline="")`.
- Pytest sous Windows : `backend/.venv/Scripts/python.exe -m pytest`. `register_and_login` (`backend/tests/conftest.py`) exige des comptes de paiement et l'OTP.
- E2E : construire avec `VITE_API_URL=http://127.0.0.1:8123/api npm run build`, puis `npm run test:e2e`. Un `npm run build` nu embarque `127.0.0.1:8000` et fait rougir les parcours connectés.
- La fixture (`frontend/scripts/playtest-api-server.mjs`) réinitialise l'état du compte à chaque connexion. Un rouge qui disparaît après redémarrage du double est un rouge d'état : le redémarrer avant d'accuser le code.
- Aucune `waitForTimeout(N)` dans `frontend/e2e/` : attendre une condition neutre. Garde : `check-juges-de-temps.js` (le dossier `frontend/e2e` est déclaré).
- Mutations des gardes : `.github/scripts/check-guard-mutations.py`, registre `.github/scripts/guard-proofs.json`, exhaustivité `backend/tests/test_guard_failure_proofs.py`. Ne jamais les rejouer pendant une suite complète : la suite lit le fichier muté.
- Un garde qui audite le dépôt sort en 1 sur un écart et vit dans `frontend/scripts/`. Un test de composant vit dans `src/`.
- Un test qui vérifie un composant ne voit ni la mise en page ni les requêtes réseau : ajouter la sonde navigateur (`frontend/e2e/`) pour le fait, jsdom pour le comportement.

## Git et outillage

- `.githooks/pre-push` lance `frontend/scripts/check-test-environment.js --avant-push`.
- `git branch -d` refuse une branche fusionnée par squash : utiliser `-D`. Hygiène des branches : `frontend/scripts/check-git-branches.js`.
- `fetch.prune=true` est posé localement. `fetch.pruneTags` ne l'est pas, volontairement.
- Retard de `main` sur la production (commits et ancienneté) : `frontend/scripts/check-retard-main.js`.
- Mongo local portable : `.mongo-tmp/` (ex. port 27018), avec `MONGO_URL` pour `backend/.venv` uvicorn.
- `.github/workflows/lighthouse-mesure-locale.yml` est en `workflow_dispatch` seul : une mesure ne part pas du même clic que le déploiement.
