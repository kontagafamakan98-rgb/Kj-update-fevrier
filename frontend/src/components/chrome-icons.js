// LES ICÔNES DU CHROME — un seul propriétaire, un seul jeu d'attributs.
//
// ── Ce que ce module remplace, et pourquoi ──────────────────────────────────
// Les icônes de l'habillage (barre du haut, barre du bas, cloche, centre de
// notifications, toasts, indicateur hors ligne, dépôt de photo) vivaient
// DISPERSÉES dans sept fichiers, chacune avec son balisage recopié :
// `strokeLinecap`, `strokeLinejoin` et `strokeWidth` étaient répétés SUR CHAQUE
// `<path>`, à la main. Trois conséquences, toutes observées :
//
//   1. un tracé pouvait OUBLIER ses jointures et personne ne le voyait — un
//      chemin sans `linejoin="round"` dessine des angles vifs au milieu d'un jeu
//      d'icônes arrondies ;
//   2. le même dessin existait DEUX fois, parfois avec deux tracés différents :
//      la coche du centre de notifications et celle de l'indicateur hors ligne
//      étaient identiques au caractère près, la croix de fermeture existait en
//      DEUX versions (`M6 18L18 6M6 6l12 12` et une croix plus fine) selon le
//      fichier ;
//   3. deux tracés étaient FAUX, et un troisième ne disait pas ce qu'il
//      prétendait : la valise de `/jobs` portait `a2 2 0 00-2-2` là où il faut
//      `a2 2 0 002-2` (l'anse se refermait à l'envers), le « tableau de bord »
//      portait un rectangle dont les deux derniers arcs se recroisaient (un
//      quadrilatère déformé au lieu d'un écran), et l'icône dite « tout lu »
//      était dessinée avec UNE seule coche. Mesuré à l'œil sur le rendu de
//      chaque taille : les deux premiers se voyaient à 24 px.
//
// Ici, les attributs du trait sont écrits UNE fois, sur le `<svg>` : un tracé ne
// peut plus oublier ses jointures, puisqu'il n'a plus à les déclarer.
//
// ── La discipline de dessin ────────────────────────────────────────────────
// Même grille que `src/config/page-icons.js` (24 × 24, tracé au trait, `fill="none"`,
// `stroke="currentColor"`, bouts et jointures arrondis) — parce que les deux
// familles se croisent à l'écran : la coche d'un toast et le bouclier d'une page
// doivent avoir la même épaisseur apparente. Les tracés viennent de lucide, comme
// ceux du corps des pages, ce qui donne aux DEUX familles une géométrie dessinée
// par la même main — l'ancien mélange heroicons/lucide faisait cohabiter deux
// largeurs de trait optiques (2/24 chez l'un, 1,5/24 chez l'autre) dans la même
// barre de navigation.
//
// POURQUOI CE N'EST PAS UNE ENTRÉE DE `page-icons.js` : ce registre-ci est importé
// par le CHROME, donc par le chunk d'entrée. `flags.js` a déjà mesuré le prix de
// ce voisinage (une première tentative avait monté `index` de 153,15 à 160,20 ko
// en important le registre des pages depuis `FlagIcon`) : une icône de barre de
// navigation n'a pas à traîner les vingt-neuf tracés du corps des pages. Les deux
// fichiers restent donc séparés, et la frontière est explicite.
//
// ── L'épaisseur suit la TAILLE ─────────────────────────────────────────────
// Un trait de 2 unités sur une grille de 24 est juste à 24 px ; agrandi à 40 ou
// 48 px, il épaissit avec le dessin et paraît lourd. `epaisseur` permet donc aux
// seuls emplacements GRANDS de descendre à 1,75 — la valeur que lucide
// recommande au-delà de 32 px — sans toucher aux centaines d'emplacements de
// 16 à 24 px, dont l'épaisseur est celle du reste du site.
import { createElement } from 'react';

/**
 * Le registre : un NOM STABLE vers les tracés de son icône. Le contenu est une
 * chaîne (plusieurs `<path>`/`<circle>` possibles), écrite en SVG et injectée
 * telle quelle.
 */
export const ICONES = {
  // ── Navigation ────────────────────────────────────────────────────────────
  // La barre du haut (mobile) et le tiroir qu'elle ouvre.
  menu: 'M4 6h16M4 12h16M4 18h16',
  fermer: 'M6 18L18 6M6 6l12 12',
  // La barre du bas d'un visiteur non connecté : l'accueil, les emplois, le
  // contact (casque), l'entrée dans le compte.
  accueil:
    '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>' +
    '<path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  // La valise : MÊME dessin que la promesse « Trouvez un travail » de l'accueil
  // (`page-icons.js`, `promiseFindWork`). Les deux registres restent séparés (cf.
  // l'en-tête) mais le dessin est le même — un plan de page et une barre de
  // navigation ne peuvent pas représenter le même métier de deux façons.
  valise:
    '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>' +
    '<rect width="20" height="14" x="2" y="6" rx="2"/>',
  casque:
    '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  // La barre du bas d'un compte connecté.
  tableau:
    '<rect width="7" height="9" x="3" y="3" rx="1"/>' +
    '<rect width="7" height="5" x="14" y="3" rx="1"/>' +
    '<rect width="7" height="9" x="14" y="12" rx="1"/>' +
    '<rect width="7" height="5" x="3" y="16" rx="1"/>',
  messages:
    '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>' +
    '<path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
  profil:
    '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  entree:
    '<path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>' +
    '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
  enveloppe:
    '<rect width="20" height="16" x="2" y="4" rx="2"/>' +
    '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/>',
  // ── Retours et état ───────────────────────────────────────────────────────
  coche: 'M5 13l4 4L19 7',
  // « Tout lu » : DEUX coches, comme le nom le dit. L'ancien tracé n'en portait
  // qu'une, donc l'icône promettait une action qu'elle ne dessinait pas.
  cocheDouble: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  croix: 'M18.364 5.636l-12.728 12.728m0-12.728l12.728 12.728',
  corbeille:
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>' +
    '<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>' +
    '<path d="M10 11v6"/><path d="M14 11v6"/>',
  cloche:
    '<path d="M10.268 21a2 2 0 0 0 3.464 0"/>' +
    '<path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  // ── Les quatre retours d'un toast, plus le dépôt de photo ─────────────────
  succes: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  erreur:
    '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  avertissement:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>' +
    '<path d="M12 9v4"/><path d="M12 17h.01"/>',
  information:
    '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  photo:
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>' +
    '<circle cx="12" cy="13" r="3"/>',
};

/**
 * Les attributs COMMUNS du `<svg>`, écrits une seule fois. `aria-hidden` et
 * `focusable="false"` sont systématiques : ce sont des DESSINS qui accompagnent
 * un libellé, jamais une commande — un lecteur d'écran annonce le bouton, pas la
 * forme qu'il porte, et `focusable="false"` évite qu'un SVG devienne une étape de
 * tabulation dans les navigateurs qui l'autorisent.
 */
export const ATTRIBUTS_SVG = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

/** L'épaisseur par défaut ; les emplacements GRANDS passent 1.75. */
export const EPAISSEUR = 2;

/**
 * Le composant. `classe` porte la taille ET la couleur (l'icône suit
 * `currentColor`, donc la teinte vient de la classe du parent ou d'elle-même).
 *
 * Un nom inconnu lève : une icône qui n'existe pas se voit tout de suite, elle ne
 * disparaît jamais en silence derrière un `<svg>` vide.
 */
export function Icone({ nom, classe = 'w-6 h-6', epaisseur = EPAISSEUR }) {
  const contenu = ICONES[nom];
  if (!contenu) {
    throw new Error(
      `chrome-icons : l’icône « ${nom} » n’est pas déclarée dans le registre — ` +
        'le chrome ne peut pas dessiner une icône qui n’existe pas.'
    );
  }
  return createElement('svg', {
    ...ATTRIBUTS_SVG,
    className: classe,
    strokeWidth: epaisseur,
    'data-icone': nom,
    dangerouslySetInnerHTML: { __html: contenu },
  });
}

/** Les noms connus — lu par les tests et par toute sonde qui voudrait compter. */
export const NOMS_D_ICONES = Object.keys(ICONES);
