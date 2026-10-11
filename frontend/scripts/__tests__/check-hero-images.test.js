/**
 * PREUVE D'ÉCHEC DE `scripts/check-hero-images.js`.
 *
 * La règle du dépôt : un garde dont rien ne démontre qu'il sait ROUGIR est un
 * garde qui peut devenir aveugle en silence. Ce fichier exerce donc CHAQUE refus
 * du garde sur la faute qu'il vise — pas seulement sur l'arbre sain.
 *
 * ── Comment les fautes sont construites ───────────────────────────────────
 * `construire()` fabrique une arborescence FIXTURE complète (quatre photos, leurs
 * quatre variantes par photo, un manifeste d'accord avec elle) dans un dossier
 * temporaire, puis applique LA mutation du cas. Chaque cas n'attend qu'UN refus,
 * et son motif ne nomme que lui : sans cette discipline, un rouge dirait
 * seulement « quelque chose a rougi quelque part ».
 *
 * Les fichiers de la fixture sont SYNTHÉTIQUES mais portent de VRAIS en-têtes de
 * leur format : c'est suffisant parce que le garde ne décode pas les images, il
 * lit l'en-tête (`ispe` pour l'AVIF, premier morceau pour le WebP) — et c'est
 * exactement ce qu'on veut prouver. Le décodeur, lui, est éprouvé sur les VRAIS
 * fichiers publiés (premier `describe`), sans quoi la fixture prouverait
 * seulement qu'un décodeur d'en-têtes synthétiques reconnaît ses propres
 * en-têtes.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DOSSIER_PUBLIC,
  GAIN_MINIMAL_TETE,
  PLANCHER_PHOTOS,
  PLANCHER_VARIANTES,
  dimensionsAvif,
  dimensionsVariante,
  dimensionsWebp,
  verifierHeros,
} from '../check-hero-images.js';
import { PHOTO_HEROS_FORMATS, PHOTO_HEROS_LARGEURS } from '../../src/config/photos-heros.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFESTE_REEL = path.join(RACINE, 'scripts', 'hero-variants.manifest.json');

/** Un interpréteur Python avec Pillow, ou null — la preuve de repro en dépend. */
const pythonAvecPillow = (() => {
  for (const candidat of ['python', 'python3']) {
    try {
      execFileSync(candidat, ['-c', 'import PIL, sys; sys.exit(0)'], { stdio: 'ignore' });
      return candidat;
    } catch {
      /* candidat suivant */
    }
  }
  return null;
})();

/**
 * Cinq photos, pas quatre : le plancher de lecture de `verifierHeros` est à
 * quatre photos et seize variantes, et un cas qui RETIRE une variante doit
 * rester au-dessus du plancher — sinon il rougirait sur la vacuité au lieu du
 * refus qu'il vise (constaté avant ce choix).
 */
const NB_PHOTOS_FIXTURE = PLANCHER_PHOTOS + 1;

const DOSSIERS = new Set();
afterAll(() => {
  for (const dossier of DOSSIERS) rmSync(dossier, { recursive: true, force: true });
});

// ── Fabriques d'en-têtes RÉELS ──────────────────────────────────────────────
/** Une boîte AVIF minimale mais lisible : `ftyp` + `ispe` + du remplissage. */
const avif = (largeur, hauteur, octets = 400) => {
  // `ftyp` fait 24 octets : taille(4) + type(4) + marque majeure(4) + version
  // mineure(4) + marques compatibles(8). L'en-tête de boîte dit donc la même
  // chose que sa taille réelle — un en-tête qui se contredirait ne prouverait
  // rien de ce que le garde doit lire.
  const ftyp = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftyp', 'latin1'),
    Buffer.from('avif', 'latin1'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('avifmif1', 'latin1'),
  ]);
  const ispe = Buffer.alloc(20);
  ispe.writeUInt32BE(20, 0);
  ispe.write('ispe', 4, 'latin1');
  ispe.writeUInt32BE(largeur, 12);
  ispe.writeUInt32BE(hauteur, 16);
  return Buffer.concat([ftyp, ispe, Buffer.alloc(Math.max(0, octets - 44))]);
};

/** Un WebP `VP8X` (canvas 24 bits) minimal mais lisible. */
const webp = (largeur, hauteur, octets = 450) => {
  const entete = Buffer.alloc(30);
  entete.write('RIFF', 0, 'latin1');
  entete.writeUInt32LE(Math.max(0, octets - 8), 4);
  entete.write('WEBP', 8, 'latin1');
  entete.write('VP8X', 12, 'latin1');
  entete.writeUInt32LE(10, 16);
  entete.writeUIntLE(largeur - 1, 24, 3);
  entete.writeUIntLE(hauteur - 1, 27, 3);
  return Buffer.concat([entete, Buffer.alloc(Math.max(0, octets - 30))]);
};

/** Un JPEG de fixture : le garde n'en lit ni le contenu ni les dimensions. */
const jpeg = (octets = 1000) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(octets - 4)]);

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Les quatre variantes d'une photo, dans l'ordre où le générateur les écrit. */
const schemas = (index) => {
  const base = `p${index}`;
  return PHOTO_HEROS_FORMATS.flatMap((format) =>
    PHOTO_HEROS_LARGEURS.map((largeur) => ({
      fichier: largeur === 720 ? `${base}.${format}` : `${base}-${largeur}.${format}`,
      format,
      largeur,
      hauteur: largeur === 720 ? 960 : 640,
    }))
  );
};

/**
 * La table de config d'un manifeste : la forme que `PhotoDuHeros` et la coquille
 * lisent (`{jpeg, avif: {480, 720}, webp: {480, 720}}`), dérivée du manifeste
 * INITIAL — donc une mutation du manifeste seul fait diverger les deux tables,
 * ce que le garde doit refuser.
 */
const tableDepuis = (manifeste) =>
  manifeste.photos.map((photo) => ({
    jpeg: `/assets/${photo.source}`,
    ...Object.fromEntries(
      PHOTO_HEROS_FORMATS.map((format) => [
        format,
        Object.fromEntries(
          PHOTO_HEROS_LARGEURS.map((largeur) => {
            const variante = photo.variantes.find((v) => v.format === format && v.largeur === largeur);
            return [largeur, variante ? `/assets/${variante.fichier}` : undefined];
          })
        ),
      ])
    ),
  }));

/**
 * Construit l'arborescence fixture, applique la mutation demandée, l'écrit sur
 * disque, et rend de quoi appeler le garde (dossier, manifeste, table de config).
 *
 * @param {(contexte: {fichiers: Map<string, Buffer>, manifeste: object,
 *   variantes: Array}) => void} [muter]
 */
const construire = (muter = () => {}) => {
  const dossier = mkdtempSync(path.join(tmpdir(), 'kojo-heros-'));
  DOSSIERS.add(dossier);
  const fichiers = new Map();
  const manifeste = {
    genere_par: 'fixture',
    largeur_source: 720,
    hauteur_source: 960,
    largeurs: [...PHOTO_HEROS_LARGEURS],
    reglages: {},
    jpeg_total: 0,
    photos: [],
  };
  for (let index = 0; index < NB_PHOTOS_FIXTURE; index += 1) {
    const source = `p${index}.jpg`;
    const contenu = jpeg(1000);
    fichiers.set(source, contenu);
    manifeste.jpeg_total += contenu.length;
    manifeste.photos.push({
      source,
      octets_source: contenu.length,
      sha256_source: sha(contenu),
      variantes: [],
    });
    for (const schema of schemas(index)) {
      const octets =
        schema.format === 'avif'
          ? avif(schema.largeur, schema.hauteur, 400)
          : webp(schema.largeur, schema.hauteur, 450);
      fichiers.set(schema.fichier, octets);
      manifeste.photos[index].variantes.push({
        fichier: schema.fichier,
        format: schema.format,
        largeur: schema.largeur,
        hauteur: schema.hauteur,
        qualite: schema.format === 'avif' ? 55 : 75,
        octets: octets.length,
      });
    }
  }
  const contexte = {
    dossier,
    fichiers,
    manifeste,
    variantes: tableDepuis(manifeste),
    photos: manifeste.photos.map((photo) => `/assets/${photo.source}`),
  };
  muter(contexte);

  for (const [nom, contenu] of fichiers) writeFileSync(path.join(dossier, nom), contenu);
  writeFileSync(path.join(dossier, 'hero-variants.manifest.json'), JSON.stringify(manifeste));
  return {
    // La table de CONFIG est celle d'AVANT la mutation, sauf si le cas la change
    // explicitement : c'est ce qui permet de faire diverger les deux canaux.
    variantes: contexte.variantes,
    photos: contexte.photos,
    manifeste,
    dossier,
  };
};

const verdict = (contexte) =>
  verifierHeros({
    manifeste: contexte.manifeste,
    dossier: contexte.dossier,
    variantes: contexte.variantes,
    photos: contexte.photos,
  });

describe("les décodeurs d'en-tête, sur les VRAIS fichiers publiés", () => {
  it('lit les 24 variantes publiées et retrouve leurs dimensions annoncées', () => {
    const manifesteReel = JSON.parse(readFileSync(MANIFESTE_REEL, 'utf8'));
    let lues = 0;
    for (const photo of manifesteReel.photos) {
      for (const variante of photo.variantes) {
        const buf = readFileSync(path.join(DOSSIER_PUBLIC, variante.fichier));
        const dimensions = dimensionsVariante(variante.format, buf);
        expect(dimensions, `${variante.fichier} : en-tête illisible`).not.toBe(null);
        expect({ largeur: dimensions.largeur, hauteur: dimensions.hauteur }, variante.fichier).toEqual({
          largeur: variante.largeur,
          hauteur: variante.hauteur,
        });
        lues += 1;
      }
    }
    // Sans ce plancher, ce cas serait vert en n'ayant rien lu (manifeste vidé).
    expect(lues).toBe(24);
  });

  it("refuse un fichier de l'AUTRE format, dans les deux sens", () => {
    const avifReel = readFileSync(path.join(DOSSIER_PUBLIC, 'kojo-hero-480.avif'));
    const webpReel = readFileSync(path.join(DOSSIER_PUBLIC, 'kojo-hero-480.webp'));
    expect(dimensionsVariante('avif', avifReel)).toEqual({ largeur: 480, hauteur: 640 });
    expect(dimensionsVariante('webp', webpReel)).toEqual({ largeur: 480, hauteur: 640 });
    expect(dimensionsVariante('webp', avifReel)).toBe(null);
    expect(dimensionsVariante('avif', webpReel)).toBe(null);
    expect(dimensionsVariante('jpeg', avifReel)).toBe(null);
  });
});

describe("les décodeurs d'en-tête, sur des en-têtes FAUX", () => {
  it('refuse un AVIF sans `ftyp`, ou dont les dimensions sont illisibles', () => {
    expect(dimensionsAvif(Buffer.alloc(64))).toBe(null);
    expect(dimensionsAvif(Buffer.concat([Buffer.from('xxispe', 'latin1'), Buffer.alloc(32)]))).toBe(null);
    // `ispe` présent mais dimensions nulles : un fichier tronqué au milieu.
    expect(dimensionsAvif(avif(0, 0, 200))).toBe(null);
  });

  it("refuse un WebP d'un autre conteneur, ou dont le code de synchronisation est faux", () => {
    expect(dimensionsWebp(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40)]))).toBe(null);
    const perte = Buffer.alloc(64);
    perte.write('RIFF', 0, 'latin1');
    perte.write('WEBP', 8, 'latin1');
    perte.write('VP8 ', 12, 'latin1');
    expect(dimensionsWebp(perte)).toBe(null); // code de synchronisation absent
    perte[23] = 0x9d;
    perte[24] = 0x01;
    perte[25] = 0x2a;
    perte.writeUInt16LE(500, 26);
    perte.writeUInt16LE(300, 28);
    expect(dimensionsWebp(perte)).toEqual({ largeur: 500, hauteur: 300 });
  });
});

describe("le verdict : l'arbre sain de la fixture", () => {
  it('est vert, et NOMME ce qu\'il a pesé — 20 variantes lues ne sont pas un hasard', () => {
    const resultat = verdict(construire());
    expect(resultat.erreurs).toEqual([]);
    expect(resultat.ok).toBe(true);
    expect(resultat.mesures.variantesPesees).toBe(NB_PHOTOS_FIXTURE * 4);
    expect(resultat.mesures.gainTete).toBeGreaterThanOrEqual(GAIN_MINIMAL_TETE);
    expect(resultat.controles.join('\n')).toContain(`${NB_PHOTOS_FIXTURE * 4} variante(s) pesée(s)`);
  });

  it('refuse un manifeste VIDE plutôt que de rester vert en ne pesant rien', () => {
    const resultat = verdict(
      construire((ctx) => {
        ctx.manifeste.photos = [];
      })
    );
    expect(resultat.ok).toBe(false);
    expect(resultat.erreurs.join('\n')).toContain(`planchers ${PLANCHER_PHOTOS} et ${PLANCHER_VARIANTES}`);
  });
});

describe('le verdict : une mutation, un refus nommé', () => {
  const cas = [
    {
      nom: 'refuse une variante DÉCLARÉE que le manifeste ne connaît pas',
      muter: (ctx) => {
        ctx.manifeste.photos[0].variantes = ctx.manifeste.photos[0].variantes.filter(
          (v) => v.fichier !== 'p0-480.avif'
        );
      },
      attend: /variante DÉCLARÉE mais jamais générée : p0-480\.avif/,
    },
    {
      nom: 'refuse une variante GÉNÉRÉE que plus rien ne publie',
      muter: (ctx) => {
        delete ctx.variantes[0].avif[480];
      },
      attend: /variante GÉNÉRÉE mais que rien ne publie : p0-480\.avif/,
    },
    {
      nom: 'refuse une variante ABSENTE du disque',
      muter: (ctx) => {
        ctx.fichiers.delete('p1-480.webp');
      },
      attend: /variante ABSENTE du disque : .*p1-480\.webp/,
    },
    {
      nom: "refuse une variante dont les OCTETS ne sont plus ceux du manifeste",
      muter: (ctx) => {
        ctx.fichiers.set('p2.avif', avif(720, 960, 900));
      },
      attend: /p2\.avif : 900 octets sur disque, 400 mesurés dans le manifeste/,
    },
    {
      nom: "refuse un fichier dont l'en-tête n'est pas le format de son extension",
      muter: (ctx) => {
        // Mêmes octets que la variante, mais contenu d'un autre format : seul
        // l'en-tête peut le dire.
        ctx.fichiers.set('p2.webp', avif(720, 960, 450));
      },
      attend: /p2\.webp : en-tête illisible comme WEBP/,
    },
    {
      nom: "refuse une variante d'une AUTRE taille que celle annoncée",
      muter: (ctx) => {
        ctx.fichiers.set('p3-480.avif', avif(600, 800, 400));
      },
      attend: /p3-480\.avif : 600 × 800 réel, 480 × 640 annoncés/,
    },
    {
      nom: 'refuse une source JPEG recodée sans régénérer les variantes (empreinte)',
      muter: (ctx) => {
        ctx.fichiers.set('p0.jpg', jpeg(1000).fill(7));
      },
      attend: /source modifiée sans régénérer les variantes : p0\.jpg/,
    },
    {
      nom: 'refuse une source JPEG dont le POIDS ne suit plus le manifeste',
      muter: (ctx) => {
        const autre = jpeg(1200);
        ctx.fichiers.set('p1.jpg', autre);
        ctx.manifeste.photos[1].sha256_source = sha(autre);
      },
      attend: /source recodée sans régénérer les variantes : p1\.jpg pèse 1200 o sur disque, 1000 o/,
    },
    {
      nom: "refuse une variante PLUS LOURDE que le JPEG qu'elle double",
      muter: (ctx) => {
        const lourd = webp(480, 640, 1500);
        ctx.fichiers.set('p0-480.webp', lourd);
        ctx.manifeste.photos[0].variantes.find((v) => v.fichier === 'p0-480.webp').octets = lourd.length;
      },
      attend: /p0-480\.webp pèse 1500 o contre 1000 o pour le JPEG/,
    },
    {
      nom: 'refuse un résidu publié que personne ne sert',
      muter: (ctx) => {
        // Le résidu d'une photo retirée de la rotation : rien ne le déclare,
        // mais il part au build avec le reste du dossier.
        ctx.fichiers.set('p9-480.avif', avif(480, 640, 300));
      },
      attend: /encodage\(s\) publié\(s\) sans variante déclarée : p9-480\.avif/,
    },
    {
      nom: 'refuse un total du manifeste qui ne suit plus les fichiers',
      muter: (ctx) => {
        ctx.manifeste.totaux = { avif: { 480: 1, 720: 2 }, webp: { 480: 3, 720: 4 } };
      },
      attend: /total avif 480w = 1 o, somme des fichiers = 2000 o/,
    },
    {
      nom: 'refuse un jpeg_total qui ne suit plus les sources',
      muter: (ctx) => {
        ctx.manifeste.jpeg_total = 1;
      },
      attend: /jpeg_total = 1 o, somme des sources = 5000 o/,
    },
    {
      nom: 'refuse un ORDRE de formats qui ferait télécharger le plus lourd en premier',
      muter: (ctx) => {
        // Toutes les variantes AVIF sauf celle de la photo de TÊTE passent à
        // 900 o : le total AVIF (11 700 o) dépasse alors le total WebP
        // (4 500 o), donc le format publié en premier — l'AVIF — serait le
        // plus lourd.
        // Chaque variante reste SOUS son JPEG (1 000 o), pour que ce cas ne
        // déclenche que le refus qu'il vise.
        for (const photo of ctx.manifeste.photos) {
          for (const variante of photo.variantes) {
            if (variante.format !== 'avif' || variante.fichier === 'p0-480.avif') continue;
            const lourd = avif(variante.largeur, variante.hauteur, 900);
            ctx.fichiers.set(variante.fichier, lourd);
            variante.octets = lourd.length;
          }
        }
      },
      attend: /est plus LOURD que celui publié après lui/,
    },
    {
      nom: "refuse une photo de tête dont la variante n'est plus un gain",
      muter: (ctx) => {
        // La source de tête est recompressée plus petite : la variante 480w
        // n'économise plus que 42,9 % — sous le plancher de 50 %.
        const petite = jpeg(700);
        ctx.fichiers.set('p0.jpg', petite);
        ctx.manifeste.photos[0].octets_source = petite.length;
        ctx.manifeste.photos[0].sha256_source = sha(petite);
        ctx.manifeste.jpeg_total = 700 + (NB_PHOTOS_FIXTURE - 1) * 1000;
      },
      attend: /sous le plancher de 50 %/,
    },
  ];

  for (const { nom, muter, attend } of cas) {
    it(nom, () => {
      const resultat = verdict(construire(muter));
      expect(resultat.ok).toBe(false);
      expect(resultat.erreurs.join('\n')).toMatch(attend);
    });
  }
});

describe("le garde, en sous-processus sur l'arbre RÉEL", () => {
  it('sort en 0 et nomme les 24 variantes pesées et le gain de la photo de tête', () => {
    const sortie = execFileSync('node', ['scripts/check-hero-images.js'], { cwd: RACINE, encoding: 'utf8' });
    expect(sortie).toContain('24 variante(s) pesée(s)');
    expect(sortie).toContain('photo de tête');
    expect(sortie).toContain('Toutes les variantes publiées sont celles mesurées');
  });

  it.skipIf(!pythonAvecPillow)(
    'confirme que le disque est REPRODUCTIBLE par le générateur (mode `--verifier`)',
    () => {
      // Le générateur et le garde ne mesurent pas la même chose : l'un vérifie
      // que l'encodeur produirait CES octets-là (donc que le réglage du
      // manifeste est encore celui du disque), l'autre que la config publie bien
      // ces fichiers. Sans Python + Pillow, ce cas est déclaré sauté — ce n'est
      // pas un vert, c'est une dépendance d'hôte nommée.
      const sortie = execFileSync(pythonAvecPillow, ['scripts/gen-hero-images.py', '--verifier'], {
        cwd: RACINE,
        encoding: 'utf8',
      });
      expect(sortie).toContain('variantes conformes au manifeste');
    }
  );
});
