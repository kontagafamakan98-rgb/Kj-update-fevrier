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
