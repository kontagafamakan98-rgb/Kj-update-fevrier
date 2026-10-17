# Audit — les vérifications de la CI qui ne bloquent pas

Date : 12/10/2026. Méthode : mesures sur le dépôt ET sur l'historique réel des
runs (`gh`, lecture seule), pas des intentions. Chaque ligne dit ce qu'un échec
**coûterait** s'il devenait bloquant.

## 1. La frontière réelle du gate, mesurée

`gh api repos/…/branches/main/protection` (12/10/2026) : la protection de branche
exige **huit** checks nommés, `strict: true` (branche à jour exigée) :

1. Audits détectent les régressions
2. Backend tests (Python + MongoDB)
3. Fly env doc-prod (drift + secrets)
4. Frontend tests + build (Node/Vite)
5. Lighthouse performance budgets
6. Mobile build (Capacitor + Android)
7. Workflow lint (actionlint + shellcheck)
8. Deploy backend to Fly.io

`ci.yml` déclare **onze** jobs. Trois sont donc **hors** de la protection :

| Job | Ce qu'il vérifie | Fréquence d'échec mesurée (30 derniers runs de `ci.yml`) |
|---|---|---|
| `E2E Playwright tests (Chromium)` | 315 cas navigateur (parcours, LCP, CLS, tiers, coquilles) | **15 rouges / 27 exécutions** |
| `Dépendances (avis de sécurité)` | avis haut/critique sur les dépendances | **6 rouges / 30** |
| `Bundle size report (PR comment)` | rapport de taille, commentaire de PR | 0 rouge (jamais) |

Deux conséquences, toutes deux mesurées :

- **Une fusion manuelle passe avec ces jobs rouges.** Cas réel : la PR #158
  (branche `feat/design-ux-accueil`) a été **fusionnée le 11/10/2026 à 04:32**
  alors que son run de 02:31 portait la suite e2e **rouge**, dont un cas
  **réel** (« /how-it-works — mobile : le navigateur a élu `<P>` …, qui n'est pas
  l'élément déclaré par le plan »).
- **La livraison automatique, elle, les attend déjà.** `attendre_checks_ci`
  (`.github/scripts/livrer.py`) parcourt **tous** les `check-runs` du commit de
  tête et refuse la fusion dès qu'un seul n'est pas `success`/`skipped`/`neutral` —
  la protection de branche et le trajet de livraison ne jugent donc pas le même
  périmètre. Ce que la livraison paie déjà, la protection ne le garantit pas.

> `gh run view <id> --log-failed` confirme que les rouges e2e **nomment** leur
> cause ; ce ne sont pas des « échecs » anonymes.

### 1 bis. Appliqué le 16/10/2026 — et les deux périmètres ne sont plus deux

Les deux décisions de §2.1 et §2.2 ont été **appliquées**, et la divergence qui
les rendait nécessaires a été **fermée** plutôt que documentée :

- **Le réglage GitHub est posé.** `gh api …/branches/main/protection` relu après
  le `PUT` du 16/10/2026 : **dix** `contexts` — les huit d'origine plus
  `Dépendances (avis de sécurité)` et `E2E Playwright tests (Chromium)` —
  `strict: true`, `enforce_admins: true`, et tous les autres réglages inchangés
  (revues de PR exigées, `allow_force_pushes: false`, `allow_deletions: false`,
  `required_linear_history: false`, `lock_branch: false`).
- **La liste vit une seule fois** : `.github/scripts/gate-perimetre.json` porte
  les dix checks (identifiant de job + nom que GitHub rapportera) et l'exemption
  motivée de `Bundle size report (PR comment)`. Les deux chemins la lisent : la
  protection par le réglage ci-dessus, la livraison par un **import** de la règle
  (`.github/scripts/perimetre_gate.py`). `livrer.py` n'attend donc plus « tous les
  `check-runs` » mais **exactement ces noms** — un check-run hors liste est dit
  ignoré, jamais compté comme un vert.
- **La dérive ne peut plus être silencieuse, et elle est jugée des deux côtés :**
  hors ligne par `.github/scripts/check-gate-perimetre.py`, étape de
  `workflow-lint` (un check requis : le garde tourne dans un job du périmètre) —
  un nom de check-run dérivé, un job de `ci.yml` ni déclaré ni exempté, une
  exemption périmée, muette ou menteuse, un `strict` non déclaré sont refusés, et
  le garde refuse de conclure sous ses planchers de lecture (8 checks, 10 jobs
  lus) ; en ligne par le **pré-vol de `livrer.py`**, qui compare la protection
  RÉELLE à la déclaration avant de pousser (jeton admin requis : un jeton qui ne
  peut pas lire la protection est un refus nommé, pas un vert).
- **Mesure du 16/10/2026** : `python .github/scripts/check-gate-perimetre.py` →
  `[OK]` (10 checks déclarés, 1 exemption motivée, 11 jobs lus dans `ci.yml`) ;
  le même garde avec `--en-ligne` → `[OK] La déclaration, ci.yml et la protection
  de main attendent les mêmes 10 vérification(s)`.
- **Preuve d'échec** : `backend/tests/test_gate_perimetre.py` (**44 cas**, dont
  six sur la LIVRAISON elle-même, `appel_github` remplacé dans le module) et
  **huit mutations** du registre rejouées `[OK]`, chacune rougissant son cas nommé
  (verdict du CLI annoncé vert, nom de check dérivé toléré, job non couvert
  toléré, check absent de la protection toléré, plancher de lecture neutralisé,
  motif d'exemption trop court toléré, livraison acceptée sans périmètre déclaré,
  check hors périmètre ignoré en silence).

## 2. Décisions, surface par surface

### 2.1 `Dépendances (avis de sécurité)` → **devient un gate**

- Mesure : 6 rouges sur 30 runs, tous le 07/10/2026, tous sur des avis de
  **PRODUCTION** (`npm audit --omit=dev --audit-level=high` : `3 vulnerabilities
  (1 high, 2 critical)`, correctif disponible) — et ces PR ont été fusionnées.
- Coût d'un échec aujourd'hui : **nul**. Rejoué le 12/10/2026 :
  `npm audit --omit=dev --audit-level=high` → `found 0 vulnerabilities` (exit 0)
  et `npm audit --audit-level=high` (dev incluses) → `found 0 vulnerabilities`.
- Coût d'un échec demain : une fusion attend la correction (ou une exception
  écrite) d'un avis critique. C'est exactement l'intention.
- **Décision : ajouter le check aux vérifications requises.**

### 2.2 `E2E Playwright tests (Chromium)` → **devient un gate**

- Mesure : 15 rouges / 27 exécutions. Contenu du dernier rouge
  (run `38105408599`, 11/10 02:31) : 3 échecs sur 315 cas — « rotation du héros,
  cran par cran » (30,2 s), « /profile — mobile » (aire LCP 16 215 px² au-dessus
  de la bande mesurée 6 700–14 000), « /how-it-works — mobile : l'élément élu
  porte la géométrie déclarée ». Le troisième est une régression **de code**
  (un élément élu que le propriétaire unique ne décrit pas), et il était déjà
  rouge le 07/10.
- Coût d'un échec : les runs concernés ne pourraient plus être fusionnés — soit
  les corrections déjà faites, soit l'investigation des deux cas sensibles à
  l'hôte (rotation du héros, bande LCP de `/profile`). Le dépôt sait déjà le
  faire (`e2e/helpers/attentes.js` : attentes de condition nommées, jamais
  d'horloge).
- **Fiabilisation des deux cas sensibles à l'hôte (12/10/2026), mesure à
  l'appui.** Ni l'un ni l'autre ne venait du code, et les deux ont été reproduits
  sur ce poste avant d'être corrigés :
  - **Rotation du héros** : React repose la source COURANTE sur le nœud de la
    coquille au montage, et cet enregistrement tombe **après** la lecture du
    départ sur un hôte chargé. Rejoué sous une bride CPU ×6 (même protocole,
    même sonde) : lecture du départ à `t=5 205 ms` avec `src` et journal
    **vides**, enregistrement de montage à `t=5 601 ms`, crans ensuite à 15 s.
    La lecture en place publiait alors `[1re photo, 2e, 3e]` au lieu de
    `[2e, 3e]` — le rouge de la CI, mot pour mot — et la règle corrigée publie la
    bonne suite, en ancrant le premier intervalle sur le montage (écarts mesurés
    `15 185,8` / `15 004 ms`). Les deux cas de la sonde restent verts, inchangés,
    sur un hôte au repos.
  - **Bande d'aire LCP de `/profile` mobile** : l'aire LCP est une aire de
    **texte**, et elle suit les polices de l'hôte — la cause est celle que
    l'angle du 26/09/2026 de `CI-COVERAGE.md` avait déjà mesurée (jusqu'à −18 %
    d'encre à boîte **identique**). Même élément, même phrase : **11 211 px²** ici
    (deux lignes) et **16 215** sur le runner (trois lignes) ; la classe est
    reproduite sur ce poste en élargissant la police de l'élément élu (~15 000 px²,
    trois lignes). Le relevé du runner est donc entré dans la table comme un
    **run** de la cellule (jamais moyenné) et la bande se dérive de lui :
    **9 700–20 300 px²**, qui contient les deux hôtes, refuse l'effondrement
    (5 000) et refuse toujours un peintre de la taille d'une section (69 920). Le
    message d'échec nomme désormais l'élément élu **vivant**, sa boîte et la police
    appliquée — vérifié en mutant la table : code 1 et diagnostic publié.
- **Décision : ajouter le check aux vérifications requises**, après quoi un rouge
  e2e ne pourra plus être ignoré par une fusion manuelle.

### 2.3 `Bundle size report (PR comment)` → **n'est pas une vérification**

- Mesure : 0 rouge en 30 runs, 3 sauts (il dépend de l'artefact de
  `frontend-build`). Il ne vise pas à bloquer (commentaire de PR).
- Le budget réel — `check-bundle-size.js` — vit **dans** `frontend-build`, qui est
  requis : la taille est donc déjà un gate.
- **Décision : reste un rapport.** Ni gate, ni suppression : il n'a jamais
  prétendu vérifier, et le supprimer ôterait une lecture (l'écart vs `main`).

### 2.4 `check-retard-main.js` → **reste un signal**

- Mesure : il ne publie que des `::notice` sans borne déclarée ; l'exigence réelle
  — « la branche est à jour » — est tenue par `strict: true` de la protection
  (mesuré ci-dessus), donc elle **est** un gate, ailleurs.
- **Décision : inchangé** (sa raison est déjà écrite dans son commentaire).

### 2.5 `check-email-auth.py` sans identifiants → **devient un gate** (appliqué)

- Mesure : les deux secrets sont posés (`KOJO_PROBE_IMAP_USER/PASSWORD`,
  18/09/2026) et la sonde **tourne réellement** sur `main` (journal du 11/10 :
  `spf=pass dkim=pass dmarc=pass`). Le chemin « sans identifiants » publiait une
  `::notice` et sortait en 0 — dans un job **requis**, donc un vert y était lu
  « les trois verdicts ont été lus ».
- Coût d'un échec : nul aujourd'hui (les secrets existent) ; demain, un secret
  retiré fait rougir `main` en nommant les deux variables au lieu d'éteindre la
  sonde en silence.
- **Appliqué** : `--require-secrets` (passé par `ci.yml` sur `main` seulement),
  testé, et la mutation « drapeau retiré » comme « mode strict neutralisé »
  rougissent le test dédié. Un poste sans secrets garde l'annulation explicite.

### 2.6 Formats des secrets déployés (SSH) → **gate d'observabilité** (appliqué)

- Mesure : les trois derniers pushs de `main` ne portent **ni** `[OK]` **ni**
  `[WARN]` sur ce contrôle — `read_secrets_via_ssh` n'écrivait sa ligne qu'en cas
  d'EXCEPTION, jamais quand `flyctl ssh` rendait une sortie vide sans erreur. Un
  lecteur du run ne pouvait donc pas distinguer « vérifié » de « sauté ».
- Coût d'un échec : nul (le contrôle est de toute façon opportuniste : pas de clé
  SSH sur le runner, angle F4).
- **Appliqué** : les deux issues sont nommées dans le journal (`[OK] formats des
  N secret(s) vérifiés` / `[AUCUN VERDICT] … NON vérifiés`), chacune prouvée par
  mutation. Le rendre *bloquant* exigerait une clé SSH sur le runner : hors de
  cette passe.

### 2.7 `sdkmanager --licenses || true` (`mobile-build`) → **reste une installation**

- Ce n'est pas un verdict : le gate du job est `gradlew assembleDebug`, qui échoue
  si l'outillage manque. Avaler l'invite interactive évite un rouge d'outillage.
- **Décision : inchangé** — et depuis le 12/10/2026 cette forme est DÉCLARÉE,
  avec ce motif, dans `.github/scripts/informative-steps.json` (cf. §2.12) :
  l'exception reste possible, elle n'est plus anonyme.

### 2.8 `lighthouse-mesure-locale.yml` → **instrument, jamais déclenché**

- Mesure : **0 run depuis sa création** (tout l'historique).
- **Décision : reste** (coût nul quand personne ne le lance ; sa mesure de
  dispersion est déjà consignée dans CI-COVERAGE.md §7). Si un jour une dérive de
  dispersion doit bloquer, c'est un budget `lighthouserc*.cjs` qu'il faudra
  écrire, pas ce workflow.

### 2.9 `seo-vercel-env.yml` (variable manquante → `::warning`) → **reste**

- Mesure : 4 runs, 2 rouges (18–19/09, valeurs pas encore posées).
- Le gate est ailleurs, et il est double depuis le 12/10/2026 : la sonde SEO
  **stricte** tourne chaque jour (06:17) **et** juste après chaque déploiement
  (`frontend-build`, push sur `main`). Le `::warning` dit seulement qu'un run
  manuel n'a posé qu'une partie des valeurs.
- Le mode **informatif** de la sonde (son mode par DÉFAUT) ne peut plus revenir
  sur une PR : `.github/scripts/check-seo-probe-strict.py`, dans le job REQUIS
  `workflow-lint`, refuse toute invocation hors `--strict` — et une étape stricte
  qui ne peut pas échouer. C'est le seul point de cette section où la
  vérification *est* un gate, et il l'est parce que le silence, lui, était
  invisible (§3 F9). Depuis le 12/10/2026, la FAMILLE est fermée et pas
  seulement cette instance : `.github/scripts/check-informative-steps.py`
  inventorie les trois syntaxes qui rendent une étape incapable d'échouer sur
  TOUT `.github/workflows/` et exige une déclaration motivée par forme (§2.12).

### 2.10 `Deploy backend to Fly.io` — requis, mais **sauté 24 fois sur 30**

- Le job est dans les 8 checks requis, et pourtant il est `skipped` dans 24 des
  30 derniers runs (le filtre de chemins saute `flyctl deploy` quand aucun
  `backend/**` n'a bougé ; le job reste exigé, il ne déploie simplement pas).
- Conséquence mesurée : « 8 checks requis » ne veut **pas** dire « 8 vérifications
  à chaque PR » — sur un push frontend, la révision backend n'est pas vérifiée.
- **Décision : inchangé** (angle 2 assumé, et la vérification a bien lieu quand
  quelque chose a bougé). Cette ligne existe pour que le compte de 8 ne se lise
  pas comme 8 vérifications effectives.

### 2.11 Notice « Backend déployé / NON déployé » (`deploy-fly`) → **reste**

Information, pas verdict : elle empêche de lire « main est vert » comme « la
production tourne le code de `main` ».

### 2.12 La syntaxe « étape qui ne peut pas échouer » — **inventoriée, jugée, déclarée**

- **Motif** : F9 avait une cause unique — une étape qui publie un rapport sans
  pouvoir faire rougir le run — et la sonde SEO n'en était qu'une INSTANCE. La
  syntaxe qui la produisait (`continue-on-error: true`, commande neutralisée
  `|| true`/`|| :`/`|| exit 0`, `set +e`) est disponible dans n'importe quelle
  étape, et rien n'empêchait d'en reposer une ailleurs : step vert, rapport
  publié, aucun run rouge.
- **Mesure** : `.github/scripts/check-informative-steps.py --list` lit les
  **6 workflows** ligne à ligne (blocs scalaires dépliés, continuations `\`
  recollées, commentaires YAML et shell exclus) : **7 formes sur 153 étapes
  lues** — **155 depuis**, les deux étapes ajoutées après ce relevé (le corpus de
  production dans `frontend-build`, puis le canari de forme) en ayant chacune
  ajouté une. Aucune n'était un défaut, et quatre relèvent de la même décision :
  - **4 harnais de mutation** (`audit-regression-test`) — `set +e` (×3) et une
    capture `grep … || true` : l'échec de la commande encadrée est le résultat
    ATTENDU, et le verdict de l'étape est l'assertion explicite qui suit
    (`if [ "$EXIT_CODE" -eq 0 ]` / `if [ -z "$UNDEFINED" ]` → `exit 1`) ;
  - **`|| true` d'extraction** (`dependency-audit`, pip-audit) : `grep` sans
    correspondance n'est pas un avis ; l'étape finit par `exit 1` dès que
    pip-audit sort non nul — verdict de tableau ou pas ;
  - **`kill` d'un PID déjà sorti** (`lighthouse-ci`, nettoyage `if: always()`) :
    le verdict de l'étape reste `check-test-environment.js`, sous `set -e` ;
  - **invite `sdkmanager --licenses`** (`mobile-build`) : §2.7.
- **Correction appliquée** : la seule surface qui PRÉTENDAIT vérifier sans
  pouvoir le dire — l'étape pyflakes de `backend-tests` — compte son corpus
  (plancher 20 fichiers), capture le code de pyflakes sans l'avaler, et REFUSE un
  sans-verdict (traceback, « No module named », sortie d'un processus mort) : les
  diagnostics sont reconnus par leur motif `:ligne:colonne: `, un chemin absolu
  portant lui-même un `:`, ce qu'un ancrage sur le début de ligne confondait avec
  un sans-verdict. Les « imported but unused » restent hors du gate, PUBLIÉS.
- **Le garde, et sa portée** : `.github/scripts/check-informative-steps.py`
  (step du job REQUIS `workflow-lint`) exige qu'une forme soit déclarée avec son
  motif dans `.github/scripts/informative-steps.json` — 40 caractères minimum —,
  et refuse une forme non déclarée, une déclaration périmée, un nombre
  d'occurrences qui change, une forme inconnue, un registre illisible ; il refuse
  de conclure sous 40 étapes lues. Il juge aussi la ligne de l'item
  (`- run: … || true`, étape sans `name:`). Preuve :
  `backend/tests/test_informative_steps_guard.py` (22 cas) et **4 mutations**
  rejouées `[OK]` (détection neutralisée, déclaration périmée tolérée, nombre non
  vérifié, plancher neutralisé).
- **Ce qu'il ne couvre pas, écrit pour ne pas être pris pour couvert** : qu'un
  SCRIPT soit informatif par construction (son mode par défaut ne bloque pas) ne
  se lit pas dans la syntaxe d'un workflow — ces surfaces ont leur propre garde
  quand elles en méritent un (§2.5, §2.9) ou une décision écrite ici.
- **Décision : les 7 formes restent ; elles sont déclarées.** Une nouvelle forme
  non déclarée fait rougir `workflow-lint` en la nommant.

### 2.13 Hors CI : des outils déjà classés, pas des vérifications

`check-og-reproducible.js`, `mesure-alignement-app.mjs` et la mesure Lighthouse
locale ne tournent **pas** dans la CI : ils n'impriment aucun verdict et exigent
un poste outillé. Ils sont déjà `role: "outil"` dans
`.github/scripts/guard-proofs.json` et nommés dans les angles 8, 9 et 10 de
CI-COVERAGE.md — décision : **ils restent des outils**, ni gate ni suppression.
Même lecture pour `audit_docstrings.py` : son « avertissement non bloquant » est
un défaut **local**, la CI le lance en `--fail-on-warning` (donc bloquant).

### 2.14 Sondes de production : un corpus VIDE → `::warning` **déclaré**, jamais un vert muet

- **Mesure (12/10/2026)** : la production ne servait **aucune mission vivante** —
  `GET /api/jobs?status=open` → `[]`, sitemap de **8 URL dont zéro fiche**,
  `/api/public/stats` → `open_jobs: 0, completed_jobs: 0, reviews: 0` — et trois
  sondes sortaient en **0** en annonçant chacune, en `::notice`, qu'elles n'avaient
  rien pu mesurer : `check-og-images.js` (« aucune mission en base … la branche 200
  n'a PAS été exercée »), `check-og-job-200.js` (« cycle IGNORÉ » : le déploiement
  réel n'est pas une adresse que ce job contrôle, et la CI n'écrit pas chez le
  client) et `check-seo-production.js` (« 0 fiche jugée », en `--strict` compris).
  Trois phrases, une seule vérité — « je n'ai rien mesuré » — et aucun run qui la
  rende visible : c'est la forme de silence de F9.
- **Décision** : le corpus est DÉCLARÉ (`frontend/scripts/corpus-missions.js` :
  plancher, statuts, lecture) et chaque surface aveugle est DÉCLARÉE avec son
  chemin, son motif (≥ 40 caractères), son remède et sa date. Une sonde qui
  atteint cet état publie un **`::warning`** — bruyant, et volontairement NON
  bloquant pour un état de données (une sonde rouge en permanence est une sonde
  qu'on apprend à ignorer) — et **REFUSE** (sortie 1) si la surface n'est pas
  déclarée : là, ce n'est plus un état de données mais un défaut de CODE.
- **Le garde** : `frontend/scripts/check-corpus-missions.js` (step de
  `frontend-build`, un check requis) balaie TOUT `frontend/scripts/` et refuse une
  lecture du corpus par une sonde NON déclarée (une sonde ajoutée demain est
  couverte sans être inscrite nulle part ; les mentions en COMMENTAIRE ne comptent
  pas — trois fichiers en parlent en prose), une déclaration PÉRIMÉE (surface que
  sa sonde ne demande plus, sonde qui ne lit plus le corpus), une déclaration
  MUETTE (sonde qui ne consulte pas le registre, ou qui ne publie aucun
  `::warning`), un motif, un remède ou une date trop courts pour dire quelque
  chose, une exemption de registre sans sujet, et il refuse de conclure sous ses
  planchers de lecture (30 fichiers, 3 sondes, 3 surfaces, 1 corpus).
- **Preuve** : `frontend/scripts/__tests__/check-corpus-missions.test.js`
  (**28 cas**, dont une arborescence cassée en bac temporaire et le CLI exécuté
  en sous-processus) et **5 mutations** rejouées `[OK]` : refus d'une surface non
  déclarée neutralisé, lecture non déclarée tolérée, planchers neutralisés,
  avertissement d'une sonde neutralisé, balayage vidé.
- **Ce que la décision ne fait PAS, écrit pour ne pas être pris pour couvert** :
  le `::warning` ne bloque aucune fusion — il rend l'état public à chaque run ; et
  une surface DÉCLARÉE n'est pas pour autant mesurée ailleurs (son remède dit où
  elle l'est : la pile locale de la CI, un test en processus, ou une mission à
  publier).

### 2.15 La FORME d'une fiche `/jobs/:id` rendue mesurable au lieu d'être déclarée

**Le fait, et le trou qui restait ouvert après 2.14.** Le 12/10/2026, la forme du
document qu'un crawler lit d'une fiche — `<title>`, `meta description`, `robots`,
`canonical`, `og:url`, `twitter:url`, `og:title`, `<h1>` statique — n'était jugée
NULLE PART : `check-og-images.js` et `check-seo-production.js` lisent des missions
EXISTANTES (et, correctement, publient un `::warning` quand il n'y en a aucune),
et `check-og-job-200.js` n'exerce le chemin 200 que sur une base que le job
contrôle, en n'y jugeant que les cartes. La forme dépendait donc de l'état des
DONNÉES du client : un jour sans mission était un jour de silence — précisément
les jours où la demande de travail est faible.

**La décision : fabriquer la mission qu'on juge.**
`frontend/scripts/check-job-form-canari.js` CRÉE sa mission de contrôle
(`POST /api/jobs`, étiquette `[CI]`), juge la fiche SERVIE (le document réellement
servi par le rewrite, cartes OG comprises, par `runOgImageCheck`), la SUPPRIME
toujours, puis exige le verrou d'après-suppression (404 + noindex, carte OG 404,
absente du sitemap) — et la contrepartie qui rend ce verrou non vide : la mission
doit être LISTÉE dans le sitemap avant sa suppression. Les règles qu'il réutilise
ne sont pas recopiées : charge utile, jeton, lecture du sitemap et verrou
appartiennent à `check-og-job-200.js`, les balises à `site-meta.js`, les cartes à
`runOgImageCheck`.

**Le mandat d'écriture, parce que la règle du 20/09/2026 tient toujours.** Le
cycle ÉCRIT, et c'est cette confusion — l'adresse AUDITÉE avait décidé de
l'adresse ÉCRITE — qui avait créé une mission de test en base réelle depuis une PR.
La question est donc posée à la seule adresse que la sonde MODIFIE : écriture
libre sur un backend loopback (la pile locale du job, où le canari tourne à chaque
run), et en production SEULEMENT sous mandat délibéré
(`KOJO_CANARI_ALLOW_WRITE=1`) — jamais posé par un run de PR. Sans mandat, la
sonde saute et le DÉCLARE : surface `job-form-canari:forme` au registre, publiée
en `::warning` (motif, remède, date), et REFUS (sortie 1) si la surface n'y est
plus.

**Mesures du 16/10/2026.** Cycle complet rejoué sur une pile locale par de vraies
requêtes HTTP : création → forme jugée (0 défaut) → cartes 1200×630 et 1200×1200
en PNG → mission listée au sitemap avant suppression → suppression → verrou
(404 + noindex, carte 404, sitemap sans la mission), **sortie 0**. Chemin d'échec
mesuré : la même pile servant un `x-robots-tag: noindex` sur une fiche vivante fait
sortir la sonde en **1**, en nommant le défaut (« fiche d'une mission VIVANTE en
NOINDEX ») et en supprimant quand même sa mission. Contre le déploiement réel sans
mandat : **sortie 0**, aucun écrit, et le `::warning` déclaré dans le résumé.
Relevé des gardes après la passe : `check-corpus-missions.js` **4 sondes / 4
surfaces** (77 fichiers balayés), `check-informative-steps.py` **7 formes sur 155
étapes**, `check-script-deps.js` 149 scripts, `check-juges-de-temps.js` vert.
**Preuve** : `frontend/scripts/__tests__/check-job-form-canari.test.js` (**35 cas**
— la règle de forme cas par cas sur un document injecté, le cycle sur un `fetch`
injecté, le mandat, le nettoyage et le verrou) et **3 mutations** rejouées `[OK]`
(mandat non vérifié, défauts de forme non remontés, canonical d'une autre page
toléré), restaurations vérifiées à l'empreinte SHA-1 identique.

**Ce que le canari ne couvre PAS, écrit pour ne pas être pris pour couvert** : la
forme des missions du CLIENT (leurs textes, leurs cas limites) reste lue là où le
corpus est réel, et les deux surfaces de 2.14 restent déclarées aveugles quand il
n'y en a pas — le canari juge la forme d'UNE fiche, il ne publie pas de corpus.

## 3. Ce qui n'est pas fait ici, et pourquoi

- **Les deux réglages de protection de branche sont APPLIQUÉS** (16/10/2026, cf.
  §1 bis) : c'est le seul geste de cet audit qui change GitHub et pas le dépôt, et
  il a été fait après l'accord du propriétaire — relu après coup, dix `contexts`,
  `strict: true`, tous les autres réglages inchangés.
- **La jonction des deux périmètres est FERMÉE, pas seulement documentée.** La
  première version de cette ligne proposait deux moitiés de remède (élargir la
  protection, ou restreindre `livrer.py` aux checks requis) et laissait la
  seconde « relâcher la livraison ». Le 16/10/2026, c'est la première qui a été
  suivie jusqu'au bout, **et** `livrer.py` a cessé d'attendre « tous les
  `check-runs` » : les deux périmètres lisent désormais la MÊME déclaration
  (`.github/scripts/gate-perimetre.json`, importée par les deux via
  `perimetre_gate.py`), donc il n'y a plus deux listes à garder d'accord — et ce
  qui reste est jugé par un garde (`.github/scripts/check-gate-perimetre.py`,
  étape de `workflow-lint`) et par le pré-vol de la livraison. Détail et mesures :
  §1 bis ; décision surface par surface : §2.1 (avis de sécurité) et §2.2 (e2e).
- **Ce que la déclaration ne juge pas, écrit pour ne pas être pris pour
  couvert** : elle ne dit pas si un check requis est effectivement VERT sur un
  run donné (c'est le rôle de la CI), ni si un job DEVRAIT être un gate — chaque
  exemption porte son motif, et les décisions surface par surface vivent ici. Et
  un job exempté qui disparaîtrait de `ci.yml` fait rougir le garde
  (« exemption PÉRIMÉE ») : une exemption ne survit pas à sa cause.

## 4. Mesures brutes (rejouables)

```bash
# la frontière du gate
gh api repos/kontagafamakan98-rgb/Kj-update-fevrier/branches/main/protection \
  --jq '.required_status_checks.contexts[]'

# le périmètre déclaré contre ci.yml (hors ligne, ce que la CI juge)
python3 .github/scripts/check-gate-perimetre.py

# ... et contre la protection RÉELLE de main (jeton admin ; ce que livrer.py fait avant de pousser)
GH_TOKEN=$(gh auth token) python3 .github/scripts/check-gate-perimetre.py --en-ligne

# l'état des jobs sur les 30 derniers runs de ci.yml
gh run list -R kontagafamakan98-rgb/Kj-update-fevrier --workflow ci.yml --limit 30 \
  --json databaseId,conclusion,event

# les avis de sécurité, aujourd'hui, dans les deux périmètres
cd frontend && npm audit --omit=dev --audit-level=high ; npm audit --audit-level=high

# la cause d'un rouge e2e (elle est nommée, cas par cas)
gh run view <id> -R kontagafamakan98-rgb/Kj-update-fevrier --log-failed

# l'inventaire des étapes qui ne peuvent pas échouer, sur tous les workflows
python3 .github/scripts/check-informative-steps.py --list   # puis sans --list : le verdict

# le corpus de production et les surfaces aveugles DÉCLARÉES (leur ::warning)
cd frontend && node scripts/check-corpus-missions.js
cd frontend && node scripts/check-seo-production.js --strict    # publie le ::warning de la section « fiches »

# la FORME d'une fiche /jobs/:id, jugée sur une mission de CONTRÔLE (création →
# jugement → suppression) : sur la pile locale sans mandat, et contre le
# déploiement réel seulement avec KOJO_CANARI_ALLOW_WRITE=1
cd frontend && node scripts/check-job-form-canari.js

# les sondes de production : fréquence réelle de leurs rouges
gh run list -R kontagafamakan98-rgb/Kj-update-fevrier --workflow seo-production-probe.yml --limit 30
```

Relevés du 12/10/2026, pour mémoire : `seo-production-probe` **22 verts / 3 rouges**
(les rouges sont les 19–20/09, avant la pose des valeurs) ; `backend-health-probe`
**19/19 verts** ; `session-reload-production-probe` **1 run, 1 rouge** (11/10 : la
session ne survit pas au rechargement en production — rouge **réel**, pas du
bruit) ; `lighthouse-mesure-locale` **0 run** ; `seo-vercel-env` **4 runs, 2 rouges**
(18–19/09).
