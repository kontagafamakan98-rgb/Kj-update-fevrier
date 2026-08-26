import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../api';

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
