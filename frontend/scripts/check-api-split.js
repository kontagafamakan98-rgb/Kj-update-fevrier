#!/usr/bin/env node
/**
 * Garde-fou du découpage services/api vs services/apiEndpoints.
 *
 * Contexte : le module partagé services/api.js est importé par le shell
 * (AuthContext → services/api). Tant que les pages lazy importaient leurs
 * groupes d'endpoints (jobsAPI, usersAPI, paymentAPI…) DEPUIS services/api,
 * Rollup conservait TOUTES les exportations du module partagé dans le chunk
 * d'entrée → le chunk index embarquait l'intégralité de la surface API, même
 * les groupes jamais utilisés au boot.
 *
 * Le découpage a déplacé ces groupes dans services/apiEndpoints.js (importé
 * UNIQUEMENT par les pages lazy). Ce check verrouille le contrat :
 *
 *   1. NIVEAU SOURCE (rapide, sans build) : aucun fichier de src/ ne doit
 *      importer un groupe lazy depuis services/api — uniquement depuis
 *      services/apiEndpoints. Un import « { jobsAPI } from services/api »
 *      suffirait à ré-introduire le groupe dans le chunk d'entrée au build
 *      suivant.
 *
 *   2. NIVEAU BUNDLE (après vite build) : les marqueurs URL distinctifs des
 *      groupes lazy (chaînes littérales non minifiées) ne doivent PAS
 *      apparaître dans le chunk d'entrée index-*.js. Si un marqueur y
 *      apparaît, un groupe lazy a fui dans le shell (import régressé,
 *      module fusionné, tree-shaking cassé…).
 *
 *   3. POSITIF : les groupes core (authAPI, notificationAPI,
 *      geolocationAPI + helpers) doivent RESTER dans le chunk d'entrée —
 *      une sur-séparation (groupe core déplacé hors api.js) casserait le
 *      shell en silence.
 *
 * Exécuté dans le job CI frontend-build, après `vite build`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ── Exports réutilisables (tests unitaires) ────────────────────────────────

// Groupes LAZY : toutes les exportations nommées de services/apiEndpoints.js.
export const extractNamedExports = (src) =>
  [...src.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*=/gm)].map((m) => m[1]);

// Marqueurs URL distinctifs d'un groupe lazy : chaînes littérales (pas des
// template literals) commençant par '/', ≥ 8 caractères, hors fragments de
// code. Les littéraux survivent à la minification → détection fiable dans
// le chunk buildé.
export const extractUrlMarkers = (src) =>
  [...src.matchAll(/'(\/[^'\\\n]{7,})'/g)]
    .map((m) => m[1])
    .filter((v) => !/[({=<>]/.test(v))
    .filter((v, i, arr) => arr.indexOf(v) === i);

// Noms importés par une ligne d'import nommé (gère les alias `X as Y`).
export const parseNamedImports = (line) => {
  const match = line.match(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const alias = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+[A-Za-z_$][\w$]*$/);
      return alias ? alias[1] : part.replace(/^type\s+/, '');
    });
};

// ── Check principal (exécuté uniquement en CLI, pas à l'import) ────────────
const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(js|jsx)$/.test(entry) && !entry.endsWith('.test.js') && !entry.endsWith('.test.jsx') && !entry.endsWith('.spec.js')) acc.push(full);
  }
  return acc;
};

export const runApiSplitCheck = (opts = {}) => {
  const rootDir = opts.root || process.cwd();
  const srcDir = path.join(rootDir, 'src');
  const apiFile = path.join(srcDir, 'services', 'api.js');
  const endpointsFile = path.join(srcDir, 'services', 'apiEndpoints.js');
  const assetsDir = path.join(rootDir, 'build', 'assets');

  const errors = [];

  // ── 1. NIVEAU SOURCE : aucun import d'un groupe lazy depuis services/api ─
  let apiSrc = '';
  let endpointsSrc = '';
  try {
    apiSrc = readFileSync(apiFile, 'utf8');
  } catch {
    errors.push(`services/api.js introuvable (${apiFile})`);
  }
  try {
    endpointsSrc = readFileSync(endpointsFile, 'utf8');
  } catch {
    errors.push(`services/apiEndpoints.js introuvable (${endpointsFile}) — le découpage a-t-il été annulé ?`);
  }

  const lazyGroups = new Set(extractNamedExports(endpointsSrc));
  if (!lazyGroups.size) {
    errors.push('Aucune exportation nommée trouvée dans services/apiEndpoints.js — groupes lazy absents ?');
  }

  const apiPath = apiFile.replace(/\\/g, '/');
  const endpointsPath = endpointsFile.replace(/\\/g, '/');
  const importErrors = [];
  for (const file of walk(srcDir)) {
    const rel = file.replace(/\\/g, '/');
    if (rel === endpointsPath) continue; // apiEndpoints importe api (core) par design
    const src = readFileSync(file, 'utf8');
    for (const line of src.split('\n')) {
      // Uniquement les imports vers services/api (relatifs).
      if (!/from\s+['"][^'"]*services\/api['"]/.test(line)) continue;
      for (const name of parseNamedImports(line)) {
        if (lazyGroups.has(name)) {
          importErrors.push(`${rel} : import « ${name} » depuis services/api — doit venir de services/apiEndpoints`);
        }
      }
    }
  }
  if (importErrors.length) {
    errors.push(
      `${importErrors.length} import(s) de groupe(s) lazy depuis services/api (le groupe serait ré-embarqué dans le chunk d'entrée) :\n    ${importErrors.join('\n    ')}`
    );
  }

  // ── 2 + 3. NIVEAU BUNDLE : marqueurs lazy absents, core présent ─────────
  let indexFiles = [];
  try {
    indexFiles = readdirSync(assetsDir).filter((f) => /^index-[A-Za-z0-9_-]+\.js$/.test(f));
  } catch {
    errors.push(`build/assets/ introuvable (${assetsDir}) — le build a-t-il tourné ?`);
  }

  if (indexFiles.length) {
    const indexSrc = indexFiles.map((f) => readFileSync(path.join(assetsDir, f), 'utf8')).join('\n');

    // Marqueurs lazy : les URL littérales de apiEndpoints, hors celles déjà
    // présentes dans api.js (core — légitimes dans l'entrée) et hors celles
    // qui apparaissent dans un AUTRE fichier de src/ (route/lien du shell
    // ou usage lazy légitime — pas un signal de fuite fiable).
    const coreMarkers = new Set(extractUrlMarkers(apiSrc));
    const elsewhere = new Set();
    for (const file of walk(srcDir)) {
      const rel = file.replace(/\\/g, '/');
      if (rel === endpointsPath) continue;
      for (const m of extractUrlMarkers(readFileSync(file, 'utf8'))) elsewhere.add(m);
    }
    const lazyMarkers = extractUrlMarkers(endpointsSrc).filter((m) => !coreMarkers.has(m) && !elsewhere.has(m));

    const leaked = lazyMarkers.filter((m) => indexSrc.includes(m));
    if (leaked.length) {
      errors.push(
        `${leaked.length} marqueur(s) de groupe(s) lazy trouvé(s) dans le chunk d'entrée index-*.js — ` +
          `un groupe d'endpoints lazy a fui dans le shell : ${leaked.join(', ')}`
      );
    }

    // Positif : les groupes core doivent rester dans l'entrée.
    const coreMustBePresent = ['/auth/me', '/auth/login', '/notifications/unread-count', '/geolocation/detect'];
    const missingCore = coreMustBePresent.filter((m) => !indexSrc.includes(m));
    if (missingCore.length) {
      errors.push(
        `Marqueur(s) core ABSENT(s) du chunk d'entrée — le shell serait cassé : ${missingCore.join(', ')}`
      );
    }
  }

  if (errors.length) {
    console.error('❌ Régressions du split services/api — ' + errors.length + ' problème(s) :');
    for (const e of errors) console.error('  ' + e);
    return { ok: false, errors };
  }
  console.log(
    `✅ Split services/api verrouillé : ${lazyGroups.size} groupes lazy confinés dans apiEndpoints, aucun import régressé, aucun marqueur lazy dans le chunk d'entrée, core présent.`
  );
  return { ok: true, errors };
};

if (isDirectRun) {
  const result = runApiSplitCheck();
  if (!result.ok) process.exit(1);
}
