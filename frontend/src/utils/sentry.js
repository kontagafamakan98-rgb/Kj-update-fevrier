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
import * as Sentry from '@sentry/react';

const isSentryEnabled = () => {
  if (typeof import.meta === 'undefined' || !import.meta.env) return false;
  return (
    import.meta.env.VITE_SENTRY_ENABLED === 'true'
    && !!import.meta.env.VITE_SENTRY_DSN
  );
};

export function initSentry() {
  if (!isSentryEnabled()) return;
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

export function captureError(error, context = {}) {
  if (!isSentryEnabled()) return;
  Sentry.captureException(error, { extra: context });
}

export function captureMessage(message, level = 'info') {
  if (!isSentryEnabled()) return;
  Sentry.captureMessage(message, level);
}

export function setUser(user) {
  if (!isSentryEnabled() || !user) return;
  // PRIVACITÉ : on n'envoie JAMAIS d'identifiants personnels (email, nom,
  // téléphone) à Sentry — uniquement l'identifiant interne et le pays, pour
  // pouvoir diagnostiquer sans exposer de PII (même politique que le backend
  // avec send_default_pii=False).
  Sentry.setUser({
    id: user.id,
    country: user.country,
  });
}

export function addBreadcrumb(message, category = 'general', level = 'info', data = {}) {
  if (!isSentryEnabled()) return;
  Sentry.addBreadcrumb({ message, category, level, data });
}
