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
