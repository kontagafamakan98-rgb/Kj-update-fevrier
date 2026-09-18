/**
 * Tests de la garde CORS de production (scripts/check-cors-preflight.js).
 *
 * Ce qui est vérifié, et rien de plus : le jugement de la réponse (une origine
 * autorisée passe, tout le reste échoue), les deux faux verts qui comptent
 * (`*` avec une requête créditée, `allow-credentials` absent sur le préflight),
 * les réessais, et le fait que la sonde interroge bien la PAIRE dérivée de
 * `site-meta.js` — jamais deux valeurs recopiées dans le test.
 *
 * Aucun réseau : `fetch` est injecté, l'attente entre tentatives est neutralisée.
 */
import { describe, expect, it } from 'vitest';
import { probeCorsPair, runCorsPreflightCheck, PROBE_PATH } from '../check-cors-preflight.js';
import { API_ORIGIN, SITE_ORIGIN } from '../site-meta.js';

/**
 * Double fidèle d'une `Response` : la sonde se fie à `status` et à
 * `headers.get`, donc le double doit les porter — un double qui répondrait
 * toujours la même chose testerait autre chose que la réalité.
 */
const response = (status, headers = {}) => ({
  status,
  headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
});

/** `fetch` qui répond une suite de réponses par appel, dans l'ordre. */
const sequenceFetch = (responses) => {
  let index = 0;
  return async () => responses[Math.min(index++, responses.length - 1)];
};

const allowed = (overrides = {}) =>
  response(200, {
    'access-control-allow-origin': SITE_ORIGIN,
    'access-control-allow-credentials': 'true',
    ...overrides,
  });

/** API qui autorise l'origine : préflight puis GET réel conformes. */
const healthyFetch = () => sequenceFetch([allowed(), allowed({ 'access-control-allow-credentials': 'true' })]);

const noSleep = async () => {};

describe('probeCorsPair — ce que le navigateur exige', () => {
  it('passe quand le préflight et le GET réel autorisent l’origine canonique', async () => {
    const result = await probeCorsPair({ fetchImpl: healthyFetch() });

    expect(result.ok).toBe(true);
    expect(result.details.join(' ')).toContain(SITE_ORIGIN);
  });

  it('interroge la PAIRE dérivée de site-meta (origine du site ↔ API du build)', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      return allowed();
    };

    await probeCorsPair({ fetchImpl });

    expect(calls).toHaveLength(2); // préflight + requête réelle
    expect(calls[0].url).toBe(`${API_ORIGIN}${PROBE_PATH}`);
    expect(calls[0].options.method).toBe('OPTIONS');
    expect(calls[0].options.headers.origin).toBe(SITE_ORIGIN);
    // Sans cet en-tête demandé, aucun navigateur ne préflighterait : la sonde ne
    // mesurerait pas le chemin qui casse.
    expect(calls[0].options.headers['access-control-request-headers']).toBeTruthy();
    // La requête réelle est celle qui porte la session (cookies httpOnly).
    expect(calls[1].options.headers.origin).toBe(SITE_ORIGIN);
    expect(calls[1].options.method).toBeUndefined();
  });

  it('échoue quand l’origine n’est pas autorisée (la panne du 18/09/2026)', async () => {
    // Starlette répond 400 sans aucun access-control-allow-origin.
    const result = await probeCorsPair({ fetchImpl: sequenceFetch([response(400), response(400)]) });

    expect(result.ok).toBe(false);
    expect(result.rejection).toBe(true);
    expect(result.details.join(' ')).toContain('ABSENT');
  });

  it('refuse « * » : le navigateur rejette une requête créditée', async () => {
    const result = await probeCorsPair({
      fetchImpl: sequenceFetch([
        response(200, { 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' }),
        response(200, { 'access-control-allow-origin': '*' }),
      ]),
    });

    expect(result.ok).toBe(false);
    expect(result.details.join(' ')).toContain('* avec une requête créditée');
  });

  it('refuse un préflight sans allow-credentials: true (session par cookie)', async () => {
    const result = await probeCorsPair({
      fetchImpl: sequenceFetch([allowed({ 'access-control-allow-credentials': null }), allowed()]),
    });

    expect(result.ok).toBe(false);
    expect(result.details.join(' ')).toContain('allow-credentials');
  });

  it('refuse une origine VOISINE (comparaison exacte, pas de préfixe)', async () => {
    const result = await probeCorsPair({
      fetchImpl: sequenceFetch([
        response(200, { 'access-control-allow-origin': `${SITE_ORIGIN}.attaquant.test` }),
        allowed(),
      ]),
    });

    expect(result.ok).toBe(false);
    expect(result.rejection).toBe(true);
  });

  it('échoue si le GET réel perd l’en-tête après un préflight correct', async () => {
    const result = await probeCorsPair({ fetchImpl: sequenceFetch([allowed(), response(200, {})]) });

    expect(result.ok).toBe(false);
    expect(result.details.join(' ')).toContain('GET réel');
  });
});

describe('runCorsPreflightCheck — réessais et diagnostics', () => {
  it('réessaie la fenêtre de bascule puis passe (ancien code encore servi)', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      // Première TENTATIVE (préflight + GET réel = deux appels) : l'instance qui
      // sert encore l'ancien code refuse l'origine. C'est la fenêtre d'un
      // déploiement Fly, pendant laquelle ce job tourne.
      return calls <= 2 ? response(400) : allowed();
    };

    const result = await runCorsPreflightCheck({ fetchImpl, sleep: noSleep, delayMs: 0, log: () => {} });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.notices.join(' ')).toContain('autorisée');
  });

  it('échoue après épuisement des tentatives, en nommant l’origine refusée', async () => {
    const result = await runCorsPreflightCheck({
      fetchImpl: async () => response(400),
      attempts: 3,
      sleep: noSleep,
      delayMs: 0,
      log: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.errors.join(' ')).toContain('origine NON autorisée');
    expect(result.errors.join(' ')).toContain(SITE_ORIGIN);
  });

  it('distingue « API injoignable » de « origine refusée »', async () => {
    const result = await runCorsPreflightCheck({
      fetchImpl: async () => {
        throw new Error('ENOTFOUND');
      },
      attempts: 2,
      sleep: noSleep,
      delayMs: 0,
      log: () => {},
    });

    expect(result.ok).toBe(false);
    // Un échec bruyant, mais un diagnostic DIFFÉRENT : ce n'est pas une
    // régression CORS, c'est une API qu'on n'a pas pu voir.
    expect(result.errors.join(' ')).toContain('impossible de conclure');
    expect(result.errors.join(' ')).not.toContain('origine NON autorisée');
  });
});