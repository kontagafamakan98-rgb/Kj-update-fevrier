// LA VUE DE PAGE — le planificateur, et RIEN d'autre.
//
// ── Pourquoi ce module existe (30/10/2026) ───────────────────────────────────
// `utils/analytics.js` portait deux choses : le planificateur de vue de page
// (utile à TOUTES les navigations, sans fournisseur) et l'INJECTION des trois
// fournisseurs (Plausible, GA4, PostHog), qui ne sert QUE sur consentement.
// Les deux vivaient dans le même fichier, importé statiquement par `utils/seo.js`
// (`notifierTitreDePage`) — donc toute la machinerie d'injection était dans le
// JS INITIAL, y compris pour un visiteur qui n'a jamais accepté la mesure.
//
// Mesuré : `npx esbuild src/utils/analytics.js --bundle --minify` = 1 501 o
// gzip, dont le planificateur ci-dessous est une petite part. Le budget du JS
// initial (135 Ko) n'avait plus que 0,8 Ko de marge, et l'audit du 30/10 l'a
// relevé à 135,5 Ko — au-dessus. La cause n'est pas PostHog (le SDK est servi
// par `eu-assets.i.posthog.com`, hors bundle) mais ce couplage.
//
// Ce module n'importe RIEN : il ne parle qu'à `window`. C'est ce qui permet à
// `analytics.js` de n'être chargé qu'au moment de l'injection
// (`import()` dans `index.js` et dans `ConsentBanner.js`).
//
// Ce qui reste immuable ici : une seule vue par navigation, et le titre de la
// page d'ARRIVÉE (voir le commentaire de `planifierVueDePage`).

/**
 * Délai maximal d'attente du titre de la page d'arrivée avant de publier.
 *
 * Borné, et assumé : une page dont le chunk ou les données arrivent après ce
 * délai publie sa vue avec le titre précédent. Attendre indéfiniment ferait
 * perdre la vue (une visite de trois secondes n'en aurait aucune), ce qui est
 * un défaut plus grave que le titre d'une page privée.
 */
export const TRACKED_TITLE_FALLBACK_MS = 2000;

// Une seule vue par navigation : planifier annule la précédente.
let vueEnAttente = 0;

/**
 * Une vue PostHog est-elle encore à publier pour la navigation courante ?
 *
 * Le SDK de PostHog arrive APRÈS la décision de consentement (un clic sur le
 * bandeau, ou le module chargé au boot pour un visiteur qui a déjà accepté) et
 * donc après le premier planificateur : la vue d'arrivée peut être planifiée
 * AVANT que `window.posthog` n'existe. Sans ce drapeau, elle serait perdue en
 * silence — c'est le même défaut que la vue de `/messages` partie avec le titre
 * de la page précédente, mais côté fournisseur.
 */
let vuePosthogEnAttente = false;

/** Publie la vue de la route COURANTE, maintenant, avec le titre courant. */
const trackGaPageView = () => {
  if (typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_location: window.location.href,
    page_path: `${window.location.pathname}${window.location.search}`,
    page_title: document.title,
  });
};

/**
 * Publie la vue PostHog si le SDK est là, et une seule fois par navigation.
 *
 * @returns {boolean} vrai si une vue a été envoyée.
 */
const capturerVuePosthog = () => {
  if (!vuePosthogEnAttente) return false;
  const sdk = window.posthog;
  if (!sdk || typeof sdk.capture !== 'function') return false;
  sdk.capture('$pageview', { $current_url: window.location.href });
  vuePosthogEnAttente = false;
  return true;
};

/** Publie la vue courante pour TOUS les fournisseurs configurés. */
const publierVueCourante = () => {
  trackGaPageView();
  capturerVuePosthog();
};

/** Planifie la vue de la route qui vient d'être atteinte (voir ci-dessus). */
const planifierVueDePage = () => {
  window.clearTimeout(vueEnAttente);
  // La navigation courante doit une vue à PostHog aussi : elle sera publiée par
  // `publierVueCourante`, ou par l'arrivée du SDK (voir `initPosthog`).
  vuePosthogEnAttente = true;
  vueEnAttente = window.setTimeout(() => {
    vueEnAttente = 0;
    publierVueCourante();
  }, TRACKED_TITLE_FALLBACK_MS);
};

/**
 * La page d'arrivée vient de poser son titre : publie la vue planifiée.
 *
 * Appelée par `usePageTitle` (utils/seo.js), APRÈS `document.title = …`, et
 * sans effet quand aucune navigation n'est en attente — un titre posé plus tard
 * (données d'une fiche) ne crée donc pas une seconde vue.
 *
 * @returns {boolean} vrai si une vue a été publiée.
 */
export const notifierTitreDePage = () => {
  if (!vueEnAttente) return false;
  window.clearTimeout(vueEnAttente);
  vueEnAttente = 0;
  publierVueCourante();
  return true;
};

/**
 * Le relais de navigation SPA, posé UNE fois quel que soit le fournisseur.
 *
 * Il vivait dans `initGoogleAnalytics` : avec PostHog seul configuré, aucune
 * navigation n'aurait été vue après la première page. Le relais ne publie rien
 * lui-même — il PLANIFIE la vue, et `publierVueCourante` la donne à qui est
 * présent.
 */
let relaisDeNavigationInstalle = false;

export const installerRelaisDeNavigation = () => {
  if (relaisDeNavigationInstalle) return;
  relaisDeNavigationInstalle = true;
  const wrap = (type) => {
    const original = window.history[type];
    window.history[type] = function patched(...args) {
      const result = original.apply(this, args);
      planifierVueDePage();
      return result;
    };
  };
  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', planifierVueDePage);
};

/**
 * Planifie la vue d'une page qui vient de s'afficher.
 *
 * Appelée par `initAnalytics` (utils/analytics.js) : c'est le seul module qui
 * connaît les fournisseurs, et il déclenche la vue d'ARRIVÉE ici pour qu'elle
 * attende le titre comme toutes les suivantes.
 */
export const planifierVueDePageCourante = () => planifierVueDePage();

/** Publie tout de suite la vue planifiée, si le SDK vient d'arriver. */
export const publierVueSiEnAttente = () => capturerVuePosthog();
