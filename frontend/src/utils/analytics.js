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

//
// ── CE MODULE N'EST PLUS DANS LE JS INITIAL (30/10/2026) ────────────────────
// Il est chargé par `import()` au moment de l'injection : depuis `index.js`
// pour un visiteur qui a DÉJÀ accepté, depuis `ConsentBanner.js` au clic
// « Accepter ». Ce qui devait rester immédiatement disponible a déménagé dans
// deux modules SANS dépendance lourde :
//   • `mesure-audience.js` — les LECTURES de configuration et
//     `isAnalyticsConfigured`, que le bandeau interroge à chaque rendu ;
//   • `vue-de-page.js` — le planificateur de vue, que `utils/seo.js` appelle à
//     CHAQUE navigation, consentement ou non.
// La conséquence mesurée : 1,5 Ko gzip sortis du chemin critique (budget du JS
// initial : 135 Ko, marge tombée à zéro sur l'audit du 30/10). Ce module ne doit
// donc plus être importé statiquement par un fichier du shell —
// `scripts/check-bundle-size.js` le dirait (JS initial au-dessus du budget),
// mais le dire ici évite d'avoir à le découvrir.

import { hasAnalyticsConsent } from './consent';
import { POSTHOG_API_HOST, POSTHOG_SCRIPT_URL, estClePosthog } from '../config/posthog';
import {
  getGaMeasurementId,
  getPlausibleDomain,
  getPosthogKey,
  isEnabled,
} from './mesure-audience';
import {
  installerRelaisDeNavigation,
  planifierVueDePageCourante,
  publierVueSiEnAttente,
} from './vue-de-page';

// La surface publique d'avant reste SERVIE par ce module : les tests et
// `scripts/check-funnel-events.js` nomment `notifierTitreDePage` au même endroit
// qu'hier, et le planificateur est une seule instance (`vue-de-page.js`), donc
// seo.js et ce relais parlent bien de la même vue en attente.
export { isAnalyticsConfigured, getGaMeasurementId, getPlausibleDomain, getPosthogKey } from './mesure-audience';
export { notifierTitreDePage, TRACKED_TITLE_FALLBACK_MS } from './vue-de-page';

// La normalisation reste LOCALE : elle sert ici à lire l'adresse du tag GA4
// déclarée par le HTML servi (voir `gaScriptUrlFrom`), pas à décider si un
// fournisseur est configuré — c'est `mesure-audience.js` qui le décide.
const normalize = (value) => String(value || '').trim();

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

// ── Page vue SPA : le planificateur a DÉMÉNAGÉ (voir l'en-tête) ─────────────
// `vue-de-page.js` porte la vue de la page d'ARRIVÉE — une seule par
// navigation, publiée quand la page pose son titre ou au bout de
// `TRACKED_TITLE_FALLBACK_MS`. La raison du déménagement n'est pas la propreté :
// `utils/seo.js` (appelé à CHAQUE navigation, consentement ou non) importait ce
// fichier pour `notifierTitreDePage`, donc toute l'injection ci-dessous partait
// dans le JS initial. Ce module-ci est désormais chargé par `import()`.

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
  planifierVueDePageCourante();

  // Le tag déclaré par le HTML est chargé hors du chemin critique.
  const src = gaScriptUrlFrom();
  if (src) loadGaScriptAfterLoad(src);

  installerRelaisDeNavigation();
};

// Le relais de navigation SPA est installé par `vue-de-page.js`
// (`installerRelaisDeNavigation`, importé ci-dessus) : il PLANIFIE la vue,
// il n'en publie aucune.

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
  // ── NI FLAGS, NI CONFIGURATION DISTANTE (29/10/2026) ────────────────────
  // Mesuré sur la production, consentement donné, console OUVERTE (navigation
  // vers `/` puis `/metiers/plomberie`) : QUATRE erreurs, toutes pour des
  // choses que ce produit n'utilise pas —
  //   • `POST https://eu.i.posthog.com/flags/?v=2&compression=base64` → 401 ;
  //   • `GET https://eu-assets.i.posthog.com/array/<clé>/config.js` → 404 ;
  //   • puis le REPLI du SDK vers `/array/<clé>/config` (JSON), que
  //     `connect-src` refuse — `eu-assets` n'y est ouvert que pour
  //     `script-src` — d'où DEUX erreurs CSP (« Refused to connect »).
  // Aucune de ces requêtes ne porte une vue : la capture, elle, part sur
  // `/e/` en 200. Le site n'a ni feature flag ni configuration distante : le
  // SDK les demandait par défaut, et leur échec était le seul bruit.
  //
  // `advanced_disable_flags` est le commutateur du SDK lui-même (l'ancien nom,
  // `advanced_disable_decide`, est déprécié et migré vers celui-ci). Vérifié
  // dans le bundle : le `load()` de l'extension `remote-config` sort par
  // `Qu()` — qui lit cette option — en publiant « Remote config is disabled.
  // Falling back to local config. », donc le `config.js` n'est même pas
  // demandé, et la requête de flags ne part plus. Une seule option coupe les
  // deux ; aucune politique CSP n'est élargie pour faire taire une erreur
  // qu'il suffisait de ne pas provoquer.
  advanced_disable_flags: true,
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
  planifierVueDePageCourante();

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
      publierVueSiEnAttente();
    },
    { once: true }
  );
  document.head.appendChild(script);
};

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
