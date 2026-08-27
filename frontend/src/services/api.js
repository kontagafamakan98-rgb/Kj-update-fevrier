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

// Signal d'expiration de session consommé par AuthContext : quand un 401 non
// métier survient (aucun cookie httpOnly pour se rabattre), au lieu d'un
// rechargement RAPIDE vers /login (window.location.href — qui clobberait
// l'URL auditée par LHCI et remettrait à zéro l'état SPA), on émet un
// événement custom que AuthContext écoute et consomme en vidant user=null :
// ProtectedRoute fait alors une redirection SPA douce (<Navigate> React) vers
// /login, sans plein rechargement → pas de flicker, et l'URL finale reste
// déterministe pour Lighthouse. Un garde-minute conserve un repli hard en cas
// d'absence d'auditeur (contexte non-React / jsdom), sans trappe si le soft
// a déjà pris le relais.
const SESSION_NAVIGATION_EVENT = 'kojo:unauthorized';
let softRedirectConsumed = false;

const emitSessionExpired = () => {
  try {
    if (typeof window === 'undefined') return false;
    window.dispatchEvent(new Event(SESSION_NAVIGATION_EVENT, { bubbles: false, cancelable: false }));
    return true;
  } catch (_e) {
    return false;
  }
};

// Marque la consommation de la redirection douce (appelé par AuthContext
// quand son listener a répondu) pour que handleUnauthorized n'enchaîne pas
// avec la navigation pleine de repli.
export const markSoftRedirectConsumed = () => { softRedirectConsumed = true; };
// Récupération de session : UNE SEULE sonde /auth/me PARTAGÉE quand plusieurs
// requêtes échouent en parallèle (anti-tempête). Tous les appelants attendent
// la MÊME promesse — un simple flag fail-fast transformait la 2ᵉ requête en
// fausse déconnexion : purge du jeton fraîchement tourné + redirection /login
// malgré une session vivante, et sa mutation était perdue au lieu d'être
// rejouée avec le nouveau jeton.
let sessionRecoveryPromise = null;
const RECOVERY_FAILED = Symbol('recovery-failed');

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
    // REDIRECTION DOUCE PRIORITAIRE : on prévient AuthContext (via un
    // événement custom) que la session est morte. Le listener React s'exécute
    // SYNCHRONEMENT pendant dispatchEvent → il vide user=null (le garde de
    // route ProtectedRoute fait alors un <Navigate> SPA vers /login SANS
    // rechargement de page : pas de flicker et URL finale stable pour LHCI)
    // et marque softRedirectConsumed. S'il n'y a AUCUN auditeur (modèlè non
    // monté, jsdom, tests), on retombe immédiatement sur la navigation pleine
    // historique — comportement original inchangé.
    softRedirectConsumed = false;
    emitSessionExpired();
    // Toujours lever le garde anti-boucle, consommé en douceur ou non.
    sessionRedirecting = false;
    if (!softRedirectConsumed) {
      try {
        if (typeof window !== 'undefined' && window.location && !window.location.pathname.endsWith('/login')) {
          window.location.href = '/login';
        }
      } catch (_error) {
        // Navigation non implémentée (tests jsdom) : on laisse l'état local nettoyé.
      }
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

const request = async (method, path, { params, data, headers, signal, skipUnauthorizedRedirect = false, skipRecovery = false } = {}) => {
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
    // RÉCUPÉRATION DE SESSION : un token EXPIRÉ en localStorage ne signifie
    // pas forcément session morte — le cookie httpOnly peut être encore
    // valide (mode hybride). On sonde /auth/me UNE fois : le backend confirme
    // la session via le cookie, ré-échoit le CSRF et TOURNE le jeton quand le
    // cookie approche de l'expiration (X-Kojo-Token), puis on REJOUE la
    // requête avec le jeton/CSRF rafraîchis — sans aller-retour inutile vers
    // /login. Le 403 CSRF (mémoire CSRF périmée après une rotation) est aussi
    // récupérable : la sonde rafraîchit l'écho. Les endpoints métier
    // (login/OTP/logout) renvoient 401 comme résultat attendu → pas de
    // récupération ; /auth/me EST la sonde → pas de récursion.
    const isAuthFailure = response.status === 401;
    const isCsrfFailure = response.status === 403 && /csrf/i.test(String(payload?.detail || ''));
    const canRecover = (isAuthFailure || isCsrfFailure)
      && Boolean(token)
      && !skipRecovery
      && normalizedPath !== '/auth/me'
      && !BUSINESS_401_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));

    if (canRecover) {
      const recovered = await recoverSession(
        method, normalizedPath,
        { params, data, headers, signal, skipUnauthorizedRedirect }
      );
      if (recovered !== RECOVERY_FAILED) return recovered;
    }

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

/**
 * Récupération de session après un 401 (token expiré) ou un 403 CSRF : la
 * session réelle peut encore vivre dans le cookie httpOnly (ou la mémoire CSRF
 * est périmée). Sonde /auth/me (skipRecovery + redirect désactivé pour ne pas
 * récurser ni rediriger si la session est morte), puis REJOUE la requête
 * originale avec le jeton/CSRF rafraîchis. Renvoie RECOVERY_FAILED si la
 * session est réellement morte (le 401 normal purge + redirige ensuite).
 */
const recoverSession = async (method, path, options) => {
  // Single-flight PARTAGÉ : si une sonde est déjà en cours (ou vient de
  // finir), on attend la MÊME promesse au lieu d'échouer immédiatement.
  if (!sessionRecoveryPromise) {
    sessionRecoveryPromise = request('GET', '/auth/me', {
      skipUnauthorizedRedirect: true,
      skipRecovery: true,
    }).finally(() => {
      // La promesse partagée est consommée : la prochaine série de 401
      // déclenchera une NOUVELLE sonde (l'état de session a pu changer).
      sessionRecoveryPromise = null;
    });
  }
  try {
    await sessionRecoveryPromise;
  } catch (_error) {
    // La sonde a échoué : session réellement morte → chaque appelant retombe
    // sur la gestion 401 normale (purge + redirection, garde-fou anti-boucle).
    return RECOVERY_FAILED;
  }
  // La sonde a réussi : la session est vivante et le jeton/CSRF sont frais
  // (X-Kojo-Token stocké, csrfTokenMemory rafraîchi par l'écho). Le REJEU
  // relit getAuthToken() À CE MOMENT → le jeton tourné par la sonde, jamais
  // l'ancien remplacé ; et readCsrfCookie() → la mémoire CSRF rafraîchie.
  try {
    return await request(method, path, { ...options, skipRecovery: true });
  } catch (_error) {
    return RECOVERY_FAILED;
  }
};

export const api = {
  /** @returns {Promise<object>} Réponse JSON du backend (data, ok...). */
  get: (path, options) => request('GET', path, options),
  /** @returns {Promise<object>} Réponse JSON du backend. */
  post: (path, data, options = {}) => request('POST', path, { ...options, data }),
  /** @returns {Promise<object>} Réponse JSON du backend. */
  put: (path, data, options = {}) => request('PUT', path, { ...options, data }),
  /** @returns {Promise<object>} Réponse JSON du backend. */
  patch: (path, data, options = {}) => request('PATCH', path, { ...options, data }),
  /** @returns {Promise<object>} Réponse JSON du backend. */
  delete: (path, options) => request('DELETE', path, options),
  /** @returns {Promise<object>} Réponse JSON du backend. */
  uploadFile: (path, formData, options = {}) => request('POST', path, { ...options, data: formData }),
};

export const authAPI = {
  // SECURITE : l'ancien endpoint /auth/register (sans vérification email)
  // a été supprimé du backend — TOUTE inscription passe désormais par
  // /auth/register-verified, qui exige un jeton de vérification email (OTP).
  /** @returns {Promise<object>} {user, token...} compte créé. */
  register: (userData) => api.post('/auth/register-verified', userData),
  /** @returns {Promise<object>} {user, token...} compte créé. */
  signup: (userData) => api.post('/auth/register-verified', userData),
  /** @returns {Promise<object>} {user, token...} compte créé. */
  registerVerified: (userData) => api.post('/auth/register-verified', userData),
  /** @returns {Promise<object>} {user, token, token_expires_at...} session. */
  login: (credentials) => api.post('/auth/login', credentials),
  /** @returns {Promise<object>} {user, token, token_expires_at...} session. */
  signin: (credentials) => api.post('/auth/login', credentials),
  // Déconnexion RÉELLE : révoque le jeton côté serveur (blacklist jti).
  // L'ancien stub `({ success: true })` ne contactait jamais /auth/logout,
  // donc un token volé restait valide 24h même après déconnexion.
  /** @returns {Promise<object>} {success: true} jeton révoqué. */
  logout: async () => api.post('/auth/logout'),
  /** @returns {Promise<object>} {user} profil de l'utilisateur connecté. */
  me: () => api.get('/auth/me'),
  /** @returns {Promise<object>} {user} profil de l'utilisateur connecté. */
  getMe: () => api.get('/auth/me'),
  /** @returns {Promise<object>} {user} profil de l'utilisateur connecté. */
  getProfile: (options = {}) => api.get('/auth/me', options),
  /** @returns {Promise<object>} {user} profil de l'utilisateur connecté. */
  getCurrentUser: (options = {}) => api.get('/auth/me', options),
  /** @returns {Promise<object>} {user, country} profil avec pays mis à jour. */
  updateCountry: (payload) => api.patch('/auth/me/country', payload),
  // Google SSO : le frontend envoie le code d'autorisation (jamais l'id_token).
  /** @returns {Promise<object>} {user, token...} session Google. */
  googleAuth: (payload) => api.post('/auth/google', payload),
  /** @returns {Promise<object>} {user, token...} compte lié à Google. */
  googleLink: (payload) => api.post('/auth/google/link', payload),
  // Email verification methods
  /** @returns {Promise<object>} {email, available, message}. */
  checkEmailAvailability: (payload) => api.post('/auth/email/check-availability', payload),
  /** @returns {Promise<object>} {success: true, otp_sent_to...}. */
  sendEmailOtp: (payload) => api.post('/auth/email/send-otp', payload),
  /** @returns {Promise<object>} {success: true, otp_sent_to...}. */
  resendEmailOtp: (payload) => api.post('/auth/email/resend-otp', payload),
  /** @returns {Promise<object>} {valid: true} ou {valid: false, message}. */
  verifyEmailOtp: (payload) => api.post('/auth/email/verify-otp', payload),
  // Password reset methods
  /** @returns {Promise<object>} {success: true, otp_sent_to...}. */
  requestPasswordResetOtp: (payload) => api.post('/auth/password/forgot/request', payload),
  /** @returns {Promise<object>} {success: true, otp_sent_to...}. */
  resendPasswordResetOtp: (payload) => api.post('/auth/password/forgot/resend', payload),
  /** @returns {Promise<object>} {valid: true} ou {valid: false, message}. */
  verifyPasswordResetOtp: (payload) => api.post('/auth/password/forgot/verify', payload),
  /** @returns {Promise<object>} {success: true} mot de passe réinitialisé. */
  resetPassword: (payload) => api.post('/auth/password/reset', payload),
};
export const notificationAPI = {
  /** @returns {Promise<object>} {notifications, unread_count}. */
  getAll: (params = {}) => api.get('/notifications', { params }),
  /** @returns {Promise<object>} {unread_count} compteur non-lus. */
  getUnreadCount: () => api.get('/notifications/unread-count'),
  /** @returns {Promise<object>} {vapid_public_key} clé VAPID publique. */
  getVapidPublicKey: () => api.get('/notifications/vapid-public-key'),
  /** @returns {Promise<object>} {success: true} notification marquée lue. */
  markRead: (notificationId) => api.put(`/notifications/${notificationId}/read`),
  /** @returns {Promise<object>} {success: true} toutes lues. */
  markAllRead: () => api.put('/notifications/mark-all-read'),
  /** @returns {Promise<object>} {success: true} notification supprimée. */
  deleteOne: (notificationId) => api.delete(`/notifications/${notificationId}`),
  /** @returns {Promise<object>} {success: true} toutes supprimées. */
  deleteAll: () => api.delete('/notifications'),
  /** @returns {Promise<object>} {success: true} push token enregistré. */
  registerPushToken: (payload) => api.post('/users/push-token', payload),
};
export const notificationsAPI = notificationAPI;
export const geolocationAPI = {
  /** @returns {Promise<object>} {detected, country...} ou {detected: false}. */
  detect: (params) => api.get('/geolocation/detect', { params }),
  /** @returns {Promise<Array<object>>} pays disponibles. */
  getAvailableCountries: () => api.get('/geolocation/available-countries'),
};

export default api;
