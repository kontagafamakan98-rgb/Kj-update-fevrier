import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  FAMILY_DIR,
  GENERATOR_NAME,
  ICON_READ_ONLY_SCRIPTS,
  MANIFEST_NAME,
  OG_MANIFEST_PATH,
  readIcoDirectory,
  readPngSize,
  runGeneratedIconsCheck,
} from '../check-generated-icons';

// Tests du garde-fou de la famille « icônes » (scripts/check-generated-icons.js) :
//   - nul besoin de Python : les empreintes de pixels et le rejeu du générateur
//     sont INJECTÉS, si bien que ces tests sont hermétiques et instantanés (le
//     script réel les branche sur generate_icons.py) ;
//   - le favicon clair doit être un ICO VALIDE (le fichier de 100 octets de
//     zéros ne doit plus jamais passer) ;
//   - les fichiers COMMITTÉS doivent porter les pixels du manifeste, y compris
//     à dimensions identiques — c'est ce qu'une comparaison d'octets ne saurait
//     pas faire d'une machine à l'autre ;
//   - l'inventaire est complet : une icône non déclarée est refusée ;
//   - la racine de public/ ne contient AUCUN doublon d'icône (favicon.png,
//     icon-192x192.png et icon-512x512.png y étaient servis sans être référencés
//     nulle part), alors que favicon.ico, exigé par index.html, reste ;
//   - les actifs sans générateur ne dérivent pas, la délégation à une autre
//     famille est réellement honorée et le générateur ne change pas sans
//     régénération ;
//   - le check est vert sur le DÉPÔT RÉEL.
//
// Les cas passent par une arborescence temporaire : le vrai dépôt n'est jamais
// modifié.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const FAVICON_SIZES = [16, 32, 48];
// Variantes fabriquées pour les masques : nom, taille, rayon mesuré du contenu.
const MASKABLE = [
  ['icon-192x192-maskable.png', 192, 0.378],
  ['icon-512x512-maskable.png', 512, 0.379],
];
// Les variantes maskable n'y figurent PAS : elles sont désormais des sorties du
// générateur. Les déclarer ici en plus les ferait contrôler deux fois, par deux
// règles contradictoires.
const UNMANAGED = {
  'kojo-icon.svg': 'icône vectorielle source (dessin, pas de génération)',
};

// PNG minimal mais VALIDE au sens du check : signature + chunk IHDR portant les
// dimensions (le check ne décode pas l'image).
const fakePng = (width, height) => {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

// ICO de test : en-tête valide, répertoire, puis un PNG embarqué par taille.
const fakeIco = (sizes) => {
  const blobs = sizes.map((size) => fakePng(size, size));
  const header = Buffer.alloc(6);
  header.write('\x00\x00\x01\x00', 0, 'latin1');
  header.writeUInt16LE(sizes.length, 4);
  const directory = Buffer.alloc(16 * sizes.length);
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((size, index) => {
    const base = index * 16;
    const dimension = size >= 256 ? 0 : size;
    directory[base] = dimension;
    directory[base + 1] = dimension;
    directory.writeUInt32LE(blobs[index].length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += blobs[index].length;
  });
  return Buffer.concat([header, directory, ...blobs]);
};

// Stub d'empreintes de PIXELS : par convention de ces tests, l'empreinte est
// celle des octets du fichier (ou du blob embarqué pour un ICO). Une mutation
// du fichier change donc l'empreinte, exactement comme le ferait un changement
// de pixels dans le vrai générateur.
// `report` porte les mesures que le vrai générateur calcule depuis les pixels :
// c'est lui qui permet de tester les contrôles de zone de sécurité et d'opacité
// sans décoder un vrai PNG en JavaScript.
const stubDigestFiles = (files, report = new Map()) =>
  Object.fromEntries(
    files.map((file) => {
      const data = fs.readFileSync(file);
      const directory = readIcoDirectory(data);
      if (directory.ok) {
        return [
          file,
          {
            kind: 'ico',
            entries: directory.entries.map((entry) => ({
              pixel_sha256: hash(data.subarray(entry.start, entry.start + entry.bytes)),
            })),
          },
        ];
      }
      const measured = report.get(file) || {};
      return [
        file,
        {
          kind: 'png',
          pixel_sha256: hash(data),
          content_radius: measured.content_radius ?? 0.5,
          content_radius_background: measured.content_radius_background ?? 0.38,
          opaque: measured.opaque ?? true,
        },
      ];
    })
  );

/**
 * Construit une famille d'icônes conforme, puis laisse `mutate` casser un point
 * précis. Renvoie de quoi appeler le check en mode hermétique.
 */
const buildFixture = (mutate = () => {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-icons-test-'));
  tempDirs.push(root);
  const family = path.join(root, FAMILY_DIR);
  const publicDir = path.join(root, 'public');
  const scriptsDir = path.join(root, 'scripts');
  fs.mkdirSync(family, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });

  const generatorPath = path.join(family, GENERATOR_NAME);
  fs.writeFileSync(generatorPath, '#!/usr/bin/env python3\nSIZES = [72, 96]\n');

  const outputs = SIZES.map((size) => {
    const file = `icon-${size}x${size}.png`;
    const data = fakePng(size, size);
    fs.writeFileSync(path.join(family, file), data);
    return { file, width: size, height: size, color_type: 6, pixel_sha256: hash(data) };
  });

  const faviconData = fakeIco(FAVICON_SIZES);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), faviconData);
  const faviconEntries = readIcoDirectory(faviconData).entries.map((entry, index) => ({
    width: entry.width,
    height: entry.height,
    color_type: 6,
    pixel_sha256: hash(faviconData.subarray(entry.start, entry.start + entry.bytes)),
  }));

  const unmanaged = [];
  for (const [file, why] of Object.entries(UNMANAGED)) {
    const data = Buffer.from(`contenu ${file}`);
    fs.writeFileSync(path.join(family, file), data);
    unmanaged.push({ file, bytes: data.length, sha256: hash(data), why });
  }

  // Variantes maskable : fabriquées, donc opaques et cantonnées à la zone de
  // sécurité. Un fichier de la famille qui ne serait pas déclaré ici ferait
  // échouer l'inventaire.
  const report = new Map();
  const maskableOutputs = MASKABLE.map(([file, size, radius]) => {
    const data = fakePng(size, size);
    const filePath = path.join(family, file);
    fs.writeFileSync(filePath, data);
    report.set(filePath, { content_radius_background: radius, opaque: true });
    return {
      file,
      width: size,
      height: size,
      color_type: 6,
      pixel_sha256: hash(data),
      content_radius: radius,
      opaque: true,
    };
  });

  // icon-dark.png appartient en réalité au générateur des cartes OG : il est
  // déclaré « foreign » et doit l'être aussi dans le manifeste de l'autre famille.
  const darkData = Buffer.from('dark');
  fs.writeFileSync(path.join(family, 'icon-dark.png'), darkData);
  fs.writeFileSync(
    path.join(scriptsDir, path.basename(OG_MANIFEST_PATH)),
    JSON.stringify({ assets: [{ file: `icons/icon-dark.png`, width: 512, height: 512 }] })
  );

  const manifest = {
    generator: GENERATOR_NAME,
    generator_sha256: hash(fs.readFileSync(generatorPath)),
    sizes: SIZES,
    favicon_sizes: FAVICON_SIZES,
    source: { file: 'icon-512x512.png', width: 512, height: 512, pixel_sha256: hash(fakePng(512, 512)) },
    outputs,
    favicon: { file: '../favicon.ico', entries: faviconEntries },
    maskable: {
      sizes: MASKABLE.map(([, size]) => size),
      background: '#0f172a',
      safe_zone_radius: 0.4,
      content_radius_target: 0.38,
      source_content_radius: 0.495,
      scale: 0.768,
      outputs: maskableOutputs,
    },
    unmanaged,
    foreign: [{ file: 'icon-dark.png', generated_by: 'gen-og-images.py' }],
  };
  const manifestPath = path.join(family, MANIFEST_NAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  mutate({ root, family, manifestPath, manifest, outputs, report, maskableOutputs });

  return {
    root,
    run: (overrides = {}) =>
      runGeneratedIconsCheck({
        root,
        quiet: true,
        digestFiles: (files) => stubDigestFiles(files, report),
        // Rejeu du générateur : le manifeste fraîchement produit est, par
        // défaut, celui qui est sur le disque (générateur inchangé).
        regenerate: () => JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
        ...overrides,
      }),
  };
};

describe('inventaire et structure', () => {
  it('est vert sur une famille conforme', () => {
    const fixture = buildFixture();
    const result = fixture.run();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    // 8 icônes PWA + 3 images embarquées dans le favicon clair + 2 variantes
    // fabriquées pour les masques.
    expect(result.outputs).toHaveLength(SIZES.length + FAVICON_SIZES.length + MASKABLE.length);
  });

  it('refuse une icône non déclarée dans la famille', () => {
    const fixture = buildFixture(({ family }) => {
      fs.writeFileSync(path.join(family, 'icon-999x999.png'), fakePng(999, 999));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/icon-999x999\.png n'est déclarée par aucun manifeste/);
  });

  it('refuse un fichier déclaré mais absent', () => {
    const fixture = buildFixture(({ family }) => {
      fs.rmSync(path.join(family, 'icon-96x96.png'));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/icon-96x96\.png manquant/);
  });

  it('refuse un script non déclaré dans le dossier de la famille', () => {
    const fixture = buildFixture(({ family, manifestPath, manifest }) => {
      fs.writeFileSync(path.join(family, 'resize.py'), 'print("hello")\n');
      // Le manifeste doit rester cohérent pour que l'échec porte sur le script.
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/script non déclaré dans public\/icons\/ \(resize\.py\)/);
  });

  it("refuse un second générateur d'icônes au nom anodin, détecté par le contenu", () => {
    const fixture = buildFixture(({ root }) => {
      fs.writeFileSync(
        path.join(root, 'scripts', 'cards.py'),
        'from PIL import Image\nimg.save("icon-192x192.png")\n'
      );
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/second générateur d'icônes détecté/);
  });

  it('déclare ses propres lecteurs en lecture seule, et ceux-ci existent bien', () => {
    // Le garde s'inspecte lui-même : il est dans ICON_READ_ONLY_SCRIPTS, sans
    // quoi son propre nom d'icône déclencherait la détection de second générateur.
    expect(ICON_READ_ONLY_SCRIPTS).toContain('check-generated-icons.js');
    const itself = path.resolve(__dirname, '..', 'check-generated-icons.js');
    expect(fs.existsSync(itself)).toBe(true);
    // Il ne doit écrire AUCUNE image, sinon il se dénoncerait lui-même.
    const source = fs.readFileSync(itself, 'utf8');
    expect(source).not.toMatch(/\.save\(|Image\.new\(|sharp\(/);
  });
});

describe('favicon clair (favicon.ico)', () => {
  it("refuse le fichier de 100 octets de zéros qui était committé", () => {
    const fixture = buildFixture(({ root }) => {
      fs.writeFileSync(path.join(root, 'public', 'favicon.ico'), Buffer.alloc(100));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    const message = result.errors.join('\n');
    expect(message).toMatch(/n'est pas un ICO exploitable/);
    expect(message).toMatch(/en-tête 00000000/);
    // Le message doit dire POURQUOI ça compte : index.html le référence.
    expect(message).toMatch(/index\.html le référence comme favicon principal/);
  });

  it('refuse un ICO sans aucune image', () => {
    // En-tête valide (reserved=0, type=1) mais répertoire vide.
    const directory = readIcoDirectory(Buffer.from([0, 0, 1, 0, 0, 0]));
    expect(directory.ok).toBe(false);
    expect(directory.reason).toMatch(/aucune image \(count=0\)/);
  });

  it('refuse un ICO trop court', () => {
    expect(readIcoDirectory(Buffer.from([0, 0, 1])).reason).toMatch(/trop court/);
  });

  it('refuse un nombre d\'images différent du manifeste', () => {
    const fixture = buildFixture(({ root }) => {
      fs.writeFileSync(path.join(root, 'public', 'favicon.ico'), fakeIco([16, 32]));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/contient 2 image\(s\) alors que .* en déclare 3/);
  });

  it('accepte un ICO valide et lit son répertoire', () => {
    const directory = readIcoDirectory(fakeIco([16, 32, 48]));
    expect(directory.ok).toBe(true);
    expect(directory.entries.map((entry) => entry.width)).toEqual([16, 32, 48]);
  });
});

describe('pixels des fichiers committés', () => {
  it('refuse une icône retouchée à dimensions identiques', () => {
    const fixture = buildFixture(({ family }) => {
      // Mêmes dimensions, contenu différent : le seul signal possible est
      // l'empreinte de pixels.
      const file = path.join(family, 'icon-72x72.png');
      const data = fakePng(72, 72);
      data[30] = 0xff;
      fs.writeFileSync(file, data);
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/icon-72x72\.png : pixels du fichier committé différents du manifeste/);
  });

  it('refuse une icône aux mauvaises dimensions', () => {
    const fixture = buildFixture(({ family }) => {
      fs.writeFileSync(path.join(family, 'icon-72x72.png'), fakePng(71, 71));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/fait 71×71 alors que .* déclare 72×72/);
  });

  it('refuse un PNG invalide', () => {
    const fixture = buildFixture(({ family }) => {
      fs.writeFileSync(path.join(family, 'icon-72x72.png'), Buffer.from('pas un png'));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/icon-72x72\.png n'est pas un PNG valide/);
  });

  it('annonce et saute la comparaison de pixels quand Python manque, sans fausse rougeur', () => {
    const fixture = buildFixture();
    const result = fixture.run({ digestFiles: null, regenerate: null });
    expect(result.ok).toBe(true);
    expect(result.notices.join('\n')).toMatch(/Python indisponible/);
  });
});

describe('doublons de racine, actifs non gérés et délégation', () => {
  it('accepte une racine de public/ sans doublon', () => {
    const result = buildFixture().run();
    expect(result.ok).toBe(true);
  });

  it.each(['favicon.png', 'icon-192x192.png', 'icon-512x512.png'])(
    'refuse le doublon hérité public/%s de retour à la racine de public/',
    (name) => {
      const fixture = buildFixture(({ root }) => {
        fs.writeFileSync(path.join(root, 'public', name), fakePng(192, 192));
      });
      const result = fixture.run();
      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toMatch(
        new RegExp(`public/${name.replace('.', '\\.')} duplique une icône de la famille`)
      );
    }
  );

  it('laisse passer favicon.ico, la seule image légitime de la racine', () => {
    // index.html pointe vers /favicon.ico : le retirer serait une régression
    // visuelle, donc la règle anti-doublon ne doit viser que les .png.
    const result = buildFixture().run();
    expect(result.ok).toBe(true);
    const errors = result.errors.join('\n');
    expect(errors).not.toMatch(/favicon\.ico/);
  });

  it('refuse un actif sans générateur qui a changé', () => {
    // kojo-icon.svg est le seul actif resté sans générateur (le SVG source).
    const fixture = buildFixture(({ family }) => {
      fs.appendFileSync(path.join(family, 'kojo-icon.svg'), 'x');
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /kojo-icon\.svg a changé depuis le manifeste \(actif SANS générateur/
    );
  });

  it("refuse une délégation que l'autre famille ne confirme pas", () => {
    const fixture = buildFixture(({ root }) => {
      fs.writeFileSync(
        path.join(root, 'scripts', path.basename(OG_MANIFEST_PATH)),
        JSON.stringify({ assets: [] })
      );
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/déclaré produit par gen-og-images\.py, mais .* ne le liste pas/);
  });

  it('refuse un actif déclaré à la fois sans générateur et produit ailleurs', () => {
    const fixture = buildFixture(({ manifestPath, manifest }) => {
      manifest.unmanaged.push({ file: 'icon-dark.png', bytes: 4, sha256: hash(Buffer.from('dark')), why: 'doute' });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/déclaré à la fois « unmanaged » et « foreign »/);
  });
});

describe('manifeste et rejeu du générateur', () => {
  it('refuse un manifeste absent', () => {
    const fixture = buildFixture(({ manifestPath }) => {
      fs.rmSync(manifestPath);
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/manifeste .* absent/);
  });

  it('refuse un manifeste illisible', () => {
    const fixture = buildFixture(({ manifestPath }) => {
      fs.writeFileSync(manifestPath, '{ pas du json');
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/illisible \(JSON invalide\)/);
  });

  it('refuse un générateur modifié sans régénération', () => {
    const fixture = buildFixture(({ family }) => {
      fs.appendFileSync(path.join(family, GENERATOR_NAME), '\n# retouche\n');
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/a changé depuis la dernière génération/);
  });

  it("tolère un générateur en CRLF : le fin de ligne n'est pas une propriété du code", () => {
    // Mesuré dans ce dépôt : generate_icons.py valait b1ee7044… en CRLF (la
    // valeur qu'un manifeste écrit sous Windows consignait) et d531db3f… en LF,
    // celle que calcule la CI Linux. Le garde refuse un manifeste « périmé » sur
    // l'empreinte du générateur : hacher les octets bruts rendait donc la CI
    // rouge sur du code identique. L'empreinte porte sur le contenu NORMALISÉ.
    const fixture = buildFixture(({ family, manifestPath, manifest }) => {
      const generatorPath = path.join(family, GENERATOR_NAME);
      const lf = fs.readFileSync(generatorPath, 'utf8').replace(/\r\n/g, '\n');
      fs.writeFileSync(generatorPath, lf.replace(/\n/g, '\r\n'));
      manifest.generator_sha256 = hash(Buffer.from(lf, 'utf8'));
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    });
    expect(fixture.run().ok).toBe(true);
  });

  it('détecte toujours un générateur réellement modifié, même en CRLF', () => {
    const fixture = buildFixture(({ family, manifestPath, manifest }) => {
      const generatorPath = path.join(family, GENERATOR_NAME);
      const lf = fs.readFileSync(generatorPath, 'utf8').replace(/\r\n/g, '\n');
      // Le CRLF est là pour piéger une normalisation trop permissive : la
      // retouche réelle doit être vue MALGRÉ les sauts de ligne différents.
      fs.writeFileSync(generatorPath, lf.replace(/\n/g, '\r\n') + '\r\n# retouche reelle\r\n');
      manifest.generator_sha256 = hash(Buffer.from(lf, 'utf8'));
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/a changé depuis la dernière génération/);
  });

  it('refuse un manifeste périmé : le générateur produit dautres pixels', () => {
    const fixture = buildFixture();
    const stale = JSON.parse(fs.readFileSync(path.join(fixture.root, FAMILY_DIR, MANIFEST_NAME), 'utf8'));
    stale.outputs[0].pixel_sha256 = 'f'.repeat(64);
    const result = fixture.run({ regenerate: () => stale });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/les pixels produits par generate_icons\.py ont changé/);
  });

  it('refuse un manifeste qui ne décrit plus toutes les tailles annoncées', () => {
    const fixture = buildFixture(({ manifestPath, manifest }) => {
      manifest.sizes = SIZES.slice(0, 3);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/déclare 3 taille\(s\) mais 8 sortie\(s\)/);
  });
});

describe('variantes maskable', () => {
  it('appartiennent à l\'inventaire de la famille', () => {
    const fixture = buildFixture();
    const result = fixture.run();
    expect(result.ok).toBe(true);
    const files = result.outputs.map((output) => output.file);
    for (const [file] of MASKABLE) expect(files).toContain(file);
  });

  it('refuse une variante dont le contenu déborde la zone de sécurité', () => {
    // Le cas réel du dépôt : rayon 0,495 pour une limite de 0,400.
    const fixture = buildFixture(({ family, manifest, manifestPath, report }) => {
      report.set(path.join(family, 'icon-192x192-maskable.png'), {
        content_radius_background: 0.495,
        opaque: true,
      });
      manifest.maskable.outputs[0].content_radius = 0.495;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /contenu jusqu'à un rayon de 0\.495 alors que le masque ne garantit que 0\.4/
    );
  });

  it('refuse une variante qui n\'est pas opaque', () => {
    const fixture = buildFixture(({ family, report }) => {
      report.set(path.join(family, 'icon-192x192-maskable.png'), {
        content_radius_background: 0.378,
        opaque: false,
      });
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/n'est pas entièrement opaque/);
  });

  it('refuse une variante dont la taille est absente de maskable.sizes', () => {
    const fixture = buildFixture(({ manifest, manifestPath }) => {
      manifest.maskable.sizes = [192, 384];
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/taille absente de « maskable.sizes »/);
  });

  it('refuse un manifeste sans section maskable', () => {
    const fixture = buildFixture(({ manifest, manifestPath }) => {
      delete manifest.maskable;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/section « maskable » absente/);
  });
});

describe('lecture PNG', () => {
  it('lit les dimensions du chunk IHDR', () => {
    const fixture = buildFixture();
    const size = readPngSize(path.join(fixture.root, FAMILY_DIR, 'icon-384x384.png'));
    expect(size).toEqual({ width: 384, height: 384 });
  });

  it('renvoie null sur un fichier qui n\'est pas un PNG', () => {
    const fixture = buildFixture();
    expect(readPngSize(path.join(fixture.root, FAMILY_DIR, 'kojo-icon.svg'))).toBeNull();
  });
});

describe('dépôt réel', () => {
  // Ce cas lance deux fois le vrai générateur (rapport de pixels + rejeu) : sous
  // la charge de la suite complète il dépasse le délai par défaut de 5 s, d'où le
  // délai explicite — mesuré 2,8 s seul, 8,8 s en parallèle.
  it(
    'est vert sur les vrais fichiers, avec les vraies empreintes',
    () => {
      const result = runGeneratedIconsCheck({ root: REPO_ROOT, quiet: true });
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
      // Les huit tailles PWA, les variantes maskable et le favicon clair.
      expect(result.outputs.length).toBeGreaterThanOrEqual(SIZES.length + MASKABLE.length);
    },
    60000
  );
});
