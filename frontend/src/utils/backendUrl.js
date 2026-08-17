const trimTrailingSlashes = (value = '') => String(value || '').replace(/\/+$/, '');
const PROD_ENV_BACKEND_URL = (
  import.meta.env.VITE_API_URL
  || import.meta.env.VITE_API_BASE_URL
  || import.meta.env.VITE_BACKEND_URL
  || ''
).trim();
// VITE_API_URL peut être défini avec OU sans le suffixe /api (les deux
// conventions coexistent : api.js l'attend avec /api, buildApiUrl l'ajoute
// lui-même). On normalise vers l'ORIGINE nue pour que buildBackendUrl /
// buildApiUrl ne produisent jamais un double préfixe /api/api (bug réel :
// GET /api/api/users/payment-accounts → 404).
const stripApiSuffix = (value = '') => String(value || '').replace(/\/api$/i, '');
const DEFAULT_REMOTE_BACKEND_URL = stripApiSuffix(PROD_ENV_BACKEND_URL) || 'https://kojo-backend.fly.dev';
const ensureLeadingSlash = (value = '') => {
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
};

export const getBackendBaseUrl = () => {
  const envUrl = trimTrailingSlashes(process.env.REACT_APP_BACKEND_URL || '');
  if (envUrl) {
    return envUrl;
  }

  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port } = window.location;
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';

    if (isLocalHost && port && port !== '8000') {
      return `${protocol}//${hostname}:8000`;
    }

    return DEFAULT_REMOTE_BACKEND_URL;
  }

  return DEFAULT_REMOTE_BACKEND_URL;
};

export const buildBackendUrl = (path = '') => {
  const baseUrl = getBackendBaseUrl();
  const normalizedPath = ensureLeadingSlash(path);

  if (!baseUrl) {
    return normalizedPath || '';
  }

  return `${baseUrl}${normalizedPath}`;
};

export const buildApiUrl = (path = '') => {
  const normalizedPath = ensureLeadingSlash(path);
  // Base « nue » (origine sans suffixe /api) : REACT_APP_BACKEND_URL peut
  // être défini avec OU sans /api (les deux conventions coexistent). On
  // ajoute le préfixe /api exactement une fois — sinon double préfixe
  // /api/api (bug réel : GET /api/api/users/payment-accounts → 404).
  const bareBaseUrl = String(getBackendBaseUrl() || '').replace(/\/api$/i, '');

  if (normalizedPath.startsWith('/api/')) {
    return `${bareBaseUrl}${normalizedPath}`;
  }

  return `${bareBaseUrl}/api${normalizedPath}`;
};

