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
 * ── Les valeurs sont MESURÉES, pas choisies ─────────────────────────────────
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
 * Deux routes mesurées à 0 se voient refuser 0 par prudence : un budget nul
 * ferait rougir la CI au premier pixel déplacé (un bandeau, un toast), ce qui
 * ferait passer une mesure pour une régression. 0,01 reste 10× plus strict que
 * le seuil « bon » de Lighthouse (0,1).
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
};

/**
 * Matrice d'assertions de `ci.assert` : un plafond CLS PAR ROUTE, plus une
 * entrée GLOBALE (sans motif) pour ce qui ne dépend pas de la page.
 *
 * @param {string[]} routes Pages réellement auditées par ce run.
 * @param {object} globalAssertions Budgets identiques pour toutes les pages.
 * @returns {Array<{matchingUrlPattern?: string, aggregationMethod: string,
 *   assertions: object}>} `ci.assert.assertMatrix`.
 * @throws {Error} Une page auditée n'a pas de budget CLS mesuré.
 */
const clsAssertionMatrix = (routes, globalAssertions) => {
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
    // Sans `matchingUrlPattern`, cette entrée s'applique à TOUTES les URLs
    // (le filtre est alors absent : @lhci/utils/src/assertions.js). Elle ne
    // porte AUCUN budget CLS : c'est tout l'intérêt de la matrice.
    { aggregationMethod: 'median', assertions: globalAssertions },
    ...routes.map((route) => ({
      matchingUrlPattern: patternFor(route),
      aggregationMethod: 'median',
      assertions: {
        'cumulative-layout-shift': ['error', { maxNumericValue: CLS_BUDGETS[route].max }],
      },
    })),
  ];
};

module.exports = { CLS_BUDGETS, clsAssertionMatrix, patternFor };
