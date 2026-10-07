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
// ── LE DESSIN RETENU : « LE POINÇON » (28/09/2026) ────────────────────────
// La première version de ce module reproduisait le profil envoyé : le disque
// cerclé de blanc, la tache de lumière, le K. Soumise au propriétaire du site
// avec trois autres pistes, elle a été jugée décevante — comme les trois autres.
// Le dessin retenu est le quatrième, « le poinçon » : le disque PLAT, la lettre
// GRASSE, et deux détails qui disent qu'un objet a été frappé.
//
//   • LE COLLET (r 21,0) ET LE PLATEAU (r 20,2) : un filet sombre et un filet
//     clair, concentriques, à 2 unités du bord — la gorge d'une pièce frappée,
//     et la face qui se relève à l'intérieur. C'est la seule raison pour
//     laquelle la lettre a l'air POSÉE SUR la matière au lieu d'y être
//     imprimée ;
//   • LE CERCLAGE (r 22,2) ET LE GLACIS (r 22,85) : un arc de lumière large et
//     un trait net, tous deux en haut à gauche, effilés aux DEUX bouts par un
//     dégradé — la lumière vient d'une seule direction, comme sur un objet
//     bombé. Rien n'est éclairé en bas : c'est l'arc d'ombre (18° → 162°) qui
//     s'en charge.
//
// La LETTRE GRANDIT de 14,2 à 18,6 unités de capitale (30 % → 39 % de la
// grille) et son trait passe de 3,8 à 4,9. À 21,6 % puis 30 %, le K de la barre
// (36 px) mesurait 7,8 puis 10,7 px de haut ; à 39 % il en mesure 14. C'est
// l'emplacement le plus PETIT du site qui commande la proportion, pas le plus
// grand.
//
// La MATIÈRE DESCEND, et c'est une correction de lisibilité, pas de goût. Le
// dégradé de la première version partait d'un orange très clair (#ff8a3d) posé
// juste sous le coin haut-gauche de la lettre : mesuré le long du tracé de la
// lettre (un « tube » de rayon trait/2 promené sur les trois segments,
// échantillonné tous les quarts d'unité sur huit directions, contraste relatif
// WCAG), le blanc du K n'y tenait plus que 2,67:1 — l'attribut le plus visible
// de la marque était le moins lisible. Le dégradé part maintenant du BORD
// (cœur #f97c22 dans le coin,
// #ee6320 à 16 %, #dc4620 à 45 %, #bb231c à 75 %, #8a1418 au bord) : le point le
// plus défavorable de la lettre passe à 3,29:1, et sa moyenne à 4,29:1. La
// marque reste orange — le cœur chaud est simplement ramené DANS le coin, où il
// se lit comme une lumière (et il tombe sur le cerclage, là où elle tombe), au
// lieu de s'étaler sous la lettre.
//
// Le cœur n'est JAMAIS blanc (#f97c22, pas #ffd9b0) : une spéculaire blanche
// fait lire une bille, pas une pièce frappée. C'est la § IV de la philosophie
// d'atelier (HARMATTAN-LEDGER : « pas de dégradé radial qui simule un volume »)
// tenue par la mesure — la matière descend d'un cran vers le bord, la lumière
// est une LIGNE (le cerclage et le glacis), et rien ne brille.
//
// Les ÉTINCELLES du profil restent absentes : 1,3 unité sur 48 (1 px à 36 px),
// elles se lisaient comme deux poussières blanches sur le disque, et agrandies
// elles devenaient un ornement — un repère de vignette, pas de marque.
//
// ── Un dessin, TROIS consommateurs ───────────────────────────────────────
// La GÉOMÉTRIE du poinçon (rayons, arrêts de dégradé, arcs, lettre) vit dans
// `marque-kojo.json`, à côté de ce fichier, et NULLE PART ailleurs :
//
//   • la PAGE (React) passe par `MarqueKojo` ;
//   • la COQUILLE (Node) par `svgDeLaMarque`
//     (vite-plugins/prerender/icons-serveur.js) ;
//   • le RASTERISEUR des icônes PWA et du favicon
//     (public/icons/generate_icons.py) lit le MÊME fichier et peint les mêmes
//     couches — l'onglet du navigateur porte donc la marque du site, et pas un
//     second dessin qui lui ressemblerait.
//
// Les deux canaux JS lisent les attributs, les peintures et les emplacements
// ci-dessous, exactement comme `page-icons.js` le fait pour les icônes
// dessinées. Un emplacement inconnu lève des deux côtés — jamais une pastille
// vide publiée en silence — et une couche nommée absente du JSON lève aussi.
//
// L'identifiant du dégradé est DÉRIVÉ de l'emplacement (`kojo-marque-barre`…) :
// deux marques peuvent cohabiter sur une page (la barre et l'en-tête de /login),
// et deux `<defs>` de même identifiant seraient un doublon dans le document.
import { createElement } from 'react';
// L'ATTRIBUT D'IMPORT est exigé par Node (« needs an import attribute of
// type: json ») ; Vite, Rollup et Vitest le portent aussi. Le JSON est lu comme
// DONNÉES, jamais évalué : c'est ce qui permet au rasteriseur Python de lire
// exactement le même dessin.
import GEOMETRIE from './marque-kojo.json' with { type: 'json' };

/**
 * LA GÉOMÉTRIE, relue du JSON par NOM de couche. Un nom absent lève : une
 * couche renommée dans le JSON ne peut pas devenir un dessin muet (le `poinçon`
 * sans disque, par exemple), elle casse au premier import — ce qui est mesuré
 * par la page, par la coquille ET par le rasteriseur des icônes.
 */
const couche = (peinture, nom) => {
  const trouvee = GEOMETRIE.peintures[peinture].couches.find((candidat) => candidat.nom === nom);
  if (!trouvee) {
    throw new Error(
      `marque-kojo : la couche « ${nom} » de la peinture « ${peinture} » n’est pas déclarée ` +
        'dans marque-kojo.json — la marque ne peut pas être dessinée à moitié.'
    );
  }
  return trouvee;
};

/** Le nom du `<defs>` d'une peinture nommée : seul `matiere` porte l'identifiant
 * nu (c'est le remplissage du disque), les autres le suffixent par leur nom. */
const idDeGradient = (nom, id) => (nom === 'matiere' ? id : `${id}-${nom}`);

/** La grille de dessin (48 × 48) : le double des icônes (24), pour le dégradé. */
export const GRILLE_MARQUE = `0 0 ${GEOMETRIE.grille} ${GEOMETRIE.grille}`;

/** Le repère du build et des sondes : la marque est vérifiable, pas décorative. */
export const MARQUEUR_DE_LA_MARQUE = 'data-marque="kojo"';

/**
 * ── LA GÉOMÉTRIE DU POINÇON, en unités de la grille 48 ────────────────────
 * Cinq rayons, tous mesurés du centre : le disque, la gorge sombre du collet,
 * le filet clair du plateau, le cerclage de lumière et le trait de glacis.
 * L'arc d'ombre se pose à 0,2 unité du cerclage, de l'autre côté du disque.
 * À 36 px (la barre), 1 unité vaut 0,75 px : le disque en mesure 34,8,
 * le collet 31,5 et le plateau 30,3 — les trois tiennent dans l'épaisseur d'un
 * cheveu du bord, et c'est voulu : ces filets sont une MATIÈRE, pas un motif.
 */
const POINCON_R = couche('marque', 'poincon').rayon;
/** La gorge : le collet de la pièce frappée, à 2 unités du bord. */
const COLLET_R = couche('marque', 'collet').rayon;
/** Le filet clair : l'arête du plateau, à l'intérieur du collet. */
const PLATEAU_R = couche('marque', 'plateau').rayon;
/** Le cerclage : l'arc de lumière, large et doux, en haut à gauche. */
const CERCLAGE_R = couche('marque', 'cerclage').rayon;
/** Le glacis : le trait net qui finit le bord, juste dedans le disque. */
const GLACIS_R = couche('marque', 'glacis').rayon;
/**
 * L'ombre : l'arc du bas, qui dit d'où vient la lumière. Son rayon PLUS son
 * demi-trait tiennent dans le disque (22,0 + 1,15 = 23,15 ≤ 23,2) : un trait
 * n'est pas rogné par le cercle qui le porte, donc un arc posé à 22,6 aurait
 * peint 0,6 unité de rouge sombre DEHORS, sur le fond — un liseré que personne
 * n'a demandé, et le seul défaut de ce dessin qui se voie à l'œil nu.
 */
const OMBRE_R = couche('marque', 'ombre').rayon;

/** Un point de la grille, sur un cercle de rayon donné, à l'angle donné (SVG :
 * l'axe des ordonnées descend, donc 0° est à droite et 90° en BAS). */
const surLeCercle = (degres, rayon) => {
  const angle = (degres * Math.PI) / 180;
  return `${(24 + rayon * Math.cos(angle)).toFixed(2)} ${(24 + rayon * Math.sin(angle)).toFixed(2)}`;
};

/**
 * UN ARC DE LA MARQUE, dessiné par deux points et un balayage (`sweep` 1 : les
 * angles CROISSENT, donc l'arc va de la gauche vers la droite en passant par son
 * sommet). Les deux arcs de lumière et d'ombre se lisent ainsi comme deux
 * morceaux d'un même cercle, et non comme des anneaux complets qu'on aurait
 * recouverts : rien à masquer, rien à décaler.
 */
const arc = (debut, fin, rayon) =>
  `M${surLeCercle(debut, rayon)}A${rayon} ${rayon} 0 0 1 ${surLeCercle(fin, rayon)}`;

/**
 * LE « K » : trois traits à bouts PLATS (le gras géométrique), la hauteur de
 * capitale à 18,6 unités, centrée sur (24, 24). Les deux bras s'appuient sur le
 * tronc au MÊME point (18,8, 24) — c'est ce point de rencontre qui donne à la
 * lettre son axe ; il est À L'INTÉRIEUR du tronc (17,3 ± 2,45, soit 14,85 →
 * 19,75) pour qu'aucune couture ne sépare un bras du fût au raccord.
 *
 * L'encre de la lettre va de x 14,85 à 33,25 et de y 14,7 à 33,3 : son coin le
 * plus éloigné du centre est à 13,05 unités, donc à 7 unités du plateau (r 20,2)
 * au plus court. Le dessin a de la réserve — c'est la § VII de la philosophie.
 */
const K_TRONC = GEOMETRIE.lettre.tronc;
const K_BRAS_HAUT = GEOMETRIE.lettre.brasHaut;
const K_BRAS_BAS = GEOMETRIE.lettre.brasBas;
const K_LARGEUR = GEOMETRIE.lettre.largeur;

const leK = (couleur) =>
  `<g fill="none" stroke="${couleur}" stroke-width="${K_LARGEUR}">` +
  `<path d="${K_TRONC}"></path>` +
  `<path d="${K_BRAS_HAUT}"></path>` +
  `<path d="${K_BRAS_BAS}"></path>` +
  `</g>`;

/**
 * LA MATIÈRE : un dégradé RADIAL (un raster ne se met pas à l'échelle, un
 * dégradé si), dont le centre n'est PAS au milieu du disque — la lumière vient
 * du haut-gauche, et son point le plus clair tombe SUR LE CERCLAGE (cx 0,17 →
 * 8,7 unités, le cerclage passe à 8,3 dans cette direction) : sur un objet
 * verni, le reflet ne flotte pas au milieu, il touche le bord. La progression
 * des cinq arrêts est celle qui a été MESURÉE pour la lettre (voir l'en-tête et
 * même protocole que l'en-tête) : le cœur chaud tient dans le coin (16 %), puis la
 * matière descend en plateau jusqu'au bord, où elle devient un rouge laqué.
 * C'est ce bord sombre qui fait tenir la silhouette sur un fond crème à 16 px,
 * sans anneau de séparation.
 *
 * `r` à 1,02 plutôt que 1,00 : la portée du dégradé est de 47,3 unités, donc le
 * point du disque le plus éloigné du reflet est à 0,95 — il atteint le dernier
 * arrêt sans le dépasser. À 1,00 il tombait juste dessus (bord mou), à 1,12 il
 * s'arrêtait à 0,89 et le bord gardait un rouge plus clair que voulu.
 */
/**
 * UN ARRÊT de dégradé, en données : `[décalage, couleur]`, la troisième valeur
 * — l'opacité — n'étant écrite QUE lorsqu'elle est déclarée (la matière n'en
 * porte aucune, la lumière et l'ombre s'éteignent aux deux bouts).
 */
const arretDeGradient = ([decalage, couleur, opacite]) =>
  `<stop offset="${decalage}" stop-color="${couleur}"` +
  (opacite === undefined ? '' : ` stop-opacity="${opacite}"`) +
  `></stop>`;

/**
 * UNE PEINTURE NOMMÉE, en SVG : l'axe, le centre, la portée et les arrêts sont
 * ceux de `marque-kojo.json`. Le suffixe d'identifiant est celui de
 * `idDeGradient` — c'est lui qui permet à deux marques de cohabiter.
 */
const GRADIENT = (nom, id) => {
  const peinture = GEOMETRIE.gradients[nom];
  const corps = peinture.arrets.map(arretDeGradient).join('');
  if (peinture.sorte === 'radial') {
    return (
      `<radialGradient id="${idDeGradient(nom, id)}" cx="${peinture.centre[0]}" cy="${peinture.centre[1]}" ` +
      `r="${peinture.portee}">${corps}</radialGradient>`
    );
  }
  const [x1, y1, x2, y2] = peinture.axe;
  return (
    `<linearGradient id="${idDeGradient(nom, id)}" gradientUnits="userSpaceOnUse" ` +
    `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${corps}</linearGradient>`
  );
};

/** La MATIÈRE du disque — le dégradé radial décrit juste au-dessus. */
const MATIERE = (id) => GRADIENT('matiere', id);

/**
 * LA LUMIÈRE : un dégradé LINÉAIRE en coordonnées de la grille, posé sur le
 * TRAIT des deux arcs du haut (le cerclage et le glacis). Il s'éteint aux deux
 * bouts, donc l'arc n'a pas d'extrémité — le défaut le plus visible d'un arc au
 * trait blanc : un bout net, au milieu du disque, qui ne ressemble à rien.
 * L'axe va du bord gauche-bas vers le haut-droite, c'est-à-dire qu'il suit le
 * sens de la lumière.
 *
 * Son maximum est 0,72 et non 1 : à pleine opacité, l'arc du cerclage ne se lit
 * plus comme une arête mais comme un reflet de plastique. C'est le glacis —
 * 0,55 unité, le trait le plus fin du dessin — qui porte l'éclat, et il suffit.
 */
const LUMIERE = (id) => GRADIENT('lumiere', id);

/**
 * L'OMBRE : le même dispositif en bas, dans l'autre sens et plus sourd. Elle
 * tient le disque au sol — sans elle, la marque a l'air découpée et posée sur
 * la page plutôt qu'appuyée sur elle (c'est la § I de la philosophie).
 */
const OMBRE = (id) => GRADIENT('ombre', id);

/**
 * LES PEINTURES : deux façons de peindre la MÊME géométrie. Elles sont
 * déclarées, et non recopiées par emplacement — c'est là que les six recopies
 * divergeaient.
 *
 *   * `marque` — le poinçon tel qu'il a été retenu : la matière du disque, les
 *     deux arcs (ombre en bas, lumière en haut), le collet et le plateau, la
 *     lettre blanche. C'est la peinture de tous les emplacements sur fond clair.
 *   * `inverse` — le MÊME dessin retourné : disque blanc, lettre et collet dans
 *     la couleur de l'emplacement (`currentColor`). Elle sert sur fond coloré
 *     (l'écran de chargement, qui est un dégradé orange) : un disque rouge sur
 *     orange n'y aurait ni contraste ni lecture. Les deux arcs n'y ont plus
 *     d'objet — il n'y a rien à modeler sur un aplat blanc — mais le COLLET y
 *     reste : c'est lui qui dit que la lettre est frappée, et c'est le seul
 *     détail du dessin qui survive à l'inversion.
 */
/**
 * LES PEINTURES NOMMÉES : le vocabulaire que le JSON emploie (la « peinture »
 * d'un disque, d'un arc, d'un `<defs>`). Un nom absent d'ici LÈVE — un dégradé
 * renommé dans le JSON ne peut pas devenir un aplat noir silencieux, ni sur la
 * page, ni dans la coquille, ni dans le favicon.
 */
const PEINTURES_NOMMEES = { matiere: MATIERE, lumiere: LUMIERE, ombre: OMBRE };

/**
 * UNE COUCHE, en SVG. C'est ICI que la peinture devient un dessin : la SORTE de
 * couche dit comment la peindre (un disque, un arc au trait, un cercle au trait,
 * la lettre), et l'ORDRE des couches du JSON est celui du dessin — c'est lui qui
 * garantit qu'aucun arc ne mord sur l'autre, et que le filet clair du plateau
 * tombe DEDANS le collet.
 */
const COUCHE_SVG = (coucheDessinee, id) => {
  switch (coucheDessinee.sorte) {
    case 'disque':
      return (
        `<circle cx="24" cy="24" r="${coucheDessinee.rayon}" fill="` +
        (coucheDessinee.peinture
          ? `url(#${idDeGradient(coucheDessinee.peinture, id)})`
          : coucheDessinee.couleur) +
        `"></circle>`
      );
    case 'arc':
      return (
        `<path d="${arc(coucheDessinee.de, coucheDessinee.a, coucheDessinee.rayon)}" fill="none" ` +
        `stroke="url(#${idDeGradient(coucheDessinee.peinture, id)})" stroke-width="${coucheDessinee.largeur}"` +
        (coucheDessinee.opacite === undefined ? '' : ` stroke-opacity="${coucheDessinee.opacite}"`) +
        `></path>`
      );
    case 'cercle':
      return (
        `<circle cx="24" cy="24" r="${coucheDessinee.rayon}" fill="none" ` +
        `stroke="${coucheDessinee.couleur}" stroke-opacity="${coucheDessinee.opacite}" ` +
        `stroke-width="${coucheDessinee.largeur}"></circle>`
      );
    case 'lettre':
      return leK(coucheDessinee.couleur);
    default:
      throw new Error(
        `marque-kojo : la couche « ${coucheDessinee.nom} » a une sorte inconnue ` +
          `(« ${coucheDessinee.sorte} ») — le JSON et ce module ont divergé.`
      );
  }
};

/**
 * LES PEINTURES : deux façons de peindre la MÊME géométrie. Elles sont
 * DÉCLARÉES dans le JSON (leurs `<defs>` et leurs couches, dans l'ordre), et
 * non recopiées par emplacement — c'est là que les six recopies divergeaient.
 *
 *   * `marque` — le poinçon tel qu'il a été retenu : la matière du disque, les
 *     deux arcs (ombre en bas, lumière en haut), le collet et le plateau, la
 *     lettre blanche. C'est la peinture de tous les emplacements sur fond clair,
 *     ET celle que le rasteriseur des icônes PWA peint pour le favicon.
 *   * `inverse` — le MÊME dessin retourné : disque blanc, lettre et collet dans
 *     la couleur de l'emplacement (`currentColor`). Elle sert sur fond coloré
 *     (l'écran de chargement, qui est un dégradé orange) : un disque rouge sur
 *     orange n'y aurait ni contraste ni lecture. Les deux arcs n'y ont plus
 *     d'objet — il n'y a rien à modeler sur un aplat blanc — mais le COLLET y
 *     reste : c'est lui qui dit que la lettre est frappée, et c'est le seul
 *     détail du dessin qui survive à l'inversion.
 */
export const PEINTURES = Object.fromEntries(
  Object.entries(GEOMETRIE.peintures).map(([nom, peinture]) => [
    nom,
    {
      defs: (id) =>
        peinture.defs
          .map((nom) => {
            const emetteur = PEINTURES_NOMMEES[nom];
            if (!emetteur) {
              throw new Error(
                `marque-kojo : le dégradé « ${nom} » n’est pas déclaré — le JSON et ce ` +
                  'module ont divergé.'
              );
            }
            return emetteur(id);
          })
          .join(''),
      corps: (id) => peinture.couches.map((coucheDessinee) => COUCHE_SVG(coucheDessinee, id)).join(''),
    },
  ])
);

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
 * sondes et les gardes vérifient) et `aria-hidden` : la marque est DÉCORATIVE
 * partout où elle paraît, y compris dans la barre, où le mot « Kojo » qui
 * l'accompagnait a été retiré le 28/09/2026 (il redisait ce que le dessin
 * disait). Ce qui reste doit donc être porté par le LIEN qui l'enveloppe :
 * son nom accessible est écrit une fois, dans `Navbar.js`, et nulle part
 * ailleurs — un `aria-label` ici, sur un `<svg>` caché aux lecteurs d'écran,
 * ne nommerait rien du tout.
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
