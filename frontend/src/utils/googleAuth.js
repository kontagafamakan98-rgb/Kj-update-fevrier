// ============================================================================
// Google Sign-In (SSO) — wrapper du flux Google Identity Services.
//
// Flux : le frontend obtient un CODE d'autorisation (flux serveur avec PKCE,
// ux_mode popup / redirect_uri postmessage) et l'envoie au backend
// (POST /api/auth/google), qui l'échange contre un id_token et vérifie la
// signature + l'audience. Le frontend ne manipule JAMAIS l'id_token.
//
// Le client_id est injecté via VITE_GOOGLE_CLIENT_ID (build) ou
// window.__KOJO_GOOGLE_CLIENT_ID__ (override runtime). Sans client_id,
// le bouton Google est simplement masqué (SSO désactivé).
// ============================================================================

const CLIENT_ID_SOURCES = [
  () => (typeof window !== 'undefined' ? window.__KOJO_GOOGLE_CLIENT_ID__ : ''),
  () => (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_GOOGLE_CLIENT_ID : ''),
  () => (typeof process !== 'undefined' && process.env ? process.env.VITE_GOOGLE_CLIENT_ID : ''),
];

export const getGoogleClientId = () => {
  for (const source of CLIENT_ID_SOURCES) {
    try {
      const value = source();
      if (typeof value === 'string' && value.trim()) return value.trim();
    } catch (_error) {
      // ignore
    }
  }
  return '';
};

export const isGoogleAuthEnabled = () => Boolean(getGoogleClientId());

let scriptPromise = null;

// Charge le script Google Identity Services une seule fois (module partagé).
const loadGsiScript = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Impossible de charger le SDK Google'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
};

/**
 * PRÉCHARGE le SDK Google, à appeler au MONTAGE du bouton Google.
 *
 * ── Pourquoi ce n'est pas un détail (23/10/2026) ────────────────────────────
 * `requestCode()` ouvre une FENÊTRE. Un navigateur n'autorise cette ouverture
 * que pendant l'ACTIVATION de l'utilisateur (le clic), quelques secondes au
 * plus. Le chemin de clic faisait deux chargements réseau AVANT d'y arriver —
 * le module `googleAuth` (import dynamique) puis `https://accounts.google.com/
 * gsi/client` (~100 Ko) — et sur un téléphone en 3G cela dépasse la fenêtre :
 * la fenêtre est bloquée SANS erreur visible, le bouton tourne, et l'utilisateur
 * conclut que « ça ne marche pas ». Mesuré en production : SDK chargé (200) et
 * aucune fenêtre ouverte.
 *
 * Le SDK est donc chargé quand le bouton APPARAÎT, pas quand on le presse.
 * Le repli silencieux est volontaire : une précharge ratée ne doit rien casser,
 * `getGoogleAuthCode` retentera et dira l'erreur à ce moment-là.
 */
export const preloadGoogleAuth = () => {
  if (!isGoogleAuthEnabled()) return Promise.resolve(null);
  return loadGsiScript().catch(() => null);
};

// Erreurs Google qui signifient « l'utilisateur a fermé/refusé » : ce ne sont
// pas des pannes, et les afficher comme telles reprocherait un choix.
const ANNULATIONS = new Set(['access_denied', 'popup_closed_by_user', 'user_cancel', 'cancelled']);

/**
 * Ouvre la popup Google et retourne le CODE d'autorisation (ou null si
 * l'utilisateur annule). Le code est envoyé ensuite au backend.
 */
export const getGoogleAuthCode = async () => {
  if (!isGoogleAuthEnabled()) {
    throw new Error('Connexion Google non configurée');
  }
  const google = await loadGsiScript();
  if (!google?.accounts?.oauth2) {
    throw new Error('SDK Google indisponible');
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const client = google.accounts.oauth2.initCodeClient({
      client_id: getGoogleClientId(),
      scope: 'openid email profile',
      ux_mode: 'popup',
      // En mode popup, Google IGNORE redirect_uri et utilise l'origine de la
      // page appelante comme redirect_uri du code. Le backend reprend cette
      // origine (header Origin) à l'échange — pas d'URL de callback à fournir.
      callback: (response) => {
        if (settled) return;
        settled = true;
        if (response?.code) {
          resolve(response.code);
          return;
        }

        const erreur = String(response?.error || '');
        // Fermeture / refus : `null`, que l'appelant traite comme « annulé »
        // (aucun message d'erreur).
        if (ANNULATIONS.has(erreur)) {
          resolve(null);
          return;
        }
        // Fenêtre bloquée par le navigateur : c'est LE cas muet de production.
        // On le nomme, sinon le bouton tourne et l'utilisateur n'apprend rien.
        if (erreur === 'popup_blocked_by_browser' || erreur === 'popup_failed_to_open') {
          reject(new Error("Votre navigateur a bloqué la fenêtre Google. Autorisez les fenêtres surgissantes pour ce site, puis réessayez."));
          return;
        }
        reject(new Error(response?.error_description || erreur || 'Réponse Google invalide'));
      },
    });

    client.requestCode();
    // Timeout de sécurité : si Google ne répond pas, on libère le Promise.
    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('La connexion Google a expiré'));
      }
    }, 120000);
  });
};
