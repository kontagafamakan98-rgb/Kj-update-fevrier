/**
 * LA STRUCTURE PUBLIÉE DU DOCUMENT PRÉ-RENDU — ce qui DÉCIDE —, ET SON COÛT
 * MESURÉ, qui est publié sans juger.
 *
 * ── Ce que ce fichier a changé, et sur quelle mesure ────────────────────────
 * Sa première version prononçait un verdict BIDIRECTIONNEL sur le TEMPS :
 * « Style & Layout » (RecalcStyleDuration + LayoutDuration, lus au CDP) devait
 * tomber entre 0,6 × et 1,5 × le relevé du poste. Le premier passage de la sonde
 * dans la CI a réfuté ce verdict-là, et c'est la mesure qui le réfute :
 *
 *   25/09/2026, run 36188879161 (ubuntu-latest, `e2e-playwright`) : 18 des 22
 *   cases rouges, TOUTES sur la borne basse, sur le MÊME artefact que le poste
 *   vient de mesurer intact — dont 5 cases avec la structure publiée à
 *   l'identique :
 *
 *     route/condition      poste (5 runs)   CI (3 runs)   rapport   nœuds/px
 *     /          mobile    662 ms           80,4 ms       ×8,2      279 / 7 107
 *     /contact   desktop   46 ms            23,3 ms       ×2,0      120 / 1 086
 *     /jobs      mobile    155 ms           45,9 ms       ×3,4      103 / 823
 *     /register  mobile    452 ms           74,6 ms       ×6,1      203 / 2 947
 *     /support   desktop   51 ms            24,2 ms       ×2,1      135 / 1 002
 *
 *   Une borne en millisecondes n'y borne donc pas une régression : elle borne la
 *   MACHINE. Le même artefact coûte de 1,85 à 8,2 fois moins cher sur un runner
 *   Linux que sur ce poste partagé (Windows, 23 Chrome utilisateur) — 1,85 × sur
 *   /payment desktop (43 → 23,2 ms), 8,2 × sur l'accueil mobile — et aucune marge
 *   ne peut couvrir les deux : élargie jusqu'à ×8,2, la borne haute ne
 *   distinguerait plus rien du tout. Ce qui devait être protégé — « la coquille cesse de publier son
 *   corps », une régression du contrat SEO / sans-JavaScript — se mesure sur un
 *   axe qui, lui, est une propriété de l'ARTEFACT :
 *
 *   • LES NŒUDS SONT IDENTIQUES SUR LES DEUX HÔTES, sur les 11 routes (279, 112,
 *     120, 108, 157, 103, 114, 98, 106, 203, 135) ;
 *   • LA HAUTEUR DU DOCUMENT s'accorde à 0,9 % près là où les deux hôtes ont
 *     imprimé la leur (18 cases sur 22 : 7 075 → 7 107 px, 4 782 → 4 807, 2 957 →
 *     2 982, 2 515 → 2 516, 1 385 → 1 385, 940 → 940, 926 → 926, …).
 *
 * Le verdict est donc STRUCTUREL, et il a 20 fois la marge de l'écart entre
 * hôtes : 0,8 de la structure de référence.
 *
 * ── Le coût, lui, reste publié ──────────────────────────────────────────────
 * Les deux tables de temps ci-dessous gardent ce que la mesure a appris, avec
 * son hôte et sa date, et la sonde imprime le style, le layout et le total de
 * chaque case dans son journal (`ℹ️`). Ce qui a été appris ne se perd pas :
 *   • LE STYLE N'EST JAMAIS LE SUJET : 2 à 6 % du total (1,3 à 51,8 ms contre
 *     28,6 à 676,1 ms de layout). L'élagage du CSS était justifié (poids mort,
 *     sources menteuses) mais il n'était PAS le coût — ne pas rouvrir ce
 *     chantier-là pour la performance du document.
 *   • LE COÛT EST DANS LE HAUT DU DOCUMENT, ET IL Y A UNE PART FIXE. Balayage de
 *     l'accueil mobile tronqué à 1, 2, … 10 sections (minimum de 3 runs) : 339 /
 *     366 / 494 / 558 / 558 / 569 / 618 / 628 / 622 / 650 ms. Les QUATRE
 *     premières sections portent 86 % du coût ; les six dernières (3 800 px,
 *     ~40 % du markup) n'en ajoutent que ~90.
 *   • COROLLAIRE MESURÉ, ET CONTRE-INTUITIF : AJOUTER DU CONTENU EST QUASI
 *     GRATUIT, MÊME EN TÊTE. Quatre mutations, au minimum de 5 runs : +6 000 px
 *     de `<div style="height:6000px">` en haut de `<main>` = 0 ms ; tout `<main>`
 *     republié à la suite (279 → 469 nœuds) = ×0,99 ; le héros publié trois fois
 *     en tête = +3 % ; les deux premières sections dupliquées = +1 %.
 *   • LA MESURE RÉCONCILIE AVEC LIGHTHOUSE : /jobs desktop, document + React =
 *     64 ms ici contre 73–76 ms relevés par l'audit de `lighthouserc.desktop.cjs`.
 *   • LE SEUL LEVIER SYSTÉMIQUE MESURÉ est `content-visibility: auto` sur les
 *     sections 2 à 10 : −172 ms sur l'accueil mobile (659 → 487), au prix d'une
 *     hauteur de défilement FAUSSE tant que `contain-intrinsic-size` n'annonce
 *     pas la taille réelle — levier réel, prix réel, décision produit.
 * Conséquence assumée de ce déplacement : le coût du document n'est plus un gate
 * de PR. Il est couvert là où il se voit vraiment, par les budgets Lighthouse du
 * déploiement (`lighthouserc*.cjs`, job `lighthouse-ci`) et par les gardes de
 * POIDS (`check-bundle-size.js`, `check-home-shell.js`), dont la grandeur — des
 * octets d'artefact — ne dépend pas de la machine qui les lit.
 *
 * Mesure rejouable : `cd frontend && npx playwright test e2e/style-layout-document.spec.js`
 * (elle exige un build à jour, comme les autres sondes de géométrie).
 */

/** Les deux conditions de la CI : celles des relevés. */
const CONDITIONS = [
  { nom: 'mobile', viewport: { width: 412, height: 823 }, cpu: 4 },
  { nom: 'desktop', viewport: { width: 1350, height: 940 }, cpu: 1 },
];

/**
 * Le COÛT mesuré (style + layout, en ms), minima de 5 runs le 25/09/2026 sur le
 * poste de développement — un poste PARTAGÉ (Windows, 23 Chrome utilisateur),
 * d'où le minimum et non la médiane : sur ce poste le bruit ne peut qu'AJOUTER du
 * temps (médiane jusqu'à +44 % au-dessus du minimum sur l'accueil mobile, alors
 * que le rapport médiane/minimum est de 1,02 à 1,07 sur les autres routes).
 *
 * Ces nombres ne jugent plus rien (voir l'en-tête) : ils sont le relevé de
 * référence de l'hôte, publié par la sonde à chaque passage.
 */
const MESURE = {
  '/': { mobile: 662, desktop: 126 },
  '/about': { mobile: 245, desktop: 47 },
  '/contact': { mobile: 278, desktop: 46 },
  '/forgot-password': { mobile: 255, desktop: 46 },
  '/how-it-works': { mobile: 344, desktop: 61 },
  '/jobs': { mobile: 155, desktop: 30 },
  '/login': { mobile: 230, desktop: 45 },
  '/payment': { mobile: 220, desktop: 43 },
  '/privacy': { mobile: 169, desktop: 33 },
  '/register': { mobile: 452, desktop: 86 },
  '/support': { mobile: 261, desktop: 51 },
};

/**
 * Le même artefact mesuré sur le runner Linux de la CI (minima de 3 runs, run
 * 36188879161). Il n'est PAS une référence à battre : c'est la preuve, chiffrée,
 * que l'axe du temps n'appartient pas à l'artefact. Les 4 cases absentes sont
 * celles qui sont restées au-dessus de l'ancienne borne basse du poste — la
 * sonde n'imprime une mesure que lorsqu'un verdict tombe.
 */
const MESURE_CI = {
  '/': { mobile: 80.4, desktop: 34.4 },
  '/about': { mobile: 46.7, desktop: 23.7 },
  '/contact': { mobile: 49.8, desktop: 23.3 },
  '/forgot-password': { mobile: 57.4, desktop: null },
  '/how-it-works': { mobile: 55.4, desktop: 24.1 },
  '/jobs': { mobile: 45.9, desktop: null },
  '/login': { mobile: 64.2, desktop: null },
  '/payment': { mobile: 47.5, desktop: 23.2 },
  '/privacy': { mobile: 41.2, desktop: null },
  '/register': { mobile: 74.6, desktop: 31.7 },
  '/support': { mobile: 52.2, desktop: 24.2 },
};

/**
 * LES NŒUDS du document pré-rendu, par route — la moitié STRUCTURELLE du verdict,
 * et la plus dure : mesurée IDENTIQUE sur les deux hôtes, sur les 11 routes.
 */
const NOEUDS = {
  '/': 279,
  '/about': 112,
  '/contact': 120,
  '/forgot-password': 108,
  '/how-it-works': 157,
  '/jobs': 103,
  '/login': 114,
  '/payment': 98,
  '/privacy': 106,
  '/register': 203,
  '/support': 135,
};

/**
 * LA HAUTEUR du document pré-rendu, par route et par condition (px). C'est le
 * relevé du poste ; sur les 18 cases où la CI a imprimé le sien, l'écart va de 0
 * à 32 px, soit 0,9 % au plus (accueil mobile 7 075 → 7 107), très à l'intérieur
 * de la marge de la borne.
 */
const HAUTEUR = {
  '/': { mobile: 7075, desktop: 4782 },
  '/about': { mobile: 1691, desktop: 1086 },
  '/contact': { mobile: 1385, desktop: 1086 },
  '/forgot-password': { mobile: 926, desktop: 940 },
  '/how-it-works': { mobile: 2957, desktop: 2124 },
  '/jobs': { mobile: 823, desktop: 940 },
  '/login': { mobile: 965, desktop: 940 },
  '/payment': { mobile: 885, desktop: 940 },
  '/privacy': { mobile: 1627, desktop: 1104 },
  '/register': { mobile: 2946, desktop: 2515 },
  '/support': { mobile: 1652, desktop: 990 },
};

/**
 * La marge de la borne, en fraction de la structure de référence : 20 points,
 * soit 22 fois l'écart mesuré entre les deux hôtes (0,9 % au plus, et 0 sur les
 * nœuds). Elle n'est pas plus serrée parce qu'un hôte n'embarque pas forcément
 * les mêmes polices : une hauteur qui suit le retour à la ligne ne doit pas
 * devenir un test de police.
 *
 * Ce qui la franchit est MESURÉ, et rejoué : l'accueil amputé de ses neuf
 * dernières sections descend de 279 à 105 nœuds (0,38 du relevé) et de 7 075 à
 * 1 125 px en mobile, de 4 782 à 1 086 px en desktop (0,16 et 0,23) — deux fois
 * et demie sous la borne. Shell bâti avant mutation : 94 329 o, SHA-1
 * 997b3d3c1adb50e3fa669ab29f8ae395249b3aa4 ; après : 75 601 o, SHA-1
 * dbb86205f4d247d8828f2c0d839c8a3b515d000c ; restauré à l'identique, les deux
 * sorties rouges (`/ — mobile` ET `/ — desktop`) nommant « 105 nœuds peints, sous
 * le plancher de 223 ».
 */
const BORNE_STRUCTURE = 0.8;

/** Le plancher de nœuds d'une route, dérivé de la mesure — jamais recopié. */
const plancherNoeudsDe = (noeuds) => Math.floor(noeuds * BORNE_STRUCTURE);

/** Le plancher de hauteur d'une case, dérivé de la mesure — jamais recopié. */
const plancherHauteurDe = (hauteur) => Math.floor(hauteur * BORNE_STRUCTURE);

module.exports = {
  CONDITIONS,
  MESURE,
  MESURE_CI,
  NOEUDS,
  HAUTEUR,
  BORNE_STRUCTURE,
  plancherNoeudsDe,
  plancherHauteurDe,
};
