/**
 * Parité de la règle d'équilibre des balises avec le BACKEND.
 *
 * La règle vit ici (vite-plugins/prerender/balises.js) et, côté serveur, dans
 * backend/kojo_balises.py. Deux implémentations sans jeu commun divergent sur un
 * cas limite sans que personne le voie. Le jeu de cas est donc UN fichier,
 * backend/tests/fixtures/balises_equilibre_cas.json, produit par CETTE règle :
 * ce test vérifie que la règle rend toujours ce fichier, et le test Python
 * vérifie qu'il rend le même résultat. Une modification de la règle sans
 * régénération du fichier fait rougir ce test, en nommant le cas.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { desequilibresDesBalises, decrireDesequilibre } from '../../vite-plugins/prerender/balises.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(ICI, '..', '..', '..', 'backend', 'tests', 'fixtures', 'balises_equilibre_cas.json');
const CAS = JSON.parse(readFileSync(FIXTURE, 'utf8'));

describe('équilibre des balises — parité avec le backend', () => {
  it('lit un jeu de cas réel, pas un fichier vide', () => {
    expect(CAS.length).toBeGreaterThanOrEqual(20);
  });

  for (const cas of CAS) {
    it(`rend le même résultat que le backend : ${cas.nom}`, () => {
      const problemes = desequilibresDesBalises(cas.html);
      expect(problemes).toEqual(cas.attendu);
      expect(problemes.map(decrireDesequilibre)).toEqual(cas.messages);
    });
  }
});
