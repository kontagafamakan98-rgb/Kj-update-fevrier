// Le point de conformité : AUCUN script tiers avant un accord explicite.
//
// Ce test porte sur le point d'entrée réellement appelé par `src/index.js`
// (`initAnalyticsIfConsented`) : il ne suffit pas que le bandeau existe, il
// faut que le chargement en dépende. Le fournisseur est configuré ici
// (`VITE_PLAUSIBLE_DOMAIN`) : sans lui, l'absence de script ne prouverait rien.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONSENT_STORAGE_KEY, CONSENT_GRANTED } from '../consent';

const scriptPlausible = () => document.querySelector('script[data-kojo-plausible]');

describe('initAnalyticsIfConsented — rien sans accord', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', 'kojo.test');
    window.localStorage.clear();
    document.head.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it('sans décision : aucun script tiers n’est injecté', async () => {
    const { initAnalyticsIfConsented } = await import('../analytics');

    expect(initAnalyticsIfConsented()).toBe(false);
    expect(scriptPlausible(), 'aucun traceur ne doit partir avant le choix').toBeNull();
  });

  it('après un refus : aucun script tiers n’est injecté', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied');
    const { initAnalyticsIfConsented } = await import('../analytics');

    expect(initAnalyticsIfConsented()).toBe(false);
    expect(scriptPlausible()).toBeNull();
  });

  it('après un accord : le script du fournisseur est injecté', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, CONSENT_GRANTED);
    const { initAnalyticsIfConsented } = await import('../analytics');

    expect(initAnalyticsIfConsented()).toBe(true);
    expect(scriptPlausible()).not.toBeNull();
  });
});
