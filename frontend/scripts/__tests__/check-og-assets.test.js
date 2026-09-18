import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { MANIFEST_NAME, REFERENCE_FONTS, runOgAssetsCheck } from '../check-og-assets';

// Tests du garde-fou « cartes Open Graph » (scripts/check-og-assets.js) :
//   - un seul générateur OG toléré dans scripts/, détecté par le NOM (jeton
//     « og » + verbe de production, quelle que soit l'extension) ET, pour un
//     nom anodin, par le CONTENU (écrit une image + vise une carte OG) ;
//   - aucun faux positif sur un script qui ne fait que LIRE les cartes ;
//   - le manifeste est lu DANS le générateur (aucune constante dupliquée) ;
//   - chaque PNG déclaré doit exister, être un vrai PNG et respecter ses
//     dimensions (signature + IHDR) ;
//   - aucun og-*.png orphelin dans public/ ;
//   - le MANIFESTE de reproductibilité (empreintes SHA-256 des cartes,
//     empreinte du générateur, polices retenues) est confronté aux fichiers
//     commités : carte retouchée, générateur modifié sans régénération,
//     cartes refaites avec une autre police ;
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

// Faux générateur au nom ANODIN : seuls le contenu (écriture d'image) et la
// cible (une carte OG) le trahissent.
const WRITING_GENERATOR = `import os
from PIL import Image

out = os.path.join(os.path.dirname(__file__), '..', 'public', 'og-extra.png')
Image.new('RGB', (1200, 630)).save(out, 'PNG', optimize=True)
`;

// Script qui ne fait que LIRE la carte : il mentionne « og-*.png » mais
// n'écrit rien — il ne doit JAMAIS être pris pour un générateur.
const READER_SCRIPT = `import { readFileSync } from 'node:fs';

const bytes = readFileSync('public/og-jobs.png');
console.log(bytes.length, 'octets dans og-jobs.png');
`;

const DEFAULT_ASSETS = {
  'og-home.png': fakePng(1200, 630),
  'og-jobs.png': fakePng(1200, 630),
  'og-home-square.png': fakePng(1200, 1200),
  'icons/icon-dark.png': fakePng(512, 512),
};

// `manifest` : undefined → manifeste COHÉRENT construit comme le fait le
// générateur (nom, empreinte du script, polices de référence, empreintes des
// PNG) ; `null` → aucun manifeste ; objet → fusion superficielle sur ce
// manifeste cohérent, pour n'injecter que la divergence testée.
const makeFixture = ({
  generator = GENERATOR_FIXTURE,
  extraScripts = [],
  assets = {},
  manifest = undefined,
} = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-assets-'));
  tempDirs.push(root);
  const scriptsDir = path.join(root, 'scripts');
  const publicDir = path.join(root, 'public');
  fs.mkdirSync(scriptsDir);
  fs.mkdirSync(publicDir);

  if (generator) fs.writeFileSync(path.join(scriptsDir, 'gen-og-images.py'), generator);
  for (const entry of extraScripts) {
    // Une entrée est soit un nom (contenu neutre), soit [nom, contenu] pour
    // exercer la détection par le CONTENU.
    const [name, content] = Array.isArray(entry) ? entry : [entry, '# second script\n'];
    fs.writeFileSync(path.join(scriptsDir, name), content);
  }

  const written = [];
  for (const [rel, buffer] of Object.entries({ ...DEFAULT_ASSETS, ...assets })) {
    if (!buffer) continue; // valeur `null` → fichier volontairement absent
    const full = path.join(publicDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
    written.push([rel, buffer]);
  }

  const autoManifest = {
    generator: 'gen-og-images.py',
    generator_sha256: generator
      ? crypto.createHash('sha256').update(Buffer.from(generator)).digest('hex')
      : null,
    fonts: { ...REFERENCE_FONTS },
    assets: written.map(([rel, buffer]) => ({
      file: rel,
      ...dimsOf(buffer),
      format: 'fixture',
      bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    })),
  };
  const finalManifest = manifest === null ? null : { ...autoManifest, ...(manifest || {}) };
  if (finalManifest) {
    fs.writeFileSync(
      path.join(scriptsDir, MANIFEST_NAME),
      JSON.stringify(finalManifest, null, 2) + '\n'
    );
  }
  return root;
};

// Dimensions d'un faux PNG de la fixture (0 si le buffer est trop court, comme
// pour le cas « fichier qui n'est pas un PNG valide »).
const dimsOf = (buffer) =>
  buffer.length >= 33
    ? { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    : { width: 0, height: 0 };

// Recharger le manifeste écrit par la fixture pour le retoucher après coup
// (carte remplacée, entrée ajoutée…).
const manifestPathOf = (root) => path.join(root, 'scripts', MANIFEST_NAME);
const readManifest = (root) => JSON.parse(fs.readFileSync(manifestPathOf(root), 'utf8'));
const writeManifest = (root, manifest) =>
  fs.writeFileSync(manifestPathOf(root), JSON.stringify(manifest, null, 2) + '\n');

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

  // Noms que l'ancien motif /^gen[-_]?og.*\.py$/ laissait passer : verbe autre
  // que « gen », « og » en tête, extension autre que .py.
  it('détecte les noms de générateurs que l’ancien motif laissait passer', () => {
    const names = ['generate-og-cards.py', 'og-generator.py', 'gen-og-images.js', 'make-og-cards.sh'];
    for (const name of names) {
      const result = run({ root: makeFixture({ extraScripts: [name] }) });
      expect(result.ok, `${name} devrait être détecté`).toBe(false);
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(result.errors.join('\n')).toMatch(
        new RegExp(`second générateur OG détecté \\(${escaped}\\) : son nom annonce`)
      );
    }
  });

  it('détecte par le CONTENU un générateur au nom anodin', () => {
    const result = run({ root: makeFixture({ extraScripts: [['cards.py', WRITING_GENERATOR]] }) });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /second générateur OG détecté \(cards\.py\) : ce fichier écrit une carte OG/
    );
  });

  it('ne confond pas un script qui ne fait que LIRE une carte avec un générateur', () => {
    const result = run({ root: makeFixture({ extraScripts: [['og-card-reader.js', READER_SCRIPT]] }) });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("n'alerte pas sur un générateur d'images qui n'est pas Open Graph", () => {
    const result = run({ root: makeFixture({ extraScripts: ['gen-seo-images.py'] }) });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
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

  it('le manifeste versionné décrit les cartes du dépôt, avec la police de référence', () => {
    const manifest = readManifest(REPO_ROOT);
    expect(manifest.generator).toBe('gen-og-images.py');
    expect(manifest.fonts).toEqual(REFERENCE_FONTS);
    expect(manifest.assets).toHaveLength(7);
  });
});

describe('check-og-assets — manifeste de reproductibilité', () => {
  it('cas nominal : manifeste cohérent avec les fichiers → ok', () => {
    const result = run({ root: makeFixture() });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('échoue si le manifeste est absent', () => {
    const result = run({ root: makeFixture({ manifest: null }) });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/manifeste og-assets\.manifest\.json absent/);
  });

  it('détecte une carte retouchée à la main (empreinte divergente)', () => {
    const root = makeFixture();
    // Octets changés APRÈS l'écriture du manifeste : dimensions intactes, donc
    // seule l'empreinte peut le révéler.
    const tampered = Buffer.concat([DEFAULT_ASSETS['og-jobs.png'], Buffer.from([0])]);
    fs.writeFileSync(path.join(root, 'public', 'og-jobs.png'), tampered);
    const result = run({ root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/og-jobs\.png ne correspond plus au manifeste/);
    expect(result.errors.join('\n')).toMatch(/check-og-reproducible\.js/);
  });

  it('détecte un générateur modifié sans régénération', () => {
    const root = makeFixture();
    fs.appendFileSync(path.join(root, 'scripts', 'gen-og-images.py'), '\n# retouche après génération\n');
    const result = run({ root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/a changé depuis la dernière génération/);
  });

  // Empreinte du contenu NORMALISÉ en LF, comme l'écrit le générateur Python
  // (read_bytes().replace(b"\r\n", b"\n")) et comme la vérifie le check.
  const normalizedFingerprint = (text) =>
    crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

  it("tolère un générateur en CRLF : le fin de ligne n'est pas une propriété du code", () => {
    // Mesuré dans ce dépôt : le même fichier valait b1ee7044… en CRLF et
    // d531db3f… en LF, si bien qu'un manifeste écrit sous Windows était refusé
    // par la CI Linux — un rouge fantôme sur du code identique.
    const root = makeFixture({
      generator: GENERATOR_FIXTURE.replace(/\n/g, '\r\n'),
      manifest: { generator_sha256: normalizedFingerprint(GENERATOR_FIXTURE) },
    });
    expect(run({ root }).ok).toBe(true);
  });

  it('détecte toujours un générateur réellement modifié, même en CRLF', () => {
    const root = makeFixture({
      generator: GENERATOR_FIXTURE.replace(/\n/g, '\r\n') + '\r\n# retouche reelle\r\n',
      manifest: { generator_sha256: normalizedFingerprint(GENERATOR_FIXTURE) },
    });
    const result = run({ root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/a changé depuis la dernière génération/);
  });

  it('refuse des cartes régénérées avec une AUTRE police', () => {
    const result = run({
      root: makeFixture({
        manifest: { fonts: { regular: 'DejaVuSans.ttf', bold: 'arialbd.ttf' } },
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /police « DejaVuSans\.ttf » \(regular\) au lieu de la référence « arial\.ttf »/
    );
  });

  it('détecte des dimensions de manifeste incohérentes avec le générateur', () => {
    const root = makeFixture();
    const manifest = readManifest(root);
    manifest.assets = manifest.assets.map((entry) =>
      entry.file === 'og-jobs.png' ? { ...entry, width: 1111 } : entry
    );
    writeManifest(root, manifest);
    const result = run({ root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/og-jobs\.png : dimensions du manifeste \(1111×630\)/);
  });

  it('détecte un manifeste qui décrit une carte abandonnée par le générateur', () => {
    const root = makeFixture();
    const manifest = readManifest(root);
    manifest.assets.push({
      file: 'og-abandonnee.png',
      width: 1200,
      height: 630,
      format: 'wide',
      bytes: 33,
      sha256: 'a'.repeat(64),
    });
    writeManifest(root, manifest);
    const result = run({ root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /décrit og-abandonnee\.png, que gen-og-images\.py ne déclare plus/
    );
  });
});
