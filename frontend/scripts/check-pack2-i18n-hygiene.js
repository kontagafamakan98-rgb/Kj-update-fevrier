#!/usr/bin/env node
/**
 * Hygiène des dictionnaires pack2PageI18n — clés INUTILISÉES et overrides
 * REDONDANTS. Deux dérives historiques, corrigées à la main dans le scope
 * `register` (17 lignes supprimées), ne doivent pas réapparaître :
 *
 *   1. CLÉ INUTILISÉE : une clé déclarée dans un scope qu'AUCUNE page
 *      consommatrice n'appelle — ni statiquement `pageT('key')`, ni
 *      dynamiquement `pageT(`prefix_${x}`)` / `pageT('prefix' + x)`, ni via un
 *      littéral d'erreur `setError('key')`. Ces clés partent dans le chunk lazy
 *      de la page sans jamais être affichées.
 *
 *   2. OVERRIDE REDONDANT : une clé wo/bm/mos STRICTEMENT identique à fr. Les
 *      dictionnaires wo/bm/mos héritent déjà de fr via `withBase` : un override
 *      identique est du poids mort pur.
 *
 * Le contrôle est déterministe, lit les SOURCES (aucun build requis) et
 * s'exécute à chaque push dans le job `frontend-build` — l'audit manuel
 * (scripts/audit-all-scopes.tmp.cjs) qu'il remplace n'était lancé par personne.
 *
 * Les règles exactes sont aussi exercées par le test unitaire
 * `src/utils/__tests__/i18nScopeHygiene.test.js`, qui importe les fonctions
 * d'analyse d'ICI (une seule source de vérité — pas de logique dupliquée qui
 * pourrait diverger).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ── Découverte des scopes et des pages consommatrices ──────────────────────

/** Un scope par fichier de pack2PageI18n/, sauf le noyau partagé core.js. */
export const discoverScopes = (pack2Dir) =>
  readdirSync(pack2Dir)
    .filter((f) => f.endsWith('.js') && f !== 'core.js')
    .map((f) => f.replace(/\.js$/, ''))
    .sort();

/** Fichiers source susceptibles de consommer un scope (hors tests). */
export const consumerFiles = (srcRoot) => {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full);
    }
  };
  for (const dir of ['pages', 'components', 'contexts']) {
    try {
      walk(path.join(srcRoot, dir));
    } catch {
      // dossier absent (fixture minimale) : simplement ignoré
    }
  }
  const appJs = path.join(srcRoot, 'App.js');
  try {
    readFileSync(appJs);
    out.push(appJs);
  } catch {
    // App.js absent (fixture minimale)
  }
  const pageSections = path.join(srcRoot, 'config', 'page-sections.js');
  try {
    readFileSync(pageSections);
    out.push(pageSections);
  } catch {
    // page-sections.js absent (fixture minimale)
  }
  return out;
};

/** Fichiers qui importent RÉELLEMENT ce scope (`pack2PageI18n/<scope>`). */
export const consumersOf = (srcRoot, scope) => {
  const target = `pack2PageI18n/${scope}`;
  return consumerFiles(srcRoot).filter((f) => {
    const source = readFileSync(f, 'utf8');
    // page-sections.js is a declarative consumer: its *Key values are read by
    // the page and by the prerender build, even though it does not import the
    // scope module directly. Keep those declarations visible to this guard.
    return source.includes(target) || f.endsWith(path.join('config', 'page-sections.js'));
  });
};

/** Keys declared by the shared page plans (including arrays such as Keys). */
export const declaredPagePlanKeys = (src) => {
  const keys = new Set();
  for (const match of src.matchAll(/\b\w+Key(?:s)?\s*:\s*'([a-zA-Z_]\w*)'/g)) keys.add(match[1]);
  for (const match of src.matchAll(/\b\w+Key(?:s)?\s*:\s*\[([\s\S]*?)\]/g)) {
    for (const key of match[1].matchAll(/'([a-zA-Z_]\w*)'/g)) keys.add(key[1]);
  }
  return keys;
};

// ── Extraction des dictionnaires d'un scope ────────────────────────────────

const block = (src, start, end) => {
  const i = src.indexOf(start);
  if (i === -1) return '';
  const j = src.indexOf(end, i);
  return src.slice(i, j === -1 ? src.length : j);
};

/**
 * Entrées `clé: 'valeur',` d'un bloc de langue.
 *
 * Indentation ACCEPTÉE À PARTIR DE ZÉRO espace : les fichiers de scope réels
 * mélangent les deux (`otherUser:` sans indentation, `placeholder:` avec 2
 * espaces). L'audit historique exigeait 2 espaces et passait donc à côté de
 * **33 entrées** wo/bm/mos — un override identique à fr écrit sans indentation
 * échappait silencieusement au contrôle de redondance.
 */
export const parseDict = (text) => {
  const dict = {};
  const re = /^\s*([a-zA-Z_]\w*): '((?:[^'\\]|\\.)*)'/gm;
  let m;
  while ((m = re.exec(text)) !== null) dict[m[1]] = m[2];
  return dict;
};

/** Les cinq dictionnaires d'un fichier de scope (héritage via withBase). */
export const parseScopeDictionaries = (src) => ({
  fr: parseDict(block(src, 'fr: {', '\nen: {')),
  en: parseDict(block(src, 'en: {', '\ndict.wo')),
  wo: parseDict(block(src, 'dict.wo = withBase(dict.fr, {', '});\ndict.bm')),
  bm: parseDict(block(src, 'dict.bm = withBase(dict.fr, {', '});\ndict.mos')),
  mos: parseDict(block(src, 'dict.mos = withBase(dict.fr, {', '});\n')),
});

// ── Détection des usages dans les pages consommatrices ─────────────────────

/** Appels statiques `pageT('key')` / `pageT('key', {…})`. */
export const staticPageTCalls = (src) => {
  const keys = new Set();
  for (const m of src.matchAll(/pageT\(\s*'([a-zA-Z_]\w*)'\s*[,)]/g)) keys.add(m[1]);
  return keys;
};

/** Appels dynamiques par PRÉFIXE : pageT(`status_${x}`) → 'status_'. */
export const dynamicPrefixes = (src) => {
  const prefixes = new Set();
  for (const m of src.matchAll(/pageT\(\s*`([^`]*?)\$\{/g)) if (m[1]) prefixes.add(m[1]);
  for (const m of src.matchAll(/pageT\(\s*'([a-zA-Z_][a-zA-Z0-9_]*)'\s*\+/g)) prefixes.add(m[1]);
  return prefixes;
};

/** Clés d'erreur littérales : setError('key') / setErrorKey / setMessageKey. */
export const literalErrorKeys = (src) => {
  const keys = new Set();
  for (const m of src.matchAll(/set(?:Error|ErrorKey|MessageKey)\s*\([^)]*'([a-zA-Z_]\w*)'/g)) keys.add(m[1]);
  return keys;
};

// ── Analyse d'un scope ────────────────────────────────────────────────────

/**
 * Renvoie `{ scope, keyCount, unused, redundant }` pour un scope.
 *
 * Exécute la détection de façon IDENTIQUE pour la CI et pour les tests
 * (fixtures) : le comportement testé est donc bien celui qui tourne en CI.
 */
export const analyzeScope = ({ scope, pack2Dir, srcRoot }) => {
  const src = readFileSync(path.join(pack2Dir, `${scope}.js`), 'utf8');
  const dicts = parseScopeDictionaries(src);
  const allKeys = new Set(
    ['fr', 'en', 'wo', 'bm', 'mos'].flatMap((lang) => Object.keys(dicts[lang] || {}))
  );

  const used = new Set();
  const dynKeys = new Set();
  const prefixes = new Set();
  for (const consumer of consumersOf(srcRoot, scope)) {
    const csrc = readFileSync(consumer, 'utf8');
    staticPageTCalls(csrc).forEach((k) => used.add(k));
    declaredPagePlanKeys(csrc).forEach((k) => used.add(k));
    literalErrorKeys(csrc).forEach((k) => dynKeys.add(k));
    dynamicPrefixes(csrc).forEach((p) => prefixes.add(p));
  }

  const unused = [...allKeys]
    .filter((key) => {
      if (used.has(key) || dynKeys.has(key)) return false;
      if ([...prefixes].some((p) => key.startsWith(p))) return false;
      return true;
    })
    .sort();

  const redundant = [];
  for (const lang of ['wo', 'bm', 'mos']) {
    for (const [key, value] of Object.entries(dicts[lang])) {
      if (dicts.fr[key] === value && dicts.fr[key] !== undefined) {
        redundant.push(`${lang}.${key}`);
      }
    }
  }
  redundant.sort();

  return { scope, keyCount: allKeys.size, unused, redundant };
};

/** Analyse de tous les scopes découverts (aucun échec — voir run… pour l'issue). */
export const analyzeAllScopes = ({ pack2Dir, srcRoot }) =>
  discoverScopes(pack2Dir).map((scope) => analyzeScope({ scope, pack2Dir, srcRoot }));

// ── Check principal (exécuté uniquement en CLI, pas à l'import) ────────────

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

/**
 * Rejoue l'audit et renvoie `{ ok, errors, scopes }`.
 *
 * `ok: false` = une clé inutilisée ou un override redondant est réapparu :
 * l'appelant CLI sort en code 1, ce qui fait ROUGIR le job CI.
 */
export const runPack2I18nHygieneCheck = (opts = {}) => {
  const srcRoot = opts.srcRoot || process.cwd() + path.sep + 'src';
  const pack2Dir = opts.pack2Dir || path.join(srcRoot, 'utils', 'pack2PageI18n');
  const log = opts.log || console.log;
  const error = opts.error || console.error;

  const scopes = analyzeAllScopes({ pack2Dir, srcRoot });
  const errors = [];
  for (const { scope, keyCount, unused, redundant } of scopes) {
    if (unused.length) {
      errors.push(
        `Clé(s) inutilisée(s) dans le scope "${scope}" : ${unused.join(', ')}. ` +
          'Aucune page consommatrice ne les appelle (ni pageT statique/dynamique, ni clé d\'erreur littérale) — ' +
          'elles alourdissent le chunk lazy sans jamais être affichées.'
      );
    }
    if (redundant.length) {
      errors.push(
        `Override(s) redondant(s) dans le scope "${scope}" : ${redundant.join(', ')}. ` +
          'Identique(s) à fr, donc déjà hérité(s) via withBase — pur poids mort.'
      );
    }
    log(
      `  ${scope.padEnd(22)} ${String(keyCount).padStart(3)} clés` +
        (unused.length ? `  ${unused.length} inutilisée(s)` : '') +
        (redundant.length ? `  ${redundant.length} override(s) redondant(s)` : '')
    );
  }

  if (errors.length) {
    error(`❌ Hygiène i18n pack2PageI18n — ${errors.length} problème(s) :`);
    for (const e of errors) {
      error('  ' + e);
      // Annotation GitHub : le motif s'affiche directement sur le run, sans
      // avoir à ouvrir le log du job.
      error(`::error::${e}`);
    }
    return { ok: false, errors, scopes };
  }
  log(
    `✅ Hygiène i18n pack2PageI18n : ${scopes.length} scopes, aucune clé inutilisée, ` +
      'aucun override wo/bm/mos identique à fr.'
  );
  return { ok: true, errors, scopes };
};

if (isDirectRun) {
  const srcRoot = process.env.PACK2_HYGIENE_SRC || path.join(process.cwd(), 'src');
  const pack2Dir =
    process.env.PACK2_HYGIENE_PACK2 || path.join(srcRoot, 'utils', 'pack2PageI18n');
  const result = runPack2I18nHygieneCheck({ srcRoot, pack2Dir });
  if (!result.ok) process.exit(1);
}
