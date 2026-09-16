/**
 * Sentry — monitoring d'erreurs production (OPTIONNEL, désactivé par défaut).
 *
 * Activer dans l'environnement Vercel :
 *   VITE_SENTRY_ENABLED=true
 *   VITE_SENTRY_DSN=https://<dsn>@sentry.io/<project>
 *
 * Sans ces variables, toutes les fonctions sont des no-op et RIEN n'est
 * installé (aucun écouteur, aucun téléchargement).
 *
 * ── 1. QUAND le SDK est chargé : après la première interaction ─────────────
 * `initSentryOnInteraction()` (appelée au boot depuis src/index.js) n'installe
 * d'abord que des écouteurs passifs très légers, et ne télécharge le SDK
 * qu'au premier `pointerdown` / `keydown` / `touchstart`, ou après un repli
 * temporisé pour les sessions qui n'interagissent jamais.
 *
 * Le SDK ne peut donc plus entrer en concurrence avec le premier rendu
 * (parse HTML → CSS → boot React → LCP) : sur une connexion 3G/4G, ces
 * dizaines de kilo-octets n'occupent plus la bande passante pendant que la
 * page se peint.
 *
 * ── 2. Les erreurs du début de session ne sont pas perdues ─────────────────
 * Contrepartie assumée : entre le boot et le déclencheur, le SDK n'est pas
 * initialisé. `installEarlyErrorBuffer()` comble exactement ce trou : les
 * `error` et `unhandledrejection` de la fenêtre sont mis en tampon (au plus
 * EARLY_BUFFER_MAX, pour qu'une boucle d'erreurs ne mange pas la mémoire) puis
 * rejoués dans `captureException` dès que l'init a abouti.
 *
 * Seule fenêtre de perte réelle, à connaître : une session qui n'interagit
 * JAMAIS et dont la page est fermée AVANT le repli temporisé. C'est le prix du
 * report, et c'est ce que le repli réduit.
 *
 * ── 3. POURQUOI cette forme d'import ──────────────────────────────────────
 * Chaque fonction fait `const { x } = await import('@sentry/react')` :
 * destructuration AU SITE D'APPEL, sur l'import dynamique. Deux mesures de
 * build ont dicté cette forme (chunk `vendor-sentry`) :
 *
 *   • Garder l'espace de noms et lire ses propriétés ailleurs
 *     (`const Sentry = await getSdk(); Sentry.init(...)`) empêche Rollup de
 *     voir ce qui est utilisé : le chunk embarque TOUT le SDK — 482 715 o brut
 *     / 159 751 o gzip, le plus gros chunk du build, y compris
 *     `replayIntegration`, `feedbackIntegration`, `Profiler` et
 *     `createReduxEnhancer`, que ce projet n'appelle jamais.
 *   • Passer par un module intermédiaire qui ré-exporte statiquement ces noms
 *     (`import('./sentrySdk')`) réduit bien le chunk (86 387 o / 29 291 o) mais
 *     casse le chargement différé : Rollup INLINE la façade dans le chunk
 *     d'entrée, qui importe alors le SDK STATIQUEMENT — mesuré : `vendor-sentry`
 *     préchargé par index.html, JS initial de 98,8 → 127,6 Ko (budget 130) et
 *     téléchargé même quand Sentry est DÉSACTIVÉ.
 *
 * La destructuration au site d'appel garde les deux propriétés : chunk à
 * 87 044 o brut / 29 538 o gzip (−82 %) ET import toujours dynamique.
 */

// Événements considérés comme « l'utilisateur a commencé à se servir de la
// page ». Tous passifs : ils ne retardent ni ne modifient l'interaction.
const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart'];

// Repli pour les sessions sans interaction (lecture seule, page laissée
// ouverte…). Sans lui, une telle session n'enverrait jamais AUCUNE erreur.
export const FALLBACK_INIT_MS = 10000;

// Borne le tampon : une erreur qui se répète en boucle ne doit pas croître
// indéfiniment avant l'init.
export const EARLY_BUFFER_MAX = 20;

let _started = false;
let _pendingErrors = [];
let _onEarlyError = null;
let _onEarlyRejection = null;

const hasWindow = () => typeof window !== 'undefined' && !!window.addEventListener;

const isSentryEnabled = () => {
  if (typeof import.meta === 'undefined' || !import.meta.env) return false;
  return (
    import.meta.env.VITE_SENTRY_ENABLED === 'true'
    && !!import.meta.env.VITE_SENTRY_DSN
  );
};

/**
 * Met en tampon les erreurs de la fenêtre survenues AVANT l'initialisation du
 * SDK. Une fois l'init faite, ces erreurs sont rejouées (voir flushEarlyErrors)
 * et les écouteurs sont RETIRÉS (removeEarlyErrorBuffer) : après l'init, c'est
 * le SDK qui installe ses propres gestionnaires globaux, et garder les nôtres
 * ferait grossir un tampon que plus rien ne vide.
 */
function installEarlyErrorBuffer() {
  if (!hasWindow()) return;
  _onEarlyError = (event) => {
    if (_pendingErrors.length < EARLY_BUFFER_MAX) {
      _pendingErrors.push(event.error || event.message);
    }
  };
  _onEarlyRejection = (event) => {
    if (_pendingErrors.length < EARLY_BUFFER_MAX) {
      _pendingErrors.push(event.reason);
    }
  };
  window.addEventListener('error', _onEarlyError);
  window.addEventListener('unhandledrejection', _onEarlyRejection);
}

/** Retire les écouteurs du tampon précoce (idempotent). */
function removeEarlyErrorBuffer() {
  if (!hasWindow()) return;
  if (_onEarlyError) window.removeEventListener('error', _onEarlyError);
  if (_onEarlyRejection) window.removeEventListener('unhandledrejection', _onEarlyRejection);
  _onEarlyError = null;
  _onEarlyRejection = null;
}

/**
 * Rejoue les erreurs tamponnées dans le SDK, une fois celui-ci initialisé.
 * Le tampon est vidé avant l'envoi : si `captureException` échoue, on ne
 * rejoue pas indéfiniment les mêmes erreurs.
 *
 * @returns {Promise<number>} nombre d'erreurs rejouées
 */
export async function flushEarlyErrors() {
  const errors = _pendingErrors;
  _pendingErrors = [];
  if (!errors.length) return 0;
  const { captureException } = await import('@sentry/react');
  for (const error of errors) captureException(error);
  return errors.length;
}

/**
 * Installe le chargement différé du SDK : écouteurs d'interaction + repli
 * temporisé + tampon des erreurs précoces. Idempotente, et no-op (sans rien
 * installer) si Sentry n'est pas configuré.
 *
 * @param {object} [options]
 * @param {number} [options.fallbackMs] Délai du repli (injectable pour les tests).
 * @returns {boolean} true si le report est armé, false si désactivé/déjà armé
 */
export function initSentryOnInteraction({ fallbackMs = FALLBACK_INIT_MS } = {}) {
  if (_started || !isSentryEnabled()) return false;
  _started = true;
  installEarlyErrorBuffer();

  let timer = null;
  let started = false;
  const start = () => {
    // Garde EXPLICITE : ne pas déduire « déjà démarré » de l'identifiant de
    // minuteur — un handle nul ou réinitialisé faisait sortir la fonction en
    // silence (défaut trouvé par le test du repli temporisé, qui ne chargeait
    // alors rien).
    if (started) return;
    started = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    for (const eventName of INTERACTION_EVENTS) {
      window.removeEventListener(eventName, start);
    }
    // L'échec de chargement ne doit pas casser la page (réseau coupé, CSP…) :
    // on retire les écouteurs dans tous les cas, la page ne doit pas accumuler
    // un tampon que plus personne ne consomme.
    void initSentry()
      .then(flushEarlyErrors)
      .then(removeEarlyErrorBuffer)
      .catch(removeEarlyErrorBuffer);
  };

  if (hasWindow()) {
    for (const eventName of INTERACTION_EVENTS) {
      window.addEventListener(eventName, start, { once: true, passive: true });
    }
    timer = setTimeout(start, fallbackMs);
  }
  return true;
}

export async function initSentry() {
  if (!isSentryEnabled()) return;
  const { init } = await import('@sentry/react');
  init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE || 'production',
    // 10% des transactions seulement (économie de quota, cf. guide)
    tracesSampleRate: 0.1,
    // Erreurs réseau 2G/3G courantes et erreurs non-critiques : ignorées
    ignoreErrors: [
      'Network Error',
      'Failed to fetch',
      'Load failed',
      'ResizeObserver loop',
      'SecurityError',
      'QuotaExceededError',
      'push service not available',
      'Registration failed - push service not available',
    ],
  });
}

export async function captureError(error, context = {}) {
  if (!isSentryEnabled()) return;
  const { captureException } = await import('@sentry/react');
  captureException(error, { extra: context });
}

export async function captureMessage(message, level = 'info') {
  if (!isSentryEnabled()) return;
  const { captureMessage: sendMessage } = await import('@sentry/react');
  sendMessage(message, level);
}

export async function setUser(user) {
  if (!isSentryEnabled() || !user) return;
  // PRIVACITÉ : on n'envoie JAMAIS d'identifiants personnels (email, nom,
  // téléphone) à Sentry — uniquement l'identifiant interne et le pays, pour
  // pouvoir diagnostiquer sans exposer de PII (même politique que le backend
  // avec send_default_pii=False).
  const { setUser: setSentryUser } = await import('@sentry/react');
  setSentryUser({
    id: user.id,
    country: user.country,
  });
}

export async function addBreadcrumb(message, category = 'general', level = 'info', data = {}) {
  if (!isSentryEnabled()) return;
  const { addBreadcrumb: add } = await import('@sentry/react');
  add({ message, category, level, data });
}
