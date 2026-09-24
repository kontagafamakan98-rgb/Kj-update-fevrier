import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { checkBundleSize, estChunkALaDemande, BUDGETS } from '../check-bundle-size';

// Tests du garde-fou « budget de taille du bundle » (scripts/check-bundle-size.js).
//
// Ce garde remplace une étape CI qui n'assertait RIEN (simple `du -sh`, jamais
// d'échec possible) : les cas négatifs comptent donc autant que le cas
// nominal — un budget qui ne peut pas échouer ne protège rien.
//
// Les fixtures sont des arborescences temporaires : aucun build réel n'est
// requis (le check tourne après `npm run build` en CI, mais ses tests non).
// Les chunks sont remplis d'octets ALÉATOIRES : un motif répétitif se
// compresserait à presque rien et ne dépasserait jamais un budget gzip.

const tempDirs = [];

// L'unité paresseuse de la carte, telle que le build la produit : son entrée
// (`JobsMap-*`) importe STATIQUEMENT Leaflet — c'est sa dépendance — et elle
// n'est atteinte QUE par un `import()`, depuis le chunk de la page /jobs.
//
// Elle fait partie de TOUTE arborescence de test : le garde refuse un build où
// elle est absente (un préfixe déclaré qui ne correspond à aucun chunk ne
// surveille plus rien). `sansUniteParesseuse: true` la retire, pour le cas qui
// éprouve ce refus-là.
const uniteParesseuse = () => ({
  chunks: { 'vendor-leaflet-carte.js': 2 * 1024, 'JobsMap-carte.js': 1024, 'Jobs-page.js': 1024 },
  sources: {
    'JobsMap-carte.js': 'import"./vendor-leaflet-carte.js";export default 1;',
    'Jobs-page.js': 'const m=await import("./JobsMap-carte.js");export default m;',
  },
});

const makeBuild = ({
  chunks = {},
  initial,
  extraFiles = {},
  indexHtml,
  sources = {},
  sansUniteParesseuse = false,
} = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-size-'));
  tempDirs.push(root);
  const assets = path.join(root, 'build', 'assets');
  fs.mkdirSync(assets, { recursive: true });

  const unite = sansUniteParesseuse ? { chunks: {}, sources: {} } : uniteParesseuse();
  // L'entrée du shell est TOUJOURS référencée par le gabarit d'index.html :
  // elle fait donc partie de toute arborescence décrite ici.
  const tousLesChunks = { 'index-entry.js': 40 * 1024, ...unite.chunks, ...chunks };
  const toutesLesSources = { ...unite.sources, ...sources };

  for (const [name, size] of Object.entries(tousLesChunks)) {
    fs.writeFileSync(path.join(assets, name), randomBytes(size));
  }
  // Chunks dont le CONTENU compte (arêtes d'imports) : écrits après les octets
  // aléatoires, donc ils remplacent la taille de `chunks`.
  for (const [name, source] of Object.entries(toutesLesSources)) {
    fs.writeFileSync(path.join(assets, name), source);
  }
  for (const [rel, size] of Object.entries(extraFiles)) {
    const full = path.join(root, 'build', rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.alloc(size));
  }

  // Par défaut tous les chunks sont préchargés ; `initial` permet de ne
  // précharger QUE le chemin critique (les autres restent des chunks lazy,
  // présents dans le build mais absents d'index.html). Ce que Vite émettrait
  // réellement n'est jamais préchargé : un chunk à la demande.
  const preloaded =
    initial ?? Object.keys(tousLesChunks).filter((name) => !estChunkALaDemande(name));
  const html =
    indexHtml ??
    `<!DOCTYPE html><html><head>
${preloaded.map((r) => `<link rel="modulepreload" crossorigin href="/assets/${r}">`).join('\n')}
<script type="module" crossorigin src="/assets/index-entry.js"></script>
</head><body><div id="root"></div></body></html>`;
  fs.writeFileSync(path.join(root, 'build', 'index.html'), html);
  return root;
};

// Build « sain » : JS initial modeste, gros chunk LAZY (présent mais non
// référencé par index.html → hors du budget de JS initial).
const healthyBuild = () =>
  makeBuild({
    chunks: {
      'index-entry.js': 40 * 1024,
      'vendor-react.js': 40 * 1024,
      'vendor-sentry-chunk.js': 150 * 1024,
    },
    initial: ['vendor-react.js'],
  });

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('check-bundle-size — cas nominal', () => {
  it('accepte un build dans les budgets et rapporte les mesures', () => {
    const result = checkBundleSize({ root: healthyBuild(), quiet: true });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stats.initialGzip).toBeGreaterThan(70 * 1024);
    expect(result.stats.initialGzip).toBeLessThanOrEqual(BUDGETS.initialGzip);
    // Le plus gros chunk du build est le vendor lazy…
    expect(result.stats.largest.file).toBe('vendor-sentry-chunk.js');
    // …mais il ne doit PAS compter dans le JS initial.
    expect(result.stats.initialChunks.map((c) => c.file).sort()).toEqual([
      'index-entry.js',
      'vendor-react.js',
    ]);
  });
});

describe('check-bundle-size — budgets réellement appliqués', () => {
  it('échoue si le JS initial dépasse le budget', () => {
    const root = makeBuild({
      chunks: { 'index-entry.js': BUDGETS.initialGzip + 60 * 1024 },
      initial: [],
    });
    const result = checkBundleSize({ root, quiet: true });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/JS initial .+ > budget /);
  });

  it('échoue si le plus gros chunk dépasse le budget', () => {
    const root = makeBuild({
      chunks: {
        'index-entry.js': 40 * 1024,
        'vendor-xxxl.js': BUDGETS.largestChunkGzip + 120 * 1024,
      },
      initial: [],
    });
    const result = checkBundleSize({ root, quiet: true });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/plus gros chunk .+vendor-xxxl\.js.+ > budget /);
  });

  it('échoue si le build total dépasse le budget', () => {
    const root = makeBuild({
      chunks: { 'index-entry.js': 40 * 1024 },
      initial: [],
      extraFiles: { 'assets/mega.wasm': BUDGETS.totalRaw + 1024 * 1024 },
    });
    const result = checkBundleSize({ root, quiet: true });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/build total .+ > budget /);
  });

  it('échoue si index.html référence un chunk absent (build incohérent)', () => {
    const root = makeBuild({ chunks: { 'index-entry.js': 1024 }, initial: [] });
    fs.rmSync(path.join(root, 'build', 'assets', 'index-entry.js'));
    const result = checkBundleSize({ root, quiet: true });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/référence \/assets\/index-entry\.js qui n'existe pas/);
  });
});

describe('check-bundle-size — un build absent est une erreur, pas un vert', () => {
  it('échoue si build/index.html est introuvable', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-size-empty-'));
    tempDirs.push(root);
    const result = checkBundleSize({ root, quiet: true });

    expect(result.ok).toBe(false);
    expect(result.stats).toBeNull();
    expect(result.errors.join('\n')).toMatch(/index\.html introuvable[\s\S]*npm run build/);
  });
});

describe('check-bundle-size — l’unité paresseuse reste paresseuse', () => {
  it('accepte l’unité atteinte par import() — ses membres s’importent entre eux', () => {
    const result = checkBundleSize({ root: makeBuild({ initial: ['index-entry.js'] }), quiet: true });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stats.ecartsALaDemande).toEqual([]);
    // Leaflet reste dans le build, simplement hors du chemin critique.
    expect(result.stats.initialChunks.map((c) => c.file)).toEqual(['index-entry.js']);
  });

  it('échoue si un chunk ordinaire importe STATIQUEMENT un membre de l’unité', () => {
    // C'est exactement ce que faisait `import JobsMap from '../components/JobsMap'`
    // dans src/pages/Jobs.js : l'unité repassait dans le chargement de la page.
    const root = makeBuild({
      initial: ['index-entry.js'],
      sources: { 'filtres-extra.js': 'import{L as z}from"./JobsMap-carte.js";export default z;' },
    });
    const result = checkBundleSize({ root, quiet: true });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /filtres-extra\.js importe STATIQUEMENT JobsMap-carte\.js/
    );
  });

  it('échoue si index.html précharge un membre de l’unité', () => {
    const root = makeBuild({ initial: ['index-entry.js', 'vendor-leaflet-carte.js'] });
    const result = checkBundleSize({ root, quiet: true });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /index\.html précharge \/assets\/vendor-leaflet-carte\.js/
    );
  });

  it('échoue si plus aucun import() ne mène à l’unité (garde devenu aveugle)', () => {
    // Refus symétrique du précédent : sans lui, supprimer le React.lazy ferait
    // passer le garde par DISPARITION de ce qu'il surveille.
    const root = makeBuild({
      initial: ['index-entry.js'],
      sources: { 'Jobs-page.js': 'export default 1;' },
    });
    const result = checkBundleSize({ root, quiet: true });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/aucun `import\(\)` ne mène à [\s\S]*JobsMap-carte\.js/);
  });

  it('échoue si l’unité déclarée n’existe plus dans le build', () => {
    const root = makeBuild({ initial: ['index-entry.js'], sansUniteParesseuse: true });
    const result = checkBundleSize({ root, quiet: true });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/aucun chunk vendor-leaflet \/ JobsMap dans le build/);
  });

  it('ne confond pas le CSS homonyme de Leaflet avec un membre de l’unité', () => {
    // Le CSS de Leaflet fait quelques Ko et n'entre dans aucun budget de JS :
    // seuls les chunks .js sont surveillés.
    const root = makeBuild({
      initial: ['index-entry.js'],
      chunks: { 'vendor-leaflet-carte.css': 2 * 1024 },
      sources: {
        'Jobs-page.js':
          'import"./vendor-leaflet-carte.css";const m=await import("./JobsMap-carte.js");export default m;',
      },
    });
    const result = checkBundleSize({ root, quiet: true });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('check-bundle-size — garde anti-dérive des budgets', () => {
  it('les budgets restent dans un ordre de grandeur plausible', () => {
    // Évite qu'un futur commit « débloque » la CI en gonflant un seuil à
    // l'infini : au-delà, ce n'est plus un budget.
    expect(BUDGETS.initialGzip).toBeLessThanOrEqual(200 * 1024);
    expect(BUDGETS.largestChunkGzip).toBeLessThanOrEqual(300 * 1024);
    expect(BUDGETS.totalRaw).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
});
