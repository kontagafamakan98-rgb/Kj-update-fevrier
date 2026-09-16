#!/usr/bin/env node
/**
 * Budget de taille du bundle — l'étape CI « Check bundle size » ne vérifiait
 * RIEN : elle affichait `du -sh build/` et sortait toujours 0. Un doublement du
 * bundle (dépendance lourde importée dans le shell, chunk lazy repassé en
 * statique, carte/asset géant) passait donc en vert.
 *
 * Ce check pose trois budgets, mesurés sur le build réel puis arrondis :
 *
 *   1. JS INITIAL — somme gzip des chunks référencés par build/index.html
 *      (ce que le navigateur télécharge avant de peindre la première route).
 *      Mesure du 16/09/2026 : 98,5 Ko gzip (index 37,7 + vendor-react-dom 40,7
 *      + vendor-router 13,4 + vendor-react 2,8 + Home 2,3 + vendor 1,6).
 *   2. PLUS GROS CHUNK — mesure : vendor-sentry 156,4 Ko gzip.
 *   3. BUILD TOTAL (brut, tous fichiers) — mesure : 2,81 Mo.
 *
 * Les seuils laissent ~30-40 % de marge : ils n'échouent pas sur la variance
 * d'arrondi de Vite, mais attrapent une régression de structure (un chunk
 * entier qui revient dans le chemin critique, un vendor dupliqué, etc.).
 * Le check est une fonction exportée (convention des autres gardes) : il est
 * testé par scripts/__tests__/check-bundle-size.test.js sur des fixtures, donc
 * il n'a pas besoin d'un build réel pour être vérifié.
 *
 * Usage : cd frontend && npm run build && node scripts/check-bundle-size.js
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Budgets en OCTETS (Ko = 1024). Toute modification doit s'accompagner d'une
// mesure du build réel et d'une explication dans le message de commit.
export const BUDGETS = {
  initialGzip: 130 * 1024, // JS initial (chunks référencés par index.html), gzip
  largestChunkGzip: 200 * 1024, // plus gros chunk JS, gzip
  totalRaw: 4 * 1024 * 1024, // build/ entier, brut
};

const ko = (bytes) => `${(bytes / 1024).toFixed(1)} Ko`;

const walkFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
};

/**
 * Vérifie les budgets de taille du build.
 *
 * @param {object} [options]
 * @param {string} [options.root]  Racine frontend (contient build/).
 * @param {boolean} [options.quiet] Tait la sortie de progression (tests).
 * @returns {{ok: boolean, errors: string[], stats: object}}
 */
export const checkBundleSize = ({ root, quiet = false } = {}) => {
  const ROOT = root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const BUILD = path.join(ROOT, 'build');
  const INDEX = path.join(BUILD, 'index.html');

  const log = (...args) => {
    if (!quiet) console.log(...args);
  };
  const errors = [];

  // Un build absent est une ERREUR : sinon le check passerait en ne mesurant
  // rien (exactement le défaut qu'il corrige).
  if (!existsSync(INDEX)) {
    return {
      ok: false,
      errors: [`build/index.html introuvable dans ${BUILD} — lancer \`npm run build\` avant ce check`],
      stats: null,
    };
  }

  const html = readFileSync(INDEX, 'utf8');
  // Chunks du chemin critique : <script src> de l'entrée + modulepreload des
  // dépendances statiques (Vite émet les deux dans index.html).
  const refs = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1])
    ),
  ];

  const initialChunks = [];
  for (const ref of refs) {
    const file = path.join(BUILD, ref.replace(/^\//, ''));
    if (!existsSync(file)) {
      errors.push(`index.html référence ${ref} qui n'existe pas dans build/`);
      continue;
    }
    const raw = statSync(file).size;
    const gzip = gzipSync(readFileSync(file)).length;
    initialChunks.push({ file: path.basename(file), raw, gzip });
  }

  const allFiles = walkFiles(BUILD);
  const totalRaw = allFiles.reduce((sum, f) => sum + statSync(f).size, 0);

  const jsFiles = allFiles.filter((f) => f.endsWith('.js'));
  const chunks = jsFiles
    .map((f) => ({ file: path.basename(f), raw: statSync(f).size, gzip: gzipSync(readFileSync(f)).length }))
    .sort((a, b) => b.gzip - a.gzip);
  const largest = chunks[0] || null;

  const initialGzip = initialChunks.reduce((sum, c) => sum + c.gzip, 0);

  // ── Budget 1 : JS initial ──────────────────────────────────────────────
  if (initialGzip > BUDGETS.initialGzip) {
    errors.push(
      `JS initial ${ko(initialGzip)} gzip > budget ${ko(BUDGETS.initialGzip)} ` +
        `(${initialChunks.length} chunks référencés par index.html) — ` +
        `un import du shell est-il repassé en statique ?`
    );
  }

  // ── Budget 2 : plus gros chunk ─────────────────────────────────────────
  if (largest && largest.gzip > BUDGETS.largestChunkGzip) {
    errors.push(
      `plus gros chunk ${ko(largest.gzip)} gzip (${largest.file}) > budget ` +
        `${ko(BUDGETS.largestChunkGzip)} — vérifier les règles manualChunks`
    );
  }

  // ── Budget 3 : build total ─────────────────────────────────────────────
  if (totalRaw > BUDGETS.totalRaw) {
    errors.push(
      `build total ${(totalRaw / 1024 / 1024).toFixed(2)} Mo > budget ` +
        `${(BUDGETS.totalRaw / 1024 / 1024).toFixed(2)} Mo (${allFiles.length} fichiers)`
    );
  }

  log('Budgets de taille du bundle :');
  for (const chunk of [...initialChunks].sort((a, b) => b.gzip - a.gzip)) {
    log(`  ${ko(chunk.gzip).padStart(9)} gzip (${ko(chunk.raw).padStart(9)} brut)  ${chunk.file}`);
  }
  log(
    `  JS initial          : ${ko(initialGzip)} gzip / budget ${ko(BUDGETS.initialGzip)}`
  );
  if (largest) {
    log(
      `  plus gros chunk     : ${ko(largest.gzip)} gzip (${largest.file}) / budget ${ko(BUDGETS.largestChunkGzip)}`
    );
  }
  log(
    `  build total         : ${(totalRaw / 1024 / 1024).toFixed(2)} Mo / budget ` +
      `${(BUDGETS.totalRaw / 1024 / 1024).toFixed(2)} Mo`
  );

  if (errors.length > 0) {
    console.error(`\n❌ Budget de bundle dépassé (${errors.length} problème(s)) :`);
    for (const message of errors) console.error(`   • ${message}`);
    return { ok: false, errors, stats: { initialGzip, largest, totalRaw, initialChunks } };
  }

  log('\n✅ Bundle dans les budgets (JS initial, plus gros chunk, build total).');
  return { ok: true, errors, stats: { initialGzip, largest, totalRaw, initialChunks } };
};

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = checkBundleSize();
  if (!result.ok) process.exit(1);
}
