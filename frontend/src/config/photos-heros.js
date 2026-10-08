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
// ── PROVENANCE ET LICENCE ───────────────────────────────────────────────────
// Pexels (licence Pexels : usage commercial libre, sans attribution
// obligatoire) ; recadrées à la source, puis réduites ici à 720 px de large et
// servies depuis le site : ce sont des ressources MÊMES-ORIGINE — une coquille
// pré-rendue n'a pas le droit de déclarer une ressource tierce
// (scripts/check-shell-remote-resources.js), et une photo distante le serait.
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

// Le pas de l'alternance. Assez long pour qu'on ait le temps de lire le héros
// (le titre, la phrase, les deux actions), assez court pour qu'un visiteur qui
// s'attarde voie toute la série — six photos, donc un tour complet en 1 min 30.
export const PHOTO_HEROS_DELAI_MS = 15000;
