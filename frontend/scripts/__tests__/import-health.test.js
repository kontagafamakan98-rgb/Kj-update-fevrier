/**
 * Santé d'import : TOUT module importé par le frontend s'importe, en un endroit.
 *
 * Pourquoi ce test existe
 * -----------------------
 * Des assertions d'existence (fs.existsSync(...) → toBe(true)) s'étaient
 * dispersées dans les suites de scripts : elles vérifient qu'un fichier est sur
 * le disque, pas qu'il tient debout. Un fichier présent peut importer un module
 * renommé, un export disparu, une dépendance absente — et chaque assertion
 * d'existence restait verte pendant que le build cassait.
 *
 * Ce test fait ce que les assertions d'existence ne faisaient pas : il IMPORTE
 * chaque module et nomme celui qui ne s'importe plus, avec l'erreur exacte.
 *
 * ── Ce qu'on importe, et ce qu'on n'importe pas ─────────────────────────────
 * On importe les modules que le code importe (résolus depuis les `import` /
 * `require` des fichiers du périmètre). Cela écarte mécaniquement les POINTS
 * D'ENTRÉE, dont le contrat est de TOURNER et non d'être importés : les importer
 * exécuterait le programme au lieu de le vérifier. Mesuré, pas supposé —
 * `scripts/audit_api_returns.cjs` et `scripts/check-og-reproducible.js` appellent
 * `process.exit(0)` à l'import, `src/index.js` monte l'application dans `#root`
 * (absent hors navigateur), et `vite.config.js` passe par esbuild, indisponible
 * sous jsdom. Ces quatre-là restent couverts, mais par ce qui les fait vivre : le
 * build (index.js, vite.config.js — ce dernier est importé par
 * check-spa-routes.test.js sous environnement node) et la CI, qui exécute les
 * audits. La règle étant mécanique, un nouveau fichier qui s'exécute à l'import
 * est écarté sans liste à tenir à jour — et un module réellement importé, lui,
 * ne peut pas être oublié.
 *
 * Périmètre : src/ (composants, pages, services, contextes, i18n), scripts/
 * (gardes et sondes CI) et les configurations à la racine du frontend. Exclus :
 * les fichiers de tests (les importer réenregistrerait leurs tests dans ce
 * processus) et node_modules.
 *
 * Le pendant backend vit dans backend/tests/test_import_health.py : les deux
 * moitiés du dépôt ont le même garde, et la même preuve de non-vacuité.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_DIRS = ['src', 'scripts'];
const MODULE_EXTENSIONS = ['.js', '.jsx', '.cjs', '.mjs'];

const relative = (file) => path.relative(FRONTEND, file).split(path.sep).join('/');

const walk = (dir) => {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      found.push(...walk(full));
    } else if (MODULE_EXTENSIONS.includes(path.extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
};

/** Fichiers du périmètre (points d'entrée compris : ils sont SCANNÉS). */
const moduleFiles = () =>
  [
    ...SOURCE_DIRS.flatMap((dir) => walk(path.join(FRONTEND, dir))),
    ...fs
      .readdirSync(FRONTEND, { withFileTypes: true })
      .filter((entry) => entry.isFile() && MODULE_EXTENSIONS.includes(path.extname(entry.name)))
      .map((entry) => path.join(FRONTEND, entry.name)),
  ].sort();

/** Spécifications RELATIVES importées/exigées par un fichier. */
const relativeSpecifiers = (file) => {
  const source = fs.readFileSync(file, 'utf8');
  const patterns = [
    /from\s*['"](\.[^'"]+)['"]/g,
    /require\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /import\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]));
};

const resolveModule = (from, specifier) => {
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [
    base,
    ...MODULE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...['.js', '.jsx'].map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
};

/** Modules que le code importe réellement — donc ce qui doit s'importer. */
const importedModules = () => {
  const targets = new Set();
  for (const file of moduleFiles()) {
    for (const specifier of relativeSpecifiers(file)) {
      const resolved = resolveModule(file, specifier);
      if (resolved) targets.add(resolved);
    }
  }
  return [...targets].sort();
};

/** [(étiquette, erreur)] pour chaque module qui ne s'importe pas. */
const importFailures = async (files = importedModules()) => {
  const failures = [];
  for (const file of files) {
    try {
      await import(pathToFileURL(file).href);
    } catch (error) {
      failures.push([relative(file), `${error.name}: ${error.message}`]);
    }
  }
  return failures;
};

const assertImportsHealthy = (failures) => {
  if (failures.length) {
    const report = failures.map(([file, message]) => `  • ${file}\n    ${message}`).join('\n');
    throw new Error(`module(s) qui ne s'importent plus :\n${report}`);
  }
};

describe("santé d'import des modules frontend", () => {
  it('découvre réellement les modules du périmètre', () => {
    // Sans cela, un globbing ou une résolution cassés rendraient le test
    // principal vert en n'important rien — le seul faux vert que ce garde peut
    // produire, donc il est refusé ici.
    const files = moduleFiles().map(relative);
    const importable = importedModules().map(relative);
    expect(files.length).toBeGreaterThan(100);
    expect(importable.length).toBeGreaterThan(100);
    for (const attendu of [
      'src/App.js',
      'src/services/api.js',
      'src/pages/JobDetails.js',
      'scripts/site-meta.js',
      'scripts/check-og-images.js',
      'scripts/vercel-rewrite-server.js',
    ]) {
      expect(files).toContain(attendu);
    }
    expect(files.some((name) => name.includes('__tests__'))).toBe(false);
  });

  it('tous les modules importés s\u2019importent', async () => {
    const importable = importedModules();
    // Ce que le run couvre, écrit dans le journal : un vert doit dire sur QUOI
    // il porte, pas seulement qu'il n'a rien trouvé.
    console.log(
      `santé d'import : ${importable.length} module(s) importé(s) sur ` +
        `${moduleFiles().length} fichier(s) du périmètre (le reste : points d'entrée)`
    );
    assertImportsHealthy(await importFailures(importable));
  });

  it('échoue quand un module ne s\u2019importe plus, en nommant l\u2019erreur réelle', async () => {
    // Non-vacuité : un dépôt sain ne contient pas de module cassé, donc sans ce
    // test rien ne prouverait que le garde sait ROUGIR.
    // Le dossier temporaire vit DANS le projet : hors de la racine, Vite refuse
    // de servir le fichier (fs.allow), et le cas ne prouverait rien.
    const dir = fs.mkdtempSync(path.join(FRONTEND, '.import-health-'));
    try {
      const casse = path.join(dir, 'module-casse.js');
      fs.writeFileSync(casse, "import './paquet-qui-n-existe-pas.js';\n", 'utf8');
      const sain = path.join(dir, 'module-sain.js');
      fs.writeFileSync(sain, 'export const valeur = 1;\n', 'utf8');

      const failures = await importFailures([sain, casse]);

      expect(failures).toHaveLength(1);
      expect(failures[0][0]).toContain('module-casse.js');
      expect(failures[0][1]).toContain('paquet-qui-n-existe-pas');
      expect(() => assertImportsHealthy(failures)).toThrow(/module\(s\) qui ne s'importent plus/);
      expect(() => assertImportsHealthy([])).not.toThrow();

      // Un module peut aussi DISPARAÎTRE : c'est le cas d'un renommage, et le
      // chemin absent doit être nommé aussi nettement qu'un import cassé.
      const absent = await importFailures([path.join(FRONTEND, 'src', 'module-absent.js')]);
      expect(absent).toHaveLength(1);
      expect(absent[0][1]).toMatch(/module-absent|Cannot find|Failed to load/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
