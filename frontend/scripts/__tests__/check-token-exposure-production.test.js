/**
 * Preuve d'échec de `frontend/scripts/check-token-exposure-production.js`.
 *
 * Trois étages, parce que la sonde en a trois :
 *
 *   1. le RELEVÉ (`LECTURE_DU_DOMAINE`) — jugé sur des globals écrits à la main
 *      (réservoirs, `document.cookie`, `location.href`) : chaque forme
 *      d'exposition a son cas, y compris les surfaces ILLISIBLES, qui ne doivent
 *      pas passer pour « aucun jeton » ;
 *   2. le VERDICT (`jugerExposition`) — la traduction du relevé en refus ;
 *   3. la SONDE (`runTokenExposureProbe`) — appelée telle qu'elle tourne en
 *      production, avec `launch` et `sleep` remplacés : Playwright n'est jamais
 *      chargé, aucun réseau n'est touché.
 *
 * Le verdict attendu est écrit en clair, avec la phrase que la sonde doit
 * prononcer : un test qui n'exigerait qu'un `ok: false` laisserait passer un
 * refus pour la MAUVAISE raison. Et parce qu'une sonde de fuite qui publierait
 * un jeton serait elle-même la fuite, chaque scénario vérifie aussi que la
 * VALEUR du jeton n'apparaît dans aucun message.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  APRES_AMORCAGE,
  AVANT_AMORCAGE,
  CLE_RELEVE_AVANT_BOOT,
  FAMILLE,
  JWT_VALUE_PATTERN,
  LECTURE_DU_DOMAINE,
  MARQUE_PREMISSE,
  RENVOI_RECHARGEMENT,
  TOKEN_KEY_PATTERN,
  jugerExposition,
  jugerSessionNative,
  libelleSonde,
  parseArgs,
  runTokenExposureProbe,
  sourceMarqueurNatif,
  sourceReleveAvantBoot,
} from '../check-token-exposure-production.js';

const BASE = 'https://kojo-exposition.test';
const COMPTE = { email: 'sonde@kojo.test', password: 'mot-de-passe-sonde' };
/** Jeton de SONDES : jamais un vrai jeton, et jamais publié par la sonde. */
const JETON = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.signature-longue';
const RELEVE_VIDE = {
  trouvailles: [],
  lisibles: { localStorage: true, sessionStorage: true },
  cookiesLisibles: true,
  url: `${BASE}/dashboard`,
};

// Les globals de navigateur sont remplacés par des doublures, puis remis en
// place : le relevé se juge sans navigateur, et ce fichier ne doit rien laisser
// derrière lui pour les autres tests de l'environnement.
const globalsOriginels = { window: globalThis.window, document: globalThis.document };

afterEach(() => {
  globalThis.window = globalsOriginels.window;
  globalThis.document = globalsOriginels.document;
  if (globalsOriginels.window === undefined) delete globalThis.window;
  if (globalsOriginels.document === undefined) delete globalThis.document;
  vi.restoreAllMocks();
});

// ─── 1. Le relevé, pris dans la page ────────────────────────────────────────

/**
 * Installe des globals de navigateur : deux réservoirs, un `document.cookie`,
 * une URL. `illisible` nomme les surfaces qui LÈVENT à l'accès, comme le fait
 * un navigateur en mode privé strict.
 */
function avecGlobals({ local = {}, session = {}, cookie = '', href = `${BASE}/dashboard`, illisible = [] }) {
  const reservoir = (entrees, surface) => {
    const cles = Object.keys(entrees);
    return {
      get length() {
        if (illisible.includes(surface)) throw new Error('access denied');
        return cles.length;
      },
      key: (index) => cles[index] ?? null,
      getItem: (cle) => (cle in entrees ? entrees[cle] : null),
    };
  };
  globalThis.window = {
    localStorage: reservoir(local, 'localStorage'),
    sessionStorage: reservoir(session, 'sessionStorage'),
    location: { href },
  };
  globalThis.document = { cookie };
}

const RELEVER = (options) => {
  avecGlobals(options);
  return LECTURE_DU_DOMAINE();
};

describe('check-token-exposure — le relevé dans la page', () => {
  it('ne trouve rien sur un domaine propre : profil en cache, cookie CSRF, aucun jeton', () => {
    const releve = RELEVER({
      local: { user: JSON.stringify({ id: 'user-1', country: 'mali' }) },
      cookie: 'kojo_csrf=csrf-aleatoire-lisible',
    });

    expect(releve.trouvailles).toEqual([]);
    expect(releve.lisibles).toEqual({ localStorage: true, sessionStorage: true });
    expect(releve.cookiesLisibles).toBe(true);
  });

  it('trouve une CLÉ de justificatif, quel que soit son contenu', () => {
    const releve = RELEVER({ local: { token: '' }, session: { auth_token: 'x' } });

    expect(releve.trouvailles).toEqual([
      { ou: 'localStorage', cle: 'token', forme: 'nom de justificatif' },
      { ou: 'sessionStorage', cle: 'auth_token', forme: 'nom de justificatif' },
    ]);
  });

  it('trouve un JETON rangé sous une clé anodine : c’est la FORME qui fait foi', () => {
    const releve = RELEVER({ local: { kojo_preferences: JETON } });

    expect(releve.trouvailles).toEqual([
      { ou: 'localStorage', cle: 'kojo_preferences', forme: 'valeur en forme de JWT' },
    ]);
  });

  it('trouve le jeton de session si son cookie devenait LISIBLE par un script', () => {
    const releve = RELEVER({ cookie: `kojo_csrf=csrf-lisible; kojo_session=${JETON}` });

    expect(releve.trouvailles).toEqual([
      { ou: 'document.cookie', cle: 'kojo_session', forme: 'valeur en forme de JWT' },
    ]);
  });

  it('trouve un jeton porté par l’URL de la page — paramètre, fragment, segment', () => {
    expect(RELEVER({ href: `${BASE}/dashboard?access_token=${JETON}` }).trouvailles).toEqual([
      { ou: 'URL de la page', cle: 'location.search', forme: 'valeur en forme de JWT' },
    ]);
    expect(RELEVER({ href: `${BASE}/dashboard#access_token=${JETON}` }).trouvailles).toEqual([
      { ou: 'URL de la page', cle: 'location.hash', forme: 'valeur en forme de JWT' },
    ]);
    expect(RELEVER({ href: `${BASE}/verifier/${JETON}` }).trouvailles).toEqual([
      { ou: 'URL de la page', cle: 'location.pathname', forme: 'valeur en forme de JWT' },
    ]);
  });

  it('ne prend PAS une URL ordinaire pour un jeton : c’est la valeur entière qui décide', () => {
    const releve = RELEVER({ href: `${BASE}/jobs/offre-emploi-developpeur-web?page=2` });

    expect(releve.trouvailles).toEqual([]);
  });

  it('signale une surface ILLISIBLE au lieu de conclure « aucun jeton »', () => {
    const releve = RELEVER({ local: { user: '{}' }, cookie: 'kojo_csrf=csrf', illisible: ['localStorage'] });

    expect(releve.trouvailles).toEqual([]);
    expect(releve.lisibles.localStorage).toBe(false);
    expect(releve.lisibles.sessionStorage).toBe(true);
  });

  it('les deux règles ne se confondent pas : motif de clé et forme de valeur', () => {
    expect(TOKEN_KEY_PATTERN.test('token')).toBe(true);
    expect(TOKEN_KEY_PATTERN.test('kojo_user')).toBe(false);
    expect(JWT_VALUE_PATTERN.test(JETON)).toBe(true);
    // Le cookie CSRF n'est pas un JWT : il ne doit jamais faire rougir la sonde.
    expect(JWT_VALUE_PATTERN.test('csrf-aleatoire-lisible')).toBe(false);
  });
});

// ─── 2. Le verdict ──────────────────────────────────────────────────────────

describe('check-token-exposure — le verdict', () => {
  it('est vert quand le relevé est vide et que l’écoute a vu des requêtes', () => {
    expect(jugerExposition(RELEVE_VIDE, { requetes: [], vues: 12 })).toEqual([]);
  });

  it('refuse un compteur de requêtes à ZÉRO : un silence n’est pas une preuve', () => {
    const refus = jugerExposition(RELEVE_VIDE, { requetes: [], vues: 0 });

    expect(refus.join('\n')).toContain('ne vaut pas une preuve');
    expect(refus.join('\n')).toContain("aucune requête n'a été observée");
  });

  it('refuse un jeton exposé, en nommant le réservoir et la clé — jamais la valeur', () => {
    const [refus] = jugerExposition(
      { ...RELEVE_VIDE, trouvailles: [{ ou: 'localStorage', cle: 'token', forme: 'nom de justificatif' }] },
      { requetes: [], vues: 12 }
    );

    expect(refus).toContain('localStorage « token » (nom de justificatif)');
    expect(refus).toContain('cookie httpOnly');
    expect(refus).not.toContain(JETON);
  });

  it('refuse une surface aveugle : un vert qui n’a rien pu lire ne mesure rien', () => {
    const refus = jugerExposition(
      { ...RELEVE_VIDE, lisibles: { localStorage: false, sessionStorage: true } },
      { requetes: [], vues: 12 }
    );

    expect(refus.join('\n')).toContain('surface aveugle : localStorage');
    expect(refus.join('\n')).toContain('ne peut PAS prouver');
  });

  it('refuse un document.cookie illisible, pour la même raison', () => {
    const refus = jugerExposition({ ...RELEVE_VIDE, cookiesLisibles: false }, { requetes: [], vues: 12 });

    expect(refus.join('\n')).toContain('surface aveugle : document.cookie');
  });

  it('juge le relevé du PREMIER instant sans lui opposer le plancher des requêtes', () => {
    // Le relevé d'avant amorçage ne s'appuie sur aucune écoute : exiger de lui un
    // compteur non nul ferait rougir la sonde à chaque exécution, pour une raison
    // qui n'a rien à voir avec une exposition.
    expect(jugerExposition(RELEVE_VIDE, { quand: AVANT_AMORCAGE })).toEqual([]);
    expect(jugerExposition(RELEVE_VIDE, { vues: 0 })).toHaveLength(1);
  });

  it('nomme la PHASE du relevé fautif : les deux instants ne se confondent pas', () => {
    const [refus] = jugerExposition(
      { ...RELEVE_VIDE, trouvailles: [{ ou: 'localStorage', cle: 'token', forme: 'nom de justificatif' }] },
      { quand: AVANT_AMORCAGE }
    );

    expect(refus).toContain(AVANT_AMORCAGE);
    expect(refus).not.toContain(APRES_AMORCAGE);
  });

  it('refuse un en-tête Authorization, en nommant la méthode et le CHEMIN seulement', () => {
    const refus = jugerExposition(RELEVE_VIDE, {
      requetes: [
        { methode: 'GET', chemin: '/api/jobs/mine' },
        { methode: 'POST', chemin: '/api/proposals' },
      ],
      vues: 12,
    });

    expect(refus).toHaveLength(2);
    expect(refus[0]).toContain('Authorization (GET /api/jobs/mine)');
    expect(refus[1]).toContain('Authorization (POST /api/proposals)');
    expect(refus.join('\n')).toContain('shell natif');
  });
});

// ─── 3. La sonde, sur des scénarios ─────────────────────────────────────────

/**
 * Navigateur doublure : il rejoue, dans l'ordre, les états que le scénario lui
 * donne (statuts de session puis relevé), et journalise ce que la sonde lui a
 * demandé. Les requêtes du scénario sont émises au RECHARGEMENT — le moment où
 * une application qui relirait un jeton le réécrirait.
 *
 * La lecture du relevé d'AVANT amorçage se reconnaît à son second argument (la
 * clé de fenêtre) : elle rend `avantBoot`, jamais le scénario d'états. `null`
 * simule un script d'avant amorçage qui n'a rien déposé.
 *
 * @param {object} scenario
 * @param {number[]} scenario.states Statuts puis relevé, dans l'ordre des évaluations.
 * @param {string} [scenario.waitForUrl] `timeout` pour une connexion qui n'aboutit pas.
 * @param {object|null} [scenario.appCall] Réponse de l'application après rechargement.
 * @param {Array} [scenario.requetes] Requêtes FAUTIVES émises par la page (en-tête Authorization).
 * @param {Array} [scenario.trafic] Requêtes ordinaires : le trafic qu'une page réelle émet. C'est
 *   lui qui donne au compteur sa valeur non nulle — le plancher de lecture de l'écoute.
 * @param {object|null} [scenario.avantBoot] Relevé du premier instant (RELEVE_VIDE par défaut).
 * @param {object} [scenario.natif] Étage natif : surcharge de `NATIF_SAIN`.
 * @returns {{launch: Function, journal: object}}
 */

/**
 * L'étage natif « sain » : le jeton est écrit à la connexion, et il survit au
 * redémarrage — la session revient par `GET /auth/me` 200, portée par le jeton.
 * Un scénario ne surcharge que ce qu'il juge.
 */
const NATIF_SAIN = {
  connexion: 'ok',
  jetonEcrit: true,
  cookies: 0,
  statutAuthMe: 200,
  bearer: true,
  jetonApres: { presence: true, ou: 'localStorage', expiration: 0 },
};

function navigateur({
  states,
  waitForUrl = 'ok',
  appCall = { status: 200 },
  requetes = [],
  trafic,
  finalUrl = `${BASE}/dashboard`,
  avantBoot = RELEVE_VIDE,
  natif = {},
}) {
  const natifScript = { ...NATIF_SAIN, ...natif };
  const ordinaires = trafic ?? [
    { url: () => `${BASE}/api/auth/me`, method: () => 'GET', headers: () => ({ accept: 'application/json' }) },
    { url: () => `${BASE}/assets/index.js`, method: () => 'GET', headers: () => ({}) },
  ];
  const journal = {
    fill: [],
    click: [],
    reload: 0,
    closed: false,
    ecoutes: [],
    contextOptions: [],
    initScripts: [],
    ordre: [],
    contextes: 0,
    connexionsNatives: 0,
    redemarrages: 0,
  };
  const ecouteurs = { request: [] };
  const ecouteursRedemarrage = { request: [] };
  let index = 0;

  // ── Contexte 1 : la page WEB servie (le parcours historique) ──────────────
  const pageWeb = {
    url: () => finalUrl,
    addInitScript: async (script) => {
      journal.ordre.push('addInitScript');
      journal.initScripts.push(script);
    },
    goto: async () => {
      journal.ordre.push('goto');
    },
    fill: async (selecteur, valeur) => journal.fill.push([selecteur, valeur]),
    click: async (selecteur) => journal.click.push(selecteur),
    waitForURL: async () => {
      if (waitForUrl === 'timeout') throw new Error('Timeout 30000ms exceeded.');
    },
    on: (evenement, handler) => {
      journal.ecoutes.push(evenement);
      (ecouteurs[evenement] ||= []).push(handler);
    },
    reload: async () => {
      journal.reload += 1;
      for (const requete of [...ordinaires, ...requetes]) {
        for (const handler of ecouteurs.request) handler(requete);
      }
    },
    evaluate: async (premier, ...arguments_) => {
      // Lecture du relevé déposé au premier instant : elle se reconnaît à la CLÉ
      // de fenêtre passée en argument (le relevé du statut de session, lui, reçoit
      // une URL : les deux appels ont deux arguments, un compte ne suffit pas).
      if (arguments_[0] === CLE_RELEVE_AVANT_BOOT) return avantBoot;
      const valeur = states[index];
      index += 1;
      if (valeur === undefined) throw new Error('évaluation demandée plus de fois que le scénario n’en prévoit');
      return valeur;
    },
    waitForResponse: async () => {
      if (!appCall) throw new Error('Timeout 20000ms exceeded.');
      return { status: () => appCall.status };
    },
    close: async () => {},
  };

  // ── Contexte 2 : la connexion sous les marqueurs du shell natif ───────────
  const pageNatif = {
    addInitScript: async (script) => {
      journal.ordre.push('addInitScript');
      journal.initScripts.push(script);
    },
    goto: async () => {
      journal.ordre.push('goto');
    },
    fill: async () => {},
    click: async () => {},
    waitForURL: async () => {
      if (natifScript.connexion === 'timeout') throw new Error('Timeout 30000ms exceeded.');
      journal.connexionsNatives += 1;
    },
    // Une seule évaluation sur cette page : la lecture du jeton écrit.
    evaluate: async () => ({
      presence: natifScript.jetonEcrit,
      ou: natifScript.jetonEcrit ? 'localStorage' : '',
      expiration: 0,
    }),
    close: async () => {},
  };

  // ── Contexte 3 : le REDÉMARRAGE (même stockage, aucun cookie) ────────────
  const pageRedemarrage = {
    addInitScript: async (script) => {
      journal.ordre.push('addInitScript');
      journal.initScripts.push(script);
    },
    goto: async () => {
      journal.ordre.push('goto');
      journal.redemarrages += 1;
      // L'appel de l'application au redémarrage, émis sur l'écoute de la page :
      // c'est lui qui porte — ou ne porte pas — l'en-tête Authorization.
      for (const handler of ecouteursRedemarrage.request) {
        handler({
          url: () => `${BASE}/api/auth/me`,
          method: () => 'GET',
          headers: () => (natifScript.bearer ? { authorization: 'Bearer jeton-natif-de-fixture' } : {}),
        });
      }
    },
    on: (evenement, handler) => {
      (ecouteursRedemarrage[evenement] ||= []).push(handler);
    },
    evaluate: async () => natifScript.jetonApres,
    waitForResponse: async () => {
      if (natifScript.statutAuthMe === null) throw new Error('Timeout 20000ms exceeded.');
      return {
        url: () => `${BASE}/api/auth/me`,
        status: () => natifScript.statutAuthMe,
        request: () => ({ method: () => 'GET' }),
      };
    },
    close: async () => {},
  };

  const contexteDe = (page, cookies = 0) => ({
    newPage: async () => page,
    close: async () => {},
    cookies: async () => Array.from({ length: cookies }, (_, rang) => ({ name: `cookie-${rang}` })),
    storageState: async () => ({
      cookies: [],
      origins: [
        {
          origin: BASE,
          localStorage: [
            { name: 'token', value: 'jeton-natif-de-fixture' },
            { name: 'user', value: '{}' },
          ],
        },
      ],
    }),
  });

  const launch = async () => ({
    newContext: async (options) => {
      journal.contextOptions.push(options);
      journal.contextes += 1;
      // L'ORDRE est le contrat : web, puis connexion native, puis redémarrage.
      if (journal.contextes === 1) return contexteDe(pageWeb);
      if (journal.contextes === 2) return contexteDe(pageNatif);
      return contexteDe(pageRedemarrage, natifScript.cookies);
    },
    close: async () => {
      journal.closed = true;
    },
  });

  return { launch, journal };
}

const sonder = (scenario, extra = {}) => {
  const { launch, journal } = navigateur(scenario);
  return runTokenExposureProbe({
    base: BASE,
    ...COMPTE,
    launch,
    attempts: 1,
    quiet: true,
    ...extra,
  }).then((result) => ({ result, journal }));
};

/** Tous les messages publiés par la sonde : sert à prouver qu'aucun ne cite un jeton. */
const publie = (result) => [...result.checked, ...result.errors].join('\n');

describe('check-token-exposure — la sonde', () => {
  it('accepte un domaine propre, et dit ce qu’elle a lu', async () => {
    const { result, journal } = await sonder({ states: [401, 200, RELEVE_VIDE] });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    // Le chemin jugé est le chemin de l'utilisateur, et l'écoute des requêtes
    // est armée AVANT le rechargement.
    expect(journal.fill).toEqual([
      ['#email', COMPTE.email],
      ['#password', COMPTE.password],
    ]);
    expect(journal.click).toEqual(['button[type="submit"]']);
    expect(journal.ecoutes).toContain('request');
    expect(journal.reload).toBe(1);
    expect(journal.closed).toBe(true);
    expect(result.checked.join('\n')).toContain('il y a un jeton à exposer');
    expect(result.checked.join('\n')).toContain('localStorage : lisible');
    expect(result.checked.join('\n')).toContain('aucun cookie en forme de JWT');
    expect(result.checked.join('\n')).toContain('requêtes observées : ');
    // Le compteur TOTAL est publié : c'est le plancher qui distingue « rien à
    // signaler » d'une écoute débranchée.
    expect(result.verdicts.seen).toBeGreaterThan(0);
    // Les DEUX instants sont relevés et publiés.
    expect(result.checked.join('\n')).toContain(AVANT_AMORCAGE);
    expect(result.verdicts.preBootFindings).toBe(0);
    // Le script d'avant amorçage est armé AVANT la première navigation : posé
    // après, il ne décrirait pas l'état dans lequel la page est arrivée.
    // Trois contextes, chacun avec son marqueur posé AVANT sa navigation :
    // l'ordre des deux moitiés est un contrat, pas un détail d'implémentation.
    expect(journal.ordre).toEqual([
      'addInitScript',
      'goto',
      'addInitScript',
      'goto',
      'addInitScript',
      'goto',
    ]);
    expect(journal.initScripts[0]).toContain(CLE_RELEVE_AVANT_BOOT);
  });

  it('refuse un jeton présent au PREMIER instant, même purgé ensuite par l’application', async () => {
    // Le cas réel mesuré le 16/10/2026 sur l'origine servie : une clé `token`
    // héritée est LISIBLE pendant tout le chargement, puis effacée au démarrage
    // par purgeWebSessionTokens. Le relevé final est vide — et c'est le premier
    // instant qui doit rougir.
    const { result } = await sonder({
      states: [401, 200, RELEVE_VIDE],
      avantBoot: {
        ...RELEVE_VIDE,
        trouvailles: [{ ou: 'localStorage', cle: 'token', forme: 'nom de justificatif' }],
      },
    });

    // Le MOTIF est exigé avant le verdict : un `ok: false` obtenu parce que la
    // sonde s'est cassée pour une autre raison doit rougir ici aussi.
    expect(result.errors.join('\n')).toContain(AVANT_AMORCAGE);
    expect(result.errors.join('\n')).toContain('localStorage « token »');
    expect(result.ok).toBe(false);
    expect(result.verdicts.findings).toBe(0);
    expect(result.verdicts.preBootFindings).toBe(1);
    expect(publie(result)).not.toContain(JETON);
  });

  it('refuse quand le relevé du premier instant n’a RIEN déposé', async () => {
    const { result } = await sonder({ states: [401, 200, RELEVE_VIDE], avantBoot: null });

    expect(result.errors.join('\n')).toContain('relevé du PREMIER instant');
    expect(result.ok).toBe(false);
    expect(result.verdicts.preBootFindings).toBe(0);
  });

  it('refuse un jeton resté en stockage, sans jamais publier sa valeur', async () => {
    const { result } = await sonder({
      states: [
        401,
        200,
        { ...RELEVE_VIDE, trouvailles: [{ ou: 'localStorage', cle: 'token', forme: 'nom de justificatif' }] },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('localStorage « token »');
    expect(publie(result)).not.toContain(JETON);
  });

  it('refuse un en-tête Authorization, en ne gardant que méthode et chemin', async () => {
    const { result } = await sonder({
      states: [401, 200, RELEVE_VIDE],
      requetes: [
        {
          url: () => `${BASE}/api/geolocation/available-countries`,
          method: () => 'GET',
          headers: () => ({ accept: 'application/json' }),
        },
        {
          url: () => `${BASE}/api/jobs?token=${JETON}`,
          method: () => 'GET',
          headers: () => ({ authorization: `Bearer ${JETON}` }),
        },
      ],
    });

    // La RAISON est exigée avant le verdict : un `ok: false` obtenu pour un
    // autre motif doit rougir ici aussi.
    expect(result.errors.join('\n')).toContain('Authorization (GET /api/jobs)');
    expect(result.ok).toBe(false);
    // Ni la valeur de l'en-tête, ni la query string qui la portait.
    expect(publie(result)).not.toContain(JETON);
    expect(publie(result)).not.toContain('?token=');
    // Le compteur TOTAL est publié à côté du compte fautif : la preuve est
    // datée d'un trafic réel, pas d'un silence.
    expect(result.checked.join('\n')).toContain('1 portant un en-tête Authorization');
    expect(result.verdicts.seen).toBeGreaterThan(1);
  });

  it('refuse quand l’écoute n’a vu AUCUNE requête : le compteur à zéro n’est pas un vert', async () => {
    const { result } = await sonder({ states: [401, 200, RELEVE_VIDE], trafic: [], requetes: [] });

    expect(result.errors.join('\n')).toContain("aucune requête n'a été observée");
    expect(result.ok).toBe(false);
    expect(result.verdicts.seen).toBe(0);
  });

  it('refuse une surface aveugle : elle ne conclut pas « aucun jeton » sur du vide', async () => {
    const { result } = await sonder({
      states: [401, 200, { ...RELEVE_VIDE, lisibles: { localStorage: true, sessionStorage: false } }],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('surface aveugle : sessionStorage');
  });

  it('refuse un contexte non vierge : il ne mesurerait pas ce qu’il a établi', async () => {
    const { result, journal } = await sonder({ states: [200] });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('contexte de sonde non vierge');
    expect(journal.reload).toBe(0);
  });

  it('refuse une connexion impossible, en nommant les secrets du compte CI', async () => {
    const { result } = await sonder({ states: [401], waitForUrl: 'timeout' });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('connexion du compte CI impossible');
    expect(result.errors.join('\n')).toContain('LHCI_CI_EMAIL');
  });

  it('refuse une session absente après la connexion : il n’y a rien à exposer', async () => {
    const { result } = await sonder({ states: [401, 401] });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('session non ouverte après la connexion');
    expect(result.errors.join('\n')).toContain('Rien ne peut être jugé');
  });

  it('refuse AVANT de lancer un navigateur quand le compte CI manque', async () => {
    const { launch, journal } = navigateur({ states: [401, 200, RELEVE_VIDE] });
    const result = await runTokenExposureProbe({
      base: BASE,
      email: '',
      password: '',
      launch,
      attempts: 3,
      quiet: true,
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.errors.join('\n')).toContain('LHCI_CI_EMAIL');
    // Aucun navigateur ouvert : un compte absent est un refus, pas une tentative.
    expect(journal.reload).toBe(0);
    expect(journal.closed).toBe(false);
  });

  it('reprend une tentative avant de conclure, et s’arrête au premier verdict', async () => {
    let appel = 0;
    const launch = async () => {
      appel += 1;
      return (await navigateur(
        appel === 1
          ? { states: [200] }
          : { states: [401, 200, RELEVE_VIDE] }
      ).launch());
    };
    const sleep = vi.fn(async () => {});

    const result = await runTokenExposureProbe({
      base: BASE,
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

  it('porte le jeton de contournement en en-tête de contexte, jamais en ligne de commande', async () => {
    const { launch, journal } = navigateur({ states: [401, 200, RELEVE_VIDE] });
    const result = await runTokenExposureProbe({
      base: BASE,
      ...COMPTE,
      bypassToken: 'jeton-de-contournement',
      launch,
      attempts: 1,
      quiet: true,
    });

    expect(result.ok).toBe(true);
    // Les TROIS contextes portent le contournement (sinon l'un d'eux se ferait
    // renvoyer la page de protection Vercel), et le redémarrage part avec un
    // stockage SANS AUCUN cookie.
    expect(journal.contextOptions).toEqual([
      { extraHTTPHeaders: { 'x-vercel-protection-bypass': 'jeton-de-contournement' } },
      { extraHTTPHeaders: { 'x-vercel-protection-bypass': 'jeton-de-contournement' } },
      {
        extraHTTPHeaders: { 'x-vercel-protection-bypass': 'jeton-de-contournement' },
        storageState: {
          cookies: [],
          origins: [
            {
              origin: BASE,
              localStorage: [
                { name: 'token', value: 'jeton-natif-de-fixture' },
                { name: 'user', value: '{}' },
              ],
            },
          ],
        },
      },
    ]);
  });
});

// ─── 3 bis. La DISTINCTION d'avec la sonde de rechargement ──────────────
//
// Les deux sondes de production ouvrent le même formulaire servi et rechargent
// la même page : leurs refus ne doivent jamais se confondre (un rouge ambigu
// envoie corriger le mauvais fichier). Ce qui prouve la distinction ici n'est
// pas une phrase dans un commentaire, mais le VERDICT lui-même : un rechargement
// non restauré laisse cette sonde VERTE, et chacun de ses refus de prémisse dit
// sa famille et nomme la sonde à qui appartient ce fait-là.

describe('check-token-exposure — ce refus n’est pas celui du rechargement', () => {
  it('un rechargement non restauré ne rougit PAS ici : c’est le fait d’une AUTRE sonde', async () => {
    // (1) L'application ne rappelle pas son endpoint d'amorçage : la session n'est
    // pas restaurée. C'est le refus de `check-session-reload-production.js` (garde
    // d'amorçage), jamais le nôtre — ici on juge ce que la page PORTE.
    const muette = await sonder({ states: [401, 200, RELEVE_VIDE], appCall: null });

    expect(muette.result.errors).toEqual([]);
    expect(muette.result.ok).toBe(true);
    expect(muette.result.checked.join('\n')).toContain("l'application n'a pas rappelé /auth/me");
    expect(muette.result.checked.join('\n')).toContain('le fait jugé est ce que la page PORTE');

    // (2) L'application appelle, et l'API répond 401 : la session est perdue au
    // rechargement. Même verdict d'ici : ce n'est pas notre refus.
    const refusee = await sonder({ states: [401, 200, RELEVE_VIDE], appCall: { status: 401 } });

    expect(refusee.result.errors).toEqual([]);
    expect(refusee.result.ok).toBe(true);
    expect(refusee.result.checked.join('\n')).toContain("l'application a rappelé /auth/me");
  });

  it('marque ses PRÉMISSES et renvoie le rechargement à sa sonde, dans le MESSAGE', async () => {
    const libelle = libelleSonde(BASE);
    // Les quatre refus qui précèdent tout jugement — dont la prémisse partagée
    // avec l'autre sonde (le compte CI manque), qui est le cas le plus
    // confondable : les deux sondes y disent presque la même chose.
    const cas = {
      'compte CI absent': await runTokenExposureProbe({
        base: BASE,
        email: '',
        password: '',
        attempts: 1,
        quiet: true,
      }),
      'contexte non vierge': (await sonder({ states: [200] })).result,
      'connexion impossible': (await sonder({ states: [401], waitForUrl: 'timeout' })).result,
      'session non ouverte': (await sonder({ states: [401, 401] })).result,
    };

    for (const [nom, result] of Object.entries(cas)) {
      const messages = result.errors.join('\n');
      expect(result.ok, nom).toBe(false);
      // La FAMILLE est dans le message, pas seulement dans le titre de
      // l'annotation : le journal de CI doit se relire seul.
      expect(messages, nom).toContain(libelle);
      // Le refus se DÉCLARE prémisse : il n'a rien jugé.
      expect(result.errors[0].startsWith(`${libelle} : ${MARQUE_PREMISSE}`), nom).toBe(true);
      // …et il nomme le refus qui, lui, juge le rechargement.
      expect(messages, nom).toContain(RENVOI_RECHARGEMENT);
      expect(messages, nom).toContain('check-session-reload-production.js');
      // La famille publiée est bien celle de cette sonde.
      expect(FAMILLE, nom).toBe('exposition du jeton');
    }
  });
});

// ─── 4. Le shell natif : le jeton doit SURVIVRE au redémarrage ─────────────

describe('check-token-exposure — le verdict du shell natif', () => {
  it('sans écriture, il refuse AVANT tout : la surface native n’est pas établie', () => {
    const refus = jugerSessionNative();

    expect(refus).toHaveLength(1);
    expect(refus[0]).toContain("la connexion n'a écrit AUCUN jeton");
  });

  it('avec la seule écriture, il refuse le silence du redémarrage — et rien d’autre', () => {
    const refus = jugerSessionNative({ jetonEcrit: true });

    expect(refus).toHaveLength(1);
    expect(refus[0]).toContain("l'application n'a pas sondé");
  });
});

describe('check-token-exposure — le shell natif, jugé à l’envers', () => {
  it('accepte un jeton natif qui survit au redémarrage, et dit ce qu’il a lu', async () => {
    const { result, journal } = await sonder({ states: [401, 200, RELEVE_VIDE] });

    expect(result.errors).toEqual([]);
    expect(result.verdicts.native).toMatchObject({
      jetonEcrit: true,
      statutAuthMe: 200,
      bearer: true,
      cookies: 0,
    });
    expect(journal.connexionsNatives).toBe(1);
    expect(journal.redemarrages).toBe(1);
    expect(result.checked.join('\n')).toContain('shell natif · connexion : le jeton est écrit');
    expect(result.checked.join('\n')).toContain(
      'shell natif · jeton après le redémarrage : présent (localStorage)'
    );
  });

  it('refuse un contexte natif où RIEN n’a été écrit : il jugerait le web en croyant juger le natif', async () => {
    const { result, journal } = await sonder({
      states: [401, 200, RELEVE_VIDE],
      natif: { jetonEcrit: false },
    });

    expect(result.errors.join('\n')).toContain("la connexion n'a écrit AUCUN jeton");
    expect(result.ok).toBe(false);
    // Aucun redémarrage n'est jugé sur une surface qui n'a pas été établie.
    expect(journal.redemarrages).toBe(0);
    expect(journal.contextes).toBe(2);
  });

  it('refuse un jeton qui ne survit PAS au redémarrage, et nomme la session perdue', async () => {
    const { result } = await sonder({
      states: [401, 200, RELEVE_VIDE],
      natif: { statutAuthMe: 401, jetonApres: { presence: false } },
    });

    expect(result.errors.join('\n')).toContain("le jeton n'a PAS survécu au redémarrage");
    expect(result.errors.join('\n')).toContain('la session est PERDUE');
    expect(result.ok).toBe(false);
  });

  it('refuse un redémarrage porté par un COOKIE : il ne prouverait pas que le jeton suffit', async () => {
    const { result } = await sonder({ states: [401, 200, RELEVE_VIDE], natif: { cookies: 2 } });

    expect(result.errors.join('\n')).toContain('le redémarrage simulé porte 2 cookie(s)');
    expect(result.ok).toBe(false);
  });

  it('refuse une session restaurée SANS le jeton', async () => {
    const { result } = await sonder({ states: [401, 200, RELEVE_VIDE], natif: { bearer: false } });

    expect(result.errors.join('\n')).toContain('SANS en-tête Authorization');
    expect(result.ok).toBe(false);
  });

  it('refuse une application muette au redémarrage : rien n’a été tenté', async () => {
    const { result } = await sonder({ states: [401, 200, RELEVE_VIDE], natif: { statutAuthMe: null } });

    expect(result.errors.join('\n')).toContain("l'application n'a pas sondé");
    expect(result.ok).toBe(false);
  });

  it('refuse une connexion native impossible, sans juger de redémarrage', async () => {
    const { result, journal } = await sonder({
      states: [401, 200, RELEVE_VIDE],
      natif: { connexion: 'timeout' },
    });

    expect(result.errors.join('\n')).toContain('shell natif : connexion impossible');
    expect(result.ok).toBe(false);
    expect(journal.redemarrages).toBe(0);
  });

  it('pose le marqueur natif avant chaque navigation native, et JAMAIS sur la page web', async () => {
    const { journal } = await sonder({ states: [401, 200, RELEVE_VIDE] });

    // Les deux pages natives portent le marqueur…
    expect(journal.initScripts[1]).toBe(sourceMarqueurNatif());
    expect(journal.initScripts[2]).toBe(sourceMarqueurNatif());
    // …et la page web ne le porte pas : un bundle web qui se croirait natif
    // écrirait le jeton que la moitié web refuse.
    expect(journal.initScripts[0]).not.toContain('Capacitor');
    expect(journal.initScripts[0]).toContain(CLE_RELEVE_AVANT_BOOT);
  });
});

// ─── 5. Les options ─────────────────────────────────────────────────────────

describe('check-token-exposure — le script du premier instant', () => {
  it('emprunte la MÊME lecture du domaine, et dépose son relevé sous une clé nommée', () => {
    const source = sourceReleveAvantBoot();

    expect(source).toContain(CLE_RELEVE_AVANT_BOOT);
    // Une seconde copie des règles pourrait juger autre chose que le relevé
    // final : le motif des clés de justificatif est donc exigé dans la source.
    expect(source).toContain('token|jwt|auth');
    expect(source).toContain('document.cookie');
    // Le script doit être inerte si la page refuse la lecture : il ne casse pas
    // l'amorçage de l'application qu'il observe.
    expect(source.startsWith('try {')).toBe(true);
  });
});

describe('check-token-exposure — options de ligne de commande', () => {
  it('n’impose aucune surface : les options remplacent les défauts', () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs(['--base', 'https://preview.test'])).toEqual({ base: 'https://preview.test' });
    expect(parseArgs(['--tentatives', '2', '--delai', '5'])).toEqual({ attempts: 2, delayMs: 5000 });
    // Un drapeau sans valeur ne mange pas le suivant : il est ignoré.
    expect(parseArgs(['--base'])).toEqual({});
    // Le drapeau d'un AUTRE geste (celui de la sonde de session) n'a pas d'effet
    // ici : cette sonde ne juge qu'une chose, la surface servie.
    expect(parseArgs(['--cross-site', 'https://api.test'])).toEqual({});
  });
});
