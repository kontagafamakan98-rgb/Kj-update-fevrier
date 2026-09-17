#!/usr/bin/env node
/**
 * Garde-fou des dépendances des SCRIPTS DE CI (frontend/scripts/) : tout module
 * importé par un script d'outillage doit être DÉCLARÉ dans package.json
 * (dependencies ou devDependencies) — pas seulement présent dans node_modules.
 *
 * ── Le défaut que ce garde existe pour empêcher ──────────────────────────────
 * `scripts/audit_api_returns.cjs` et `scripts/audit_tdz.cjs` font
 * `require('@babel/parser')` (plus `@babel/traverse`) sans que ces paquets
 * soient déclarés nulle part. Ils n'étaient installés que comme dépendances
 * TRANSITIVES de `@vitejs/plugin-react` (→ `@babel/core` → `@babel/parser`),
 * donc par simple effet de hissage npm. Le 2026-08-27, le job
 * « Audits détectent les régressions » est devenu rouge sur
 * `Error: Cannot find module '@babel/parser'` — un audit qui ne pouvait plus
 * tourner à cause d'un arbre de dépendances, pas du code audité.
 *
 * Le piège est qu'un module transitif « marche » partout où l'arbre est le
 * même : `npm ci` installe l'arbre du lock, donc l'import fonctionne… jusqu'au
 * jour où un paquet parent change de dépendances, où un hoisting diffère, ou
 * où quelqu'un épingle une autre version. Le jour où ça casse, ça casse en CI
 * (rouge), pas localement (vert).
 *
 * ── Ce que ce garde vérifie ──────────────────────────────────────────────────
 *   1. chaque module « nu » (hors chemin relatif et hors module natif Node)
 *      réellement importé par un fichier de scripts/ est déclaré en direct
 *      dans package.json ;
 *   2. le lock (packages[""].dependencies / devDependencies) REPRODUIT
 *      package.json à l'identique — un package.json modifié sans le lock fait
 *      échouer `npm ci` (« lock file out of sync »), un rouge d'installation ;
 *   3. pour un module non déclaré, le rapport nomme le paquet qui le tire en
 *      transitif (lu dans le lock) : la cause est dite, pas seulement l'effet.
 *
 * Les imports sont lus dans l'ARBRE SYNTAXIQUE (@babel/parser + @babel/traverse,
 * désormais déclarés pour cette raison même) et non par expression régulière :
 * un `require('x')` cité dans un commentaire ou dans une chaîne de test n'est
 * PAS un import, et une regex le prendrait pour tel — ce garde s'est fait
 * piéger par ses propres explications lors de sa première écriture.
 *
 * Un module déclaré mais absent de node_modules est normal : ce garde suppose
 * l'installation faite (la CI exécute `npm ci` avant de le lancer).
 *
 * Usage : cd frontend && node scripts/check-script-deps.js
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

// @babel/traverse est un module CJS : selon l'interopérateur, la fonction est
// exportée directement ou sous `.default`.
const traverse = traverseModule.default || traverseModule;

export const SCRIPTS_DIR = 'scripts';
export const PACKAGE_FILE = 'package.json';
export const LOCK_FILE = 'package-lock.json';

// Extensions scannées : celles que Node exécute directement en CI.
const SCANNED_EXTENSIONS = ['.js', '.cjs', '.mjs'];

// Noms de modules natifs Node, dans les deux écritures ('fs' et 'node:fs').
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const PARSER_OPTIONS = {
  sourceType: 'unambiguous',
  plugins: ['jsx', 'importMeta', 'topLevelAwait', 'dynamicImport'],
  errorRecovery: false,
};

/**
 * Modules « nus » réellement importés par une source : `import … from 'x'`,
 * `export … from 'x'`, `require('x')`, `import('x')`. Les chemins relatifs ou
 * absolus (`./`, `../`, `/`), les modules natifs Node et le préfixe « node: »
 * sont écartés. Le contenu des commentaires et des chaînes n'est jamais lu.
 *
 * @param {string} source Contenu du fichier.
 * @returns {string[]} Modules externes, dédupliqués et triés.
 */
export function findExternalSpecifiers(source) {
  const ast = parse(source, PARSER_OPTIONS);
  const found = new Set();

  const record = (specifier) => {
    if (typeof specifier !== 'string' || specifier === '') return;
    if (specifier.startsWith('.') || specifier.startsWith('/')) return;
    if (specifier.startsWith('node:') || NODE_BUILTINS.has(specifier)) return;
    found.add(specifier);
  };

  const recordStatic = (node) => {
    if (node && node.source && typeof node.source.value === 'string') record(node.source.value);
  };

  traverse(ast, {
    ImportDeclaration: (p) => recordStatic(p.node),
    ExportNamedDeclaration: (p) => recordStatic(p.node),
    ExportAllDeclaration: (p) => recordStatic(p.node),
    CallExpression: (p) => {
      const { callee, arguments: args } = p.node;
      const first = args && args[0];
      // `import('x')` est un CallExpression dont le callee est de type Import
      // (les versions récentes de Babel utilisent ImportExpression, traité par
      // le visiteur dédié ci-dessous).
      const isDynamicImport = callee.type === 'Import';
      const isRequire = callee.type === 'Identifier' && callee.name === 'require';
      if (!isDynamicImport && !isRequire) return;
      if (first && first.type === 'StringLiteral') record(first.value);
    },
    ImportExpression: (p) => {
      const source = p.node.source;
      if (source && source.type === 'StringLiteral') record(source.value);
    },
  });

  return [...found].sort();
}

/**
 * Nom du paquet déclarable pour un module : `@scope/pkg/sous-chemin`
 * → `@scope/pkg`, `pkg/sous-chemin` → `pkg`.
 *
 * @param {string} specifier Module importé.
 * @returns {string} Nom du paquet npm correspondant.
 */
export function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function walkFiles(dir, root) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const absolute = path.join(dir, entry);
    if (statSync(absolute).isDirectory()) {
      out.push(...walkFiles(absolute, root));
    } else if (SCANNED_EXTENSIONS.includes(path.extname(entry))) {
      // Chemins en « / » : mêmes messages sur Windows et sur Linux.
      out.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
  return out;
}

/**
 * @param {string} root Racine du projet frontend (défaut : répertoire courant).
 * @returns {{ok: boolean, errors: string[], notices: string[], files: number,
 *            declared: string[], undeclared: {module: string, files: string[],
 *            broughtBy: string[]}[]}} Rapport du garde.
 */
export function runScriptDepsCheck(root = '.') {
  const errors = [];
  const notices = [];

  const pkg = JSON.parse(readFileSync(path.join(root, PACKAGE_FILE), 'utf8'));
  const declared = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ]);

  // ── 1. Imports non déclarés ───────────────────────────────────────────────
  const scriptsDir = path.join(root, SCRIPTS_DIR);
  const files = walkFiles(scriptsDir, root);

  /** @type {Map<string, string[]>} module → fichiers qui l'importent */
  const importers = new Map();
  for (const file of files) {
    const source = readFileSync(path.join(root, file), 'utf8');
    let specifiers = [];
    try {
      specifiers = findExternalSpecifiers(source);
    } catch (error) {
      errors.push(
        `${file} n'a pas pu être analysé (${error.message}) : un script illisible ` +
          `ne peut pas prouver que ses imports sont déclarés`
      );
      continue;
    }
    for (const specifier of specifiers) {
      const name = packageNameOf(specifier);
      if (!importers.has(name)) importers.set(name, []);
      importers.get(name).push(file);
    }
  }

  // Lock : sert à NOMMER la cause (qui tire le module en transitif) et à
  // vérifier la synchronisation package.json ↔ lock.
  let lockRoot = {};
  /** @type {Map<string, string[]>} module → paquets qui le déclarent */
  const lockDependents = new Map();
  let lock = null;
  try {
    lock = JSON.parse(readFileSync(path.join(root, LOCK_FILE), 'utf8'));
    lockRoot = (lock.packages && lock.packages['']) || {};
    for (const [entry, info] of Object.entries(lock.packages || {})) {
      const name = entry === '' ? '(racine)' : entry.replace(/^.*node_modules\//, '');
      for (const dep of Object.keys(info.dependencies || {})) {
        if (!lockDependents.has(dep)) lockDependents.set(dep, []);
        lockDependents.get(dep).push(name);
      }
    }
  } catch {
    errors.push(
      `${LOCK_FILE} illisible ou invalide : impossible de nommer la cause d'un import non déclaré ` +
        `ni de vérifier que le lock reproduit ${PACKAGE_FILE}`
    );
  }

  const undeclared = [];
  for (const [module, importing] of [...importers].sort()) {
    if (declared.has(module)) continue;
    const broughtBy = lockDependents.get(module) || [];
    const importingFiles = [...new Set(importing)].sort();
    undeclared.push({ module, files: importingFiles, broughtBy });
    errors.push(
      `« ${module} » importé par ${importingFiles.join(', ')} ` +
        `n'est déclaré ni dans dependencies ni dans devDependencies de ${PACKAGE_FILE}` +
        (broughtBy.length > 0
          ? ` — il n'est disponible que comme dépendance TRANSITIVE de ${broughtBy.join(', ')} ` +
            `(hissage npm), ce qui casse dès que l'arbre change (cf. « Cannot find module '@babel/parser' » en CI)`
          : ` — aucun paquet ne le fournit, l'import ne peut pas fonctionner`) +
        ` ; déclare-le : npm install --save-dev ${module}`
    );
  }

  // ── 2. Lock synchronisé avec package.json ─────────────────────────────────
  if (lock) {
    const sameJson = (a, b) =>
      JSON.stringify(Object.entries(a || {}).sort()) ===
      JSON.stringify(Object.entries(b || {}).sort());
    for (const section of ['dependencies', 'devDependencies']) {
      if (!sameJson(pkg[section], lockRoot[section])) {
        errors.push(
          `${section} de ${PACKAGE_FILE} ne correspond pas à celui de ${LOCK_FILE} : ` +
            `\`npm ci\` refusera d'installer (lock out of sync). Régénère le lock ` +
            `(npm install --package-lock-only) au lieu de modifier un seul des deux fichiers`
        );
      }
    }
  }

  if (errors.length === 0) {
    notices.push(
      `${importers.size} module(s) externe(s) réellement importé(s) par ${files.length} script(s), ` +
        `tous déclarés en direct dans ${PACKAGE_FILE}`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    notices,
    files: files.length,
    declared: [...importers.keys()].filter((name) => declared.has(name)).sort(),
    undeclared,
  };
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = runScriptDepsCheck('.');
  if (!result.ok) {
    console.error(`❌ Dépendances de scripts non conformes (${result.errors.length} problème(s)) :`);
    for (const message of result.errors) console.error(`   • ${message}`);
    process.exit(1);
  }
  console.log(
    `✅ Dépendances des scripts verrouillées : ${result.files} script(s) analysé(s), ` +
      `aucun import externe non déclaré, lock synchronisé avec ${PACKAGE_FILE}`
  );
  for (const message of result.notices) console.log(`   ℹ️  ${message}`);
}
