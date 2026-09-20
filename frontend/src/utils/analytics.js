// Analytics — deux fournisseurs, tous deux OPTIONNELS et sans script inline
// (la CSP production est `script-src 'self'` : un `<script>` inline serait
// bloqué avec une erreur console).
//
// 1. Plausible : le script externe https://plausible.io/js/script.js est
//    ajouté au DOM seulement si VITE_PLAUSIBLE_DOMAIN est défini.
// 2. Google Analytics 4 : l'adresse du tag
//    https://www.googletagmanager.com/gtag/js?id=… est DÉCLARÉE dans le HTML
//    STATIQUE au build (plugin inject-seo-extras de vite.config.js) dès que
//    VITE_GA_MEASUREMENT_ID est défini — un crawler sans JavaScript la voit
//    donc, et la sonde SEO de production la détecte. Le script lui-même n'est
//    pas exécuté au chargement : c'est ICI, après `load` ou au premier temps
//    mort, qu'il est injecté depuis cette déclaration. Sous bridage 4G, une
//    balise `async` dans le `<head>` retardait le chunk critique et décidait du
//    LCP (mesuré le 20/09/2026) ; la file `dataLayer`, elle, est prête
//    immédiatement, donc les `gtag('config')`/`page_view` émis entre-temps sont
//    traités à l'arrivée du script. Le `gtag('config')` est émis ici (pas
//    d'inline) et un événement page_view est renvoyé à chaque navigation SPA
//    (sinon GA ne verrait que l'accueil : react-router ne recharge pas la page).
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

/**
 * Adresse du tag GA4 telle que le HTML servi la DÉCLARE, ou `''`.
 *
 * Lue sur la déclaration (`data-kojo-ga-src`) plutôt que reconstruite depuis
 * la variable d'environnement : c'est la déclaration que la sonde SEO vérifie,
 * donc charger une autre adresse ferait diverger le script chargé du tag
 * audité. En dev, le plugin de build ne tourne pas : aucune déclaration, donc
 * aucun tag — comme avant, où la balise statique n'existait qu'au build.
 */
export const gaScriptUrlFrom = (doc = typeof document === 'undefined' ? null : document) => {
  const declared = doc?.querySelector('script[data-kojo-ga-src]');
  return normalize(declared?.getAttribute('data-kojo-ga-src'));
};

const injectGaScript = (src) => {
  if (document.querySelector('script[src*="googletagmanager.com/gtag/js"]')) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
};

// Hors du chemin critique : après `load`, ou au premier temps mort s'il vient
// plus tôt. `requestIdleCallback` absent (Safari) → `setTimeout`, jamais un
// chargement synchrone.
const loadGaScriptAfterLoad = (src) => {
  const charger = () => injectGaScript(src);
  const planifier = () =>
    typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(charger, { timeout: 3000 })
      : window.setTimeout(charger, 0);
  if (document.readyState === 'complete') planifier();
  else window.addEventListener('load', planifier, { once: true });
};

const initGoogleAnalytics = (measurementId) => {
  // La file d'attente est prête AVANT tout réseau : les commandes émises ici
  // sont traitées quand le script arrive (il est chargé après `load`).
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

  // Le tag déclaré par le HTML est chargé hors du chemin critique.
  const src = gaScriptUrlFrom();
  if (src) loadGaScriptAfterLoad(src);

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
