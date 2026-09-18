import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CARDS_DIR_NAME,
  MANIFEST_NAME,
  REFERENCE_FONTS,
  runOgAssetsCheck,
} from '../check-og-assets';

// Tests du garde-fou « cartes Open Graph » (scripts/check-og-assets.js) :
//   - un seul générateur OG toléré dans scripts/, détecté par le NOM (jeton
//     « og » + verbe de production, quelle que soit l'extension) ET, pour un
//     nom anodin, par le CONTENU (écrit une image + vise une carte OG) ;
//   - aucun faux positif sur un script qui ne fait que LIRE les cartes ;
//   - la LISTE des cartes est lue dans les DONNÉES (un fichier par carte), les
//     DIMENSIONS dans le générateur : aucune des deux n'est recopiée ici ;
//   - chaque PNG déclaré doit exister, être un vrai PNG et respecter ses
//     dimensions (signature + IHDR) ;
//   - aucun og-*.png orphelin dans public/ ;
//   - le MANIFESTE de reproductibilité (empreintes SHA-256 des cartes,
//     empreinte du générateur, empreinte du CONTENU des cartes, polices
//     retenues) est confronté aux fichiers commités : carte retouchée, texte
//     ou générateur modifié sans régénération,
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

// Générateur minimal reproduisant ce que le check y lit : les constantes de
// FORMATS et la taille du favicon sombre. Le contenu des cartes n'est plus ici —
// il vit dans les fichiers de données (CARD_FIXTURES, plus bas).
const GENERATOR_FIXTURE = `W, H = 1200, 630
SQUARE = 1200
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public')


def main():
    favicon = make_dark_favicon(512)
    out = os.path.join(OUT_DIR, 'icons', 'icon-dark.png')
`;

// Un fichier de données par carte : ce que le check lit pour savoir QUELS PNG
// doivent exister ET quel texte chaque carte dessine. Le générateur les découvre
// par le même chemin (dossier trié).
const CARD_FIXTURES = {
  'home.json': {
    route: '/',
    title: 'homeMetaTitle',
    description: 'homeMetaDescription',
    wide: 'og-home.png',
    square: 'og-home-square.png',
  },
  'jobs.json': {
    route: '/jobs',
    title: 'jobsMetaTitle',
    description: 'jobsMetaDescription',
    wide: 'og-jobs.png',
    square: 'og-jobs-square.png',
  },
};

// Le dictionnaire des pages (src/i18n/fr.json) : c'est de LUI que les cartes
// tirent le texte qu'elles dessinent. Une carte dont les lignes ne recomposent
// pas ces textes annonce autre chose que sa page.
const DICT_FIXTURE = {
  homeMetaTitle: 'Accueil — Kojo',
  homeMetaDescription: 'Trouvez un professionnel vérifié près de chez vous.',
  jobsMetaTitle: 'Emplois disponibles — Kojo',
  jobsMetaDescription: 'Trouvez un travailleur qualifié près de chez vous.',
};

// Les lignes qu'une carte consigne avoir dessinées, pour un texte donné. La
// fixture les écrit en UNE ligne par champ : le check ne compare que la
// recomposition, pas la découpe (c'est le générateur qui la mesure).
const cardLines = (card, dictionary) => ({
  wide: {
    title: [dictionary[card.title]],
    description: [dictionary[card.description]],
  },
  square: {
    title: [dictionary[card.title]],
    description: [dictionary[card.description]],
  },
});

// Le contenu d'une carte, sérialisé comme le ferait un auteur de données (JSON
// indenté, saut de ligne final) : la fixture ne teste pas la mise en forme, le
// générateur l'ignore.
const cardJson = (card, { crlf = false } = {}) => {
  const text = JSON.stringify(card, null, 2) + '\n';
  return crlf ? text.replace(/\n/g, '\r\n') : text;
};

// Empreinte du CONTENU des cartes, à la recette du générateur (nom + LF + octets
// normalisés en LF, fichiers triés). L'accord entre langages n'est PAS prouvé
// ici : il l'est par le manifeste versionné, écrit par Python et recalculé en
// JavaScript par le cas « dépôt réel ».
const cardsFingerprint = (cardsDir) => {
  const digest = crypto.createHash('sha256');
  for (const name of fs.readdirSync(cardsDir).filter((file) => file.endsWith('.json')).sort()) {
    const data = fs
      .readFileSync(path.join(cardsDir, name))
      .toString('latin1')
      .replace(/\r\n/g, '\n');
    digest.update(Buffer.from(name, 'utf8'));
    digest.update('\n');
    digest.update(Buffer.from(data, 'latin1'));
  }
  return digest.digest('hex');
};

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
  'og-jobs-square.png': fakePng(1200, 1200),
  'icons/icon-dark.png': fakePng(512, 512),
};

// `manifest` : undefined → manifeste COHÉRENT construit comme le fait le
// générateur (nom, empreinte du script, polices de référence, empreintes des
// PNG) ; `null` → aucun manifeste ; objet → fusion superficielle sur ce
// manifeste cohérent, pour n'injecter que la divergence testée.
const makeFixture = ({
  generator = GENERATOR_FIXTURE,
  extraScripts = [],
  cards = CARD_FIXTURES,
  cardsCrlf = false,
  assets = {},
  manifest = undefined,
  dictionary = DICT_FIXTURE,
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

  const cardsDir = path.join(scriptsDir, CARDS_DIR_NAME);
  if (cards) {
    fs.mkdirSync(cardsDir, { recursive: true });
    for (const [name, card] of Object.entries(cards)) {
      fs.writeFileSync(path.join(cardsDir, name), cardJson(card, { crlf: cardsCrlf }));
    }
  }

  // Le dictionnaire des pages : écrit ICI parce que le générateur le lit au même
  // chemin (src/i18n/fr.json, la langue des coquilles). `null` = fichier absent,
  // pour éprouver le cas où la comparaison n'a rien à lire.
  if (dictionary) {
    fs.mkdirSync(path.join(root, 'src', 'i18n'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'src', 'i18n', 'fr.json'),
      `${JSON.stringify(dictionary, null, 2)}\n`
    );
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
    cards_sha256: cards ? cardsFingerprint(cardsDir) : null,
    fonts: { ...REFERENCE_FONTS },
    cards: cards
      ? Object.values(cards).map((card) => ({
          route: card.route,
          title: card.title,
          description: card.description,
          wide: card.wide,
          square: card.square,
          lines: cardLines(card, dictionary || {}),
        }))
      : [],
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

describe('check-og-assets — les cartes se déclarent en données', () => {
  it('cas nominal : générateur unique et PNG conformes → ok', () => {
    const result = run({ root: makeFixture() });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.assets.map((asset) => asset.file)).toEqual([
      'og-home.png',
      'og-home-square.png',
      'og-jobs.png',
      'og-jobs-square.png',
      'icons/icon-dark.png',
    ]);
  });

  it('suit les données : une carte AJOUTÉE (fichier seul) entre dans le périmètre', () => {
    // Le geste attendu pour une carte dédiée de plus : un fichier JSON, sans
    // toucher une ligne de code. Le garde doit la voir du seul fait du fichier.
    const result = run({
      root: makeFixture({
        cards: {
          ...CARD_FIXTURES,
          'support.json': {
            route: '/support',
            title: 'homeMetaTitle',
            description: 'homeMetaDescription',
            wide: 'og-support.png',
            square: 'og-support-square.png',
          },
        },
        assets: {
          'og-support.png': fakePng(1200, 630),
          'og-support-square.png': fakePng(1200, 1200),
        },
      }),
    });
    expect(result.errors).toEqual([]);
    expect(result.assets.map((asset) => asset.file)).toContain('og-support.png');
  });

  it('refuse une carte qui ne nomme pas ses DEUX sorties', () => {
    const result = run({
      root: makeFixture({
        cards: {
          'support.json': {
            route: '/support',
            title: 'homeMetaTitle',
            description: 'homeMetaDescription',
            wide: 'og-support.png',
          },
        },
        assets: { 'og-support.png': fakePng(1200, 630) },
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      new RegExp(`${CARDS_DIR_NAME}/support\\.json ne déclare pas square`)
    );
  });

  it('refuse une route qui n’est pas un chemin absolu', () => {
    // La route est la clé de la table (celle qui décide la carte servie à chaque
    // page) : « jobs » sans barre oblique n'y désignerait rien.
    const result = run({
      root: makeFixture({
        cards: {
          'jobs.json': { ...CARD_FIXTURES['jobs.json'], route: 'jobs' },
        },
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      new RegExp(`${CARDS_DIR_NAME}/jobs\\.json : la route « jobs » n'est pas un chemin absolu`)
    );
  });

  it('refuse un dossier de cartes absent ou sans aucune carte', () => {
    const absent = run({ root: makeFixture({ cards: null }) });
    expect(absent.ok).toBe(false);
    expect(absent.errors.join('\n')).toMatch(new RegExp(`${CARDS_DIR_NAME}/ absent`));

    const vide = run({ root: makeFixture({ cards: {} }) });
    expect(vide.ok).toBe(false);
    expect(vide.errors.join('\n')).toMatch(/ne contient aucun fichier \*\.json/);
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
    // Le manifeste est écrit par Python, l'empreinte recalculée en JavaScript :
    // ce cas est la preuve que les deux recettes donnent le MÊME octet.
    expect(manifest.cards_sha256).toBe(
      cardsFingerprint(path.join(REPO_ROOT, 'scripts', CARDS_DIR_NAME))
    );
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

  it("détecte une carte MODIFIÉE sans régénération (l'empreinte du générateur ne la voit plus)", () => {
    // C'est le risque propre aux cartes en données : leur contenu a quitté le
    // générateur, donc son empreinte ne peut plus le couvrir. Sans empreinte des
    // données, une route ou une clé retouchée laisserait des PNG périmés derrière
    // un manifeste « frais », et la CI dirait vert.
    const root = makeFixture();
    const cardPath = path.join(root, 'scripts', CARDS_DIR_NAME, 'jobs.json');
    const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
    card.route = '/emplois';
    fs.writeFileSync(cardPath, cardJson(card));
    const result = run({ root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      new RegExp(`le contenu des cartes \\(${CARDS_DIR_NAME}/\\) a changé`)
    );
  });

  it("tolère une carte en CRLF : le fin de ligne n'est pas une propriété du contenu", () => {
    // Même leçon que pour le générateur : un poste Windows matérialise le JSON en
    // CRLF, la CI Linux le lit en LF. Le manifeste est écrit une fois, la
    // normalisation doit valoir dans les deux sens, sinon le rouge tombe sur une
    // donnée identique.
    const root = makeFixture({ cardsCrlf: true });
    expect(run({ root }).ok).toBe(true);
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

// La propriété de fond de cette passe : le texte que la carte DESSINE est celui
// de sa page. Rien dans une image ne se relit — c'est donc le manifeste, écrit par
// le générateur à partir des lignes qu'il a réellement dessinées, que le garde
// recompose et confronte au dictionnaire.
describe('check-og-assets — la carte dessine le texte de sa page', () => {
  it('cas nominal : les lignes consignées recomposent le dictionnaire → ok', () => {
    const result = run({ root: makeFixture() });

    expect(result.errors).toEqual([]);
  });

  it('détecte un TITRE de page renommé sans régénérer les cartes', () => {
    // Le scénario réel : quelqu'un renomme jobsMetaTitle, le build repart avec le
    // nouveau titre, et les PNG de partage — versionnés — dessinent encore
    // l'ancien. Sans cette égalité, personne ne le voyait : le manifeste était
    // « frais » (la carte n'a pas bougé) et la CI disait vert.
    const root = makeFixture();
    fs.writeFileSync(
      path.join(root, 'src', 'i18n', 'fr.json'),
      `${JSON.stringify({ ...DICT_FIXTURE, jobsMetaTitle: 'Offres et missions — Kojo' }, null, 2)}\n`
    );

    const result = run({ root });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /la carte wide de « \/jobs » dessine « Emplois disponibles — Kojo », alors que src\/i18n\/fr\.json publie « Offres et missions — Kojo » pour jobsMetaTitle/
    );
    // Le remède est dans le message : c'est le générateur qu'il faut relancer.
    expect(result.errors.join('\n')).toMatch(/relance scripts\/gen-og-images\.py/);
  });

  it('détecte un manifeste retouché à la main (lignes qui ne sont plus celles du dictionnaire)', () => {
    // L'autre moitié : les empreintes prouvent que les PNG sont ceux du
    // générateur, pas que le manifeste dit vrai. Un « cards » réécrit à la main
    // ferait annoncer au garde un texte que la carte ne dessine pas.
    const root = makeFixture({
      manifest: {
        cards: [
          {
            route: '/jobs',
            title: 'jobsMetaTitle',
            description: 'jobsMetaDescription',
            wide: 'og-jobs.png',
            square: 'og-jobs-square.png',
            lines: {
              wide: { title: ['Emplois près de chez vous'], description: ['Trouvez.'] },
              square: { title: ['Emplois près de chez vous'], description: ['Trouvez.'] },
            },
          },
        ],
      },
    });

    const result = run({ root });

    expect(result.ok).toBe(false);
    const messages = result.errors.join('\n');
    expect(messages).toMatch(/la carte wide de « \/jobs » dessine « Emplois près de chez vous »/);
    // Les autres cartes du dépôt n'ont plus d'entrée : le manifeste est périmé.
    expect(messages).toMatch(/ne décrit pas la carte de la route « \/ »/);
  });

  it('exige que la carte du manifeste corresponde à ce que le fichier de carte déclare', () => {
    const root = makeFixture({
      manifest: { cards: [] },
    });

    const result = run({ root });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/ne décrit aucune carte \(clé « cards » absente ou vide\)/);
  });

  it('exige une carte pour la RACINE (celle que reçoit toute page sans visuel)', () => {
    // Sans elle, une page comme /register n'aurait plus AUCUNE carte à annoncer.
    const root = makeFixture({
      cards: { 'jobs.json': CARD_FIXTURES['jobs.json'] },
      assets: { 'og-home.png': null, 'og-home-square.png': null },
    });

    const result = run({ root });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/aucune carte ne sert la route « \/ »/);
  });

  it('refuse une carte incomplète, en la nommant plutôt qu’en la sautant', () => {
    // Une carte sans route ni clés de texte n'annonce rien de vérifiable : la
    // sauter en silence la ferait sortir du périmètre sans que rien ne le dise.
    const root = makeFixture({
      cards: { 'broken.json': { wide: 'og-home.png', square: 'og-home-square.png' } },
      assets: { 'og-jobs.png': null, 'og-jobs-square.png': null },
    });

    const result = run({ root });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /broken\.json ne déclare pas route ni title ni description/
    );
  });

  it('échoue quand le dictionnaire des pages est illisible (rien à confronter)', () => {
    const result = run({ root: makeFixture({ dictionary: null }) });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/src\/i18n\/fr\.json illisible/);
  });
});
