import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ALLOWED_PURPOSES,
  MANIFEST_FILE,
  FAMILY_MANIFEST_FILE,
  parseManifest,
  parseSizes,
  splitPurposes,
  runPwaManifestCheck,
} from '../check-pwa-manifest';

// Tests du garde-fou du manifeste PWA (scripts/check-pwa-manifest.js). Le cœur
// du sujet est la propriété « maskable » : elle ne se déclare pas, elle se
// MESURE. Les fichiers actuels du dépôt ne la possédaient pas (contenu à un
// rayon de 0,495 pour une limite de 0,400) et le manifeste l'annonçait pourtant
// sur ses deux icônes — c'est exactement ce que ces cas couvrent.
//
// Le garde s'appuie sur l'inventaire de la famille (icons-assets.manifest.json),
// qui est donc construit ici comme une fixture : aucun Python n'est requis.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// PNG minimal mais VALIDE au sens du check : signature + chunk IHDR.
const fakePng = (width, height) => {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

const PLAIN = [
  ['icon-192x192.png', 192],
  ['icon-512x512.png', 512],
];
const MASKABLE = [
  ['icon-192x192-maskable.png', 192, 0.378],
  ['icon-512x512-maskable.png', 512, 0.379],
];

/**
 * Construit un manifeste PWA conforme, puis laisse `mutate` casser un point
 * précis. `write()` réécrit les deux fichiers depuis les objets (mutés).
 */
const buildFixture = (mutate = () => {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-pwa-'));
  tempDirs.push(root);
  const iconsDir = path.join(root, 'public', 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });

  for (const [name, size] of [...PLAIN, ...MASKABLE.map(([n, s]) => [n, s])]) {
    fs.writeFileSync(path.join(iconsDir, name), fakePng(size, size));
  }

  const family = {
    outputs: PLAIN.map(([file, size]) => ({
      file,
      width: size,
      height: size,
      pixel_sha256: 'a'.repeat(64),
    })),
    maskable: {
      sizes: [192, 512],
      background: '#0f172a',
      safe_zone_radius: 0.4,
      content_radius_target: 0.38,
      outputs: MASKABLE.map(([file, size, radius]) => ({
        file,
        width: size,
        height: size,
        pixel_sha256: 'b'.repeat(64),
        content_radius: radius,
        opaque: true,
      })),
    },
  };

  const manifest = {
    id: '/',
    name: 'KOJO',
    background_color: '#0f172a',
    icons: [
      { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-192x192-maskable.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512x512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };

  const manifestPath = path.join(root, MANIFEST_FILE);
  const familyPath = path.join(root, FAMILY_MANIFEST_FILE);
  const write = () => {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    fs.writeFileSync(familyPath, JSON.stringify(family, null, 2));
  };
  write();

  mutate({ root, manifest, family, manifestPath, familyPath, iconsDir, write });

  return { root, run: () => runPwaManifestCheck({ root, quiet: true }) };
};

describe('manifeste conforme', () => {
  it('est vert sur une configuration complète', () => {
    const fixture = buildFixture();
    const result = fixture.run();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.icons).toHaveLength(4);
    expect(result.icons.filter((icon) => icon.maskable)).toHaveLength(2);
  });

  it('tolère le BOM du manifeste (le fichier du dépôt en porte un)', () => {
    const fixture = buildFixture(({ write, manifestPath }) => {
      const text = fs.readFileSync(manifestPath, 'utf8');
      fs.writeFileSync(manifestPath, `\uFEFF${text}`);
    });
    const result = fixture.run();
    expect(result.ok).toBe(true);
  });

  it('refuse un manifeste absent', () => {
    const fixture = buildFixture(({ manifestPath }) => fs.rmSync(manifestPath));
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/public\/manifest\.json absent/);
  });

  it('refuse un manifeste illisible', () => {
    const fixture = buildFixture(({ manifestPath }) => fs.writeFileSync(manifestPath, '{ pas du json'));
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/illisible \(JSON invalide\)/);
  });
});

describe('cohérence avec le fond des variantes maskable', () => {
  it('refuse un background_color différent du fond de composition', () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.background_color = '#ffffff';
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/annonce background_color « #ffffff »/);
  });
});

describe('icônes déclarées : existence, dimensions, type', () => {
  it('refuse une icône déclarée mais absente du disque', () => {
    const fixture = buildFixture(({ iconsDir }) => {
      fs.rmSync(path.join(iconsDir, 'icon-192x192.png'));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/icon-192x192\.png manquant/);
  });

  it('refuse un src qui sort de public/', () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.icons[0].src = '/../secret.png';
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/sort de public\//);
  });

  it('refuse des dimensions annoncées qui ne sont pas celles du fichier', () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.icons[0].sizes = '160x160';
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/fait 192×192 alors que le manifeste annonce « 160x160 »/);
  });

  it('refuse un « type » qui ne correspond pas au fichier', () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.icons[0].type = 'image/webp';
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/son « type » vaut « image\/webp »/);
  });

  it('refuse un « sizes » illisible', () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.icons[0].sizes = '192';
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/doit valoir « <largeur>x<hauteur> »/);
  });

  it('refuse un fichier qui n\'est pas un PNG', () => {
    const fixture = buildFixture(({ iconsDir }) => {
      fs.writeFileSync(path.join(iconsDir, 'icon-192x192.png'), Buffer.from('pas un png'));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/n'est pas un PNG valide/);
  });

  it('signale (sans échouer) une icône hors de l\'inventaire de la famille', () => {
    const fixture = buildFixture(({ iconsDir, manifest, write }) => {
      fs.writeFileSync(path.join(iconsDir, 'extra.png'), fakePng(256, 256));
      manifest.icons.push({ src: '/icons/extra.png', sizes: '256x256', type: 'image/png', purpose: 'any' });
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(true);
    expect(result.notices.join('\n')).toMatch(/sans appartenir à l'inventaire de la famille/);
  });
});

describe('purpose', () => {
  it('refuse un jeton inconnu', () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.icons[0].purpose = 'any decorative';
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/purpose inconnu \(decorative\)/);
  });

  it('refuse un jeton répété', () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.icons[0].purpose = 'any any';
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/répète un jeton/);
  });

  it("accepte « monochrome » seul", () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.icons[0].purpose = 'monochrome';
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(true);
  });
});

describe('la propriété « maskable » se prouve', () => {
  it("refuse « maskable » sur une icône qui n'est pas une variante du générateur", () => {
    // C'est le défaut d'origine : une icône normale annoncée maskable.
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.icons[0].purpose = 'any maskable';
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /est déclaré « maskable » mais n'est pas une variante fabriquée pour le masque/
    );
  });

  it('refuse « maskable » quand le contenu déborde la zone de sécurité', () => {
    const fixture = buildFixture(({ family, write }) => {
      family.maskable.outputs[0].content_radius = 0.495;
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /contenu jusqu'à un rayon de 0\.495 alors que le masque ne garantit que 0\.4/
    );
  });

  it("refuse « maskable » sur une variante non opaque", () => {
    const fixture = buildFixture(({ family, write }) => {
      family.maskable.outputs[0].opaque = false;
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/sans être entièrement opaque/);
  });

  it("refuse « maskable » à une taille absente de maskable.sizes", () => {
    const fixture = buildFixture(({ family, write }) => {
      family.maskable.sizes = [512];
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/taille absente de maskable\.sizes/);
  });

  it('refuse une variante maskable fabriquée mais jamais déclarée', () => {
    const fixture = buildFixture(({ iconsDir }) => {
      fs.writeFileSync(path.join(iconsDir, 'icon-384x384-maskable.png'), fakePng(384, 384));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/icon-384x384-maskable\.png existe mais n'est déclarée nulle part/);
  });

  it("refuse de conclure si le manifeste de la famille n'a pas de section maskable", () => {
    const fixture = buildFixture(({ family, write }) => {
      delete family.maskable;
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/ne déclare pas de section « maskable »/);
  });
});

describe('lecture pure', () => {
  it('parse « largeur x hauteur » et réserve « any » au vectoriel', () => {
    expect(parseSizes('192x192')).toEqual({ width: 192, height: 192 });
    expect(parseSizes('any')).toEqual({ any: true });
    expect(parseSizes('192')).toBeNull();
    expect(parseSizes(undefined)).toBeNull();
  });

  it('découpe les jetons de purpose, « any » par défaut', () => {
    expect(splitPurposes('any maskable')).toEqual(['any', 'maskable']);
    expect(splitPurposes('  maskable  ')).toEqual(['maskable']);
    expect(splitPurposes(undefined)).toEqual(['any']);
  });

  it('retire le BOM avant de parser', () => {
    expect(parseManifest('\uFEFF{"a":1}')).toEqual({ a: 1 });
  });

  it('reconnaît exactement les trois jetons de la spécification', () => {
    expect(ALLOWED_PURPOSES).toEqual(['any', 'maskable', 'monochrome']);
  });
});

describe('dépôt réel', () => {
  it('est vert sur le vrai manifeste et le vrai inventaire', () => {
    const result = runPwaManifestCheck({ root: REPO_ROOT, quiet: true });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    // Deux icônes normales + deux variantes maskable réellement fabriquées.
    expect(result.icons).toHaveLength(4);
    expect(result.icons.every((icon) => !icon.maskable || icon.src.includes('-maskable'))).toBe(true);
  });
});
