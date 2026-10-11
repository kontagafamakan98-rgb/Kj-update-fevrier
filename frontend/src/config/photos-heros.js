// ── LES PHOTOS DU HÉROS DE L'ACCUEIL, ET LEUR ORDRE ─────────────────────────
//
// Ce fichier existe pour qu'il n'y ait QU'UN propriétaire de ces faits, et il
// est lu par les DEUX canaux :
//
//   • src/components/PhotoDuHeros.js (React) — publie la photo courante et fait
//     tourner la liste ;
//   • vite-plugins/prerender/shells-home.js (le HTML pré-rendu) — publie la
//     PREMIÈRE photo, celle du premier paint, avec les MÊMES attributs.
//
// Sans ce domicile unique, la coquille et React auraient chacun leur chemin :
// changer la photo de tête dans la page aurait laissé la coquille peindre
// l'ancienne, et la bascule coquille → React aurait alors remplacé une boîte
// par une autre — exactement ce que le LCP de « / » ne pardonne pas (une
// peinture PLUS GRANDE ré-élit un élément LCP et fait entrer tout le JavaScript
// dans le graphe simulé de Lantern ; voir le commentaire de la géométrie du
// héros dans src/config/page-sections.js).
//
// ── POURQUOI CES PHOTOS, ET POURQUOI 15 SECONDES ────────────────────────────
// Le propriétaire du site a refusé le DESSIN qui occupait cette place (« ça a
// l'air trop générique », « c'est moche »), puis a demandé des PHOTOGRAPHIES
// réelles : « une image réelle qui va avec Kojo », « au moins 5 pour la
// rotation », « pas de personne blanche de peau », et une alternance « toutes
// les 15 secondes ». La liste ci-dessous est la réponse, dans cet ordre :
//
//   /assets/kojo-hero.jpg    Pexels 8487367 — une professionnelle debout, gilet
//                            orange et casque jaune, un marteau à la main : LE
//                            premier paint (c'est elle que la coquille publie)
//   /assets/kojo-hero-2.jpg  Pexels 8487764 — le sourire sous le casque
//   /assets/kojo-hero-3.jpg  Pexels 20814721 — un ouvrier, casque et outils
//   /assets/kojo-hero-4.jpg  Pexels 6790757 — un menuisier qui perce une planche
//   /assets/kojo-hero-5.jpg  Pexels 20853658 — une couturière au travail
//   /assets/kojo-hero-6.jpg  Pexels 8487345 — une professionnelle en EPI
//
// Chaque photo est un VRAI métier en situation — et c'est le sujet de la page :
// une place de marché ne se raconte pas avec un dessin, elle se raconte avec des
// travailleurs. Le délai (15 s) est déclaré ici parce que c'est une donnée du
// produit, pas un détail du composant.
//
// ── TOUS LES FICHIERS SONT AU MÊME FORMAT, ET C'EST UNE CONDITION ───────────
// 720 × 960 (3/4) pour les six, servis entiers — aucun détourage. La boîte
// réservée par `width`/`height` est donc EXACTEMENT la même quand la photo
// change : l'alternance ne produit ni décalage de mise en page (CLS) ni seconde
// candidate LCP. C'est la contrainte à vérifier avant d'en ajouter une :
// `src/components/__tests__/PhotoDuHeros.test.jsx` refuse une liste dont un
// fichier aurait un autre rapport, et refuse aussi un chemin qui n'existe pas
// dans `public/assets/` (une faute de frappe dans un chemin ne rougirait
// ailleurs nulle part : l'image manquerait, en silence, dans le navigateur).
//
// ── POURQUOI 720 × 960, ET POURQUOI C'EST UNE MESURE (29/09/2026) ───────────
// Le CDN de Pexels sert ces photos recadrées en 3/4 à 960 × 1280 (recadrage
// centré sur le visage : `fit=crop&crop=faces`). Les publier TELLES QUELLES
// pesait 824 Ko à six — et les ré-encoder à leur taille native NE GAGNE RIEN :
// mesuré, un ré-encodage progressif qualité 78 des mêmes fichiers donne 863 Ko,
// c'est-à-dire PLUS que ce que Pexels livre déjà (`auto=compress` est plus
// efficace que ce qu'un encodeur local produit sur ce contenu). Ce qui fait le
// poids, ce sont les PIXELS, pas le réglage de qualité : 960 × 1280 par photo
// pour une boîte de 480 px de large.
//
// Le tableau mesuré (Les six photos, total des six fichiers) :
//
//   960 × 1280 tel quel (Pexels)        823,7 Ko
//   960 × 1280 ré-encodé q78            863,1 Ko   ← pire : ne rien refaire
//   720 × 960 q82                       596,2 Ko
//   720 × 960 q80                       560,8 Ko   ← le réglage retenu
//   720 × 960 q75                       487,0 Ko
//   640 × 853 q78                       442,5 Ko
//
// 720 × 960 est le point retenu parce qu'il reste NET dans la boîte réelle :
// 480 px de large en desktop (1,5× la densité 1x) et ≈ 380 px sur un téléphone
// (1,9×) — alors que 640 × 853 y arrive au ras de la densité 1x, où la photo
// commencerait à se voir agrandie sur un écran à 2×. La bascule vers le bas
// (960 → 720) ÉCONOMISE 263 Ko sans changer un seul pixel à l'écran, pas même la
// boîte : le rapport est le même, donc rien ne bouge. Ces fichiers sont des
// JPEG PROGRESSIFS, recodés une fois pour toutes ici ; ils ne sont PAS
// retéléchargés au build.
//
// ── LES VARIANTES AVIF ET WEBP, ET POURQUOI LE JPEG RESTE (08/10/2026) ─────
// Le JPEG 720 × 960 est le REPLI, plus le seul fichier : à côté de lui, chaque
// photo est publiée en AVIF et en WebP, à DEUX largeurs (480 et 720), et c'est
// le NAVIGATEUR qui choisit — `<picture>` + deux `<source>` par format, puis le
// `<img>` en dernier recours (voir le composant et la coquille, qui publient le
// MÊME balisage depuis ce fichier).
//
// LE TABLEAU MESURÉ (total des six photos, généré par
// `scripts/gen-hero-images.py`, manifeste : `scripts/hero-variants.manifest.json` ;
// PSNR minimum contre la source JPEG, sur les six) :
//
//   JPEG 720 (le repli)               574 211 o      —
//   WebP q75  720                     264 938 o   −53,9 %   PSNR min 35,76 dB
//   AVIF q55  720                     213 059 o   −62,9 %   PSNR min 36,69 dB
//   WebP q75  480                     147 994 o      —
//   AVIF q55  480                     120 313 o      —
//
// L'AVIF est le plus léger ET le mieux noté des deux : ce n'est pas un hasard,
// c'est l'ordre des décodeurs. Le WebP existe pour les navigateurs qui
// connaissent le WebP sans connaître l'AVIF (Safari < 16.1, Firefox < 93), et le
// JPEG pour ceux qui ne connaissent ni l'un ni l'autre. Un navigateur moderne
// télécharge donc ~20 à 60 Ko là où il en téléchargeait 63 à 94.
//
// POURQUOI DEUX LARGEURS. La boîte du héros mesure 480 px de large en desktop
// (mesuré : 480 × 640 px à 1350 × 940) et 380 px sur un téléphone (mesuré :
// 380 × 506,66 px à 412 × 823). Un écran à densité 1 peut donc se contenter de
// la variante 480 ; les écrans à densité 2 et plus demandent 760 px et plus et
// reçoivent la 720, qui est aussi la source entière — il n'y a pas de variante
// au-dessus, donc jamais d'agrandissement. `PHOTO_HEROS_SIZES` déclare cette
// boîte au navigateur en DEUX morceaux qui suivent la feuille : `.cadre-
// illustration` vaut `min(100%, 30rem)`, soit 480 px dès que la fenêtre est
// large, et la largeur de la fenêtre en dessous.
//
// CE QUI A ÉTÉ ÉCARTÉ, ET POURQUOI. Une seule largeur (720) aurait laissé les
// écrans à densité 1 télécharger 1,5 fois les pixels qu'ils affichent. Ré-encoder
// le JPEG à 480 aurait ajouté un troisième repli pour un gain nul : aucun
// navigateur moderne n'y arrive plus. Et l'AVIF seul, sans WebP, aurait laissé
// les navigateurs de 2021-2022 retomber sur le JPEG de 574 Ko.
//
// ── LE CACHE IMMUTABLE, ET CE QUE ÇA IMPOSE ─────────────────────────────────
// `vercel.json` sert `/assets/(.*)` en `public, max-age=31536000, immutable` :
// le NOM du fichier est donc sa version (c'est déjà vrai des six JPEG, dont le
// cadrage a changé deux fois). Régénérer une variante SANS changer son nom
// laisserait un an de cache périmé aux visiteurs déjà venus — la même règle que
// pour les polices (`public/fonts/`, voir src/index.css). Une campagne de
// compression qui change les réglages doit donc renommer (ou accepter ce
// délai), et `scripts/check-hero-images.js` refusera de toute façon un fichier
// dont les octets ne sont plus ceux du manifeste mesuré.
//
// ── PROVENANCE ET LICENCE ───────────────────────────────────────────────────
// Pexels (licence Pexels : usage commercial libre, sans attribution
// obligatoire) ; recadrées à la source, puis réduites ici à 720 px de large et
// servies depuis le site : ce sont des ressources MÊMES-ORIGINE — une coquille
// pré-rendue n'a pas le droit de déclarer une ressource tierce
// (scripts/check-shell-remote-resources.js), et une photo distante le serait.
// Les variantes sont dérivées de ces MÊMES JPEG par un script du dépôt, donc la
// licence ne change pas en chemin.
export const PHOTOS_HEROS = [
  '/assets/kojo-hero.jpg',
  '/assets/kojo-hero-2.jpg',
  '/assets/kojo-hero-3.jpg',
  '/assets/kojo-hero-4.jpg',
  '/assets/kojo-hero-5.jpg',
  '/assets/kojo-hero-6.jpg',
];

// Les dimensions RÉELLES des fichiers (et non celles d'un cadre théorique) :
// c'est ce couple que les deux canaux publient en `width`/`height`, et c'est lui
// qui réserve la boîte avant que l'image ne soit arrivée. Il est LU À NOUVEAU
// dans l'en-tête JPEG de CHAQUE fichier par le test du composant : changer un
// fichier sans changer cette constante fait rougir le test qui compte.
export const PHOTO_HEROS_LARGEUR = 720;
export const PHOTO_HEROS_HAUTEUR = 960;

// ── LES DEUX FORMATS ALTERNATIFS ET LES DEUX LARGEURS, DÉCLARÉS UNE FOIS ─────
// L'ordre de `PHOTO_HEROS_FORMATS` est celui des `<source>` : l'AVIF d'abord
// (le plus léger), le WebP ensuite. Inverser les deux ferait télécharger le
// WebP à tous les navigateurs qui savent lire l'AVIF.
export const PHOTO_HEROS_FORMATS = ['avif', 'webp'];

// La largeur 720 n'a PAS de suffixe dans le nom du fichier : c'est la source
// entière, et le repli JPEG porte déjà ce nom-là. Les noms sont construits par
// `scripts/gen-hero-images.py`, jamais écrits à la main ici.
export const PHOTO_HEROS_LARGEURS = [480, 720];

// La boîte du héros, telle que le navigateur doit la connaître pour choisir
// une variante : 480 px dès 768 px de fenêtre (`.cadre-illustration` vaut
// `min(100%, 30rem)`), la fenêtre entière en dessous. Forme volontairement
// simple (`(min-width: …) …px, 100vw`) : `min()`/`calc()` y sont acceptés par
// les navigateurs récents mais pas par tous, et un `sizes` illisible ferait
// choisir 100vw — donc la variante 720 sur un téléphone.
export const PHOTO_HEROS_SIZES = '(min-width: 768px) 480px, 100vw';

/** Le nom de la variante d'une photo : `kojo-hero-3` + 480 + `webp`. */
export const cheminVariante = (cheminJpeg, largeur, format) => {
  if (largeur !== PHOTO_HEROS_LARGEUR && !PHOTO_HEROS_LARGEURS.includes(largeur)) {
    throw new Error(`largeur de variante non déclarée : ${largeur}`);
  }
  if (!PHOTO_HEROS_FORMATS.includes(format)) {
    throw new Error(`format de variante non déclaré : ${format}`);
  }
  const base = cheminJpeg.replace(/\.jpg$/, '');
  const suffixe = largeur === PHOTO_HEROS_LARGEUR ? '' : `-${largeur}`;
  return `${base}${suffixe}.${format}`;
};

/**
 * Les variantes d'une photo, par format et par largeur — le seul endroit où les
 * 24 chemins publiés sont écrits.
 */
export const variantesDe = (cheminJpeg) => {
  const parFormat = {};
  for (const format of PHOTO_HEROS_FORMATS) {
    parFormat[format] = {};
    for (const largeur of PHOTO_HEROS_LARGEURS) {
      parFormat[format][largeur] = cheminVariante(cheminJpeg, largeur, format);
    }
  }
  return { jpeg: cheminJpeg, ...parFormat };
};

/** Les variantes de TOUTES les photos, dans l'ordre de la rotation. */
export const VARIANTES_HEROS = PHOTOS_HEROS.map(variantesDe);

/**
 * Le `srcset` d'une photo pour un format : les deux largeurs, dans l'ordre
 * croissant, avec leur descripteur `w`. Rendu tel quel dans les deux canaux et
 * dans le `imagesrcset` du préchargement — un `srcset` recopié d'un côté
 * ferait précharger un candidat que le `<picture>` ne choisirait pas, donc
 * télécharger DEUX fichiers.
 */
export const srcsetHeros = (index, format) => {
  const variantes = VARIANTES_HEROS[index];
  if (!variantes) throw new Error(`photo de héros inconnue : ${index}`);
  return PHOTO_HEROS_LARGEURS.map((largeur) => `${variantes[format][largeur]} ${largeur}w`).join(', ');
};

/**
 * De la variante CHOISIE par le navigateur à celle de la photo suivante.
 *
 * Sert au préchargement du cran suivant (PhotoDuHeros) : le navigateur a déjà
 * choisi un format et une largeur pour la photo affichée (c'est son
 * `currentSrc`), donc la photo suivante se précharge dans LA MÊME variante —
 * sans deviner les capacités du navigateur, et sans télécharger un format qu'il
 * ne lirait pas. Rend `null` si l'URL n'est pas une variante connue (repli
 * JPEG d'un ancêtre, URL absolue d'un proxy) : l'appelant décide alors.
 */
export const memeVarianteQue = (urlChoisie, indexSuivant) => {
  const suivantes = VARIANTES_HEROS[indexSuivant];
  if (!suivantes) return null;
  // `currentSrc` peut être une URL ABSOLUE (CDN, domaine de production) là où
  // cette table porte des chemins : on compare donc à partir de `/assets/`.
  const normaliser = (url) => {
    const coupe = String(url || '').indexOf('/assets/');
    return coupe === -1 ? String(url || '') : String(url).slice(coupe);
  };
  const choisie = normaliser(urlChoisie);
  for (let index = 0; index < VARIANTES_HEROS.length; index += 1) {
    const variantes = VARIANTES_HEROS[index];
    if (variantes.jpeg === choisie) return suivantes.jpeg;
    for (const format of PHOTO_HEROS_FORMATS) {
      for (const largeur of PHOTO_HEROS_LARGEURS) {
        if (variantes[format][largeur] === choisie) return suivantes[format][largeur];
      }
    }
  }
  return null;
};

// Le pas de l'alternance. Assez long pour qu'on ait le temps de lire le héros
// (le titre, la phrase, les deux actions), assez court pour qu'un visiteur qui
// s'attarde voie toute la série — six photos, donc un tour complet en 1 min 30.
export const PHOTO_HEROS_DELAI_MS = 15000;
