/**
 * Sentry Configuration for Error Tracking
 * 
 * Configuration désactivée par défaut.
 * Pour activer Sentry en production:
 * 1. Installer le package: yarn add @sentry/react
 * 2. Créer un compte sur https://sentry.io
 * 3. Obtenir votre DSN
 * 4. Définir REACT_APP_SENTRY_DSN dans le fichier .env
 * 5. Définir REACT_APP_SENTRY_ENABLED=true dans le fichier .env
 */

import { devLog } from './env';

// Configuration Sentry
const SENTRY_CONFIG = {
  enabled: process.env.REACT_APP_SENTRY_ENABLED === 'true',
  dsn: process.env.REACT_APP_SENTRY_DSN || '',
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: 0.1, // 10% des transactions
  release: process.env.REACT_APP_VERSION || '1.0.0',
  
  // Options spécifiques pour l'Afrique de l'Ouest
  beforeSend(event, hint) {
    // Filtrer les erreurs de connexion réseau (communes en 2G/3G)
    if (event.exception) {
      const errorMessage = event.exception.values?.[0]?.value || '';
      
      // Ignorer les erreurs réseau courantes
      if (
        errorMessage.includes('Network request failed') ||
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('timeout')
      ) {
        devLog.info('Sentry: Ignored network error');
        return null;
      }
    }
    
    return event;
  },
  
  // Ignorer certaines erreurs
  ignoreErrors: [
    'Non-Error exception captured',
    'Non-Error promise rejection captured',
    'ResizeObserver loop limit exceeded',
    'SecurityError'
  ]
};

/**
 * Initialiser Sentry
 * Cette fonction doit être appelée dans index.js
 */
export function initSentry() {
  if (!SENTRY_CONFIG.enabled) {
    devLog.info('📊 Sentry désactivé - pour activer, définir REACT_APP_SENTRY_ENABLED=true');
    return;
  }

  if (!SENTRY_CONFIG.dsn) {
    devLog.warn('⚠️ Sentry activé mais DSN manquant - vérifier REACT_APP_SENTRY_DSN');
    return;
  }

  try {
    // Note: Cette importation échouera si @sentry/react n'est pas installé
    // C'est normal - Sentry est optionnel
    const Sentry = require('@sentry/react');
    
    Sentry.init({
      dsn: SENTRY_CONFIG.dsn,
      environment: SENTRY_CONFIG.environment,
      tracesSampleRate: SENTRY_CONFIG.tracesSampleRate,
      release: SENTRY_CONFIG.release,
      beforeSend: SENTRY_CONFIG.beforeSend,
      ignoreErrors: SENTRY_CONFIG.ignoreErrors,
      
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      
      // Enregistrer les breadcrumbs pour le débogage
      maxBreadcrumbs: 50,
      
      // Paramètres de performance
      tracePropagationTargets: [
        'localhost',
        /^\//,
        process.env.REACT_APP_BACKEND_URL
      ].filter(Boolean),
    });

    devLog.info('✅ Sentry initialisé avec succès');
    
    // Définir le contexte utilisateur si disponible
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        Sentry.setUser({
          id: user.id,
          email: user.email,
          country: user.country
        });
      } catch (e) {
        // Ignore
      }
    }
  } catch (error) {
    devLog.info('ℹ️ Sentry non installé - installer avec: yarn add @sentry/react');
  }
}

/**
 * Capturer une erreur manuellement
 */
export function captureError(error, context = {}) {
  if (!SENTRY_CONFIG.enabled) {
    devLog.error('Error:', error, context);
    return;
  }

  try {
    const Sentry = require('@sentry/react');
    Sentry.captureException(error, {
      contexts: { custom: context }
    });
  } catch (e) {
    devLog.error('Error:', error, context);
  }
}

/**
 * Capturer un message
 */
export function captureMessage(message, level = 'info') {
  if (!SENTRY_CONFIG.enabled) {
    devLog[level] ? devLog[level](message) : devLog.info(message);
    return;
  }

  try {
    const Sentry = require('@sentry/react');
    Sentry.captureMessage(message, level);
  } catch (e) {
    devLog[level] ? devLog[level](message) : devLog.info(message);
  }
}

/**
 * Définir le contexte utilisateur
 */
export function setUser(user) {
  if (!SENTRY_CONFIG.enabled) return;

  try {
    const Sentry = require('@sentry/react');
    Sentry.setUser({
      id: user.id,
      email: user.email,
      country: user.country,
      user_type: user.user_type
    });
  } catch (e) {
    // Ignore
  }
}

/**
 * Effacer le contexte utilisateur
 */
export function clearUser() {
  if (!SENTRY_CONFIG.enabled) return;

  try {
    const Sentry = require('@sentry/react');
    Sentry.setUser(null);
  } catch (e) {
    // Ignore
  }
}

/**
 * Ajouter un breadcrumb personnalisé
 */
export function addBreadcrumb(message, category = 'custom', level = 'info', data = {}) {
  if (!SENTRY_CONFIG.enabled) return;

  try {
    const Sentry = require('@sentry/react');
    Sentry.addBreadcrumb({
      message,
      category,
      level,
      data,
      timestamp: Date.now() / 1000
    });
  } catch (e) {
    // Ignore
  }
}

export default {
  initSentry,
  captureError,
  captureMessage,
  setUser,
  clearUser,
  addBreadcrumb,
  enabled: SENTRY_CONFIG.enabled
};
