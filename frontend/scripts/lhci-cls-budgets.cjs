/**
 * Budgets CLS PAR ROUTE de Lighthouse CI — la table mesurée, et sa matrice.
 *
 * ── Pourquoi une table par route ────────────────────────────────────────────
 * `ci.assert.assertions` n'accepte qu'UN jeu de budgets pour TOUTES les URLs :
 * le plafond CLS était donc global (0,15), calibré sur /jobs (0,135) et
 * l'accueil (0,056). Il n'attrapait qu'un EFFONDREMENT — pas la régression fine
 * que les PR #19/#20 ont corrigée (0,0165 → 0,0088 sur /register, 0,0012 sur
 * /forgot-password). Mesurer par route exige `assertMatrix`, exclusif de
 * `assertions` et d'`aggregationMethod` (@lhci/utils/src/assertions.js lève
 * « Cannot use assertMatrix with other options ») : l'entrée globale sans motif
 * porte donc les autres budgets, et chaque route porte le sien.
 *
 * ── Deux statistiques, parce que les grandeurs ne se comportent pas pareil ──
 * L'AGRÉGATION est choisie par entrée, selon ce que la grandeur décrit :
 *   • le socle global (score, FCP, LCP, TBT) est mesuré au MEILLEUR des 3 runs
 *     (`optimistic`) : ces grandeurs dépendent du CPU du runner, dont le bruit
 *     est UNILATÉRAL — une machine chargée ne peut qu'AJOUTER du temps. Le
 *     meilleur run décrit donc le coût propre de l'artefact, quand une
 *     régression, elle, monte dans les trois runs ;
 *   • le CLS par route reste sur la MÉDIANE (`median`) : c'est une propriété du
 *     DOM et du CSS, pas de la machine — relevé identique d'un run à l'autre
 *     (0 / 0,009 / 0,045 selon la page, 3 runs par page le 19/09/2026), donc la
 *     médiane y est à la fois stable et la plus stricte.
 *
 * ── Pourquoi le socle n'est PAS sur la médiane (mesuré le 20/09/2026) ─────
 * Deux jobs de `main` portant le MÊME arbre (14e0531) : l'un vert (08:10),
 * l'autre rouge (08:50), verdict décidé par la SEULE assertion
 * `categories:performance >= 0,9` sur `/login` — 0,79 de médiane, runs à
 * 1,00 / 0,79 / 0,77. Les budgets explicites (FCP, LCP, TBT, CLS), eux, sont
 * passés dans LES DEUX jobs. Ce qui a bougé n'est pas l'artefact :
 *
 *   /login, 3 runs  score   FCP   LCP   TBT   Script Evaluation   plus longue tâche
 *   job vert        0,99   1386  2361    23   174 ms             71 ms
 *   job rouge       0,79   1400  1774   890   995 ms             908 ms   (run 3)
 *                   (run 1 : score 1,00, TBT 0 ms)
 *
 * Mêmes octets, même page, et 5,7× de temps d'évaluation de script : la machine
 * a faim. Le score est une moyenne pondérée où le TBT pèse 30 % : cette famine
 * le traverse — pendant que le budget TBT, lui, restait à 74 % de son plafond.
 * Une médiane sur 3 runs ne peut pas distinguer « un run sur trois a souffert »
 * de « la page a régressé » ; le meilleur des 3 le peut.
 *
 * ── Les valeurs sont MESURÉES, pas choisies ────────────────────────────────
 * Relevé des rapports Lighthouse réellement archivés par les jobs de `main` et
 * de PR (artifacts `lighthouse-reports` : 3 runs par page et par job, agrégation
 * par MÉDIANE comme en CI). Valeurs CLS par run, 9 jobs de main + 8 jobs de PR :
 *
 *   route             base        runs  valeurs mesurées            budget
 *   /                 prod          27  0,0000 ×27                  0,01
 *   /                 repli local   24  0,0000 ×24                  0,01
 *   /register         prod          27  0,0088 ×27                  0,015
 *   /forgot-password  prod          27  0,0000 ×27                  0,01
 *   /login            prod          18  0,0000 ×17, 0,1762 ×1       0,02
 *   /how-it-works     prod          18  0,0000 ×18                  0,01
 *   /support          prod          18  0,0000 ×18                  0,01
 *   /jobs             prod          27  0,0000 ×27                  0,01
 *   /dashboard        prod          27  0,0450 ×27                  0,06
 *   /payment          prod          18  0,0450 ×18                  0,06
 *   /profile          prod          27  0,0450 ×27                  0,06
 *   /about            repli local    3  0,0000 ×3                   0,01
 *   /contact          repli local    3  0,0000 ×3                   0,01
 *   /privacy          repli local    3  0,0000 ×3                   0,01
 *
 * Trois marges sont explicites, parce qu'elles ne se déduisent pas du chiffre :
 *   • /register 0,015 — la régression corrigée par #19 valait 0,0165 : elle DOIT
 *     rougir. La mesure est stable (0,0088 sur 27 runs), la marge est de 1,7×.
 *   • /login 0,02 — un run isolé sur 18 a mesuré 0,1762 (non reproduit ; la
 *     médiane des 3 runs est restée 0). Un cran au-dessus des pages mesurées à 0
 *     strictement, pour ne pas dépendre d'un run.
 *   • /dashboard, /payment, /profile 0,06 — mesurés à 0,0450 sur 27/27 runs
 *     (valeur EXACTE, décalage fixe) : la marge est de 1,33×.
 *
 * Le défaut /jobs du 16/09/2026 (0,1353, déplacement qu'aucun nœud n'expliquait)
 * n'apparaît plus : 0,0000 sur 27 runs depuis. Le plafond global de 0,15 le
 * tolérait ; le budget par route ne le tolérerait plus.
 *
 * ── Ce que le collect BLOQUE, et ce qu'il ne peut que constater ────────────
 * Deux traitements, selon ce que le tiers fait au plus grand peintre :
 *   • `REQUETES_HORS_CONTROLE` — la requête RETARDE un peintre de l'artefact
 *     (la ligne de contact de /login derrière l'appel aux pays). Bloquée : le
 *     peintre redevient celui de l'artefact, et la grandeur est ASSERTÉE.
 *     Le tag GA4 y a figuré quelques heures le 20/09/2026, avant d'être chargé
 *     APRÈS `load` : il ne retarde plus aucun peintre, donc il n'y est plus
 *     (voir « Ce qui n'est PLUS bloqué » sous la table).
 *   • `LCP_PRODUIT_PAR_UNE_REPONSE` — la réponse EST le peintre (la liste des
 *     missions). Bloquée ou non, le LCP est le moment où la réponse est connue :
 *     la grandeur n'est pas assertée sur cette route, et le reste du socle l'est.
 * Chaque entrée porte la mesure qui l'établit, et une entrée sans justification
 * est refusée par un test.
 *
 * Deux routes mesurées à 0 se voient refuser 0 par prudence : un budget nul
 * ferait rougir la CI au premier pixel déplacé (un bandeau, un toast), ce qui
 * ferait passer une mesure pour une régression. 0,01 reste 10× plus strict que
 * le seuil « bon » de Lighthouse (0,1).
 *
 * ── Les trois pages de confiance, mesurées le 19/09/2026 ────────────────────
 * /about, /contact et /privacy sont neuves : elles n'ont donc AUCUN run dans un
 * job de main, et la règle « pas de page auditée sans plafond mesuré » imposait
 * de les mesurer avant de les déclarer. Mesure faite avec le MÊME outil, sur le
 * MÊME build : Lighthouse (3 runs par page) contre
 * `scripts/vercel-rewrite-server.js`, le serveur qui rejoue la table de
 * rewrites de vercel.json — c'est le repli que la CI utilise déjà pour une PR.
 * 0,0000 sur les 9 runs. La base est nommée `repli local` dans le tableau
 * ci-dessus précisément parce qu'elle ne vient PAS d'un job de main : les
 * premiers runs de production confirmeront ou contrediront ce 0 — et si l'une
 * des trois bouge, c'est son budget qui devra suivre, pas la mesure qui
 * s'effacera.
 */

/**
 * Motif d'URL de la route : ancré sur le CHEMIN, jamais sur l'hôte — la base
 * varie selon le run (production, preview Vercel, repli loopback) et une seule
 * table doit couvrir les trois.
 *
 * `matchingUrlPattern` est confronté à `lhr.finalUrl` et doit désigner UNE URL
 * auditée : un motif qui en couvrirait deux fait lever lhci (« Can only assert
 * one URL at a time! »), ce qui est bruyant plutôt que silencieux.
 */
const patternFor = (route) =>
  route === '/' ? '^https?://[^/]+/$' : `^https?://[^/]+${route}(/|\\?|$)`;

/**
 * Budgets CLS par route, avec la mesure qui les justifie.
 *
 * `pireMediane` = la pire MÉDIANE DE JOB observée (la CI agrège 3 runs par
 * médiane, donc c'est la grandeur réellement comparée au budget) : un test exige
 * `max > pireMediane` sur chaque route, sinon le budget rougirait sur les
 * mesures déjà relevées. Les runs individuels qui s'en écartent sont nommés dans
 * `mesure` quand ils existent — `/login` en a un.
 */
const CLS_BUDGETS = {
  '/': { max: 0.01, pireMediane: 0, mesure: '0,0000 sur 51 runs (27 prod + 24 repli local)' },
  '/register': {
    max: 0.015,
    pireMediane: 0.0088,
    mesure: '0,0088 sur 27 runs ; 0,0165 avant le correctif #19',
  },
  '/forgot-password': { max: 0.01, pireMediane: 0, mesure: '0,0000 sur 27 runs' },
  '/login': {
    max: 0.02,
    pireMediane: 0,
    mesure: '0,0000 sur 17 runs, 0,1762 sur 1 (non reproduit)',
  },
  '/how-it-works': { max: 0.01, pireMediane: 0, mesure: '0,0000 sur 18 runs' },
  '/support': { max: 0.01, pireMediane: 0, mesure: '0,0000 sur 18 runs' },
  '/jobs': {
    max: 0.01,
    pireMediane: 0,
    mesure: '0,0000 sur 27 runs (0,1353 le 16/09/2026, corrigé)',
  },
  '/dashboard': { max: 0.06, pireMediane: 0.045, mesure: '0,0450 sur 27 runs' },
  '/payment': { max: 0.06, pireMediane: 0.045, mesure: '0,0450 sur 18 runs' },
  '/profile': { max: 0.06, pireMediane: 0.045, mesure: '0,0450 sur 27 runs' },
  // Mesurées le 19/09/2026 (3 runs chacune) contre le serveur de rewrites local,
  // faute de run de main : voir l'en-tête. 0 constaté, 0,01 exigé — même
  // prudence que les autres pages mesurées à 0.
  '/about': { max: 0.01, pireMediane: 0, mesure: '0,0000 sur 3 runs (repli local)' },
  '/contact': { max: 0.01, pireMediane: 0, mesure: '0,0000 sur 3 runs (repli local)' },
  '/privacy': { max: 0.01, pireMediane: 0, mesure: '0,0000 sur 3 runs (repli local)' },
};

/**
 * Les requêtes que le job NE CONTRÔLE PAS, et qui décidaient pourtant du
 * verdict. Elles sont bloquées pendant le collect (`blockedUrlPatterns` dans
 * `lighthouserc.cjs`, une propriété de Lighthouse, appliquée via CDP) : sans
 * cela, le plus grand peintre de plusieurs pages est un contenu rendu APRÈS la
 * réponse de l'API, donc le LCP (et le score, qui le pèse) mesure la latence de
 * l'API — pas l'artefact.
 *
 * La preuve, relevée sur les rapports RÉELS archivés de trois jobs de `main`
 * portant le MÊME code applicatif :
 *
 *   route    job       FCP     LCP des 3 runs           élément LCP
 *   /jobs    12:29    1389    2727 / 2737 / 2739       la liste des missions
 *   /jobs    13:34     988    4256 / 4359 / 4468       le paragraphe d'état vide
 *   /login   13:54    1028    3836 / 3781 / 3912       la ligne de contact du formulaire
 *
 * Sur /jobs, le FCP est même MEILLEUR dans le job « rouge » (988 ms contre
 * 1 389 ms) : la machine n'était pas chargée, c'est `GET /api/jobs` qui a mis
 * ~3,3 s au lieu de ~1,3 s. Sur /login, la requête lente nommée par le rapport
 * est `GET /api/geolocation/available-countries`. Trois runs serrés au-dessus du
 * plafond ne sont donc pas du bruit de runner : c'est un tiers qui répond
 * lentement, et aucun seuil ni aucune statistique ne rend ce verdict
 * reproductible. Le champ s'en va mesurer ce qu'il doit : l'artefact se servit,
 * s'hydrata et se peignit, sans qu'une requête de données décide de son LCP.
 */
const REQUETES_HORS_CONTROLE = {
  '*/api/geolocation/available-countries*':
    'la requête LENTE nommée par les rapports du job rouge du 20/09/2026 (13:54) : le LCP ' +
    'de /login y valait 3836 / 3781 / 3912 ms pour un FCP de 1 028 ms, sur le même code ' +
    'que le job vert de 12:29, qui le mesurait à 1 767 ms. Bloquée : 1 112 ms mesuré contre ' +
    'le serveur de rewrites local (mêmes budgets, chemin de mesure débarrassé d’un tiers)',
};

// ── Ce qui n'est PLUS bloqué : le tag GA4 (retiré le 20/09/2026) ──────────────
// `googletagmanager.com` ET son `google-analytics.com/g/collect` ont été bloqués
// pendant quelques heures le 20/09/2026 : le tag était alors `async` dans le
// `<head>`, donc une requête du CHEMIN CRITIQUE (58 à 174 s de temps réseau
// simulé, LCP de /login de ~1,7 s à 4,26 s). Ce n'est plus le cas : le tag est
// DÉCLARÉ dans le HTML (`data-kojo-ga-src`) et chargé APRÈS `load` (voir
// `src/utils/analytics.js` et CI-COVERAGE.md, F6). Le LCP est finalisé au
// `load` : un tiers qui démarre après ne peut plus le décider.
//
// Le blocage est donc RETIRÉ, pas oublié : le gate mesure désormais ce qu'un
// visiteur reçoit, tag compris. Mesuré sur le build servi localement, bridage 4G
// simulé, 3 runs sur l'accueil, tag actif et RIEN de bloqué : LCP 1 446 / 1 253
// / 2 007 ms, contre 12 005 / 1 603 / 1 939 ms avec l'ancien tag `async`.
// Le test de ce fichier refuse qu'un motif GA revienne sans que la décision soit
// rouverte : rebloquer un tiers est un choix, et un choix se justifie.

/**
 * Routes dont le LCP (et le SCORE, qui le pèse) dépend d'une RÉPONSE de l'API :
 * le plus grand peintre n'existe pas dans la coquille, il apparaît quand la
 * requête se résout — dans un sens comme dans l'autre. Ces deux grandeurs n'y
 * sont donc pas assertées ; la route garde FCP, TBT et son plafond CLS, et
 * AUCUN seuil n'est relevé pour les autres pages.
 *
 * /jobs, mesuré le 20/09/2026 (Lighthouse, même build) :
 *
 *   réponse de GET /api/jobs   LCP     élément peint
 *   liste servie (12:29)       2 727   la liste des missions
 *   liste servie (13:34)       4 256   la liste (API ~2,6× plus lente)
 *   plus rien à lister         4 256   le paragraphe d'état vide
 *   requête BLOQUÉE (local)    5 177   le bandeau « Pas de connexion »
 *
 * Les quatre valeurs sont au-dessus du plafond de 3 500 ms, et la dernière est
 * mesurée avec la requête bloquée : le LCP de /jobs est le moment où la RÉPONSE
 * est connue (le temps de la requête, ou celui de ses réessais avant l'état
 * d'erreur), jamais un choix de l'artefact. Le blocage ne le corrige pas — il
 * ne corrige que les pages dont le tiers retardait un peintre de l'artefact.
 */
const LCP_PRODUIT_PAR_UNE_REPONSE = {
  '/jobs':
    'le plus grand peintre de /jobs est la réponse de GET /api/jobs : 2 727 ms avec la ' +
    'liste, 4 256 ms avec l’état vide, 5 177 ms avec la requête bloquée (réessais avant ' +
    'l’état d’erreur) — trois issues, toutes au-dessus du plafond, pour un FCP de 886 à ' +
    '1 389 ms qui, lui, reste asserté',
};

/**
 * Le socle d'une route : ce qu'elle peut porter, pas ce que le job aimerait.
 *
 * `socle` peut être un OBJET (un jeu de budgets commun, cas de la passe mobile)
 * ou une FONCTION de la route (cas de la passe desktop, dont le TBT a un
 * plafond mesuré PAR route — cf. TBT_DESKTOP_BUDGETS). La forme fonctionnelle
 * évite qu'un plafond propre à une page soit recopié pour toutes les autres par
 * simple commodité d'appel.
 */
const soclePour = (route, socle) => {
  const base = typeof socle === 'function' ? socle(route) : socle;
  if (!Object.hasOwn(LCP_PRODUIT_PAR_UNE_REPONSE, route)) return base;
  // Le score est une moyenne pondérée qui COMPREND le LCP : l'asserter
  // réimporterait exactement la grandeur qu'on vient de retirer.
  const { 'largest-contentful-paint': _lcp, 'categories:performance': _score, ...reste } = base;
  return reste;
};

/**
 * Matrice d'assertions de `ci.assert` : PAR ROUTE, un socle de performance et un
 * plafond CLS — plus d'entrée globale, pour qu'une éventuelle exception tienne
 * sur UNE page au lieu d'affaiblir tout le monde.
 *
 * @param {string[]} routes Pages réellement auditées par ce run.
 * @param {object|Function} socle Budgets communs (score, FCP, LCP, TBT), ou une
 *   fonction `(route) => budgets` quand ils diffèrent d'une page à l'autre.
 * @returns {Array<{matchingUrlPattern?: string, aggregationMethod: string,
 *   assertions: object}>} `ci.assert.assertMatrix`.
 * @throws {Error} Une page auditée n'a pas de budget CLS mesuré.
 */
const clsAssertionMatrix = (routes, socle) => {
  const sansBudget = routes.filter((route) => !Object.hasOwn(CLS_BUDGETS, route));
  if (sansBudget.length) {
    throw new Error(
      `budget CLS manquant pour ${sansBudget.join(', ')} : mesurer la page (artifacts ` +
        '`lighthouse-reports` d’un job de main) puis l’ajouter à CLS_BUDGETS. Sans valeur ' +
        'mesurée, la page serait auditée SANS plafond CLS — la régression qu’on veut ' +
        'attraper passerait, et rien ne le dirait.'
    );
  }
  return [
    // `optimistic` = le MEILLEUR des 3 runs : voir l'en-tête, « Deux
    // statistiques ». Sur les 2 jobs de `main` du 20/09/2026 (39 runs, 13
    // pages), le pire meilleur-run valait 0,97 de score, 1 380 ms de FCP,
    // 2 587 ms de LCP et 10 ms de TBT — les mêmes seuils, un verdict stable.
    ...routes.map((route) => ({
      matchingUrlPattern: patternFor(route),
      aggregationMethod: 'optimistic',
      assertions: soclePour(route, socle),
    })),
    // Le CLS, lui, est une propriété du DOM et du CSS : relevé identique d'un
    // run à l'autre (0 / 0,009 / 0,045 selon la page) — la médiane y est la
    // statistique la plus stricte ET la plus stable.
    ...routes.map((route) => ({
      matchingUrlPattern: patternFor(route),
      aggregationMethod: 'median',
      assertions: {
        'cumulative-layout-shift': ['error', { maxNumericValue: CLS_BUDGETS[route].max }],
      },
    })),
  ];
};

/**
 * Plafond de TBT en DESKTOP, PAR ROUTE — la seule grandeur que la passe
 * `lighthouserc.desktop.cjs` asserte avec le CLS.
 *
 * ── Pourquoi un plafond PAR ROUTE ici, et pas un seuil commun ──────────────
 * Le seuil commun venait de l'audit (« TBT (Desktop) 477 ms — should be
 * < 200 ms ») : il décrit l'ACCUEIL, la page où l'audit l'a relevé. /jobs a une
 * autre distribution, et surtout un autre pire cas : l'accueil porte l'iframe
 * Google Maps, dont le document se met en page dans le même processus (relevé
 * de trace : 674–728 ms de `Layout` sur cette page à 4× CPU, la plus grosse
 * passe du site), là où /jobs n'embarque aucun cadre tiers. Recopier le seuil de
 * l'accueil sur /jobs n'aurait donc rien adossé : chaque route porte désormais
 * le plafond que SA mesure supporte.
 *
 * ── La mesure de /jobs (24/09/2026, Lighthouse 12.6.1, preset desktop) ─────
 * 27 runs, quatre conditions, Chrome NEUF à chaque run (cache navigateur vide),
 * même machine, même session — et 0 ms de TBT à chaque fois, aucune tâche au-
 * dessus du seuil de « tâche longue » (50 ms) :
 *
 *   condition                                runs   TBT      plus longue tâche   Style & Layout
 *   pile de la CI (serveur de rewrites)         6   0 ms     0 ms                73–76 ms
 *   + 4 boucles CPU sur 8 cœurs                 6   0 ms     0 ms                93–119 ms
 *   + bord de CDN froid (+120 ms par actif)     5   0 ms     0 ms                73–76 ms
 *   + 7 boucles CPU sur 8 cœurs (famine)        4   0 ms     0 ms                105–149 ms
 *   production, 9 runs à chaud (avant correctif)   0 ms ×8, 8 ms au pire        83–130 ms
 *   production, 1er run à froid (avant correctif)  1076 ms                  2397 ms
 *
 * ── Comment 150 ms est choisi ──────────────────────────────────────────
 * Pas par marge sur la valeur courante (0 ms : toute valeur donnerait une marge
 * infinie, donc n'importe quel nombre serait « justifié »), mais par une borne
 * HAUTE de ce que la page peut coûter : sous famine CPU, la totalité du travail
 * de mise en page et de style de /jobs atteint 149 ms. Même si un run
 * pathologique coalesait tout ce travail dans UNE tâche, le blocage vaudrait
 * ~99 ms (la tâche moins les 50 ms non bloquantes) — 150 ms couvre donc cette
 * borne avec 1,5× de marge, tout en restant 7× SOUS le mode froid mesuré avant
 * correctif (1076 ms), c'est-à-dire un mode que la garde doit continuer
 * d'attraper. Un plafond plus serré (le seuil de tâche longue, 50 ms) ne serait
 * pas adossé à une mesure mais au bruit d'un runner affamé — exactement ce que
 * les plafonds élargis du socle mobile existent pour éviter (1397 ms mesurés
 * pour un arbre vert).
 *
 * L'ACCUEIL garde 200 ms : c'est le seuil de l'audit (13× sa pire mesure,
 * 15 ms sous saturation) et sa pire passe de mise en page est bornée par le
 * cadre Maps, donc sa borne haute n'est pas comparable à celle de /jobs.
 *
 * Le TBT est asserté au MEILLEUR des 3 runs (`aggregationMethod: 'optimistic'`) :
 * les trois runs d'un job partagent la même arborescence et la même arête de
 * cache, et une régression de l'artefact monte dans les trois — c'est ce qui
 * rend le mode froid de /jobs non bloquant tout en le rendant détectable s'il
 * devenait permanent.
 */
const TBT_DESKTOP_BUDGETS = {
  '/': { max: 200, pire: 15, mesure: '0 ms ×3 production, 0/0/15 ms repli local saturé' },
  '/jobs': { max: 150, pire: 8, mesure: '0 ms sur 27 runs (4 conditions), 8 ms au pire à chaud' },
};

/**
 * Plafond de TBT desktop d'une route, ou REFUS explicite.
 *
 * Une page auditée sans valeur mesurée serait mesurée SANS plafond : la
 * régression qu'on veut attraper passerait, et rien ne le dirait. Même
 * convention que le budget CLS, donc même refus au chargement de la config.
 *
 * @param {string} route Chemin audité (par exemple `/jobs`).
 * @returns {number} Plafond en millisecondes.
 * @throws {Error} La route n'a pas de plafond mesuré.
 */
const plafondTbtDesktop = (route) => {
  if (!Object.hasOwn(TBT_DESKTOP_BUDGETS, route)) {
    throw new Error(
      `plafond TBT desktop manquant pour ${route} : mesurer la page (trace CDP, plusieurs ` +
        'conditions, cf. l’en-tête de TBT_DESKTOP_BUDGETS) puis l’ajouter ici. Sans valeur ' +
        'mesurée, la page serait auditée en desktop SANS plafond de TBT.'
    );
  }
  return TBT_DESKTOP_BUDGETS[route].max;
};

module.exports = {
  CLS_BUDGETS,
  LCP_PRODUIT_PAR_UNE_REPONSE,
  TBT_DESKTOP_BUDGETS,
  plafondTbtDesktop,
  REQUETES_HORS_CONTROLE,
  clsAssertionMatrix,
  patternFor,
  soclePour,
};
