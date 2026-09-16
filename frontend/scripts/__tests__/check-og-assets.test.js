import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { runOgAssetsCheck } from '../check-og-assets';

// Tests du garde-fou « cartes Open Graph » (scripts/check-og-assets.js) :
//   - un seul générateur OG toléré dans scripts/ ;
//   - le manifeste est lu DANS le générateur (aucune constante dupliquée) ;
//   - chaque PNG déclaré doit exister, être un vrai PNG et respecter ses
//     dimensions (signature + IHDR) ;
//   - aucun og-*.png orphelin dans public/ ;
//   - le check est vert sur le dépôt réel.
//
// Les cas négatifs tournent sur une arborescence temporaire : le vrai dépôt
// n'est jamais modifié.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Générateur minimal reproduisant la structure attendue par le check :
// constantes de formats, VARIANTS / SQUARE_VARIANTS, favicon sombre.
const GENERATOR_FIXTURE = `W, H = 1200, 630
SQUARE = 1200
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public')

VARIANTS = {
    "og-home.png": {
        "tagline_lines": ["Accueil"],
    },
    "og-jobs.png": {
        "tagline_lines": ["Emplois"],
    },
}

SQUARE_VARIANTS = {
    "og-home-square.png": "og-home.png",
}


def main():
    favicon = make_dark_favicon(512)
    out = os.path.join(OUT_DIR, 'icons', 'icon-dark.png')
`;

// PNG minimal mais VALIDE pour le check : signature + chunk IHDR portant les
// dimensions. Le check ne décode pas l'image, il ne lit que ces 33 octets.
const fakePng = (width, height) => {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

const DEFAULT_ASSETS = {
  'og-home.png': fakePng(1200, 630),
  'og-jobs.png': fakePng(1200, 630),
  'og-home-square.png': fakePng(1200, 1200),
  'icons/icon-dark.png': fakePng(512, 512),
};

const makeFixture = ({ generator = GENERATOR_FIXTURE, extraScripts = [], assets = {} } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-assets-'));
  tempDirs.push(root);
  const scriptsDir = path.join(root, 'scripts');
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(scriptsDir);
  fs.mkdirSync(publicDir);

  if (generator) fs.writeFileSync(path.join(scriptsDir, 'gen-og-images.py'), generator);
  for (const name of extraScripts) fs.writeFileSync(path.join(scriptsDir, name), '# second script\n');

  for (const [rel, buffer] of Object.entries({ ...DEFAULT_ASSETS, ...assets })) {
    if (!buffer) continue; // valeur `null` → fichier volontairement absent
    const full = path.join(publicDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
  }
  return root;
};

const run = (options) => runOgAssetsCheck({ ...options, quiet: true });

describe('check-og-assets — manifeste lu dans le générateur', () => {
  it('cas nominal : générateur unique et PNG conformes → ok', () => {
    const result = run({ root: makeFixture() });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.assets.map((asset) => asset.file)).toEqual([
      'og-home.png',
      'og-jobs.png',
      'og-home-square.png',
      'icons/icon-dark.png',
    ]);
  });

  it('détecte un SECOND générateur OG (deux sources de vérité)', () => {
    const result = run({ root: makeFixture({ extraScripts: ['gen_og_image.py'] }) });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/second générateur OG détecté \(gen_og_image\.py\)/);
  });

  it('échoue si le générateur canonique est absent', () => {
    const result = run({ root: makeFixture({ generator: null }) });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/générateur canonique absent/);
  });

  it('échoue si une constante de format disparaît du générateur', () => {
    const generator = GENERATOR_FIXTURE.replace('SQUARE = 1200\n', '');
    const result = run({ root: makeFixture({ generator }) });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/constante « SQUARE = … » introuvable/);
  });
});

describe('check-og-assets — conformité des PNG versionnés', () => {
  it('détecte un PNG déclaré mais absent de public/', () => {
    const result = run({ root: makeFixture({ assets: { 'og-jobs.png': null } }) });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/public\/og-jobs\.png manquant/);
  });

  it('détecte des dimensions qui ne correspondent plus au manifeste', () => {
    const result = run({
      root: makeFixture({ assets: { 'og-home-square.png': fakePng(1200, 630) } }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/fait 1200×630 alors que gen-og-images\.py déclare 1200×1200/);
  });

  it("détecte un fichier qui n'est pas un PNG valide", () => {
    const result = run({
      root: makeFixture({ assets: { 'og-home.png': Buffer.from('pas une image') } }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/n'est pas un PNG valide/);
  });

  it('détecte un og-*.png ORPHELIN (absent du manifeste)', () => {
    const result = run({
      root: makeFixture({ assets: { 'og-legacy.png': fakePng(1200, 630) } }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/og-\*\.png orphelin\(s\).*og-legacy\.png/);
  });
});

describe('check-og-assets — dépôt réel', () => {
  it('est vert sur le dépôt courant (une seule source de vérité)', () => {
    const result = run({ root: REPO_ROOT });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    // Les trois cartes du pré-rendu par route + variantes carrées + favicon.
    const files = result.assets.map((asset) => asset.file);
    expect(files).toContain('og-jobs.png');
    expect(files).toContain('og-login.png');
    expect(files).toContain('og-image-1200x630.png');
    expect(result.assets.every((asset) => asset.width > 0 && asset.height > 0)).toBe(true);
  });
});
