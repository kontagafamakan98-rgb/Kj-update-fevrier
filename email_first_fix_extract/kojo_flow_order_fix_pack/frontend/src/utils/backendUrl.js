const trimTrailingSlashes = (value = '') => String(value || '').replace(/\/+$/, '');
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
    const { protocol, hostname, origin, port } = window.location;
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';

    if (isLocalHost && port && port !== '8000') {
      return `${protocol}//${hostname}:8000`;
    }

    return trimTrailingSlashes(origin);
  }

  return '';
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
  if (normalizedPath.startsWith('/api/')) {
    return buildBackendUrl(normalizedPath);
  }

  return buildBackendUrl(`/api${normalizedPath}`);
};
