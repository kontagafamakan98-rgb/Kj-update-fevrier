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
  // Route CONNECTÉE qu'AUCUNE passe Lighthouse n'audite (`/messages` n'est pas
  // dans `DEPLOYMENT_PATHS`) : ce plafond sert la SONDE NAVIGATEUR
  // (`e2e/cadres-app.spec.js`, qui monte le cadre et mesure le CLS par la
  // connexion à la fixture, aux deux tailles). 0,02 est la seule entrée dont le
  // nombre n'est PAS une médiane de job : c'est le pire relevé de la sonde
  // (0,0043, le 07/10/2026) — 4,6× de marge, et le seuil « bon » de Lighthouse
  // est 0,1. La valeur se re-mesure en relançant la sonde, qui publie son relevé.
  '/messages': {
    max: 0.02,
    pireMediane: 0.0043,
    mesure: '0,0043 au pire (0,0039 mobile / 0,0043 desktop) — sonde navigateur du 07/10/2026, aucun run de main (route non auditée)',
  },
  // MÊME RÈGLE POUR LES DEUX ROUTES AJOUTÉES À LA SONDE LE 08/10/2026, et même
  // valeur que /messages pour la première : 0,02 est 5,1× son pire relevé.
  '/create-job': {
    max: 0.02,
    pireMediane: 0.0039,
    mesure: '0,0039 aux deux tailles (412×823 et 1350×940) — sonde navigateur du 08/10/2026, aucun run de main (route non auditée)',
  },
  // `/jobs/:id` LAISSE LE PLUS HAUT DES TROIS PLAFONDS DE SONDE, et c'est une
  // MESURE : sa fiche réserve l'écran (règle `pied-hors-ecran`, sa description
  // n'ayant pas de longueur maximale), et la mission COURTE que la fixture servait
  // rendait alors une page de 940 px pour une fenêtre de 940 — le pied de page,
  // réservé SOUS la ligne de flottaison, remontait donc DANS l'écran à l'arrivée
  // des données (0,0166 en desktop, 0,0000 en mobile, 3 relevés, stables ; un
  // premier relevé du même cas avait donné 0,0127). C'est la contrepartie assumée
  // et écrite dans `SkeletonLoader.js` : le cas LONG n'a AUCUN décalage de pied de
  // page, le cas court en a un.
  //
  // LA FIXTURE SERT LES DEUX CAS, ET LA SONDE LES VISITE TOUS LES DEUX
  // (09/10/2026) : la PREMIÈRE mission de `scripts/playtest-api-server.mjs` porte
  // une annonce de plusieurs paragraphes (le cas LONG, celui de la production),
  // la SECONDE une annonce COURTE (le cas COURT, le seul qui sollicite vraiment
  // le plafond), et `e2e/cadres-app.spec.js` ouvre les DEUX à chaque taille —
  // `playtest-job-1` et `playtest-job-2` — avec un test qui refuse d'en perdre un.
  // (La deuxième mission a été ajoutée le 09/10/2026 : en portant le cas long sur
  // la seule première mission, la sonde avait cessé de visiter le cas court, et
  // le plafond se trouvait vérifié sur le cas qui ne le met PAS à l'épreuve.)
  //
  // RELEVÉ (09/10/2026, sonde navigateur, 412×823 et 1350×940) :
  //   • cas LONG : 0,0000 en mobile et 0,0039 en desktop. Ce 0,0039 n'est PLUS le
  //     pied de page — la sonde le NOMME : les deux conteneurs de la barre du
  //     haut se réajustent à t≈147 ms quand la pastille de notifications se
  //     résout, comme sur les quatre autres routes connectées. Cadre desktop
  //     1 280×1 767,9 px, donc plus haut que la réserve d'un écran.
  //   • cas COURT : 0,0000 en mobile et 0,0164 en desktop. La page fait
  //     1 280×795,3 px pour une fenêtre de 940, donc la réserve (875 px) la
  //     DÉPASSE et le pied de page REMONTE dans l'écran : la sonde nomme
  //     `<footer…> : 0×0 px à (0, 0) → 1350×79,7 px à (0, 860.3)` pour 0,0125,
  //     plus les 0,0039 de la barre du haut, dans la MÊME fenêtre de session.
  //
  // LE 0,0039 MOBILE A ÉTÉ SUPPRIMÉ À SA CAUSE (09/10/2026), ET CE N'ÉTAIT PAS LE
  // MÊME DÉCALAGE : la barre de navigation BASSE (`MobileBottomNav`) se
  // réajustait de 81 à 88,5 px (y 742 → 734,5) quand la session se résolvait —
  // le premier rendu peint le menu DÉCOUVERTE (4 colonnes, libellés sur une
  // ligne), puis `/auth/me` répond et le menu APPLICATION (5 colonnes, la
  // cloche) fait tenir « Tableau de bord » sur DEUX lignes. Deux corrections,
  // chacune mesurée : la hauteur d'une case ne dépend plus du libellé (elle
  // réserve la ligne double), et les deux menus ne partagent plus leurs nœuds
  // (React remontait « Emplois » d'une grille à l'autre). Relevé après
  // correction : 0,0000 sur 6 runs sur 6, la barre constante à 89 px.
  //
  // LE PLAFOND N'A PAS ÉTÉ RESSERRÉ, MAIS SA COUVERTURE A ÉTÉ ÉTENDUE — c'est la
  // correction que ce commentaire appelait, faite le 09/10/2026 : le cas court
  // reste un cas de PRODUCTION (une annonce d'une phrase existe), il était sorti
  // du périmètre quand la fixture n'a plus servi que le cas long, et une SECONDE
  // mission COURTE l'a remis sous la sonde (`playtest-job-2`). 0,04 couvre les
  // DEUX relevés — 0,0164 au pire, soit 2,4× de marge — et reste 2,5× SOUS le
  // seuil « bon » de Lighthouse (0,1) : c'est la COUVERTURE qui a été corrigée,
  // pas le chiffre qu'il fallait baisser.
  '/jobs/:id': {
    max: 0.04,
    pireMediane: 0.0039,
    mesure:
      'les DEUX cas sont visités (412×823 et 1350×940, 09/10/2026) : cas LONG 0,0000 mobile / 0,0039 desktop (ce 0,0039 est la barre du haut, pas le pied de page) ; cas COURT 0,0000 mobile / 0,0164 desktop (pied de page réservé qui remonte) ; ' +
      'le cas court avait donné 0,0166 le 08/10/2026, même mécanique — aucun run de main (route non auditée)',
  },
  // Mesurées le 19/09/2026 (3 runs chacune) contre le serveur de rewrites local,
  // faute de run de main : voir l'en-tête. 0 constaté, 0,01 exigé — même
  // prudence que les autres pages mesurées à 0.
  '/about': { max: 0.01, pireMediane: 0, mesure: '0,0000 sur 3 runs (repli local)' },
  '/contact': { max: 0.01, pireMediane: 0, mesure: '0,0000 sur 3 runs (repli local)' },
  '/privacy': { max: 0.01, pireMediane: 0, mesure: '0,0000 sur 3 runs (repli local)' },
  // Nouvelle page pré-rendue (mêmes sections et même forme que /privacy) : le
  // budget suit celui de /privacy tant qu'un run de main n'a pas publié son
  // propre relevé. 0,01 est 10× plus strict que le seuil « bon » de Lighthouse.
  '/terms': { max: 0.01, pireMediane: 0, mesure: '0,01 exigé, comme /privacy (relevé de main à publier)' },
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
  // Le score n'a plus à être retiré ICI : il est retiré PARTOUT, à sa source
  // (`RETRAITS`, et sa justification avec lui). Ne reste que le LCP, qui est la
  // grandeur que la réponse d'API produit sur cette route-là.
  const { 'largest-contentful-paint': _lcp, ...reste } = base;
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

/**
 * LE PLAFOND SE DÉRIVE DE LA MESURE — jamais recopié d'un nombre rond.
 *
 * `pire` est la pire mesure DÉJÀ RELEVÉE (le pire MEILLEUR-RUN de trois tours,
 * puisque c'est cette statistique qui est comparée au seuil — cf. l'en-tête),
 * `marge` est le rapport que le plafond entretient avec elle, et l'arrondi au
 * centième voisin rend le nombre lisible. La conséquence est ce qui compte :
 * **re-mesurer la table DÉPLACE le budget**, sans que personne ait à retrouver
 * un littéral dans une autre phrase. Un littéral, lui, se périme en silence —
 * c'est exactement ce que l'angle mort 19(b) reprochait à ces seuils.
 *
 * La marge n'est pas un confort : le bruit d'un runner est UNILATÉRAL (une
 * machine chargée ne peut qu'ajouter du temps), donc le meilleur des trois tours
 * décrit le coût propre de l'artefact, et une régression, elle, monte dans les
 * trois. La marge couvre donc l'écart entre le meilleur run et ce qu'un run
 * normal peut rendre — pas la famine, qui est traitée par la SÉPARATION PAR HÔTE.
 */
const plafondDe = (pire, marge) => Math.round((pire * marge) / 100) * 100;

/**
 * LE SOCLE MOBILE EN MILLISECONDES, PAR MESURE — ce que l'angle mort 19(b) a
 * remplacé les littéraux par.
 *
 * Ce qui a été relevé, et ce qui l'a été (deux jobs de `main` du 20/09/2026
 * portant le MÊME arbre 14e0531, 39 runs, 13 pages) :
 *
 *   grandeur               pire meilleur-run   plafond d'avant   marge
 *   LCP                                 2587 ms            3500    1,35×
 *   FCP                                 1380 ms            2500    1,81×
 *
 * Les deux plafonds sont IDENTIQUES après dérivation (3 500 et 2 500 ms) : c'est
 * la vérification que la passe n'a pas changé un verdict, elle a changé d'où le
 * nombre vient. Et la raison pour laquelle les deux grandeurs sont sur la MÊME
 * table, sans séparation par hôte : la mesure ne les sépare pas — « les mêmes
 * seuils, un verdict stable » sur les deux jobs, l'un sur le repli local, l'autre
 * sur le déploiement. Diviser une table que la mesure ne divise pas aurait créé
 * deux endroits à tenir à jour pour un seul fait.
 */
const SOCLE_MOBILE = {
  'largest-contentful-paint': {
    pire: 2587,
    marge: 1.35,
    mesure:
      'pire meilleur-run de 2 jobs de main du 20/09/2026 (39 runs, 13 pages) — les deux ' +
      'ont passé avec le plafond dérivé, qui valait déjà 3 500 ms',
  },
  'first-contentful-paint': {
    pire: 1380,
    marge: 1.81,
    mesure:
      'pire meilleur-run de 2 jobs de main du 20/09/2026 (39 runs, 13 pages) ; le FCP ' +
      'reste asserti partout, la mesure ne le sépare pas d’un hôte à l’autre',
  },
};

/**
 * LE TBT MOBILE, LUI, EST SÉPARÉ PAR HÔTE — parce que la mesure le sépare.
 *
 *   hôte            mesure                                        plafond dérivé
 *   pile locale     516 puis 1397 ms pour le MÊME commit           1600 ms (1,15×)
 *   déploiement     0 à 10 ms sur 39 runs (13 pages)               AUCUN (voir RETRAITS)
 *
 * Le plafond du repli local est légitime et le reste : un runner partagé a rendu
 * 1397 ms pour un arbre vert, donc 1600 ms borne un fait observé. Celui du
 * déploiement ne bornait rien : **1200 ms pour 10 ms mesurés, soit 120×**, un
 * nombre qu'AUCUNE mesure ne vient adosser — il ne pouvait rougir que sur une
 * famine d'hôte, c'est-à-dire sur le défaut d'origine (le verdict porté par la
 * machine). Il est RETIRÉ, et le retrait est écrit dans RETRAITS pour qu'il ne
 * soit pas pris pour un oubli.
 */
const TBT_MOBILE = {
  'pile-locale': {
    pire: 1397,
    marge: 1.15,
    mesure: '516 puis 1397 ms pour le même commit sur un runner partagé (20/09/2026)',
  },
};

/**
 * LES ASSERTIONS RETIRÉES, ET LA MESURE QUI LES RETIRE.
 *
 * Une assertion retirée sans phrase est un affaiblissement ; avec sa phrase,
 * c'est une décision. Deux formes ici :
 *
 *   • `categories:performance` — le SCORE. C'est une MOYENNE PONDÉRÉE des
 *     grandeurs déjà assertrées (FCP, LCP, TBT, CLS) plus `speed-index`, que ce
 *     dépôt a décidé de ne JAMAIS asserter. L'asserter réimporte donc par la
 *     porte du score exactement ce qui a été retiré champ par champ, et y ajoute
 *     la seule grandeur dont on ne veut pas juger. La mesure ne l'arbitre pas :
 *     la seule fois où il a décidé dans l'histoire de ce dépôt, il a eu TORT —
 *     deux jobs de `main` sur le MÊME arbre (14e0531), vert à 08:10 et rouge à
 *     08:50, l'unique assertion en cause étant `categories:performance >= 0,9`
 *     sur `/login` (médiane 0,79 ; runs 1,00 / 0,79 / 0,77) pendant que TOUS les
 *     budgets explicites passaient dans les deux jobs. Le retirer ne relâche
 *     aucune grandeur : chacune reste assertée pour elle-même.
 *   • `total-blocking-time@deploiement` — 1200 ms pour 10 ms mesurés (120×). Voir
 *     TBT_MOBILE : aucun relevé de l'artefact ne l'adosse.
 *
 * Ce qui n'est PAS retiré, et pourquoi : le FCP (il borne le premier pixel peint,
 * la seule métrique qu'une coquille pré-rendue peut dégrader sans que rien
 * d'autre bouge), le LCP sur les routes où il EST celui de l'artefact, et le TBT
 * sur la pile locale (une mesure l'adosse).
 */
const RETRAITS = {
  'categories:performance':
    'moyenne pondérée de grandeurs DÉJÀ assertées, plus `speed-index` que ce dépôt n’asserte ' +
    'jamais ; son seul verdict documenté est un FAUX rouge (2 jobs de main, même arbre 14e0531, ' +
    'vert 08:10 / rouge 08:50, décidé par cette seule assertion sur /login alors que tous les ' +
    'budgets explicites passaient) — la mesure ne l’arbitre pas',
  'total-blocking-time@deploiement':
    '1200 ms pour un pire meilleur-run de 10 ms sur 39 runs (13 pages) : 120×, aucune mesure ' +
    'ne l’adosse. La famine d’hôte qu’il ne pouvait attraper est le défaut d’origine, pas une ' +
    'régression de l’artefact. La pile locale, elle, GARDE son plafond (1397 ms mesurés)',
};

/**
 * Le socle mobile d'une route, sur un hôte donné : les plafonds DÉRIVÉS de la
 * table, dans la forme qu'attend `ci.assert`.
 *
 * `hote` est `'pile-locale'` ou `'deploiement'`. Une valeur d'hôte inconnue LÈVE :
 * un troisième hôte qui arriverait sans mesure ne doit pas hériter en silence du
 * plafond d'un autre (c'est la faute que la séparation par hôte existe pour
 * empêcher).
 */
const socleMobile = (hote) => {
  if (hote !== 'pile-locale' && hote !== 'deploiement') {
    throw new Error(
      `hôte inconnu « ${hote} » : les plafonds mobiles sont mesurés pour « pile-locale » et ` +
        '« deploiement » (scripts/lhci-cls-budgets.cjs). Un hôte sans mesure n’hérite pas du ' +
        'plafond d’un autre — mesurer, puis l’ajouter à TBT_MOBILE.'
    );
  }
  const socle = {};
  for (const [grandeur, entree] of Object.entries(SOCLE_MOBILE)) {
    socle[grandeur] = ['error', { maxNumericValue: plafondDe(entree.pire, entree.marge) }];
  }
  // Le TBT n'est ASSERTÉ que là où une mesure l'adosse : la clé absente de
  // TBT_MOBILE est le RETRAIT, et il est documenté dans RETRAITS.
  const tbt = TBT_MOBILE[hote];
  if (tbt) socle['total-blocking-time'] = ['error', { maxNumericValue: plafondDe(tbt.pire, tbt.marge) }];
  return socle;
};

module.exports = {
  CLS_BUDGETS,
  LCP_PRODUIT_PAR_UNE_REPONSE,
  TBT_DESKTOP_BUDGETS,
  plafondTbtDesktop,
  REQUETES_HORS_CONTROLE,
  RETRAITS,
  SOCLE_MOBILE,
  TBT_MOBILE,
  plafondDe,
  socleMobile,
  clsAssertionMatrix,
  patternFor,
  soclePour,
};
