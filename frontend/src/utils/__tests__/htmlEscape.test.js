import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../htmlEscape';

describe('escapeHtml (sécurité XSS)', () => {
  it('échappe les caractères HTML sensibles', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('échappe les guillemets pour les attributs', () => {
    expect(escapeHtml('"><img src=x onerror=alert(1)>')).toBe(
      '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'
    );
    expect(escapeHtml("l'apostrophe")).toBe('l&#39;apostrophe');
  });

  it('échappe le & (double échappement évité)', () => {
    expect(escapeHtml('a & b < c')).toBe('a &amp; b &lt; c');
    // Pas de double-échappement : une entité déjà codée le reste.
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('gère null, undefined et non-chaînes sans planter', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml('')).toBe('');
  });

  it('laisse le texte sain intact', () => {
    expect(escapeHtml('Adresse, quartier — Dakar')).toBe('Adresse, quartier — Dakar');
  });
});