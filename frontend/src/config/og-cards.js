// Table UNIQUE des cartes Open Graph par route.
//
// Elle vit ici — et pas dans scripts/ — parce qu'elle est lue par les DEUX
// côtés qui annoncent une carte :
//   • les coquilles PRÉ-RENDUES, écrites au build (vite.config.js via
//     scripts/check-og-images.js) et vérifiées en HTTP sur le déploiement ;
//   • les pages au RUNTIME (src/utils/seo.js), qui posent og:image après
//     montage du composant.
// Les modules de scripts/ importent `node:fs` / `node:path` : ils ne sont pas
// embarquables dans le bundle. Ce fichier, lui, n'a AUCUNE dépendance — même
// arrangement que src/config/contact.js, lu par l'app et par le build.
//
// Ce que ce fichier supprime : deux déclarations indépendantes pour la même
// route. /login annonçait sa carte des deux côtés — mais l'une était écrite dans
// src/pages/Login.js et l'autre dans la table des coquilles, et RIEN ne les
// empêchait de diverger : renommer l'image d'un seul côté ne cassait aucun test,
// et un crawler (qui lit le HTML pré-rendu) n'aurait plus affiché la même carte
// qu'un navigateur (qui exécute la page). Ici il n'y a plus qu'une déclaration.
//
// `image` = carte wide (1200x630) ; `imageSquare` = variante CARRÉE 1200x1200,
// exigée par les réseaux qui recadrent en 1:1.
export const GENERIC_CARD = {
  image: '/og-image-1200x630.png',
  imageSquare: '/og-square-1200x1200.png',
};

// Seules les routes qui ont un VISUEL DÉDIÉ figurent ici ; toutes les autres
// (dont /register, /forgot-password, /how-it-works, /support, /dashboard,
// /profile) reçoivent la carte générique — donc elles sont vérifiées, jamais
// oubliées.
export const DEDICATED_CARDS = {
  '/jobs': { image: '/og-jobs.png', imageSquare: '/og-jobs-square.png' },
  '/login': { image: '/og-login.png', imageSquare: '/og-login-square.png' },
};

/**
 * Carte de la route donnée (générique si elle n'a pas de visuel dédié).
 *
 * @param {string} [route] Chemin de la route (« /jobs »). Par défaut : la route
 *   courante du navigateur — un appelant qui ne passe rien ne peut donc pas
 *   annoncer la carte d'une AUTRE route.
 */
export const ogCardFor = (route) => DEDICATED_CARDS[normalize(route)] || GENERIC_CARD;

/** Chemin normalisé : « /jobs/ » et « /jobs » sont la même route. */
function normalize(route) {
  const raw = route ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const path = String(raw).split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path || '/';
}
