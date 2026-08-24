import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import fr from '../../i18n/fr.json';
import en from '../../i18n/en.json';
import wo from '../../i18n/wo.json';
import bm from '../../i18n/bm.json';
import mos from '../../i18n/mos.json';
import { makeScopedTranslator } from '../pack2PageI18n';

// Ce test complète i18nParity.test.js : ce dernier vérifie que les 5 langues
// contiennent les MÊMES clés, mais pas que chaque appel t()/pageT() du code
// résout une clé existante. Or t()/pageT() renvoient la clé BRUTE quand elle
// est absente (chaîne truthy) → le fallback `|| '...'` ne s'applique jamais et
// l'utilisateur voit littéralement « deleteAccountTitle », « loadOlderExists »,
// etc. C'est exactement le bug corrigé en 2026 ; ce test empêche la régression.

const LANGUAGES = { fr, en, wo, bm, mos };
const LANGS = Object.keys(LANGUAGES);

// Reproduit le comportement de LanguageContext.t() : clé absente → clé brute.
const globalT = (lang) => (key) => (LANGUAGES[lang][key] !== undefined ? LANGUAGES[lang][key] : key);

// Racine de src/ (le test vit dans src/utils/__tests__/).
// __dirname est fourni par vitest ; import.meta.url n'est pas une URL file:.
const SRC_ROOT = path.resolve(__dirname, '../..');

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

function sourceFiles() {
  return [
    ...walk(path.join(SRC_ROOT, 'pages')),
    ...walk(path.join(SRC_ROOT, 'components')),
    ...walk(path.join(SRC_ROOT, 'contexts')),
    path.join(SRC_ROOT, 'App.js'),
  ].filter((file) => fs.existsSync(file));
}

// Capture (pageT|t)('key') / (pageT|t)("key"). Les clés dynamiques (variables,
// template literals avec ${...}) sont ignorées : non vérifiables statiquement.
function collectCalls(source) {
  return [...source.matchAll(/\b(pageT|t)\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*\)/g)].map((m) => ({
    kind: m[1],
    key: m[2],
  }));
}

// Scope littéral d'un makeScopedTranslator(..., 'scope'). Les scopes dynamiques
// (ex. ToastContainer avec toast.scope) sont ignorés.
function findScope(source) {
  const m = source.match(/makeScopedTranslator\([^)]*,\s*(?:t|fallbackT)\s*,\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*\)/);
  return m ? m[1] : null;
}

describe('i18n coverage des appels t() / pageT()', () => {
  it("chaque clé t('...') existe dans le dictionnaire global des 5 langues", () => {
    const missing = new Set();

    for (const file of sourceFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      for (const { kind, key } of collectCalls(source)) {
        if (kind !== 't') continue;
        const absentLangs = LANGS.filter((lang) => LANGUAGES[lang][key] === undefined);
        if (absentLangs.length > 0) {
          // La parité (i18nParity.test.js) garantit que les 5 langues ont les
          // mêmes clés globales : une absence = absente partout. On dédoublonne
          // le rapport par fichier/clé.
          missing.add(`${path.relative(SRC_ROOT, file)}: t('${key}')`);
        }
      }
    }

    expect(
      [...missing],
      `clés t() manquantes dans le dictionnaire global (affichées brutes à l'utilisateur) :\n${[...missing].join('\n')}`
    ).toEqual([]);
  });

  it("chaque clé pageT('...') résout via son scope ou le dictionnaire global, dans les 5 langues", () => {
    const missing = new Set();

    for (const file of sourceFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      const scope = findScope(source);
      if (!scope) continue;

      for (const { kind, key } of collectCalls(source)) {
        if (kind !== 'pageT') continue;
        for (const lang of LANGS) {
          // Résolution réelle (makeScopedTranslator) : clé brute = manquante.
          const resolved = makeScopedTranslator(lang, globalT(lang), scope)(key);
          if (resolved === key) {
            missing.add(`${path.relative(SRC_ROOT, file)}: pageT('${key}') [scope ${scope}, lang ${lang}]`);
          }
        }
      }
    }

    expect(
      [...missing],
      `clés pageT() manquantes (affichées brutes à l'utilisateur) :\n${[...missing].join('\n')}`
    ).toEqual([]);
  });
});
