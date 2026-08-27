/**
 * Sentry — monitoring d'erreurs production (OPTIONNEL, désactivé par défaut).
 *
 * Activer dans l'environnement Vercel :
 *   VITE_SENTRY_ENABLED=true
 *   VITE_SENTRY_DSN=https://<dsn>@sentry.io/<project>
 *
 * Sans ces variables, toutes les fonctions sont des no-op : aucun impact
 * sur le bundle au-delà du package installé.
 */
// @sentry/react est importé DYNAMIQUEMENT (et uniquement si activé) : le
// chunk vendor-sentry (~84 kB / 29 kB gzip) ne fait plus partie du chemin
// critique du boot — il n'est téléchargé que si VITE_SENTRY_ENABLED=true.
let _sentryPromise = null;
const getSentry = () => {
  if (!_sentryPromise) _sentryPromise = import('@sentry/react');
  return _sentryPromise;
};

const isSentryEnabled = () => {
  if (typeof import.meta === 'undefined' || !import.meta.env) return false;
  return (
    import.meta.env.VITE_SENTRY_ENABLED === 'true'
    && !!import.meta.env.VITE_SENTRY_DSN
  );
};

export async function initSentry() {
  if (!isSentryEnabled()) return;
  const Sentry = await getSentry();
  Sentry.init({
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
  const Sentry = await getSentry();
  Sentry.captureException(error, { extra: context });
}

export async function captureMessage(message, level = 'info') {
  if (!isSentryEnabled()) return;
  const Sentry = await getSentry();
  Sentry.captureMessage(message, level);
}

export async function setUser(user) {
  if (!isSentryEnabled() || !user) return;
  // PRIVACITÉ : on n'envoie JAMAIS d'identifiants personnels (email, nom,
  // téléphone) à Sentry — uniquement l'identifiant interne et le pays, pour
  // pouvoir diagnostiquer sans exposer de PII (même politique que le backend
  // avec send_default_pii=False).
  const Sentry = await getSentry();
  Sentry.setUser({
    id: user.id,
    country: user.country,
  });
}

export async function addBreadcrumb(message, category = 'general', level = 'info', data = {}) {
  if (!isSentryEnabled()) return;
  const Sentry = await getSentry();
  Sentry.addBreadcrumb({ message, category, level, data });
}
