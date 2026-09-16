import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { checkBundleSize, BUDGETS } from '../check-bundle-size';

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

const makeBuild = ({ chunks = {}, initial, extraFiles = {}, indexHtml } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-size-'));
  tempDirs.push(root);
  const assets = path.join(root, 'build', 'assets');
  fs.mkdirSync(assets, { recursive: true });

  for (const [name, size] of Object.entries(chunks)) {
    fs.writeFileSync(path.join(assets, name), randomBytes(size));
  }
  for (const [rel, size] of Object.entries(extraFiles)) {
    const full = path.join(root, 'build', rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.alloc(size));
  }

  // Par défaut tous les chunks sont préchargés ; `initial` permet de ne
  // précharger QUE le chemin critique (les autres restent des chunks lazy,
  // présents dans le build mais absents d'index.html).
  const preloaded = initial ?? Object.keys(chunks);
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

describe('check-bundle-size — garde anti-dérive des budgets', () => {
  it('les budgets restent dans un ordre de grandeur plausible', () => {
    // Évite qu'un futur commit « débloque » la CI en gonflant un seuil à
    // l'infini : au-delà, ce n'est plus un budget.
    expect(BUDGETS.initialGzip).toBeLessThanOrEqual(200 * 1024);
    expect(BUDGETS.largestChunkGzip).toBeLessThanOrEqual(300 * 1024);
    expect(BUDGETS.totalRaw).toBeLessThanOrEqual(8 * 1024 * 1024);
    // …et qu'ils ne soient pas resserrés sous la mesure réelle connue
    // (98,5 Ko gzip de JS initial, chunk vendor-sentry 156,4 Ko).
    expect(BUDGETS.initialGzip).toBeGreaterThan(100 * 1024);
    expect(BUDGETS.largestChunkGzip).toBeGreaterThan(160 * 1024);
  });
});
