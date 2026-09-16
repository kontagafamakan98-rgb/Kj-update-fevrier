import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Garde-fou de régression sur l'hygiène des dictionnaires pack2PageI18n.
// Deux dérives historiques, corrigées manuellement, ne doivent pas réapparaître :
//   1. CLÉ INUTILISÉE : une clé du dictionnaire d'un scope que AUCUNE page
//      consommatrice n'appelle (ni statiquement pageT('key'), ni dynamiquement
//      pageT(`prefix${...}`) / pageT('prefix' + x), ni via les clés d'erreur
//      littérales setError('key')). Ces clés alourdissent le chunk lazy sans
//      jamais être affichées.
//   2. OVERRIDE REDONDANT : une clé wo/bm/mos strictement identique à fr.
//      Les dictionnaires wo/bm/mos héritent déjà de fr via withBase : un
//      override identique est du poids mort pur.
//
// Vérifié sur TOUS les scopes (auto-découverts) à chaque `npm test`.

const PACK2_DIR = path.resolve(__dirname, '../pack2PageI18n');
const SRC_ROOT = path.resolve(__dirname, '../..');

const SCOPES = fs
  .readdirSync(PACK2_DIR)
  .filter((f) => f.endsWith('.js') && f !== 'core.js')
  .map((f) => f.replace(/\.js$/, ''));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

// Tous les fichiers source (pages, composants, contextes, App) : on cherche
// lesquels importent un scope → pages consommatrices réelles.
const sourceFiles = () =>
  walk(SRC_ROOT).filter((f) => {
    // Séparateurs normalisés en '/' (Windows : path.relative renvoie des
    // backslashes, ce qui casserait le startsWith('pages/')).
    const rel = path.relative(SRC_ROOT, f).split(path.sep).join('/');
    return (
      rel.startsWith('pages/') ||
      rel.startsWith('components/') ||
      rel.startsWith('contexts/') ||
      rel === 'App.js'
    );
  });

const consumersOf = (scope) => {
  const target = `pack2PageI18n/${scope}`;
  return sourceFiles().filter((f) => fs.readFileSync(f, 'utf8').includes(target));
};

// Extraction des blocs de langue : fr / en / wo / bm / mos.
const block = (src, start, end) => {
  const i = src.indexOf(start);
  if (i === -1) return '';
  const j = src.indexOf(end, i);
  return src.slice(i, j === -1 ? src.length : j);
};

const parseDict = (s) => {
  const dict = {};
  const re = /^\s{2}([a-zA-Z_]\w*): '((?:[^'\\]|\\.)*)'/gm;
  let m;
  while ((m = re.exec(s)) !== null) dict[m[1]] = m[2];
  return dict;
};

// Appels pageT('key') / pageT('key', {...}) statiques.
const staticPageTCalls = (src) => {
  const keys = new Set();
  for (const m of src.matchAll(/pageT\(\s*'([a-zA-Z_]\w*)'\s*[,)]/g)) keys.add(m[1]);
  return keys;
};

// Appels dynamiques par préfixe : pageT(`status_${x}`) → préfixe 'status_'.
const dynamicPrefixes = (src) => {
  const prefixes = new Set();
  for (const m of src.matchAll(/pageT\(\s*`([^`]*?)\$\{/g)) if (m[1]) prefixes.add(m[1]);
  for (const m of src.matchAll(/pageT\(\s*'([a-zA-Z_][a-zA-Z0-9_]*)'\s*\+/g)) prefixes.add(m[1]);
  return prefixes;
};

// Clés d'erreur littérales : setError('key') / setErrorKey('key') / setMessageKey('key').
const literalErrorKeys = (src) => {
  const keys = new Set();
  for (const m of src.matchAll(/set(?:Error|ErrorKey|MessageKey)\s*\([^)]*'([a-zA-Z_]\w*)'/g)) keys.add(m[1]);
  return keys;
};

describe('hygiène des dictionnaires pack2PageI18n', () => {
  it('aucune clé inutilisée dans un scope (statique + dynamique + clés d\'erreur)', () => {
    const offenders = [];

    for (const scope of SCOPES) {
      const src = fs.readFileSync(path.join(PACK2_DIR, `${scope}.js`), 'utf8');
      const fr = parseDict(block(src, 'fr: {', '\nen: {'));
      const en = parseDict(block(src, 'en: {', '\ndict.wo'));
      const wo = parseDict(block(src, 'dict.wo = withBase(dict.fr, {', '});\ndict.bm'));
      const bm = parseDict(block(src, 'dict.bm = withBase(dict.fr, {', '});\ndict.mos'));
      const mos = parseDict(block(src, 'dict.mos = withBase(dict.fr, {', '});\n'));
      const allKeys = new Set([
        ...Object.keys(fr),
        ...Object.keys(en),
        ...Object.keys(wo),
        ...Object.keys(bm),
        ...Object.keys(mos),
      ]);

      const used = new Set();
      const dynKeys = new Set();
      const prefixes = new Set();
      for (const consumer of consumersOf(scope)) {
        const csrc = fs.readFileSync(consumer, 'utf8');
        staticPageTCalls(csrc).forEach((k) => used.add(k));
        literalErrorKeys(csrc).forEach((k) => dynKeys.add(k));
        dynamicPrefixes(csrc).forEach((p) => prefixes.add(p));
      }

      for (const key of allKeys) {
        if (used.has(key) || dynKeys.has(key)) continue;
        if ([...prefixes].some((p) => key.startsWith(p))) continue;
        offenders.push(`${scope}.${key}`);
      }
    }

    expect(
      offenders,
      `clés inutilisées dans un scope pack2PageI18n (jamais appelées par pageT, même dynamiquement) :\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('aucun override wo/bm/mos identique à fr (poids mort hérité via withBase)', () => {
    const redundant = [];

    for (const scope of SCOPES) {
      const src = fs.readFileSync(path.join(PACK2_DIR, `${scope}.js`), 'utf8');
      const fr = parseDict(block(src, 'fr: {', '\nen: {'));
      const langs = {
        wo: parseDict(block(src, 'dict.wo = withBase(dict.fr, {', '});\ndict.bm')),
        bm: parseDict(block(src, 'dict.bm = withBase(dict.fr, {', '});\ndict.mos')),
        mos: parseDict(block(src, 'dict.mos = withBase(dict.fr, {', '});\n')),
      };
      for (const [lang, dict] of Object.entries(langs)) {
        for (const [key, value] of Object.entries(dict)) {
          if (fr[key] === value && fr[key] !== undefined) {
            redundant.push(`${scope}.${lang}.${key}`);
          }
        }
      }
    }

    expect(
      redundant,
      `overrides wo/bm/mos identiques à fr (déjà hérités via withBase, pur poids mort) :\n${redundant.join('\n')}`
    ).toEqual([]);
  });
});
