/**
 * Preuve d'échec de `frontend/scripts/check-session-reload-production.js`.
 *
 * Le fichier de test companion est injectable et sans navigateur. La sonde de
 * production `check-session-reload-production.js` se juge ici sur des
 * SCÉNARIOS : un contexte d'abord vierge, une connexion, un rechargement, puis
 * ce que la page et l'application répondent APRÈS. Chaque refus de la sonde a
 * son scénario, donc son rouge — un garde qui ne sait rougir que sur une panne
 * réelle ne prouve rien.
 *
 * Rien n'est simulé par-dessus la sonde : elle est appelée telle qu'elle tourne
 * en production, avec `launch` (fabrique de navigateur) et `sleep` remplacés.
 * Playwright n'est donc jamais chargé, et aucun réseau n'est touché.
 *
 * Le verdict attendu de chaque scénario est écrit en clair dans le test, avec
 * la phrase que la sonde doit prononcer — un test qui n'exigerait qu'un `ok:
 * false` laisserait passer un refus pour la MAUVAISE raison.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  LOGIN_PATH,
  AUTH_ME_PATH,
  EMAIL_SELECTOR,
  PASSWORD_SELECTOR,
  runSessionReloadProbe,
  parseArgs,
} from '../check-session-reload-production.js';

const BASE = 'https://kojo-sonde.test';
const API = 'https://api.kojo-sonde.test';
const COMPTE = { email: 'sonde@kojo.test', password: 'mot-de-passe-sonde' };

/** État renvoyé par une évaluation de la page (`pageState`). */
const etat = (status, storageKeys = [], cookie = '') => ({
  status,
  cookie,
  storageKeys,
});

/**
 * Navigateur doublure : il rejoue, dans l'ordre, les états qu'un scénario lui
 * donne, et journalise ce que la sonde lui a demandé.
 *
 * @param {object} scenario
 * @param {Array} scenario.states États rendus par les évaluations successives.
 * @param {string} [scenario.waitForUrl] `timeout` pour une connexion qui n'aboutit pas.
 * @param {object|null} [scenario.appCall] Réponse de l'application après rechargement (`null` : aucune).
 * @param {string} [scenario.finalUrl] URL de la page après rechargement.
 * @returns {{launch: Function, journal: object}}
 */
function navigateur({ states, waitForUrl = 'ok', appCall = { status: 200 }, finalUrl = `${BASE}/dashboard` }) {
  const journal = { fill: [], click: [], reload: 0, closed: false, evaluated: 0 };
  let index = 0;

  const page = {
    url: () => finalUrl,
    goto: async () => {},
    fill: async (selector, value) => {
      journal.fill.push([selector, value]);
    },
    click: async (selector) => {
      journal.click.push(selector);
    },
    waitForURL: async () => {
      if (waitForUrl === 'timeout') throw new Error('Timeout 30000ms exceeded.');
    },
    reload: async () => {
      journal.reload += 1;
    },
    evaluate: async () => {
      const value = states[index];
      index += 1;
      journal.evaluated = index;
      if (!value) throw new Error('évaluation demandée plus de fois que le scénario n’en prévoit');
      return value;
    },
    waitForResponse: async () => {
      if (!appCall) throw new Error('Timeout 20000ms exceeded.');
      return { status: () => appCall.status };
    },
    close: async () => {},
  };

  const browser = {
    newContext: async () => ({ newPage: async () => page }),
    close: async () => {
      journal.closed = true;
    },
  };

  return { launch: async () => browser, journal };
}

/** Sonde d'un scénario, sans réessai (1 tentative) et sans attente réelle. */
const sonder = (scenario, extra = {}) => {
  const { launch, journal } = navigateur(scenario);
  return runSessionReloadProbe({
    base: BASE,
    api: API,
    ...COMPTE,
    launch,
    attempts: 1,
    quiet: true,
    ...extra,
  }).then((result) => ({ result, journal }));
};

describe('check-session-reload-production — session restaurée', () => {
  it('accepte une session qui survit au rechargement, et la restaure', async () => {
    const { result, journal } = await sonder({
      states: [etat(401), etat(200), etat(200)],
    });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    // La connexion passe par le FORMULAIRE servi (pas par POST /auth/login) :
    // c'est ce chemin-là qui décide ce que le navigateur persiste.
    expect(journal.fill).toEqual([
      [EMAIL_SELECTOR, COMPTE.email],
      [PASSWORD_SELECTOR, COMPTE.password],
    ]);
    expect(journal.click).toEqual(['button[type="submit"]']);
    expect(journal.reload).toBe(1);
    expect(result.checked.join('\n')).toContain('le justificatif a survécu');
    expect(result.checked.join('\n')).toContain("l'application a rappelé");
  });

  it('relève le mécanisme de persistance sans en faire un verdict', async () => {
    // Un jeton en stockage n'est pas un échec de RECHARGEMENT : c'est une autre
    // propriété, avec une autre correction. La sonde le dit et continue.
    const { result } = await sonder({
      states: [etat(401), etat(200), etat(200, ['token', 'kojo_geo_db'])],
    });

    expect(result.ok).toBe(true);
    expect(result.checked.join('\n')).toContain('jeton en stockage = oui');
  });
});

describe('check-session-reload-production — refus nommés', () => {
  it('refuse un rechargement où le justificatif ne survit pas, en le nommant', async () => {
    const { result } = await sonder({
      states: [etat(401), etat(200), etat(401)],
      appCall: { status: 401 },
      finalUrl: `${BASE}${LOGIN_PATH}`,
    });

    // La PHRASE d'abord : c'est elle qui dit POURQUOI (le justificatif, pas le
    // frontend), et c'est elle que la preuve de mutation relit quand le verdict
    // de ce cas est neutralisé. Le fragment est choisi SANS ACCENT : la sortie du
    // sous-processus n'est pas toujours de l'UTF-8 (constaté sous Windows, où
    // vitest écrit `\u2713` et laisse les accents en un seul octet), donc un
    // motif accentué peut disparaître de ce que le harnais relit — un rouge de
    // mutation qui ne nomme plus son refus.
    expect(result.errors.join('\n')).toContain('GET /api/auth/me depuis la page recharg');
    expect(result.errors.join('\n')).toContain("n'a pas survécu au rechargement");
    // Le refus désigne le COOKIE, pas le frontend : c'est ce qui évite
    // d'envoyer corriger la garde d'amorçage pour un défaut de périmètre.
    expect(result.errors.join('\n')).toContain('AUTH_COOKIE_SAMESITE');
    expect(result.ok).toBe(false);
  });

  it('refuse une application qui renvoie vers /login alors que la session tient', async () => {
    const { result } = await sonder({
      states: [etat(401), etat(200), etat(200)],
      appCall: null,
      finalUrl: `${BASE}${LOGIN_PATH}`,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain(`renvoie l'utilisateur vers ${LOGIN_PATH}`);
    expect(result.errors.join('\n')).toContain('hasSessionCookie');
  });

  it('refuse une application muette après le rechargement', async () => {
    const { result } = await sonder({
      states: [etat(401), etat(200), etat(200)],
      appCall: null,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain("aucun appel authentifié de l'application");
    expect(result.errors.join('\n')).toContain('aucune requête émise');
  });

  it('refuse une session refusée par l’API alors que la page obtient 200', async () => {
    const { result } = await sonder({
      states: [etat(401), etat(200), etat(200)],
      appCall: { status: 401 },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain("refusée par l'API après le rechargement");
  });

  it('refuse de conclure sur un contexte qui porte déjà une session', async () => {
    // Sans ce contrôle, un 200 constaté plus tard pourrait venir d'une session
    // héritée : la sonde se prouverait ce qu'elle cherche.
    const { result, journal } = await sonder({ states: [etat(200)] });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('contexte de sonde non vierge');
    expect(journal.reload).toBe(0);
  });

  it('nomme les secrets quand la connexion du compte CI échoue', async () => {
    const { result } = await sonder({
      states: [etat(401), etat(401)],
      waitForUrl: 'timeout',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('connexion du compte CI impossible');
    expect(result.errors.join('\n')).toContain('LHCI_CI_EMAIL');
  });

  it('refuse de lancer un navigateur sans compte CI', async () => {
    const launch = vi.fn();
    const result = await runSessionReloadProbe({
      base: BASE,
      api: API,
      email: '',
      password: '',
      launch,
      attempts: 1,
      quiet: true,
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.errors.join('\n')).toContain('LHCI_CI_EMAIL');
    expect(launch).not.toHaveBeenCalled();
  });
});

describe('check-session-reload-production — coût et reprise', () => {
  it('referme le navigateur même quand la tentative échoue', async () => {
    const { result, journal } = await sonder({ states: [etat(200)] });

    expect(result.ok).toBe(false);
    expect(journal.closed).toBe(true);
  });

  it('reprend une tentative avant de conclure, et s’arrête au premier verdict', async () => {
    let appel = 0;
    const launch = async () => {
      appel += 1;
      return (await navigateur(
        appel === 1 ? { states: [etat(200)] } : { states: [etat(401), etat(200), etat(200)] }
      ).launch());
    };
    const sleep = vi.fn(async () => {});

    const result = await runSessionReloadProbe({
      base: BASE,
      api: API,
      ...COMPTE,
      launch,
      sleep,
      attempts: 3,
      delayMs: 15000,
      quiet: true,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(15000);
  });
});

describe('check-session-reload-production — options de ligne de commande', () => {
  it('n’impose aucune surface : les options remplacent les défauts', () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs(['--base', 'http://127.0.0.1:4173', '--api', 'http://127.0.0.1:8123'])).toEqual({
      base: 'http://127.0.0.1:4173',
      api: 'http://127.0.0.1:8123',
    });
    expect(parseArgs(['--tentatives', '2', '--delai', '5'])).toEqual({ attempts: 2, delayMs: 5000 });
    // Un drapeau sans valeur ne mange pas le suivant : il est ignoré.
    expect(parseArgs(['--base'])).toEqual({});
    expect(AUTH_ME_PATH).toBe('/api/auth/me');
  });
});
