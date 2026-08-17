import { describe, it, expect } from 'vitest';
import { buildApiUrl } from '../backendUrl';

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
});
