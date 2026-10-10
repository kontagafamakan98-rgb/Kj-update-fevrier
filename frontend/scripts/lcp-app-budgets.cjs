/**
 * LE PLAFOND D'AIRE LCP DES CINQ ROUTES D'APPLICATION — mesuré, dérivé, jamais
 * choisi.
 *
 * ── Pourquoi cette table, et pourquoi elle vit ici ─────────────────────────
 * `e2e/lcp-app.spec.js` publie l'aire du plus grand contenu peint sur les cinq
 * routes d'application depuis le 09/10/2026, et son en-tête dit lui-même ce qui
 * lui manquait : « elle ne juge pas un PLAFOND d'aire : un plafond demande une
 * table mesurée, comme `lhci-cls-budgets.cjs` pour le CLS ». C'est cette table.
 * Elle est à côte de celle du CLS parce que c'est le même objet — un budget PAR
 * ROUTE avec la mesure qui l'adosse —, et `plafondDe` (la règle de dérivation)
 * y est LUE, pas recopiée : deux tables, une seule règle de dérivation.
 *
 * ── La mesure : 30 relevés, 3 runs par cellule, 10 cellules ────────────────
 * Protocole de `e2e/lcp-app.spec.js` (fixture, coquille de PRODUCTION lue dans
 * `vercel.json`, observateur LCP posé AVANT la navigation), rejoué avec
 * `--repeat-each=3` le 09/10/2026 :
 *
 *   route          taille    aire LCP (3 runs, px²)   élément ÉLU
 *   /dashboard     mobile     8 626 ×3                <h1> « Bienvenue, Demo! »
 *   /dashboard     desktop   17 172 ×3                <h1> « Bienvenue, Demo! »
 *   /profile       mobile    11 211 ×3                <p> « Aucun avis pour le moment… »
 *   /profile       desktop   21 012 ×3                <h1> « Demo Worker »
 *   /messages      mobile     4 256 ×3                <h1> « Messages »
 *   /messages      desktop    8 478 ×3                <h1> « Messages »
 *   /create-job    mobile    11 792 ×3                <p> « Seuls le titre, le prix… »
 *   /create-job    desktop   13 446 ×3                <h1> « Publier un job »
 *   /jobs/:id      mobile    30 361 ×3                <p> « L’argent est bloqué sur le compte séquestre… »
 *   /jobs/:id      desktop  142 848 ×3                <p> « Nous recherchons un électricien qualifié… »
 *
 * LES TRENTE RELEVÉS SONT IDENTIQUES AU PX², et le MÊME élément est élu à chaque
 * run (le relevé publie les deux, `e2e/lcp-app.spec.js`) : l'aire LCP de ces
 * pages est de la GÉOMÉTRIE — un fait de DOM et de CSS, comme le CLS, et pour la
 * même raison. La conséquence règle la marge ci-dessous : il n'y a AUCUN bruit de
 * machine à couvrir, donc la marge ne peut pas être justifiée comme telle.
 *
 * ── Ce qui est asserté, et sur quelle grandeur ─────────────────────────────
 * Ces routes ne sont PAS pré-rendues (`src/config/app-cadres.js` : aucun HTML
 * statique, `app.html` en `noindex`), donc il n'y a pas deux peintures à
 * comparer et aucune « égalité de géométrie » à exiger : le navigateur n'élit
 * qu'une fois. Ce que la table borne est donc l'aire de CETTE élection.
 *
 * ── UNE BANDE, PAS SEULEMENT UN PLAFOND ────────────────────────────────────
 * Un plafond seul est satisfait par une page vide : une aire LCP de 1 px² passe
 * sous n'importe quelle borne haute. La table porte donc aussi un PLANCHER, à
 * 60 % de la mesure — la proportion déjà retenue ailleurs dans le dépôt pour les
 * planchers de lecture (`PLANCHERS_NOEUDS`, `PLANCHERS_PREMIER_ECRAN`) : une page
 * qui perd 40 % de son plus grand peintre a perdu du contenu, et c'est ce que le
 * plancher nomme. Les deux bornes sont dérivées de LA MÊME mesure, donc elles ne
 * peuvent pas décrire deux pages différentes.
 *
 * ── La marge : 1,25, et ce qu'elle couvre ──────────────────────────────────
 * La plus grande re-justification LÉGITIME mesurée sur ces routes vaut +10,2 % :
 * le titre de mission de `/jobs/:id` en desktop qui passe sur DEUX lignes
 * (26 136 → 28 800 px², relevé du 09/10/2026, en-tête de `e2e/lcp-app.spec.js`).
 * Une re-justification est un fait de largeur de texte, pas une régression, et un
 * plafond qui rougirait dessus serait un plafond qu'on finirait par élargir sans
 * mesure. 1,25 la couvre avec 2,4× de marge.
 *
 * Ce que 1,25 attrape, et c'est la classe de défaut qui compte ici : un
 * CHANGEMENT D'ÉLÉMENT ÉLU. La mesure de référence est celle de l'accueil
 * (`e2e/lcp-geometrie.spec.js`) — 69 920 px² mobile / 306 870 desktop pour la
 * photo du héros, soit ×2,4 du plus grand peintre de `/jobs/:id` desktop. Un
 * plafond à 1,25 refuse un peintre de cette taille, et il refuse aussi une
 * section qui se met à peindre en entier là où elle ne peignait qu'une ligne.
 * Ce qu'il ne prétend PAS attraper : une dérive de quelques pour cent, qui n'est
 * pas une aire mais une typographie — c'est le sujet des autres sondes.
 *
 * ── Le vocabulaire des tailles est celui de la sonde ──────────────────────
 * `mobile` (412×823) et `desktop` (1350×940) sont les deux noms de `TAILLES`
 * dans `e2e/lcp-app.spec.js`, et c'est la sonde qui les demande par leur nom :
 * une taille renommée d'un côté lève à la lecture (`plafondDaireApp` REFUSE une
 * cellule sans mesure), donc les deux vocabulaires ne peuvent pas diverger en
 * silence.
 */

// LA RÈGLE DE DÉRIVATION A UN PROPRIÉTAIRE : `plafondDe` (lhci-cls-budgets.cjs)
// arrondit le produit mesure × marge au centième voisin. Une seconde copie de cet
// arrondi ferait diverger les deux tables sur ce point, en silence.
const { plafondDe } = require('./lhci-cls-budgets.cjs');

/**
 * La marge du plafond, et le plancher exprimé en part de la mesure. Les deux
 * nombres sont justifiés dans l'en-tête (« La marge : 1,25 ») — et le garde
 * (`scripts/__tests__/lcp-app-budgets.test.js`) refuse une entrée qui n'aurait
 * pas ses runs, son élément élu, ou un plafond sous sa propre mesure.
 */
const MARGE = 1.25;
const PART_PLANCHER = 0.6;

/**
 * Les cinq routes d'application, par clé de `CADRES_APP` — jamais par nom de
 * fichier : la clé est le domicile de la route (`src/config/app-cadres.js`), et
 * c'est aussi celle de `CLS_BUDGETS`. `/jobs/:id` porte un PARAMÈTRE, la clé
 * reste la clé : c'est la sonde qui visite une URL concrète.
 *
 * `runs` = les aires relevées, dans l'ordre des runs. Elles sont TOUTES égales
 * ici (aucun bruit), et c'est écrit tel quel plutôt que résumé en un nombre : un
 * relevé qui bougerait demain doit se VOIR dans la table, pas être moyenné sans
 * trace.
 *
 * `element` = ce que le navigateur a élu (les trois runs, identiques). Il est
 * déclaré parce que le plafond borne l'aire de CETTE élection : un élément qui
 * change de nature est exactement ce qu'on veut voir rougir, et le message
 * d'échec peut alors nommer ce que la route peignait.
 */
const LCP_APP_BUDGETS = {
  '/dashboard': {
    mobile: {
      runs: [8626, 8626, 8626],
      element: '<h1> « Bienvenue, Demo! »',
    },
    desktop: {
      runs: [17172, 17172, 17172],
      element: '<h1> « Bienvenue, Demo! »',
    },
  },
  '/profile': {
    mobile: {
      runs: [11211, 11211, 11211],
      element: '<p> « Aucun avis pour le moment. Les notes app… »',
    },
    desktop: {
      runs: [21012, 21012, 21012],
      element: '<h1> « Demo Worker »',
    },
  },
  '/messages': {
    mobile: {
      runs: [4256, 4256, 4256],
      element: '<h1> « Messages »',
    },
    desktop: {
      runs: [8478, 8478, 8478],
      element: '<h1> « Messages »',
    },
  },
  '/create-job': {
    mobile: {
      runs: [11792, 11792, 11792],
      element: '<p> « Seuls le titre, le prix et la localisation… »',
    },
    desktop: {
      runs: [13446, 13446, 13446],
      element: '<h1> « Publier un job »',
    },
  },
  '/jobs/:id': {
    // LA TAILLE CHANGE L'ÉLÉMENT ÉLU, et c'est la raison d'une borne PAR TAILLE :
    // en mobile le plus grand peintre est l'encart du séquestre, en desktop c'est
    // la DESCRIPTION de l'annonce — six fois plus grande. Un plafond unique pour
    // les deux aurait été le plafond du cas desktop appliqué au mobile (7× de
    // marge, donc décoratif) ou l'inverse (un rouge à chaque run).
    mobile: {
      runs: [30361, 30361, 30361],
      element: '<p> « L’argent est bloqué sur le compte séquestre… »',
    },
    desktop: {
      runs: [142848, 142848, 142848],
      element: '<p> « Nous recherchons un électricien qualifié… » (la description de l’annonce)',
    },
  },
};

/** Les tailles mesurées — le vocabulaire de `TAILLES` dans `e2e/lcp-app.spec.js`. */
const TAILLES_APP = ['mobile', 'desktop'];

/** Le plus grand relevé de la cellule : ce qui a réellement été peint. */
const pireDesRuns = (cellule) => Math.max(...cellule.runs);

/**
 * Un arrondi commun aux deux tables : `plafondDe(valeur, 1)` ramène au centième
 * voisin, donc une aire se lit en centaines de px² comme un budget de temps se
 * lit en centaines de ms. Réutiliser la règle plutôt que la réécrire évite deux
 * arrondis qui divergeraient d'un cran.
 */
const arrondiAire = (valeur) => plafondDe(valeur, 1);

/** Le plafond d'une cellule : la mesure × la marge, arrondie (règle partagée). */
const plafondAire = (cellule) => plafondDe(pireDesRuns(cellule), MARGE);

/** Le plancher d'une cellule : la même mesure, à 60 % — un plafond seul ne lit rien. */
const plancherAire = (cellule) => arrondiAire(pireDesRuns(cellule) * PART_PLANCHER);

/**
 * La cellule d'une route à une taille, ou un REFUS NOMMÉ.
 *
 * `undefined` (route inconnue, taille inconnue, ou table amputée) rend tout de
 * suite un message qui dit QUOI mesurer — c'est la convention de la table du CLS
 * (`clsAssertionMatrix` lève sur une page auditée sans plafond) et de
 * `plafondTbtDesktop` : sans valeur mesurée, la route serait sondée SANS borne,
 * donc la régression passerait et rien ne le dirait.
 */
const celluleDe = (route, taille) => {
  const cellule = LCP_APP_BUDGETS[route] && LCP_APP_BUDGETS[route][taille];
  if (!cellule) {
    throw new Error(
      `aire LCP non mesurée pour « ${route} » (${taille}) : mesurer la route (e2e/lcp-app.spec.js, ` +
        '--repeat-each=3, au moins 3 runs) puis l’ajouter à LCP_APP_BUDGETS. Sans valeur mesurée, ' +
        'la route serait sondée SANS plafond d’aire : un élément qui se met à peindre plus grand ' +
        'passerait, et rien ne le dirait.'
    );
  }
  return cellule;
};

/**
 * LE VERDICT D'UNE AIRE CONTRE SA BANDE — le SEUL propriétaire de la
 * comparaison.
 *
 * Les bornes sont INCLUSIVES (`plafond` et `plancher` sont « dans » la bande) et
 * c'est cette fonction que la sonde interroge : deux comparaisons écrites d'un
 * côté et d'un autre finiraient par ne plus dire la même chose, et c'est
 * exactement le genre d'écart qu'un garde ne peut pas voir.
 *
 * @param {{plancher: number, plafond: number}} bande La bande mesurée.
 * @param {number} aire L'aire peinte relevée par la sonde.
 * @returns {'dans'|'au-dessus'|'sous'} Le verdict, le côté nommé en clair.
 */
const verdictDaire = (bande, aire) => {
  if (aire > bande.plafond) return 'au-dessus';
  if (aire < bande.plancher) return 'sous';
  return 'dans';
};

/**
 * La BANDE d'aire d'une cellule : ce que la sonde compare, et tout ce qu'il faut
 * pour réparer un rouge sans relire la table.
 *
 * @param {string} route Clé de route (`/jobs/:id`, pas `/jobs/playtech-job-1`).
 * @param {string} taille `mobile` ou `desktop`.
 * @returns {{runs: number[], pire: number, plancher: number, plafond: number,
 *   marge: number, element: string}} La bande mesurée.
 * @throws {Error} La cellule n'a pas de mesure (voir `celluleDe`).
 */
const bandeDaireApp = (route, taille) => {
  const cellule = celluleDe(route, taille);
  return {
    runs: [...cellule.runs],
    pire: pireDesRuns(cellule),
    plancher: plancherAire(cellule),
    plafond: plafondAire(cellule),
    marge: MARGE,
    element: cellule.element,
  };
};

module.exports = {
  LCP_APP_BUDGETS,
  TAILLES_APP,
  MARGE,
  PART_PLANCHER,
  arrondiAire,
  pireDesRuns,
  plafondAire,
  plancherAire,
  verdictDaire,
  bandeDaireApp,
};
