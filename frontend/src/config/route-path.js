// Normalisation d'un chemin de route — propriété UNIQUE des deux tables de
// src/config/ (les cartes Open Graph et le titre/description par route).
//
// Les deux tables répondent à la même question pour la même URL : « /jobs »,
// « /jobs/ » et « /jobs?category=plumbing » sont-ils la même route ? Chacune
// avait sa copie de cette règle ; une correction (segment final vide, query,
// fragment) pouvait donc n'atterrir que d'un côté et faire répondre deux
// métadonnées différentes pour la même adresse.

/**
 * Chemin normalisé : sans query, sans fragment, sans « / » final.
 *
 * @param {string} [route] Chemin (« /jobs/ »). Par défaut : la route COURANTE
 *   du navigateur — un appelant qui ne passe rien ne peut donc pas annoncer les
 *   métadonnées d'une AUTRE route.
 * @returns {string} Chemin normalisé (« /jobs »), « / » pour la racine.
 */
export const normalizeRoute = (route) => {
  const raw = route ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const path = String(raw).split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path || '/';
};
