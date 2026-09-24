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
 *      Mesure du 16/09/2026 : 99,2 Ko gzip (index 38,4 + vendor-react-dom 40,7
 *      + vendor-router 13,4 + vendor-react 2,8 + Home 2,3 + vendor 1,6).
 *      Le SDK Sentry n'y figure plus : il était le plus gros chunk du build
 *      (482 715 o brut / 159 751 o gzip) parce que `await import()` renvoyait
 *      l'espace de noms entier, ce qui empêchait Rollup d'élaguer ses exports
 *      (replay, feedback, profiler…). Le déstructurer au site d'appel a ramené
 *      ce chunk à 87 044 o / 29 538 o gzip (−82 %), et son initialisation est
 *      désormais différée après interaction (voir src/utils/sentry.js).
 *   2. PLUS GROS CHUNK — mesure : vendor-leaflet 47,5 Ko gzip.
 *   3. BUILD TOTAL (brut, tous fichiers) — mesure : 2,28 Mo.
 *   4. CHUNKS À LA DEMANDE — un chunk listé dans CHUNKS_A_LA_DEMANDE ne doit
 *      être atteignable que par `import()` dynamique. Un budget de TAILLE ne
 *      peut pas attraper cette régression : le chunk existe et pèse pareil dans
 *      les deux cas, seul son POINT D'ENTRÉE change. Mesure du 24/09/2026 sur la
 *      production, avant ce budget : /jobs téléchargait les 48,6 Ko gzip de
 *      Leaflet au chargement alors que sa vue par défaut est la liste, dont
 *      38 Ko sans être exécutés (`unused-javascript` 0,5 — la seule page du site
 *      dans ce cas). Voir CHUNKS_A_LA_DEMANDE pour le détail et le correctif.
 *
 * Les seuils n'échouent pas sur la variance d'arrondi de Vite, mais attrapent
 * une régression de structure (un chunk entier qui revient dans le chemin
 * critique, un vendor dupliqué, la réapparition d'un SDK non élagué, etc.).
 * Ils ont été calibrés quand le plus gros chunk était à 156 Ko ; après le
 * correctif Sentry la marge du 2e budget est devenue très large (47,5 Ko pour
 * 200 Ko). Elle est laissée telle quelle à dessein : un seuil resserré au ras
 * de la mesure courante produirait des rouges sur la simple croissance d'une
 * dépendance (leaflet), pas sur une régression de structure.
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

// ── Chunks qui doivent rester À LA DEMANDE ────────────────────────────────
// Chaque entrée est un PRÉFIXE de chunk (les noms émis sont hachés :
// `<préfixe>-<hash>.js`). Ensemble, ces chunks forment une UNITÉ paresseuse :
// rien de ce qu'ils contiennent ne doit être téléchargé avant que
// l'utilisateur ne demande la fonctionnalité. La règle tient parce que l'unité
// est ATTEINTE par `import()` : ses membres peuvent s'importer statiquement
// entre eux (c'est une seule fonctionnalité), mais aucun chunk ordinaire ne
// peut en importer un.
//
//   `vendor-leaflet` + `JobsMap` : la carte de /jobs. Leaflet ne publie qu'un
//   bundle UMD ES5 (`dist/leaflet-src.js` — ni champ `module`, ni `exports`)
//   que Rollup ne peut pas élaguer : 155,7 Ko brut / 48,6 Ko gzip pour une
//   carte qu'on n'a pas ouverte. `JobsMap` l'importe STATIQUEMENT — c'est sa
//   dépendance, et c'est légitime DANS l'unité. L'unité reste à la demande
//   parce que src/pages/Jobs.js monte la carte en `React.lazy`. Avant, le
//   `import JobsMap from '../components/JobsMap'` statique faisait partir les
//   48,6 Ko à CHAQUE chargement de /jobs, dont la vue par défaut est la liste —
//   mesuré sur la production : 38 des 48 Ko gzip téléchargés sans être
//   exécutés (`unused-javascript` 0,5, la seule page du site dans ce cas).
//
//   À maintenir ENSEMBLE : renommer un fichier de l'unité fait rougir ce garde
//   (le préfixe ne correspond plus, donc l'unité semble atteinte depuis un
//   chunk ordinaire). C'est voulu : cette liste doit rester la vérité.
export const CHUNKS_A_LA_DEMANDE = ['vendor-leaflet', 'JobsMap'];

/** Ce nom de chunk appartient-il à l'unité paresseuse déclarée ? */
export const estChunkALaDemande = (nom, prefixes = CHUNKS_A_LA_DEMANDE) =>
  prefixes.some((p) => nom.startsWith(`${p}-`) || nom === `${p}.js`);

/**
 * Arêtes d'imports lues dans un chunk buildé, séparées par NATURE.
 *
 * Rollup/ESBuild émettent la forme statique en `from"./x.js"` (import lié) ou
 * `import"./x.js"` (effet de bord), et la forme dynamique en `import("./x.js")`.
 * Les motifs exigent un GUILLEMET juste après `from`/`import` : la parenthèse de
 * la forme dynamique ne peut donc jamais passer pour un import statique — c'est
 * toute la distinction que ce garde exploite.
 *
 * @param {string} source Contenu du chunk.
 * @returns {{statiques: string[], dynamiques: string[]}} Noms de fichiers visés.
 */
export const aretesDImport = (source) => {
  const statiques = [];
  const dynamiques = [];
  for (const m of source.matchAll(/(?:^|[^\w$.])from\s*["']([^"']+)["']/g)) {
    statiques.push(path.basename(m[1]));
  }
  for (const m of source.matchAll(/(?:^|[^\w$.])import\s*["']([^"']+)["']/g)) {
    statiques.push(path.basename(m[1]));
  }
  for (const m of source.matchAll(/(?:^|[^\w$.])import\s*\(\s*["']([^"']+)["']/g)) {
    dynamiques.push(path.basename(m[1]));
  }
  return { statiques, dynamiques };
};

/**
 * Vérifie que l'unité paresseuse est bien restée paresseuse.
 *
 * Deux refus, et il faut LES DEUX :
 *   1. un chunk ordinaire importe statiquement un membre de l'unité →
 *      l'unité entre dans le chemin critique de ce chunk ;
 *   2. aucun `import()` ne mène à l'unité → elle n'est plus « à la demande »
 *      mais « plus atteignable » (un `React.lazy` supprimé laisserait sinon un
 *      garde satisfait par la disparition de ce qu'il surveille).
 *
 * @param {string[]} fichiers Chunks .js du build.
 * @param {string[]} [prefixes] Préfixes de l'unité paresseuse.
 * @returns {string[]} Une ligne par écart.
 */
export const auditChunksALaDemande = (fichiers, prefixes = CHUNKS_A_LA_DEMANDE) => {
  const graphes = fichiers.map((file) => {
    const { statiques, dynamiques } = aretesDImport(readFileSync(file, 'utf8'));
    return { file: path.basename(file), statiques, dynamiques };
  });

  // L'unité paresseuse RÉELLE = ce que le build a produit sous ces préfixes.
  const unite = graphes
    .map((g) => g.file)
    .filter((nom) => estChunkALaDemande(nom, prefixes));

  if (unite.length === 0) {
    return [
      `aucun chunk ${prefixes.join(' / ')} dans le build — l'unité paresseuse ` +
        `déclarée n'existe plus : mettre à jour CHUNKS_A_LA_DEMANDE (le garde ` +
        `surveille sinon un chunk qui n'est jamais émis)`,
    ];
  }

  const erreurs = [];
  const vise = new Set(unite.filter((nom) => nom.endsWith('.js')));

  // Refus 1 : une arête statique venue de l'extérieur de l'unité.
  for (const g of graphes) {
    if (vise.has(g.file)) continue;
    for (const dep of g.statiques) {
      if (!vise.has(dep)) continue;
      erreurs.push(
        `${g.file} importe STATIQUEMENT ${dep} — l'unité à la demande ` +
          `(${prefixes.join(' + ')}) repasserait dans le chargement de ce chunk : ` +
          `le navigateur téléchargerait des octets que la page n'exécute pas ` +
          `(Lighthouse \`unused-javascript\`). La charger par \`import()\` ` +
          `dynamique (React.lazy) : voir src/pages/Jobs.js`
      );
    }
  }

  // Refus 2 : plus aucun `import()` ne mène à l'unité.
  const atteinteEnDynamique = graphes.some((g) =>
    g.dynamiques.some((dep) => vise.has(dep))
  );
  if (!atteinteEnDynamique) {
    erreurs.push(
      `aucun \`import()\` ne mène à ${unite.join(', ')} — l'unité n'est plus ` +
        `« à la demande » mais « plus atteignable » : la fonctionnalité qui la ` +
        `charge a disparu (ou ne passe plus par React.lazy), donc le garde ne ` +
        `surveille plus rien`
    );
  }

  return erreurs;
};

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

  // ── Budget 4 : l'unité paresseuse est restée paresseuse ──────────────
  // Aucune arête STATIQUE venue de l'extérieur ne doit mener à un chunk à la
  // demande : elle l'entraînerait dans le chargement de ce chunk.
  const ecartsALaDemande = auditChunksALaDemande(jsFiles);
  errors.push(...ecartsALaDemande);
  // Le préchargement depuis index.html est la même faute par un autre chemin :
  // le chunk partirait avec le shell, avant même que la page existe.
  for (const ref of refs) {
    if (estChunkALaDemande(path.basename(ref))) {
      errors.push(
        `index.html précharge ${ref} — un chunk à la demande ne doit pas figurer ` +
          `dans le chemin critique du shell`
      );
    }
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
  log(
    `  chunks à la demande : ${CHUNKS_A_LA_DEMANDE.join(' + ')} ` +
      `(${ecartsALaDemande.length} écart(s))`
  );

  const stats = { initialGzip, largest, totalRaw, initialChunks, ecartsALaDemande };

  if (errors.length > 0) {
    console.error(`\n❌ Budget de bundle dépassé (${errors.length} problème(s)) :`);
    for (const message of errors) console.error(`   • ${message}`);
    return { ok: false, errors, stats };
  }

  log('\n✅ Bundle dans les budgets (JS initial, plus gros chunk, build total, chunks à la demande).');
  return { ok: true, errors, stats };
};

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = checkBundleSize();
  if (!result.ok) process.exit(1);
}
