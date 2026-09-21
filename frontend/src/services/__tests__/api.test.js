import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, handleApiError, TRANSPORT_FAILURE_MESSAGE, SERVER_FAILURE_MESSAGE } from '../api';
import fr from '../../i18n/fr.json';

// api.js doit construire ses URLs via le module unique buildApiUrl : la base
// (VITE_API_URL / REACT_APP_BACKEND_URL) peut être définie avec OU sans /api,
// et le résultat ne doit JAMAIS contenir de double préfixe /api/api.
describe('api — construction d’URL via buildApiUrl', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('GET : URL = base + /api + chemin', async () => {
    await api.get('/auth/me');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://stub.example/api/auth/me',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('chemin sans slash initial → normalisé', async () => {
    await api.get('auth/me');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://stub.example/api/auth/me',
      expect.anything()
    );
  });

  it('chemin déjà préfixé /api/ → pas de double préfixe', async () => {
    await api.get('/api/users');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://stub.example/api/users',
      expect.anything()
    );
  });

  it('base configurée avec /api → un seul /api', async () => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example/api');
    await api.get('/auth/me');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://stub.example/api/auth/me',
      expect.anything()
    );
  });

  it('params de requête ajoutés en query string', async () => {
    await api.get('/jobs', { params: { page: 1, q: 'a b' } });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://stub.example/api/jobs?page=1&q=a+b',
      expect.anything()
    );
  });

  it('POST : URL correcte + body JSON', async () => {
    await api.post('/auth/login', { email: 'a@b.c' });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://stub.example/api/auth/login');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ email: 'a@b.c' });
  });

  it('override runtime window.__KOJO_API_URL__ gagne sur l’env', async () => {
    window.__KOJO_API_URL__ = 'https://runtime.example';
    await api.get('/auth/me');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://runtime.example/api/auth/me',
      expect.anything()
    );
    delete window.__KOJO_API_URL__;
  });
});

describe('api — session 401 (token stale vs session morte) et CSRF', () => {
  const CSRF = 'csrf-test-value';

  const setSessionCookie = () => {
    document.cookie = `kojo_csrf=${CSRF}; path=/`;
  };

  const clearSessionCookie = () => {
    document.cookie = 'kojo_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  };

  // jsdom ne sait pas naviguer : on remplace window.location par un objet
  // dont le setter href enregistre la cible PUIS lève (comme le ferait
  // jsdom réel). api.js attrape cette exception et réinitialise son garde-
  // fou anti-boucle, ce qui garde les tests suivants herméétiques.
  const fakeLocation = () => {
    let target = '';
    const location = {};
    Object.defineProperty(location, 'pathname', { value: '/jobs', writable: true });
    Object.defineProperty(location, 'href', {
      get: () => target,
      set: (value) => {
        target = String(value);
        throw new Error('jsdom navigation not implemented');
      },
    });
    Object.defineProperty(window, 'location', { value: location, writable: true, configurable: true });
    return { getRedirectTarget: () => target };
  };

  const mock401 = () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"detail":"Invalid token"}',
    });
  };

  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example');
    localStorage.clear();
    sessionStorage.clear();
    clearSessionCookie();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearSessionCookie();
  });

  it('401 avec cookie de session valide → purge le token stale, PAS de redirection', async () => {
    setSessionCookie();
    localStorage.setItem('token', 'stale.token.abc');
    const location = fakeLocation();
    mock401();

    await expect(api.get('/users/payment-accounts')).rejects.toThrow('Invalid token');

    // Auto-guérison : le token stale est purgé, la session cookie intacte
    // (pas de redirection vers /login — l'utilisateur est toujours connecté).
    expect(localStorage.getItem('token')).toBeNull();
    expect(location.getRedirectTarget()).toBe('');
  });

  it('401 sans cookie de session → purge ET redirige vers /login', async () => {
    localStorage.setItem('token', 'stale.token.abc');
    const location = fakeLocation();
    mock401();

    await expect(api.get('/users/payment-accounts')).rejects.toThrow('Invalid token');

    expect(localStorage.getItem('token')).toBeNull();
    expect(location.getRedirectTarget()).toBe('/login');
  });

  it('401 sur un endpoint métier (login) ne redirige pas', async () => {
    localStorage.setItem('token', 'stale.token.abc');
    const location = fakeLocation();
    mock401();

    await expect(api.post('/auth/login', { email: 'a@b.c', password: 'x' })).rejects.toThrow('Invalid token');
    // BUSINESS_401_PREFIXES : le 401 du login est un résultat métier
    expect(location.getRedirectTarget()).toBe('');
  });

  it('POST envoie X-CSRFToken quand le cookie kojo_csrf est présent', async () => {
    setSessionCookie();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    await api.post('/jobs', { title: 'Test' });
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['X-CSRFToken']).toBe(CSRF);
  });

  it('GET n’envoie pas X-CSRFToken (lecture seule)', async () => {
    setSessionCookie();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    await api.get('/jobs');
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['X-CSRFToken']).toBeUndefined();
  });

  it('401 avec session récupérable → sonde /auth/me, tourne le jeton et rejoue (pas de redirection)', async () => {
    localStorage.setItem('token', 'expired.token.abc');
    const location = fakeLocation();
    const rotated = 'fresh.token.xyz';
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 401, text: async () => '{"detail":"Invalid token"}', headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, text: async () => '{}',
        headers: { get: (name) => (name === 'X-Kojo-Token' ? rotated : null) },
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, text: async () => '{"ok":true}', headers: { get: () => null },
      });

    const result = await api.get('/users/payment-accounts');

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    // 1) mutation 401 → 2) sonde /auth/me → 3) rejeu de la mutation.
    expect(global.fetch.mock.calls[1][0]).toContain('/api/auth/me');
    expect(global.fetch.mock.calls[2][0]).toContain('/api/users/payment-accounts');
    // Le jeton tourné par la sonde est stocké (plus de 401 à répétition).
    expect(localStorage.getItem('token')).toBe(rotated);
    expect(location.getRedirectTarget()).toBe('');
  });

  it('401 sur session réellement morte → purge + redirige (la sonde échoue aussi)', async () => {
    localStorage.setItem('token', 'expired.token.abc');
    const location = fakeLocation();
    // TOUTES les réponses sont des 401 (mutation + sonde /auth/me).
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => '{"detail":"Invalid token"}', headers: { get: () => null },
    });

    await expect(api.get('/users/payment-accounts')).rejects.toThrow('Invalid token');

    expect(localStorage.getItem('token')).toBeNull();
    expect(location.getRedirectTarget()).toBe('/login');
  });

  it('403 CSRF (mémoire périmée) → sonde /auth/me, rafraîchit le CSRF et rejoue la mutation', async () => {
    localStorage.setItem('token', 'still-valid-token');
    setSessionCookie();
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 403,
        text: async () => '{"detail":"Validation CSRF échouée. Jeton manquant ou invalide."}',
        headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, text: async () => '{}',
        headers: { get: (name) => (name === 'X-Kojo-CSRFToken' ? 'fresh-csrf' : null) },
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, text: async () => '{"ok":true}', headers: { get: () => null },
      });

    const result = await api.put('/users/profile', { first_name: 'X' });

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    // Le rejeu envoie le CSRF rafraîchi par la sonde (écho X-Kojo-CSRFToken).
    expect(global.fetch.mock.calls[2][1].headers['X-CSRFToken']).toBe('fresh-csrf');
  });

  it('deux mutations 401 simultanées → UNE sonde partagée, les deux rejouent avec le jeton tourné (pas de fausse déconnexion)', async () => {
    localStorage.setItem('token', 'expired.token.abc');
    const location = fakeLocation();
    const rotated = 'fresh.token.xyz';
    // mutation A 401 → mutation B 401 → sonde /auth/me 200 (rotation) →
    // rejeu A 200 → rejeu B 200.
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 401, text: async () => '{"detail":"Invalid token"}', headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        ok: false, status: 401, text: async () => '{"detail":"Invalid token"}', headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, text: async () => '{}',
        headers: { get: (name) => (name === 'X-Kojo-Token' ? rotated : null) },
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, text: async () => '{"okA":true}', headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, text: async () => '{"okB":true}', headers: { get: () => null },
      });

    const [resultA, resultB] = await Promise.all([
      api.get('/users/payment-accounts'),
      api.get('/jobs/mine'),
    ]);

    expect(resultA).toEqual({ okA: true });
    expect(resultB).toEqual({ okB: true });
    // Séquence des jetons envoyés sur les 4 appels hors sonde : les deux
    // tentatives INITIALES partent avec l'ancien jeton (d'où le 401), et les
    // deux REJEUX utilisent le jeton TOURNÉ par la sonde — jamais l'ancien
    // remplacé (le rejeu relit getAuthToken() au moment du rejeu).
    const allAuths = global.fetch.mock.calls
      .filter(([url]) => !url.includes('/api/auth/me'))
      .map(([, options]) => options.headers.Authorization);
    expect(allAuths).toEqual([
      'Bearer expired.token.abc',
      'Bearer expired.token.abc',
      `Bearer ${rotated}`,
      `Bearer ${rotated}`,
    ]);
    // Une SEULE sonde pour les deux échecs simultanés (anti-tempête).
    const meCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/api/auth/me'));
    expect(meCalls).toHaveLength(1);
    // Aucune fausse déconnexion : le jeton tourné est conservé, pas de
    // redirection, et les deux mutations ont abouti.
    expect(localStorage.getItem('token')).toBe(rotated);
    expect(location.getRedirectTarget()).toBe('');
  });

  it('deux mutations 401 simultanées, session réellement morte → une seule sonde, purge locale (pas de fausse récupération)', async () => {
    localStorage.setItem('token', 'expired.token.abc');
    // Toutes les réponses (mutations + sonde) sont des 401.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => '{"detail":"Invalid token"}', headers: { get: () => null },
    });

    await expect(Promise.all([
      api.get('/users/payment-accounts'),
      api.get('/jobs/mine'),
    ])).rejects.toThrow('Invalid token');

    // Une seule sonde partagée a été tentée pour les deux échecs (anti-tempête),
    // puis chaque appelant retombe sur la gestion 401 : purge locale du jeton.
    // (La redirection vers /login peut être déléguée au garde de route quand une
    // session cookie / mémoire CSRF est encore détectée — invariants corrects
    // des deux côtés ; ce qui ne doit JAMAIS arriver, c'est une fausse
    // récupération ou une seconde sonde.)
    const meCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/api/auth/me'));
    expect(meCalls).toHaveLength(1);
    expect(localStorage.getItem('token')).toBeNull();
  });
});

// Rotation à fenêtre glissante : /auth/me renvoie X-Kojo-Token quand le jeton
// courant approche de l'expiration — le client doit le stocker immédiatement
// ('token' + token_expires_at) pour ne pas être déconnecté à 24 h.
describe('api — rotation du jeton (X-Kojo-Token)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example');
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('stocke le jeton tourné + son expiration depuis l’en-tête', async () => {
    const payload = btoa(JSON.stringify({ exp: 1800000000 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const rotated = `header.${payload}.sig`;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
      headers: { get: (name) => (name === 'X-Kojo-Token' ? rotated : null) },
    });

    await api.get('/auth/me');
    expect(localStorage.getItem('token')).toBe(rotated);
    expect(localStorage.getItem('token_expires_at')).toBe('1800000000000');
  });

  it('ne touche pas au token quand aucun X-Kojo-Token', async () => {
    localStorage.setItem('token', 'old-token');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
      headers: { get: () => null },
    });

    await api.get('/auth/me');
    expect(localStorage.getItem('token')).toBe('old-token');
  });
});

// Les pannes qui n'apportent AUCUN message du serveur sont le moment où
// l'utilisateur a le MOINS besoin de lire du texte technique : `fetch` rejette
// un TypeError anglais (« Failed to fetch »), et un proxy répond une page
// d'erreur HTML — du balisage, pas une phrase. La frontière de l'API remplace ce
// texte par la copie du produit et marque l'erreur (`hasServerMessage = false`),
// et la page qui sait traduire garde la main en passant son propre repli à
// `handleApiError`.
const PAGE_HTML_502 = '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>';

const reponse = (status, corps) => ({
  ok: false,
  status,
  text: async () => corps,
  headers: { get: () => null },
});

describe('api — panne sans message du serveur : aucun texte technique ne passe', () => {
  const sansMessageServeur = (message) => Object.assign(new Error(message), { hasServerMessage: false });

  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example');
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('la coupure de transport porte le message du produit, pas « Failed to fetch »', async () => {
    const erreur = await api.get('/jobs').catch((error) => error);
    expect(erreur.message).toBe(TRANSPORT_FAILURE_MESSAGE);
    expect(erreur.hasServerMessage).toBe(false);
  });

  it('une page d’erreur HTML d’un proxy (502) n’est jamais publiée comme message', async () => {
    global.fetch = vi.fn().mockResolvedValue(reponse(502, PAGE_HTML_502));
    const erreur = await api.get('/jobs').catch((error) => error);
    expect(erreur.message).toBe(SERVER_FAILURE_MESSAGE);
    expect(erreur.message).not.toMatch(/<!doctype|<html|<h1|502/i);
    expect(erreur.hasServerMessage).toBe(false);
    expect(erreur.response.data.detail).toBeUndefined();
  });

  it('un corps vide ou un JSON sans detail n’est pas remplacé par le statut brut', async () => {
    global.fetch = vi.fn().mockResolvedValue(reponse(500, ''));
    const vide = await api.get('/jobs').catch((error) => error);
    expect(vide.message).toBe(SERVER_FAILURE_MESSAGE);
    expect(vide.hasServerMessage).toBe(false);

    global.fetch = vi.fn().mockResolvedValue(reponse(500, '{"status":"error"}'));
    const sansDetail = await api.get('/jobs').catch((error) => error);
    expect(sansDetail.message).not.toBe('HTTP 500');
    expect(sansDetail.message).toBe(SERVER_FAILURE_MESSAGE);
  });

  it('les deux messages de repli sont ceux que le produit publie déjà (clés i18n)', () => {
    expect(TRANSPORT_FAILURE_MESSAGE).toBe(fr.networkConnectionError);
    expect(SERVER_FAILURE_MESSAGE).toBe(fr.unexpectedErrorText);
  });

  it('la page qui traduit garde la main sur son propre repli', () => {
    expect(handleApiError(sansMessageServeur(TRANSPORT_FAILURE_MESSAGE), 'Kojo est injoignable')).toBe('Kojo est injoignable');
    expect(handleApiError(sansMessageServeur(SERVER_FAILURE_MESSAGE), 'Réessayez dans un instant')).toBe('Réessayez dans un instant');
  });

  it('un message du serveur reste prioritaire, et rien d’autre ne change', async () => {
    global.fetch = vi.fn().mockResolvedValue(reponse(404, '{"detail":"Adresse inconnue"}'));
    const detail = await api.get('/jobs').catch((error) => error);
    expect(detail.message).toBe('Adresse inconnue');
    expect(detail.hasServerMessage).toBeUndefined();
    expect(handleApiError(detail, 'Repli')).toBe('Adresse inconnue');

    global.fetch = vi.fn().mockResolvedValue(reponse(400, 'Numéro invalide'));
    const texte = await api.get('/jobs').catch((error) => error);
    expect(texte.message).toBe('Numéro invalide');

    expect(handleApiError({ response: { data: { detail: 'Adresse inconnue' } } }, 'Erreur')).toBe('Adresse inconnue');
    expect(handleApiError({ response: { status: 500, data: { detail: 'Internal server error' } } }, 'Repli serveur')).toBe('Repli serveur');
    expect(handleApiError(new Error('Le fichier dépasse 5 Mo'), 'Erreur')).toBe('Le fichier dépasse 5 Mo');
  });

  it('une annulation volontaire n’est pas transformée en panne', async () => {
    global.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }));
    const erreur = await api.get('/jobs').catch((error) => error);
    expect(erreur.name).toBe('AbortError');
    expect(erreur.hasServerMessage).toBeUndefined();
  });
});
