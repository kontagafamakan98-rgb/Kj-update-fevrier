/**
 * Analytics — le tag GA4 est DÉCLARÉ dans le HTML mais publié hors du chemin
 * critique : après `load`, puis `GA_PUBLICATION_DELAY_MS`, puis le premier
 * temps mort.
 *
 * Ce que ces cas empêchent, dans l'ordre de l'histoire :
 *   1. que le chargement redevienne immédiat — sous bridage 4G, la balise
 *      `async` du `<head>` était la requête la plus lente de chaque page et
 *      décidait du LCP (mesuré le 20/09/2026) ; le script doit donc être ABSENT
 *      juste après `initAnalytics()` ;
 *   2. que le tag reparte « dès `load` » — il retombait alors dans la fenêtre de
 *      blocage (FCP → TTI) et y dépensait ses ~190 + ~123 ms de script, soit
 *      213 des 260 ms de TBT mobile mesurés le 24/09/2026.
 *
 * Les deux premiers cas sont donc aussi importants l'un que l'autre : « pas au
 * chargement » ET « pas juste après `load` ».
 *
 * Environnement jsdom (défaut du projet) : `document` et `window` existent.
 * jsdom n'a pas `requestIdleCallback`, donc le repli `setTimeout` est le chemin
 * exercé (c'est aussi celui de Safari) — d'où les minuteurs simulés, qui
 * couvrent un délai de plusieurs secondes sans faire attendre la suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GA_PUBLICATION_DELAY_MS } from '../analytics.js';

const GA_ID = 'G-TEST123456';
const GA_SRC = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;

const declareGa = (src = GA_SRC) => {
  const tag = document.createElement('script');
  tag.type = 'text/plain';
  tag.setAttribute('data-kojo-ga-src', src);
  document.head.appendChild(tag);
};

const injected = () => document.querySelector('script[src*="googletagmanager.com/gtag/js"]');

// Le délai de publication est celui du module (une seule source) : le test ne
// recopie pas « 6000 », sinon il continuerait de passer après un changement de
// valeur qui, lui, déplacerait le tag.
const publierLeTag = () => vi.advanceTimersByTime(GA_PUBLICATION_DELAY_MS);

const init = async () => {
  const { initAnalytics } = await import('../analytics.js');
  initAnalytics();
};

// Les vues publiées dans la file (`gtag('event', 'page_view', …)`).
const vues = () =>
  (window.dataLayer || [])
    .map((appel) => Array.from(appel))
    .filter(([commande, evenement]) => commande === 'event' && evenement === 'page_view');

describe('initAnalytics — GA4 chargé hors du chemin critique', () => {
  beforeEach(() => {
    vi.resetModules();
    // Minuteurs simulés : le délai de publication est de plusieurs secondes,
    // on l'avance au lieu de l'attendre.
    vi.useFakeTimers();
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', GA_ID);
    document.head.innerHTML = '';
    delete window.dataLayer;
    delete window.gtag;
    delete window.requestIdleCallback;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('ne charge PAS le script au chargement, et met le config en file', async () => {
    declareGa();
    await init();

    // Le point du diff : rien n'est injecté tant que la page n'a pas fini.
    expect(injected(), 'le script GA ne doit pas être injecté immédiatement').toBeNull();
    // La file est en revanche prête : le config ne se perd pas à l'arrivée du
    // script (sinon GA ne verrait aucune vue).
    const appels = window.dataLayer.map((args) => Array.from(args));
    expect(appels.some(([commande, id]) => commande === 'config' && id === GA_ID)).toBe(true);
  });

  it('n’injecte RIEN juste après `load` : le tag attend le délai de publication', async () => {
    declareGa();
    await init();

    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(1000);

    // C'est le point du correctif du 24/09/2026 : « après load » laissait le tag
    // s'exécuter PENDANT la fenêtre de blocage (FCP → TTI).
    expect(injected(), 'le tag ne doit pas partir dès `load`').toBeNull();
  });

  it('injecte le script APRÈS le chargement et le délai, avec l’adresse DÉCLARÉE', async () => {
    declareGa();
    await init();

    window.dispatchEvent(new Event('load'));
    publierLeTag();

    const tag = injected();
    expect(tag, 'le script GA doit être injecté après load + délai').not.toBeNull();
    expect(tag.src).toBe(GA_SRC);
    expect(tag.async).toBe(true);
  });

  it('n’injecte rien sans déclaration (dev), même si la variable est posée', async () => {
    // En dev, le plugin de build ne tourne pas : aucune déclaration, donc
    // aucun tag — comme avant, où la balise n'existait qu'au build.
    await init();
    window.dispatchEvent(new Event('load'));
    publierLeTag();

    expect(injected()).toBeNull();
  });

  it('n’injecte le script qu’une fois si `load` survient deux fois', async () => {
    declareGa();
    await init();

    window.dispatchEvent(new Event('load'));
    window.dispatchEvent(new Event('load'));
    publierLeTag();

    expect(document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]')).toHaveLength(1);
  });
});

/**
 * Page vue SPA : UNE par navigation, et avec le titre de la page d'ARRIVÉE.
 *
 * Mesuré en production le 25/10/2026 dans un `POST /g/collect` : la vue de
 * `/messages` portait `dt=Emplois disponibles · Kojo`. La vue partait sur
 * `pushState`, donc avant que la page d'arrivée ne pose son titre. Ces cas
 * tiennent les trois propriétés qui rendent la mesure exploitable : le bon
 * moment (après le titre), une seule vue par navigation, et aucune vue perdue
 * pour les pages qui ne déclarent pas de titre.
 */
describe('page vue SPA — le bon titre, une seule fois', () => {
  let module;
  // `initAnalytics` POSE un relais sur `history.pushState`. Chaque cas importe
  // un module NEUF : sans restaurer les méthodes d'origine, les relais
  // s'empileraient d'un cas à l'autre et une seule navigation publierait
  // plusieurs vues — le test mesurerait alors sa propre accumulation.
  const pourStateOrigine = window.history.pushState;
  const remplaceStateOrigine = window.history.replaceState;

  const restaurerHistory = () => {
    window.history.pushState = pourStateOrigine;
    window.history.replaceState = remplaceStateOrigine;
  };

  beforeEach(async () => {
    vi.resetModules();
    restaurerHistory();
    vi.useFakeTimers();
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', GA_ID);
    document.head.innerHTML = '';
    delete window.dataLayer;
    delete window.gtag;
    delete window.requestIdleCallback;
    window.history.replaceState({}, '', '/');
    document.title = 'Kojo';
    module = await import('../analytics.js');
    module.initAnalytics();
  });

  afterEach(() => {
    restaurerHistory();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("n'envoie pas la vue d'arrivée avant que la page n'ait posé son titre", () => {
    // À cet instant, le document porte encore le titre statique d'index.html :
    // publier maintenant, c'est publier « Kojo » pour toutes les pages.
    expect(vues()).toHaveLength(0);

    document.title = 'Messages · Kojo';
    expect(module.notifierTitreDePage()).toBe(true);

    expect(vues()).toHaveLength(1);
    expect(vues()[0][2]).toMatchObject({
      page_path: '/',
      page_title: 'Messages · Kojo',
    });
  });

  it('publie la vue après la navigation avec l’URL ET le titre de la page d’arrivée', () => {
    module.notifierTitreDePage(); // la vue d'arrivée (test précédent)

    window.history.pushState({}, '', '/messages');
    // La navigation seule ne publie RIEN : le titre de la page d'arrivée
    // n'existe pas encore (c'est exactement le défaut mesuré).
    expect(vues()).toHaveLength(1);

    document.title = 'Messages · Kojo';
    module.notifierTitreDePage();

    expect(vues()).toHaveLength(2);
    expect(vues()[1][2]).toMatchObject({ page_path: '/messages', page_title: 'Messages · Kojo' });

    // Le repli ne republie pas la même navigation.
    vi.advanceTimersByTime(module.TRACKED_TITLE_FALLBACK_MS);
    expect(vues()).toHaveLength(2);
  });

  it('le repli publie une page privée qui ne déclare aucun titre', () => {
    // `/dashboard`, `/create-job`, `/administration`… ne posent pas de titre :
    // les priver de vue serait une perte de mesure, pas une correction.
    vi.advanceTimersByTime(module.TRACKED_TITLE_FALLBACK_MS);

    expect(vues()).toHaveLength(1);

    window.history.pushState({}, '', '/dashboard');
    vi.advanceTimersByTime(module.TRACKED_TITLE_FALLBACK_MS);

    expect(vues()).toHaveLength(2);
    expect(vues()[1][2].page_path).toBe('/dashboard');
  });

  it('deux navigations rapprochées ne publient que la dernière', () => {
    window.history.pushState({}, '', '/jobs');
    window.history.pushState({}, '', '/messages');

    document.title = 'Messages · Kojo';
    module.notifierTitreDePage();
    // Le repli de la navigation ANNULÉE (/jobs) ne doit pas publier en plus.
    vi.advanceTimersByTime(module.TRACKED_TITLE_FALLBACK_MS);

    expect(vues()).toHaveLength(1);
    expect(vues()[0][2].page_path).toBe('/messages');
  });

  it('ne publie aucune vue sans mesure configurée', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', '');
    // Un second module, sans identifiant : `initAnalytics` ne pose pas `gtag`.
    delete window.gtag;
    delete window.dataLayer;
    vi.resetModules();
    return import('../analytics.js').then((sansGa) => {
      sansGa.initAnalytics();
      sansGa.notifierTitreDePage();
      vi.advanceTimersByTime(sansGa.TRACKED_TITLE_FALLBACK_MS);
      expect(window.dataLayer).toBeUndefined();
    });
  });
});
