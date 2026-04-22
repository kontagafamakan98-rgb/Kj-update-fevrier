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

  if (typeof window !== 'undefined' && window.location?.origin) {
    return trimTrailingSlashes(window.location.origin);
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
