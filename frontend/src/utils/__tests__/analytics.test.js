/**
 * Analytics — le tag GA4 est DÉCLARÉ dans le HTML mais chargé hors du chemin
 * critique (après `load`, ou au premier temps mort).
 *
 * Ce que ces cas empêchent : que le chargement redevienne immédiat. Sous
 * bridage 4G, la balise `async` du `<head>` était la requête la plus lente de
 * chaque page et décidait du LCP (mesuré le 20/09/2026). Le script doit donc
 * être ABSENT juste après `initAnalytics()`, et présent seulement une fois
 * `load` passé — avec l'adresse que le HTML déclare, pas une reconstruite.
 *
 * Environnement jsdom (défaut du projet) : `document` et `window` existent.
 * jsdom n'a pas `requestIdleCallback`, donc le repli `setTimeout` est le chemin
 * exercé (c'est aussi celui de Safari).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const GA_ID = 'G-TEST123456';
const GA_SRC = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;

const declareGa = (src = GA_SRC) => {
  const tag = document.createElement('script');
  tag.type = 'text/plain';
  tag.setAttribute('data-kojo-ga-src', src);
  document.head.appendChild(tag);
};

const injected = () => document.querySelector('script[src*="googletagmanager.com/gtag/js"]');

const flush = () => new Promise((resolve) => window.setTimeout(resolve, 0));

const init = async () => {
  const { initAnalytics } = await import('../analytics.js');
  initAnalytics();
};

describe('initAnalytics — GA4 chargé hors du chemin critique', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', GA_ID);
    document.head.innerHTML = '';
    delete window.dataLayer;
    delete window.gtag;
    delete window.requestIdleCallback;
  });

  afterEach(() => {
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

  it('injecte le script APRÈS le chargement, avec l’adresse DÉCLARÉE', async () => {
    declareGa();
    await init();

    window.dispatchEvent(new Event('load'));
    await flush();

    const tag = injected();
    expect(tag, 'le script GA doit être injecté après load').not.toBeNull();
    expect(tag.src).toBe(GA_SRC);
    expect(tag.async).toBe(true);
  });

  it('n’injecte rien sans déclaration (dev), même si la variable est posée', async () => {
    // En dev, le plugin de build ne tourne pas : aucune déclaration, donc
    // aucun tag — comme avant, où la balise n'existait qu'au build.
    await init();
    window.dispatchEvent(new Event('load'));
    await flush();

    expect(injected()).toBeNull();
  });

  it('n’injecte le script qu’une fois si `load` survient deux fois', async () => {
    declareGa();
    await init();

    window.dispatchEvent(new Event('load'));
    window.dispatchEvent(new Event('load'));
    await flush();

    expect(document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]')).toHaveLength(1);
  });
});
