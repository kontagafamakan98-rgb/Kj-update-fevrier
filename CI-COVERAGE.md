# Couverture réelle de la CI — ce qui est vérifié à chaque push

> Audit du 16/09/2026. Source de vérité : `.github/workflows/ci.yml` (10 jobs,
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
| `push` sur `main` | **oui**, 10 jobs |
| `pull_request` vers `main` | **oui**, 10 jobs (dont `deploy-fly` *skipped*) |
| `workflow_dispatch` (manuel) | **oui** ; `deploy-fly` déploie même sans changement backend |
| `push` sur une branche de travail | **non** — aucun run n'est déclenché |

Conséquence directe : « à chaque push » signifie en réalité **à chaque push sur
`main` et à chaque PR vers `main`**. Une branche de travail peut accumuler
plusieurs commits entre deux validations ; le premier signal vient de la PR.

## 2. Les 10 jobs, et ce qui les fait réellement échouer

| Job (nom affiché) | Échoue réellement sur | Peut réussir sans rien vérifier |
|---|---|---|
| **Audits détectent les régressions** | 4 contrôles injectés qui doivent sortir en échec : `audit_docstrings.py`, `audit_api_returns.cjs`, `py_compile`, `pyflakes`. C'est un **méta-test** : si un garde devient aveugle, ce job rougit. | Non — c'est le job le mieux conçu du lot. Mais il ne couvre que **4** contrôles, sur la vingtaine que le workflow exécute : les autres doivent leur crédibilité à leurs propres tests (§4). |
| **Workflow lint (actionlint + shellcheck)** | YAML/expressions de `ci.yml` invalides ; shellcheck sur `.github/scripts/*.sh` et `backend/scripts/*.sh` (les deux globs résolvent : `resolve-vercel-url.sh`, `loadtest_real_flow.sh`). | Non. Seul `rhysd/actionlint` est **épinglé** (`v1.7.12`). |
| **Fly env doc-prod (drift + secrets)** | Formats des références du dépôt (`--refs-only`, sans réseau) ; drift `fly.toml` ↔ runtime ; secret obligatoire manquant ; doublon `[env]`↔secret ; secret orphelin ; clé `.env.example` absente de Fly. **Token absent → `exit 2` → job rouge** (échec bruyant, pas de saut). | Partiellement : les formats des **secrets déployés** (via `flyctl ssh`) et le snapshot de digests sont silencieusement inopérants (§3, F4). |
| **Backend tests (Python + MongoDB)** | `pytest` complet contre un **vrai** MongoDB (`mongo:7` en service container), `py_compile`, `audit_docstrings.py` strict, et le garde des durées publiées (`check-privacy-policy.py`, §3 F18). | Partiellement : Redis et `TrustedHostMiddleware` sont désactivés dans ce job (§3, F7). |
| **Frontend tests + build (Node/Vite)** | `vitest run`, `audit_api_returns.cjs` strict, `vite build` — **qui refuse déjà une page de route publique sans métadonnées** (plugin `require-page-meta`, §3 F12), donc avant même d'écrire un artefact —, puis **9 gardes sur les artefacts** (shells de pré-rendu, routage SPA, shell d'accueil/SEO, descriptions par page, split pack2, split `services/api`, cartes OG, famille d'icônes, manifeste PWA, budgets de bundle). | Non, sur son périmètre. Aucun seuil de couverture : supprimer des tests reste vert (§7). |
| **Bundle size report (PR comment)** | Presque rien : c'est un **rapport**, pas un garde. Il échoue si le build est introuvable ou si le commentaire ne peut pas être publié. | **Oui, par conception** — il ne vise pas à bloquer quoi que ce soit (job **non requis**). Le garde de taille, lui, reste `check-bundle-size.js` dans `frontend-build`. |
| **Lighthouse performance budgets** | Assertions LHCI (`error`) sur **13 pages**, `check-og-images.js` et le **cycle `/jobs/:id` en HTTP**, les trois sur une pile locale « forme production » (§3, F3) ; sondes de production (`check-seo-production.js`, `check-cors-preflight.js`) sur `main`. | **Oui, sur le périmètre performance** : la surface auditée est un artefact servi par le job (ni CDN, ni cache d'edge — §3, F2ter), budgets calés sur des mesures réelles, portés **par route** (§3, F6). Le cycle `/jobs/:id` et les pages auth, eux, sont désormais mesurés/vérifiés sur chaque PR. Le gate ne vérifie **pas** la latence de l'API : sur `/jobs`, dont le LCP est le moment où la réponse de `GET /api/jobs` est connue, le LCP et le score ne sont plus assertés. Les requêtes qui décidaient du verdict sont traitées selon ce qu'elles font au peintre : la géolocalisation (qui retardait un peintre de `/login`) est bloquée pendant le collect, et le tag GA4 — qui occupait le chemin critique — a d'abord été **déplacé après `load`** côté produit, puis **retiré** du blocage (F6, « Ce que le gate vérifie réellement »). |
| **Mobile build (Capacitor + Android)** | Contrôle des bits exécutables (`check-exec-bits.py`, premier step, 0,17 s), `cap sync android`, `gradlew assembleDebug` (Java 21, SDK 36). | Sur `sdkmanager --licenses` et la preuve finale : le job prouve que **ça compile**, pas que ça fonctionne, et ne publie aucun artefact (§3, F5). |
| **Deploy backend to Fly.io** | `flyctl deploy --remote-only` (si un changement `backend/**` ou `ci.yml` est détecté), puis **vérification** que `/health` annonce la révision attendue (`check_deployed_revision.py`). | **Oui, sur le déploiement lui-même** : la politique — quand le job déploie, quelle révision est attendue quand il ne déploie pas, ce qui rougit — est écrite **en tête du job** dans `ci.yml`, seul endroit qui la définisse (§3 F1). |
| **Dépendances (avis de sécurité)** | Les avis **haut/critique** sur les dépendances de PRODUCTION du frontend (`npm audit --omit=dev`). | **Partiel, et le périmètre n'est écrit qu'une fois** : en tête du job `dependency-audit` de `ci.yml` (production frontend = gate ; paquets Python = avis CONSTATÉS, `::warning`). §7 point 7 y renvoie. |

## 3. Les faux-verts : réussir sans avoir prouvé

### F1 — `Deploy backend to Fly.io` vert sans aucun déploiement

`deploy-fly` est un **check requis** de la protection de branche : un push qui ne
touche que le frontend ou la documentation affiche donc `deploy-fly ✓` alors
qu'aucune machine Fly n'a été touchée — et c'est le cas le plus fréquent. Le ✓
était honnête (« rien à faire ») mais se lisait comme « le backend déployé
correspond à `main` ».

> Corollaire : `deploy-fly` ne dépend que de `backend-tests` (`needs:`). Un
> frontend ou un mobile rouge **ne bloque pas** le déploiement backend — c'est
> délibéré, et il faut le savoir avant de conclure qu'un `main` vert est cohérent.

**Ce que le job vérifie désormais, et OÙ c'est écrit.** La politique — les deux
cas du filtre, la révision attendue dans chacun, ce qui rougit — est **en tête du
job `deploy-fly` de `ci.yml`**, seul endroit qui la définisse : ce document y
renvoie au lieu de la recopier. Depuis le 20/09/2026 le job la VÉRIFIE au lieu de
la déclarer (le service publie la révision de son image, comparée au commit
attendu, y compris quand le déploiement a été sauté). Détail et limites : F8.

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
n'existe que sur le déploiement. Depuis le 20/09/2026, `main` n'audite plus le
déploiement du tout (voir F2ter) : le repli local décrit ici est devenu la SEULE
surface auditée, et il porte alors les 13 pages et non l'accueil seul.

C'est le faux-vert le plus insidieux du workflow : **le mode de défaillance le
plus probable (une API externe rate-limitée) est exactement celui qui dégrade
silencieusement la portée du contrôle.**

### F2ter — Le domaine de production refuse une rafale : la surface auditée est celle que le job contrôle (20/09/2026)

Deux runs de `main` sur un **arbre inchangé** (`c44a02b`, PR #112) sont tombés
rouges le 20/09/2026, tous les deux sur le seul job Lighthouse, tous les deux avec
la même erreur à une page DIFFÉRENTE de la matrice :

```
run 35530100391 (18:45) · /privacy     Run #1...failed!  (Status code: 403)
relance du même job   · /dashboard     Run #1...failed!  (Status code: 403)
```

Le code n'était pas en cause : le même arbre passait vert à 17:38 (`6c84c6e`,
9/9 jobs). La cause a été reproduite à la main depuis un poste, en rejouant le
profil du client Lighthouse (`HeadlessChrome/152`), contre le domaine public :

```
45 requêtes d'affilée sur /dashboard → 200 jusqu'à la 33e, puis 403 pour toutes les suivantes
403 : X-Vercel-Mitigated: challenge · X-Vercel-Challenge-Token: …
      corps = « Vercel Security Checkpoint »   (Cache-Control: private, no-store)
```

Ce n'est donc ni un tirage du runner ni une régression : l'edge Vercel oppose un
**défi de sécurité** à un client qui le sollicite en rafale depuis une IP de
datacenter, et le collect Lighthouse charge ~39 documents (13 pages × 3 runs)
plus les sous-ressources — il franchit ce seuil vers la fin de sa matrice. Un gate
qui rougit au hasard sur `main` apprend surtout à ignorer le rouge.

**Décision** : `main` n'audite plus le domaine de production
(`resolve-vercel-url.sh` n'y résout plus d'URL) ; le job monte sa pile et audite
celle-ci. Le repli n'est plus l'audit de l'accueil seul : la pile locale porte un
**drapeau** (`KOJO_LHCI_LOCAL_STACK=1`), le build est compilé avec l'API du
backend local, donc le jeton du compte CI provisionné authentifie réellement
`/dashboard`, `/profile` et `/payment` — les **13 pages** sont auditées, comme
avant, contre une surface que le job contrôle de bout en bout. Une adresse
loopback SANS ce drapeau reste le repli nu (accueil seul).

Ce que le gate vérifie désormais réellement : FCP, LCP, TBT, CLS par route et
score de l'**artefact**, servi par le serveur de rewrites local (qui rejoue
`vercel.json`) sous bridage Slow 4G + CPU 4×. Ce qu'il ne vérifie plus : le
comportement du **CDN** (cache d'edge, HTTP/2, TLS, latence réseau), qui n'était
déjà plus mesuré correctement — le runner mesurait la production par intermittence
et recevait un défi à la place des pages. Les sondes de production
(`check-seo-production.js`, `check-cors-preflight.js`, toutes deux sur `main`)
restent, elles, branchées sur le domaine réel et ne le sollicitent que quelques
fois — sous le seuil de la rafale.

Deux conséquences à connaître : un `main` vert ne dit plus rien de la performance
de la production (le dire demanderait un job qui mesure le CDN sans rafale — par
exemple un échantillon lent, une page par minute) ; et le job `lighthouse-ci`
paie désormais la préparation de la pile sur `main` comme il la payait déjà sur
les PR (pip install + provisioning MongoDB, ~1 min).

Preuve de la capacité du nouveau chemin : le drapeau et la règle de sélection des
pages sont verrouillés par `frontend/scripts/__tests__/check-lhci-env.test.js`
(11 tests), et le passage complet par la pile locale est celui qui tourne sur
chaque PR (mêmes steps, même config, mêmes 13 budgets).

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
  par `backend/tests/test_exec_bits.py` (19 tests mesurés le 19/09/2026, dont deux en sous-processus
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

Depuis le 20/09/2026, le socle ci-dessus est porté **par route** (il n'y a plus
d'entrée globale), et `/jobs` ne porte plus le LCP ni le score — ces deux
grandeurs y valent le moment où la réponse de `GET /api/jobs` est connue, pas un
choix de l'artefact ; la requête qui *retardait* le peintre de `/login` est, elle,
bloquée pendant le collect. Mesures et décision dans « Ce que le gate vérifie
réellement », plus bas. Les seuils des 12 autres pages sont **inchangés**.

Deux points que ces chiffres imposent :

- **le TBT d'un runner partagé est bimodal** (0-30 ms la plupart du temps,
  jusqu'à 2 878 ms sur un run, pour la même page et le même commit). Le plafond
  de 1 200 ms est donc au-dessus du bruit, pas au-dessus d'un objectif de
  performance : avec `numberOfRuns: 2` et une seule mesure, un run décidait du
  sort du job. Le passage à **3 runs** est ce qui rend le budget interprétable —
  mais 3 runs ne suffisent pas à choisir la statistique : voir « Correctif du
  20/09/2026 » plus bas, qui remplace la médiane sur le socle global.
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

Trois propriétés sont tenues par des tests plutôt que par la relecture :- `assertMatrix` est **exclusif** d'`assertions`/`aggregationMethod` dans
  `@lhci/utils` ; l'agrégation est donc portée par chaque entrée, et un retour du
  plafond global dans `lighthouserc.cjs` est refusé ;
- la statistique de chaque entrée est **verrouillée** : le socle agrège au
  meilleur des 3 runs, le CLS par route à la médiane (voir « Correctif du
  20/09/2026 »).
- **plus d'entrée globale** : chaque page auditée a **ses** entrées (socle +
  CLS), ce qui est le seul moyen d'attacher une exception à UNE page — une
  entrée sans motif l'imposait à toutes. Un test refuse une matrice qui
  contiendrait une entrée globale ;
- une page auditée **sans budget mesuré** fait échouer le **chargement** de la
  config : elle serait sinon mesurée sans plafond, c'est-à-dire le trou que la
  passe ferme.

#### Ce que le gate vérifie réellement (20/09/2026 : deux jobs rouges, deux causes)

Le 20/09/2026, `main` a rougi deux fois sur une SEULE route, avec deux causes
distinctes mais une racine commune — une grandeur de peinture décidée par une
réponse d'API. Relevé des **rapports réels** archivés (3 runs par page) :

| Job | Route | FCP | LCP des 3 runs | Élément LCP | Verdict d'alors |
|---|---|---|---|---|---|
| 12:29 | `/jobs` | 1 389 ms | 2 727 / 2 737 / 2 739 | la liste des missions | vert |
| 13:34 | `/jobs` | 988 ms | 4 256 / 4 359 / 4 468 | la liste (API ~2,6× plus lente) | **rouge** |
| 13:54 | `/login` | 1 028 ms | 3 836 / 3 781 / 3 912 | la ligne de contact du formulaire | **rouge** |

Sur `/jobs`, le FCP est même **meilleur** dans le job rouge : ni la machine ni le
build n'ont changé, c'est `GET /api/jobs` qui a répondu ~2,6× plus lentement. Sur
`/login`, la requête lente est nommée par les rapports :
`GET /api/geolocation/available-countries`. Deux traitements, selon ce que le
tiers fait au plus grand peintre :

- il **retarde** un peintre de l'artefact → la requête est **bloquée pendant le
  collect** (`blockedUrlPatterns`, appliqué par Lighthouse via CDP :
  `REQUETES_HORS_CONTROLE` dans `lhci-cls-budgets.cjs`). Mesuré sur le même
  build contre le serveur de rewrites local : `/login` **1 479 ms → 1 112 ms**,
  et 3 runs bloqués à 944 / 1 112 / 1 711 ms (score 0,99 / 1,00 / 1,00). Le
  troisième motif vient du job rouge de 14:31-14:38 : c'est le tag **GA4 posé le
  20/09 à 12:59** (`googletagmanager.com/gtag/js`, et son `/g/collect`) qui est
  alors la requête la plus lente de CHAQUE page (58 à 174 s de temps réseau
  simulé sous bridage 4G), pendant que le LCP de la coquille de `/login` passe
  de ~1,7 s à 4 261 / 4 343 / 4 266 ms. La même page servie en production vaut
  **1 239 ms** mesurée depuis un poste hors runner : le coût vient du chemin
  réseau du runner vers un tiers, pas de l'artefact. Le sujet PRODUIT a été
  traité le 20/09/2026 : le tag n'est plus `async` dans le `<head>`, il est
  **déclaré** dans le HTML (`data-kojo-ga-src`, donc toujours visible de la sonde
  SEO et d'un audit « no-JS ») et chargé **après `load`** par
  `src/utils/analytics.js`. Mesuré sur le build servi localement, bridage 4G
  simulé de Lighthouse, 3 runs sur l'accueil : LCP **12 005 / 1 603 /
  1 939 ms → 1 446 / 1 253 / 2 007 ms** — meilleur run **1 603 → 1 253 ms**,
  médiane **1 939 → 1 446 ms**, et le run à 12 s (score 0,54) disparaît. Le tag
  n'ayant plus de chemin critique, le **blocage de `googletagmanager` (et de son
  `/g/collect`) a été RETIRÉ** du collect le 20/09/2026 : le gate mesure
  désormais ce qu'un visiteur reçoit, tag compris. Rejoué avec le moteur
  d'assertion réel de lhci sur les rapports du tag différé (rien de bloqué) :
  **0 échec** sur les 3 runs de l'accueil (score 0,96 / 0,99 / 0,97 ; LCP 1 446 /
  1 253 / 2 007 ms ; TBT 120 / 127 / 144 ms pour un plafond de 1 600 ms sur le
  repli local) — et un test refuse qu'un motif GA revienne sans rouvrir la
  décision ;
- la réponse **EST** le peintre (`/jobs`) → bloquée ou non, le LCP reste le
  moment où la réponse est connue : **2 727 ms** avec la liste, **4 256 ms** avec
  l'état vide, **5 177 ms** avec la requête bloquée (les réessais avant l'état
  d'erreur). Ces deux grandeurs (LCP et le score, qui le pèse) ne sont donc pas
  assertées là (`LCP_PRODUIT_PAR_UNE_REPONSE` nomme la route et sa mesure) ;
  `/jobs` garde FCP, TBT et son plafond CLS.

**Aucun seuil n'est relevé** : les plafonds des 12 autres pages sont intacts
(0,9 · 3 500 ms · 2 500 ms · 1 200 ms / 1 600 ms, et le CLS par route). Une
entrée sans justification est refusée par un test, et un test exige que les
motifs de blocage ne nomment aucun hôte (le collect tourne sur la production,
sur une preview Vercel et sur le repli loopback).

Preuve rejouée hors ligne avec le **même** moteur (`getAllAssertionResults` de
`@lhci/utils`) sur les 39 rapports **réels** de chaque job :

```
job du 12:29 (vert)    config d'APRÈS  → vert          (aucune régression réintroduite)
job du 13:34 (/jobs)   config d'AVANT  → ROUGE : categories@/jobs, largest-contentful-paint@/jobs
                       config d'APRÈS  → vert          (l'exception couvre la cause mesurée)
LCP muté à 4 200 ms sur les 12 pages qui l'assertent → ROUGE, les 12 nommées
LCP muté à 4 200 ms sur /jobs SEUL                   → vert   (exception scopée)
```

Ce que le gate vérifie donc désormais : l'artefact — FCP, TBT, CLS par route,
score et LCP sur les 12 pages dont le plus grand peintre ne dépend pas d'une
réponse d'API, `/jobs` gardant FCP, TBT et CLS. Ce qu'il ne vérifie pas : la
latence de l'API (2,6× de variation entre deux jobs sur le même code, et une
route dont le peintre est cette réponse) — elle n'est pas une propriété du build,
et la mesurer depuis un runner partagé revenait à tirer à pile ou face sur
`main`. La PREUVE du blocage sur `/login` demande un run frais : les rapports du
13:54 ont été mesurés **sans** lui.

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

Un TBT 40× au-dessus du meilleur run ou un LCP au-dessus de 3 500 ms passent
encore au vert : la détection d'une régression *relative* exigerait un serveur
LHCI, absent. Le garde attrape un **effondrement**, sauf sur le CLS où il attrape
désormais la régression fine de chaque page — et, ce que ce correctif apporte, il
le fait avec un verdict **reproductible** : le même artefact donne le même
verdict.

### F6bis — Correctif du 20/09/2026 : le verdict du job ne dépend plus du tirage du runner

`main` a rougi le 20/09/2026 (run `35500653504`, arbre `14e0531`) sur la SEULE
assertion `categories:performance` de `/login` : médiane 0,79, runs `1,00 / 0,79
/ 0,77`. Le même arbre, huit minutes plus tôt, passait vert (run `35498834165`) —
et les budgets explicites (`FCP`, `LCP`, `TBT`, `CLS` par route) passaient dans
**les deux** jobs. Les 39 rapports des deux jobs, lus dans les artifacts
`lighthouse-reports` :

```
/login, 3 runs   score   FCP    LCP    TBT    Script Evaluation   plus longue tâche
job vert         0,99    1386   2361     23   174 ms             71 ms
job rouge        0,79    1400   1774    890   995 ms             908 ms   (run 3)
                 (run 1 : score 1,00, TBT 0 ms)
```

Mêmes octets, même page, et 5,7× de temps d'évaluation de script : c'est le runner
qui a faim, pas le code. Le score étant une moyenne pondérée où le TBT pèse 30 %,
cette famine le traverse — alors que le budget TBT, lui, restait à 74 % de son
plafond. Une médiane sur 3 runs ne peut pas distinguer « un run sur trois a
souffert » de « la page a régressé ».

**Ce qui a changé : la statistique, jamais un seuil.** Le socle global (score,
FCP, LCP, TBT) se compare désormais au **meilleur des 3 runs** — le bruit d'un
runner est *unilatéral*, il ne peut qu'ajouter du temps, donc le meilleur run
décrit le coût propre de l'artefact, quand une régression monte dans les trois.
Le **CLS par route reste à la médiane** : c'est une propriété du DOM et du CSS,
relevée identique d'un run à l'autre (0 / 0,009 / 0,045 selon la page), donc la
médiane y est à la fois la plus stricte et la plus stable. Aucun plafond n'a été
relevé.

Relevé de la nouvelle statistique sur les 2 jobs de `main` du 20/09/2026 (39 runs,
13 pages) — pire **meilleur-run** : score 0,97, FCP 1 380 ms, LCP 2 587 ms, TBT
10 ms, soit des marges de 1,35× à 120× sous les seuils.

Preuves rejouées hors ligne sur les rapports **réels** des deux jobs
(`.lighthouseci/` reconstruit depuis l'artifact, `KOJO_LHCI_BASE_URL` posée) :

```
config d'AVANT, rapports du run rouge   → « expected: >=0.9  found: 0.79 »   exit 1
config d'APRÈS, rapports du run rouge   → « All results processed! »          exit 0
config d'APRÈS, rapports du run vert    → « All results processed! »          exit 0
LCP de /login à 4 200 ms sur les 3 runs → « largest-contentful-paint »        exit 1
score de /login à 0,55 sur les 3 runs   → « categories.performance »          exit 1
CLS de /register à 0,03 sur les 3 runs  → « cumulative-layout-shift »         exit 1
(0,015 de budget : c'est la valeur que la régression #19 produisait)
TBT de /jobs à 3 000 ms sur les 3 runs  → « total-blocking-time »             exit 1
```

Témoin vert avant et après, rapports sources intacts à l'empreinte SHA-1, et le
verrou de la statistique est tenu par un test
(`scripts/__tests__/lhci-cls-budgets.test.js`) plutôt que par la relecture.

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

### F8 — Aucun job ne vérifie le résultat du déploiement — **fermé le 20/09/2026**

`deploy-fly` s'arrêtait au succès de `flyctl deploy` : rien ne sondait ensuite
`/health`, ni la version servie, ni la révision construite. Un déploiement sauté
(un push qui ne touche pas `backend/**`) et un déploiement réussi étaient donc
**indistinguables** — le ✓ ne disait pas laquelle des deux choses venait de se
produire.

**Ce qui est vérifié désormais** : le service RÉPOND quelle révision il exécute,
et la CI compare cette réponse au commit qu'elle aurait dû déployer.

- `backend/Dockerfile` reçoit `--build-arg KOJO_GIT_SHA=<sha>` (job `deploy-fly`)
et la promeut en variable d'environnement de l'image ; `/health` et `/api/health`
la publient dans le champ `revision` (`kojo_settings.APP_REVISION`). C'est une
propriété de l'IMAGE, pas du runtime : elle ne peut donc pas mentir sur ce qui a
été construit.
- `backend/scripts/check_deployed_revision.py` interroge le domaine servi et
compare. La révision **attendue** est le commit poussé quand le déploiement a eu
lieu, et sinon **le dernier commit qui a touché `backend/**` ou ce workflow** :
c'est l'état que le push laisse en place, et le job rougit si le service en est
resté à une révision plus ancienne (déploiement précédent échoué, par exemple).
Il attend jusqu'à ~3 min qu'un déploiement en cours se termine, puis refuse en
nommant **la révision servie et l'attendue** ; une réponse muette (« inconnue »,
c'est-à-dire une image construite sans la build-arg) et un service injoignable
sont deux autres refus, nommés séparément.
- Preuve d'échec rejouable : `backend/tests/test_deployed_revision.py` (21 cas,
`fetch` injecté, aucun réseau) et **deux** mutations du registre, chacune faisant
rougir le test propriétaire, nommé : `deployed-revision: revision differente
toleree` (neutraliser la comparaison) et `deployed-revision: console non utf-8
laissee planter le refus`.
- Le refus survit à une console qui n'est pas en UTF-8 : sur une console Windows
(cp1252) le « ≠ » du message levait `UnicodeEncodeError`, donc le garde mourait
**en traceback avant d'avoir nommé** quoi que ce soit — la CI, en UTF-8 partout,
ne voyait jamais ce chemin. Les flux sont donc rendus tolérants
(`reconfigure(errors="replace")`), et un test le prouve en lançant le garde avec
l'encodage du tube figé à `cp1252` chez l'enfant (cf. AGENTS.md).

Ce qui reste ouvert après ce correctif : la vérification porte sur la RÉVISION,
pas sur la santé applicative (une image du bon commit qui plante au boot répondrait
un 503 — refusé, mais sans dire pourquoi) ni sur les machines Fly (`started`).

### F9 — Les intégrations SEO/analytics n'existent qu'au build : un audit externe a rougi sur du code vert — **fermé le 20/09/2026**

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

| Mesure | Avant PR #27 | Aujourd'hui (pages de confiance livrées) |
|---|---|---|
| `<title>` | **65** caractères (> 60) | 53 |
| meta description | **170** caractères (> 160) | 151 |
| `h1` | **0** | 1 |
| mots visibles | **19** (11 + les 8 du `<noscript>`) | **520** |
| liens `<a>` internes | **0** | **22** |
| `tel:` / `mailto:` | **0 / 0** | 2 / 2 |
| `LocalBusiness` | **absent** | présent |
| `#root` | vide | shell de l'accueil |

La colonne d'aujourd'hui vient du garde lui-même
(`node scripts/check-home-shell.js` : « 1 h1, 520 mots, 22 liens internes ») et
non d'un comptage ad hoc : ce qui est publié ici est exactement ce que la CI
refuse de laisser régresser (plancher 500 mots).

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
   exige : déclaration `gtag/js?id=G-…` en `head` (`data-kojo-ga-src`, adresse
   dans le HTML servi, script NON exécuté au chargement), meta `google-site-verification`,
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
`API_ORIGIN`), et côté backend
`DEFAULT_SITE_BASE` — le repli de `_site_base()`, qui construit le sitemap — déjà
pointé sur le domaine. `robots.txt` n'est plus servi par le backend (voir §3 F13) :
il est écrit au BUILD, depuis `SITE_ORIGIN`, par `vite-plugins/write-robots-txt.js`.

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

**Deux valeurs hors dépôt, l'une et l'autre posées le 20/09/2026** —
`VITE_GA_MEASUREMENT_ID` et `VITE_GSC_VERIFICATION`. Elles se posent dans Vercel →
Project Settings → Environment Variables, et exigent un redéploiement (les
`VITE_*` sont inlinées au build) ; le workflow manuel fait les deux. Les marquer « Sensitive » est inutile —
mesuré : `VITE_GOOGLE_CLIENT_ID`, déclarée `type=sensitive`, apparaît en clair
dans `/assets/index-*.js` de la production, la valeur n'étant « décryptable que
pendant les déploiements » (doc Vercel) ; ce que ça coûte, c'est de ne plus
pouvoir la RELIRE pour vérifier. Les VALEURS, elles, viennent d'un compte Google
(une propriété GA4, un jeton Search Console) : aucune commande ne peut les
inventer. En revanche `frontend/scripts/setup-seo-env.js` fait en une fois les
trois gestes qu'on oublie dans l'ordre — pose des variables FOURNIES (`production`
ET `preview`, en `upsert`, donc rejouable), redéploiement de production, puis
relecture du HTML servi par la sonde ci-dessus, avec **échec** si une balise
fournie n'y est pas. L'unité d'écriture est la VARIABLE : une valeur non fournie
laisse les autres passer et se nomme (voir « Correctif du 20/09/2026 » plus bas). Il tourne **depuis la CI**, sans jeton local : le workflow
`.github/workflows/seo-vercel-env.yml` est **manuel** (`workflow_dispatch`) et lit
les valeurs dans des **secrets de dépôt** :

| Secret | Contenu |
|---|---|
| `VERCEL_TOKEN` | jeton Vercel ayant accès au projet (`Settings → Tokens`) |
| `KOJO_GA_MEASUREMENT_ID` | identifiant de flux GA4, de la forme `G-…` |
| `KOJO_GSC_VERIFICATION` | contenu de la balise `google-site-verification` |

Bouton « Run workflow » sur **SEO Vercel env (manual)** : le job pose les
variables FOURNIES (`production` ET `preview`, en `upsert`), redéploie la
production, attend `READY`, relit le HTML servi et **échoue** si une balise
fournie n'y est pas. Trois raisons à cette forme : aucun push ni PR ne peut
déclencher une écriture sur la production Vercel (fichier `dispatch`-only, séparé
de `ci.yml`, dont le bouton déploie le backend Fly), et les VALEURS ne sont jamais
des entrées de dispatch — une entrée est publiée dans les logs du run, un secret
ne l'est pas.

Les codes de sortie disent ce qui s'est réellement passé : **2** = rien n'a pu
être tenté (jeton absent, ou aucune valeur fournie), **1** = une valeur FOURNIE
n'a pas atterri (forme refusée, écriture refusée, déploiement en erreur, ou
absente du HTML après déploiement), **0** = tout ce qui était fourni est posé et
visible. Une variable absente n'est **jamais** écrite — une chaîne vide posée sur
Vercel remplacerait la configuration en place par du vide.

Le même script reste lançable à la main, pour un diagnostic :

```bash
KOJO_GA_MEASUREMENT_ID=G-… KOJO_GSC_VERIFICATION=… VERCEL_TOKEN=vcp_… \
  node frontend/scripts/setup-seo-env.js
# … --dry-run : lectures seules (projet, variables déjà posées, charges utiles)
```

**État du 20/09/2026, mesuré sur la production servie** : les deux balises sont
là. Relevé direct (`curl -sS https://kojoforafrica.cc.cd/`) :

```
googletagmanager                       → 2 occurrences (déclaration du tag + origine CSP relâchée)
google-site-verification content=…     → présent (yfa2PfX1…)
"sameAs"                               → 3 profils (facebook, instagram, x)
```

La sonde stricte le dit de son côté (run `35512336073`, job `106082298708`,
**success**) :

```
::notice  Google Analytics 4 : PRÉSENT — gtag/js?id=G-4HTDD40F4T
::notice  Search Console (balise meta) : PRÉSENT — jeton yfa2PfX1…
::notice  Plausible (facultatif) : ABSENT — … FACULTATIF : son absence ne fait pas échouer la sonde stricte.
::notice  Liens sociaux (sameAs du LocalBusiness) : PRÉSENT — 3 profil(s) dans le sameAs, 6 lien(s) dans le HTML servi
::notice  3/4 intégration(s) présente(s) sur https://kojoforafrica.cc.cd (dont 3/3 requise(s))
```

Plausible reste absent, et c'est FACULTATIF : son absence ne fait pas échouer la
sonde, seule une requise sans valeur le fait.

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

**Depuis le 20/09/2026, elle lit aussi CHAQUE page du sitemap, pas seulement
l'accueil** (« Pages — N/N page(s) du sitemap vérifiée(s) »). Chaque page doit
annoncer son `canonical`, son `<title>` et sa `description`, et le `canonical`
est confronté à la page ELLE-MÊME, pas seulement à l'origine : une route qui
annonce le `canonical` d'une autre a bien une adresse canonique, mais elle envoie
les crawlers ailleurs. Avant cette passe, le sitemap annonçait huit pages dont
sept n'étaient jamais lues — une page servie sans description restait
silencieuse. Les fiches `/jobs/:id` du sitemap sont ensuite **échantillonnées**
(`MAX_JOB_PAGES` = 3) et jugées sur les trois MÊMES métadonnées ; ce que
`check-og-job-200.js` possède déjà — la carte OG, ses variantes, le verrou 404
après suppression — n'est pas rejoué ici. Une fiche **disparue** entre la lecture
du sitemap et sa lecture (404) n'est PAS un défaut : une mission se clôture
normalement, la sonde le nomme sans juger. Le contrôle de page partage le sort du
reste : informatif sur les PR, **bloquant** sous `--strict` — une page du sitemap
non servie (404) est refusée comme une page muette, et une fiche servie en 200
sans description aussi.

── **Le silence, lui, était le vrai défaut — fermé le 19/09/2026** ─────────────
Cette sonde était **informative à dessein** (« une configuration incomplète est
un fait d'exploitation, pas une régression de code ») : elle publiait un
`::notice` par intégration absente et ne faisait **jamais** échouer le job. Le
résultat est mesurable : GA4 et la meta Search Console étaient absents de la
production, et **aucun run n'était rouge nulle part** — la CI verte ne disait
rien de ces deux intégrations. Un rapport qui ne peut pas échouer n'est pas une
vérification.

Deux pièces ferment cet écart, et **aucune ne fait de bruit sur une PR** :

| Pièce | Ce qu'elle fait | Quand |
|---|---|---|
| `check-seo-production.js --strict` | refuse chaque intégration **requise** absente (elle nomme la variable à poser) ; une **facultative** absente est publiée mais ne bloque pas ; refuse AUSSI de conclure quand la production est illisible — « rien de mesuré » n'est pas « rien de cassé » | à la demande |
| `.github/workflows/seo-production-probe.yml` | lance la sonde **stricte** sur la production, une fois par jour (`17 6 * * *`), sans secret (HTML public) | quotidien |

L'étape de `ci.yml` **reste informative** : un rouge sur chaque PR bloquerait des
fusions pour une variable que personne n'a encore obtenue. Ce qui change, c'est
que le silence n'est plus possible — un run rouge quotidien est un fait visible.

**Seules les REQUISES bloquent, et c'est mesuré, pas supposé.** Le premier run
réel de la sonde (`35476895792`, 19/09/2026, `workflow_dispatch`) échouait sur
**trois** intégrations dont Plausible — qui est un choix d'exploitation. Une
sonde qui reste rouge après la pose des valeurs requises est une sonde qu'on
apprend à ignorer : c'est le silence, par un autre chemin. La table des
intégrations porte donc `required` (GA4, Search Console et liens sociaux oui ;
Plausible non), le mode strict ne refuse que celles-là, et une facultative
absente reste publiée avec la mention `FACULTATIF : son absence ne fait pas
échouer la sonde stricte`. Deux tests tiennent la règle, et la mutation du script
réel les fait rougir **par leur nom**.

**Ce qui manquait, chiffré (19/09/2026, vérifié par l'API GitHub)** : le secret
`KOJO_GA_MEASUREMENT_ID` était **absent** des secrets du dépôt
(`KOJO_GSC_VERIFICATION` y était). Ses **deux** runs — `35370209109` (18/09) et
`35474512717` (19/09, lancé pour vérifier) — étaient en échec sur la même branche,
code 2 : la configuration d'alors exigeait les deux valeurs et refusait de partir
à moitié. Coût mesuré de ce couplage : la balise Search Console, **dont la valeur
existait depuis le 18/09**, n'a pas atteint la production avant le 20/09, faute de
GA4. C'est ce que le correctif du 20/09/2026 supprime (voir le paragraphe suivant),
et il a rapporté dans l'heure : le premier dispatch d'après (12:27) a posé la
balise Search Console **seule**, au lieu d'attendre GA4.

── **Correctif du 20/09/2026 : l'écriture est par variable** ───────────────────
Le tout-ou-rien protégeait une propriété réelle, mais **par variable** : ne
jamais écrire une valeur absente. Coupler deux intégrations indépendantes
n'ajoutait aucune sécurité — seulement un livrable bloqué par son voisin, ce qui
vient d'être observé pendant deux jours. Le script pose donc chaque variable
**fournie**, nomme en `::warning` chaque variable laissée de côté avec le secret à
poser, ne tire **jamais** une valeur absente, et n'échoue que sur ce qui était
fourni (codes ci-dessus). Ce qui reste vrai de l'esprit d'origine : rien n'est
tu — la sonde STRICTE quotidienne, elle, refuse toujours une intégration
**requise** manquante. Depuis le 20/09/2026 elle n'en trouve plus aucune (3/3),
mais la règle, elle, n'a pas bougé.

Preuves, sur le point d'entrée réel (`runSetup`), réseau stubbé et corps des
requêtes capturés — 13 vérifications vertes :

```
GSC fourni seul (état de la prod) → 1 écriture (VITE_GSC_VERIFICATION), 1 redéploiement, exit 0,
                                   GA4 nommée en avertissement ET dans le récapitulatif ;
                                   VITE_GA_MEASUREMENT_ID jamais écrite (pas écrasée par du vide)
les deux fournis                 → 2 écritures, vérification « GA4 + Search Console », exit 0
rien fourni                      → 0 écriture, 0 déploiement, exit 2
```

Le choix de la liste est lui aussi dérivé : les intégrations à poser se lisent sur
la table `INTEGRATIONS` de `check-seo-production.js` (celles qui sont `required`
et qu'une variable unique active), jamais recopiées — un libellé de vérification
qui divergerait du libellé publié est un faux vert qui ne peut plus s'écrire.

**Le correctif a été rejoué deux fois ; les runs, leurs dates et leurs codes de
sortie ont été relus dans l'API GitHub le 20/09/2026 :**

| Dispatch (`seo-vercel-env.yml`) | Ce qui était fourni | Sortie | Ce qu'il a écrit | Production |
|---|---|---|---|---|
| `35510660129`, 20/09 12:27 | GSC seul | **0** | 1/2 — GA4 nommée en `::warning` et au récapitulatif | 1/4 → **2/4** |
| `35512164588`, 20/09 12:59 | les deux (secret `KOJO_GA_MEASUREMENT_ID` créé le **20/09 à 12:59:05Z**, une seconde avant le dispatch) | **0** | 2/2 | 2/4 → **3/4**, dont 3/3 requises |

Les deux runs d'**avant** — `35370209109` (18/09) et `35474512717` (19/09) —
sortaient en **2** (« rien n'a pu être tenté ») sans rien écrire : c'est exactement
ce que le tout-ou-rien imposait. Le seul code qui n'a pas encore été observé en
vrai est **1** (« une valeur fournie n'a pas atterri »), et il est couvert par le
harnais du point d'entrée réel (`runSetup`, 13 vérifications) : le dire ainsi vaut
mieux que de le supposer observé.

**Ce qui reste à constater** : le run **quotidien** n'a pas encore tourné depuis
la pose. Les runs antérieurs de la sonde stricte — `35476895792` (19/09 23:43),
`35477808734` (20/09 00:04) et `35507742695` (20/09 11:24, **planifié**) — sont
tous rouges ; `35512336073` (20/09 13:02, `workflow_dispatch`) est **vert**. Le
prochain planifié est à 06:17 UTC. C'est la seule ligne de F9 qui soit encore une
attente, et elle est vérifiable par le run lui-même.

**Sources de ces chiffres** (relevés le 20/09/2026, rien de recopié) : le HTML
réellement servi (`curl -sS https://kojoforafrica.cc.cd/`), la liste des secrets et
les runs via l'API GitHub, et le journal du job `106082298708` — d'où sort la
ligne citée ci-dessus, mot pour mot.

Rejouer la mesure, sur la production comme sur un build local :

```bash
# la production sert-elle les balises ?
curl -sS https://kojoforafrica.cc.cd/ | grep -c googletagmanager   # 2 = déclaration + origine CSP (0 = non configuré)
curl -sS https://kojoforafrica.cc.cd/ | grep -o '"sameAs": \[[^]]*\]'

# l'injection fonctionne-t-elle quand les variables sont posées ?
cd frontend
VITE_GA_MEASUREMENT_ID=G-TEST123456 VITE_GSC_VERIFICATION=jeton \
VITE_SOCIAL_FACEBOOK=https://facebook.com/kojo-test npx vite build
grep -c googletagmanager build/index.html   # 2 (déclaration + CSP relâchée)
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

**Le contrat est maintenant vérifié hors ligne, sur un jeu de missions de
référence** (`scripts/check-job-og-contract.js`, step « Check job OG contract » du
job frontend — cinq missions depuis F15). Il exécute les deux implémentations :

```
pré-rendu    python -c "import kojo_job_og" …… → le HTML réel du backend
             (backend/kojo_job_og.py : module SANS dépendance — ni FastAPI, ni
             MongoDB, ni kojo_settings — donc importable avec le python3 du
             runner ; c'est ce qui fixe sa frontière)
application  src/utils/jobSeo.js              → le titre, la description et la
             carte de la MÊME mission (la fonction que JobDetails utilise)
```

Puis l'égalité est exigée sur le titre (`<title>`, `og:title`, `twitter:title`),
la description (les quatre balises, coupe à 150 **points de code** + « … » comprise
— l'unité elle-même était fausse d'un côté, cf. F15), la
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
(14 tests mesurés le 19/09/2026) sur le HTML du **module de production** — titre renommé d'un côté,
carte renommée, variante carrée retirée, description coupée d'un caractère de
plus, canonical divergent ou absent, mission sans annonce côté application, règle
de coupe par unités UTF-16 (F15) —, et
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

**Reste du même défaut, fermé le 20/09/2026** : sur les neuf routes privées, le
noindex n'était dit que par **une** des trois surfaces qui le publient. Mesuré en
production (HTML et en-têtes réellement servis) :

```
GET https://kojoforafrica.cc.cd/dashboard   (/messages, /profile, /photo-debug, /support-admin :
  x-robots-tag: noindex, follow             idem)
  <meta name="robots" content="index, follow" />      ← le gabarit d'accueil, recopié

GET https://api.kojoforafrica.cc.cd/api/robots.txt   (la liste écrite dans le backend)
  Disallow: /dashboard, /profile, /messages, /photo-debug, /api/
  ← 4 routes privées sur 9 : /create-job, /email-verification, /payment-verification,
    /commission-dashboard et /support-admin restaient CRAWLABLES
```

Le document disait `index, follow` là où l'en-tête disait `noindex` (le plus
restrictif gagne, mais par chance, pas par construction), et `robots.txt` —
servi par le backend avec sa propre liste — ignorait cinq des neuf routes que la
dérivation connaissait. `robots.txt` est désormais un **artefact du build**, écrit
depuis `privateRoutesOf` par `vite-plugins/write-robots-txt.js` (le rewrite Vercel
`/robots.txt → /api/robots.txt` est retiré : il MASQUERAIT le fichier statique), et
`app.html` porte `<meta name="robots" content="noindex, follow">`. Les trois
surfaces — l'en-tête de `vercel.json`, le meta du gabarit et le `Disallow` du
fichier — lisent la MÊME liste, et le garde refuse une liste figée en nommant les
routes qui manquent ; la route backend, elle, n'existe plus.

**Preuves** (dépôt réel) :

```
build/robots.txt écrit par le build → les 9 routes privées + /api/, triées
  → node scripts/check-spa-routes.js : exit 0

la liste FIGÉE d'avant, remise dans build/robots.txt
  → exit 1 : « il MANQUE /commission-dashboard, /create-job, /email-verification,
    /payment-verification, /support-admin (routes privées crawlables) »

build/app.html avec « index, follow »
  → exit 1 : « doit porter <meta name="robots" content="noindex, follow"> : c'est
    le gabarit des 9 routes privées, et il annonçait « index, follow » quand
    vercel.json leur envoie X-Robots-Tag noindex »

restauration     → les deux artefacts reviennent identiques (cmp), exit 0
```

Trois mutations rejouées le 20/09/2026 sur le fichier réel, chacune restaurée à
l'empreinte SHA-1 identique : refus du meta non-noindex neutralisé → « exige un
meta robots noindex dans build/app.html » ; comparaison du fichier neutralisée →
« refuse une liste figée qui a oublié une route privée » ; **dérivation
neutralisée** (`privateRoutesOf` ne rend plus rien) → « exige X-Robots-Tag noindex
sur chaque route privée », c'est-à-dire que la liste est bien ce qui porte le
verdict, et pas un fichier à côté.

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

### F15 — La coupe à 150 comptait deux unités différentes selon le langage — **fermé le 18/09/2026**

Le contrat de F10 comparait la description **déjà coupée** des deux côtés, mais sur
une seule mission dont le texte restait dans le **plan multilingue de base** — les
accents compris. Or les deux moitiés comptent dans des unités différentes :

```
src/utils/jobSeo.js      description.slice(0, 150) + description.length   → UNITÉS UTF-16
backend/kojo_job_og.py   raw_desc[:150]            + len(raw_desc)        → POINTS DE CODE
```

Les deux comptes coïncident **exactement** tant qu'aucun caractère n'est hors BMP,
ce qui rendait la divergence invisible : accents, apostrophes typographiques et
emoji du plan de base passaient. Avec un caractère **astral** (emoji, deux unités
UTF-16) la frontière se décale d'un caractère d'un côté — et si le 150e point de
code EST un astral, `slice` coupe au MILIEU de la paire de surrogates :
l'application publiait un **demi-caractère** dans `<meta name="description">`,
`og:description` et `twitter:description`, quand le pré-rendu publiait l'emoji
entier. La même fiche annonçait donc deux descriptions selon le canal — l'onglet et
la carte de partage — avec un « … » qui ne tombait pas au même endroit.

**Correctif** : l'application coupe par POINTS DE CODE (`Array.from`), l'unité de
Python, et la borne vit dans une seule constante exportée (`DESCRIPTION_LIMIT`),
que le garde importe au lieu de la recopier.

**Le jeu de référence** remplace l'unique mission : `CONTRACT_JOBS` en porte cinq,
chacune déclarant ce qu'elle couvre, et le garde exige l'égalité des deux côtés
pour CHACUNE :

| Mission | Ce qu'elle place à la frontière des 150 |
|---|---|
| apostrophe et « & » | texte échappé dans le HTML, description longue |
| accents à la frontière | le 150e point de code est le « è » de « gouttières » |
| emoji BMP à la frontière | un emoji du plan de base (1 unité UTF-16) : les comptes coïncident encore |
| astral à la frontière | la paire de surrogates tombe pile sur la coupe |
| astral avant la frontière | le décompte UTF-16 décale la frontière d'un caractère |

**Preuves** — la règle d'avant remise en place dans `src/utils/jobSeo.js` (mutation
sur le fichier réel, restaurée à l'empreinte SHA-1 identique) :

```
node scripts/check-job-og-contract.js   → exit 1, 6 problèmes nommés
  [astral à la frontière] description : … 151 points de code, l'application 151 —
    « … et goutti😀… » ≠ « … et goutti…. »        ← la moitié du caractère publiée
  [astral avant la frontière] description : … 151 points de code, l'application 150
npx vitest run scripts/__tests__/check-job-og-contract.test.js → 4 échecs / 15
  restauré → garde exit 0 (5 missions), 15 tests verts
```

Le message nomme la cause quand elle est là (« DEMI-CARACTÈRE : la coupe s'est faite
sur une unité UTF-16, au milieu d'un caractère astral ») : un « » affiché ne dit pas
d'où il vient. Les tests passent de 11 à **15**, dont deux qui empêchent le jeu de
devenir décoratif — la frontière de chaque mission est vérifiée sur le texte lui-même,
et le détecteur de demi-caractère est éprouvé avant qu'on s'en serve.

**Limite assumée** : la coupe reste en points de code, donc elle peut séparer une
séquence de graphèmes (emoji composé, accent combinant) — mais des deux côtés
IDENTIQUEMENT, puisque les deux langages comptent pareil. Couper par graphèmes
demanderait une bibliothèque côté Python, que ce module ne peut pas importer : sa
frontière est d'être sans dépendance (cf. F10).

### F16 — La carte de partage et sa page annonçaient deux textes — **fermé le 18/09/2026**

Un fichier de données par carte portait l'accroche MARKETING du visuel (`tagline`,
`sub`), pendant que la page publiait son propre titre et sa propre description, lus
dans la table des textes. Les deux surfaces parlaient de la même URL sans rien
partager :

| Surface | Ce qu'elle annonçait pour `/jobs` |
|---|---|
| la carte (`og-jobs.png`) | « Trouvez un travailleur qualifié près de chez vous » · « Emplois · Missions · Talents dans toute l'Afrique de l'Ouest » |
| la page (`jobs.html`) | « Emplois disponibles — Kojo » · « Trouvez un travailleur qualifié près de chez vous : emplois, missions et talents… » |

C'était vrai aussi de `/login` et de la carte générique (l'accueil). Rien ne
signalait l'écart : une accroche retouchée ne cassait aucun test, et un partage
social pouvait annoncer autre chose que le résultat de recherche, pour la MÊME
adresse.

**Correctif — la carte déclare la PAGE, plus son texte.** Le fichier de données
d'une carte nomme désormais la route qu'elle sert (`route`), les clés i18n du titre
et de la description de cette page (`title`, `description`), sa CTA et ses deux
sorties. Le générateur résout ces clés dans `src/i18n/fr.json` — la langue des
coquilles (`<html lang="fr">`), donc celle que lit un crawler sans JavaScript —
mesure les retours à la ligne avec la police réelle, et **refuse de dessiner** un
texte qu'il ne peut pas porter en entier (mot plus large que la colonne, ou plus de
lignes que la mise en page n'en réserve) : une carte tronquée annoncerait MOINS que
sa page sans que rien ne le dise.

Ce que la chaîne transmet ensuite, sans recopie :

```
scripts/og-cards/*.json   route + clés de texte de la page + sorties   ← la seule déclaration
        │
        ├──► src/config/og-cards.js      lue par le BUILD et par le RUNTIME
        │        ├─ CARDS_BY_ROUTE  (route → carte servie)
        │        └─ CARD_PAGE_META  (route → clés de texte)
        │                   │
        │     src/config/page-meta.js   PAGE_META = déclarées ∪ cartes
        │
        └── gen-og-images.py   dessine fr.json[clés], consigne les LIGNES MESURÉES
                │
                └── og-assets.manifest.json   route + lignes dessinées, empreintes, polices
                        │
                        └── check-og-assets.js   recompose les lignes et exige fr.json[clé]
```

**L'égalité carte ↔ page est structurelle, pas vérifiée.** Depuis le 19/09/2026,
le module qui sert le runtime ET le build lit les fichiers de données eux-mêmes ;
le manifeste ne recopie plus ni route, ni clés, ni fichiers (mesuré le 19/09/2026 :
`cards` ne porte plus que `route` et `lines`). Une carte ne peut donc plus annoncer
autre chose que sa page : les deux surfaces lisent un seul document. Ce qui reste à
confronter est ce qu'une déclaration ne peut pas dire — ce qui est RÉELLEMENT
dessiné dans les PNG versionnés.

**Trois gardes, un par maillon**

| Maillon | Garde | Ce qu'il refuse |
|---|---|---|
| la carte dessine le texte de sa page | `check-og-assets.js` (5a-ter) | les LIGNES consignées, recomposées, ne sont pas EXACTEMENT `fr.json[clé]` — un titre renommé sans régénérer les cartes |
| le manifeste nomme chaque carte déclarée | `check-og-assets.js` | aucune entrée `cards` pour une route que `scripts/og-cards/` déclare (manifeste périmé), aucune carte ne sert « / », ou une clé de texte absente de `fr.json` — ce garde ne compare plus deux copies : le manifeste ne porte plus la route que comme jointure |
| une route, une déclaration | `check-page-meta.js` (règle H, jouée par le build) | la route est déclarée des DEUX côtés : par une carte ET par la table écrite à la main |

La règle F de `check-page-meta.js` a disparu avec la convention de nom qu'elle
surveillait : « une carte large sans variante carrée » et « une carte pour une page
non pré-rendue » ne sont plus des états atteignables (les champs sont obligatoires,
le générateur comme le garde refusent une carte incomplète — et la route de la
carte ENTRE dans la table, donc la règle C la tient à une page réelle de `App.js`).
Ce garde ne lit plus le manifeste par `fs` : il importe la table, comme le bundle.

**Preuves**

```
node scripts/check-og-assets.js          → exit 0 (7 PNG, 3 cartes déclarées)
node scripts/check-og-reproducible.js    → 6 cartes + favicon régénérés OCTET POUR
                                           OCTET (arialbd.ttf)

jobsMetaTitle renommé dans fr.json, cartes NON régénérées :
  node scripts/check-og-assets.js → exit 1, 2 problèmes nommés
    « la carte wide de « /jobs » dessine « Emplois disponibles — Kojo », alors que
      src/i18n/fr.json publie « Offres et missions — Kojo » pour jobsMetaTitle :
      le texte de la page a changé, donc la carte de partage annoncerait autre chose
      que sa page — relance scripts/gen-og-images.py et committe les PNG »
  restauré (aucune modification résiduelle : `git diff` vide) → exit 0
```

Côté page, RIEN ne change : les trois routes à carte déclarent les mêmes clés
qu'avant (`homeMetaTitle`, `jobsMetaTitle`, `loginMetaTitle`…), donc le HTML servi,
les titres d'onglet et les exports i18n sont identiques — c'est le VISUEL qui cesse
d'annoncer autre chose. `npx vitest run` au 18/09/2026 : **48 fichiers / 630 tests** (620 tests le
19/09/2026, après la suppression des rejeux d'étapes) ;
`npm run build` en 0 ; les huit gardes frontend en 0.

**Limites assumées** : la carte dessine le texte FRANÇAIS (la langue des coquilles)
— un visiteur en bambara voit une page traduite et une carte en français, comme
avant ; le retour à la ligne peut séparer une séquence de graphèmes (emoji composé),
des deux côtés IDENTIQUEMENT puisque c'est le même texte ; et la CTA de la carte
(`accent`) reste une chaîne propre au visuel — ce n'est ni un titre ni une
description, donc rien à confronter à la page. Les REFUS du générateur qui rendent
cette égalité tenable sont verrouillés par des tests depuis F17.

### F17 — Les refus du générateur de cartes n'étaient prouvés par AUCUN test — **fermé le 19/09/2026**

Ce qui tient F16, ce sont les refus de `frontend/scripts/gen-og-images.py` : deux
cartes pour une même route, carte incomplète, route qui n'est pas un chemin absolu,
dossier sans aucune carte, clé i18n absente ou vide, mot plus large que la colonne,
plus de lignes que la mise en page n'en réserve — et un bloc plus haut que la carte,
qui est un FILET pour la CONSTANTE de mise en page, jamais un refus qu'un texte
déclenche (les 3 lignes de titre et 4 de description que `LAYOUTS` réserve tiennent :
340 px sur les 550 de la wide, 380 sur les 670 de la carrée). Sans ces refus, une
carte pourrait annoncer autre chose que sa page en restant « conforme » au manifeste.

Or **aucun test du dépôt ne les exerçait**. Deux fichiers mentionnaient bien le
générateur — `scripts/__tests__/check-og-assets.test.js` et
`scripts/__tests__/check-og-images.test.js` — mais l'un comme l'autre n'en lisaient
que le NOM (l'égalité générateur ↔ manifeste) : neutraliser un de ces refus ne
faisait rougir personne. C'était le seul faux vert que F16 pouvait encore produire.

**Correctif — `backend/tests/test_gen_og_images.py`** (22 cas). Le module est chargé
par son CHEMIN (comme `test_dmarc_policy.py` charge
`backend/scripts/dmarc_policy.py`) et son `CARDS_DIR` est redirigé vers un dossier
temporaire : aucun fichier du dépôt n'est écrit. Les 22 cas se répartissent
exactement en **20 refus** et **2 cas d'un seul invariant** — les lignes que `LAYOUTS`
réserve au titre et à la description tiennent dans la carte, en wide et en carrée —,
qui est ce qui donne son sens au filet ci-dessus ; l'autre invariant, le repli qui
redonne le texte publié (ce qui autorise `check-og-assets.js` à comparer le manifeste
à `fr.json`), est une assertion À L'INTÉRIEUR du cas de refus « texte trop long », pas
un cas à part. Aucune assertion ne porte sur
la FORMULATION d'un message : chacune nomme le coupable pris dans l'entrée du test
(fichier, champ, clé i18n, route, mot), donc reformuler un refus ne rougit pas la
suite. Les refus sont tous vérifiables **sans police de référence et sans image
produite** — la CI n'a ni Arial ni besoin des PNG, alors que ce sont ces refus qui
décident de ce que les cartes disent. Le cas « texte trop large » s'éprouve avec des
textes absurdes (80 « A » pour une colonne de 200 px, 400 mots pour 3 lignes) : sur un
runner sans Arial, la police de repli mesure autrement mais pas assez pour les faire
tenir, donc le verdict ne dépend pas de la machine.

Les faits que le GÉNÉRATEUR possède sont **lus sur le module**, jamais recopiés
dans le test : la liste des champs exigés (`REQUIRED_CARD_KEYS`, un cas par champ),
la police du titre de la wide (`LAYOUTS`, par `fonts_for`), la colonne
(`measure_width`) et les lignes réservées (`LAYOUTS`). Une liste écrite de mémoire
deviendrait fausse en silence — exactement le défaut que cette passe supprime — et
c'est prouvé par mutation (voir plus bas). Restent les cinq NOMS de champs de la carte
de référence du test (`CARD`) : ce sont des entrées, pas des faits du générateur —
chaque champ attend une valeur qu'un test ne peut pas inventer — et leur écart est
bruyant : un sixième champ exigé fait rougir deux cas (mesuré).

**Preuve automatique — `.github/scripts/check-og-test-mutations.py`**, étape du job
`backend-tests`. Un test qu'on n'a jamais vu échouer ne prouve rien, et cette preuve
n'existait jusqu'ici que HORS du dépôt — huit mutations manuelles du fichier réel,
restaurées à l'empreinte SHA-1 — donc rien ne pouvait la rejouer depuis un checkout.
Le garde copie dans une arborescence TEMPORAIRE le fichier de test, le générateur et
le dictionnaire (mêmes profondeurs), exige que la suite PASSE sur les copies intactes
— l'état de référence, sans lequel n'importe quel rouge serait un faux positif —,
puis neutralise **un refus à la fois** : la condition devient `False` à la position
exacte que l'arbre désigne (remplacer la LIGNE ENTIÈRE était le premier réflexe, et
la priorité des opérateurs avait d'ailleurs rendu fausse une première mutation
manuelle, `if False and … or …`, dont la seconde moitié survivait) et exige que la
suite ÉCHOUE. Les **9 refus** font 9 rouges : **3,0 à 5,0 s sur le runner selon le run**
(horodatages des étapes de `0de919f`, `eef604d`, `8f2b1b9` et `019dc5f0`, même source :
3,0 s, 5,0 s, 4,0 s, 4,0 s) et **10,1 s en local** (mesuré le 19/09/2026), où la
police et la machine diffèrent.
Un état de référence rouge échoue au nom de l'état de référence, un refus que
personne n'exerce au nom de sa ligne. Le dépôt n'est jamais modifié, donc il n'y a
plus d'empreinte à restaurer.

**La table des mutations n'existe plus : elle est LUE dans l'arbre du générateur.**
Chaque `raise SystemExit` que porte un `if` devient une mutation, avec sa ligne et le
texte de sa condition ; un `raise SystemExit` qu'aucun `if` ne porte est un ORPHELIN,
signalé au lieu d'être sauté. Un dixième refus ajouté au générateur est donc muté sans
que personne ne le déclare — prouvé sur une COPIE du générateur réel (le dépôt n'est
pas touché) : un refus ajouté à la fin du module est muté et signalé à sa ligne (622)
comme n'étant verrouillé par rien, et un `raise` extrait dans un helper est signalé à
sa ligne (339) comme n'étant porté par aucun `if`. Comme la suite ne passe que si les
refus existent, un générateur qui perdrait ses refus ne peut pas rendre ce garde vert.

**Chaque refus doit avoir SON test.** Un rouge quelconque ne prouve rien : n'importe
quelle casse collatérale en produit un. L'appartenance est donc mesurée — les rouges
d'un refus sont confrontés à ceux des autres — et un refus dont tous les rouges
rougissent aussi sous un autre refus échoue, en nommant cet autre refus. Mesuré sur le
vrai fichier de test : les 9 refus ont chacun au moins un test qui ne rougit que sous
lui, et aucun test ne rougit sous deux refus. Sur une copie du fichier de test, un cas
dont le test du refus touche aussi le refus des champs manquants est refusé (ligne
384), et un cas où le test ne l'exerce plus l'est aussi — cette fois comme « AUCUN
test ».

**Et le garde est prouvé lui-même** — `backend/tests/test_og_mutation_guard.py` (8
cas, 0,15 s) : dérivation de chaque refus et `raise` sans `if`, neutralisation de la
portion que l'arbre désigne (une autre ligne qui ressemble reste intacte), test qui
rougit sous plusieurs refus, refus que personne n'exerce, suite déjà rouge sur les
copies intactes, périmètre incomplet, et — sur le vrai générateur — chaque `raise`
couvert par une condition unique et neutralisable.

**Ni ces cas ni aucun autre de la suite n'exécutent pytest.** Les décisions se testent
en remplaçant la seule frontière du garde — lancer pytest — par des verdicts écrits
d'avance, et le seul contrôle qui subsiste sur l'étape est son CÂBLAGE : le
commandement apparaît UNE fois dans le workflow, dans le job `backend-tests`, celui
qui installe `backend/requirements.txt` — donc Pillow, que le fichier de test importe
et que les copies du garde exécutent. **Huit mutations, une par cas, le prouvent**
(rejouées le 19/09/2026 sur une copie du garde, dépôt jamais touché) : chacune casse
une capacité précise — ne plus signaler les orphelins, remplacer TOUTES les lignes qui
ressemblent, retirer la règle du test propriétaire, cesser de signaler un refus sans
rouge, ne plus arrêter sur l'état de référence, ne plus refuser un périmètre
incomplet, ajouter un SECOND exécutant dans le workflow, rendre la dérivation aveugle —
et fait rougir le cas visé (code 1, `1 failed`, jamais 5 : un sélecteur qui ne
sélectionne rien ne compte pas pour un échec). Les trois autres mutations du workflow
(retirer l'étape du job `backend-tests`, cesser d'y installer les dépendances) avaient
été mesurées le 18/09/2026. Cette suite a
d'abord lancé pytest douze fois, ce qui coûtait **+30 s sur le runner** (étape des
tests : 111,0 s, contre 81,0 s au run précédent, même source) ; elle ne le lance plus
du tout, et l'étape des tests est revenue de 111,0 s à **80,0 s** sur le runner, soit
son niveau d'avant.

**Un seul exécutant, et la suite le dit** : rejouer les mutations dans la suite ET
dans l'étape payait la même preuve deux fois par push. Mesuré des deux côtés : la
suite de `main` est passée de **82,5 s** (`798e31d`, avant la répartition) à
**78,9 s** (`8f2b1b9`, après) sur le runner, et de 89,1 s à 81,1 s en local, tandis que
l'étape coûte 3,0 à 5,0 s sur le runner selon le run et 10,2 s en local. L'étape
rejoue donc les
mutations seule ; la suite éprouve les décisions du garde **sans lancer pytest le
moins du monde** (8 cas, 0,15 s) et n'affirme de la partie verte que son câblage.

**Mutation du champ exigé — la dérivation suit le générateur** (rejouée le
19/09/2026 sur le fichier réel : `REQUIRED_CARD_KEYS` reçoit un sixième champ,
`alt`) : la collecte passe de **22 à 23 cas**, et le nouveau cas est bien COLLECTÉ —
une liste recopiée dans le test n'aurait produit aucun cas pour ce champ. **2 échecs**
nomment le champ (`og-cards/jobs.json : champ(s) manquant(s) alt`) : ce sont les deux
cas qui attendent une carte ACCEPTÉE (le refus de doublon et celui de route non
absolue tombaient désormais sur le champ manquant, vérifié avant eux) ;
`gen-og-images.py` restauré à l'empreinte SHA-1
`a94e9b9cdc2fe6e31862e0b5acacf3cf3f7690a1`, identique avant et après.

**Limites assumées** : le refus tombe à la LECTURE des données, donc une clé i18n
absente sur la 2ᵉ carte laisse la 1ʳᵉ carte déjà écrite dans `public/` — le verdict
reste non-nul et le manifeste n'est PAS réécrit (`check-og-assets.js` rougit alors
sur l'écart PNG ↔ manifeste), mais la sortie n'est pas atomique ; un dossier
`og-cards/` **absent** échoue par une trace `FileNotFoundError` au lieu d'une phrase
nominative — le verdict y est encore non-nul, donc rien n'est silencieux, mais le
message n'est pas celui de la convention du générateur ; et le RENDU (polices
réellement retenues, octets des PNG) reste prouvé par `check-og-reproducible.js` et
`check-og-assets.js`, pas par ces tests.

### F18 — Les durées de conservation publiées pouvaient dériver sans que rien ne rougisse — **fermé le 19/09/2026**

Pendant combien de temps une donnée vit en base était écrit à TROIS endroits qui ne se
parlaient pas : `expireAfterSeconds` en clair dans l'index TTL de `kojo_core.py`, la
durée réellement inscrite dans le document à la création (`expires_at` d'un paiement —
48 h écrit en clair dans `kojo_routers_payments.py`, `expires_at` d'un OTP), et le
chiffre cité dans la politique de confidentialité. Aucun test ne les confrontait :
changer un délai laissait le document annoncer l'ancien indéfiniment, en silence.
C'est le motif F17 appliqué à un document de conformité — sauf qu'ici l'écart ne
casse rien, il fait seulement mentir un document que personne ne relit.

`backend/kojo_retention.py` possède désormais les durées : `kojo_db` crée ses index
TTL depuis `RETENTION_RULES` (plus un seul `expireAfterSeconds` littéral),
`kojo_routers_payments.py` lit `PAYMENT_PENDING_EXPIRY_HOURS`, et le tableau de
`PRIVACY.md` est ENGENDRÉ par `.github/scripts/check-privacy-policy.py`. Le garde
importe le module réel, compare ligne par ligne et nomme la collection et la colonne
fautives ; il ÉCHOUE plutôt que de passer quand il ne peut pas conclure (module
importable, marqueurs du bloc présents). Il est le SEUL exécutant de cette preuve sur
le dépôt réel (étape du job `backend-tests`, ≈ 0,55 s mesurés hors CI : les trois
mesures locales donnent 546, 578 et 540 ms) ; `backend/tests/test_privacy_policy_guard.py`
ne la rejoue pas — il prouve, sur des copies mutées hors du dépôt, qu'un écart est
refusé et nommé.

**Les durées sont appliquées, et c'est une mesure** (ajouté le 19/09/2026) : les sept
règles sont traduites en filtre par `RegleDeConservation.query_de_purge`, et
`backend/tests/test_retention_purge.py` (10 cas) le vérifie DES DEUX CÔTÉS — ce qui
doit disparaître disparaît, ce qui doit survivre survit (un compte ACTIF portant une
échéance ancienne, un paiement complété). Le document de compte supprimé porte
désormais son échéance : sans elle, le filtre exige `purge_at` et la durée publiée
aurait été purement décorative. Sept mutations rejouées le 19/09/2026 sur les fichiers
réels (filtre du compte supprimé, seuil des règles à date de création, fusion du filtre
partiel, symbole de la durée, écriture de l'échéance, périmètre de la purge, comparaison
des dates BSON dans la FakeDB) font chacune rougir **le test qui possède cette
garantie** — le nom est vérifié dans la ligne `FAILED`, pas seulement « un test a
échoué » — restaurées à l'empreinte SHA-1 identique des quatre fichiers. La FakeDB
a dû apprendre à comparer des dates BSON : les modèles écrivent de vrais `datetime`,
donc une plage sur une date rendait `False` et la purge ne trouvait jamais rien, en
silence. `--write` écrit désormais en LF (`newline=""`) : sous Windows il convertissait
auparavant TOUT le document en CRLF alors que `.gitattributes` fixe `*.md text eol=lf`,
une conversion que `git diff` ne montre pas (git normalise au commit).

**Limites assumées** : le tableau ne couvre que les collections PURGÉES
automatiquement — `jobs`, `job_proposals`, `reviews`, `worker_profiles` et
`push_tokens` ne sont bornées que par la suppression du compte qui les porte, ce que
`PRIVACY.md` §3 déclare ; la prose du document n'a pas de garde, donc seule la recopie
d'une durée engendrée dans cette prose est refusée (par un test, pas par le garde) ; et
le garde compare la valeur ÉVALUÉE du module, donc une variable d'environnement qui
déplace `EMAIL_OTP_EXPIRY_MINUTES` en production n'est pas vue par la CI, qui tourne
sans elle — le document le dit à l'endroit où il compte (§3).

## 4. Gardes jamais prouvés

Le job `audit-regression-test` prouve que 4 contrôles savent échouer
(`audit_docstrings.py`, `audit_api_returns.cjs`, `py_compile`, `pyflakes`). Les
autres gardes doivent leur crédibilité à leurs tests Vitest, qui injectent une
régression et exigent l'échec — c'est équivalent, à une exception près :

| Garde | Prouvé qu'il peut échouer par |
|---|---|
| `audit_docstrings.py`, `audit_api_returns.cjs`, `py_compile`, `pyflakes` | méta-test CI (`audit-regression-test`) |
| `check-api-split.js`, `check-bundle-size.js`, `check-generated-icons.js`, `check-home-shell.js`, `check-spa-routes.js`, `check-og-images.js`, `check-og-job-200.js`, `check-pwa-manifest.js`, `check-pack2-chunks.js` (via `pack2-size.test.js`), `check-script-deps.js`, `validate-vercel-json.mjs`, `check-cors-preflight.js`, `audit_tdz.cjs` (son CLI lancé par `audit-tdz.test.js`) | tests Vitest dédiés |
| `check-og-assets.js` | `scripts/__tests__/check-og-assets.test.js` (34 tests mesurés le 19/09/2026 : générateur unique par le nom ET le contenu, dimensions réelles des PNG, orphelins, manifeste, polices de référence, **et le TEXTE dessiné** — lignes recomposées ≠ dictionnaire, manifeste retouché à la main, carte incomplète nommée, aucune carte pour « / », route non absolue, dictionnaire illisible) + mutation rejouée le 18/09/2026 sur le fichier réel : `jobsMetaTitle` renommé sans régénérer les cartes → garde en **1**, message nommé, restauré sans modification résiduelle (§3 F16) ; la reproduction octet pour octet des cartes est prouvée par `check-og-reproducible.js` (7 fichiers, police de référence) |
| `check-job-og-contract.js` | `scripts/__tests__/check-job-og-contract.test.js` — comparaison PURE prouvée capable d'échouer sur 7 mutations du HTML du module de production (titre, carte, variante carrée absente, découpe de description, canonical divergent, canonical absent, annonce applicative vide) ; le **jeu de référence** (5 missions, frontière des 150 sur un accent, un emoji BMP, un astral et avant un astral) est comparé mission par mission, et la règle de coupe d'AVANT (unités UTF-16) est détectée — mutation rejouée le 18/09/2026 sur le fichier réel : garde en **1** (6 problèmes) et 4 tests rouges, restauré à l'empreinte identique (§3 F15) ; l'absence d'interpréteur Python est un échec en CI sur un dépôt sans `backend/kojo_job_og.py` |
| `check-workflow-pins.py` | `backend/tests/test_ci_workflow_pins.py` (classement des références + workflow réel) |
| `check-test-existence-assertions.py` | `backend/tests/test_existence_assertion_guard.py` (cas refusés ET acceptés, périmètre vide refusé, `::error` + code 1, câblage dans `workflow-lint`) |
| `check-page-meta.js` | `scripts/__tests__/check-page-meta.test.js` (38 tests mesurés le 19/09/2026 : les 7 règles savent échouer — dont un build PÉRIMÉ (texte **et** carte), une table vide, une route déclarée à la fois par une carte et par la table écrite à la main (règle H, injectée), une clé de page absente d'une seule langue, une langue publiée sans dictionnaire et un dictionnaire que personne ne charge —, leurs exemptions) — le passage du garde sur le dépôt réel appartient à l'étape de CI **et** le plugin de build lui-même, `requirePageMeta` : monté sur une arborescence dont la page est muette (`buildStart` doit lever) + `scripts/__tests__/check-page-meta-build-wiring.test.js` (2 tests, environnement Node : le `vite.config.js` RÉEL installe le plugin en `apply: 'build'`, et la config ne le réécrit pas) — mutations automatisées le 18/09/2026 sur les trois maillons (plugin retiré, `apply: 'serve'`, `buildStart` sans appel → la suite rougit) + mutations rejouées à la main : page privée de son `usePageMeta()` (§3 F12) et deux mutations de dictionnaire (§3 F14) → `npm run build` en **1** à chaque fois, tout restauré à l'octet |
| `deriveRoutes` — la dérivation route → carte de `check-og-images.js` (exécutée au CHARGEMENT, donc `vite build` avec elle) | test qui refuse une carte dédiée hors des pages du projet + mutation rejouée le 18/09/2026 (carte ajoutée au seul manifeste) : **`npm run build` en 1** et les **trois** gardes qui dérivent la table en 1 avant d'avoir rien vérifié |
| la classification publique/privée des routes (`privateRoutesOf` de `check-spa-routes.js`) | `scripts/__tests__/check-spa-routes.test.js` (**40 tests mesurés le 20/09/2026** : dérivation textes/backend/privé, page ni déclarée ni privée refusée, noindex qui doit viser la route, et les trois surfaces du noindex — en-tête de `vercel.json`, meta de `build/app.html`, `Disallow` de `build/robots.txt` — contre la même liste, dont une liste figée, une interdiction hors dérivation, une seconde déclaration `public/robots.txt` et un rewrite de `/robots.txt`) + mutations rejouées (18/09 : dérivation neutralisée → 5 tests rouges, exclusion du noindex `/(.*)` retirée → rouge ; 20/09 : meta indexable, liste figée et dérivation neutralisée → un rouge NOMMÉ chacune, empreinte SHA-1 identique) et le dépôt réel : une page non déclarée passe d'`exit 0` à `exit 1` (§3 F13) |
| la correspondance route → fichier de coquille (`shellFileFor` de `scripts/site-meta.js`, appelée par le build et les gardes) | `scripts/__tests__/site-meta.test.js` — refuse une source qui la recalcule (périmètre non vide exigé, la reproduction est nommée `fichier:ligne`) et exige un fichier DISTINCT par page de la table ; **six copies** remplacées (le build qui écrit, `check-page-meta`, `check-prerender-shells`, `PRERENDERED_PAGES` désormais dérivée, le routage attendu de `check-spa-routes`, la fixture du test) + mutation rejouée le 18/09/2026 (copie valide réintroduite dans un garde → test rouge, restaurée à l'octet) et build rejoué : les **10 coquilles émises identiques à l'octet** |
| `inject-seo-extras` / `inject-production-csp` (plugins du dossier `frontend/vite-plugins/`, pas des gardes — seul `vite.config.js` les monte) | `scripts/__tests__/seo-extras-injection.test.js` — échec prouvé par mutation le 17/09/2026 (cf. F9) |
| `gen-og-images.py` (le générateur, pas un garde) | `backend/tests/test_gen_og_images.py` (22 cas : deux cartes pour la même route nommant les deux fichiers, champ manquant ou blanc, carte incomplète nommée et non sautée, route non absolue, dossier sans carte, clé i18n absente/vide/non textuelle, description vérifiée autant que le titre, mot plus large que la colonne, plus de lignes que réservé, bloc plus haut que la carte — **filet pour la CONSTANTE, jamais un texte** —, **sans police de référence ni image produite**, plus l'invariant qui porte le filet : lignes réservées qui tiennent dans la carte, en wide et en carrée — et, DANS le cas de refus « texte trop long », l'invariant lignes repliées ↔ texte publié) ; la liste des champs exigés, la police du titre, la colonne et les lignes réservées sont LUES sur le générateur, jamais recopiées ; les refus sont neutralisés dans une arborescence temporaire par `.github/scripts/check-og-test-mutations.py`, **seul exécutant de cette preuve** (**9 refus dérivés de son arbre, chacun rougissant le test qui lui appartient, 3,0 s sur le runner, le dépôt jamais modifié**) et une mutation du champ exigé a été rejouée à la main (un sixième champ → collecte 22 → **23 cas**, suite rouge nommant le champ, restauré à l'empreinte identique) — §3 F17 |
| `check-og-test-mutations.py` | `backend/tests/test_og_mutation_guard.py` (8 cas : **la dérivation lit chaque `raise SystemExit` et signale celui qu'aucun `if` ne porte**, **la neutralisation vise la portion que l'arbre désigne — une autre ligne qui ressemble reste intacte**, **un test qui rougit sous plusieurs refus n'en verrouille aucun**, un refus que personne n'exerce est signalé, une suite déjà rouge arrête tout avant la première mutation, un périmètre incomplet est une erreur ; sur le vrai générateur, la dérivation couvre chaque `raise` et chaque condition est neutralisable ; les décisions se testent sur des verdicts ÉCRITS D'AVANCE — **ces cas n'exécutent jamais pytest** — et le dernier contrôle exige UNE occurrence du commandement, dans le job `backend-tests`, celui qui installe les dépendances de l'étape) ; la partie VERTE du garde n'a qu'un exécutant, l'étape de CI, et **huit mutations, une par cas, rejouées le 19/09/2026 sur une copie du garde (dépôt jamais touché, code 1 et `1 failed` à chaque fois)** montrent que chaque cas sait échouer |
| `check-privacy-policy.py` | `backend/tests/test_privacy_policy_guard.py` (14 cas mesurés le 19/09/2026, 4,3 s : sur une COPIE du dépôt, une durée changée dans le module, une ligne retirée du document, une cellule éditée à la main, une collection ajoutée au code sans ligne, une ligne publiée que le code ne porte pas, des marqueurs absents, un module absent et `--write` qui répare — chacun rend **1** en nommant la collection et la colonne ; plus les invariants de propriétaire unique : plus aucun `expireAfterSeconds` littéral dans le module qui crée les index, chaque règle créant SON index avec son filtre partiel, les mots des durées calculés et non recopiés, aucune durée engendrée recopiée dans la prose du document, et UNE occurrence du commandement, dans le job qui installe `requirements.txt`) ; six mutations rejouées le 19/09/2026 sur les fichiers réels (document, règle, `kojo_settings`, filtre partiel, `kojo_core`), chacune rouge et nommée, restaurées à l'empreinte SHA-1 identique des quatre fichiers — §3 F18 |
| `check-prerender-shells.js` | `scripts/__tests__/check-prerender-shells.test.js` (11 tests : le garde EXÉCUTÉ en sous-processus sur une arborescence de build fixture conforme — vérifiée verte — puis neuf régressions injectées une à une : `#root` vidé, modulepreload du chunk Home perdu, h1 de login retiré, champ de formulaire register retiré, `og:image` d'une coquille retiré (carte LUE dans la table unique), coquille absente du build, page pré-rendue routée d'un seul côté, catch-all `/(.*)` réintroduit, `vercel.json` illisible — chacune exige `exit 1` ET le message qui nomme le coupable) |

`check-prerender-shells.js` était, jusqu'au 19/09/2026, le **seul** garde du
dépôt dont rien ne démontrait qu'il sait échouer : référencé uniquement par
`ci.yml`, sans fixture ni test. S'il devenait aveugle (mauvaise condition, chemin
d'artefact modifié par une montée de version de Vite), la CI serait restée verte
sans que personne ne le voie.

Ce trou est fermé, et l'inventaire ne dépend plus de la vigilance de personne :

* `.github/scripts/guard-proofs.json` déclare **chaque** garde du dépôt
  (`frontend/scripts/`, `.github/scripts/`, `backend/scripts/`) avec son rôle,
  qui l'exécute, et sa preuve ;
* `backend/tests/test_guard_failure_proofs.py` refuse un garde exécuté par la CI
  sans preuve REJOUBABLE : le fichier doit exister, être collecté par le runner
  déclaré (Vitest ou pytest), et **nommer** le garde qu'il prouve ; il refuse
  aussi un garde que RIEN n'exécute s'il n'est pas déclaré comme tel avec un
  motif **et** consigné au §7 ci-dessous ;
* `.github/scripts/check-guard-mutations.py` rejoue les mutations déclarées :
  neutraliser une ligne d'un garde **réel** doit faire rougir SA preuve en la
  nommant — le fichier est restauré à l'octet et son empreinte SHA-1 vérifiée,
  et une mutation dont le littéral a disparu est un ÉCHEC (sinon un refactor
  suffirait à éteindre la preuve en silence) ;
* le registre refuse enfin une mutation qui ne vise pas le garde lui-même ou qui
  n'a aucun effet (`trouve == remplace`) ; chaque runner est rejoué par une étape
  déclarée sous `rejeux` — Python dans `backend-tests`, Node dans
  `frontend-build` — et le fichier de couverture vérifie que ces étapes sont
  invoquées **par leur nom** et qu'aucun job ne nomme plus un runner.
* **le registre est EXHAUSTIF** : chaque entrée est soit **mutée**, soit déclarée
  `hors_mutation` **avec son motif**. Un garde ni muté ni justifié est un refus
  (`SpecInvalide`), pas un oubli silencieux — la couverture ne dépend donc plus
  de la vigilance de celui qui ajoute un garde. Au 20/09/2026 : **37 mutations**
  couvrent les **30** entrées mutables des **41** déclarées (le harnais en porte
  trois : ses décisions, son filtre par changement, et le rejeu d'une étape due) ;
  les 11 autres sont des exclusions motivées —
  `check-og-reproducible.js` (outil sans verdict reproductible, §7 item 11),
  `resolve-vercel-url.sh`, `bundle-size-report.js`, `dmarc_policy.py`,
  `provision_ci_test_account.py`, `loadtest_real_flow.sh`,
  `lhci-cls-budgets.cjs`, `setup-seo-env.js`, `site-meta.js` et
  `vercel-rewrite-server.js` (outils : rôle `outil`, un motif chacun — le
  périmètre du registre est le RÉPERTOIRE depuis le 20/09/2026, plus le nom),
  et `gen-og-images.py` (déjà muté par
  `check-og-test-mutations.py` : le rejouer ici paierait deux fois la preuve).
* **le filtre est mesuré, pas supposé** : une entrée n'entre dans la table que si
  sa preuve peut rougir **hors ligne** et **sans artefact de build**. Deux mesures
  ont servi de critère plutôt qu'une inspection : les mutations Node ont été
  rejouées avec `frontend/build` **retiré de l'arbre** — **18/18 rouges, 81 s** le
  19/09/2026 (24/24 le 20/09/2026, `build/` présent), chaque preuve montant sa
  propre fixture dans un répertoire temporaire — et les
  trois sondes qui parlent HTTP (`check-cors-preflight`, `check-seo-production`,
  `check-og-job-200`) reçoivent leur `fetch` par injection ; la seule adresse
  réellement appelée est `http://127.0.0.1:1`, où rien n'écoute (le cas qui prouve
  qu'un accueil injoignable ne fait pas conclure « absent »). Coût : mesuré en
  local (Windows, démarrage de `npx` compris, `build/` présent) à **33 à 42 s**
  pour les 11 mutations Python et **1 min 58 s** pour les **24** Node (mesuré le
  20/09/2026, Windows, `npx` compris) — et **sur le
  runner**, sur le même run (`35457261081`, lu par l'API), à **17 s** pour les 11
  mutations Python (étape « Mutations des gardes — preuve d'échec (runner
  Python) », job `backend-tests`) et **32 s** pour les 18 Node (étape « Mutations
  des gardes — preuve d'échec (runner Node) », job `frontend-build` de 77 s au
  total). L'écart local/runner n'est pas une imprécision de mesure : l'essentiel
  du coût local est le démarrage de `npx` sous Windows, qui n'existe pas sur le
  runner. C'est donc le chiffre du runner qui dit le prix par push, et les
  relevés locaux — plus élevés de 1,9 à 2,5 fois (Python : 33-42 s / 17 s) et de
  2,6 à 4,6 fois (Node : 83-146 s / 32 s) — le représentaient mal.
* **le périmètre des rejeux est DÉRIVÉ DE LA TABLE, pas choisi par le job** :
  les 18 mutations Node démarrent chacune un runner Vitest et les 11 Python un
  pytest par mutation. Mesuré sur le run 35464937754 (celui qui a livré cette
  dérivation) : étape Node **25 s sur les 61 s du job** `frontend-build`, étape
  Python **17 s** sur les 141 s de `backend-tests` — et **32 s sur 77 s** pour
  la même étape Node au run 35457261081 : deux runs, de la variance, pas deux
  mesures comparables.

  Chacune des trois étapes qui rejouent une preuve — les deux runners et le
  rejeu OG — coûte désormais **deux étapes** de workflow : la **question de
  portée** (`--etape NOM`) puis le rejeu lui-même, sous la porte du verdict
  (`--etape NOM --rejouer` pour un runner, le garde déclaré pour le rejeu OG).
  La question coûte ce que l'étape payait déjà en interne pour décider toute
  seule — le calcul est le même, il a seulement quitté le YAML : mesuré sur le
  runner au run 35465610175, **4 s** pour le runner Python et **1 s** pour le
  runner Node (étapes filtrées qui ne rejouaient rien), et la question du rejeu
  OG y coûtait déjà **1 s**. Ce que la porte ajoute est donc de la lecture, pas
  du calcul — et quand elle répond `non`, l'étape de rejeu ne démarre pas du tout.
  Un job ne nomme plus ni runner ni filtre : il DÉSIGNE
  une étape de la table, et c'est la table qui sait ce que cette étape couvre.
  Le harnais REFUSE un registre où un runner déclaré n'a pas d'étape, où une
  étape déclare un runner qu'aucune mutation ne porte (elle rejouerait rien en
  restant verte), ou si `--changed-from` est donné sans `--etape` — un filtre
  sur le harnais entier était précisément la façon dont un job choisissait le
  sien.

  **Le verdict et le rejeu sont la même mesure** (`etat_d_etape`) : la liste de
  mutations exécutées est celle que le verdict vient de déclarer due. Deux
  calculs auraient été deux occasions de diverger, et la divergence irait dans
  le sens du faux vert — une porte ouverte par un `rejeu=oui` au-dessus d'un
  rejeu vide, ou l'inverse. Un changement dans la table ou le harnais est ce
  qui rend la portée non fiable : il est donc traité dans la même fonction que
  le filtre par mutation, pas à côté.

  Ce que coûte une PR qui ne touche AUCUN garde est désormais mesuré sur le
  runner aussi (run 35465610175, PR de documentation seule) : étape Node **1 s**
  (0 mutation retenue), étape Python **4 s** au lieu des 17 s qu'elle payait en
  rejouant tout, et rejeu OG **sauté** (question de portée 1 s, étape de rejeu
  0 s). Jobs : `frontend-build` 45 s au lieu de 61, `backend-tests` 130 s. C'est
  le seul cas où le filtre économise vraiment — une PR qui touche un garde
  rejoue, par construction, tout ce que ce garde implique — et la forme en deux
  étapes ne change plus ce chiffre : quand la portée dit `non`, l'étape de rejeu
  ne démarre pas du tout (0 s), au lieu de démarrer pour ne rien faire.

  Trois garde-fous, tous dans le sens de l'erreur sûre : si la **table** ou le
  **harnais** a bougé, la portée n'est plus une information fiable et TOUT est
  rejoué ; si la **base de comparaison** est introuvable (clone superficiel,
  SHA non récupérable), tout est rejoué aussi ; et hors PR (push sur `main`,
  dispatch) il n'y a pas de base du tout, donc la preuve ENTIÈRE est due.

  Le périmètre d'une mutation n'est pas un fichier mais une **fermeture** lue
  sur la source : le garde, sa preuve, les modules qu'ils importent — relativement
  ou par leur nom de module du dépôt — les chemins qu'ils citent dans une
  EXPRESSION (pas dans une docstring : le harnais lui-même cite `site-meta.js`
  en prose, et compter cette prose le reliait à 103 fichiers au lieu de 15,
  mesuré), et les fichiers qui pèsent sur toute preuve d'un runner
  (`pytest.ini`, `conftest.py` ; `vite.config.js`, `package.json`,
  `package-lock.json`). Neuf gardes importent `site-meta.js` : le toucher
  rejoue ces neuf mutations. Limite dite : un changement qui n'entre dans
  aucune de ces formes est invisible du filtre — d'où le rejeu entier sur
  `main`, qui reste le filet de dernier recours.

Ajouter un garde sans preuve d'échec est donc désormais un rouge, pas une
découverte fortuite.

### Une preuve, un exécutant

Une étape de CI et un test qui rejoue la MÊME preuve sur le même dépôt la paient
deux fois par push. Recensé et corrigé le 19/09/2026 : **treize rejeux supprimés**,
chacun laissant la preuve à l'étape qui l'exécute déjà — `check-og-assets.js`,
`check-page-meta.js`, `check-pwa-manifest.js`, `check-spa-routes.js`,
`check-generated-icons.js`, `check-job-og-contract.js`, `check-api-split.js`,
`check-pack2-chunks.js`, `check-workflow-pins.py`,
`check-test-existence-assertions.py` (deux fois : par sous-processus puis en
process), `check-exec-bits.py`, le pyflakes des modules découpés
(`python -m pyflakes kojo_*.py server.py`) et
`check-fly-env-drift.py --refs-only`. Même logique pour `test_import_health.py` :
l'étape dédiée du job `backend-tests` est son seul exécutant, la suite complète du
même job l'exclut (`--ignore=tests/test_import_health.py`).

Les suites ne gardent donc que ce qu'elles seules peuvent prouver : les règles sur
fixtures (injecter une régression), les contrats de code de sortie, et — là où il
existe — le CÂBLAGE de l'étape, parce qu'une étape retirée du workflow rendrait la
preuve inexistante sans que rien ne rougisse. Deux exceptions assumées :
`check-script-deps.js` n'a **pas** d'étape, la suite Vitest est son seul
propriétaire ; et `check-exec-bits.py` reste rejoué en sous-processus sous une console
`cp1252`, une propriété que l'étape (UTF-8) ne prouve pas.

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
secret, et dure deux secondes ; depuis le 19/09/2026 la suite complète du même job
l'exclut, pour que cette preuve n'ait qu'un exécutant.

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
`page-meta.js` (route → clés i18n du titre et de la description), `og-cards.js`
(route → carte servie ET route → clés de texte des pages à carte) et `route-path.js`
(normalisation d'un chemin, partagée par les deux).

Une route a une CARTE parce qu'un **fichier de données** le dit (`scripts/og-cards/
<carte>.json` : la route servie, les clés i18n du titre et de la description de
cette page, la CTA, ses DEUX sorties). Le générateur découvre le dossier, dessine le
texte de la page résolu dans `fr.json` et consigne la route et les lignes dans le
manifeste ; `og-cards.js` en dérive la carte servie à chaque route ET les textes de
cette route ; `page-meta.js` fusionne ces derniers avec ceux des routes SANS carte,
qui sont les seules à se déclarer encore à la main (une route déclarée des deux
côtés fait échouer le build — règle 6, §3 F16). Le slug d'un PNG ne déclare donc
plus rien, et aucun `.py` ni `.js` ne bouge pour ajouter une carte — couvert par un
test qui ne dépose qu'un fichier JSON : `og-support.png` entre dans le périmètre du
garde sans qu'aucune ligne de code ne soit touchée.

Sortir le texte du générateur lui retire la protection de son empreinte (elle ne
couvre que du code) : le manifeste porte donc une seconde empreinte,
`cards_sha256`, recette identique octet pour octet des deux côtés (nom de fichier +
LF + contenu normalisé en LF, fichiers triés). Sans elle, changer la route ou les
clés d'une carte sans relancer le script laisserait des PNG périmés derrière un
manifeste « frais ». Deux tests la tiennent : une carte modifiée seule fait rougir,
un fichier en CRLF reste vert (`check-og-assets.test.js`), et l'accord
Python ↔ JavaScript est prouvé sur le dépôt réel — le manifeste versionné est écrit
par Python, l'empreinte recalculée en JavaScript doit lui être égale.

Le TEXTE des cartes, lui, vient du dictionnaire et non plus d'une accroche écrite
pour l'image : le garde recompose les lignes consignées dans le manifeste et exige
l'égalité avec `fr.json[clé]` (§3 F16). Les 6 PNG ont donc CHANGÉ le 18/09/2026,
volontairement (ils dessinent désormais le titre et la description de leur page) —
la régénération est prouvée octet pour octet par `check-og-reproducible.js`.

Le revers de la déclaration est traité au même endroit : une carte dont la route
ne correspond à AUCUNE page du projet (`lighthouserc.cjs`, `DEPLOYMENT_PATHS`) fait
ÉCHOUER la dérivation elle-même, donc `vite build` — pas seulement un test. C'est un
PNG livré que le build perdrait en silence (`/job` pour `/jobs` est le cas
réaliste) ; le seul indice serait « la page reçoit la carte générique », ce qui est
le comportement normal de toutes les autres pages. Limite assumée : `paths === null`
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
6. une route ne déclare pas ses textes des DEUX côtés : la carte les dessine, donc
   ils sont déclarés dans son fichier de données — une route présente aussi dans la
   table écrite à la main est une erreur, sinon la carte l'emporterait en silence et
   corriger la ligne manuelle ne changerait rien (§3 F16 ; la règle F d'AVANT,
   « une carte large sans variante carrée ou pour une page non pré-rendue », est
   tombée avec la convention de nom qu'elle surveillait : les champs sont
   obligatoires, et la route de la carte entre dans la table, donc la règle 3 la
   tient à une page réelle) ;
7. chaque clé de texte de page existe, non vide, dans **chaque langue publiée** —
   la liste de ces langues est LUE dans `src/contexts/LanguageContext.js`, jamais
   recopiée, une langue publiée sans dictionnaire lisible est une erreur comme un
   dictionnaire que personne ne charge, et une liste illisible est refusée plutôt
   que lue comme vide (§3 F14).

Les règles 1, 2, 3, 6 et 7 ne lisent que les tables et les sources (y compris la
table venue des cartes) : le BUILD les joue déjà (`buildStart` du plugin
`require-page-meta`), la CI les rejoue avec les règles 4 et 5, qui ont besoin des
coquilles écrites.

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
  sitemap proxifié (son contenu est dynamique : il énumère les fiches vivantes),
  **chaque route de production de `src/App.js`**
  déclarée dans ses deux formes (`/route` et `/route/`), aucun catch-all (une
  URL inconnue doit répondre **404**, pas 200) et aucune règle exacte masquée
  par un motif placé avant. Contrôle supplémentaire : **chaque route est servie
  par le bon gabarit** — sa page pré-rendue si elle en a une, `app.html` sinon,
  et jamais `index.html` (qui porte le contenu de l'accueil) ; `app.html` doit
  rester nu (pas de `<h1>`, pas de canonical, pas de JSON-LD, `#root` vide) et
  **porter un meta robots noindex** — il sert les routes privées et les servait
  en annonçant `index, follow` (voir F13) — et
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
  `src/config/contact.json`, les pays du référentiel `src/config/countries.js`
  (le même que lit la page), un `LocalBusiness`
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
- `flyctl deploy --remote-only --build-arg KOJO_GIT_SHA=<commit>` réussit.
- **Le service servi tourne bien la révision attendue** : `/health` publie
  `revision` et elle est comparée au commit poussé — ou, si le déploiement a été
  sauté, au dernier commit ayant touché `backend/**` ou ce workflow (cf. F8).
  C'est cette ligne qui fait qu'un `main` vert signifie « le backend déployé est
  à jour », et plus seulement « flyctl n'a pas échoué ».

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
3. **CLOS (20/09/2026) — le résultat du déploiement est vérifié** : le service
   publie la révision dont son image a été construite (`/health`, champ
   `revision`) et `deploy-fly` refuse quand la réponse n'est pas le commit
   attendu — y compris quand le déploiement a été SAUTÉ, où l'attendu est le
   dernier commit ayant touché `backend/**` (cf. F8). Restent hors de cette
   vérification : la santé applicative (une panne au boot se voit en 503, pas
   dans ce champ) et l'état des machines Fly.
4. **`deploy-fly` ne dépend pas du frontend ni du mobile** : un frontend rouge
   n'empêche pas un déploiement backend.
5. **`timeout-minutes` posé le 20/09/2026** sur les jobs de `ci.yml` (10 depuis le
   20/09/2026) et les 2
   workflows séparés (5 à 30 min, ≥ 3× la durée mesurée : un blocage rougit au
   lieu de patienter 360 min). **Reste ouvert : pas de `concurrency`** au niveau
   du workflow — seul `deploy-fly` a son groupe de concurrence, donc deux push
   rapprochés sur `main` font tourner deux runs en parallèle.
6. **`push` sur une branche de travail : aucun run** (§1). C'est un CHOIX de
   coût, pas un oubli : les 10 jobs rejouent ~13 min par push (Lighthouse, suite
   backend contre MongoDB, build mobile), et le premier signal vient de la PR —
   un push de travail n'est donc pas validé, il est seulement sauvegardé. Le
   repoindre ne se tait pas au moins : §1 le dit avant la liste des jobs, là où
   on lit « à chaque push ».
7. **CLOS (20/09/2026) — la CI a un audit de dépendances**, et son périmètre
   n'est écrit qu'une fois : **en tête du job `dependency-audit` de `ci.yml`**,
   avec le motif qui décide lequel des deux périmètres est un gate et lequel
   CONSTATE (`::warning` + résumé du run). Ce document y renvoie au lieu de le
   recopier : deux écritures d'une même politique sont deux politiques, et
   c'est la seconde qu'on oublie de mettre à jour.
8. **CLOS (20/09/2026) — la configuration SEO/analytics n'est plus seulement
   observée** : la sonde garde son mode informatif sur les PR (`::notice` par
   intégration absente, sur `main` uniquement), mais elle a un mode **strict**
   (`--strict`) que lance une fois par jour
   `.github/workflows/seo-production-probe.yml` : une intégration **requise**
   absente y rougit, une facultative non (cf. F9). Chaque page du sitemap est
   lue (canonical, title, description), et un échantillon borné
   (`MAX_JOB_PAGES` = 3) des fiches `/jobs/:id` est jugé sur ces trois mêmes
   métadonnées. Restent trois limites, elles réelles : l'échantillon des fiches
   ne couvre que jusqu'à 3 fiches sur un sitemap qui en admet 9 000 (et seulement
   celles listées au moment de la lecture ; carte OG et verrou 404 restent à
   `check-og-job-200.js`), le contrôle des pages du site ne suit que jusqu'à
   `MAX_PAGES` (20), et un `Age` de cache non
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
10. **CLOS (20/09/2026) — `frontend/scripts/audit_tdz.cjs` a un exécutant** : il
    était le seul garde du dépôt que rien ne lançait. Il est désormais un module
    (`analyserLeCode` / `analyserLeDepot`, exportés) doublé d'un CLI dont le
    **code de sortie vaut ce que vaut le verdict** (1 sur un TDZ certain). Son
    test (`scripts/__tests__/audit-tdz.test.js`) lance le CLI réel sur un arbre
    de fixture — `KOJO_TDZ_DIR` — et son propre import, donc il rougit à la fois
    quand la détection casse et quand le refus disparaît ; le registre porte
    `invoque_par: "test"` **et** une mutation rejouée
    (« tdz: classification directe neutralisee », rouge nommé `CARTES`).
    Ce que le garde protège est mesuré : une table lue avant sa déclaration dans
    le même scope est la classe de bug qui a vidé la page d'accueil.
11. **`frontend/scripts/check-og-reproducible.js` n'est pas un garde mais un
    OUTIL — et le registre le dit désormais** (`role: "outil"`, décision du
    20/09/2026). Un garde doit pouvoir REFUSER ; celui-ci imprime un `::notice`
    et sort sans verdict dès que l'interpréteur Python n'a pas Pillow ou que la
    police de référence manque. Un contrôle qui peut se taire hors de son poste
    ne peut pas être un gate : le registrer comme garde faisait dire à la
    couverture plus qu'elle ne prouvait. Il reste dans le dépôt (c'est le
    diagnostic à lancer à la main pour vérifier la régénération octet pour octet
    des PNG) et garde `hors_mutation`, avec ce motif.

12. **CLOS (20/09/2026) — chaque page a un test de RENDU.**
    `src/pages/__tests__/pages-render.test.jsx` monte chaque page et exige
    qu'elle se rende sans lever, avec un contenu non vide. La liste des pages est
    **dérivée** (`import.meta.glob('../*.js')`) : une page ajoutée entre dans le
    tour sans que personne touche au fichier — une liste recopiée aurait
    reproduit le défaut qu'elle surveille. Son premier run a trouvé un vrai
    défaut du même genre que l'incident de l'accueil : `Profile.js` lisait
    `user.first_name` alors que `user` peut redevenir nul le temps d'une
    déconnexion (écran blanc attrapé par l'ErrorBoundary) — la page rend
    maintenant son squelette dans ce cas. Ce que ce fichier est : un test de
    FUMÉE. Il ne remplace pas les tests de comportement (4 fichiers), et il ne
    remplace pas un navigateur : les parcours restent vérifiés à la main (§7.1).
13. **CLOS (20/09/2026) — le registre des gardes classe TOUT script du dépôt.**
    Le périmètre de l'exhaustivité était déduit du NOM (`check-`, `audit_`) : un
    outil nommé `dmarc_policy.py`, `setup-seo-env.js` ou `lhci-cls-budgets.cjs`
    échappait donc à la règle, et la décision « est-ce un garde ? » se prenait en
    choisissant un nom de fichier. Le périmètre est désormais le RÉPERTOIRE
    (`frontend/scripts`, `.github/scripts`, `backend/scripts`) : tout script est
    déclaré avec son rôle, `garde` ou `outil`, et un outil porte son motif. Les
    huit scripts que ce changement fait apparaître sont classés — dont
    `frontend/scripts/validate-vercel-json.mjs`, déclaré **garde** (il sort en 1
    sur un `vercel.json` que Vercel refuserait) et prouvé par une mutation
    rejouée (`validate-vercel-json: propriete interdite dans un item rewrites
    toleree` → le test propriétaire rougit, nommé).
14. **CLOS (20/09/2026) — la CI n'écrit plus en production.** Le cycle
    `/jobs/:id` de `check-og-job-200.js` CRÉE puis SUPPRIME une mission : sa
    capacité était déduite de l'adresse de la BASE servie (`localhost`), pas du
    BACKEND écrit. Sur une PR dont la preview Vercel était résolue, la pile locale
    n'était pas montée, `KOJO_BACKEND_URL` retombait sur son défaut — l'API de
    PRODUCTION — et la mission de test était créée en base réelle puis supprimée
    (un échec de nettoyage y laissait une annonce visible). Le contrôle porte
    maintenant sur la seule adresse que le script écrit (`isControlledBackend` :
    loopback uniquement) ; hors de là il se tait avec un `::notice` nommant la
    raison. Contrepartie assumée : sur une PR dont la preview est auditée, le
    chemin 200 n'est plus exercé par ce script (il l'est sur la pile locale — ce
    que `main` monte depuis le 20/09/2026 — et en processus par
    `backend/tests/test_job_og_cycle.py`).

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
