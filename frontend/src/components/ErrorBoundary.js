import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { safeLog } from '../utils/env';

// Détecte un échec d'import de chunk « stale » : après un redéploiement
// (Vercel), le navigateur peut encore avoir l'ancien index.html en cache,
// qui référence d'anciens chunks supprimés. Le serveur renvoie alors
// index.html (text/html) au lieu du JS → « Failed to fetch dynamically
// imported module » / « Expected a JavaScript module script ». La bonne
// réponse est de recharger la page une fois pour récupérer le nouvel
// index, pas d'afficher un écran d'erreur.
const isStaleChunkError = (error) => {
  const message = String(error?.message || error || '');
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('Expected a JavaScript module script') ||
    message.includes('error loading dynamically imported module')
  );
};

const RELOAD_KEY = 'kojo_chunk_reload';

class ErrorBoundaryInner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    safeLog.error('Error caught by ErrorBoundary:', error, errorInfo);

    // Chunk stale après redéploiement : recharge une seule fois (garde-fou
    // anti-boucle via sessionStorage), puis laisse le reload normal gérer.
    if (isStaleChunkError(error)) {
      try {
        if (!sessionStorage.getItem(RELOAD_KEY)) {
          sessionStorage.setItem(RELOAD_KEY, '1');
          safeLog.info('Stale chunk detected after redeploy — reloading once to fetch the new bundle.');
          window.location.reload();
          return;
        }
      } catch (storageError) {
        // sessionStorage indisponible : on recharge quand même une fois.
        safeLog.warn('sessionStorage unavailable, reloading once anyway.', storageError);
        window.location.reload();
        return;
      }
    }
  }

  render() {
    const { t } = this.props;
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
            <div className="text-6xl mb-4">😵</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">{t('unexpectedErrorTitle')}</h2>
            <p className="text-gray-600 mb-4">{t('unexpectedErrorText')}</p>
            <button onClick={() => window.location.reload()} className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors">{t('refreshPage')}</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ErrorBoundary(props) {
  const { t } = useLanguage();
  return <ErrorBoundaryInner {...props} t={t} />;
}
