// ============================================================================
// SOURCE DE VÉRITÉ UNIQUE — construction des URLs du backend.
//
// Toute dérivation de l'URL du backend (API, photos, géoloc, workflow de
// proposition…) passe par CE module. Ne pas réimplémenter de la logique de
// base/URL ailleurs (bug réel historique : GET /api/api/users/payment-accounts
// → 404, causé par deux helpers qui normalisaient différemment la même
// variable d'environnement).
//
// Sources de configuration, par ordre de priorité :
//   1. window.__KOJO_API_URL__ || window.__API_URL__  (override runtime)
//   2. import.meta.env.VITE_API_URL || VITE_API_BASE_URL || VITE_BACKEND_URL
//   3. process.env.REACT_APP_BACKEND_URL || REACT_APP_API_URL
//      (injecté par vite.config.js via `define`, depuis les variables
//      d'environnement REACT_APP_* du build)
//   4. repli dev : localhost:8000 quand on est sur localhost (port ≠ 8000)
//   5. défaut : https://kojo-backend.fly.dev
//
// Convention : VITE_API_URL / REACT_APP_BACKEND_URL peuvent être définis AVEC
// ou SANS le suffixe /api (les deux conventions coexistent). getBackendBaseUrl
// renvoie la base telle quelle (avec /api si fourni) ; buildApiUrl normalise
// vers l'origine nue puis ajoute /api exactement une fois.
// ============================================================================

const trimTrailingSlashes = (value = '') => String(value || '').replace(/\/+$/, '');
const DEFAULT_REMOTE_BACKEND_URL = 'https://kojo-backend.fly.dev';

const readRuntimeOverride = () => {
  if (typeof window !== 'undefined') {
    const value = window.__KOJO_API_URL__ || window.__API_URL__;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const readEnvBackendUrl = () => {
  if (typeof import.meta !== 'undefined' && import.meta?.env) {
    const fromImportMeta = import.meta.env.VITE_API_URL
      || import.meta.env.VITE_API_BASE_URL
      || import.meta.env.VITE_BACKEND_URL
      || '';
    if (typeof fromImportMeta === 'string' && fromImportMeta.trim()) return fromImportMeta.trim();
  }

  if (typeof process !== 'undefined' && process.env) {
    const fromProcess = process.env.REACT_APP_BACKEND_URL || process.env.REACT_APP_API_URL || '';
    if (typeof fromProcess === 'string' && fromProcess.trim()) return fromProcess.trim();
  }

  return '';
};

const resolveBackendBaseUrl = () => {
  const runtime = readRuntimeOverride();
  if (runtime) return trimTrailingSlashes(runtime);

  const env = readEnvBackendUrl();
  if (env) return trimTrailingSlashes(env);

  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port } = window.location;
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLocalHost && port && port !== '8000') {
      return `${protocol}//${hostname}:8000`;
    }
  }

  return DEFAULT_REMOTE_BACKEND_URL;
};

const ensureLeadingSlash = (value = '') => {
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
};

// Base « nue » (origine sans suffixe /api) : enlève TOUS les /api terminaux
// (un /api/api en dur dans la config ne doit pas survivre — bug réel).
const stripApiSuffixes = (value = '') => String(value || '').replace(/(\/api)+$/i, '');

/**
 * Base du backend telle que configurée (peut inclure le suffixe /api).
 * À utiliser via buildApiUrl / buildBackendUrl, pas directement.
 */
export const getBackendBaseUrl = () => resolveBackendBaseUrl();

/**
 * URL « brute » = base + chemin (sans ajout de /api). Destinée aux ressources
 * dont le chemin contient déjà le préfixe /api (ex. URLs de photos stockées
 * en base comme '/api/uploads/...').
 */
export const buildBackendUrl = (path = '') => {
  const baseUrl = getBackendBaseUrl();
  const normalizedPath = ensureLeadingSlash(path);

  if (!baseUrl) {
    return normalizedPath || '';
  }

  // Le chemin peut déjà contenir le préfixe /api (URLs de photos legacy) :
  // ne pas le dupliquer si la base l'inclut déjà (même classe de bug que
  // /api/api de buildApiUrl). En pratique photo_url est une URL Cloudinary
  // absolue — la branche relative ne sert qu'aux données historiques.
  if (normalizedPath.startsWith('/api/') && /\/api$/i.test(baseUrl)) {
    return `${stripApiSuffixes(baseUrl)}${normalizedPath}`;
  }

  return `${baseUrl}${normalizedPath}`;
};

/**
 * URL d'API = origine nue + /api + chemin. Ne produit JAMAIS un double
 * préfixe /api/api, quelle que soit la convention de la config (avec ou sans
 * /api, slash final, chemin déjà préfixé).
 */
export const buildApiUrl = (path = '') => {
  const normalizedPath = ensureLeadingSlash(path);
  const bareBaseUrl = stripApiSuffixes(getBackendBaseUrl());

  if (normalizedPath.startsWith('/api/')) {
    return `${bareBaseUrl}${normalizedPath}`;
  }

  return `${bareBaseUrl}/api${normalizedPath}`;
};
