// Analytics Plausible — chargé depuis un module bundlé (pas de script inline,
// pour rester compatible avec la CSP production `script-src 'self'`).
//
// Le script externe https://plausible.io/js/script.js est ajouté au DOM
// uniquement si VITE_PLAUSIBLE_DOMAIN est défini (variables Vercel). Sans
// config, cette fonction est un no-op : aucune requête, aucune erreur console.
// Le domaine plausible.io est ajouté à script-src dans vite.config.js
// UNIQUEMENT quand VITE_PLAUSIBLE_DOMAIN est défini.

export const initAnalytics = () => {
  if (typeof document === 'undefined') return;
  const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN;
  if (!domain) return;

  // Évite un double chargement si la fonction est appelée plusieurs fois
  if (document.querySelector('script[data-kojo-plausible]')) return;

  const script = document.createElement('script');
  script.async = true;
  script.defer = true;
  script.setAttribute('data-domain', domain);
  script.setAttribute('data-kojo-plausible', '1');
  script.src = 'https://plausible.io/js/script.js';
  document.head.appendChild(script);
};
