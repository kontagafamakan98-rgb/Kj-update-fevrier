import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  extractScopePayload,
  scopePayloadBytes,
  scopePayloadGzipBytes,
  scopeBudgetBytes,
  runPack2Check,
} from '../check-pack2-chunks';

// Tests du MESUREUR de poids pack2PageI18n (scripts/check-pack2-chunks.js) :
//   - le payload extrait correspond aux VALEURS de traduction réelles
//     (dédupliquées, langues exclues, commentaires ignorés) ;
//   - le budget alerte quand un dictionnaire dépasse le seuil.
//
// runPack2Check sur le dépôt + le build réels n'est pas rejoué ici : l'étape
// « Check pack2PageI18n chunk splitting » de la CI l'exécute après `vite build`,
// sur le vrai bundle — que cette suite, qui tourne avant le build, ne peut pas voir.

const PACK2_DIR = path.resolve(__dirname, '../../src/utils/pack2PageI18n');
const readScope = (name) => fs.readFileSync(path.join(PACK2_DIR, `${name}.js`), 'utf8');

describe('check-pack2-chunks : mesureur de poids des dictionnaires', () => {
  afterEach(() => {
    delete process.env.PACK2_SCOPE_BUDGET_BYTES;
  });

  it('extrait les valeurs de traduction (dédupliquées, sans langues ni code)', () => {
    const jobsSrc = readScope('jobs');
    const payload = extractScopePayload(jobsSrc);

    // Valeurs fr/en réelles du scope jobs.
    expect(payload).toContain('Titre ou description...');
    expect(payload).toContain('Title or description...');
    expect(payload).toContain('Emplois disponibles');
    expect(payload).toContain('Available jobs');

    // Une valeur présente dans fr ET en n'est comptée qu'une fois.
    expect(payload.filter((v) => v === 'Apply').length).toBeLessThanOrEqual(1);
    expect(new Set(payload).size).toBe(payload.length);

    // Les noms de langues ('fr', 'en', 'wo', 'bm', 'mos') ne sont pas du payload.
    for (const lang of ['fr', 'en', 'wo', 'bm', 'mos']) {
      expect(payload).not.toContain(lang);
    }

    // Aucun fragment de code (parenthèses/égalités).
    for (const v of payload) {
      expect(v).not.toMatch(/[({=<>]/);
    }
  });

  it('calcule les octets UTF-8 réels (accents comptés) et une estimation gzip', () => {
    const jobsSrc = readScope('jobs');
    const bytes = scopePayloadBytes(jobsSrc);
    const gzip = scopePayloadGzipBytes(jobsSrc);

    // Payload strictement positif, gzip inférieur au raw (redondance des langues).
    expect(bytes).toBeGreaterThan(0);
    expect(gzip).toBeGreaterThan(0);
    expect(gzip).toBeLessThan(bytes);

    // Les valeurs accentuées comptent leurs octets multi-octets : 'Découvrir'
    // = 9 caractères mais 10 octets UTF-8.
    expect(Buffer.byteLength('Découvrir', 'utf8')).toBe(10);
  });

  it('budget surchargeable via PACK2_SCOPE_BUDGET_BYTES, repli sur le défaut si invalide', () => {
    const fallback = scopeBudgetBytes();
    process.env.PACK2_SCOPE_BUDGET_BYTES = '5000';
    expect(scopeBudgetBytes()).toBe(5000);
    process.env.PACK2_SCOPE_BUDGET_BYTES = 'abc';
    expect(scopeBudgetBytes()).toBe(fallback); // invalide → défaut
  });

  it('alerte quand un dictionnaire dépasse le budget', () => {
    // Le plus gros scope du dépôt (register, ~5,8 kB) : un budget de 100
    // octets doit déclencher l'alerte.
    const result = runPack2Check({ root: path.resolve(__dirname, '../..'), budget: 100 });
    const overBudget = result.errors.some((e) => e.includes('> budget'));
    expect(overBudget).toBe(true);
  });
});
