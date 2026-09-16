# Couverture réelle de la CI — ce qui est vérifié à chaque push

> Audit du 16/09/2026. Source de vérité : `.github/workflows/ci.yml` (9 jobs,
> dont **8 requis** par la protection de branche).
>
> Ce document existe pour répondre à une question qu'un badge vert ne tranche pas :
> **ce ✓ prouve quoi ?** Un job peut réussir parce qu'il a tout vérifié, ou parce
> qu'il n'a rien exécuté. Les deux cas sont recensés ici, avec la condition qui
> les sépare — c'est la partie à relire avant de conclure « la CI est verte, donc
> c'est bon ».

## 1. Quand la CI tourne — et quand elle ne tourne pas

| Événement | CI |
|---|---|
| `push` sur `main` | **oui**, 9 jobs |
| `pull_request` vers `main` | **oui**, 9 jobs (dont `deploy-fly` *skipped*) |
| `workflow_dispatch` (manuel) | **oui** ; `deploy-fly` déploie même sans changement backend |
| `push` sur une branche de travail | **non** — aucun run n'est déclenché |

Conséquence directe : « à chaque push » signifie en réalité **à chaque push sur
`main` et à chaque PR vers `main`**. Une branche de travail peut accumuler
plusieurs commits entre deux validations ; le premier signal vient de la PR.

## 2. Les 8 jobs, et ce qui les fait réellement échouer

| Job (nom affiché) | Échoue réellement sur | Peut réussir sans rien vérifier |
|---|---|---|
| **Audits détectent les régressions** | 4 contrôles injectés qui doivent sortir en échec : `audit_docstrings.py`, `audit_api_returns.cjs`, `py_compile`, `pyflakes`. C'est un **méta-test** : si un garde devient aveugle, ce job rougit. | Non — c'est le job le mieux conçu du lot. Mais il ne couvre que **4** contrôles, sur la vingtaine que le workflow exécute : les autres doivent leur crédibilité à leurs propres tests (§4). |
| **Workflow lint (actionlint + shellcheck)** | YAML/expressions de `ci.yml` invalides ; shellcheck sur `.github/scripts/*.sh` et `backend/scripts/*.sh` (les deux globs résolvent : `resolve-vercel-url.sh`, `loadtest_real_flow.sh`). | Non. Seul `rhysd/actionlint` est **épinglé** (`v1.7.12`). |
| **Fly env doc-prod (drift + secrets)** | Formats des références du dépôt (`--refs-only`, sans réseau) ; drift `fly.toml` ↔ runtime ; secret obligatoire manquant ; doublon `[env]`↔secret ; secret orphelin ; clé `.env.example` absente de Fly. **Token absent → `exit 2` → job rouge** (échec bruyant, pas de saut). | Partiellement : les formats des **secrets déployés** (via `flyctl ssh`) et le snapshot de digests sont silencieusement inopérants (§3, F4). |
| **Backend tests (Python + MongoDB)** | `pytest` complet contre un **vrai** MongoDB (`mongo:7` en service container), `py_compile`, `audit_docstrings.py` strict. | Partiellement : Redis et `TrustedHostMiddleware` sont désactivés dans ce job (§3, F7). |
| **Frontend tests + build (Node/Vite)** | `vitest run`, `audit_api_returns.cjs` strict, `vite build`, puis **7 gardes sur les artefacts** (shells de pré-rendu, split pack2, split `services/api`, cartes OG, famille d'icônes, manifeste PWA, budgets de bundle). | Non, sur son périmètre. Aucun seuil de couverture : supprimer des tests reste vert (§7). |
| **Bundle size report (PR comment)** | Presque rien : c'est un **rapport**, pas un garde. Il échoue si le build est introuvable ou si le commentaire ne peut pas être publié. | **Oui, par conception** — il ne vise pas à bloquer quoi que ce soit (job **non requis**). Le garde de taille, lui, reste `check-bundle-size.js` dans `frontend-build`. |
| **Lighthouse performance budgets** | Login du compte CI dédié (secrets absents → rouge), assertions LHCI (`error`), `check-og-images.js`. | **Oui, largement** : repli silencieux sur un build local, verrou `/jobs/:id` du déploiement réel désactivé (couvert ailleurs sur les PR depuis le 16/09/2026, §3, F3), budgets très permissifs (§3, F2/F6). |
| **Mobile build (Capacitor + Android)** | Contrôle des bits exécutables (`check-exec-bits.py`, premier step, 0,17 s), `cap sync android`, `gradlew assembleDebug` (Java 21, SDK 36). | Sur `sdkmanager --licenses` et la preuve finale : le job prouve que **ça compile**, pas que ça fonctionne, et ne publie aucun artefact (§3, F5). |
| **Deploy backend to Fly.io** | `flyctl deploy --remote-only` (si un changement `backend/**` ou `ci.yml` est détecté). | **Oui** : sans changement backend, le job s'affiche ✓ avec **toutes** ses étapes de déploiement sautées (§3, F1). |

## 3. Les faux-verts : réussir sans avoir prouvé

### F1 — `Deploy backend to Fly.io` vert sans aucun déploiement

`deploy-fly` est un **check requis** de la protection de branche. Il se déclenche
à chaque push sur `main`, puis `dorny/paths-filter` filtre les chemins
(`backend/**`, `.github/workflows/ci.yml`). Les étapes `Setup flyctl` et
`Deploy to Fly.io` portent un `if:` sur ce filtre.

Un push qui ne touche que le frontend ou la documentation produit donc
**`deploy-fly ✓` alors qu'aucune machine Fly n'a été touchée** — et c'est le cas
le plus fréquent. Le ✓ est honnête (« rien à faire ») mais il ne signifie jamais
« le backend déployé correspond à `main` » : cette équivalence n'est vérifiable
que si un `backend/**` a changé, ou par un `workflow_dispatch` manuel.

> Corollaire : `deploy-fly` ne dépend que de `backend-tests` (`needs:`). Un
> frontend ou un mobile rouge **ne bloque pas** le déploiement backend — c'est
> délibéré, et il faut le savoir avant de conclure qu'un `main` vert est cohérent.

### F2 — Lighthouse mesure `localhost` au lieu de la production

`.github/scripts/resolve-vercel-url.sh` résout l'URL Vercel d'une PR depuis le
commentaire de l'app Vercel. Il **échoue volontairement en douceur** : rate-limit
GitHub (`403`), erreur réseau (`000`), HTTP ≠ 200, corps JSON inexploitable, ou
preview **protégée** par Vercel Deployment Protection → il logue un `⚠️` et
n'écrit **rien**. Le step suivant démarre alors `vite preview` sur le port 4173 et
`LHCI_URL=http://localhost:4173`.

Le job est vert, les mêmes assertions tournent — mais elles mesurent **un build
statique servi en local**, pas le déploiement Vercel : ni CDN, ni redirections,
ni cache d'edge, ni latence réseau. Une régression qui n'existe que sur le
déploiement réel (poids de la mise en cache d'edge, `s-maxage`, compression
négociée) passe donc au vert.

C'est le faux-vert le plus insidieux du workflow : **le mode de défaillance le
plus probable (une API externe rate-limitée) est exactement celui qui dégrade
silencieusement la portée du contrôle.**

### F3 — Le verrou `/jobs/:id` s'éteint tout seul — **atténué le 16/09/2026**

`check-og-job-200.js` crée une mission de test, vérifie la carte OG de la fiche,
la supprime, puis exige 404 + noindex + carte 404 + disparition du sitemap. Sur
repli build local (F2), le rewrite `/jobs/(.*)` de Vercel n'existe pas : le script
sort en **`exit 0` avec un simple `::notice`** (« Cycle ignoré (base locale) »).

Or ce repli concerne **toutes les PR** (la preview Vercel est protégée) : le
cycle ne tournait donc jamais avant fusion, et une régression ne se voyait
qu'après le merge, en production.

**Depuis le 16/09/2026, le cycle est rejoué sur les PR, mais pas par ce script :**

| Maillon | Où il tourne sur une PR | Ce qu'il prouve |
|---|---|---|
| Comportement du cycle (créer → 200 → supprimer → 404 + noindex + sitemap) | `backend/tests/test_job_og_cycle.py` (job `backend-tests`, check requis) | le fil complet contre le **code de la PR**, en processus (ASGI) |
| Configuration de routage (rewrite `/jobs/(.*)` → backend, chaque route de production déclarée, URL inconnue → 404) | `frontend/scripts/check-spa-routes.js` (job `frontend-build`) | que la requête est bien **acheminée** vers cette route |
| Shell statique de l'accueil (h1, contenu, liens, N.A.P., SEO local) | `frontend/scripts/check-home-shell.js` (job `frontend-build`) | que la page d'accueil dit quelque chose à un crawler **sans JavaScript** |
| Déploiement réel (rewrite Vercel, CDN, cache CDN, cache-busting) | `check-og-job-200.js`, sur `main` uniquement | l'état de la **production** après fusion |

Ce qui reste non couvert sur une PR est donc **le déploiement lui-même** (Vercel
et son CDN) — inhérent : mettre en ligne une preview par PR est impossible ici
(preview protégée). La configuration, elle, est désormais vérifiée avant merge.

### F4 — `fly-env-drift` : deux contrôles incapables de mordre

- **Snapshot de digests mort** : `NON_SENSITIVE_SNAPSHOT = {}` dans
  `.github/scripts/check-fly-env-drift.py`. Toute la section « rotation non
  documentée » du docstring (point 6) et la constante `SENSITIVE_KEYS` qui
  n'existe que pour elle ne peuvent donc jamais produire d'échec. Le mécanisme
  est présent, testable, et vide.
- **Formats des secrets déployés best-effort** : `check_deployed_formats` a
  besoin des valeurs via `flyctl ssh console`. Si SSH est indisponible, le script
  écrit `[WARN] SSH indisponible — formats secrets non vérifiés` et **continue**.
  Les formats `CORS_ORIGINS`, `REDIS_URL`, `MONGO_URL`, `VAPID_CLAIMS_EMAIL`
  réellement servis en production ne sont donc vérifiés que quand SSH répond.
  (Les mêmes formats sont, eux, garantis dans les références du dépôt par
  `--refs-only` — c'est la partie déterministe, et elle tourne toujours.)

### F5 — `mobile-build` : un échec neutralisé et zéro artefact

- `yes | sdkmanager --licenses || true` : le `|| true` **avale l'échec** de
  l'acceptation des licences. Le job reste vert même si ce step échoue — c'est
  assumé dans le commentaire, mais c'est un `|| true` dans une CI qui n'en a
  aucun autre (aucun `continue-on-error` nulle part).
- `chmod +x gradlew` avant `./gradlew` : **retiré (corrigé)**. Il était présenté
  comme la compensation d'un bit exécutable perdu lors des commits produits sous
  Windows — c'était inexact : `frontend/android/gradlew` est au mode **100755**
  dans l'index depuis le commit `dcb4e43` (« CI mobile : rend gradlew exécutable
  (Permission denied) »), et `core.filemode=false` empêche tout checkout Windows
  de le dégrader au commit suivant. Le `chmod` ne compensait donc rien : il
  rendait **vert** un job dont le bit aurait réellement disparu. Supprimé : un
  bit perdu fait donc échouer le job — c'est la détection voulue
  (`git update-index --chmod=+x` pour réparer).
- **Le diagnostic du bit est maintenant précoce et explicite** (ce qui referme
  le point ci-dessus) : `check-exec-bits.py` tourne en premier step du job,
  avant Node/Java/SDK, et répond en **0,17 s** là où le step APK ne démarre qu'à
  **+39 s** (mesuré sur le run 35137466972) pour un build Gradle de ~95 s. Il
  distingue trois pannes aux corrections différentes — mode perdu DANS GIT
  (message avec la commande de réparation), mode correct mais bit non
  matérialisé PAR LE CHECKOUT, et shebang absent ou en CRLF (qui échouerait même
  avec le bit, la règle `eol=lf` de `.gitattributes` étant alors la cause). Il
  échoue aussi, volontairement, quand il ne peut pas conclure (git absent,
  fichier non suivi) : un garde ne doit jamais rassurer en silence. Verrouillé
  par `backend/tests/test_exec_bits.py` (20 tests, dont deux en sous-processus
  avec un encodage de console hostile — le premier chemin de succès plantait sur
  un emoji hors cp1252 au lieu de conclure).
- **Aucun artefact n'est publié** (contrairement à Lighthouse, qui uploade ses
  rapports en `if: always()`) : une fois le run terminé, l'APK produit est
  introuvable. Et il n'y a ni émulateur ni test d'instrumentation : le job établit
  « le projet compile », jamais « l'application fonctionne ».

### F6 — Les budgets Lighthouse sont réels mais très permissifs

Les 5 assertions sont bien en `error` (elles bloquent), mais l'écart entre le
seuil et la valeur calibrée est large — un budget n'attrape qu'une régression
franche :

| Assertion | Seuil (`lighthouserc.cjs`) | Valeur calibrée (commentaire du fichier) | Marge |
|---|---|---|---|
| `categories:performance` | ≥ 0,85 | 0,95 accueil · 0,88-0,92 protégées | ~1 point de score |
| `largest-contentful-paint` | ≤ 5 000 ms | ~2 500 ms accueil · ~3-3,6 s protégées | **~2×** |
| `total-blocking-time` | ≤ 500 ms | ~10 ms accueil | **~50×** |
| `first-contentful-paint` | ≤ 4 000 ms | ~1,8 s accueil | **~2×** |
| `cumulative-layout-shift` | ≤ 0,1 | ~0,03 protégées après correctif | ~3× |

Un TBT multiplié par 20 ou un LCP doublé passent au vert. C'est un choix assumé
(absorber la variance du runner et de la 4G simulée), mais le garde protège
contre une **effondrement**, pas contre une dérive. Le fichier le dit lui-même :
la détection d'une régression *relative* exigerait un serveur LHCI, absent.
`numberOfRuns: 2` (médiane de 2) lisse mal la variance.

### F7 — `backend-tests` : deux chemins de production jamais exercés

```yaml
REDIS_URL: ""
DISABLE_TRUSTED_HOST_MIDDLEWARE: "true"
```

- `REDIS_URL` vide : tout code qui dépend de Redis (cache, circuit breaker
  persistant) prend son chemin de repli mémoire. Ce n'est pas un défaut — c'est le
  prix d'une CI sans Redis — mais **aucun test ne couvre la variante Redis**, qui
  est celle de la production.
- `DISABLE_TRUSTED_HOST_MIDDLEWARE` : le `TrustedHostMiddleware` est actif en
  production et **désactivé en CI**. Sa configuration (et donc une erreur de
  `TRUSTED_HOSTS` qui bloquerait la prod) n'est pas exercée par les tests.

À quoi s'ajoute une restriction volontaire dans le step pyflakes : la CI ne
s'intéresse qu'à une classe de messages.

```bash
UNDEFINED=$(python -m pyflakes kojo_*.py server.py | grep "undefined name" || true)
```

Le `| grep` **réduit pyflakes à une seule catégorie** (nom non défini). Un import
inutilisé, une variable masquée ou une redéfinition ne font pas échouer le job —
« pyflakes ✓ » signifie « aucun nom non défini », pas « pyflakes propre ».

### F8 — Aucun job ne vérifie le résultat du déploiement

`deploy-fly` s'arrête au succès de `flyctl deploy`. Rien ne sonde ensuite
`/api/health`, ni la version servie, ni qu'une machine est bien `started`. Un
déploiement qui démarre puis plante au boot est donc **vert**. La vérification
`/health` renvoyant la version (`1.0.2`) a été faite **à la main** lors de sa mise
en production — c'est précisément le maillon que la CI ne couvre pas.

## 4. Gardes jamais prouvés

Le job `audit-regression-test` prouve que 4 contrôles savent échouer
(`audit_docstrings.py`, `audit_api_returns.cjs`, `py_compile`, `pyflakes`). Les
autres gardes doivent leur crédibilité à leurs tests Vitest, qui injectent une
régression et exigent l'échec — c'est équivalent, à une exception près :

| Garde | Prouvé qu'il peut échouer par |
|---|---|
| `audit_docstrings.py`, `audit_api_returns.cjs`, `py_compile`, `pyflakes` | méta-test CI (`audit-regression-test`) |
| `check-api-split.js`, `check-bundle-size.js`, `check-generated-icons.js`, `check-home-shell.js`, `check-spa-routes.js`, `check-og-assets.js`, `check-og-images.js`, `check-og-job-200.js`, `check-pwa-manifest.js`, `check-pack2-chunks.js` (via `pack2-size.test.js`), `check-script-deps.js`, `validate-vercel-json.mjs`, `check-og-reproducible.js` (via `check-og-assets.test.js`) | tests Vitest dédiés |
| `check-workflow-pins.py` | `backend/tests/test_ci_workflow_pins.py` (classement des références + workflow réel) |
| **`check-prerender-shells.js`** | **rien** |

`check-prerender-shells.js` est référencé **uniquement** par `ci.yml` : pas de
fichier `check-prerender-shells.test.js`, aucune fixture, aucune entrée dans le
méta-test. Autrement dit, rien dans le dépôt ne démontre qu'il sait échouer. S'il
devenait aveugle (mauvaise condition, chemin d'artefact modifié par une montée de
version de Vite), la CI resterait verte sans que personne ne le voie — c'est le
seul garde dans ce cas, et c'est la première chose à corriger si l'on veut que
« les gardes sont testés » soit une affirmation vraie sans exception.

## 5. Ce qui est réellement vérifié à chaque push

Liste contractuelle. Chaque ligne est vérifiée sur **chaque** push `main` et
chaque PR vers `main` (sauf mention contraire).

**Backend**
- Compilation syntaxique de tous les modules Python et des tests.
- Aucun nom non défini dans les modules `kojo_*` (et rien d'autre, cf. F7).
- Tous les endpoints documentés (`audit_docstrings.py --fail-on-warning`).
- Suite `pytest` complète contre **un vrai MongoDB** : atomicité, index,
  opérateurs réels.
- Cycle complet de la fiche `/jobs/:id` **y compris sur les PR** : création par
  la cliente, fiche 200 + métadonnées OG, cartes wide/carrée 1200x630 et
  1200x1200, suppression, puis 404 + noindex + cartes 404 + disparition du
  sitemap, avec vérification que la mission est bien marquée supprimée en base
  (`test_job_og_cycle.py`).

**Frontend**
- Suite `vitest` complète (aucun seuil de couverture, cf. §7).
- Aucun endpoint fantôme dans les services (`audit_api_returns.cjs` strict).
- Le build Vite aboutit avec `VITE_API_URL` de production.
- Shells de pré-rendu présents dans `jobs.html` / `login.html`, `#root` vide dans
  `index.html`.
- Découpage `pack2PageI18n` toujours par scope (pas de chunk partagé ≥ 3
  dictionnaires).
- Les groupes d'endpoints *lazy* restent hors du chunk d'entrée.
- Routage complet (`check-spa-routes.js`) : rewrite de la fiche `/jobs/:id` vers
  la route OG déclarée par le backend, même backend que le proxy `/api`,
  sitemap/robots proxifiés, **chaque route de production de `src/App.js`**
  déclarée dans ses deux formes (`/route` et `/route/`), aucun catch-all (une
  URL inconnue doit répondre **404**, pas 200) et aucune règle exacte masquée
  par un motif placé avant.
- Page d'accueil pré-rendue (`check-home-shell.js`) : un h1 unique reprenant
  `heroTitle`, `title` ≤ 60 et description ≤ 160, ≥ 300 mots, des liens
  internes, `tel:`/`mailto:`/WhatsApp, le N.A.P. identique à
  `src/config/contact.json`, les pays de `CountryDisplay.js`, un `LocalBusiness`
  et une carte intégrée en lazy, et **chaque classe Tailwind du shell présente
  dans le CSS du build**.
- Cartes OG : générateur unique, PNG présents et aux bonnes dimensions, aucun
  orphelin.
- Famille d'icônes : empreintes de **pixels** conformes au manifeste, générateur
  rejoué, `favicon.ico` réellement décodable.
- Manifeste PWA : chaque icône déclarée existe, dimensions et `purpose` exacts,
  « maskable » **prouvé par la mesure** (zone de sécurité + opacité).
- Budgets de bundle (JS initial, plus gros chunk, poids total du build).
- Dépendances des **scripts de CI** : chaque module importé par un fichier de
  `scripts/` est déclaré en direct dans `package.json` (et le lock reproduit
  `package.json` à l'identique, sans quoi `npm ci` refuse d'installer) —
  `check-script-deps.js`, lancé dans la suite Vitest.

**Rapport — informatif, ne bloque rien**
- Les trois tailles mesurées (JS initial, plus gros chunk, build total) sont
  publiées en commentaire de PR, avec l'écart vs la dernière mesure de `main` et
  vs la mesure précédente de la même PR. C'est un **canal de lecture**, pas un
  garde : ce qui bloque reste `check-bundle-size.js`, dans `frontend-build`.
  Quand une référence manque, la colonne est omise et la raison est écrite —
  aucun écart n'est calculé contre une mesure douteuse.

**Références et configuration**
- Formats des variables critiques dans `fly.toml [env]`, `.env.example` et
  `DEPLOY_FLYIO.md` (déterministe, sans token ni réseau).
- `fly.toml` synchronisé avec l'environnement réellement servi par Fly, secrets
  obligatoires présents, doublons et orphelins détectés (nécessite
  `FLY_API_TOKEN` ; secrets déployés partiellement vérifiés, cf. F4).
- `ci.yml` valide (syntaxe et sémantique actionlint) et scripts shell propres.
- Aucune référence d'action sur une **branche** : chaque `uses:` vise un tag de
  version ou un SHA (`check-workflow-pins.py`) — une référence non résoluble
  fait échouer le job avant ses étapes (cf. `actionlint@v1`, 2026-08-27).
- Les 4 contrôles du méta-test échouent bien sur une régression injectée.

**Déploiement — `main` uniquement, et seulement si `backend/**` a changé**
- `flyctl deploy --remote-only` réussit (le résultat n'est pas sondé, cf. F8).

## 6. Dépendances externes : ce qui peut rougir sans rapport avec le code

| Dépendance | Où | Comportement si elle est indisponible |
|---|---|---|
| Registre npm | `npm ci` (4 jobs) | Job rouge, aucune atténuation |
| PyPI | `pip install` (2 jobs) | Job rouge |
| Docker Hub | service `mongo:7` | `backend-tests` rouge (service non démarré) |
| GitHub Actions (marketplace) | `checkout@v4`, `setup-python@v5`, `setup-node@v4`, `setup-java@v4`, `upload-artifact@v4`, `setup-android@v3`, `paths-filter@v3`, `flyctl-actions/setup-flyctl@<SHA>` | Job rouge. Plus aucune référence de **branche** : `actionlint` était déjà épinglé (`v1.7.12`), `setup-flyctl` valait `@master` et est désormais épinglé sur un **SHA** (= tag `v1`, runtime node24) ; les autres restent des tags de version flottants (`@v4`), vérifiés par `check-workflow-pins.py` |
| API Fly (`api.machines.dev`, `flyctl secrets list`, `flyctl ssh`) | `fly-env-drift` | Rouge (volontaire : échec bruyant plutôt que saut silencieux) |
| API GitHub (commentaires de PR) | `resolve-vercel-url.sh` | **Bascule silencieuse en F2** (repli build local), borné par `--max-time 20 --retry 2` |
| Vercel (preview + Deployment Protection) | idem | **F2** également : preview protégée ⇒ repli local |
| Backend de production (`kojo-backend.fly.dev`) | `ci-auth`, `check-og-images`, `check-og-job-200` | Rouge (le login du compte CI échoue) |
| Vercel production | `check-og-images`, `check-og-job-200` | Rouge |
| Android SDK / Gradle / AGP | `mobile-build` | Rouge, téléchargements longs |
| API de commentaires GitHub | `bundle-size-report` | Rouge sur **ce job seulement** — il n'est pas requis, donc aucune fusion n'est bloquée ; les mesures restent dans le résumé du run |
| Cache Actions (`actions/cache/restore` + `save@v4`) | `bundle-size-report` | Aucune référence disponible ⇒ rapport « première mesure », sans écarts — jamais un écart inventé |
| **Arbre de dépendances transitif (hissage npm)** | tout `require('…')` d'un script de `scripts/` | Rouge auparavant, sans rapport avec le code : le job « Audits détectent les régressions » est tombé le 2026-08-27 sur `Cannot find module '@babel/parser'`, un paquet jamais déclaré et disponible seulement via `@vitejs/plugin-react` → `@babel/core`. Corrigé par une **déclaration en direct** (`@babel/parser`, `@babel/traverse`) et verrouillé par `check-script-deps.js` |

Atténuations déjà en place, à ne pas casser : bornes réseau explicites dans
`resolve-vercel-url.sh`, fallback toujours **journalisé** (jamais muet),
`FLY_API_TOKEN` manquant ⇒ `exit 2`, aucun `continue-on-error` dans le workflow,
protection de branche avec 8 checks requis et exigence de branche à jour.

## 7. Angles morts assumés

À connaître avant d'affirmer qu'un changement est validé :

1. **Aucun test de bout en bout en navigateur.** Pas de Playwright/Cypress : le
   frontend est couvert par Vitest, le build et les gardes d'artefacts. Les
   parcours réels (connexion, profil, création de mission) sont vérifiés
   **manuellement**, avec les comptes de test du README.
2. **Aucun seuil de couverture.** `vitest run` et `pytest` sans `--cov` : une
   suite amputée reste verte.
3. **Aucun garde sur le résultat du déploiement** (F8) : ni `/health`, ni version
   servie, ni machine `started`.
4. **`deploy-fly` ne dépend pas du frontend ni du mobile** : un frontend rouge
   n'empêche pas un déploiement backend.
5. **Pas de `timeout-minutes`** sur les jobs (défaut GitHub : 360 min) ni de
   `concurrency` au niveau du workflow — seul `deploy-fly` a son groupe de
   concurrence. Un run peut donc patienter très longtemps avant d'échouer.
6. **`push` sur une branche de travail : aucun run** (§1).
7. **Pas d'audit de dépendances** (ni `npm audit`, ni job équivalent) : une CVE
   dans les dépendances ne fait pas rougir la CI.

## 8. Tenir ce document à jour

Ce fichier n'est pas généré : il est relu à la main. Il devient faux dès qu'un
job, un `if:`, un seuil de budget ou un `||` change dans `.github/workflows/ci.yml`
ou dans les scripts qu'il appelle. Trois règles suffisent à le garder honnête :

1. Toute étape qui peut **réussir sans rien faire** (repli, `::notice`, `|| true`,
   `if:` sur un filtre) doit apparaître dans §3, avec sa condition de
   déclenchement.
2. Tout garde nouveau doit soit passer par le méta-test, soit avoir son
   `*.test.js` qui exige l'échec — sinon il rejoint §4.
3. Toute dépendance externe nouvelle dans un job rejoint §6, avec son
   comportement en cas d'indisponibilité.
4. Tout job nouveau doit être déclaré ici comme **requis** (et alors ajouté à la
   protection de branche) ou comme **consultatif**. Un job consultatif qu'on
   croit bloquant est un faux-vert de plus ; un job requis qui ne peut pas
   échouer aussi.
