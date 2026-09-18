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
| **Frontend tests + build (Node/Vite)** | `vitest run`, `audit_api_returns.cjs` strict, `vite build` — **qui refuse déjà une page de route publique sans métadonnées** (plugin `require-page-meta`, §3 F12), donc avant même d'écrire un artefact —, puis **9 gardes sur les artefacts** (shells de pré-rendu, routage SPA, shell d'accueil/SEO, descriptions par page, split pack2, split `services/api`, cartes OG, famille d'icônes, manifeste PWA, budgets de bundle). | Non, sur son périmètre. Aucun seuil de couverture : supprimer des tests reste vert (§7). |
| **Bundle size report (PR comment)** | Presque rien : c'est un **rapport**, pas un garde. Il échoue si le build est introuvable ou si le commentaire ne peut pas être publié. | **Oui, par conception** — il ne vise pas à bloquer quoi que ce soit (job **non requis**). Le garde de taille, lui, reste `check-bundle-size.js` dans `frontend-build`. |
| **Lighthouse performance budgets** | Login du compte CI dédié (secrets absents → rouge), assertions LHCI (`error`), `check-og-images.js`, et depuis le 17/09/2026 le **cycle `/jobs/:id` en HTTP** sur une pile locale « forme production » (§3, F3). | **Oui, sur le périmètre performance** : repli silencieux sur un build servi en local (seul l'accueil y est audité — ni CDN, ni cache d'edge, §3, F2), budgets calés sur des mesures réelles mais encore larges (§3, F6). Le cycle `/jobs/:id` et les pages auth, eux, sont désormais mesurés/vérifiés sur chaque PR. |
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
n'écrit **rien**. Le job démarre alors, dans une MongoDB jetable, le **backend de
la PR** et `frontend/scripts/vercel-rewrite-server.js` (qui rejoue la table de
rewrites de `vercel.json`), puis annonce `KOJO_LHCI_BASE_URL=http://127.0.0.1:4174`
— le repli n'est plus un serveur statique nu (voir F3).

Sur ce repli, **seul l'accueil** est audité par Lighthouse : l'adresse est
loopback, et `lighthouserc.cjs` y voit le repli local (le build est compilé avec
l'API de prod, donc `/jobs` et `/dashboard` mesurés là-bas décriraient l'accueil
déguisé et une redirection vers `/login` — des chiffres qui ne décrivent aucune
page réelle). Le déploiement réel, lui, est audité sur les six
URLs (`/`, `/register`, `/forgot-password`, `/dashboard`, `/jobs`, `/profile`,
ces trois dernières authentifiées par le jeton Bearer du compte CI) : c'est là,
et là seulement, que les budgets des pages protégées sont appliqués.

Le job est vert, les mêmes assertions tournent — mais elles mesurent **un build
servi en local**, pas le déploiement Vercel : ni CDN, ni redirections, ni cache
d'edge, ni latence réseau. Une régression qui n'existe que sur le déploiement
réel (`s-maxage`, cache distribué, redirections) passe donc au vert. C'est la
raison d'être du repli « forme production » de F3 : il ferme le trou de
**comportement** (le cycle HTTP), pas celui de la **latence** — laquelle
n'existe que sur le déploiement, et reste auditée sur `main`.

C'est le faux-vert le plus insidieux du workflow : **le mode de défaillance le
plus probable (une API externe rate-limitée) est exactement celui qui dégrade
silencieusement la portée du contrôle.**

### F3 — Le verrou `/jobs/:id` s'éteignait tout seul — **fermé le 17/09/2026**

`check-og-job-200.js` crée une mission de test, vérifie la carte OG de la fiche,
la supprime, puis exige 404 + noindex + carte 404 + disparition du sitemap. Sur
repli build local (F2), le rewrite `/jobs/(.*)` de Vercel n'existe pas : le script
sortait en **`exit 0` avec un simple `::notice`** (« Cycle ignoré (base locale) »).
Or ce repli concerne **toutes les PR** (la preview Vercel est protégée) : le
cycle ne tournait donc jamais avant fusion, et une régression ne se voyait
qu'après le merge, en production.

Atténué le 16/09/2026 par deux gardes complémentaires, puis **fermé le
17/09/2026** : le repli local ne sert plus un serveur statique nu, mais une
**pile « forme production »** — MongoDB jetable + backend de la PR (uvicorn) +
`frontend/scripts/vercel-rewrite-server.js`, qui **rejoue la table de rewrites de
`vercel.json`** (lue dans le fichier, jamais recopiée) devant le build. Le cycle
s'exécute donc en vraies requêtes HTTP **sur chaque PR**, sans écriture en
production (la mission de test naît et meurt dans la base éphémère du job) et
sans secret supplémentaire.

| Maillon | Où il tourne sur une PR | Ce qu'il prouve |
|---|---|---|
| Cycle HTTP complet sur la pile locale (création → fiche pré-rendue → cartes Pillow → suppression → 404 + noindex + sitemap) | `check-og-job-200.js` (job `lighthouse-ci`, check requis) | le fil **de bout en bout**, en HTTP, contre le code de la PR **et** contre la table de rewrites de `vercel.json` |
| Comportement du cycle | `backend/tests/test_job_og_cycle.py` (job `backend-tests`, check requis) | le même fil en processus (ASGI) : les deux se recoupent, aucun des deux ne dépend de l'autre |
| Configuration de routage (rewrite `/jobs/(.*)` → backend, chaque route de production déclarée, URL inconnue → 404) | `frontend/scripts/check-spa-routes.js` (job `frontend-build`) | que la requête est bien **acheminée** vers cette route |
| Fidélité de l'émulateur (motifs, ordre des règles, slash final, en-têtes, 404 sans catch-all, proxy des destinations absolues, compression) | `frontend/scripts/__tests__/vercel-rewrite-server.test.js` | que le vert du cycle local ne vient pas d'un serveur **plus permissif** que Vercel |
| Déploiement réel (rewrite Vercel, CDN, cache CDN, cache-busting) | `check-og-job-200.js`, sur `main` uniquement | l'état de la **production** après fusion |

La décision « la base auditée sert-elle la fiche ? » est **observée**, pas
déduite de l'adresse : les deux scripts interrogent une fiche inexistante et
exigent 404 + noindex (`baseServesJobOgRoute`). C'est cet abandon de
l'heuristique `localhost → on saute` qui a rendu la fermeture possible — elle
était VRAIE tant que le seul repli possible était `vite preview`, et fausse dès
qu'un serveur local rejoue les rewrites. Si la pile locale ne sert pas la route,
le job échoue **avant** les checks (sonde explicite dans le workflow) : un cycle
« ignoré » ne peut plus passer pour un cycle vérifié.

Un détail de fidélité compte pour la suite : le repli local sert désormais aussi
l'audit Lighthouse (adresse loopback → `lighthouserc.cjs` reste en mode repli,
audit de l'accueil seul), donc le serveur de rewrites **compresse en gzip** comme
Vercel. Sans cela, Lighthouse aurait mesuré des bundles non compressés et fait
rougir l'audit pour une raison d'émulateur.

Ce qui reste non couvert sur une PR est donc **le déploiement lui-même** (Vercel
et son CDN : TLS, cache distribué, règles géographiques) — inhérent : mettre en
ligne une preview par PR est impossible ici (preview protégée). Le comportement
et la configuration sont, eux, vérifiés avant merge.

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

### F6 — Les budgets Lighthouse (re-calibrés sur des mesures le 16/09/2026)

Les 5 assertions sont en `error` (elles bloquent). Elles portaient sur des
valeurs approximatives et **une seule URL** : le job mesurait l'accueil, jamais
les pages protégées (voir F2bis). Correctif du 16/09/2026, puis relevé réel du
déploiement, 3 runs par page, médianes :

| Page | score | FCP | LCP | TBT (médiane) | TBT par run | CLS |
|---|---|---|---|---|---|---|
| `/` | 0,99 | 1 263 ms | 1 263 ms | 1 ms | `2878, 1, 0` | 0,056 |
| `/dashboard` | 0,98 | 1 395 ms | 2 386 ms | 0 ms | `0, 0, 0` | 0,001 |
| `/jobs` | 0,94 | 969 ms | 2 057 ms | 30 ms | `665, 12, 30` | **0,135** |
| `/profile` | 0,97 | 1 399 ms | 2 496 ms | 2 ms | `7, 2, 0` | 0,001 |

| Assertion | Seuil | Marge sur la pire médiane mesurée |
|---|---|---|
| `categories:performance` | ≥ 0,90 | 0,94 |
| `largest-contentful-paint` | ≤ 3 500 ms | 1,40× |
| `first-contentful-paint` | ≤ 2 500 ms | 1,79× |
| `total-blocking-time` | ≤ 1 200 ms (déploiement) · 1 600 ms (repli local) | médianes ≤ 30 ms |
| `cumulative-layout-shift` | **un budget PAR ROUTE** (0,01 → 0,06 selon la page) | pire médiane mesurée : 0,0450 (`/dashboard`, `/payment`, `/profile`) |

Deux points que ces chiffres imposent :

- **le TBT d'un runner partagé est bimodal** (0-30 ms la plupart du temps,
  jusqu'à 2 878 ms sur un run, pour la même page et le même commit). Le plafond
  de 1 200 ms est donc au-dessus du bruit, pas au-dessus d'un objectif de
  performance : avec `numberOfRuns: 2` et l'agrégation `optimistic` (minimum) qui
  prévalaient, une seule mesure décidait du sort du job. Le passage à
  **3 runs + médiane** est ce qui rend le budget interprétable.
- **le CLS de /jobs était un défaut réel** : 0,1353 le 16/09/2026, identique
  sur les 3 runs, au-dessus du seuil Lighthouse de 0,1. Le plafond global avait
  été relevé à 0,15 en conséquence, ce qui rendait /jobs tolérant à presque
  n'importe quoi. **Il n'apparaît plus** : 0,0000 sur les 27 runs du 17-18/09, et
  son budget est désormais 0,01 — l'état d'alors ne passerait plus.

**Ajout du 17/09/2026 — `/register` et `/forgot-password` dans le collect :** les
deux pages d'auth publiques dont les PR #19 (wrapper `Register` en `min-h-full`,
CLS 0,0165 → 0,0081 au probe 1280×4000) et #20 (`ForgotPasswordSkeleton`
calibré, CLS 0,0012 → 0,0000 au probe 412×823) ont corrigé la stabilité de mise
en page ne figuraient dans **aucune** URL auditée. Les ajouter ne suffisait pas :
elles recevaient le plafond commun (0,15), donc la régression exacte que ces deux
PR ont corrigée (≈ 0,016) y passait encore sans être vue.

**Correctif du 18/09/2026 — un budget CLS PAR ROUTE (`assertMatrix`) :** le
plafond global est remplacé par une table **mesurée** — 10 routes, valeurs lues
dans les rapports Lighthouse réellement archivés (artifacts `lighthouse-reports`
de 9 jobs de `main` et 8 jobs de PR, 3 runs par page, agrégation par médiane) :

| Route | Valeurs CLS par run (runs) | Budget |
|---|---|---|
| `/` | 0,0000 (27 prod + 24 repli local) | 0,01 |
| `/register` | 0,0088 (27) | **0,015** |
| `/forgot-password` | 0,0000 (27) | 0,01 |
| `/login` | 0,0000 (17), 0,1762 (1, non reproduit) | 0,02 |
| `/how-it-works`, `/support` | 0,0000 (18) | 0,01 |
| `/jobs` | 0,0000 (27) | 0,01 |
| `/dashboard`, `/payment`, `/profile` | 0,0450 (18-27) | 0,06 |

`/register` est le point de la passe : à 0,015, la valeur 0,0165 d'avant #19
**échoue**, à 1,7× au-dessus de sa mesure stable. Les trois marges (1,7× sur
`/register`, 1,33× sur les trois pages à 0,0450, un cran au-dessus des zéros
pour `/login` à cause de son run isolé) sont écrites dans
`frontend/scripts/lhci-cls-budgets.cjs`, avec les compteurs de runs.

Trois propriétés sont tenues par des tests plutôt que par la relecture :

- `assertMatrix` est **exclusif** d'`assertions`/`aggregationMethod` dans
  `@lhci/utils` ; l'agrégation par médiane est donc portée par chaque entrée, et
  un retour du plafond global dans `lighthouserc.cjs` est refusé ;
- chaque page auditée a **son** entrée, et le socle (sans motif) ne porte aucun
  budget CLS — sinon les deux se cumuleraient et le plus large gagnerait ;
- une page auditée **sans budget mesuré** fait échouer le **chargement** de la
  config : elle serait sinon mesurée sans plafond, c'est-à-dire le trou que la
  passe ferme.

Preuves rejouées sur les 30 rapports **réels** du dernier run de `main`
(`KOJO_LHCI_BASE_URL=https://kojoforafrica.cc.cd npx lhci assert`, `.lighthouseci/`
reconstruit depuis l'artifact `lighthouse-reports`) :

```
30 mesures intactes                  → « All results processed! »  (10 URLs)  exit 0
/register porté à 0,05 sur 2 runs/3  → « expected: <=0.015  found: 0.05 »     exit 1
  (le MÊME jeu de mesures sous l'ancien plafond 0,15 : « All results processed » exit 0)
page auditée sans budget mesuré      → la config LÈVE en la nommant           exit 1
```

La variable est nécessaire pour rejouer ces lignes : sans `KOJO_LHCI_BASE_URL`,
lhci retombe sur le repli local (l'accueil seul), donc la matrice ne couvre qu'une
page.

Un TBT 40× au-dessus de la médiane ou un LCP doublé passent encore au vert :
la détection d'une régression *relative* exigerait un serveur LHCI, absent. Le
garde attrape un **effondrement**, sauf sur le CLS où il attrape désormais la
régression fine de chaque page.

### F2bis — Lighthouse n'auditait qu'UNE page, à cause d'un nom de variable

`@lhci/cli` configure yargs avec `.env('LHCI')` : toute variable d'environnement
`LHCI_<x>` est relue par le CLI comme l'option `--<x>`. Le job exportait
`LHCI_URL` pour indiquer la base à auditer, et `lighthouserc.cjs` construisait un
tableau d'URLs (une par page) — mais `LHCI_URL` devenait l'option `--url` du
collecteur, qui **écrase** ce tableau. Tous les runs affichaient « Checking assertions against
1 URL(s) » : les pages `/dashboard`, `/jobs` et `/profile` n'ont jamais été
auditées, leurs budgets ne mesuraient rien, et les faux-verts correspondants
n'étaient pas visibles dans les logs.

Corrigé par le renommage `KOJO_LHCI_BASE_URL` / `KOJO_LHCI_AUTH_HEADER` (hors du
motif capturé par yargs), un garde qui interdit toute variable `LHCI_*` dans la
configuration et dans le workflow
(`frontend/scripts/__tests__/check-lhci-env.test.js`), et la première mesure
réelle des pages auditées (tableau F6). Les budgets CLS par route ont leur propre
garde, `frontend/scripts/__tests__/lhci-cls-budgets.test.js`, qui demande ses
verdicts à `getAllAssertionResults` de `@lhci/utils` — le code que le job exécute
lui-même.

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

Ce step et le garde de `backend/tests/test_split_integrity.py` (pyflakes, même
catégorie) portaient deux périmètres qui ne coïncidaient pas : la liste du test
était recopiée à la main et en omettait **quatre** — `server.py`, le fichier dont
le `NameError` a atteint la production le 2026-08-27, et `kojo_routers_public.py`,
`kojo_routers_reviews.py`, `kojo_env_validators.py`. Le test DÉRIVE désormais son
périmètre (`kojo_*.py` + `server.py`, 21 modules) : il voit exactement ce que le
step voit, et un module ajouté entre dans le garde sans qu'on y pense. Sa capacité
à échouer, jusqu'ici supposée (la suite ne l'exerçait que sur des modules sains),
est démontrée par mutation sur une **copie** des modules réels :
`test_le_garde_echoue_quand_on_retire_un_import` copie les 21 modules, vérifie que
la copie intacte est propre, retire le premier import RÉELLEMENT UTILISÉ (l'usage
est vérifié avant le retrait, sinon la mutation ne prouverait rien) et exige le
message. Rejoué à la main le 18/09/2026 : retirer `import asyncio` de
`kojo_core.py` produit `undefined name 'asyncio'` (l. 433 et 437), et retirer
`from urllib.parse import urlparse` reproduit l'incident à l'identique —
`undefined name 'urlparse'` (l. 476).

### F8 — Aucun job ne vérifie le résultat du déploiement

`deploy-fly` s'arrête au succès de `flyctl deploy`. Rien ne sonde ensuite
`/api/health`, ni la version servie, ni qu'une machine est bien `started`. Un
déploiement qui démarre puis plante au boot est donc **vert**. La vérification
`/health` renvoyant la version (`1.0.2`) a été faite **à la main** lors de sa mise
en production — c'est précisément le maillon que la CI ne couvre pas.

### F9 — Les intégrations SEO/analytics n'existent qu'au build : un audit externe a rougi sur du code vert

Un audit SEO « sans JavaScript » a rendu le 17/09/2026 un rapport dont **dix
erreurs sur treize** décrivaient un état **déjà corrigé**. Mesure du HTML
réellement servi ce jour-là (`curl https://kojoforafrica.cc.cd/`,
`X-Vercel-Cache: HIT`, `Last-Modified: Thu, 17 Sep 2026 02:40:42 GMT`) :

| Ce que dit l'audit | Ce que sert la production |
|---|---|
| « Title too long (> 60 chars) » | `53` caractères |
| « Meta description too long (> 160 chars) » | `151` caractères |
| « No H1 heading » / « Heading structure issues » | **1** `h1` + **6** `h2` |
| « Only 19 words (need 300+) » | **405** mots |
| « No internal links found » | **20** liens internes |
| « No clickable contact links » | **2** `tel:` + **2** `mailto:` (WhatsApp et « Itinéraire » en plus) |
| « Soft 404 detected » | `/inconnue-xyz` → **404** + `noindex` |
| « No local business schema » | `LocalBusiness` complet (N.A.P. + `hasMap`) |
| « Address found, but phone not detected » | `+1 819 300 3507` en texte, en `tel:` et en `telephone` du schéma |
| « No embedded map » | carte Google en `iframe` lazy (`mapsEmbedUrl`) |
| « No GA or GTM found » | ❌ **absent — le point était réel** |
| « No social media links found » | ❌ **absent — `"sameAs": []`** |
| « No GSC verification meta tag » | ❌ **absent — la vraie limite** |

Ces dix lignes décrivent le HTML servi **avant le shell pré-rendu** (PR #27,
`aa5efd9`, 16/09/2026) : un crawler sans JavaScript n'y voyait que
`<div id="root">`. Empreinte mesurée le 17/09, sur `frontend/index.html` à
`aa5efd9^` (c'est exactement ce que la production servait, le shell étant
généré au build) comparé au build d'aujourd'hui :

| Mesure | Avant PR #27 | Aujourd'hui |
|---|---|---|
| `<title>` | **65** caractères (> 60) | 53 |
| meta description | **170** caractères (> 160) | 151 |
| `h1` | **0** | 1 |
| mots visibles | **19** (11 + les 8 du `<noscript>`) | 405 |
| liens `<a>` internes | **0** | 17 |
| `tel:` / `mailto:` | **0 / 0** | 2 / 2 |
| `LocalBusiness` | **absent** | présent |
| `#root` | vide | shell de l'accueil |

Le « 19 mots » du rapport est donc l'empreinte **exacte** de l'ancien HTML (il
comptait le `<noscript>`), et les deux longueurs signalées étaient réellement
hors bornes (65 > 60 et 170 > 160) : l'audit a mesuré un état d'avant correction,
pas le site actuel.

⚠️ **Piège de mesure, rencontré en écrivant cette ligne** : la description
contient une apostrophe (« en Côte d'Ivoire »). Un parseur qui accepte `"` OU `'`
comme fermeture de valeur tronque la valeur au premier apostrophe et annonce
« 104 caractères » là où il y en a 151 en ligne — la première version de ce
tableau a publié ce faux chiffre. Un parseur correct exige la MÊME citation pour
ouvrir et fermer ; c'est ce que fait `scripts/site-meta.js` (`metaContents()`), désormais seul
propriétaire de cette lecture — `check-home-shell.js` et
`check-seo-production.js` ne portent plus chacun leur motif — et c'est pourquoi
la CI était verte à juste titre. Les mesures ci-dessus ont été refaites avec ce parseur. Ces points sont verrouillés à chaque push depuis (shell de
l'accueil, 404 réels sans catch-all, etc.) — un rapport qui les réclame encore
vient d'un cache d'outil ou d'une copie antérieure au 16/09/2026, pas de la
production.

Les trois derniers, en revanche, étaient **réels** — et c'est le faux-vert :
`src/utils/analytics.js`, `VITE_GSC_VERIFICATION` et
`src/config/social-networks.json` existaient, étaient documentés dans le README,
et n'étaient vérifiés par **rien**. Le build de CI ne définit jamais ces
variables (y injecter un `G-0000000000` mettrait une balise tierce dans
l'artefact que Lighthouse audite et fausserait ses scores) : aucun test ne
pouvait donc distinguer « intégration configurée et injectée » de « intégration
silencieusement perdue ». Le seul signal restant était un audit externe, sur la
production. Deux maillons manquaient :

1. **`frontend/.env.example` ne mentionnait aucune de ces variables** — le
   fichier que la documentation dit de copier ne décrivait que `VITE_API_URL` et
   Sentry. L'intégration était implémentée mais introuvable pour qui configure le
   déploiement. C'est vraisemblablement la raison pour laquelle la production n'a
   jamais eu de balise GA ni de profil social.
2. **Aucun test de l'injection.** `scripts/__tests__/seo-extras-injection.test.js`
   pilote désormais le **vrai** plugin `inject-seo-extras` du **vrai**
   `vite.config.js` (importé, jamais recopié) avec un environnement fabriqué, et
   exige : balise `gtag/js?id=G-…` en `head`, meta `google-site-verification`,
   `sameAs` peuplé des **seuls** profils `https://` déclarés, HTML intact sans
   variable, refus d'un identifiant non `G-…`, et — le piège le plus sournois —
   les origines GA (`googletagmanager.com`, `google-analytics.com`, `region1`)
   **dans la CSP** dès que GA est activé, faute de quoi la balise serait servie
   mais les collectes bloquées sans erreur visible. Le fichier déclare
   `@vitest-environment node` (jsdom remplace `TextEncoder`/`Uint8Array` et casse
   esbuild, donc l'import de `vite.config.js`). Échec prouvé par mutation :
   `if (false)` sur le test du `G-…` → 1 test rouge.

**Diagnostic du 17/09/2026 (API Vercel)** : le projet `kj-update-fevrier` portait
**6 variables d'environnement** et aucune des quatre concernées —
`VITE_GA_MEASUREMENT_ID`, `VITE_GSC_VERIFICATION`, `VITE_PLAUSIBLE_DOMAIN` et les
six `VITE_SOCIAL_*` n'avaient **jamais été configurées**. L'écart n'était donc ni
un bug de build ni une variable marquée « Sensitive » : une configuration jamais
faite. À cette date, le projet ne portait qu'un seul domaine
(`kj-update-fevrier.vercel.app`, sous `vercel.app`) : la vérification Search
Console par enregistrement DNS TXT était hors de portée du propriétaire (il ne
contrôle pas `vercel.app`), la balise meta (`VITE_GSC_VERIFICATION`) étant la
SEULE voie.

**Domaine propre — 17/09/2026** : `kojoforafrica.cc.cd` (suffixe gratuit DNSHE
sous `cc.cd`) est désormais l'adresse publique du site. Vérifié AVANT de
brancher : `.ccd` n'existe pas dans la zone racine IANA, tandis que `cc.cd` est
publiquement délégué (`a/b.ns.dnshe.org`) **et listé dans la Public Suffix
List** (section DNSHE) — donc Google traite `kojoforafrica.cc.cd` comme un
domaine à part entière, et Vercel le classe en apex (`apexName` = le domaine,
renvoyé par l'API). La vérification Search Console par **DNS TXT** (propriété
Domaine) est donc redevenue possible, en plus de la balise meta.
Enregistrement `A 76.76.21.21` (valeur `recommendedIPv4` renvoyée par l'API
Vercel), et `kj-update-fevrier.vercel.app` **redirige** vers le domaine : une
seule adresse canonique, pour le crawl comme pour les partages.

Le domaine n'existe qu'à une seule place par surface — `index.html` (canonical,
OG, Twitter, JSON-LD), les gardes `check-prerender-shells.js` /
`check-og-images.js` / `check-seo-production.js` / `check-cors-preflight.js` et
le pré-rendu par route de `vite.config.js` (qui échouent ou sondent faux si le
build repart sur l'ancienne adresse, tous lisant `SITE_ORIGIN` de
`scripts/site-meta.js` — l'API qu'il appelle se lit dans le même module, sous
`API_ORIGIN`), `resolve-vercel-url.sh` (base Lighthouse de `main`), et côté backend
`DEFAULT_SITE_BASE` — le repli de `_site_base()`, qui construit le sitemap et
`robots.txt` — déjà pointé sur le domaine.

**Deux adresses publiques, désormais** (17/09/2026) : le site sur
`kojoforafrica.cc.cd`, et le backend sur `api.kojoforafrica.cc.cd`, qui remplace
`kojo-backend.fly.dev` partout où une URL est ANNONCÉE — callbacks IPN PayDunya
compris, puisque `build_payment_callback_url()` et `build_disburse_callback_url()`
les construisent à la création de chaque facture depuis `BACKEND_PUBLIC_URL` (rien
à configurer dans le dashboard PayDunya). L'ancien hôte n'est pas éteint pour
autant : il reste dans `TRUSTED_HOSTS` et continue de servir (applications
mobiles déjà installées, moniteurs, rollback), mais plus rien ne le cite — sauf
les bundles mobiles déjà construits, qu'un rebuild seul met à jour.

Ces deux bascules ont suivi le même ordre, et ce n'est pas un détail : changer
une valeur d'adresse dans `fly.toml` ne peut PAS se faire dans un PR isolé. Le
check REQUIS `fly-env-drift` compare la valeur déployée à celle du fichier et
refuse l'ordre inverse, et le déploiement Fly est déclenché par `main`. D'où
« déployer d'abord, commiter ensuite » : `flyctl deploy` depuis la branche, puis
le PR, qui passe alors au vert. Depuis la PR #41, la sonde publie le `canonical`
servi et l'hôte annoncé par le sitemap, donc une bascule à moitié faite se voit
dans le journal au lieu de se déduire d'une carte OG cassée.

**Fermé le 17/09/2026 (preuve à l'appui)** : les trois profils sociaux réels ont
été posés (`VITE_SOCIAL_INSTAGRAM`, `VITE_SOCIAL_FACEBOOK`, `VITE_SOCIAL_X`,
cibles `production,preview`, type standard et donc relisible) puis la production
redéployée. Vérifié sur le HTML servi : `"sameAs"` contient les trois URLs (donc
visible d'un crawler sans JavaScript) et le bundle porte les trois mêmes URLs
(liens du footer, rendus par React). La sonde est passée de `0/4` à `1/4`, avec
la ligne « Liens sociaux : PRÉSENT — 3 profil(s) dans le `sameAs`, 3 lien(s) dans
le HTML servi ». C'est la démonstration que la chaîne variable → build → HTML
servi → vérification fonctionne de bout en bout.

Le **bloc « Suivez-nous » du corps de page** (section contact du shell pré-rendu)
complète ces liens : un audit « Social Media Links » lit le corps de page, et un
`sameAs` en JSON-LD ne lui suffit pas. Il est alimenté par le **même tableau** que
le footer React (`src/config/social-networks.json` + `VITE_SOCIAL_*`) — impossible
de publier deux jeux de profils. La sonde dit désormais les deux mesures et nomme
le faux vert : `AUCUN lien social dans le HTML brut` quand le `sameAs` est rempli
mais qu'aucune ancre ne suit dans le HTML servi.
`VITE_SOCIAL_TIKTOK`, `LINKEDIN` et `YOUTUBE` restent volontairement vides :
`contact.js` n'affiche aucun profil inventé.

**Ce qui reste, et qui n'est pas dans le dépôt** : deux valeurs, et elles seules
— `VITE_GA_MEASUREMENT_ID` et `VITE_GSC_VERIFICATION`. Elles se posent dans
Vercel → Project Settings → Environment Variables, et exigent un redéploiement
(les `VITE_*` sont inlinées au build). Les marquer « Sensitive » est inutile —
mesuré : `VITE_GOOGLE_CLIENT_ID`, déclarée `type=sensitive`, apparaît en clair
dans `/assets/index-*.js` de la production, la valeur n'étant « décryptable que
pendant les déploiements » (doc Vercel) ; ce que ça coûte, c'est de ne plus
pouvoir la RELIRE pour vérifier. Les VALEURS, elles, viennent d'un compte Google
(une propriété GA4, un jeton Search Console) : aucune commande ne peut les
inventer. En revanche `frontend/scripts/setup-seo-env.js` fait en une fois les
trois gestes qu'on oublie dans l'ordre — pose des deux variables (`production` ET
`preview`, en `upsert`, donc rejouable), redéploiement de production, puis
relecture du HTML servi par la sonde ci-dessus, avec **échec** si les deux balises
n'y sont pas. Il tourne **depuis la CI**, sans jeton local : le workflow
`.github/workflows/seo-vercel-env.yml` est **manuel** (`workflow_dispatch`) et lit
les valeurs dans des **secrets de dépôt** :

| Secret | Contenu |
|---|---|
| `VERCEL_TOKEN` | jeton Vercel ayant accès au projet (`Settings → Tokens`) |
| `KOJO_GA_MEASUREMENT_ID` | identifiant de flux GA4, de la forme `G-…` |
| `KOJO_GSC_VERIFICATION` | contenu de la balise `google-site-verification` |

Bouton « Run workflow » sur **SEO Vercel env (manual)** : le job pose les deux
variables (`production` ET `preview`, en `upsert`), redéploie la production,
attend `READY`, relit le HTML servi et **échoue** si les deux balises n'y sont
pas. Trois raisons à cette forme : aucun push ni PR ne peut déclencher une
écriture sur la production Vercel (fichier `dispatch`-only, séparé de `ci.yml`,
dont le bouton déploie le backend Fly), et les VALEURS ne sont jamais des entrées
de dispatch — une entrée est publiée dans les logs du run, un secret ne l'est
pas. Un secret absent fait échouer le job **avant toute écriture** (« Il manque
une valeur — rien n'a été écrit », code 2) : une variable vide posée sur Vercel
remplacerait la configuration en place par du vide.

Le même script reste lançable à la main, pour un diagnostic :

```bash
KOJO_GA_MEASUREMENT_ID=G-… KOJO_GSC_VERIFICATION=… VERCEL_TOKEN=vcp_… \
  node frontend/scripts/setup-seo-env.js
# … --dry-run : lectures seules (projet, variables déjà posées, charges utiles)
```

Tant qu'elles manquent, l'audit restera rouge sur l'analytics et la vérification
Search Console, quel que soit l'état du code.

**Ce que la CI en dit désormais** : `scripts/check-seo-production.js` lit l'accueil
réellement servi et publie une annotation `::notice` par intégration (présente /
absente + la variable à poser), **sur `main` uniquement** et **sans jamais faire
échouer le job** — l'absence de configuration est un fait d'exploitation, pas une
régression de code. Il refuse de conclure sur une base locale (les variables sont
absentes par construction).

La même sonde publie deux notices de plus sur l'ADRESSE : le `canonical` servi par
l'accueil et l'hôte annoncé par le `/sitemap.xml`, tous deux confrontés à
`SITE_ORIGIN` (`scripts/site-meta.js`). C'est la leçon de la migration du
17/09/2026, où le HTML et le sitemap ont annoncé deux adresses différentes pendant
des heures — le sitemap est servi par le backend Fly, dont le déploiement est
indépendant de celui du frontend. Un écart est donc nommé (`ÉCART : l'origine
attendue est …`) au lieu de se déduire d'une carte OG cassée, et sans bloquer
davantage.

Rejouer la mesure, sur la production comme sur un build local :

```bash
# la production sert-elle les balises ?
curl -sS https://kojoforafrica.cc.cd/ | grep -c googletagmanager   # 0 = non configuré
curl -sS https://kojoforafrica.cc.cd/ | grep -o '"sameAs": \[[^]]*\]'

# l'injection fonctionne-t-elle quand les variables sont posées ?
cd frontend
VITE_GA_MEASUREMENT_ID=G-TEST123456 VITE_GSC_VERIFICATION=jeton \
VITE_SOCIAL_FACEBOOK=https://facebook.com/kojo-test npx vite build
grep -c googletagmanager build/index.html   # 2 (balise + CSP relâchée)
```

### F10 — Le contrat `/jobs/:id` n'était vérifié qu'en HTTP, et jamais contre l'application — **fermé le 18/09/2026**

Une fiche mission n'a pas de coquille pré-rendue à comparer : son HTML est produit
par le backend **à la requête**. Son titre et sa carte n'étaient donc vérifiés
qu'en HTTP (`check-og-images.js`, qui l'écrivait lui-même : « leur carte est
vérifiée en HTTP »), contre un serveur debout et une mission réellement créée en
base. Deux trous, pas un :

- **jamais hors ligne** — donc jamais sur les runs dont la cible est protégée, et
  jamais avant un déploiement ;
- **jamais contre l'APPLICATION** — le garde HTTP lisait le HTML du backend, et
  rien ne comparait ce dernier à ce que `src/pages/JobDetails.js` annonce au
  runtime. Un titre renommé d'un seul côté passait : l'onglet du navigateur et la
  carte de partage ne disaient plus la même chose, tous les voyants verts.

**Le contrat est maintenant vérifié hors ligne, sur une mission de référence**
(`scripts/check-job-og-contract.js`, step « Check job OG contract » du job
frontend). Il exécute les deux implémentations :

```
pré-rendu    python -c "import kojo_job_og" …… → le HTML réel du backend
             (backend/kojo_job_og.py : module SANS dépendance — ni FastAPI, ni
             MongoDB, ni kojo_settings — donc importable avec le python3 du
             runner ; c'est ce qui fixe sa frontière)
application  src/utils/jobSeo.js              → le titre, la description et la
             carte de la MÊME mission (la fonction que JobDetails utilise)
```

Puis l'égalité est exigée sur le titre (`<title>`, `og:title`, `twitter:title`),
la description (les quatre balises, coupe à 150 caractères + « … » comprise), la
carte (`og:image` wide **et** carrée, `twitter:image`) — la carrée étant dérivée
de la carte de l'APPLICATION, pour qu'un renommage d'un seul côté fasse échouer
les deux assertions — et l'URL de la page, `canonical` et `og:url` (F11).

Deux points de méthode que l'exécution a imposés :

- **Python écrit dans l'encodage de la locale** (cp1252 sous Windows), pas en
  UTF-8 : sans `PYTHONIOENCODING=utf-8`, le tiret cadratin et le « … » du
  pré-rendu revenaient en caractères de remplacement et le garde accusait le
  backend d'un écart de texte qui n'existait pas. Constaté au premier essai.
- **les entités HTML sont décodées** avant comparaison (`&amp;`, `&apos;`…, les
  cinq qu'écrit `escape_xml`) : comparer la valeur brute ferait échouer le garde
  sur du texte correct, et pousserait à retirer l'échappement du HTML pour faire
  passer le test.

**Preuves** : le dépôt est vert (`runJobOgContractCheck` → 0 erreur, mission
réelle) ; les mutations sont exercées par `scripts/__tests__/check-job-og-contract.test.js`
(11 tests) sur le HTML du **module de production** — titre renommé d'un côté,
carte renommée, variante carrée retirée, description coupée d'un caractère de
plus, canonical divergent ou absent, mission sans annonce côté application —, et
un interpréteur absent est une
**erreur en CI** (::notice hors CI, un poste sans Python ne devant pas voir rouge
pour cette seule raison).

### F11 — Le `canonical` d'une fiche mission restait figé sur la fiche précédente — **fermé le 18/09/2026**

`usePageTitle` posait le canonical **au montage** (`useEffect(…, [])`) en lisant
`window.location.pathname`. Cela suffit pour les routes statiques — changer de
route remonte le composant. `/jobs/:id` est la seule route DYNAMIQUE : passer à
une autre fiche ne remonte rien (seul le paramètre change), donc le
`<link rel="canonical">` restait posé sur la **première** fiche ouverte.
Conséquence : Google consolide la fiche réellement consultée vers une autre
adresse, c'est-à-dire fait sortir de l'index celle que le visiteur vient de voir.
Invisible partout ailleurs : titre, description, carte et `og:url` suivaient, eux,
le rendu courant.

Le chemin canonique vient désormais du rendu courant : `src/utils/jobSeo.js`
l'expose (`canonicalPath` — la même URL que celle du pré-rendu, à côté du titre, de
la description et de la carte, tous dérivés du même identifiant), `JobDetails.js`
le passe au hook, et `usePageOpenGraph` reçoit la même valeur pour `og:url` (laissée
au défaut, elle était relue à chaque rejeu d'effet — donc juste tant que le titre
changeait d'une mission à l'autre). Le garde hors ligne de F10 compare maintenant
les deux balises au HTML du pré-rendu.

**Preuves** : `src/utils/__tests__/usePageMeta.test.jsx` rend la fiche sur
`/jobs/<A>` puis la `rerender` sur `/jobs/<B>` **sans démontage** — le canonical
doit suivre ; sous la version d'avant (canonical posé au montage), ce test échoue
(`expected …/jobs/aaaa1111… to be …/jobs/dddd6666…`) et passe après restauration à
l'octet. Côté garde : la balise `canonical` du **module de production** pointée sur
une autre fiche fait échouer le contrat (`exit 1`, écart nommé), restauration
vérifiée par `cmp` ; les mutations pures (chemin applicatif changé, `canonical`
absent, `og:url` absente) sont dans `scripts/__tests__/check-job-og-contract.test.js`.

### F12 — « Une page de route annonce ses métadonnées » n'était refusé qu'APRÈS le build — **fermé le 18/09/2026**

Les six règles de `scripts/check-page-meta.js` étaient jouées par la CI **après**
`vite build`. C'est leur place pour ce qui compare des artefacts (D, E, F : les
coquilles écrites), mais les trois premières ne lisent que les sources —
`src/App.js`, la table `src/config/page-meta.js` et les pages. Rien ne justifiait
donc de les découvrir si tard, et deux conséquences se payaient :

- le bundle était **produit** pour une page qui n'annonce rien (`vite build` en
  0), et c'est ce bundle qui partait en pré-déploiement Vercel dès la poussée de
  la branche — la CI rougissait en parallèle, pas avant ;
- sur un poste, l'oubli ne se voyait qu'en lançant les gardes à la main.

Le build les joue maintenant lui-même : `assertPagesAnnounceTheirMeta()` est
appelée par le `buildStart` du plugin `require-page-meta` (`vite.config.js`,
`apply: 'build'`), donc `npm run build` échoue **avant d'écrire le premier octet**.
`apply: 'build'` est vérifié, pas supposé : le plugin est ABSENT de la résolution
en mode `serve` et présent en mode `build` — l'itération n'est pas arrêtée par un
garde de publication. La CI continue de tout rejouer, coquilles comprises ; les
règles A/B/C sont extraites dans une seule fonction, appelée par les deux chemins,
donc elles ne peuvent pas diverger.

**Preuves** : `src/pages/Support.js` privé de son `usePageMeta()` → `npm run build`
en **1** :

```
error during build:
[require-page-meta] métadonnées de page : 1 problème(s), le build refuse de produire un bundle …
  - la page src/pages/Support.js n’appelle pas usePageMeta() : au runtime la route « /support » annonce AUCUN texte …
✓ 0 modules transformed.
```

restauré à l'octet (`cmp`), le build repasse en 0. Côté tests,
`scripts/__tests__/check-page-meta.test.js` prouve le refus sur les cas réels —
page qui n'annonce rien, page qui déclare son texte elle-même, plusieurs
violations nommées d'un coup — et qu'**aucun artefact n'est requis** : l'arbre de
test est joué sans `build/`, exactement ce que la CI ne pouvait pas faire.

**Ce refus n'est plus prouvé à la main** (18/09/2026). Il tenait à une mutation
faite une fois — muter une page, lancer le build, lire l'échec, restaurer — qui ne
survit à aucun commit : retirer `requirePageMeta()` du tableau `plugins` de
`vite.config.js`, ou le passer en `apply: 'serve'`, rendait le refus inopérant sans
qu'aucun test ne rougisse. Le plugin est donc extrait du `vite.config.js` dans le
garde lui-même (`requirePageMeta` — **une seule définition**), et deux fichiers le
portent :

- `scripts/__tests__/check-page-meta.test.js` exige que
  `requirePageMeta({ root }).buildStart()` **lève** sur une arborescence dont la
  page n'annonce rien, et sur une dont la traduction de page manque ;
- `scripts/__tests__/check-page-meta-build-wiring.test.js` (2 tests, environnement
  **Node** — il importe la vraie config, donc esbuild) exige que le
  `vite.config.js` RÉEL installe ce plugin, en `apply: 'build'`, et refuse une
  copie locale du plugin dans la config.

Trois mutations, chacune restaurée à l'empreinte SHA-1 identique : plugin retiré
du tableau `plugins` → le fichier de branchement rougit ; `apply: 'serve'` dans le
CODE → idem ; `buildStart` qui n'appelle plus la règle → le fichier de capacité
rougit. Supprimer le refus ne peut plus laisser la CI verte.

### F13 — Une route ni publique ni privée passait en silence — **fermé le 18/09/2026**

`check-spa-routes.js` tenait sa liste de routes privées **écrite à la main**
(`PRIVATE_ROUTES` : `/dashboard`, `/messages`, …) et n'en vérifiait que
l'intersection avec `src/App.js`. Une page ajoutée à l'application et oubliée
dans cette liste n'appartenait donc à **aucun** des deux ensembles : servie par
`app.html` — le gabarit nu, dont la coquille porte
`<meta name="robots" content="index, follow">` — sans `X-Robots-Tag`, donc
indexable sous le titre neutre « Kojo » et vide de contenu. Rien ne le disait.

**Mesuré avant le correctif** : une route `/nouvelle-page` ajoutée à
`src/App.js` et routée vers `/app.html` (les deux formes) laissait le garde en
`exit 0` — `✅ Routage verrouillé … 19 routes React de production routées`.

La liste **dérive** maintenant du routage (`privateRoutesOf(routes, rewrites)`) :
est publique une route dont les textes sont déclarés dans
`src/config/page-meta.js` (le build lui écrit sa coquille) **ou** qu'un rewrite
envoie au **backend**, qui la pré-rend (la fiche `/jobs/:id`) ; privée, tout le
reste — c'est-à-dire servie par `app.html`, donc tenue au noindex. Ajouter une
page oblige désormais à **choisir**, et le message nomme les deux issues.

**Preuves** (sur le dépôt réel, chaque fichier restauré à l'octet et vérifié par
`cmp`) :

```
/nouvelle-page dans App.js, servie par /app.html, aucun en-tête
  → exit 1 : « la route « /nouvelle-page » n'est déclarée NI publique NI privée … Choisir : déclarer
    ses textes dans src/config/page-meta.js …, ou ajouter « X-Robots-Tag: noindex, follow » … »

la même page avec ses textes dans src/config/page-meta.js (donc PUBLIQUE)
  → exit 1, mais sur l'autre branche : « « /nouvelle-page » est servie par « /app.html » au lieu de
    « /nouvelle-page.html » » — plus aucune demande de noindex

la liste dérivée sur le dépôt réel
  → /dashboard /messages /profile /create-job /photo-debug /email-verification
    /payment-verification /commission-dashboard /support-admin
    ← identique, dans l'ordre, aux neuf routes qui étaient recopiées à la main
```

Trois mutations rejouées sur `check-spa-routes.js` (restauré à l'octet, `cmp`) :
dérivation neutralisée → **5 tests rouges** ; exclusion du noindex « `/(.*)` »
retirée → le test qui l'exige rougit ; et la page ni déclarée ni privée du dépôt
réel, qui passait en `exit 0`, tombe en `exit 1`. Le noindex doit **viser** la
route : un motif qui la capture (`/dashboard/(.*)` pour `/dashboard/:onglet`)
suffit, mais `/(.*)` ne compte pas — il couvre la racine, donc tout le site, et
désindexerait les pages publiques au lieu de protéger celle-là.

### F14 — Une traduction de page manquante restait invisible au build — **fermé le 18/09/2026**

`src/config/page-meta.js` déclare, par route, un titre et une description en clés
i18n, et cinq dictionnaires les publient (`fr/en/wo/bm/mos`). Rien ne vérifiait
qu'une de ces clés existe dans les cinq **au moment du build** :

- la règle D de `check-page-meta.js` ne lisait que `src/i18n/fr.json` ;
- `i18nParity.test.js` compare les dictionnaires **entre eux**, et
  `i18nCoverage.test.js` les clés appelées par le code — ni l'un ni l'autre ne
  connaît la table des pages ;
- surtout, ces deux tests importent les cinq fichiers **par leur nom** : une
  sixième langue ajoutée à `LanguageContext.js` et à `src/i18n/` n'entre dans le
  périmètre d'aucun test du dépôt.

Conséquence : le bundle (et le pré-déploiement Vercel qui le suit) partait avec,
pour les utilisateurs d'une langue, le texte français de repli — sans qu'aucun
artefact ne le dise. La règle **G** ferme les trois cas, dans la fonction que le
BUILD joue déjà (`buildStart` du plugin `require-page-meta`, §3 F12) :

- chaque clé de page existe, **non vide**, dans chaque langue publiée ;
- la liste des langues est **lue** dans `src/contexts/LanguageContext.js` — jamais
  recopiée, donc une langue ajoutée là est vérifiée sans que ce fichier bouge ;
- une langue publiée sans dictionnaire lisible est une erreur, et un dictionnaire
  que personne ne charge aussi (sinon une langue branchée nulle part passerait
  pour vérifiée) ;
- une liste de langues illisible est une ERREUR, pas un périmètre vide.

**Preuves** — deux mutations sur le dépôt réel, chacune restaurée à l'octet
(`git diff --exit-code` sur le fichier, vide) :

```
wo.json : supportMetaDescription retirée
  → npm run build en 1 (41 ms, « ✓ 0 modules transformed » : rien n'a été écrit)
    [require-page-meta] src/i18n/wo.json : la clé « supportMetaDescription » (description de la
    route « /support ») est absente — l'app publierait pour cette langue le texte français de repli…

bm.json : loginMetaTitle mise à la chaîne vide
  → npm run build en 1 : « … (titre de la route « /login ») est vide … »

restaurés → npm run build en 0
```

Côté garde CI, `node scripts/check-page-meta.js` rend désormais les langues
vérifiées dans son verdict (`… et leurs textes existent dans les 5 langues
publiées (fr, en, wo, bm, mos)`), et les tests passent de 33 à **41** (+2 dans le
fichier de branchement, §3 F12) : refus
d'une clé absente du français, d'une clé absente d'une SEULE langue, d'une
traduction vide, d'une langue publiée sans dictionnaire, d'un dictionnaire non
chargé, d'une liste illisible — plus le cas qui prouve la **dérivation** (une
langue ajoutée à `LanguageContext.js` est vérifiée sans que le garde change).

## 4. Gardes jamais prouvés

Le job `audit-regression-test` prouve que 4 contrôles savent échouer
(`audit_docstrings.py`, `audit_api_returns.cjs`, `py_compile`, `pyflakes`). Les
autres gardes doivent leur crédibilité à leurs tests Vitest, qui injectent une
régression et exigent l'échec — c'est équivalent, à une exception près :

| Garde | Prouvé qu'il peut échouer par |
|---|---|
| `audit_docstrings.py`, `audit_api_returns.cjs`, `py_compile`, `pyflakes` | méta-test CI (`audit-regression-test`) |
| `check-api-split.js`, `check-bundle-size.js`, `check-generated-icons.js`, `check-home-shell.js`, `check-spa-routes.js`, `check-og-assets.js`, `check-og-images.js`, `check-og-job-200.js`, `check-pwa-manifest.js`, `check-pack2-chunks.js` (via `pack2-size.test.js`), `check-script-deps.js`, `validate-vercel-json.mjs`, `check-og-reproducible.js` (via `check-og-assets.test.js`), `check-cors-preflight.js` | tests Vitest dédiés |
| `check-job-og-contract.js` | `scripts/__tests__/check-job-og-contract.test.js` — comparaison PURE prouvée capable d'échouer sur 7 mutations du HTML du module de production (titre, carte, variante carrée absente, découpe de description, canonical divergent, canonical absent, annonce applicative vide), et l'absence d'interpréteur Python est un échec en CI sur un dépôt sans `backend/kojo_job_og.py` |
| `check-workflow-pins.py` | `backend/tests/test_ci_workflow_pins.py` (classement des références + workflow réel) |
| `check-test-existence-assertions.py` | `backend/tests/test_existence_assertion_guard.py` (cas refusés ET acceptés, périmètre vide refusé, `::error` + code 1, câblage dans `workflow-lint`) |
| `check-page-meta.js` | `scripts/__tests__/check-page-meta.test.js` (41 tests : les 7 règles savent échouer — dont un build PÉRIMÉ, une table vide, une carte large sans variante carrée, une clé de page absente d'une seule langue, une langue publiée sans dictionnaire et un dictionnaire que personne ne charge —, leurs exemptions, dépôt réel vert) **et** le plugin de build lui-même, `requirePageMeta` : monté sur une arborescence dont la page est muette (`buildStart` doit lever) + `scripts/__tests__/check-page-meta-build-wiring.test.js` (2 tests, environnement Node : le `vite.config.js` RÉEL installe le plugin en `apply: 'build'`, et la config ne le réécrit pas) — mutations automatisées le 18/09/2026 sur les trois maillons (plugin retiré, `apply: 'serve'`, `buildStart` sans appel → la suite rougit) + mutations rejouées à la main : carte dédiée ajoutée, carte incomplète, page privée de son `usePageMeta()` (§3 F12), et deux mutations de dictionnaire (§3 F14) → `npm run build` en **1** à chaque fois, tout restauré à l'octet |
| `deriveRoutes` — la dérivation route → carte de `check-og-images.js` (exécutée au CHARGEMENT, donc `vite build` avec elle) | test qui refuse une carte dédiée hors des pages du projet + mutation rejouée le 18/09/2026 (carte ajoutée au seul manifeste) : **`npm run build` en 1** et les **trois** gardes qui dérivent la table en 1 avant d'avoir rien vérifié |
| la classification publique/privée des routes (`privateRoutesOf` de `check-spa-routes.js`) | `scripts/__tests__/check-spa-routes.test.js` (33 tests : dérivation textes/backend/privé, page ni déclarée ni privée refusée, noindex qui doit viser la route) + mutations rejouées le 18/09/2026 (dérivation neutralisée → 5 tests rouges, exclusion du noindex `/(.*)` retirée → rouge) et le dépôt réel : une page non déclarée passe d'`exit 0` à `exit 1` (§3 F13) |
| la correspondance route → fichier de coquille (`shellFileFor` de `scripts/site-meta.js`, appelée par le build et les gardes) | `scripts/__tests__/site-meta.test.js` — refuse une source qui la recalcule (périmètre non vide exigé, la reproduction est nommée `fichier:ligne`) et exige un fichier DISTINCT par page de la table ; **six copies** remplacées (le build qui écrit, `check-page-meta`, `check-prerender-shells`, `PRERENDERED_PAGES` désormais dérivée, le routage attendu de `check-spa-routes`, la fixture du test) + mutation rejouée le 18/09/2026 (copie valide réintroduite dans un garde → test rouge, restaurée à l'octet) et build rejoué : les **10 coquilles émises identiques à l'octet** |
| `inject-seo-extras` / `inject-production-csp` (plugins de `vite.config.js`, pas des gardes) | `scripts/__tests__/seo-extras-injection.test.js` — échec prouvé par mutation le 17/09/2026 (cf. F9) |
| **`check-prerender-shells.js`** | **rien** |

`check-prerender-shells.js` est référencé **uniquement** par `ci.yml` : pas de
fichier `check-prerender-shells.test.js`, aucune fixture, aucune entrée dans le
méta-test. Autrement dit, rien dans le dépôt ne démontre qu'il sait échouer. S'il
devenait aveugle (mauvaise condition, chemin d'artefact modifié par une montée de
version de Vite), la CI resterait verte sans que personne ne le voie — c'est le
seul garde dans ce cas, et c'est la première chose à corriger si l'on veut que
« les gardes sont testés » soit une affirmation vraie sans exception.

À côté de ces gardes, un test d'IMPORT-SANTÉ remplace les assertions
d'existence qui s'étaient dispersées (« ce fichier est-il sur le disque ? ») :
`backend/tests/test_import_health.py` importe tous les modules backend et les
scripts de `.github/scripts/`, `frontend/scripts/__tests__/import-health.test.js`
importe tout module que le frontend importe — les points d'entrée qui
s'exécutent à l'import (`process.exit`, rendu dans `#root`, pipeline esbuild)
sont écartés par la règle elle-même. Les deux portent leur preuve de non-vacuité
(un module cassé, ou un module disparu, fait rougir le garde en nommant la cause),
vérifiée par mutation le 18/09/2026 — frontend : `src/App.js` et
`src/services/api.js` ; backend : `.github/scripts/check-exec-bits.py`.

Depuis le 18/09/2026, les deux **publient leur verdict en annotation de PR**, comme
la sonde SEO : un `::notice` pour le périmètre et le nombre de modules importés, un
second pour ce qui n'a **PAS** été couvert (fichiers de tests et `node_modules`
/ site-packages écartés, et la liste des fichiers que RIEN n'importe — 27 des 141
fichiers du périmètre frontend), et un `::error` **par module cassé**. Les
annotations sont émises AVANT l'assertion, donc un garde rouge nomme le module et
l'erreur réelle dans l'onglet Checks, pas seulement dans le journal brut.

Côté frontend, les lignes sortent d'elles-mêmes : le rédacteur de vitest affiche
le `console.log` d'un test qui passe. Côté backend, pytest **capture** le `print`
des tests — sans quoi les annotations n'existeraient ni en vert ni en rouge — donc
le job `backend-tests` a un pas dédié
(`pytest tests/test_import_health.py --capture=tee-sys`) qui recopie la sortie
capturée dans le journal du job, celui que GitHub lit. Il ne demande ni MongoDB ni
secret, et dure deux secondes ; le fichier continue de tourner dans la suite
complète, où il garde son rôle de test.

Deux canaux publient les métadonnées d'une page — `og:image`, `<title>`, `meta
description` — : le HTML **pré-rendu** (écrit par `vite.config.js`, vérifié en HTTP
par `check-og-images.js`) et le **runtime** (les pages, après montage, via
`src/utils/seo.js`). Chacun les déclarait de son côté — `/login` un chemin de
carte dans `src/pages/Login.js`, et une table de titres EN FRANÇAIS EN DUR dans
`vite.config.js` alors que la page lisait `src/i18n/fr.json` — sans qu'aucun test
ne relie les deux : changer un texte ou une image d'un seul côté ne cassait rien,
et un crawler (HTML pré-rendu) aurait annoncé autre chose qu'un navigateur (page
exécutée). Pire : `/register`, `/forgot-password` et `/payment` portaient un titre
dans leur coquille et AUCUN au runtime — après une navigation interne, l'onglet
gardait le titre de la page précédente.

Les tables uniques vivent dans `src/config/` — sans dépendance, donc lisibles par
le build ET par le bundle (même arrangement que `src/config/contact.js`) :
`page-meta.js` (route → clés i18n du titre et de la description, 8 routes),
`og-cards.js` (route → cartes wide/carrée) et `route-path.js` (normalisation d'un
chemin, partagée par les deux).

Quelles pages ont un VISUEL DÉDIÉ n'est plus une liste écrite à la main : elle se
DÉDUIT des cartes présentes. `public/og-<page>.png` + sa variante carrée
`og-<page>-square.png` — le nom du fichier EST la déclaration, lu par le build, par
le runtime et par le garde (manifeste du générateur, le même fichier que
`check-og-assets.js` confronte aux PNG par empreinte SHA-256). Deux listes vivaient
auparavant ici et dans le générateur : une carte ajoutée dans `public/` restait
annoncée par personne, et le commit de la carte seule passait pour un succès.

Le GESTE d'ajout est purement déclaratif depuis le 18/09/2026 : **un fichier de
données par carte** (`scripts/og-cards/<carte>.json` — le contenu, et les DEUX
sorties qu'il produit), puis le générateur, qui découvre le dossier. Le slug d'une
carte, son accroche et ses lignes ne sont plus dans `gen-og-images.py` : aucun
`.py` ni `.js` ne bouge pour ajouter une carte. Mesuré en sortant le contenu des
trois cartes existantes du générateur : les **7 PNG sont restés identiques OCTET
POUR OCTET** (`git status public/` vide) — le contenu a changé de place, pas les
images. Et l'ajout lui-même est couvert par un test qui ne dépose qu'un fichier
JSON : `og-support.png` entre dans le périmètre du garde sans qu'aucune ligne de
code ne soit touchée.

Sortir le texte du générateur lui retire la protection de son empreinte (elle ne
couvre que du code) : le manifeste porte donc une seconde empreinte,
`cards_sha256`, recette identique octet pour octet des deux côtés (nom de fichier +
LF + contenu normalisé en LF, fichiers triés). Sans elle, changer une accroche sans
relancer le script laisserait des PNG périmés derrière un manifeste « frais ». Deux
tests la tiennent : un texte modifié seul fait rougir, un fichier en CRLF reste vert
(`check-og-assets.test.js`), et l'accord Python ↔ JavaScript est prouvé sur le
dépôt réel — le manifeste versionné est écrit par Python, l'empreinte recalculée en
JavaScript doit lui être égale.

Le revers de cette déduction est traité au même endroit : une carte dédiée dont le
slug ne correspond à AUCUNE page du projet (`lighthouserc.cjs`, `DEPLOYMENT_PATHS`)
fait ÉCHOUER la dérivation elle-même, donc `vite build` — pas seulement un test.
C'est un PNG livré que le build perdrait en silence (le slug mal orthographié est
le cas réaliste) ; le seul indice serait « la page reçoit la carte générique », ce
qui est le comportement normal de toutes les autres pages. Prouvé le 18/09/2026 en
ajoutant `og-produits.png` + sa variante au manifeste seul : `npm run build` est
sorti en 1 avec le slug nommé, et les trois gardes qui dérivent la table
(`check-og-images`, `check-prerender-shells`, `check-page-meta`) ont refusé de
tourner sur cet état avant d'avoir rien vérifié. Limite assumée : `paths === null`
(config illisible) n'est pas jugé là — il n'y a alors aucune liste à confronter, et
c'est `runOgImageCheck` qui en fait une erreur explicite.

`scripts/check-page-meta.js` (job frontend, après
le build) impose sept règles, chacune capable d'échouer :

1. aucune déclaration hors table — ni chemin de carte ni clé i18n de
   `page-meta.js` écrit en dur dans `src/` ;
2. une page qui sert une route de la table n'appelle pas les hooks bas niveau
   (`usePageTitle` / `usePageOpenGraph`) : elle passe par `usePageMeta()` ;
3. chaque route de la table a une page qui annonce son texte — le routage est LU
   dans `src/App.js`, jamais recopié (deux listes qui se comparent, c'est l'écart
   qui se répare au lieu de disparaître) ;
4. chaque coquille de `build/` annonce EXACTEMENT le titre, la description, les
   variantes `og:`/`twitter:`/`name=title` ET la carte de la table (résolus dans
   `fr.json`, la langue des coquilles) ;
5. zéro coquille comparée est une ERREUR — jamais un vert quand rien n'a été lu ;
6. une carte dédiée PRÉSENTE est complète et utilisée : une carte large sans sa
   variante carrée, ou une carte pour une page du projet **qui n'est pas
   pré-rendue** (`/dashboard` : auditée, mais servie par le gabarit nu — le cas
   « absente des pages du projet » n'arrive jamais jusqu'ici, il arrête la
   dérivation), est une erreur — sinon la page retomberait sans bruit sur la carte
   générique, c'est-à-dire exactement l'oubli que la déduction doit rendre
   impossible ;
7. chaque clé de texte de page existe, non vide, dans **chaque langue publiée** —
   la liste de ces langues est LUE dans `src/contexts/LanguageContext.js`, jamais
   recopiée, une langue publiée sans dictionnaire lisible est une erreur comme un
   dictionnaire que personne ne charge, et une liste illisible est refusée plutôt
   que lue comme vide (§3 F14).

Les règles 1, 2, 3 et 7 ne lisent que les sources : le BUILD les joue déjà
(`buildStart` du plugin `require-page-meta`), la CI les rejoue avec les règles 4,
5 et 6, qui ont besoin des coquilles écrites.

Les routes servies par le gabarit nu (`/dashboard`, `/profile` — noindex) sont
NOMMÉES en notice plutôt que passées sous silence. Les fiches `/jobs/:id`, dont le
texte vient de la MISSION (il n'existe pas avant la requête), n'ont pas de table à
confronter : elles ont leur propre garde, hors ligne et sur une mission de
référence — `scripts/check-job-og-contract.js`, décrit plus bas — que
`scripts/check-og-images.js` complète en HTTP contre le déploiement réel.

Le seul garde d'existence qui gardait autre chose qu'un module — la liste
d'exceptions `OG_READ_ONLY_SCRIPTS` de `check-og-assets.js` — a été SUPPRIMÉ
plutôt que testé : **mesuré**, aucun de ses trois membres ne déclenche les deux
étages du détecteur (le contenu exige d'ÉCRIRE une image ET de viser une carte
OG, ce qu'un checker ne fait jamais). La liste n'avait donc aucun effet, et le
test qui l'accompagnait ne vérifiait que l'existence de ses entrées.

Pour que le nettoyage ne se reperde pas, `.github/scripts/check-test-existence-assertions.py`
(job `workflow-lint`) refuse une assertion qui ne porte QUE sur l'existence d'un
export : `callable(...)`, `<chemin> is not None` ou `<chemin>` comme condition
entière, `expect(<chemin>).toBeDefined()`. La règle est ÉTROITE à dessein — le
sujet doit être un nom IMPORTÉ par le fichier de test — donc
`assert payload["job_id"] is not None` et `expect(country.nameFrench).toBeDefined()`
restent permis : ils portent sur une VALEUR produite par le test. Les cinq
assertions restantes ont été remplacées au même moment :
`test_shared_helpers_importable` (trois `callable(...)`) supprimé au profit du
test d'import-santé, et le câblage du sweeper de décaissements vérifié par ce que
`server.py` DÉMARRE réellement (`asyncio.create_task(...)`) au lieu de l'existence
de la fonction.

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
- Les intégrations SEO/analytics du build ne peuvent plus se perdre en silence :
  `seo-extras-injection.test.js` exige la balise GA4 dans le HTML statique, la
  meta Search Console, le `sameAs` peuplé des seuls profils `https://`, et les
  origines GA dans la CSP dès que GA est configuré (cf. F9). **Ce que la CI ne
  peut pas vérifier, c'est que les valeurs existent sur Vercel** : le test
  prouve le mécanisme, pas la configuration du déploiement (cf. §7).
- Le build Vite aboutit avec `VITE_API_URL` de production.
- Shells de pré-rendu présents dans **chaque** page pré-rendue (`jobs.html`,
  `login.html`, `register.html`, `forgot-password.html`, `payment.html`,
  `how-it-works.html`, `support.html` — h1, contenu, liens internes et
  modulepreload du chunk de la route) ; `#root` porte le shell de l'accueil dans
  `index.html` et reste **vide** dans `app.html`, le gabarit neutre des routes
  clientes (sans h1, sans canonical, sans JSON-LD).
- **Une description par page** (`check-home-shell.js`) : chaque page pré-rendue
  publie sa propre meta description (≤ 160 caractères). Le plugin de pré-rendu
  ne réécrivait que les méta Open Graph — les sept pages servaient donc la
  description de l'accueil, et la route déclarait la sienne dans `og:description`
  seulement. Une description identique sur deux pages échoue désormais en CI.
- Découpage `pack2PageI18n` toujours par scope (pas de chunk partagé ≥ 3
  dictionnaires).
- Les groupes d'endpoints *lazy* restent hors du chunk d'entrée.
- Routage complet (`check-spa-routes.js`) : rewrite de la fiche `/jobs/:id` vers
  la route OG déclarée par le backend, même backend que le proxy `/api`,
  sitemap/robots proxifiés, **chaque route de production de `src/App.js`**
  déclarée dans ses deux formes (`/route` et `/route/`), aucun catch-all (une
  URL inconnue doit répondre **404**, pas 200) et aucune règle exacte masquée
  par un motif placé avant. Contrôle supplémentaire : **chaque route est servie
  par le bon gabarit** — sa page pré-rendue si elle en a une, `app.html` sinon,
  et jamais `index.html` (qui porte le contenu de l'accueil) ; `app.html` doit
  rester nu (pas de `<h1>`, pas de canonical, pas de JSON-LD, `#root` vide) et
  toute page `.html` émise par le build doit correspondre à une route de la table
  des textes (`src/config/page-meta.js`) — c'est LÀ qu'une page se déclare, et la
  liste des pages pré-rendues du garde en **DÉRIVE** au lieu d'être recopiée :
  une route ajoutée à la table change le gabarit attendu sans qu'aucune autre
  liste soit à mettre à jour. Enfin, les routes privées (tout ce qui n'est ni
  déclaré dans cette table ni pré-rendu par le backend : `/dashboard`,
  `/profile`, `/messages`, `/support-admin`…) portent `X-Robots-Tag: noindex` :
  un tableau de bord indexé est une page vide dans les résultats. Cette liste-là
  aussi **DÉRIVE du routage** — ajouter une page oblige à choisir entre publique
  et privée, et le garde refuse l'entre-deux (§3 F13).
- Page d'accueil pré-rendue (`check-home-shell.js`) : un h1 unique reprenant
  `heroTitle`, `title` ≤ 60 et description ≤ 160, ≥ 300 mots, des liens
  internes, `tel:`/`mailto:`/WhatsApp, le N.A.P. identique à
  `src/config/contact.json`, les pays de `CountryDisplay.js`, un `LocalBusiness`
  et une carte intégrée en lazy, **chaque classe Tailwind du shell présente dans
  le CSS du build**, des descriptions **uniques** sur les pages pré-rendues, et
  l'absence du shell d'accueil dans les autres pages (et inversement).
  Ce sont exactement les critères d'un audit SEO « sans JavaScript » sur
  l'accueil — vérifiés à chaque push plutôt qu'à la main.
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
- Les quatre intégrations SEO/analytics configurées par variables
  d'environnement (GA4, Search Console, Plausible, profils sociaux) sont sondées
  sur le **HTML de production**, sur `main` uniquement
  (`scripts/check-seo-production.js`) : une annotation `::notice` par
  intégration, avec la variable à poser quand elle manque. Pour les réseaux
  sociaux, elle lit le `sameAs` **et** les liens réellement présents dans le HTML
  servi : un profil déclaré que seul le JSON-LD porte n'est pas dit « présent »
  sans réserve. La même sonde confronte
  le `canonical` servi et l'hôte du `/sitemap.xml` à l'origine attendue, donc une
  migration de domaine à moitié faite est nommée dans le journal. Aucun échec,
  jamais — une configuration incomplète est un fait d'exploitation, pas une
  régression. Cf. F9.
- L'**authentification du domaine pour l'email** (SPF, DKIM, DMARC) est
  vérifiée sur un message RÉELLEMENT reçu, sur `main` uniquement
  (`.github/scripts/check-email-auth.py`, job `fly-env-drift`) : un OTP part par
  l'API de production vers un alias Gmail dédié, et la sonde lit
  l'`Authentication-Results` que Gmail pose à la réception. Elle publie en plus
  la phrase d'**alignement** — enveloppe SPF (`Return-Path`) et `d=` de la
  signature comparés au domaine du `From:`, jamais supposés. C'est le point que
  les verdicts seuls cachent : un `spf=pass` posé sur le domaine de Brevo ne
  compte pas pour DMARC. Mesuré le 18/09/2026 sur un message livré : enveloppe
  `gw.d.sender-sib.com` ≠ `kojoforafrica.cc.cd`, donc DMARC passe par DKIM seul.
  La variable de dépôt `KOJO_REQUIRE_SPF_ALIGNMENT=1` transforme cette exigence
  en échec — à poser quand le sous-domaine brandé de Brevo est en place (cf.
  `backend/DEPLOY_FLYIO.md`), le gain est alors verrouillé sans toucher au code. Une boîte jetable ne
  convient pas — elle n'écrit aucun verdict (mesuré sur mail.tm), et recalculer
  DKIM sur la copie reçue est impossible puisque le récepteur réécrit le corps.
  Sans les secrets `KOJO_PROBE_IMAP_*`, la sonde publie une `::notice` et sort
  en 0 (elle dit qu'elle n'a PAS vérifié) ; avec eux, un verdict non `pass`
  fait rougir le job.
- La **paire CORS** que le navigateur exige — origine canonique du site
  (`SITE_ORIGIN`) ↔ API inlinée par le build (`API_ORIGIN`), toutes deux lues
  dans `scripts/site-meta.js` — est MESURÉE sur la production, sur `main`
  uniquement (`scripts/check-cors-preflight.js`, job `lighthouse-ci`) :
  préflight `OPTIONS` réel puis `GET` crédité, avec l'en-tête que le client
  envoie. Contrairement à la sonde SEO ci-dessus, l'échec est **bruyant** :
  cette paire est un invariant, pas une configuration facultative. Le 18/09/2026
  la bascule du frontend sur `kojoforafrica.cc.cd` l'a cassée sans aucun journal
  serveur (Starlette refuse le préflight AVANT les routes) — les seuls témoins
  étaient les consoles des visiteurs. Un préflight non autorisé, un
  `allow-origin: *` sur une requête créditée ou un préflight sans
  `allow-credentials: true` font donc rougir le job ; une API injoignable aussi,
  avec un diagnostic distinct (« impossible de conclure » vs « origine NON
  autorisée »).

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
| Gmail IMAP (`imap.gmail.com`) + API de production | `fly-env-drift`, sonde email (main only) | Rouge si la boîte est injoignable ou si un verdict n'est pas `pass` (volontaire : une vérification qui ne peut pas s'exécuter doit se voir). **Sans** les secrets `KOJO_PROBE_IMAP_*`, la sonde s'annule en publiant une `::notice` — elle ne sort jamais verte sans avoir rien lu |
| API GitHub (commentaires de PR) | `resolve-vercel-url.sh` | **Bascule silencieuse en F2** (repli build local), borné par `--max-time 20 --retry 2` |
| Vercel (preview + Deployment Protection) | idem | **F2** également : preview protégée ⇒ repli local |
| Backend de production (`api.kojoforafrica.cc.cd`) | `ci-auth`, `check-og-images`, `check-og-job-200`, `check-cors-preflight` (main only) | Rouge (le login du compte CI échoue ; pour la garde CORS : origine refusée, ou API injoignable après 6 tentatives espacées de 15 s) |
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
8. **La configuration SEO/analytics de la production est OBSERVÉE, pas
   imposée** (F9) : `scripts/check-seo-production.js` lit l'accueil réellement
   servi sur `main` et publie une `::notice` par intégration absente. L'écart
   n'est donc plus invisible — mais il ne bloque toujours rien : une variable
   oubliée sur Vercel reste un rouge d'audit externe, pas un rouge de CI.
   En faire un garde demanderait d'ajouter un mode d'échec au script : il a été
   volontairement écarté (la demande était de ne pas faire échouer la CI).
   Deux autres limites : seule l'accueil est sondée en HTML (les autres pages du
   sitemap et leur `canonical` ne le sont pas — la sonde lit en revanche le
   `/sitemap.xml` lui-même, pour l'hôte qu'il annonce), et un `Age` de cache non
   nul n'est pas détecté — le
   HTML est servi en `must-revalidate`, donc l'edge revalide, mais la sonde ne
   le PROUVE pas (mesuré : `HIT` + `Age: 1` avec et sans `cache-control`).
9. **La garde CORS ne tourne que sur `main`** : elle mesure la paire
   DÉPLOYÉE (origine du site ↔ API), donc une PR de migration de domaine n'est
   pas arrêtée avant fusion — la bascule peut casser la production, et c'est le
   run de `main` qui le dit ensuite (en rouge, pas en `::notice`). L'ordre qui
   évite la panne reste : backend (`FRONTEND_APP_URL` / `CORS_ORIGINS`) d'abord,
   frontend ensuite. Les réessais de la sonde (6 × 15 s) absorbent la fenêtre du
   déploiement Fly, qui tourne dans le même run.

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
