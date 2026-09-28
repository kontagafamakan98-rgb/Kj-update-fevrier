// ── LA MARQUE DE KOJO, dessinée UNE fois ───────────────────────────────────
//
// ── D'où elle vient ───────────────────────────────────────────────────────
// La marque est le profil envoyé par le propriétaire du site le 28/09/2026
// (`profile_… .jpg`, 512 × 512) : un disque en dégradé orange→rouge, cerclé de
// blanc, portant un « K » blanc gras, une tache de lumière en haut à gauche et
// deux étincelles. Elle remplace le « K » typographique qui servait jusque-là.
//
// ── Pourquoi ce module existe ─────────────────────────────────────────────
// Ce « K » était un CARACTÈRE dans un carré : un `<span>` portant la clé i18n
// `brandMark` (la lettre « K » du dictionnaire), posé dans un `<div>` orange
// recopié à chaque emplacement. Le même carré était donc dessiné à six endroits,
// de TROIS façons différentes :
//
//   • quatre fois dans l'application (la barre, /login, /register, l'écran de
//     chargement), avec TROIS couples taille/rayon différents (36 px rayon 12,
//     48 px rayon 8, 64 px rayon 8, 80 px en rond blanc) ;
//   • deux fois dans les coquilles pré-rendues (vite-plugins/prerender/
//     shells-routes.js), qui recopiaient le même `<div>` + `<span>` ;
//   • en raster, neuf fois, par public/icons/generate_icons.py — un rasteriseur
//     écrit à la main qui redessine le K de son côté (stdlib pure, sans PIL).
//
// Un caractère n'est pas une marque : ses angles dépendent de la police qui le
// compose, il ne peut pas hériter de la couleur de son emplacement, et il ne
// survit pas au changement de taille. Un tracé, lui, est le même partout.
//
// ── Ce que « redessiner » a changé (mesuré sur l'original, 512 px) ────────
// Le disque occupe 481 px de diamètre, l'anneau blanc 27 px (11 % du rayon), le
// « K » 102 px de hauteur (21,6 % du disque) pour un fût d'environ 27 px (26 % de
// la hauteur du K — un gras géométrique, à bouts plats). Trois corrections, et
// aucune n'est cosmétique :
//
//   • le K GRANDIT à 30 % du disque (14,2 unités sur 48). À 21,6 %, le K de la
//     barre (36 px) ne mesurait que 7,8 px de haut : illisible, alors que c'est
//     l'emplacement le plus petit du site. La proportion d'origine est tenue à
//     48 et 64 px ; elle ne l'était pas à 36 ;
//   • la tache de lumière devient un DÉGRADÉ RADIAL au lieu d'un aplat flou :
//     un raster ne se met pas à l'échelle, un dégradé si ;
//   • les deux ÉTINCELLES sont RETIRÉES. Elles valaient 1,3 unité sur 48 dans
//     l'original (soit 1 px à 36 px) : reproduites, elles se lisaient comme deux
//     poussières blanches posées sur le disque, et agrandies elles devenaient
//     un ornement — un repère de vignette, pas de marque. Le halo porte seul la
//     lumière, et la marque y gagne à toutes les tailles.
//
// ── Un propriétaire, deux canaux ─────────────────────────────────────────
// La PAGE (React) passe par `MarqueKojo`, la COQUILLE (Node) par
// `svgDeLaMarque` (vite-plugins/prerender/icons-serveur.js) :
// les deux lisent les attributs, les peintures et les emplacements ci-dessous,
// exactement comme `page-icons.js` le fait pour les icônes dessinées. Un
// emplacement inconnu lève des deux côtés — jamais une pastille vide publiée en
// silence.
//
// L'identifiant du dégradé est DÉRIVÉ de l'emplacement (`kojo-marque-barre`…) :
// deux marques peuvent cohabiter sur une page (la barre et l'en-tête de /login),
// et deux `<defs>` de même identifiant seraient un doublon dans le document.
import { createElement } from 'react';

/** La grille de dessin (48 × 48) : le double des icônes (24), pour le dégradé. */
export const GRILLE_MARQUE = '0 0 48 48';

/** Le repère du build et des sondes : la marque est vérifiable, pas décorative. */
export const MARQUEUR_DE_LA_MARQUE = 'data-marque="kojo"';

/** Le disque : plein cadre (r = 23,6 sur 24) — la marque EST la pastille. */
const DISQUE_R = 23.6;
/** L'anneau blanc : la bande mesurée sur l'original (20,9 → 23,6 du rayon). */
const ANNEAU_R = 22.25;
const ANNEAU_LARGEUR = 2.7;

/**
 * LE « K » : trois traits à bouts PLATS (le gras géométrique de l'original), la
 * hauteur de capitale à 14,2 unités, centrée sur (24, 24). Les deux bras
 * s'appuient sur le tronc au MÊME point (20, 24) — c'est ce point de rencontre
 * qui donne à la lettre son axe ; ils le dépassent vers l'intérieur du tronc
 * (20 < 21,15, le bord droit du fût) pour qu'aucune couture blanche n'apparaisse
 * au raccord.
 */
const K_TRONC = 'M19.2 16.6V31.4';
const K_BRAS_HAUT = 'M20 24 30.6 17.2';
const K_BRAS_BAS = 'M20 24 30.6 30.8';
const K_LARGEUR = 3.8;

/**
 * L'arc de lumière du bord supérieur-gauche, en coordonnées de la grille.
 *
 * Il est DESSINÉ (deux points et un arc) plutôt que posé en anneau complet : un
 * anneau éclairerait aussi le bas, où la lumière ne vient pas — et c'est
 * exactement ce que l'original évitait.
 */
const arcDeLumiere = () => {
  const rayon = 20.5;
  const point = (degres) => {
    const angle = (degres * Math.PI) / 180;
    return `${(24 + rayon * Math.cos(angle)).toFixed(2)} ${(24 + rayon * Math.sin(angle)).toFixed(2)}`;
  };
  // De 186° à 316° : du bord gauche au haut-droite, en passant par le sommet.
  return (
    `<path d="M${point(186)}A${rayon} ${rayon} 0 0 1 ${point(316)}" fill="none" ` +
    `stroke="#ffffff" stroke-opacity="0.22" stroke-width="2"></path>`
  );
};

const leK = (couleur) =>
  `<g fill="none" stroke="${couleur}" stroke-width="${K_LARGEUR}">` +
  `<path d="${K_TRONC}"></path>` +
  `<path d="${K_BRAS_HAUT}"></path>` +
  `<path d="${K_BRAS_BAS}"></path>` +
  `</g>`;

/**
 * LES PEINTURES : deux façons de peindre la MÊME géométrie. Elles sont
 * déclarées, et non recopiées par emplacement — c'est là que les six recopies
 * divergeaient.
 *
 *   * `marque` — la marque telle qu'elle a été envoyée : disque en dégradé,
 *     halo, anneau et K blancs. C'est la peinture de tous les emplacements sur
 *     fond clair.
 *   * `inverse` — le disque BLANC et le K dans la couleur de l'emplacement
 *     (`currentColor`). Elle sert sur fond coloré (l'écran de chargement, qui
 *     est un dégradé orange) : un disque rouge sur orange n'y aurait ni
 *     contraste ni lecture. Sans anneau ni halo, qui n'ont plus d'objet quand
 *     le disque est déjà la couleur la plus claire de la composition.
 */
export const PEINTURES = {
  marque: {
    defs: (id) =>
      // Le dégradé : quatre arrêts, et le PREMIER n'est pas au centre — la
      // lumière vient de la haut-gauche, comme la tache de l'original. L'arrêt
      // de fin est plus SOMBRE que le rouge du bord (#b81c20 contre #d21f27) :
      // c'est ce qui donne l'épaisseur du disque, et ce qui fait tenir le
      // liseré blanc à toutes les tailles (un rouge qui s'éclaircit vers le bord
      // mange le liseré à 16 px).
      `<radialGradient id="${id}" cx="0.28" cy="0.22" r="1.05">` +
      `<stop offset="0" stop-color="#ff8a3d"></stop>` +
      `<stop offset="0.34" stop-color="#ef5f28"></stop>` +
      `<stop offset="0.72" stop-color="#dc2f22"></stop>` +
      `<stop offset="1" stop-color="#b81c20"></stop>` +
      `</radialGradient>` +
      `<radialGradient id="${id}-halo">` +
      `<stop offset="0" stop-color="#ffffff" stop-opacity="0.32"></stop>` +
      `<stop offset="0.5" stop-color="#ffffff" stop-opacity="0.14"></stop>` +
      `<stop offset="1" stop-color="#ffffff" stop-opacity="0"></stop>` +
      `</radialGradient>`,
    corps: (id) =>
      `<circle cx="24" cy="24" r="${DISQUE_R}" fill="url(#${id})"></circle>` +
      `<ellipse cx="20.2" cy="17.3" rx="10.6" ry="10.6" fill="url(#${id}-halo)"></ellipse>` +
      // L'ARÊTE DE LUMIÈRE : un arc blanc au bord supérieur-gauche, à l'intérieur
      // du liseré. Sans lui le disque est un aplat, et le passage du dégradé au
      // liseré se fait en marche d'escalier ; avec lui, le bord reçoit la lumière
      // comme un objet bombé — c'est la seule addition de cette passe, et elle ne
      // coûte rien (un chemin, pas un filtre).
      arcDeLumiere() +
      `<circle cx="24" cy="24" r="${ANNEAU_R}" fill="none" stroke="#ffffff" stroke-width="${ANNEAU_LARGEUR}"></circle>` +
      leK('#ffffff'),
  },
  inverse: {
    defs: () => '',
    corps: () =>
      `<circle cx="24" cy="24" r="${DISQUE_R}" fill="#ffffff"></circle>` +
      leK('currentColor'),
  },
};

/**
 * LES EMPLACEMENTS : où la marque paraît, à quelle taille, dans quelle peinture.
 * Ils sont DÉCLARÉS ici, une fois. Les boîtes sont celles qui étaient en place
 * (36, 48, 64, 80 px) : cette passe change le DESSIN, pas la mise en page — la
 * bascule coquille → React ne doit déplacer aucun élément. La classe porte la
 * taille ET la couleur de texte de l'emplacement (dont `currentColor` hérite
 * dans la peinture `inverse`).
 */
export const EMPLACEMENTS_MARQUE = {
  // La barre de navigation (36 px) : le plus petit emplacement du site.
  barre: { boite: 'block h-9 w-9', peinture: 'marque', defs: true },
  // L'en-tête de /login (48 px). `mx-auto` exige un élément de BLOC : un `<svg>`
  // est en ligne par défaut, et sans `block` la marque se collerait à gauche.
  entete: { boite: 'mx-auto block h-12 w-12', peinture: 'marque', defs: true },
  // L'en-tête de /register (64 px).
  enregistrement: { boite: 'mx-auto block h-16 w-16', peinture: 'marque', defs: true },
  // L'écran de chargement (src/App.js), sur le dégradé orange du boot : la
  // pastille blanche portait une ombre (`shadow-lg`), elle la garde.
  ouverture: {
    boite: 'mx-auto mb-6 block h-20 w-20 text-orange-600 shadow-lg',
    peinture: 'inverse',
    defs: false,
  },
};

/** L'emplacement demandé, ou une erreur bruyante s'il n'est pas déclaré. */
export function emplacementDeLaMarque(nom) {
  const emplacement = EMPLACEMENTS_MARQUE[nom];
  if (!emplacement) {
    throw new Error(
      `marque-kojo : l’emplacement « ${nom} » n’est pas déclaré — un appelant ne ` +
        'peut pas dessiner la marque à une taille qui n’existe pas.'
    );
  }
  return emplacement;
}

/** L'identifiant du dégradé d'un emplacement : unique par emplacement. */
export const identifiantDeLaMarque = (nom) => `kojo-marque-${nom}`;

/**
 * L'INTÉRIEUR du `<svg>` pour un emplacement : ses `defs` et son corps. Un seul
 * producteur, lu par les deux canaux — c'est ce qui garantit que la coquille et
 * la page peignent le même dessin.
 */
export function corpsDeLaMarque(nom) {
  const { peinture, defs } = emplacementDeLaMarque(nom);
  const regle = PEINTURES[peinture];
  const id = identifiantDeLaMarque(nom);
  return {
    id,
    defs: defs ? `<defs>${regle.defs(id)}</defs>` : '',
    corps: regle.corps(id),
  };
}

/**
 * Le composant de la PAGE. Le `<svg>` porte `data-marque` (le repère que les
 * sondes et les gardes vérifient) et `aria-hidden` : la marque est décorative
 * partout où elle paraît — le nom du site est publié en texte à côté d'elle
 * (le mot « Kojo » du verrou de la barre).
 */
export function MarqueKojo({ emplacement = 'barre' }) {
  const { boite } = emplacementDeLaMarque(emplacement);
  const { defs, corps } = corpsDeLaMarque(emplacement);
  return createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: GRILLE_MARQUE,
    className: boite,
    'aria-hidden': true,
    'data-marque': 'kojo',
    dangerouslySetInnerHTML: { __html: defs + corps },
  });
}
