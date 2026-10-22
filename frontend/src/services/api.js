// Construction d'URL : source de vérité unique dans ../utils/backendUrl
// (buildApiUrl). Ne PAS réimplémenter la dérivation de base ici — bug réel
// historique de double préfixe /api/api quand deux helpers normalisent
// différemment la même variable d'environnement.
import { buildApiUrl } from '../utils/backendUrl';
import { safeLog } from '../utils/env';

// Identifiant de requête publié par le backend (`X-Request-ID`) : il relie une
// réponse à SES lignes de journal. Le backend l'EXPOSE en CORS (server.py,
// `expose_headers`) — sans cette exposition, l'en-tête arriverait et resterait
// illisible ici, donc inutile au support.
const ENTETE_REQUETE = 'X-Request-ID';

/**
 * En-tête de corrélation d'une réponse, ou chaîne vide.
 *
 * @param {Response} response Réponse du backend.
 * @returns {string}
 */
const identifiantDeRequete = (response) => {
  try {
    return String(response?.headers?.get?.(ENTETE_REQUETE) || '').trim();
  } catch (_error) {
    // En-têtes illisibles (réponse opaque, proxy qui les masque) : un incident
    // sans identifiant reste un incident.
    return '';
  }
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

// Le web ne lit JAMAIS de jeton dans le stockage du navigateur : la session y
// est le seul cookie httpOnly. Un jeton n'existe en stockage que dans le shell
// natif (Capacitor), dont la WebView n'a pas de cookie de session fiable.
export const isNativeShell = () => typeof window !== 'undefined'
  && Boolean(window.Capacitor?.isNativePlatform?.());

export const getAuthToken = () => {
  if (!isNativeShell()) return '';

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

// Deux pannes n'apportent AUCUN message du serveur à montrer : une coupure de
// transport (hors ligne, DNS, CORS, serveur injoignable) — `fetch` rejette un
// TypeError dont le texte est ANGLAIS et technique (« Failed to fetch »,
// « Load failed ») — et une réponse SANS message utilisable (corps vide, JSON
// sans detail, ou page d'erreur HTML d'un proxy : du balisage). Dans les deux
// cas, ce que les pages affichaient était du texte technique — la phrase du
// navigateur, « HTTP 502 », ou `<!DOCTYPE html>…` — au milieu d'un écran
// français, précisément quand quelque chose va mal. La frontière remplace donc
// le texte par la copie du produit (ces deux constantes, dont les tests
// vérifient qu'elles recopient bien les clés i18n publiées) et marque l'erreur
// `hasServerMessage = false` : la page qui sait traduire passe son propre repli
// à `handleApiError`, qui a alors la priorité.
export const TRANSPORT_FAILURE_MESSAGE = 'Erreur de connexion. Vérifiez votre connexion internet.';
export const SERVER_FAILURE_MESSAGE = 'Une erreur inattendue s’est produite. Veuillez rafraîchir la page.';

const HTML_OU_PROLOGUE = /^\s*(<!doctype|<html|<\?xml|<[a-z!/])/i;

// Un corps n'est un message pour l'utilisateur que s'il en est un : une page
// d'erreur HTML est du balisage, pas une phrase — l'afficher remplissait le
// bandeau d'erreur de balises.
const messageUtilisable = (payload) => {
  if (typeof payload === 'string') {
    const texte = payload.trim();
    return !texte || HTML_OU_PROLOGUE.test(texte) ? '' : texte;
  }
  if (!payload || typeof payload !== 'object') return '';
  return extractErrorMessage(payload, '');
};

export const handleApiError = (error, fallback = 'Une erreur est survenue') => {
  // Panne sans message du serveur : c'est le repli — traduit par la page — qui
  // doit s'afficher.
  if (error?.hasServerMessage === false || error?.response?.status >= 500) return fallback;

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

// Marqueur de session, SANS donnée personnelle : il dit seulement « une
// connexion a eu lieu dans ce navigateur », et c'est le signal d'amorçage du
// web (voir `hasSessionArtifact` plus bas pour le pourquoi et l'historique).
// Déclaré ICI parce que `AUTH_STORAGE_KEYS` le référence : une constante
// déclarée plus bas lèverait un ReferenceError (TDZ) au chargement du module.
export const SESSION_TRACE_KEY = 'kojo_session_trace';

// Clés de session auth purgeables en cas de 401 — dans localStorage ET
// sessionStorage (getAuthToken lit les deux buckets, la purge doit donc
// couvrir les deux, sinon un token stocké en sessionStorage survivait au
// 401 et l'app restait bloquée en boucle de redirection).
const AUTH_STORAGE_KEYS = [
  'token', 'token_expires_at', 'user', SESSION_TRACE_KEY,
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

    // Le 401 peut venir d'un JETON PÉRIMÉ en stockage (shell natif, mode
    // hybride) alors que la session vit encore côté serveur : on purge le
    // stockage — les appels suivants repartent sans en-tête — mais on NE
    // redirige PAS, car rien localement ne prouve que la session est morte.
    // Le jugement porte sur ce qui peut être périmé (le stockage), jamais sur
    // la lisibilité d'un cookie : elle n'existe pas cross-site, et deux modes
    // doivent rendre le même verdict. Sur le web, aucun jeton n'est stocké :
    // un 401 y signifie donc session morte, et la redirection suit.
    const staleToken = Boolean(getAuthToken());
    purge('localStorage');
    purge('sessionStorage');
    if (staleToken) return;
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
// ré-échoquer le jeton CSRF dans l'en-tête X-CSRFToken (protection CSRF
// double-submit).
//
// Ce lecteur sert à l'ÉCHO CSRF, jamais à juger une session : sa lisibilité
// dépend de l'hôte qui a posé le cookie (même-origine = lisible, cross-site =
// rangé sur l'hôte de l'API, donc invisible). Aucune décision de session ne
// doit en dépendre — c'est le contrat de hasSessionTrace ci-dessous.
const CSRF_COOKIE_NAME = 'kojo_csrf';

const readCsrfCookie = () => {
  if (csrfTokenMemory) return csrfTokenMemory;
  if (typeof document === 'undefined' || !document.cookie) return '';
  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${CSRF_COOKIE_NAME}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE_NAME.length + 1)) : '';
};

// TRACE NON SECRÈTE DE SESSION — le SEUL signal d'amorçage du web.
//
// Ce n'est ni un jeton ni une preuve : c'est un MARQUEUR (`'1'`), sans aucune
// donnée personnelle, posé par une connexion réussie. Il ne sert qu'à décider
// s'il vaut la peine de poser la question au serveur (/auth/me) ; jamais à
// afficher quoi que ce soit (un profil n'est montré que sur un 200).
//
// POURQUOI UN MARQUEUR ET PLUS LE PROFIL (20/10/2026). La trace était le
// profil lui-même (`'user'`, nom + email + téléphone) réécrit à CHAQUE
// amorçage : c'est-à-dire des données personnelles au repos dans le navigateur,
// pour la seule utilité de savoir qu'il faut sonder. Le marqueur dit la même
// chose sans rien dire de la personne — le profil vit désormais en mémoire, et
// sur le natif seulement en cache (qui a besoin d'un affichage hors-ligne).
//
// COMPATIBILITÉ : un `'user'` laissé par une version antérieure reste une
// trace valable jusqu'à sa purge (le démarrage le retire, cf.
// `AuthContext.purgerProfilWebPersistant`), donc une session en cours ne se
// perd pas à la mise à jour.
//
// INVARIANT : la trace est purgée par les MÊMES chemins que la session —
// clearToken (logout) et la purge de handleUnauthorized (401) — toutes deux
// couvrent la clé via AUTH_STORAGE_KEYS. Une trace qui survivrait à la mort de
// la session ferait sonder /auth/me à chaque chargement, indéfiniment.
export const hasSessionArtifact = () => {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (localStorage.getItem(SESSION_TRACE_KEY)) return true;
    // Vestige d'une version antérieure (profil persisté) : encore une trace,
    // le temps que le démarrage le remplace par le marqueur.
    return Boolean(localStorage.getItem('user'));
  } catch (_error) {
    // Stockage indisponible (navigation privée) : aucune trace lisible.
    return false;
  }
};

/**
 * Y a-t-il une raison de demander au serveur si une session vit ?
 *
 * Le juge est LOCAL et ne consulte AUCUN cookie :
 *   • le jeton du shell natif (getAuthToken — toujours '' sur le web) ;
 *   • la trace de profil ci-dessus.
 *
 * Pourquoi jamais le cookie : le cookie de session est httpOnly, donc
 * illisible par nature, et son compagnon CSRF n'est lisible QUE si le
 * navigateur l'a rangé sur l'origine de la page — vrai en même-origine, faux
 * en cross-site. Juger la session sur cette lisibilité, c'était avoir deux
 * comportements pour un même état serveur : en production cross-site, l'app se
 * déclarait anonyme après chaque F5 alors que le cookie vivait toujours et
 * renvoyait /login à un utilisateur connecté (mesuré par
 * scripts/check-session-reload-production.js). Un seul signal, un seul
 * verdict, quel que soit l'hôte qui porte les cookies.
 *
 * Contrepartie assumée : un navigateur dont le stockage local est vidé (mais
 * dont le cookie de session vit encore) est invité à se reconnecter. Sonder
 * sans aucune trace coûterait un 401 à CHAQUE visiteur anonyme — accueil et
 * crawlers compris — ce que ce dépôt a explicitement refusé.
 *
 * @returns {boolean} Vrai s'il faut poser la question au serveur.
 */
export const hasSessionTrace = () => Boolean(getAuthToken()) || hasSessionArtifact();

/**
 * Nomme une PANNE serveur dans la console, avec son identifiant de requête.
 *
 * Seul un 5xx est journalisé : les 4xx sont des RÉSULTATS (mot de passe
 * refusé, doublon, quota) que les pages traitent déjà, et les journaliser
 * noierait le seul cas où le support a besoin de retrouver la requête dans
 * les journaux du serveur. Le chemin est journalisé sans query string : une
 * URL peut porter un jeton.
 *
 * @param {string} method Méthode HTTP.
 * @param {string} path Chemin appelé (sans paramètres).
 * @param {number} status Statut de la réponse.
 * @param {string} requete Identifiant de requête publié par le backend.
 */
const signalerPanneServeur = (method, path, status, requete) => {
  if (status < 500) return;
  safeLog.error(
    `[api] ${method} ${path} → ${status}` +
      (requete ? ` (requête ${requete})` : ' (aucun identifiant de requête)')
  );
};

const request = async (method, path, { params, data, headers, signal, skipUnauthorizedRedirect = false, skipRecovery = false, sessionProbe = false, withHeaders = false } = {}) => {
  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path || ''}`;
  const url = `${buildApiUrl(normalizedPath)}${buildQueryString(params)}`;
  const token = getAuthToken();
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData;
  const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  const csrfToken = readCsrfCookie();

  let response;
  try {
    response = await fetch(url, {
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
  } catch (cause) {
    // Une annulation VOLONTAIRE n'est pas une panne : elle garde son identité
    // (name === 'AbortError'), donc les appelants continuent de la distinguer
    // d'un vrai échec.
    if (cause?.name === 'AbortError') throw cause;

    const error = new Error(TRANSPORT_FAILURE_MESSAGE);
    error.hasServerMessage = false;
    error.cause = cause;
    throw error;
  }

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
  // Côté web, le backend re-pose le cookie httpOnly dans la même réponse : rien
  // à stocker. Seul le shell natif garde un jeton en stockage.
  const rotatedToken = response.headers?.get?.('X-Kojo-Token');
  if (rotatedToken && isNativeShell()) {
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
    // QUI PEUT ÊTRE RÉCUPÉRÉ, ET AVEC QUEL JETON EN MAIN :
    //   • un 401 (jeton périmé en stockage, shell natif) n'est récupérable que
    //     s'il y avait un jeton à remplacer ;
    //   • un 403 CSRF l'est SANS jeton stocké — et c'est nécessaire sur le web,
    //     qui n'en a aucun par construction. Le backend ne vérifie le CSRF que
    //     pour une requête authentifiée PAR LE COOKIE (kojo_auth_core.py,
    //     _verify_csrf), donc ce 403 PROUVE qu'une session vivait à l'instant du
    //     refus : rien d'autre n'aurait pu produire ce refus.
    //     L'exiger d'un jeton rendait la récupération impossible sur le web :
    //     après un rechargement, la seule façon d'obtenir un CSRF devenait de
    //     LIRE le cookie kojo_csrf — lisible seulement quand le navigateur l'a
    //     rangé sur l'origine de la page, jamais en cross-site. La session
    //     restaurée était alors inutilisable (toute écriture en 403) dans la
    //     topologie même que la production connaît. La sonde /auth/me (GET, donc
    //     exempte de CSRF) rétablit la session et le middleware ré-échoit
    //     X-Kojo-CSRFToken, que le rejeu renvoie — sans lire document.cookie, et
    //     sans écrire aucun jeton en stockage.
    const canRecover = (isAuthFailure || isCsrfFailure)
      && (Boolean(token) || isCsrfFailure)
      && !skipRecovery
      && normalizedPath !== '/auth/me'
      && !BUSINESS_401_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));

    if (canRecover) {
      const recovered = await recoverSession(
        method, normalizedPath,
        { params, data, headers, signal, skipUnauthorizedRedirect, withHeaders }
      );
      if (recovered !== RECOVERY_FAILED) return recovered;
    }

    // Une SONDE (sessionProbe) ne juge pas et ne purge pas : elle rapporte.
    // Sans cela, le 401 de la sonde vidait le stockage AVANT que l'appelant ne
    // tranche, et l'appelant — jugeant sur un stockage déjà vide — croyait à une
    // session morte alors qu'un simple jeton périmé pouvait être toute la
    // cause. Le seul juge reste donc l'appel qui a échoué.
    if (response.status === 401 && !sessionProbe) {
      handleUnauthorized(normalizedPath, { redirect: !skipUnauthorizedRedirect });
    }

    const messageDuServeur = messageUtilisable(payload);
    const requete = identifiantDeRequete(response);

    if (!messageDuServeur) {
      // Le statut brut (« HTTP 502 ») n'est pas une phrase du produit : la page
      // affiche SA copie, et `message` en porte une par défaut pour celles qui
      // lisent directement `error.message`.
      const error = new Error(SERVER_FAILURE_MESSAGE);
      error.hasServerMessage = false;
      error.response = { status: response.status, data: {}, requestId: requete };
      signalerPanneServeur(method, normalizedPath, response.status, requete);
      throw error;
    }

    const error = new Error(messageDuServeur);
    error.response = {
      status: response.status,
      data: typeof payload === 'string' ? { detail: messageDuServeur } : payload,
      requestId: requete,
    };
    signalerPanneServeur(method, normalizedPath, response.status, requete);
    throw error;
  }

  // `withHeaders` : quelques routes publient une MESURE dans un en-tête (le
  // nombre de missions d'un filtre, `X-Total-Count`). Le corps reste ce que les
  // appelants lisent déjà — la forme par défaut ne change donc pas — et un
  // appelant qui demande les en-têtes reçoit les deux.
  return withHeaders ? { data: payload, headers: response.headers } : payload;
};

/**
 * Récupération de session après un 401 (token expiré) ou un 403 CSRF : la
 * session réelle peut encore vivre dans le cookie httpOnly (ou la mémoire CSRF
 * est périmée). Sonde /auth/me (sessionProbe : ni purge, ni redirection, ni
 * récursion — une sonde rapporte, elle ne juge pas), puis REJOUE la requête
 * originale avec le jeton/CSRF rafraîchis. Renvoie RECOVERY_FAILED si la
 * session est réellement morte : l'appel d'origine garde alors la main, purge
 * le stockage, et ne navigue que si aucun jeton n'était en cause.
 *
 * Le cas du WEB est le 403 CSRF : il n'y a AUCUN jeton en stockage, et ce refus
 * prouve pourtant qu'une session cookie vivait (le backend ne vérifie le CSRF
 * que pour une requête authentifiée par cookie). La sonde rétablit la session et
 * ré-échoit X-Kojo-CSRFToken ; le rejeu s'en sert. La récupération ne dépend donc
 * ni d'un jeton stocké, ni de la lisibilité de kojo_csrf depuis l'origine
 * frontend — les deux n'existent pas sur le web cross-site.
 */
const recoverSession = async (method, path, options) => {
  // Single-flight PARTAGÉ : si une sonde est déjà en cours (ou vient de
  // finir), on attend la MÊME promesse au lieu d'échouer immédiatement.
  if (!sessionRecoveryPromise) {
    sessionRecoveryPromise = request('GET', '/auth/me', {
      skipUnauthorizedRedirect: true,
      skipRecovery: true,
      sessionProbe: true,
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
