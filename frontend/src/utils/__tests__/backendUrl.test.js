import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildApiUrl, buildBackendUrl, getBackendBaseUrl } from '../backendUrl';

// Bug réel corrigé : GET /api/api/users/payment-accounts → 404. La base
// (REACT_APP_BACKEND_URL / VITE_API_URL) peut être définie avec OU sans le
// suffixe /api ; buildApiUrl ne doit JAMAIS produire un double préfixe.
describe('buildApiUrl', () => {
  it('ne produit jamais un double préfixe /api/api', () => {
    const url = buildApiUrl('/users/payment-accounts');
    expect(url).not.toContain('/api/api');
  });

  it('termine par /api + chemin (base avec OU sans /api)', () => {
    const url = buildApiUrl('/users/payment-accounts');
    expect(url.endsWith('/api/users/payment-accounts')).toBe(true);
  });

  it('base vide → renvoie un chemin relatif /api/...', () => {
    expect(buildApiUrl('')).toMatch(/\/api$/);
    expect(buildApiUrl('/health')).toMatch(/\/api\/health$/);
  });

  it('chemin déjà préfixé /api/… : pas de double préfixe', () => {
    const url = buildApiUrl('/api/users/payment-accounts');
    expect(url).not.toContain('/api/api');
    expect(url.endsWith('/api/users/payment-accounts')).toBe(true);
  });

  it('base configurée avec /api → un seul /api', () => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example/api');
    expect(buildApiUrl('/users')).toBe('https://stub.example/api/users');
  });

  it('base configurée sans /api → /api ajouté une seule fois', () => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example');
    expect(buildApiUrl('/users')).toBe('https://stub.example/api/users');
  });

  it('base avec slash final → normalisée, un seul /api', () => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example/api/');
    expect(buildApiUrl('/users')).toBe('https://stub.example/api/users');
  });

  it('base avec un /api/api en dur → ramenée à un seul /api (durcissement)', () => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example/api/api');
    expect(buildApiUrl('/users')).toBe('https://stub.example/api/users');
  });

  it('conserve la query string du chemin', () => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example');
    expect(buildApiUrl('/geolocation/reverse?lat=14.7&lng=-17.4')).toBe(
      'https://stub.example/api/geolocation/reverse?lat=14.7&lng=-17.4'
    );
  });

  it('chemin sans slash initial → slash ajouté', () => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example');
    expect(buildApiUrl('users')).toBe('https://stub.example/api/users');
  });
});

describe('getBackendBaseUrl — priorité des sources', () => {
  it('override runtime window.__KOJO_API_URL__ gagne sur l’env', () => {
    window.__KOJO_API_URL__ = 'https://runtime.example/api';
    vi.stubEnv('VITE_API_URL', 'https://stub.example');
    expect(getBackendBaseUrl()).toBe('https://runtime.example/api');
    expect(buildApiUrl('/x')).toBe('https://runtime.example/api/x');
  });

  it('window.__API_URL__ est aussi un override runtime valide', () => {
    window.__API_URL__ = 'https://runtime2.example';
    expect(getBackendBaseUrl()).toBe('https://runtime2.example');
  });

  it('VITE_API_BASE_URL est utilisé si VITE_API_URL est absent', () => {
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('VITE_API_BASE_URL', 'https://stub.example/base');
    expect(getBackendBaseUrl()).toBe('https://stub.example/base');
  });

  it('repli dev : localhost → localhost:8000', () => {
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_BACKEND_URL', '');
    expect(getBackendBaseUrl()).toBe('http://localhost:8000');
  });

  it('défaut absolu : https://kojo-backend.fly.dev (sans window)', () => {
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_BACKEND_URL', '');
    vi.stubGlobal('window', undefined);
    expect(getBackendBaseUrl()).toBe('https://kojo-backend.fly.dev');
  });
});

describe('buildBackendUrl — URLs de ressources (photos)', () => {
  it('base avec /api + chemin déjà préfixé /api → un seul /api (durcissement)', () => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example/api');
    expect(buildBackendUrl('/api/uploads/p.jpg')).toBe('https://stub.example/api/uploads/p.jpg');
  });

  it('base sans /api + chemin /api/... → base + chemin', () => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example');
    expect(buildBackendUrl('/api/uploads/p.jpg')).toBe('https://stub.example/api/uploads/p.jpg');
  });

  it('base avec /api + chemin relatif sans /api → base + chemin', () => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example/api');
    expect(buildBackendUrl('/uploads/p.jpg')).toBe('https://stub.example/api/uploads/p.jpg');
  });

  it('chemin sans slash initial → slash ajouté', () => {
    vi.stubEnv('VITE_API_URL', 'https://stub.example');
    expect(buildBackendUrl('uploads/p.jpg')).toBe('https://stub.example/uploads/p.jpg');
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete window.__KOJO_API_URL__;
  delete window.__API_URL__;
  delete window.__KOJO_USE_SAME_ORIGIN_API__;
});

// Proxy même-origine (production via rewrite Vercel /api/* → Fly) : en prod
// sur une origine servie, getBackendBaseUrl renvoie '' (origine nue) et
// buildApiUrl produit un chemin RELATIF /api/... → les cookies httpOnly
// deviennent same-site (résout le blocage Safari ITP des cookies tiers).
// Le mode direct vers Fly reste activable via window.__KOJO_USE_SAME_ORIGIN_API__ = false.
describe('proxy même-origine (production)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.__KOJO_USE_SAME_ORIGIN_API__;
  });

  it('override runtime __KOJO_USE_SAME_ORIGIN_API__ = false → garde Fly direct', () => {
    window.__KOJO_USE_SAME_ORIGIN_API__ = false;
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_BACKEND_URL', '');
    // En jsdom, window.location.hostname = 'localhost' → repli dev
    // localhost:8000 (le proxy même-origine ne s'active que sur une origine
    // servie hors localhost). On vérifie juste que l'override false court-
    // circuitu le proxy et retombe sur le repli dev (comportement attendu).
    expect(getBackendBaseUrl()).toBe('http://localhost:8000');
    expect(buildApiUrl('/users')).toBe('http://localhost:8000/api/users');
  });
});
