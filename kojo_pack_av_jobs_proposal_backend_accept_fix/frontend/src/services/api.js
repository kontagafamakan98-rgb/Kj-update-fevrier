const DEFAULT_API_BASE_URL = 'https://kojo-backend-03az.onrender.com/api';

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const detectApiBaseUrl = () => {
  const envBase = typeof import.meta !== 'undefined' && import.meta?.env?.VITE_API_URL
    ? import.meta.env.VITE_API_URL
    : '';
  const runtimeBase = typeof window !== 'undefined' && window.__KOJO_API_URL__
    ? window.__KOJO_API_URL__
    : '';
  return trimTrailingSlash(envBase || runtimeBase || DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL;
};

const getStorageBuckets = () => {
  if (typeof window === 'undefined') return [];
  return [window.localStorage, window.sessionStorage].filter(Boolean);
};

const extractTokenFromRawValue = (raw) => {
  if (!raw) return '';

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';

    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return trimmed.replace(/^Bearer\s+/i, '').trim();
    }

    try {
      const parsed = JSON.parse(trimmed);
      return extractTokenFromRawValue(parsed);
    } catch (_error) {
      return trimmed.replace(/^Bearer\s+/i, '').trim();
    }
  }

  if (typeof raw === 'object') {
    const candidates = [
      raw.token,
      raw.access_token,
      raw.accessToken,
      raw.auth_token,
      raw.authToken,
      raw.jwt,
      raw.jwt_token,
      raw.bearer,
      raw.bearer_token,
      raw.data,
      raw.session,
      raw.user,
    ];

    for (const candidate of candidates) {
      const token = extractTokenFromRawValue(candidate);
      if (token) return token;
    }
  }

  return '';
};

export const getAuthToken = () => {
  const keys = [
    'token',
    'auth_token',
    'access_token',
    'accessToken',
    'kojo_token',
    'jwt',
    'bearer_token',
    'auth',
    'auth_user',
    'session_user',
    'currentUser',
    'user',
    'kojo_user',
  ];

  for (const bucket of getStorageBuckets()) {
    for (const key of keys) {
      try {
        const raw = bucket.getItem(key);
        const token = extractTokenFromRawValue(raw);
        if (token) return token;
      } catch (_error) {}
    }
  }

  return '';
};

const buildQueryString = (params = {}) => {
  const searchParams = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== '') {
          searchParams.append(key, String(item));
        }
      });
      return;
    }
    searchParams.append(key, String(value));
  });
  const query = searchParams.toString();
  return query ? `?${query}` : '';
};

const extractErrorMessage = (payload, fallback) => {
  const detail = payload?.detail;

  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail) && detail.length > 0) {
    const joined = detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return item.msg || item.message || JSON.stringify(item);
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
    if (joined) return joined;
  }

  if (detail && typeof detail === 'object') {
    return detail.msg || detail.message || fallback;
  }

  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
  return fallback;
};

const request = async (method, path, { params, data, headers } = {}) => {
  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path || ''}`;
  const url = `${detectApiBaseUrl()}${normalizedPath}${buildQueryString(params)}`;
  const token = getAuthToken();
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData;

  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: data === undefined ? undefined : (isFormData ? data : JSON.stringify(data)),
  });

  const rawText = await response.text();
  let payload = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const fallbackMessage = `HTTP ${response.status}`;
    const errorMessage = typeof payload === 'string'
      ? payload
      : extractErrorMessage(payload, fallbackMessage);
    const error = new Error(errorMessage || fallbackMessage);
    error.response = {
      status: response.status,
      data: typeof payload === 'string' ? { detail: payload } : (payload || { detail: fallbackMessage }),
    };
    throw error;
  }

  return payload;
};

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, data, options = {}) => request('POST', path, { ...options, data }),
  put: (path, data, options = {}) => request('PUT', path, { ...options, data }),
  patch: (path, data, options = {}) => request('PATCH', path, { ...options, data }),
  delete: (path, options) => request('DELETE', path, options),
};

export const jobsAPI = {
  getAll: (params = {}) => api.get('/jobs', { params }),
  getById: (id) => api.get(`/jobs/${id}`),
  create: (jobData) => api.post('/jobs', jobData),
  update: (id, jobData) => api.put(`/jobs/${id}`, jobData),
  delete: (id) => api.delete(`/jobs/${id}`),
  apply: (jobId, applicationData) => api.post(`/jobs/${jobId}/proposals`, applicationData),
  getApplications: (jobId) => api.get(`/jobs/${jobId}/proposals`),
  getProposals: (jobId) => api.get(`/jobs/${jobId}/proposals`),
};

export const messagesAPI = {
  send: (payload) => api.post('/messages', payload),
  list: () => api.get('/messages'),
  getConversations: () => api.get('/messages/conversations'),
  getConversation: (conversationId) => api.get(`/messages/${conversationId}`),
};

export default api;
