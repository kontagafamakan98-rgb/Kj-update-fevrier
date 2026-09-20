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
 * ── Ce qui n'est PLUS asserté sur une route, et pourquoi ───────────────────
 * `LCP_PRODUIT_PAR_UN_TIERS` nomme les routes dont le LCP (et le score, qui le
 * pèse) est produit par une requête que le job ne contrôle pas. La matrice leur
 * retire ces deux grandeurs, avec la mesure qui l'établit ; les plafonds des
 * autres pages, eux, sont INCHANGÉS. Une entrée sans justification est refusée
 * par un test : une exception muette serait un budget qu'on ne mesure plus sans
 * le dire.
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
 * Routes dont le LCP — et donc le SCORE, qui le pèse — est produit par une
 * requête que le job ne contrôle pas : mesurer ces deux grandeurs depuis un
 * runner mesure la latence d'un service tiers, pas l'artefact. Elles ne sont
 * donc PAS assertées sur ces routes ; tout le reste (FCP, TBT, CLS, et les
 * budgets explicites des autres pages) l'est.
 *
 * La preuve, mesurée sur deux jobs de `main` portant le MÊME code applicatif :
 *
 *   /jobs, 3 runs      FCP    LCP des 3 runs        score        élément LCP
 *   job du 12:29       1389   2727 / 2737 / 2739    0,95         liste des missions
 *   job du 13:34        988   4256 / 4359 / 4468    0,73 / 0,84 / 0,85
 *                       ↑ LCP = le paragraphe d'état vide (« Élargissez votre
 *                         recherche… ») rendu APRÈS la réponse de GET /api/jobs
 *
 * Le FCP est même MEILLEUR dans le job rouge (988 ms contre 1 389 ms) : la
 * machine n'était pas chargée, c'est la réponse de l'API qui a mis ~3,3 s au
 * lieu de ~1,3 s. Trois runs serrés au-dessus du plafond ne sont donc pas du
 * bruit : c'est un tiers qui a répondu lentement, et aucun seuil ne peut rendre
 * ce verdict reproductible sans mesurer une surface que le job contrôle.
 *
 * Aucun plafond n'est relevé ici : les grandeurs qui décrivent l'artefact
 * gardent EXACTEMENT les leurs, et celles qu'un tiers décide cessent d'être
 * assertées sur les routes concernées — le reste du socle continue de rougir si
 * le bundle, le CSS ou l'hydratation régressent.
 */
const LCP_PRODUIT_PAR_UN_TIERS = {
  '/jobs':
    'élément LCP = le paragraphe d’état vide rendu par la réponse de GET /api/jobs ' +
    '(2727 ms le 20/09 12:29, 4256 ms le 20/09 13:34 : même code, même FCP) — ' +
    'la grandeur décrit la latence de l’API, pas l’artefact',
};

/** Le socle d'une route : ce qu'elle peut porter, pas ce que le job aimerait. */
const soclePour = (route, socle) => {
  if (!Object.hasOwn(LCP_PRODUIT_PAR_UN_TIERS, route)) return socle;
  // Le score est une moyenne pondérée qui COMPREND le LCP : l'asserter
  // réimporterait exactement la grandeur qu'on vient de retirer.
  const { 'largest-contentful-paint': _lcp, 'categories:performance': _score, ...reste } = socle;
  return reste;
};

/**
 * Matrice d'assertions de `ci.assert` : PAR ROUTE, un socle de performance et un
 * plafond CLS — plus d'entrée globale, précisément pour qu'une exception puisse
 * porter sur UNE page au lieu d'affaiblir tout le monde.
 *
 * @param {string[]} routes Pages réellement auditées par ce run.
 * @param {object} socle Budgets communs (score, FCP, LCP, TBT).
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

module.exports = { CLS_BUDGETS, LCP_PRODUIT_PAR_UN_TIERS, clsAssertionMatrix, patternFor, soclePour };
