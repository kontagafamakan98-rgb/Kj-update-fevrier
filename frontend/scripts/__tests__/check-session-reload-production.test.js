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
  BYPASS_ENV,
  BYPASS_HEADER,
  FAMILLE,
  MARQUE_PREMISSE,
  RENVOI_EXPOSITION,
  contextOptions,
  libelleSonde,
  runSessionReloadProbe,
  parseArgs,
} from '../check-session-reload-production.js';

const BASE = 'https://kojo-sonde.test';
const API = 'https://api.kojo-sonde.test';
const COMPTE = { email: 'sonde@kojo.test', password: 'mot-de-passe-sonde' };
const COOKIE = {
  name: 'kojo_session', value: 'VALEUR-DE-SESSION-A-NE-JAMAIS-PUBLIER',
  httpOnly: true, secure: true, sameSite: 'None',
};

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
function navigateur({ states, waitForUrl = 'ok', appCall = { status: 200 }, finalUrl = `${BASE}/dashboard`, cookies = [[COOKIE], [COOKIE]] }) {
  const journal = {
    fill: [], click: [], reload: 0, closed: false, evaluated: 0, targets: [], observed: [],
    cookieTargets: [],
    // Ce que la sonde demande au CONTEXTE (en-têtes, jeton de contournement) et à
    // la PAGE (drapeau d'exécution), c'est-à-dire la surface visée.
    contextOptions: [], initScripts: [], ordre: [],
  };
  let index = 0;
  let cookieIndex = 0;

  const page = {
    url: () => finalUrl,
    goto: async () => {
      journal.ordre.push('goto');
    },
    addInitScript: async (script) => {
      journal.ordre.push('addInitScript');
      journal.initScripts.push(script);
    },
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
    evaluate: async (_evaluate, target) => {
      journal.targets.push(target);
      const value = states[index];
      index += 1;
      journal.evaluated = index;
      if (!value) throw new Error('évaluation demandée plus de fois que le scénario n’en prévoit');
      return value;
    },
    waitForResponse: async (predicate) => {
      journal.observed.push(predicate({ url: () => journal.targets[0] }));
      if (!appCall) throw new Error('Timeout 20000ms exceeded.');
      return { status: () => appCall.status };
    },
    close: async () => {},
  };

  const browser = {
    newContext: async (options = {}) => {
      journal.contextOptions.push(options);
      return {
        newPage: async () => page,
        cookies: async (url) => {
          journal.cookieTargets.push(url);
          return cookies[cookieIndex++];
        },
      };
    },
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

  it('sans --api : juge les cookies et l’amorçage sur le proxy de l’origine frontend', async () => {
    const { result, journal } = await sonder({
      states: [etat(401), etat(200), etat(200)],
    }, { api: undefined });

    expect(result.ok).toBe(true);
    expect(journal.targets).toEqual(Array(3).fill(`${BASE}${AUTH_ME_PATH}`));
    expect(journal.observed).toEqual([true]);
  });

  it('avec --api : garde la possibilité de diagnostiquer le backend direct', async () => {
    const { result, journal } = await sonder({
      states: [etat(401), etat(200), etat(200)],
    });

    expect(result.ok).toBe(true);
    expect(journal.targets).toEqual(Array(3).fill(`${API}${AUTH_ME_PATH}`));
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

describe('check-session-reload-production — attributs du cookie servi', () => {
  it('observe les attributs après connexion et rechargement, sans publier la valeur', async () => {
    const { result, journal } = await sonder({ states: [etat(401), etat(200), etat(200)] });
    expect(result.ok).toBe(true);
    expect(journal.cookieTargets).toEqual([`${API}${AUTH_ME_PATH}`, `${API}${AUTH_ME_PATH}`]);
    expect(result.verdicts.sessionCookies).toEqual({
      afterLogin: { httpOnly: true, secure: true, sameSite: 'None' },
      afterReload: { httpOnly: true, secure: true, sameSite: 'None' },
    });
    expect(result.checked.join('\n')).toContain('HttpOnly=true, Secure=true, SameSite=None');
    expect(JSON.stringify(result)).not.toContain(COOKIE.value);
  });

  for (const [attribute, value, label] of [
    ['httpOnly', false, 'HttpOnly'], ['secure', false, 'Secure'],
    ['sameSite', 'Lax', 'SameSite'], ['sameSite', 'Strict', 'SameSite'],
  ]) {
    for (const stage of ['connexion', 'rechargement']) {
      it(`refuse la derive ${label}=${value} après ${stage}`, async () => {
        const bad = { ...COOKIE, [attribute]: value };
        const { result } = await sonder({
          states: [etat(401), etat(200), etat(200)],
          cookies: stage === 'connexion' ? [[bad], [COOKIE]] : [[COOKIE], [bad]],
        });
        expect(result.errors.join('\n')).toContain(`après ${stage} : cookie kojo_session : ${label}=${value}`);
        expect(result.ok).toBe(false);
        expect(JSON.stringify(result)).not.toContain(COOKIE.value);
      });
    }
  }

  it('refuse un cookie absent même si /auth/me répond 200', async () => {
    const { result } = await sonder({
      states: [etat(401), etat(200), etat(200)], cookies: [[], []],
    });
    expect(result.errors.join('\n')).toContain('cookie kojo_session : 0 cookie(s) applicable(s), 1 attendu');
    expect(result.ok).toBe(false);
  });

  it('refuse des cookies de session ambigus au lieu de choisir le premier', async () => {
    const { result } = await sonder({
      states: [etat(401), etat(200), etat(200)], cookies: [[COOKIE, COOKIE], [COOKIE]],
    });
    expect(result.errors.join('\n')).toContain('cookie kojo_session : 2 cookie(s) applicable(s), 1 attendu');
    expect(result.ok).toBe(false);
  });

  it('ne confond pas le cookie CSRF avec le cookie de session', async () => {
    const { result } = await sonder({
      states: [etat(401), etat(200), etat(200)],
      cookies: [[{ ...COOKIE, name: 'kojo_csrf', httpOnly: false }, COOKIE], [COOKIE]],
    });
    expect(result.ok).toBe(true);
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
    expect(result.errors.join('\n')).toContain('hasSessionTrace');
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

// ─── La DISTINCTION d'avec la sonde d'exposition du jeton ────────────────────
//
// Les deux sondes de production ouvrent le même formulaire servi et rechargent
// la même page. Ce test-là fixe la moitié qui appartient à CETTE sonde : ce
// qu'elle relève d'un jeton rangé côté web ne rougit pas ici (cas ci-dessus),
// et chacun de ses refus de prémisse dit sa famille et nomme la sonde à qui
// appartient le fait « un jeton est exposé ».

describe('check-session-reload-production — ce refus n’est pas celui de l’exposition', () => {
  it('marque ses PRÉMISSES et renvoie l’exposition à sa sonde, dans le MESSAGE', async () => {
    const libelle = libelleSonde(BASE, API);
    // Les quatre refus qui précèdent tout jugement — dont la prémisse partagée
    // avec l'autre sonde (le compte CI manque).
    const cas = {
      'compte CI absent': await runSessionReloadProbe({
        base: BASE,
        api: API,
        email: '',
        password: '',
        attempts: 1,
        quiet: true,
      }),
      'contexte non vierge': (await sonder({ states: [etat(200)] })).result,
      'connexion impossible': (
        await sonder({ states: [etat(401), etat(401)], waitForUrl: 'timeout' })
      ).result,
      'session non ouverte': (await sonder({ states: [etat(401), etat(401)] })).result,
    };

    for (const [nom, result] of Object.entries(cas)) {
      const messages = result.errors.join('\n');
      expect(result.ok, nom).toBe(false);
      // La FAMILLE est dans le message, pas seulement dans le titre de l'annotation.
      expect(messages, nom).toContain(libelle);
      // Le refus se DÉCLARE prémisse : il n'a rien jugé.
      expect(result.errors[0].startsWith(`${libelle} : ${MARQUE_PREMISSE}`), nom).toBe(true);
      // …et il nomme le fait qui appartient à l'autre sonde.
      expect(messages, nom).toContain(RENVOI_EXPOSITION);
      expect(messages, nom).toContain('check-token-exposure-production.js');
      expect(FAMILLE, nom).toBe('session au rechargement');
    }
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

describe('check-session-reload-production — préproduction cross-site', () => {
  it('n’envoie l’en-tête de contournement que si un jeton est fourni', () => {
    // La convention Vercel : le secret du dépôt porte ce nom-là.
    expect(BYPASS_ENV).toBe('VERCEL_AUTOMATION_BYPASS_SECRET');
    expect(BYPASS_HEADER).toBe('x-vercel-protection-bypass');
    // Sans jeton : AUCUN en-tête (une valeur vide n'est pas un contournement).
    expect(contextOptions({})).toEqual({});
    expect(contextOptions({ bypassToken: '   ' })).toEqual({});
    expect(contextOptions({ bypassToken: 'jeton-de-contournement' })).toEqual({
      extraHTTPHeaders: { 'x-vercel-protection-bypass': 'jeton-de-contournement' },
    });
  });

  it('porte le jeton de contournement sur le contexte, sans jamais le publier', async () => {
    const { result, journal } = await sonder(
      { states: [etat(401), etat(200), etat(200)] },
      { bypassToken: 'jeton-de-contournement' }
    );

    expect(result.ok).toBe(true);
    expect(journal.contextOptions).toEqual([
      { extraHTTPHeaders: { 'x-vercel-protection-bypass': 'jeton-de-contournement' } },
    ]);
    // Un jeton dans un journal de run serait une fuite : la sonde n'en parle pas.
    expect(JSON.stringify(result)).not.toContain('jeton-de-contournement');
  });

  it('--cross-site pose le drapeau d’exécution AVANT le premier rendu', async () => {
    const { result, journal } = await sonder(
      { states: [etat(401), etat(200), etat(200)] },
      { directApi: true }
    );

    expect(result.ok).toBe(true);
    expect(journal.initScripts).toHaveLength(1);
    // Avant tout `goto` : le drapeau est lu au moment où le bundle construit ses URLs.
    expect(journal.ordre[0]).toBe('addInitScript');
    const fenetre = {};
    vi.stubGlobal('window', fenetre);
    try {
      journal.initScripts[0]();
      expect(fenetre.__KOJO_USE_SAME_ORIGIN_API__).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(result.checked.join('\n')).toContain('cross-site demandé');
  });

  it('sans --cross-site, la sonde ne touche pas au drapeau même-origine', async () => {
    const { journal } = await sonder({ states: [etat(401), etat(200), etat(200)] });
    expect(journal.initScripts).toEqual([]);
    expect(journal.contextOptions).toEqual([{}]);
  });

  it('--cross-site porte DEUX réglages, --api un seul : les drapeaux ne se confondent pas', () => {
    expect(parseArgs(['--cross-site', API])).toEqual({ api: API, directApi: true });
    expect(parseArgs(['--api', API])).toEqual({ api: API });
    expect(parseArgs(['--base', BASE, '--cross-site', API])).toEqual({
      base: BASE, api: API, directApi: true,
    });
  });
});
