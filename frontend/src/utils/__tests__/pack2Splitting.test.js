import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Régression « découpage par scope de pack2PageI18n » — niveau SOURCE.
// Le check CI frontend/scripts/check-pack2-chunks.js vérifie le signal dans
// le BUNDLE buildé (aucun chunk partagé ne doit porter ≥ 3 dictionnaires de
// scopes). Ce test source complète le garde-fou AVEC une exécution rapide à
// chaque `npm test` (avant même le build) :
//   1. core.js (seul module partagé, importé par toutes les pages) ne
//      contient AUCUNE valeur de dictionnaire — s'il ré-embarquait des
//      traductions, le monolithe réapparaîtrait dans le chunk partagé au
//      build (le signal exact que détecte le check CI).
//   2. chaque module de scope n'importe jamais un AUTRE scope : seule
//      l'importation de core.js (helpers, par design) est autorisée. Une
//      fusion croisée de dictionnaires ferait monter le compte de scopes
//      d'un chunk vers le seuil du check buildé.

const PACK2_DIR = path.resolve(__dirname, '../pack2PageI18n');
const SCOPES = fs
  .readdirSync(PACK2_DIR)
  .filter((f) => f.endsWith('.js') && f !== 'core.js')
  .map((f) => f.replace(/\.js$/, ''));
const CORE_FILE = path.join(PACK2_DIR, 'core.js');

// Chaînes fr citées de ≥ 20 caractères, mono-lignes, sans fragments de code.
// (mêmes critères que check-pack2-chunks.js)
const extractCandidates = (src) =>
  [...src.matchAll(/'((?:[^'\\\n]|\\.){20,})'/g)]
    .map((m) => m[1].replace(/\\'/g, "'"))
    .filter((v) => !/[({=<>]/.test(v));

describe('pack2PageI18n découpage par scope (niveau source)', () => {
  it('core.js ne contient aucun dictionnaire (helpers uniquement)', () => {
    const coreSrc = fs.readFileSync(CORE_FILE, 'utf8');
    const dictionaryValues = [];
    for (const scope of SCOPES) {
      const scopeSrc = fs.readFileSync(path.join(PACK2_DIR, `${scope}.js`), 'utf8');
      for (const v of extractCandidates(scopeSrc)) {
        if (coreSrc.includes(v)) dictionaryValues.push(`${scope}: «${v.slice(0, 60)}…»`);
      }
    }
    expect(
      dictionaryValues,
      `core.js (module partagé) embarque des valeurs de dictionnaire — le monolithe réapparaît dans le chunk partagé :\n${dictionaryValues.join('\n')}`
    ).toEqual([]);
  });

  it("chaque scope n'importe jamais un AUTRE scope (core.js autorisé — helpers par design)", () => {
    const offenders = [];
    for (const scope of SCOPES) {
      const src = fs.readFileSync(path.join(PACK2_DIR, `${scope}.js`), 'utf8');
      // Import relatif vers un autre module du dossier (core ou un scope).
      const imports = [...src.matchAll(/from\s+['"]\.\/([a-zA-Z][a-zA-Z0-9]*)['"]/g)].map((m) => m[1]);
      for (const imported of imports) {
        // core.js = helpers partagés (getLocaleForLanguage, etc.) : autorisé.
        // Un AUTRE scope = fusion croisée de dictionnaires : interdit.
        if (imported !== scope && imported !== 'core') {
          offenders.push(`${scope}.js → ${imported}.js`);
        }
      }
    }
    expect(
      offenders,
      `Imports croisés entre modules de scope pack2PageI18n (fusion de dictionnaires) :\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
