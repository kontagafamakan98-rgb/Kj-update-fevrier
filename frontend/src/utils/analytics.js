// Analytics — deux fournisseurs, tous deux OPTIONNELS et sans script inline
// (la CSP production est `script-src 'self'` : un `<script>` inline serait
// bloqué avec une erreur console).
//
// 1. Plausible : le script externe https://plausible.io/js/script.js est
//    ajouté au DOM seulement si VITE_PLAUSIBLE_DOMAIN est défini.
// 2. Google Analytics 4 : la balise externe
//    https://www.googletagmanager.com/gtag/js?id=… est injectée dans le HTML
//    STATIQUE au build (plugin inject-seo-extras de vite.config.js) dès que
//    VITE_GA_MEASUREMENT_ID est défini — un crawler sans JavaScript la voit
//    donc, ce qu'un script ajouté par le bundle ne permet pas. C'est ICI, dans
//    le module bundlé, que le `gtag('config')` est émis (pas d'inline), et un
//    événement page_view est renvoyé à chaque navigation SPA (sinon GA ne
//    verrait que l'accueil : react-router ne recharge pas la page).
//
// Aucun identifiant n'est codé en dur : sans variable d'environnement, ces
// fonctions sont des no-op stricts (aucune requête, aucune erreur console).

const normalize = (value) => String(value || '').trim();

const isEnabled = (value) => normalize(value).length > 0;

export const getGaMeasurementId = () =>
  normalize(import.meta.env?.VITE_GA_MEASUREMENT_ID);

export const getPlausibleDomain = () =>
  normalize(import.meta.env?.VITE_PLAUSIBLE_DOMAIN);

const initPlausible = (domain) => {
  if (document.querySelector('script[data-kojo-plausible]')) return;
  const script = document.createElement('script');
  script.async = true;
  script.defer = true;
  script.setAttribute('data-domain', domain);
  script.setAttribute('data-kojo-plausible', '1');
  script.src = 'https://plausible.io/js/script.js';
  document.head.appendChild(script);
};

// Page vue SPA : GA4 n'envoie qu'un page_view au chargement initial ;
// react-router change l'URL sans recharger, donc sans ce relais les vues
// suivantes seraient perdues (les rapports ne montreraient que l'accueil).
const trackGaPageView = () => {
  if (typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_location: window.location.href,
    page_path: `${window.location.pathname}${window.location.search}`,
    page_title: document.title,
  });
};

const initGoogleAnalytics = (measurementId) => {
  // gtag.js est chargé par la balise statique du HTML ; on prépare juste la
  // file d'attente si elle n'est pas encore initialisée (le script peut
  // arriver après le boot React — async).
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments);
    };
  }
  window.gtag('js', new Date());
  // send_page_view: false — le premier page_view est envoyé explicitement
  // ci-dessous, comme les suivants, pour n'avoir qu'un seul chemin de code.
  window.gtag('config', measurementId, { send_page_view: false });
  trackGaPageView();

  const wrap = (type) => {
    const original = window.history[type];
    window.history[type] = function patched(...args) {
      const result = original.apply(this, args);
      window.setTimeout(trackGaPageView, 0);
      return result;
    };
  };
  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', trackGaPageView);
};

export const initAnalytics = () => {
  if (typeof document === 'undefined') return;

  const plausibleDomain = getPlausibleDomain();
  if (isEnabled(plausibleDomain)) {
    initPlausible(plausibleDomain);
  }

  const measurementId = getGaMeasurementId();
  if (isEnabled(measurementId)) {
    initGoogleAnalytics(measurementId);
  }
};
