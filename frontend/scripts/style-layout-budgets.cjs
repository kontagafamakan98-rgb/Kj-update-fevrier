/**
 * LES BUDGETS DU DOCUMENT PRÉ-RENDU — « Style & Layout », route par route.
 *
 * ── Le fait, et pourquoi il a un propriétaire ────────────────────────────────
 * Après l'élagage du CSS (`scripts/check-css-selecteurs-morts.js`), la feuille
 * servie est la MÊME sur les 13 pages : 60 929 o, 811 règles. Elle coûte donc la
 * MÊME chose partout — mesuré sur les médianes : 1,3 à 51,8 ms selon la route et
 * la condition. Ce n'est pas elle qui fait la différence : la différence, c'est
 * le LAYOUT.
 *
 * Mesuré au CDP (`Performance.getMetrics` : `RecalcStyleDuration` +
 * `LayoutDuration`, sur une page NEUVE dont le bundle d'entrée est bloqué — c'est
 * donc le DOCUMENT qui est mesuré, jamais React), MINIMUM de 5 runs, le
 * 25/09/2026. Le minimum, et non la médiane : sur ce poste partagé le bruit ne
 * peut qu'AJOUTER du temps (médiane jusqu'à +44 % au-dessus du minimum sur
 * l'accueil mobile, alors que le rapport médiane/minimum est de 1,02 à 1,07 sur
 * les autres routes) — c'est le minimum qui décrit le coût de l'artefact.
 *
 *   route             minimum du total        hauteur (mobile, px)
 *                     mobile cpu×4   desktop cpu×1
 *   /                  662            126       7 075
 *   /register          452             86       2 946
 *   /how-it-works      344             61       2 957
 *   /contact           278             46       1 385
 *   /support           261             51       1 652
 *   /forgot-password   255             46         926
 *   /about             245             47       1 691
 *   /login             230             45         965
 *   /payment           220             43         885
 *   /privacy           169             33       1 627
 *   /jobs              155             30         823
 *
 * La répartition style/layout, elle, est relevée sur les MÉDIANES (seul découpage
 * mesuré séparément) : le recalcul de style pèse 2 à 6 % du total sur les deux
 * conditions — 4,6 à 51,8 ms contre un layout de 28,6 à 676,1 ms.
 *
 * ── Ce que la mesure a appris, et ce qu'elle a fermé ────────────────────────
 *   • LE STYLE N'EST JAMAIS LE SUJET : 2 à 6 % du total. Les 811 règles du
 *     document coûtent ~10 ms là où le layout en coûte 141 à 647. L'élagage du
 *     CSS était justifié (poids mort, sources menteuses) mais il n'était PAS le
 *     coût — ne pas rouvrir ce chantier-là pour la performance du document.
 *   • LE COÛT EST DANS LE HAUT DU DOCUMENT, ET IL Y A UNE PART FIXE. Balayage de
 *     l'accueil mobile (le document tronqué à 1, 2, … 10 sections, minimum de
 *     3 runs) : 1 section → 339 ms ; 2 → 366 ; 3 → 494 ; 4 → 558 ; 5 → 558 ;
 *     6 → 569 ; 7 → 618 ; 8 → 628 ; 9 → 622 ; 10 → 650. Les QUATRE premières
 *     sections portent 86 % du coût ; les six dernières (3 800 px, ~40 % du
 *     markup) n'ajoutent que ~90 ms.
 *   • COROLLAIRE MESURÉ, ET CONTRE-INTUITIF : AJOUTER DU CONTENU EST QUASI
 *     GRATUIT, MÊME EN TÊTE. Quatre mutations, mesurées au minimum de 5 runs :
 *     +6 000 px de `<div style="height:6000px">` en haut de `<main>` = 0 ms ;
 *     republier tout `<main>` à la suite (279 → 469 nœuds, 7 075 → 13 848 px) =
 *     ×0,99 ; le héros publié TROIS fois en tête (+32 nœuds, +1 281 px) = 650 →
 *     672 ms (+3 %) ; les deux premières sections dupliquées en tête (+42 nœuds,
 *     +1 179 px) = 657 ms (+1 %). Le coût marginal d'un nœud mis en page est donc
 *     de l'ordre de 0,5 ms à cpu×4 — contre ~2,3 ms/nœud en moyenne, ce qui dit
 *     qu'une PART FIXE (de l'ordre de 250 à 300 ms sur cette route) domine : le
 *     chrome, la première section, et la mise en page initiale d'un document qui
 *     dépasse l'écran.
 *   • L'ANCIENNE LECTURE — « le coût suit les pixels ou les nœuds » — est
 *     RÉFUTÉE par ces mutations, et elle est conservée ici parce qu'elle était
 *     naturelle : la corrélation tenait pour les routes telles quelles
 *     (~0,09 ms/px à cpu×4) et tombait dès qu'on touchait au contenu.
 *   • LE SEUL LEVIER SYSTÉMIQUE MESURÉ est `content-visibility: auto` sur les
 *     sections 2 à 10 : −172 ms sur l'accueil mobile (659 → 487), et il ne les
 *     gagne QUE parce que les sections 2-4 sont justement sous la ligne de
 *     flottaison (le héros mesure 1 125 px pour un écran de 823 px) — celles qui
 *     portent le coût. Son prix est réel : la hauteur de défilement devient
 *     fausse (9 415 px au lieu de 7 075) tant que `contain-intrinsic-size`
 *     n'annonce pas la taille réelle, et les neuf sections mesurent 312 à 962 px,
 *     donc aucune constante ne peut être juste pour les deux tailles d'écran.
 *   • LA MESURE RÉCONCILIE AVEC LIGHTHOUSE, ce qui est la preuve qu'elle parle du
 *     même travail : /jobs desktop, document + React = 64 ms ici, contre 73–76 ms
 *     relevés par l'audit dans `lighthouserc.desktop.cjs` ; / mobile, 724 ms
 *     document + React à cpu×4, contre les 570-660 ms des relevés de la même
 *     famille dans `AGENTS.md` (mesurés, eux, avec la feuille d'avant l'élagage).
 *
 * ── Ce que ces budgets NE disent pas ────────────────────────────────────────
 *   • Ils ne bornent que le DOCUMENT pré-rendu (coquille), dans les deux
 *     conditions de la CI. La part de React après montage, le premier écran peint
 *     et le CLS ont leurs propres gardes (`e2e/lcp-geometrie*.spec.js`,
 *     `e2e/cls-coquille-react.spec.js`) et leurs propres tables.
 *   • Le verdict est BIDIRECTIONNEL, et c'est la mesure qui l'impose :
 *       – au-dessus : ×1,5, ou +80 ms en mobile et +40 ms en desktop (le plus
 *         grand des deux) — la marge absorbe un hôte plus lent que celui des
 *         relevés, le mobile étant bridé ×4 et partagé (médiane jusqu'à +44 %
 *         au-dessus du minimum) ;
 *       – en dessous : ×0,6. Un document qui DEVIENT BEAUCOUP MOINS CHER a perdu
 *         son contenu — une coquille qui cesse de publier son corps est une
 *         régression (contrat SEO/sans-JavaScript), et c'est la seule direction
 *         que les mutations savent faire rougir : retirer les neuf dernières
 *         sections de l'accueil fait tomber la mesure de 650 à 339 ms, très sous
 *         la borne.
 *     Ce qui est attesté, et ce qui ne l'est pas : la borne HAUTE n'a pas pu être
 *     franchie par mutation (les quatre tentatives ci-dessus, toutes bénignes par
 *     mesure), donc elle est un garde-fou de CATASTROPHE — et il est écrit ici
 *     qu'elle ne prétend pas attraper une dérive fine, parce qu'un garde qui
 *     rougirait sur ce que la mesure a montré gratuit mentirait sur ce qu'il sait.
 *
 * Mesure rejouable : `cd frontend && npx playwright test e2e/style-layout-document.spec.js`
 * (elle exige un build à jour, comme les autres sondes de géométrie).
 */

/** Les deux conditions de la CI : celles des relevés ci-dessus. */
const CONDITIONS = [
  { nom: 'mobile', viewport: { width: 412, height: 823 }, cpu: 4 },
  { nom: 'desktop', viewport: { width: 1350, height: 940 }, cpu: 1 },
];

/** Minima mesurés le 25/09/2026 (style + layout, en ms), 5 runs par case. */
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
 * La marge, par condition : le mobile est bridé ×4 ET partagé avec le reste du
 * poste (médiane jusqu'à +44 % au-dessus du minimum sur l'accueil), le desktop ne
 * l'est pas et son étendue sur 5 runs va de 1,6 à 7,6 ms.
 */
const MARGES = { mobile: { ratio: 1.5, absolue: 80 }, desktop: { ratio: 1.5, absolue: 40 } };
const budgetDe = (mesure, condition) => {
  const marge = MARGES[condition] || MARGES.desktop;
  return Math.ceil(Math.max(mesure * marge.ratio, mesure + marge.absolue) / 5) * 5;
};

/**
 * La borne BASSE, en fraction du relevé de RÉFÉRENCE de la route (et non du
 * budget) : elle attrape un document qui a perdu sa matière. Mesuré : 339 ms
 * pour l'accueil réduit à sa première section, contre 650 ms complet — soit 0,52
 * du relevé, très sous la borne. Elle n'est pas plus serrée que 0,6 parce qu'un
 * hôte plus rapide que celui des relevés doit rester vert.
 */
const BORNE_BASSE_RATIO = 0.6;

const BUDGETS_STYLE_LAYOUT = Object.fromEntries(
  Object.entries(MESURE).map(([route, parCondition]) => [
    route,
    Object.fromEntries(Object.entries(parCondition).map(([condition, mesure]) => [condition, budgetDe(mesure, condition)])),
  ])
);

module.exports = { CONDITIONS, MESURE, MARGES, BORNE_BASSE_RATIO, BUDGETS_STYLE_LAYOUT, budgetDe };
