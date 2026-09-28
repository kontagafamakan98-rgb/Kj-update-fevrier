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
 *     (puis 7 187 / 4 868 depuis que la police est servie par le site et le titre
 *     du héros rendu concret — les constantes de repli de src/App.css ont été
 *     re-mesurées le 26/09/2026), vérifiée section par section par
 *     `e2e/style-layout-document.spec.js`.
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
 * référence de l'hôte, publié par la sonde à chaque passage. Ils décrivent
 * l'artefact d'AVANT la police auto-hébergée (26/09/2026) et sont conservés
 * AVEC `MESURE_CI`, mesuré sur le même artefact : c'est cette paire-là — deux
 * hôtes, un seul artefact — qui prouve que l'axe du temps n'appartient pas à
 * l'artefact (de 1,8 × à 8,2 ×).
 * Le passage de la CI qui suit cette vague republiera les siens dans son journal,
 * où la sonde les imprime à côté des précédents.
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
  // Relevé du 28/09/2026, après la refonte éditoriale des quatre pages de
  // confiance (mêmes conditions, mêmes 3 runs) : /contact 169 → 158,4 ms mobile
  // et 33 → 26 ms desktop, /support 209 → 161,6 et 39 → 28,5, /privacy 169 →
  // 105,7 et 33 → 20,7, /terms 142,4 → 136,7 et 23,3 → 19,9. Le coût du
  // document change avec sa matière : ces quatre cases sont re-publiées ici
  // parce qu'elles décrivent l'artefact livré, les autres restant celles du
  // 26/09 (le TEMPS ne juge rien — voir l'en-tête).
  '/contact': { mobile: 158.4, desktop: 26 },
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
  '/privacy': { mobile: 105.7, desktop: 20.7 },
  '/register': { mobile: 294, desktop: 52 },
  '/support': { mobile: 161.6, desktop: 28.5 },
  // Page CGU (26/09/2026, relevée par la sonde) : même famille que /privacy.
  '/terms': { mobile: 136.7, desktop: 19.9 },
};

/**
 * Le même artefact mesuré sur le runner Linux de la CI (minima de 3 runs, run
 * 36188879161). Il n'est PAS une référence à battre : c'est la preuve, chiffrée,
 * que l'axe du temps n'appartient pas à l'artefact. Les 4 cases absentes sont
 * celles qui sont restées au-dessus de l'ancienne borne basse du poste — la
 * sonde n'imprime une mesure que lorsqu'un verdict tombe.
 *
 * CETTE TABLE ET `MESURE` DÉCRIVENT UN ARTEFACT D'AVANT LA POLICE AUTO-HÉBERGÉE
 * (26/09/2026) : elles restent la paire cohérente qui prouve la non-portabilité
 * du TEMPS (même artefact, deux hôtes, de 1,8 × à 8,2 × d'écart), et le passage
 * de la CI qui suit cette vague republiera ses propres chiffres dans son
 * journal. La sonde imprime les deux, avec leur hôte, à chaque case.
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
  // Page neuve : aucun relevé sur le runner de la CI pour l'instant (la sonde
  // imprime les deux hôtes dès que le passage suivant en publie un).
  '/terms': { mobile: null, desktop: null },
};

/**
 * LES NŒUDS du document pré-rendu, par route — la moitié STRUCTURELLE du verdict,
 * et la plus dure : mesurée IDENTIQUE sur les deux hôtes, sur les 11 routes.
 */
const NOEUDS = {
  // +1 SUR LES ONZE ROUTES (26/09/2026) : le préchargement de la police servie
  // par le site ajoute un élément dans le <head>, et la sonde compte
  // `document.querySelectorAll('*')` — donc le `<link rel="preload" as="font">`
  // compte. Les écarts emoji→SVG commentés ci-dessous sont ceux du CORPS, que
  // cette vague ne touche pas.
  // 279 → 359 : les icônes SVG du corps de l'accueil ajoutent leurs nœuds
  // (chaque icône porte un <svg> plus ses <path>/<circle>) là où un emoji en
  // tenait un seul — 21 glyphes du corps (347) puis les 4 du bloc de contact
  // (359). La structure s'accorde toujours entre les deux hôtes.
  // 360 → 355 (26/09/2026) : les DEUX compteurs inventés de l'accueil
  // (« 1 000+ travailleurs », « 500+ projets ») sont retirés (règle « pas de
  // faux compteurs »), ce qui supprime 5 nœuds (deux cartes et leur contenu).
  // 355 → 370 (27/09/2026) : les QUATRE drapeaux emoji des cartes « Disponible
  // dans 4 pays » sont DESSINÉS (src/config/flags.js) — chaque carte publie un
  // `<svg>` plus ses aplats (3 à 5 enfants) là où un `<div>` portait un emoji,
  // soit +15 nœuds en tout. La hauteur ne bouge pas d'un pixel (7 187 / 4 868 px
  // à l'époque, les mêmes classes `w-14 h-10 md:w-20 md:h-14` dimensionnent les
  // deux), et l'amputation ne les emporte pas non plus : les quinze ajoutés
  // vivent tous dans des sections que l'amputation retire.
  // +1 SUR LES DOUZE ROUTES (27/09/2026) : le PRÉCHARGEMENT DE LA POLICE DE
  // TITRAGE ajoute un second `<link rel="preload" as="font">` dans le <head>,
  // et la sonde compte `document.querySelectorAll('*')`. Mesuré dans les DEUX
  // SENS sur / (sonde `e2e/_sonde-police-lcp.spec.js`, document livré contre le
  // même document dont on a retiré le préchargement et la famille) : 370 → 371.
  // Le reste du relevé est une re-mesure de la table entière sur cet artefact.
  // 371 → 428 (27/09/2026) : refonte éditoriale de l'accueil, mesurée sur la
  // sonde d'atelier `e2e/_sonde-sections-differees.spec.js`, deux canaux —
  // coquille pré-rendue 428 nœuds, React 489 (l'écart est celui d'aujourd'hui,
  // mesuré ici et non déduit : React publie ses composants là où la coquille
  // écrit le HTML). Ce budget-ci porte la COQUILLE, et la valeur publiée est la
  // sienne. La hauteur, elle, ne les sépare pas (6 706 px des deux côtés).
  // 428 → 443 (27/09/2026) : la GALERIE des métiers (trois cartes, chacune un
  // lien, une image et une légende) et la photo du parcours ajoutent 15 nœuds à
  // la coquille, et 504 à React (contre 489) — le même écart de méthode, remesuré
  // sur le même passage que la hauteur.
  '/': 443,
  // +3 à +4 nœuds par icône dessinée là où un emoji en tenait un : les trois
  // cartes d'À propos (112 → 123), les quatre lignes de contact (120 → 132),
  // les trois étapes plus le séquestre de « Comment ça marche » (157 → 169) et
  // les six pastilles de /support (135 → 154).
  '/about': 126,
  // 135 → 147 (28/09/2026) : les quatre lignes de contact quittent le cadre
  // arrondi pour la LIGNE À FILET de l'accueil, qui porte en plus la FLÈCHE de
  // sa dernière colonne. Chaque flèche est un `<svg>` et ses deux tracés, donc
  // +3 nœuds par ligne, +12 pour les quatre — le compte est vérifié par la
  // mesure, pas déduit.
  '/contact': 147,
  // +3 nœuds chacun pour l'enveloppe de la réinitialisation (108 → 111) et pour
  // la mallette de /payment (98 → 101) : un `<svg>` plus ses tracés là où un
  // emoji tenait un seul nœud. /login +5 (114 → 119) et /register +30 (203 → 233,
  // ses huit glyphes). La structure s'accorde toujours entre les deux hôtes.
  '/forgot-password': 114,
  // 172 → 207 (28/09/2026) : le vocabulaire éditorial porté sur /how-it-works
  // (les trois étapes en lignes numérotées, le panneau de séquestre avec son
  // illustration, son estampille et ses quatre garanties, la FAQ en lignes). Le
  // solde est +35 nœuds : les trois flèches des lignes d'étape, les quatre
  // pastilles de garantie, l'illustration du panneau et son orbe s'ajoutent ;
  // les trois cartes à ombre de l'ancienne grille retirent les leurs. Mesuré
  // sur la coquille pré-rendue, pas déduit.
  '/how-it-works': 207,
  '/jobs': 106,
  '/login': 122,
  '/payment': 104,
  // 109 : INCHANGÉ par la refonte du 28/09/2026. La section de /privacy (comme
  // celle de /terms) garde son `<section>`, un `<h2>` et un `<p>` ; seul le
  // DESSIN change (titre serif, filet qui ouvre l'entrée) — et un filet ne se
  // compte pas en nœuds.
  '/privacy': 109,
  '/register': 236,
  // 157 → 166 (28/09/2026) : les quatre lignes de contact prennent la ligne à
  // filet. Les trois lignes qui mènent quelque part gagnent la flèche (un
  // `<svg>` + ses deux tracés = 3 nœuds chacune) ; la quatrième — l'adresse
  // postale, sans destination — n'en a pas, et c'est pour ça que le compte est
  // +9 et non +12.
  '/support': 166,
  // Même squelette que /privacy (une enveloppe racine, un cadre, un titre, une
  // intro, quatre sections et le paragraphe de liens) : 108 nœuds mesurés par
  // la sonde le 26/09/2026.
  '/terms': 109,
};

/**
 * LA HAUTEUR du document pré-rendu, par route et par condition (px). C'est le
 * relevé du poste.
 *
 * RE-MESURÉE EN ENTIER LE 26/09/2026, quand la police du site est devenue une
 * police SERVIE (src/index.css, /fonts/) : la hauteur d'un document de texte suit
 * la police, donc upgrader la police change ces onze lignes d'un coup. L'écart
 * avec les valeurs d'avant va de 0 px (/contact, /jobs, /forgot-password) à
 * +107 px (accueil mobile, dont les neuf sections différées sont repliées sur
 * leurs constantes de repli) : c'est bien l'artefact qui a changé, pas l'hôte.
 * C'est aussi la raison pour laquelle ces deux-là — l'hôte et la police — se
 * mesuraient autrefois ENSEMBLE : c'est ce que l'auto-hébergement sépare.
 */
const HAUTEUR = {
  // 7 079 → 7 187 px en mobile (4 782 → 4 868 en desktop) : le repli par section
  // des neuf sections différées a été re-mesuré AVEC la police servie
  // (src/App.css), donc le document différé mesure ce qu'il mesure avec la règle.
  // Desktop 4 808 → 4 868 (26/09/2026) : le titre du héros a été rendu concret
  // ("Trouvez un travailleur de confiance, payez en toute sécurité"), qui se
  // replie d'une ligne de plus en desktop ; le mobile ne bouge pas (7 187).
  // 7 187 → 7 183 en mobile et 4 868 → 4 826 en desktop (28/09/2026) : refonte
  // éditoriale de l'accueil. La baisse vient des `contain-intrinsic-size` de
  // src/App.css, re-mesurés le même jour — les constantes d'avant étaient plus
  // HAUTES que les sections qu'elles réservaient (§8 : 216 px pour 130), donc le
  // document replié était plus haut que le document posé. Les deux valeurs
  // ci-dessous sont celles du document avec le levier ACTIF, qui égale désormais
  // celui du levier neutralisé — c'est la preuve que les constantes sont justes.
  // 7 183 → 7 046 px en mobile (27/09/2026) : la référence mobile était PÉRIMÉE
  // de 137 px, et ce n'est PAS la police de titrage qui l'a fait — mesuré dans
  // les deux sens sur le même artefact (document livré contre le même document
  // sans la famille de titrage) : 7 046 px des DEUX côtés. La correction est un
  // effet de bord de la re-mesure, pas la conséquence du changement.
  // Le DESKTOP, lui, ne bouge pas d'un pixel entre avant et après, et c'est une
  // compensation mesurée qui mérite d'être notée : la famille de titrage est
  // plus ÉTROITE (le titre du héros se replie sur DEUX lignes au lieu de trois,
  // −57 px), ce qui annule exactement la détente du `letter-spacing` de la même
  // passe. Mesuré sur les trois états : référence publiée d'avant (Inter,
  // `letter-spacing` serré, 2 lignes) 4 826 px ; la même en Inter avec le
  // `letter-spacing` détendu (3 lignes) 4 883 px ; avec la police de titrage
  // 4 826 px — la valeur publiée.
  // 7 046 → 6 706 px en mobile et 4 826 → 4 840 en desktop (27/09/2026) : re-mesure
  // de la refonte éditoriale, faite avec les constantes de section DÉJÀ
  // re-accordées (src/App.css) et sur les deux canaux — la coquille et React
  // rendent le même document, au pixel, aux deux tailles. Le mobile baisse de
  // 340 px parce que la page y fait quatre sections de moins en cartes et deux
  // de plus en lignes (les dix métiers tiennent sur une colonne en lignes
  // serrées) ; le desktop ne bouge que de 14 px, la liste en deux colonnes et
  // l'illustration encadrée se compensant presque exactement.
  // 6 706 → 7 726 px en mobile et 4 840 → 5 407 en desktop (27/09/2026) : la
  // GALERIE des trois métiers en photo (+813 px en mobile, +716 en desktop) et la
  // PHOTO DU PARCOURS sous l'entête des étapes (+205 px en mobile, −148 en
  // desktop, où les deux colonnes raccourcissent la section plus que la photo ne
  // l'allonge). Ces deux valeurs sont celles du LIVRÉ, levier actif, et elles
  // ÉGALENT le document rendu au pixel dans les deux canaux (7726 / 5407) : c'est
  // la vérification que les dix constantes de src/App.css sont justes — avant
  // re-accord, le levier actif réservait 6 802 et 5 035 px, soit 924 et 372 px de
  // matière manquante, mesurés sur le même passage.
  '/': { mobile: 7726, desktop: 5407 },
  // 1 667 → 1 718 px en mobile (les trois cartes d'À propos se replient d'une
  // ligne de plus avec Inter) ; desktop inchangé.
  // 1 718 → 1 721 px en mobile (28/09/2026) : la page prend le vocabulaire
  // éditorial (carte à filet, titre serif, encart à filet gauche à la place du
  // bloc vert). Les NŒUDS ne bougent pas d'un : la pastille ronde remplace le
  // `<div>` qui portait le glyphe. Le desktop ne bouge pas non plus, les trois
  // cartes y tenant sur une rangée dans les deux dessins.
  '/about': { mobile: 1721, desktop: 1086 },
  // 1 385 → 1 370 px en mobile et 1 086 → 1 139 en desktop (28/09/2026) : les
  // quatre moyens de contact passent de la grille (`grid-cols-1 sm:grid-cols-2`)
  // à la liste JOINTIVE. En mobile la grille empilait déjà les quatre lignes,
  // mais avec trois gouttières de 12 px que la liste n'a plus : −15 px. En
  // desktop la grille tenait sur DEUX rangées (l'ancienne page tenait dans la
  // fenêtre, sa hauteur était celle de la fenêtre : 940 px, d'où les 1 086 px
  // du relevé) ; quatre lignes de 72 px la font dépasser la fenêtre, et la page
  // suit son contenu : +53 px.
  '/contact': { mobile: 1370, desktop: 1139 },
  '/forgot-password': { mobile: 926, desktop: 940 },
  // 2 982 → 3 002 px en mobile : une ligne de plus dans une étape ; desktop
  // inchangé (la largeur y évite le repli).
  // 3 002 → 2 957 px en mobile et 2 124 → 2 398 px en desktop (28/09/2026) :
  // port du vocabulaire éditorial de l'accueil sur la page. Les trois étapes
  // quittent une GRILLE DE TROIS CARTES pour une LISTE DE TROIS LIGNES :
  // c'est ce qui explique les deux signes opposés, et c'est mesuré, pas
  // supposé. En desktop les trois cartes tenaient sur UNE rangée (≈ 260 px) là
  // où trois lignes de 104 px en font 312, et le panneau de séquestre à deux
  // moitiés est plus haut que l'ancien bloc vert à ligne unique : +274 px. En
  // mobile la grille empilait DÉJÀ les trois cartes, et le panneau en deux
  // moitiés y est plus compact que le bloc vert qu'il remplace : −45 px.
  '/how-it-works': { mobile: 2957, desktop: 2398 },
  // 823 → 1 125 px en mobile (940 → 1 086 en desktop), 27/09/2026 : la coquille
  // /jobs réserve désormais la viewport (`min-h-screen` sur son cadre, voir
  // src/config/page-sections.js). Son pied de page tombait sinon EXACTEMENT au
  // bas de l'écran (mesuré 1350×940 : y=859, h=81 → 0,0862, la valeur d'un CLS
  // où il quitte l'écran) quand React, qui peint la liste, le place hors écran.
  '/jobs': { mobile: 1125, desktop: 1086 },
  // 965 → 981 px en mobile : la ligne légale de contact se replie une fois de
  // plus ; desktop inchangé.
  // 981 → 978 px (28/09/2026) : le titre de page passe au dessin serif du site
  // (`titre-page`, src/index.css). À 30 px le serif a une interligne de 1,04 là
  // où l'ancien sans en avait 1,2 : le titre est 4,8 px plus court en mobile,
  // d'où les 3 px du document. Le desktop ne bouge pas — cette page est centrée
  // dans la fenêtre, donc sa hauteur est celle de la fenêtre, pas celle du
  // contenu (elle rejoint la valeur de /forgot-password, 940 px).
  '/login': { mobile: 978, desktop: 940 },
  // 893 → 918 px en mobile : le registre de la mallette grandit d'une ligne.
  // 918 → 914 px (28/09/2026) : même cause que /login (titre de page au dessin
  // serif, 4,8 px de moins en mobile) ; desktop inchangé, pour la même raison.
  '/payment': { mobile: 914, desktop: 940 },
  // 1 627 → 1 702 px en mobile et 1 104 → 1 181 px en desktop : +1 ligne dans les
  // deux cas (le corps de section est le plus long texte du site).
  // 1 702 → 1 720 px en mobile et 1 181 → 1 212 en desktop (28/09/2026) :
  // chaque section devient une ENTRÉE à filet (20 px de respiration en haut,
  // 20 en bas, moins les 32 px de marge qu'elle portait) et le titre d'entrée
  // est 4 px plus court que l'en-tête qu'il remplace. Les quatre sections
  // s'additionnent, mesurées, pas déduites.
  '/privacy': { mobile: 1720, desktop: 1212 },
  // 2 947 → 2 997 px en mobile, 2 517 → 2 534 en desktop.
  '/register': { mobile: 2997, desktop: 2534 },
  // 1 652 px en mobile (inchangé) et 990 → 1 014 px en desktop.
  // 1 652 → 1 649 px en mobile et 1 014 → 1 023 px en desktop (28/09/2026) : le
  // titre de page passe au dessin serif du site. Ici les DEUX tailles suivent le
  // contenu (la page n'est pas centrée dans la fenêtre) : le serif est 4,8 px
  // plus court à 30 px en mobile et 9,8 px plus haut à 44 px en desktop.
  // 1 649 → 1 630 px en mobile et 1 023 → 1 172 en desktop (28/09/2026) : même
  // cause qu'à /contact pour les quatre lignes de contact, et même asymétrie —
  // en mobile la liste jointive est plus COURTE que la grille empilée (−19 px,
  // moins les 4 px gagnés par les deux titres de carte), en desktop ses quatre
  // lignes remplacent deux rangées de la grille (+149 px, titres compris).
  '/support': { mobile: 1630, desktop: 1172 },
  // Page CGU : 1 563 px en mobile et 1 086 px en desktop, mesurés par la sonde
  // le 26/09/2026.
  // 1 563 → 1 577 px en mobile et 1 086 → 1 109 en desktop (28/09/2026) : même
  // passage des quatre sections en entrées à filet qu'à /privacy. Les deux
  // valeurs diffèrent des siennes parce que les textes ne se replient pas sur le
  // même nombre de lignes.
  '/terms': { mobile: 1577, desktop: 1109 },
};

/**
 * La marge de la borne, en fraction de la structure de référence : 20 points,
 * soit 22 fois l'écart mesuré entre les deux hôtes (0,9 % au plus, et 0 sur les
 * nœuds). Elle n'est pas plus serrée parce qu'un hôte n'embarque pas forcément
 * les mêmes polices : une hauteur qui suit le retour à la ligne ne doit pas
 * devenir un test de police.
 *
 * Ce qui la franchit est MESURÉ, et rejoué : l'accueil amputé de ses DIX
 * dernières sections descend de 443 à 123 nœuds (0,28 du relevé) et de 7 726 à
 * 1 236 px en mobile, de 5 407 à 1 086 px en desktop (0,16 et 0,20) — deux fois
 * et demie sous la borne. Le PREMIER rejeu (25/09/2026, artefact d'avant les
 * icônes SVG) donnait 279 → 105 nœuds avec les MÊMES hauteurs : la hauteur suit
 * les sections retirées, pas le nombre de nœuds qui les composent. Le rejeu
 * VIVANT est `e2e/style-layout-preuve-echec.spec.js` — il ampute le corps publié
 * au vol (la navigation est interceptée, `build/index.html` n'est jamais
 * réécrit), exige le rouge des deux cases sur les DEUX axes, et publie ses
 * chiffres dans le journal du job `e2e-playwright`.
 *
 * ── Ce que la sonde NE sait PAS attraper, et c'est une mesure ───────────────
 * Casser une TAILLE ne fait PAS mordre la sonde. Remplacer chaque
 * `contain-intrinsic-size: auto Npx` (les DIX sections différées de l'accueil)
 * par `auto 4px` NE CHANGE PLUS LA HAUTEUR au point de mesure du protocole :
 * re-mesuré le 27/09/2026, le document reste à 7 726 px en mobile et 5 407 px en
 * desktop, Δ 0 px et Δ nœuds 0, très loin des planchers de hauteur (6 180 / 4 325).
 * Le relevé publié auparavant (−121 px mobile, −1 px desktop) n'était pas une
 * propriété du document mais un INSTANT de sa convergence : les sections se sont
 * RENDUES avant le relevé — la sonde lit leurs hauteurs vraies (937 px pour le
 * rang 3, contre une constante de 841,14) — et le mot-clé `auto` MÉMORISE la
 * taille rendue. Les constantes ne gouvernent donc que la PREMIÈRE mise en page :
 * la même mutation, échantillonnée au premier commit en desktop, donne
 * 5 407 → 1 819 px. La conséquence est assumée : la sonde n'a qu'une BORNE BASSE,
 * elle attrape la PERTE DE MATIÈRE (nœuds/px), jamais une taille cassée vers le
 * bas. C'est écrit ici pour que personne ne croie le contraire ; le rejeu
 * correspondant est le second cas de `e2e/style-layout-preuve-echec.spec.js`.
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
