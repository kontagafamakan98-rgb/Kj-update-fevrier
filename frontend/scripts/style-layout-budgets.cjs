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
 *   • LES GLYPHES EMOJI ÉTAIENT LE COÛT, ET ILS SONT PARTIS (26/09/2026).
 *     Remplacer les 21 glyphes décoratifs `aria-hidden` de l'accueil par un
 *     caractère latin retire ~194 à 202 ms de « Style & Layout » (632 → 439 ms)
 *     — ~31 % du document — à hauteur et nœuds inchangés. Appliqué (icônes SVG,
 *     src/config/page-icons.js), le document d'accueil passe de 639 à 467 ms en
 *     mobile (cpu×4) et de 126 à 87 ms en desktop. Aucun levier CSS ne s'en
 *     approchait : présentation texte des emoji, police monochrome, taille
 *     réduite, pile de polices, `text-rendering` — tous mesurés à ~0 ou négatifs.
 *   • L'EXTENSION AUX QUATRE AUTRES PAGES CONFIRME L'EFFET, SANS LE RÉPÉTER AU
 *     MÊME ORDRE DE GRANDEUR (26/09/2026, 25 à 30 tours ENTRELACÉS, minimum) :
 *     /contact −22,8 % en mobile et −23,0 % en desktop, /support −17,9 % et
 *     −20,7 %, /about −5,4 % et −5,1 %, /how-it-works −4,6 % et −3,2 %, et les
 *     QUATRE glyphes du bloc de contact de l'accueil −12,5 % / −10,0 %. Le coût
 *     n'est donc pas « 21 glyphes » : il suit le NOMBRE d'emoji publiés, et à
 *     ~8 à 10 ms par glyphe mobile les pages qui en portent trois n'en gagnent
 *     que ~13. Ce qui reste vrai partout : le SENS de l'effet est le même, et le
 *     gain est proportionnel à la matière du premier écran.
 *   • LE PROTOCOLE DE MESURE COMPTE AUTANT QUE LE CHIFFRE. En mesurant chaque
 *     variante À LA SUITE (minimum de 8-12 runs), la réorganisation de la pile de
 *     polices montrait −54 ms ; en ENTRELACANT les variantes à chaque tour (25
 *     runs), l'écart s'INVERSAIT (+15 ms) : c'était la DÉRIVE de l'hôte, pas un
 *     effet. Une réduction de quelques dizaines de ms ne se lit pas en séquentiel
 *     sur ce poste — entrelacer, c'est ce qui rend le minimum comparable.
 *   • LE SECOND LEVIER, APPLIQUÉ LE 26/09/2026 : `content-visibility: auto` sur
 *     les sections 2 à 10 de l'accueil, le héros EXCLU (`:not(:first-of-type)`),
 *     avec un `contain-intrinsic-size` EXACT par section — la hauteur de CONTENU
 *     mesurée (hauteur rendue moins 96 px de `py-12` mobile / 128 px de `py-16`
 *     desktop). Mesuré ENTRELACÉ (15 tours, mobile cpu×4) : 419,8 → 319,3 ms de
 *     « Style & Layout », −100,5 ms (−24 %) ; la hauteur du document reste
 *     7 080 px mobile / 4 783 px desktop contre une référence de 7 079 / 4 782
 *     (+1 px), vérifiée section par section par `e2e/style-layout-document.spec.js`.
 *     Un repli UNIFORME de 1 000 px, lui, portait le document à 10 119 px
 *     (+3 040) : les hauteurs de contenu vont de 216 à 866 px, aucune constante
 *     unique ne convient. Le héros n'est jamais différé — / reste élu sur son
 *     `<H1>`, une seule candidate au premier paint, et le CLS est 0,0000 sur les
 *     deux canaux.
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
  // Relevé du 26/09/2026 APRÈS le remplacement des glyphes emoji de l'accueil
  // par des icônes SVG (src/config/page-icons.js), puis APRÈS l'extension aux
  // quatre autres pages qui en publiaient encore (À propos, Comment ça marche,
  // Support, Contact) et aux quatre glyphes du bloc de contact de l'accueil.
  // La mesure de cette seconde passe est ENTRELACÉE (25 à 30 tours, les deux
  // variantes à chaque tour — voir la leçon de protocole en tête de fichier) :
  //
  //   route            emoji → SVG (mobile)      emoji → SVG (desktop)
  //   /                484,5 → 423,7 (−60,8)     91,4 → 82,2 (−9,2)
  //   /about           244,0 → 230,9 (−13,1)     46,6 → 44,2 (−2,4)
  //   /contact         218,4 → 168,5 (−49,9)     42,7 → 32,8 (−9,8)
  //   /how-it-works    300,3 → 286,6 (−13,7)     57,3 → 55,4 (−1,8)
  //   /support         254,7 → 209,0 (−45,7)     49,4 → 39,2 (−10,2)
  '/': { mobile: 424, desktop: 82 },
  '/about': { mobile: 231, desktop: 44 },
  '/contact': { mobile: 169, desktop: 33 },
  // 26/09/2026, dernière vague emoji→SVG (les quatre écrans de compte). Relevés
  // de la sonde ci-dessus, après la migration : /login 230 → 176 (mobile) /
  // 45 → 35 (desktop), /register 452 → 294 / 86 → 52, /forgot-password 255 → 165
  // / 46 → 32, /payment 220 → 165 / 43 → 33. La BAISSE elle-même est mesurée
  // ENTRELACÉE (la variante emoji reconstruite dans le document livré en
  // remettant chaque emoji à la place de son `<svg data-icone=…>`, 25 tours,
  // minimum) : −34 % /login, −65 % /register (huit glyphes), −43 %
  // /forgot-password, −30 % /payment en mobile (et −38 / −74 / −55 / −35 % en
  // desktop). Le coût du PREMIER emoji d'une page n'est pas marginal
  // (chargement de la police de couleur) : ~47 à 66 ms sur mobile même pour un
  // seul glyphe, ce qui explique qu'une page à un glyphe gagne autant qu'une
  // page à six.
  '/forgot-password': { mobile: 165, desktop: 32 },
  '/how-it-works': { mobile: 287, desktop: 55 },
  '/jobs': { mobile: 155, desktop: 30 },
  '/login': { mobile: 176, desktop: 35 },
  '/payment': { mobile: 165, desktop: 33 },
  '/privacy': { mobile: 169, desktop: 33 },
  '/register': { mobile: 294, desktop: 52 },
  '/support': { mobile: 209, desktop: 39 },
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
  // 279 → 359 : les icônes SVG du corps de l'accueil ajoutent leurs nœuds
  // (chaque icône porte un <svg> plus ses <path>/<circle>) là où un emoji en
  // tenait un seul — 21 glyphes du corps (347) puis les 4 du bloc de contact
  // (359). La structure s'accorde toujours entre les deux hôtes.
  '/': 359,
  // +3 à +4 nœuds par icône dessinée là où un emoji en tenait un : les trois
  // cartes d'À propos (112 → 123), les quatre lignes de contact (120 → 132),
  // les trois étapes plus le séquestre de « Comment ça marche » (157 → 169) et
  // les six pastilles de /support (135 → 154).
  '/about': 123,
  '/contact': 132,
  // +3 nœuds chacun pour l'enveloppe de la réinitialisation (108 → 111) et pour
  // la mallette de /payment (98 → 101) : un `<svg>` plus ses tracés là où un
  // emoji tenait un seul nœud. /login +5 (114 → 119) et /register +30 (203 → 233,
  // ses huit glyphes). La structure s'accorde toujours entre les deux hôtes.
  '/forgot-password': 111,
  '/how-it-works': 169,
  '/jobs': 103,
  '/login': 119,
  '/payment': 101,
  '/privacy': 106,
  '/register': 233,
  '/support': 154,
};

/**
 * LA HAUTEUR du document pré-rendu, par route et par condition (px). C'est le
 * relevé du poste ; sur les 18 cases où la CI a imprimé le sien, l'écart va de 0
 * à 32 px, soit 0,9 % au plus (accueil mobile 7 075 → 7 107), très à l'intérieur
 * de la marge de la borne.
 */
const HAUTEUR = {
  // 7 075 → 7 079 px : le remplacement emoji→SVG change de 4 px la hauteur du
  // document (les pastilles d'icône ne portaient plus la hauteur de ligne du
  // glyphe). Vérifié : les deux canaux publient la même chose.
  '/': { mobile: 7079, desktop: 4782 },
  // 1 691 → 1 667 px en mobile : la carte d'À propos portait l'emoji dans un
  // `text-2xl` (une hauteur de ligne) ; le `<svg>` de 24 px en tient moins. Les
  // trois autres pages de la passe ne bougent pas d'un pixel.
  '/about': { mobile: 1667, desktop: 1086 },
  '/contact': { mobile: 1385, desktop: 1086 },
  // La dernière vague emoji→SVG ne bouge la hauteur que là où l'emoji portait
  // une hauteur de ligne plus grande que son SVG : /payment 885 → 893 en mobile
  // (l'emoji `text-4xl`), /register 2946 → 2947 mobile et 2515 → 2517 desktop.
  // /login (965/940) et /forgot-password (926/940) ne bougent pas d'un pixel.
  '/forgot-password': { mobile: 926, desktop: 940 },
  '/how-it-works': { mobile: 2957, desktop: 2124 },
  '/jobs': { mobile: 823, desktop: 940 },
  '/login': { mobile: 965, desktop: 940 },
  '/payment': { mobile: 893, desktop: 940 },
  '/privacy': { mobile: 1627, desktop: 1104 },
  '/register': { mobile: 2947, desktop: 2517 },
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
