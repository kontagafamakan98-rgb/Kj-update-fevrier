import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// Même logique que le garde CI : le test n'a AUCUNE détection propre, il
// importe celle de scripts/check-pack2-i18n-hygiene.js (une seule source de
// vérité, donc impossible que le test et le job divergent).
import { analyzeAllScopes } from '../../../scripts/check-pack2-i18n-hygiene.js';

// Garde-fou de régression sur l'hygiène des dictionnaires pack2PageI18n.
// Deux dérives historiques, corrigées manuellement dans le scope `register`
// (17 lignes supprimées : clé `geoDetecting`, overrides `stepEmail` /
// `stepPayments` / `legalContactLine` / `referralCodeLabel` identiques à fr),
// ne doivent pas réapparaître :
//   1. CLÉ INUTILISÉE : une clé du dictionnaire d'un scope que AUCUNE page
//      consommatrice n'appelle (ni statiquement pageT('key'), ni dynamiquement
//      pageT(`prefix${...}`) / pageT('prefix' + x), ni via les clés d'erreur
//      littérales setError('key')). Ces clés alourdissent le chunk lazy sans
//      jamais être affichées.
//   2. OVERRIDE REDONDANT : une clé wo/bm/mos strictement identique à fr.
//      Les dictionnaires wo/bm/mos héritent déjà de fr via withBase : un
//      override identique est du poids mort pur.
//
// Vérifié sur TOUS les scopes (auto-découverts) à chaque `npm test` — en plus
// de l'étape CI dédiée `Check pack2PageI18n i18n hygiene`.

const PACK2_DIR = path.resolve(__dirname, '../pack2PageI18n');
const SRC_ROOT = path.resolve(__dirname, '../..');

// Modules de scope réellement présents sur le disque. L'attendu est DÉRIVÉ
// (même convention que pack2Splitting.test.js) : un compte figé obligerait à
// retoucher le test à chaque scope ajouté ou fusionné, sans qu'aucune
// régression ne soit en cause. `core.js` en est exclu : ce n'est pas un scope.
const SCOPE_FILES = fs
  .readdirSync(PACK2_DIR)
  .filter((f) => f.endsWith('.js') && f !== 'core.js')
  .map((f) => f.replace(/\.js$/, ''))
  .sort();

const results = analyzeAllScopes({ pack2Dir: PACK2_DIR, srcRoot: SRC_ROOT });

describe('hygiène des dictionnaires pack2PageI18n', () => {
  it('analyse chaque module de scope du disque, et lui seul (core.js exclu)', () => {
    expect(results.map((r) => r.scope).sort()).toEqual(SCOPE_FILES);
    for (const r of results) expect(r.keyCount).toBeGreaterThan(0);
  });

  it("aucune clé inutilisée dans un scope (statique + dynamique + clés d'erreur)", () => {
    const offenders = results.flatMap((r) => r.unused.map((k) => `${r.scope}.${k}`));
    expect(
      offenders,
      `clés inutilisées dans un scope pack2PageI18n (jamais appelées par pageT, même dynamiquement) :\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('aucun override wo/bm/mos identique à fr (poids mort hérité via withBase)', () => {
    const redundant = results.flatMap((r) =>
      r.redundant.map((k) => `${r.scope}.${k}`)
    );
    expect(
      redundant,
      `overrides wo/bm/mos identiques à fr (déjà hérités via withBase, pur poids mort) :\n${redundant.join('\n')}`
    ).toEqual([]);
  });
});
