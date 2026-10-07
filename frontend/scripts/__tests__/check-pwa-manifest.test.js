import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  CHAMPS_A_MEME_ORIGINE,
  FAMILY_MANIFEST_FILE,
  MANIFEST_FILE,
  PRECACHE_LIST_NAME,
  SERVICE_WORKER_FILE,
  extraireListePrecache,
  memeOrigineQueLeSite,
  parseManifest,
  parseSizes,
  runPwaManifestCheck,
  splitPurposes,
} from '../check-pwa-manifest';
import { SITE_ORIGIN } from '../site-meta';

// Tests du garde-fou du manifeste PWA (scripts/check-pwa-manifest.js). Le cœur
// du sujet est la propriété « maskable » : elle ne se déclare pas, elle se
// MESURE. Les fichiers actuels du dépôt ne la possédaient pas (contenu à un
// rayon de 0,495 pour une limite de 0,400) et le manifeste l'annonçait pourtant
// sur ses deux icônes — c'est exactement ce que ces cas couvrent.
//
// Le garde s'appuie sur l'inventaire de la famille (icons-assets.manifest.json),
// qui est donc construit ici comme une fixture : aucun Python n'est requis.

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

// Le service worker de la fixture : sa FORME est celle du vrai fichier (un
// tableau de littéraux, plus bas rejoint par des écouteurs), parce que c'est
// cette forme-là que l'extracteur doit savoir lire.
const serviceWorkerFixture = (liste = "['/', '/index.html', '/manifest.json', '/icons/icon-192x192.png']") =>
  [
    "const CACHE_NAME = 'kojo-shell-fixture';",
    `const ${PRECACHE_LIST_NAME} = ${liste};`,
    "self.addEventListener('install', () => {});",
  ].join('\n');

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
    start_url: '/',
    scope: '/',
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
  const swPath = path.join(root, SERVICE_WORKER_FILE);
  const write = () => {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    fs.writeFileSync(familyPath, JSON.stringify(family, null, 2));
  };
  const writeSw = (source) => fs.writeFileSync(swPath, source);
  write();
  writeSw(serviceWorkerFixture());

  mutate({ root, manifest, family, manifestPath, familyPath, iconsDir, swPath, write, writeSw });

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
});

describe('start_url / scope / id restent sous le domaine du site', () => {
  it("accepte une valeur ABSOLUE de l'origine du site", () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.start_url = `${SITE_ORIGIN}/dashboard`;
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(true);
    expect(CHAMPS_A_MEME_ORIGINE).toEqual(['id', 'start_url', 'scope']);
    expect(result.urls).toEqual([
      { champ: 'id', valeur: '/', href: `${SITE_ORIGIN}/` },
      { champ: 'start_url', valeur: `${SITE_ORIGIN}/dashboard`, href: `${SITE_ORIGIN}/dashboard` },
      { champ: 'scope', valeur: '/', href: `${SITE_ORIGIN}/` },
    ]);
  });

  it('refuse un start_url sur un AUTRE domaine, en nommant les deux origines', () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.start_url = 'https://travail-ailleurs.test/';
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /« start_url » \(« https:\/\/travail-ailleurs\.test\/ »\) pointe hors du domaine du site \(https:\/\/travail-ailleurs\.test au lieu de https:\/\/kojoforafrica\.cc\.cd\)/
    );
  });

  it('refuse un scope en relatif-au-protocole, qui sort du domaine SANS porter de schéma', () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.scope = '//travail-ailleurs.test';
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/« scope »/);
    expect(result.errors.join('\n')).toMatch(/hors du domaine du site/);
  });

  it("refuse un id qui n'est pas une chaîne", () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.id = 42;
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/« id » doit être une chaîne \(reçu number\)/);
  });

  it("refuse un schéma qui n'est pas http(s), au lieu de parler de l'origine « null »", () => {
    const fixture = buildFixture(({ manifest, write }) => {
      manifest.start_url = 'javascript:alert(1)';
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/emploie le schéma « javascript: »/);
  });

  it('ne juge PAS un champ absent : la spec lui donne un défaut, qui est sûr', () => {
    const fixture = buildFixture(({ manifest, write }) => {
      delete manifest.start_url;
      delete manifest.scope;
      write();
    });
    const result = fixture.run();
    expect(result.ok).toBe(true);
    expect(result.urls.map((url) => url.champ)).toEqual(['id']);
  });
});

describe('la liste de précache du service worker', () => {
  it("rend les entrées de la fixture, toutes sous l'origine du site", () => {
    const result = buildFixture().run();
    expect(result.ok).toBe(true);
    expect(result.precache).toEqual(['/', '/index.html', '/manifest.json', '/icons/icon-192x192.png']);
  });

  it('refuse une entrée TIERCE, en la nommant', () => {
    const fixture = buildFixture(({ writeSw }) => {
      writeSw(serviceWorkerFixture("['/', 'https://cdn.travail-ailleurs.test/collect.js']"));
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /l'entrée de précache « https:\/\/cdn\.travail-ailleurs\.test\/collect\.js » pointe hors du domaine du site/
    );
  });

  it('refuse un service worker absent', () => {
    const fixture = buildFixture(({ swPath }) => fs.rmSync(swPath));
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/public\/push-sw\.js absent/);
  });

  it('refuse de juger quand la liste est INTROUVABLE (déclaration renommée)', () => {
    const fixture = buildFixture(({ writeSw }) => writeSw("const APP_SHELL = ['/'];\n"));
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/la liste « APP_SHELL_URLS » est introuvable/);
  });

  it("refuse une entrée qui n'est pas un LITTÉRAL de chaîne", () => {
    const fixture = buildFixture(({ writeSw }) => {
      writeSw("const racine = '/' ;\nconst APP_SHELL_URLS = [racine, '/index.html'];\n");
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/n'est pas un littéral de chaîne/);
  });

  it('refuse une entrée en GABARIT (adresse calculée)', () => {
    const fixture = buildFixture(({ writeSw }) => {
      writeSw('const APP_SHELL_URLS = [`/${jeu}/index.html`];\n');
    });
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/est un gabarit, donc une adresse calculée/);
  });

  it('refuse une liste VIDE, dont le vert ne dirait rien de son contenu', () => {
    const fixture = buildFixture(({ writeSw }) => writeSw('const APP_SHELL_URLS = [];\n'));
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/est VIDE/);
  });

  it("refuse une liste qui n'est pas fermée", () => {
    const fixture = buildFixture(({ writeSw }) => writeSw("const APP_SHELL_URLS = ['/', '/index.html'"));
    const result = fixture.run();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/n'est pas fermée/);
  });

  it("tolère une virgule de bord et un COMMENTAIRE — aucun des deux n'est une entrée", () => {
    const fixture = buildFixture(({ writeSw }) => {
      writeSw(
        [
          'const APP_SHELL_URLS = [',
          "  '/',",
          '  // la coquille hors ligne',
          "  '/index.html',",
          '];',
        ].join('\n')
      );
    });
    const result = fixture.run();
    expect(result.ok).toBe(true);
    expect(result.precache).toEqual(['/', '/index.html']);
  });
});

describe("lecture pure — l'origine et la liste de précache", () => {
  it('extrait les littéraux, et refuse ce qui ne se lit pas', () => {
    expect(extraireListePrecache("const APP_SHELL_URLS = ['/', '/a.png'];\n")).toEqual({
      ok: true,
      valeurs: ['/', '/a.png'],
    });
    expect(extraireListePrecache("const AUTRE = ['/'];\n")).toEqual({
      ok: false,
      raison: expect.stringMatching(/introuvable/),
    });
    expect(extraireListePrecache("const APP_SHELL_URLS = ['/'").ok).toBe(false);
  });

  it("lit la VRAIE liste du dépôt, et chaque entrée y est sous l'origine du site", () => {
    const lecture = extraireListePrecache(fs.readFileSync(path.resolve('public', 'push-sw.js'), 'utf8'));
    expect(lecture.ok).toBe(true);
    expect(lecture.valeurs.length).toBeGreaterThanOrEqual(4);
    for (const entree of lecture.valeurs) {
      expect(memeOrigineQueLeSite(entree, { sujet: `« ${entree} »` }).ok, entree).toBe(true);
    }
  });

  it("accepte le relatif, et refuse un hôte qui IMITE le nôtre", () => {
    expect(memeOrigineQueLeSite(`${SITE_ORIGIN}/jobs`).ok).toBe(true);
    expect(memeOrigineQueLeSite('/index.html').ok).toBe(true);
    expect(memeOrigineQueLeSite(`${SITE_ORIGIN}.travail-ailleurs.test/`).ok).toBe(false);
    expect(memeOrigineQueLeSite('//travail-ailleurs.test').ok).toBe(false);
  });
});

// Le dépôt réel n'est pas rejoué ici : l'étape « Check PWA manifest » de la CI le
// fait sur le runner, sur le vrai manifeste et le vrai inventaire d'icônes.
