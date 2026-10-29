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
//    pas exécuté au chargement : c'est ICI, après `load` PUIS le délai de
//    publication ci-dessous, qu'il est injecté depuis cette déclaration. Sous
//    bridage 4G, une balise `async` dans le `<head>` retardait le chunk
//    critique et décidait du LCP (mesuré le 20/09/2026) ; la file `dataLayer`,
//    elle, est prête immédiatement, donc les `gtag('config')`/`page_view` émis
//    entre-temps sont traités à l'arrivée du script. Le `gtag('config')` est
//    émis ici (pas d'inline) et un événement page_view est renvoyé à chaque
//    navigation SPA (sinon GA ne verrait que l'accueil : react-router ne
//    recharge pas la page).
//
// ── Pourquoi un DÉLAI, et pas « après load ou au premier temps mort » ──────
// « Après `load` » suffisait tant que seul le LCP comptait : le tag ne pouvait
// plus retarder le plus grand peintre. Il restait néanmoins chargé PENDANT la
// fenêtre de blocage (FCP → TTI), et là il en décidait : mesuré le 24/09/2026
// sous le preset mobile (4× CPU + 4G simulés) sur le build de production, le
// tag produit DEUX tâches longues, ~190 ms puis ~123 ms, soit 213 des 260 ms de
// TBT — 82 % du « Poor interactivity » réclamé par l'audit, pour un script qui
// n'a AUCUNE fonction dans la page. Le plancher les place après l'instant où la
// page devient interactive (TTI mesuré 4 480-4 610 ms sur mobile bridé, ~750 ms
// sur desktop), donc hors de la fenêtre ; le temps mort est demandé ENSUITE,
// jamais avant, pour que le tag ne saisisse pas le premier trou de la fenêtre.
//
// Ce que ce délai coûte, dit franchement : une visite qui se termine avant lui
// ne publie pas sa page vue (les commandes restent dans `dataLayer` sans script
// pour les envoyer). Il est donc court — une seule seconde de plus que l'instant
// où la page devient interactive sur le matériel le plus lent mesuré — et il ne
// concerne que les rebonds de quelques secondes.
//
// 3. PostHog : son SDK (`POSTHOG_SCRIPT_URL`, Cloud EU) est ajouté au DOM
//    seulement si `VITE_POSTHOG_KEY` porte la FORME d'une clé de projet
//    (`phc_…`). Comme Plausible, c'est un script tiers — mais il parle ensuite
//    à son hôte d'ingestion, donc la CSP ouvre DEUX directives (voir
//    `src/config/csp.js`, qui lit les mêmes constantes que ce module).
//
// Pourquoi PostHog ne capture PAS de lui-même : `capture_pageview: false` —
// la vue est publiée par le MÊME planificateur que GA, donc avec le titre de
// la page d'ARRIVÉE et une seule fois par navigation (le défaut mesuré le
// 25/10/2026 sur GA, où la vue partait sur `pushState` avec le titre de la
// page précédente). `autocapture` et l'enregistrement de session sont éteints :
// le consentement recueilli porte sur la MESURE D'AUDIENCE, pas sur
// l'enregistrement du parcours ni sur la capture de chaque clic — les activer
// ici étendrait la finalité sans que personne ne l'ait accepté. `persistence`
// est `localStorage` pour la même raison : le produit ne pose aucun cookie
// tiers (cf. utils/consent.js).
//
// Aucun identifiant n'est codé en dur : sans variable d'environnement, ces
// fonctions sont des no-op stricts (aucune requête, aucune erreur console).

import { hasAnalyticsConsent } from './consent';
import {
  POSTHOG_API_HOST,
  POSTHOG_SCRIPT_URL,
  estClePosthog,
} from '../config/posthog';

const normalize = (value) => String(value || '').trim();

const isEnabled = (value) => normalize(value).length > 0;

export const getGaMeasurementId = () =>
  normalize(import.meta.env?.VITE_GA_MEASUREMENT_ID);

export const getPlausibleDomain = () =>
  normalize(import.meta.env?.VITE_PLAUSIBLE_DOMAIN);

/**
 * La clé de projet PostHog lue au build, ou `''`.
 *
 * Rendue BRUTE (normalisée) et non validée : c'est `estClePosthog` qui décide
 * si elle est utilisable, au même endroit que la CSP — une clé mal formée ne
 * doit ni ouvrir d'origine, ni charger de script.
 */
export const getPosthogKey = () => normalize(import.meta.env?.VITE_POSTHOG_KEY);

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

// ── Page vue SPA : le titre de la page d'ARRIVÉE, pas celui de la précédente ─
// GA4 n'envoie qu'un page_view au chargement initial ; react-router change
// l'URL sans recharger, donc sans ce relais les vues suivantes seraient perdues
// (les rapports ne montreraient que l'accueil).
//
// Le relais était posé sur `pushState`, donc il partait AVANT que la page
// d'arrivée ne pose son titre : la vue de `/messages` s'appelait « Emplois
// disponibles · Kojo ». Mesuré le 25/10/2026 dans un `POST /g/collect` de
// production (`dl=…/messages`, `dt=Emplois disponibles · Kojo`) : l'URL était
// juste, le titre était celui de la page d'où l'on venait. Deux conséquences —
// un rapport GA qui nomme les pages avec le titre de la précédente, et une vue
// qui part avant même que la route n'existe.
//
// La vue est donc PLANIFIÉE à la navigation, puis publiée par la PREMIÈRE des
// deux issues suivantes :
//   • la page d'arrivée pose son titre (`usePageTitle`, via `notifierTitreDePage`) —
//     c'est le cas de toutes les pages qui en déclarent un ;
//   • à défaut, un repli borné (`TRACKED_TITLE_FALLBACK_MS`) publie la vue avec
//     le titre courant : les pages privées qui ne déclarent aucun titre
//     (`/dashboard`, `/create-job`, `/administration`…) n'ont aucun signal à
//     attendre, et les priver de page vue parce qu'elles ne posent pas de titre
//     serait une perte de mesure, pas une correction.
// Une seule vue par navigation : planifier annule la précédente.
let vueEnAttente = 0;

/**
 * Délai maximal d'attente du titre de la page d'arrivée avant de publier.
 *
 * Borné, et assumé : une page dont le chunk ou les données arrivent après ce
 * délai publie sa vue avec le titre précédent. Attendre indéfiniment ferait
 * perdre la vue (une visite de trois secondes n'en aurait aucune), ce qui est
 * un défaut plus grave que le titre d'une page privée.
 */
export const TRACKED_TITLE_FALLBACK_MS = 2000;

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
 * Une vue PostHog est-elle encore à publier pour la navigation courante ?
 *
 * Le SDK de PostHog arrive APRÈS la décision de consentement (un clic sur le
 * bandeau, ou un module chargé au boot pour un visiteur qui a déjà accepté) et
 * donc après le premier planificateur : la vue d'arrivée peut être planifiée
 * AVANT que `window.posthog` n'existe. Sans ce drapeau, elle serait perdue en
 * silence — c'est le même défaut que la vue de `/messages` partie avec le titre
 * de la page précédente, mais côté fournisseur.
 */
let vuePosthogEnAttente = false;

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

/**
 * Délai minimal entre `load` et la publication du tag GA4 (voir l'en-tête).
 *
 * Une valeur exportée, pas un nombre écrit ici et retapé ailleurs : c'est le
 * seul endroit qui décide QUAND le tag part, et le test l'importe au lieu de le
 * recopier — une constante recopiée finit par diverger de celle qui décide.
 */
export const GA_PUBLICATION_DELAY_MS = 6000;

// Hors du chemin critique : après `load`, PUIS `GA_PUBLICATION_DELAY_MS`, puis
// le premier temps mort (`requestIdleCallback` absent — Safari — → chargement
// direct dans le minuteur). Jamais un chargement synchrone.
const loadGaScriptAfterLoad = (src) => {
  const charger = () => injectGaScript(src);
  const planifier = () => {
    window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(charger, { timeout: 2000 });
        return;
      }
      charger();
    }, GA_PUBLICATION_DELAY_MS);
  };
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
  // send_page_view: false — toutes les page vue passent par ICI, une seule
  // fois chacune, pour n'avoir qu'un seul chemin de code (et un seul endroit
  // où corriger un titre).
  window.gtag('config', measurementId, { send_page_view: false });
  // La vue d'ARRIVÉE est planifiée comme les suivantes : la page monte après
  // `initAnalytics`, donc son titre n'existe pas encore à cet instant.
  planifierVueDePage();

  // Le tag déclaré par le HTML est chargé hors du chemin critique.
  const src = gaScriptUrlFrom();
  if (src) loadGaScriptAfterLoad(src);

  installerRelaisDeNavigation();
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

const installerRelaisDeNavigation = () => {
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
 * Les réglages du SDK PostHog — le périmètre du consentement, écrit ici.
 *
 * Chacun retire quelque chose que le SDK ferait de lui-même : une vue, la
 * capture de chaque clic, l'enregistrement de session, un profil pour un
 * visiteur anonyme, un cookie. Le bandeau demande la MESURE D'AUDIENCE ; le
 * reste demanderait un autre consentement, donc ne s'active pas ici.
 */
//
// ── CES OPTIONS SONT GELÉES, MAIS UNE COPIE EST DONNÉE AU SDK (29/10/2026) ──
// Le gel protège la CONSTANTE de ce module : personne ne peut la modifier en
// place. Il ne protège pas l'appel, et c'est mesuré : le SDK écrit ses valeurs
// par défaut DANS l'objet qu'on lui passe, si bien qu'un objet gelé le fait
// échouer au premier `init` — « Cannot add property debug, object is not
// extensible » (array.js, `_init`), relevé en production le 29/10/2026 : le
// script se chargeait, la console portait l'exception, et AUCUNE vue ne
// partait. `initPosthog` passe donc une COPIE (`{ ...POSTHOG_OPTIONS }`), et le
// test vérifie que l'objet reçu est extensible — une copie gelée referait le
// même silence.
const POSTHOG_OPTIONS = Object.freeze({
  api_host: POSTHOG_API_HOST,
  capture_pageview: false,
  capture_pageleave: false,
  autocapture: false,
  disable_session_recording: true,
  person_profiles: 'identified_only',
  persistence: 'localStorage',
});

/**
 * Charge le SDK PostHog et l'initialise — APRÈS un accord explicite, seulement.
 *
 * Le script est ajouté au DOM (aucun code inline : la CSP du site est
 * `script-src 'self' …`, un init inline serait refusé avec une erreur console).
 * L'initialisation attend `load` du script : c'est à cet instant que
 * `window.posthog` existe, et la vue d'arrivée est publiée là si le
 * planificateur n'a pas pu le faire avant (voir `vuePosthogEnAttente`).
 *
 * @param {string} key Clé de projet (`phc_…`) déjà validée par l'appelant.
 */
const initPosthog = (key) => {
  if (document.querySelector('script[data-kojo-posthog]')) return;
  installerRelaisDeNavigation();
  // La vue d'ARRIVÉE, planifiée comme les suivantes : la page monte après
  // `initAnalytics`, donc son titre n'existe pas encore ici.
  planifierVueDePage();

  const script = document.createElement('script');
  script.async = true;
  script.defer = true;
  script.setAttribute('data-kojo-posthog', '1');
  script.src = POSTHOG_SCRIPT_URL;
  script.addEventListener(
    'load',
    () => {
      if (typeof window.posthog?.init !== 'function') return;
      // COPIE, jamais la constante gelée : le SDK écrit ses défauts dans
      // l'objet reçu (voir le commentaire de POSTHOG_OPTIONS).
      window.posthog.init(key, { ...POSTHOG_OPTIONS });
      // Le planificateur a pu publier la vue d'arrivée AVANT que le SDK
      // n'existe (elle était alors perdue) : le drapeau garantit qu'elle n'est
      // envoyée qu'une fois, et avec l'URL courante.
      capturerVuePosthog();
    },
    { once: true }
  );
  document.head.appendChild(script);
};

/**
 * L'éditeur a-t-il configuré une mesure d'audience ?
 *
 * Sert au BANDEAU de consentement : sans fournisseur configuré, il n'y a rien
 * à demander, donc rien à afficher. Ne dit pas si le chargement est autorisé —
 * c'est `hasAnalyticsConsent()` (utils/consent.js) qui le décide, et
 * `initAnalytics` n'est appelé qu'après un accord explicite.
 */
export const isAnalyticsConfigured = () =>
  isEnabled(getPlausibleDomain()) ||
  isEnabled(getGaMeasurementId()) ||
  estClePosthog(getPosthogKey());

/**
 * Initialise la mesure d'audience SI ET SEULEMENT SI l'utilisateur a accepté.
 *
 * Point d'entrée utilisé par `src/index.js` : le refus (ou l'absence de
 * décision) n'injecte aucun script tiers. Exporté séparément pour que la règle
 * soit testable sans monter l'application entière.
 *
 * @returns {boolean} vrai si l'analytics a été initialisé.
 */
export const initAnalyticsIfConsented = () => {
  if (!hasAnalyticsConsent()) return false;
  initAnalytics();
  return true;
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

  // Une clé de la mauvaise forme n'ouvre rien : la CSP ne l'autorise pas (même
  // prédicat des deux côtés), donc charger le SDK ne servirait qu'à échouer.
  const posthogKey = getPosthogKey();
  if (estClePosthog(posthogKey)) {
    initPosthog(posthogKey);
  }
};
