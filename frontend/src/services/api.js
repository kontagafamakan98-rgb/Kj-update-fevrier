// Construction d'URL : source de vérité unique dans ../utils/backendUrl
// (buildApiUrl). Ne PAS réimplémenter la dérivation de base ici — bug réel
// historique de double préfixe /api/api quand deux helpers normalisent
// différemment la même variable d'environnement.
import { buildApiUrl } from '../utils/backendUrl';

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

export const handleApiError = (error, fallback = 'Une erreur est survenue') => {
  if (typeof error?.response?.data?.detail === 'string' && error.response.data.detail.trim()) {
    return error.response.data.detail.trim();
  }

  if (Array.isArray(error?.response?.data?.detail) && error.response.data.detail.length > 0) {
    const joined = error.response.data.detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return item.msg || item.message || '';
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
    if (joined) return joined;
  }

  if (typeof error?.response?.data?.message === 'string' && error.response.data.message.trim()) {
    return error.response.data.message.trim();
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
};

// Ces endpoints renvoient un 401 comme RÉSULTAT MÉTIER (identifiants
// invalides, OTP refusé…) : il ne faut PAS les traiter comme une session
// expirée (sinon déconnexion surprise pendant le login / la vérification).
// /auth/logout est inclus : un token déjà expiré au moment du logout ne doit
// pas déclencher la redirection globale pendant la déconnexion.
const BUSINESS_401_PREFIXES = ['/auth/login', '/auth/register', '/auth/email/', '/auth/password/', '/auth/logout'];

// Clés de session auth purgeables en cas de 401 — dans localStorage ET
// sessionStorage (getAuthToken lit les deux buckets, la purge doit donc
// couvrir les deux, sinon un token stocké en sessionStorage survivait au
// 401 et l'app restait bloquée en boucle de redirection).
const AUTH_STORAGE_KEYS = [
  'token', 'token_expires_at', 'user',
  'auth_token', 'access_token', 'accessToken', 'kojo_token', 'jwt',
  'bearer_token', 'auth', 'auth_user', 'session_user', 'currentUser', 'kojo_user',
];

let sessionRedirecting = false;
let csrfTokenMemory = '';

/**
 * Session expirée ou révoquée (401) : purge locale (localStorage +
 * sessionStorage) et redirection vers /login. Garde-fou anti-boucle (une
 * seule redirection) et anti-crash (jsdom/tests).
 */
const handleUnauthorized = (path, { redirect = true } = {}) => {
  if (BUSINESS_401_PREFIXES.some((prefix) => path.startsWith(prefix))) return;
  if (sessionRedirecting) return;

  try {
    const purge = (bucketName) => {
      const bucket = typeof window !== 'undefined' ? window[bucketName] : null;
      if (!bucket) return;
      AUTH_STORAGE_KEYS.forEach((key) => {
        try { bucket.removeItem(key); } catch (_e) { /* clé absente */ }
      });
    };

    // Session cookie httpOnly toujours présente (kojo_csrf associé lisible) :
    // le 401 vient d'un token STALE en localStorage (vestige de la migration
    // cookie auth), pas d'une session morte. On purge le stockage
    // (auto-guérison : les prochains appels partent en cookie-only) mais on
    // NE redirige PAS vers /login — l'utilisateur est toujours connecté. Si
    // la session cookie est réellement morte, /auth/me échouera et le garde
    // de route (App.js) renverra vers /login.
    if (hasSessionCookie()) {
      purge('localStorage');
      purge('sessionStorage');
      return;
    }

    purge('localStorage');
    purge('sessionStorage');
  } catch (_error) {}

  if (!redirect) return;

  sessionRedirecting = true;

  try {
    if (typeof window !== 'undefined' && window.location && !window.location.pathname.endsWith('/login')) {
      window.location.href = '/login';
    }
  } catch (_error) {
    // Navigation non implémentée (tests jsdom) : on laisse l'état local nettoyé.
    sessionRedirecting = false;
  }
};

// Session par cookie httpOnly (protection XSS) : le JWT vit dans le cookie
// kojo_session posé par le backend sur login/register. Les requêtes web
// envoient le cookie automatiquement (credentials: 'include'). Les
// mutations (POST/PUT/PATCH/DELETE) authentifiées par cookie doivent
// ré-échoquer le cookie CSRF kojo_csrf dans l'en-tête X-CSRFToken
// (protection CSRF double-submit).
const CSRF_COOKIE_NAME = 'kojo_csrf';

const readCsrfCookie = () => {
  if (csrfTokenMemory) return csrfTokenMemory;
  if (typeof document === 'undefined' || !document.cookie) return '';
  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${CSRF_COOKIE_NAME}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE_NAME.length + 1)) : '';
};

// Détection d'une session active pour l'amorçage au montage de l'app : le
// cookie de session est httpOnly (non lisible en JS), mais le cookie CSRF
// associé l'est → sa présence indique qu'une session existe.
export const hasSessionCookie = () => Boolean(readCsrfCookie());

const request = async (method, path, { params, data, headers, signal, skipUnauthorizedRedirect = false } = {}) => {
  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path || ''}`;
  const url = `${buildApiUrl(normalizedPath)}${buildQueryString(params)}`;
  const token = getAuthToken();
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData;
  const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  const csrfToken = readCsrfCookie();

  const response = await fetch(url, {
    method,
    credentials: 'include',
    ...(signal ? { signal } : {}),
    headers: {
      Accept: 'application/json',
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(!isSafeMethod && csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
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

  const responseCsrfToken = response.headers?.get?.('X-Kojo-CSRFToken');
  if (responseCsrfToken) csrfTokenMemory = responseCsrfToken;

  // Rotation du jeton (fenêtre glissante) : /auth/me ré-émet un jeton frais
  // quand le courant approche de l'expiration (X-Kojo-Token). On le stocke
  // immédiatement ('token' + token_expires_at) pour ne pas être déconnecté à
  // 24 h. Le cookie httpOnly est reposé par le backend dans la même réponse.
  const rotatedToken = response.headers?.get?.('X-Kojo-Token');
  if (rotatedToken) {
    try {
      localStorage.setItem('token', rotatedToken);
      const parts = String(rotatedToken).split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(
          atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
        );
        if (payload && payload.exp) {
          localStorage.setItem('token_expires_at', String(payload.exp * 1000));
        }
      }
    } catch (_error) {
      // localStorage indisponible (tests jsdom / privé) : le cookie httpOnly
      // posé par le backend porte déjà le nouveau jeton.
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      handleUnauthorized(normalizedPath, { redirect: !skipUnauthorizedRedirect });
    }

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
  uploadFile: (path, formData, options = {}) => request('POST', path, { ...options, data: formData }),
};

export const authAPI = {
  // SECURITE : l'ancien endpoint /auth/register (sans vérification email)
  // a été supprimé du backend — TOUTE inscription passe désormais par
  // /auth/register-verified, qui exige un jeton de vérification email (OTP).
  register: (userData) => api.post('/auth/register-verified', userData),
  signup: (userData) => api.post('/auth/register-verified', userData),
  registerVerified: (userData) => api.post('/auth/register-verified', userData),
  login: (credentials) => api.post('/auth/login', credentials),
  signin: (credentials) => api.post('/auth/login', credentials),
  // Déconnexion RÉELLE : révoque le jeton côté serveur (blacklist jti).
  // L'ancien stub `({ success: true })` ne contactait jamais /auth/logout,
  // donc un token volé restait valide 24h même après déconnexion.
  logout: async () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  getMe: () => api.get('/auth/me'),
  getProfile: (options = {}) => api.get('/auth/me', options),
  getCurrentUser: (options = {}) => api.get('/auth/me', options),
  updateCountry: (payload) => api.patch('/auth/me/country', payload),
  // Google SSO : le frontend envoie le code d'autorisation (jamais l'id_token).
  googleAuth: (payload) => api.post('/auth/google', payload),
  googleLink: (payload) => api.post('/auth/google/link', payload),
  // Email verification methods
  checkEmailAvailability: (payload) => api.post('/auth/email/check-availability', payload),
  sendEmailOtp: (payload) => api.post('/auth/email/send-otp', payload),
  resendEmailOtp: (payload) => api.post('/auth/email/resend-otp', payload),
  verifyEmailOtp: (payload) => api.post('/auth/email/verify-otp', payload),
  // Password reset methods
  requestPasswordResetOtp: (payload) => api.post('/auth/password/forgot/request', payload),
  resendPasswordResetOtp: (payload) => api.post('/auth/password/forgot/resend', payload),
  verifyPasswordResetOtp: (payload) => api.post('/auth/password/forgot/verify', payload),
  resetPassword: (payload) => api.post('/auth/password/reset', payload),
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
  acceptProposal: (jobId, proposalId, payload = {}) => api.post(`/jobs/${jobId}/proposals/${proposalId}/accept`, payload),
  getMyProposals: () => api.get('/proposals/mine'),
  completeJob: (jobId) => api.post(`/jobs/${jobId}/complete`),
  getPaymentStatus: (jobId) => api.get(`/jobs/${jobId}/payment-status`),
};

const stripKojoMarker = (value) => String(value || '').replace(/\[KOJO_JOB:[^\]]+\]\s*/gi, '').trim();

const getCleanPersonName = (person) => {
  const direct = person?.full_name || person?.fullName || person?.display_name || person?.displayName || person?.name || person?.username;
  if (typeof direct === 'string' && stripKojoMarker(direct)) return stripKojoMarker(direct);
  const combined = [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim();
  if (combined) return stripKojoMarker(combined);
  if (typeof person?.email === 'string' && person.email.trim()) return stripKojoMarker(person.email.trim());
  return '';
};

const normalizeMessageItem = (message) => ({
  ...message,
  content: stripKojoMarker(message?.content || message?.message || ''),
  message: stripKojoMarker(message?.message || message?.content || ''),
  sender_name: stripKojoMarker(message?.sender_name || message?.senderName || getCleanPersonName(message?.sender)),
  receiver_name: stripKojoMarker(message?.receiver_name || message?.receiverName || getCleanPersonName(message?.receiver)),
});

const normalizeMessageListResponse = (payload) => {
  if (Array.isArray(payload)) return payload.map(normalizeMessageItem);
  if (Array.isArray(payload?.data)) return { ...payload, data: payload.data.map(normalizeMessageItem) };
  if (Array.isArray(payload?.items)) return { ...payload, items: payload.items.map(normalizeMessageItem) };
  if (Array.isArray(payload?.results)) return { ...payload, results: payload.results.map(normalizeMessageItem) };
  if (payload && typeof payload === 'object') return normalizeMessageItem(payload);
  return payload;
};

const normalizeConversationItem = (conversation) => {
  const lastMessage = conversation?.last_message || conversation?.lastMessage || conversation?.latest_message || conversation?.latestMessage || {};
  const participant = conversation?.participant || conversation?.user || conversation?.other_user || conversation?.counterpart || {};
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  const participantNames = participants.map(getCleanPersonName).filter(Boolean);
  const resolvedName = stripKojoMarker(
    conversation?.display_name
    || conversation?.displayName
    || conversation?.participant_name
    || conversation?.participantName
    || conversation?.other_user_name
    || conversation?.otherUserName
    || conversation?.user_name
    || conversation?.userName
    || conversation?.title
    || getCleanPersonName(participant)
    || stripKojoMarker(lastMessage?.sender_name || lastMessage?.receiver_name)
    || participantNames[0]
    || ''
  ) || 'Interlocuteur';

  return {
    ...conversation,
    display_name: resolvedName,
    displayName: resolvedName,
    participant_name: resolvedName,
    participantName: resolvedName,
    other_user_name: resolvedName,
    otherUserName: resolvedName,
    user_name: resolvedName,
    userName: resolvedName,
    title: resolvedName,
    name: resolvedName,
    full_name: resolvedName,
    last_message: lastMessage && typeof lastMessage === 'object' ? normalizeMessageItem(lastMessage) : lastMessage,
    lastMessage: lastMessage && typeof lastMessage === 'object' ? normalizeMessageItem(lastMessage) : lastMessage,
  };
};

const normalizeConversationListResponse = (payload) => {
  if (Array.isArray(payload)) return payload.map(normalizeConversationItem);
  if (Array.isArray(payload?.data)) return { ...payload, data: payload.data.map(normalizeConversationItem) };
  if (Array.isArray(payload?.items)) return { ...payload, items: payload.items.map(normalizeConversationItem) };
  if (Array.isArray(payload?.results)) return { ...payload, results: payload.results.map(normalizeConversationItem) };
  if (payload && typeof payload === 'object') return normalizeConversationItem(payload);
  return payload;
};

export const messagesAPI = {
  send: (payload) => api.post('/messages', payload),
  sendMessage: (payload) => api.post('/messages', payload),
  list: async () => normalizeMessageListResponse(await api.get('/messages')),
  getConversations: async () => normalizeConversationListResponse(await api.get('/messages/conversations')),
  getConversation: async (conversationId) => normalizeMessageListResponse(await api.get(`/messages/${conversationId}`)),
  getMessages: async (conversationId, { limit = 100, offset = 0, order = 'asc' } = {}) => normalizeMessageListResponse(await api.get(`/messages/${conversationId}`, { params: { limit, offset, order } })),
};

const camelToKebab = (value) => String(value || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/_/g, '-')
  .toLowerCase();

const createResourceApi = (resourceName) => {
  const basePath = `/${String(resourceName || '').replace(/^\/+|\/+$/g, '')}`;

  const baseApi = {
    list: (params = {}) => api.get(basePath, { params }),
    getAll: (params = {}) => api.get(basePath, { params }),
    getById: (id) => api.get(`${basePath}/${id}`),
    get: (id, params = {}) => id ? api.get(`${basePath}/${id}`, { params }) : api.get(basePath, { params }),
    create: (payload) => api.post(basePath, payload),
    post: (payload) => api.post(basePath, payload),
    update: (id, payload) => api.put(`${basePath}/${id}`, payload),
    patch: (id, payload) => api.patch(`${basePath}/${id}`, payload),
    remove: (id) => api.delete(`${basePath}/${id}`),
    delete: (id) => api.delete(`${basePath}/${id}`),
  };

  return new Proxy(baseApi, {
    get(target, prop) {
      if (typeof prop !== 'string') return target[prop];
      if (prop in target) return target[prop];

      return (...args) => {
        const action = camelToKebab(prop);
        const firstArg = args[0];
        const secondArg = args[1];

        if (prop.startsWith('get') || prop.startsWith('list') || prop.startsWith('fetch')) {
          if (typeof firstArg === 'string' || typeof firstArg === 'number') {
            return api.get(`${basePath}/${firstArg}`);
          }
          return api.get(`${basePath}/${action}`, { params: firstArg || {} });
        }

        if (prop.startsWith('create') || prop.startsWith('init') || prop.startsWith('start') || prop.startsWith('submit') || prop.startsWith('pay') || prop.startsWith('process')) {
          return api.post(`${basePath}/${action}`, firstArg || {});
        }

        if (prop.startsWith('update') || prop.startsWith('set')) {
          if (typeof firstArg === 'string' || typeof firstArg === 'number') {
            return api.put(`${basePath}/${firstArg}`, secondArg || {});
          }
          return api.put(`${basePath}/${action}`, firstArg || {});
        }

        if (prop.startsWith('delete') || prop.startsWith('remove') || prop.startsWith('cancel')) {
          if (typeof firstArg === 'string' || typeof firstArg === 'number') {
            return api.delete(`${basePath}/${firstArg}`);
          }
          return api.post(`${basePath}/${action}`, firstArg || {});
        }

        return api.post(`${basePath}/${action}`, firstArg || {});
      };
    },
  });
};

// paymentAPI est defini explicitement (pas via createResourceApi) car le
// proxy generique construit des URLs qui ne correspondent PAS aux vraies
// routes backend pour ce module (ex: getConfig() -> /payments/get-config
// au lieu de /payments/config, en GET au lieu du bon verbe HTTP, etc.)
// Voir backend/server.py pour les routes reelles.
export const paymentAPI = {
  getConfig: () => api.get('/payments/config'),
  getQuote: (payload) => api.post('/payments/quote', payload),
  createCheckout: (payload) => api.post('/payments/checkout', payload),
  getPaymentStatus: (paymentId) => api.get(`/payments/status/${paymentId}`),
  getPaymentStatusByToken: (invoiceToken) => api.get(`/payments/status/token/${invoiceToken}`),
  getMyPayments: () => api.get('/payments/my'),
};
export const paymentsAPI = paymentAPI;
export const userAPI = createResourceApi('users');
export const usersAPI = {
  ...userAPI,
  // Profile photo methods
  getProfilePhoto: () => api.get('/users/profile-photo'),
  getUserProfilePhoto: (userId) => api.get(`/users/${userId}/profile-photo`),
  uploadProfilePhoto: (formData) => api.post('/users/profile-photo', formData),
  deleteProfilePhoto: () => api.delete('/users/profile-photo'),
  deleteAccount: () => api.delete('/users/account'),
  // Profile update
  updateProfile: (payload) => api.put('/users/profile', payload),
  // Portfolio travailleur (photos de réalisations)
  getPortfolio: () => api.get('/users/portfolio'),
  addPortfolioImage: (formData) => api.uploadFile('/users/portfolio', formData),
  removePortfolioImage: (index) => api.delete(`/users/portfolio/${index}`),
  // Parrainage
  getReferral: () => api.get('/users/referral'),
  getReferralFilleuls: () => api.get('/users/referral/filleuls'),
  applyReferral: (code) => api.post('/users/referral/apply', { code }),
  withdrawReferral: () => api.post('/users/referral/withdraw'),
};
export const profileAPI = userAPI;
export const profilesAPI = userAPI;
export const workerAPI = createResourceApi('workers');
export const workersAPI = workerAPI;
export const workerProfileAPI = {
  get: () => api.get('/workers/profile'),
  create: (payload) => api.post('/workers/profile', payload),
  update: (payload) => api.put('/workers/profile', payload),
};
export const notificationAPI = {
  // Récupérer toutes les notifications (+ unread_count)
  getAll: (params = {}) => api.get('/notifications', { params }),
  // Compteur non-lus uniquement (polling léger)
  getUnreadCount: () => api.get('/notifications/unread-count'),
  // Clé VAPID publique pour l'abonnement push
  getVapidPublicKey: () => api.get('/notifications/vapid-public-key'),
  // Marquer une notification comme lue
  markRead: (notificationId) => api.put(`/notifications/${notificationId}/read`),
  // Marquer toutes comme lues
  markAllRead: () => api.put('/notifications/mark-all-read'),
  // Supprimer une notification
  deleteOne: (notificationId) => api.delete(`/notifications/${notificationId}`),
  // Supprimer toutes
  deleteAll: () => api.delete('/notifications'),
  // Enregistrer un push token (web subscription JSON)
  registerPushToken: (payload) => api.post('/users/push-token', payload),
};
export const notificationsAPI = notificationAPI;
// Avis / notes : endpoints explicites (le proxy générique construisait des
// URLs qui ne correspondent pas aux vraies routes backend).
export const reviewAPI = {
  create: (jobId, payload) => api.post(`/jobs/${jobId}/reviews`, payload),
  getJobReviews: (jobId) => api.get(`/jobs/${jobId}/reviews`),
  getUserReviews: (userId) => api.get(`/users/${userId}/reviews`),
  remove: (reviewId) => api.delete(`/reviews/${reviewId}`),
};
export const reviewsAPI = reviewAPI;
export const supportAPI = {
  createTicket: (payload) => api.post('/support/tickets', payload),
  getTicketStatus: (ticketId, email) => api.post('/support/tickets/status', { ticket_id: ticketId, email }),
  listTickets: (statusFilter) => api.get('/support/tickets', { params: statusFilter ? { status_filter: statusFilter } : {} }),
  updateTicketStatus: (ticketId, status) => api.patch(`/support/tickets/${ticketId}/status`, { status }),
};
export const messageAPI = {
  list: (params = {}) => messagesAPI.list(params),
  getAll: (params = {}) => messagesAPI.list(params),
  getById: (id) => messagesAPI.getConversation(id),
  get: (id) => id ? messagesAPI.getConversation(id) : messagesAPI.list(),
  create: (payload) => messagesAPI.send(payload),
  post: (payload) => messagesAPI.send(payload),
  send: (payload) => messagesAPI.send(payload),
  getConversations: () => messagesAPI.getConversations(),
  getConversation: (id) => messagesAPI.getConversation(id),
};
export const conversationAPI = messageAPI;
export const conversationsAPI = messageAPI;

export const geolocationAPI = {
  detect: (params) => api.get('/geolocation/detect', { params }),
  getAvailableCountries: () => api.get('/geolocation/available-countries'),
};

export const publicAPI = {
  // Chiffres réels de la landing (compteurs agrégés, sans auth)
  getStats: () => api.get('/public/stats'),
};

export default api;
