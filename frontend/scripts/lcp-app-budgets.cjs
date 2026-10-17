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
 * ── RE-MESURE DU 17/10/2026, APRÈS LE BANDEAU D'IDENTITÉ DE /profile ────────
 * Le fond orange plein de /profile est devenu le `.bande-app` du tableau de
 * bord, donc son `<h1>` passe de `.titre-heros` (56 px en desktop) à
 * `.titre-page` (44 px) : l'élément ÉLU ne change pas, son AIRE si. Trois runs
 * de nouveau, protocole de `e2e/lcp-app.spec.js`, 412×823 et 1350×940 :
 *   • /profile mobile  : 11 211 ×3 — INCHANGÉ, et c'est ce qu'il fallait
 *     vérifier : le plus grand peintre mobile est la phrase d'état vide des
 *     avis, pas l'en-tête, donc retoucher le bandeau ne pouvait pas déplacer
 *     l'élection mobile (la mesure le dit, elle ne le suppose pas) ;
 *   • /profile desktop : 13 392 ×3 (contre 21 012 avant) — même `<h1>` « Demo
 *     Worker », boîte 245,97 × 45,75 px. C'est une BAISSE de l'aire du même
 *     élément, pas un changement de peintre : elle reste dans la bande dérivée
 *     (plancher 60 %).
 * Le run de la CI (16 215) de la cellule mobile est conservé : il décrit
 * toujours la MÊME phrase du MÊME élément.
 *
 * ── RE-MESURE DU 17/10/2026, APRÈS L'ALIGNEMENT DE /create-job ET /jobs/:id ──
 * Le formulaire de publication est passé d'UNE carte de quinze champs à quatre
 * cartes titrées (`.titre-carte-app`), et la fiche d'annonce a reçu les tuiles
 * de mesure, les étiquettes d'état et les filets des écrans d'application. Trois
 * runs de nouveau, protocole inchangé, 412×823 et 1350×940 :
 *   • /create-job mobile : 11 792 ×3 — INCHANGÉ, et c'est ce qu'il fallait
 *     vérifier : le plus grand peintre mobile est le chapeau du formulaire, qui
 *     est AU-DESSUS des quatre cartes ; desktop 13 446 ×3, le `<h1>` « Publier
 *     un job » : les cartes n'ont pas déplacé l'élection, elles ont déplacé ce
 *     qui la suit ;
 *   • /jobs/:id mobile : 30 361 ×3 — INCHANGÉ (l'encart du séquestre) ; desktop
 *     183 024 ×3 au lieu de 142 848, MÊME `<p>` et MÊME phrase. La tranche
 *     VISIBLE du paragraphe a grandi parce que le bloc commence plus haut — le
 *     commentaire de la cellule dit ce que la mesure ne démêle pas (les hauteurs
 *     du relevé de référence n'ont pas été conservées).
 * Le CLS des deux routes, relevé au même passage (`e2e/cadres-app.spec.js`,
 * budgets 0,02 pour /create-job et 0,04 pour /jobs/:id) : /create-job 0,0000
 * mobile / 0,0048 desktop, et 0,0000 / 0,0039 pendant le chunk de sa route ;
 * /jobs/:id annonce LONGUE 0,0000 / 0,0039, annonce COURTE 0,0000 / 0,0127
 * (0,0164 le 09/10/2026 sur ce même cas court : la mécanique du pied de page
 * réservé n'a pas bougé, et elle reste sous son budget dans les deux cas).
 *
 * LES TRENTE RELEVÉS SONT IDENTIQUES AU PX², et le MÊME élément est élu à chaque
 * run (le relevé publie les deux, `e2e/lcp-app.spec.js`). Cette stabilité-là est
 * celle du POSTE — et le même protocole, rejoué le 11/10/2026 sur le runner de la
 * CI, ne redonne pas les mêmes aires :
 *
 *   route        taille   poste partagé   runner de la CI   bande du poste
 *   /dashboard   mobile    8 626 ×3       8 588  (−0,44 %)  5 200–10 800  DANS
 *   /profile     mobile   11 211 ×3      16 215  (+44,6 %)  6 700–14 000  AU-DESSUS
 *
 * La cause est celle que le dépôt a DÉJÀ mesurée ailleurs (angle du 26/09/2026 de
 * CI-COVERAGE.md, PR #152 : « l'aire de l'ENCRE de l'élément élu suit les polices
 * de l'hôte », jusqu'à −18 % sur le runner À BOÎTE D'ÉLÉMENT IDENTIQUE) : ces
 * cellules ne bornent pas un cadre mais une AIRE DE TEXTE, et le repli du texte
 * suit la police appliquée. Sur /profile mobile, la phrase d'état vide du profil
 * tient sur DEUX lignes ici et sur TROIS là-bas — la classe a été reproduite sur
 * ce poste en élargissant la police de l'élément élu (une police étrangère, comme
 * la sonde d'atelier de la PR #152) : la même phrase passe à trois lignes et
 * l'aire de 11 211 monte à ~15 000–16 000 px², du même ordre que le relevé du
 * runner. Même élément, même phrase, une ligne de plus.
 *
 * CE QUI REMPLACE LA PHRASE QUI ÉTAIT ICI (« il n'y a AUCUN bruit de machine à
 * couvrir, donc la marge ne peut pas être justifiée comme telle ») : c'était vrai
 * du POSTE, faux de la MACHINE. La cellule de /profile mobile porte donc le relevé
 * du runner COMME UN RUN, à côté des trois du poste, et ses deux bornes se
 * dérivent de ce run-là — le remède déjà appliqué aux planchers de
 * `e2e/lcp-geometrie-declaree.spec.js` (≈ 70 % du plus PETIT des relevés connus,
 * les chiffres des deux hôtes en commentaire). La règle de dérivation, elle, ne
 * change pas d'un cran (plancher 60 %, plafond ×1,25 du pire) : c'est la MESURE
 * qui s'élargit, jamais le calcul. Une cellule dont le texte peut se replier
 * autrement se re-mesure — elle ne s'élargit pas en silence — et le message
 * d'échec nomme l'élément élu VIVANT et sa boîte (voir `e2e/lcp-app.spec.js`),
 * pour que le prochain hôte se diagnostique tout seul.
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
      // LE 4e RUN VIENT D'UN AUTRE HÔTE, et il n'est pas moyenné : c'est le
      // runner de la CI (11/10/2026) qui peint la MÊME phrase du MÊME élément sur
      // TROIS lignes au lieu de deux (voir l'en-tête — « l'aire de l'ENCRE de
      // l'élément élu suit les polices de l'hôte »). C'est ce relevé qui porte le
      // plafond : sans lui, le run du runner rougissait sur une phrase justifiée
      // autrement — un rouge de police, pas de page. Les trois premiers sont les
      // runs du poste partagé (09/10/2026), identiques au px².
      runs: [11211, 11211, 11211, 16215],
      element: '<p> « Aucun avis pour le moment. Les notes app… »',
    },
    desktop: {
      // RE-MESURÉ LE 17/10/2026 avec le bandeau d'identité : le même `<h1>`,
      // dont `.titre-page` réduit l'aire de 21 012 à 13 392 px² (voir l'en-tête).
      // Le plancher dérivé (60 %) reste au-dessus de zéro contenu, donc la
      // cellule continue de refuser une page qui aurait perdu son titre.
      runs: [13392, 13392, 13392],
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
      // RE-MESURÉ LE 17/10/2026 (trois runs, protocole de `e2e/lcp-app.spec.js`) :
      // MÊME élément, MÊME phrase, mais 183 024 px² au lieu de 142 848. L'aire
      // comptée n'est pas l'encre du paragraphe : c'en est la TRANCHE VISIBLE
      // (743,4 × 246,3 px), et cette tranche a grandi parce que le bloc commence
      // à y=692,5 au lieu d'environ 748 — donc parce que ce qui le précède est
      // plus court. Ce qui le précède, mesuré le même jour : carte d'en-tête
      // 211 px, encart de séquestre 156,3 px. Le relevé de référence ne
      // conservait pas ces hauteurs : la mesure ci-dessus ne dit donc PAS lequel
      // des deux a bougé, et c'est écrit plutôt que supposé. Ce qu'elle permet
      // de dire : l'élément élu est inchangé, sa largeur est inchangée, et une
      // page qui peindrait une SECTION entière à la place de ce paragraphe
      // (l'ancien plafond, 178 600) rougirait toujours.
      runs: [183024, 183024, 183024],
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
