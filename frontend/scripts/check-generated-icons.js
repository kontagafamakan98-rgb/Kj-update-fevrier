#!/usr/bin/env node
/**
 * Garde-fou de la famille « icônes » : les icônes PWA et le favicon clair.
 *
 * Deuxième famille d'images générées du dépôt, après les cartes Open Graph
 * (scripts/check-og-assets.js). Elle a son propre générateur,
 * public/icons/generate_icons.py, qui descend une source 512×512 vers les huit
 * tailles PWA et vers le favicon clair (favicon.ico, images PNG embarquées).
 *
 * Cette famille a une faiblesse que les cartes OG n'ont pas : elle est
 * INVISIBLE. Une icône remplacée à la main, un favicon jamais régénéré (le
 * favicon.ico committé faisait 100 octets de zéros — un fichier que NOUS avons
 * désactivé sans qu'aucune CI ne rougisse, alors qu'index.html le référence
 * comme favicon principal), une variante maskable qui n'est plus référencée par
 * le manifeste : rien de tout cela ne produit d'erreur, ni au build, ni en test.
 *
 * Ce check est possible parce que le générateur n'est PAS comme celui des cartes
 * OG : il est en stdlib pure, sans police et sans Pillow, donc son résultat est
 * comparable sur n'importe quel runner. Encore faut-il comparer la bonne chose :
 * la compression zlib n'est pas identique d'une machine à l'autre, si bien que
 * les OCTETS d'un PNG regénéré diffèrent de ceux committés alors que les PIXELS
 * sont strictement identiques (mesuré ici : 101 592 octets committés contre
 * 101 049 regénérés sur la même version de l'image). Comparer les octets
 * condamnerait donc ce garde à rougir en permanence ; c'est l'empreinte des
 * PIXELS qui est l'invariant, et c'est ce que consigne le manifeste.
 *
 * Ce check :
 *   1. n'accepte QU'UN générateur d'icônes : tout autre script déposé dans
 *      public/icons/ doit être déclaré en lecture seule, et le CONTENU est
 *      inspecté pour repérer une seconde source de vérité au nom anodin ;
 *   2. exige le manifeste écrit PAR le générateur (aucune constante dupliquée
 *      ici) et le refuse s'il est périmé (empreinte du générateur) ;
 *   3. dresse l'INVENTAIRE de la famille : chaque image de public/icons/ doit
 *      être déclarée — sortie générée, actif non géré, ou actif d'une autre
 *      famille — sinon une icône peut apparaître sans que rien ne le dise ;
 *   4. vérifie que chaque sortie déclarée existe, est un vrai PNG et porte les
 *      dimensions ET l'empreinte de pixels du manifeste ;
 *   5. exige un favicon clair STRUCTURELLEMENT valide (en-tête ICO, au moins une
 *      image, dimensions et empreintes de pixels conformes) — c'est le garde qui
 *      aurait attrapé le fichier de zéros ;
 *   6. refuse qu'un actif non géré (sans générateur) change sans être assumé, et
 *      qu'un actif déclaré « produit ailleurs » ne le soit pas réellement
 *      (croisement avec le manifeste Open Graph) ;
 *   7. REJOUE le générateur en dossier temporaire et compare les empreintes de
 *      pixels : c'est ce qui lie le manifeste au comportement réel du code, et
 *      pas seulement à sa déclaration ;
 *   8. refuse tout DOUBLON à la racine de public/ (icon-192x192.png,
 *      icon-512x512.png, favicon.png y étaient servis alors que plus rien ne les
 *      référençait : manifeste PWA, index.html et vercel.json pointent vers
 *      /icons/). Règle sans nom en dur, donc toute réintroduction est refusée ;
 *      favicon.ico reste, lui, exigé par index.html.
 *
 * Usage : cd frontend && node scripts/check-generated-icons.js
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FAMILY_DIR = path.join('public', 'icons');
// Libellé d'affichage : les messages doivent être IDENTIQUES d'une plateforme à
// l'autre (sous Windows, join() produit « public\icons », qui se mêle mal au
// reste du chemin dans un message).
export const FAMILY_LABEL = 'public/icons';
export const GENERATOR_NAME = 'generate_icons.py';
export const MANIFEST_NAME = 'icons-assets.manifest.json';
export const OG_MANIFEST_PATH = path.join('scripts', 'og-assets.manifest.json');

// Scripts de public/icons/ qui ne GÉNÈRENT rien. Volontairement explicite : tout
// autre script y déposé est suspect d'être une seconde source de vérité. Le
// présent garde s'y déclare lui-même — il inspecte la famille, il ne la produit
// pas — et un test de non-rot vérifie que chaque entrée existe bien sur disque.
export const ICON_READ_ONLY_SCRIPTS = ['check-generated-icons.js'];

export const SCRIPT_EXTENSIONS = ['.py', '.js', '.mjs', '.cjs', '.ts', '.sh'];
export const IMAGE_EXTENSIONS = ['.png', '.ico', '.svg'];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO_MAGIC = Buffer.from([0x00, 0x00, 0x01, 0x00]);

// Signaux d'un script qui ÉCRIT une image (repris du garde OG) : il faut ce
// signal ET une cible de la famille pour conclure, afin qu'un script qui ne fait
// que LIRE les icônes ne se dénonce pas lui-même.
const WRITES_IMAGE =
  /\.save\(|writeFileSync\(|writeFile\(|createWriteStream\(|\.toBuffer\(|\.toFile\(|Image\.new\(|sharp\(/;
const MENTIONS_ICON_OUTPUT = /icon-\d+x\d+\.png|favicon\.ico/i;

/** Lecture minimale d'un PNG : signature + chunk IHDR (dimensions). */
export const readPngSize = (filePath) => {
  const buffer = readFileSync(filePath);
  if (buffer.length < 33) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

/**
 * Répertoire d'un ICO, SANS rien décoder : en-tête (reserved=0, type=1), nombre
 * d'images, puis les 16 octets de chaque entrée (dimensions sur 1 octet, où 0
 * signifie 256, taille et position du blob). Volontairement strict : c'est ce
 * qui rend impossible le retour d'un fichier de zéros.
 */
export const readIcoDirectory = (buffer) => {
  if (buffer.length < 6) {
    return { ok: false, reason: `${buffer.length} octet(s), trop court pour un ICO` };
  }
  if (!buffer.subarray(0, 4).equals(ICO_MAGIC)) {
    return {
      ok: false,
      reason:
        `en-tête ${buffer.subarray(0, 4).toString('hex')} au lieu de ` +
        `${ICO_MAGIC.toString('hex')} (reserved=0, type=1)`,
    };
  }
  const count = buffer.readUInt16LE(4);
  if (count === 0) return { ok: false, reason: "aucune image (count=0)" };
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    if (offset + 16 > buffer.length) {
      return { ok: false, reason: `répertoire tronqué à l'entrée ${index}` };
    }
    entries.push({
      width: buffer[offset] || 256,
      height: buffer[offset + 1] || 256,
      bytes: buffer.readUInt32LE(offset + 8),
      start: buffer.readUInt32LE(offset + 12),
    });
  }
  return { ok: true, count, entries };
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * Empreinte du générateur : son contenu NORMALISÉ en LF, jamais ses octets bruts.
 *
 * Le fin de ligne d'une copie de travail n'est pas une propriété du code. Un
 * poste Windows matérialise les fichiers texte en CRLF, la CI Linux en LF : le
 * même commit produisait donc deux empreintes, et la CI — qui lit le blob LF —
 * croyait le manifeste périmé et refusait. C'est mesuré : `generate_icons.py`
 * valait b1ee7044… en CRLF (l'empreinte que le manifeste avait enregistrée) et
 * d531db3f… en LF (celle que la CI calcule).
 *
 * Le .gitattributes fige LF pour ce fichier, mais un éditeur ou un `core.autocrlf`
 * mal réglé peut toujours en produire localement : on normalise donc ICI aussi,
 * exactement comme le générateur Python (`read_bytes().replace(b"\r\n", b"\n")`).
 * Le passage par latin1 (bijectif octet ↔ caractère) garantit que la
 * normalisation reste strictement au niveau OCTET, sans supposer d'encodage.
 */
export const generatorFingerprint = (filePath) =>
  sha256(Buffer.from(readFileSync(filePath).toString('latin1').replace(/\r\n/g, '\n'), 'latin1'));

/** Premier interpréteur Python disponible, ou null (Ubuntu en fournit un). */
export const resolvePython = () => {
  for (const candidate of [process.env.PYTHON, 'python3', 'python'].filter(Boolean)) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Candidat suivant.
    }
  }
  return null;
};

/**
 * Fournisseur d'empreintes de PIXELS : demande au générateur (qui sait décoder
 * PNG et ICO) l'empreinte de chaque fichier. Renvoie null si Python manque —
 * les vérifications de pixels sont alors annoncées et sautées, plutôt que
 * transformées en faux rouge.
 */
export const makeDigestFiles = (root) => {
  const python = resolvePython();
  if (!python) return null;
  const generator = path.join(root, FAMILY_DIR, GENERATOR_NAME);
  return (files) => {
    const output = execFileSync(python, [generator, '--digest', ...files], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(output);
  };
};

/**
 * Rejoue le générateur dans un dossier temporaire et renvoie le manifeste qu'il
 * produit. C'est la vérification de COMPORTEMENT : elle prouve que les
 * empreintes committées sont bien celles du code, pas seulement celles d'un
 * fichier de référence.
 */
export const makeRegenerate = (root) => {
  const python = resolvePython();
  if (!python) return null;
  const familyDir = path.join(root, FAMILY_DIR);
  const generator = path.join(familyDir, GENERATOR_NAME);
  return () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'kojo-icons-'));
    try {
      execFileSync(
        python,
        [
          generator,
          '--source',
          'icon-512x512.png',
          '--out-dir',
          tmp,
          '--favicon',
          path.join(tmp, 'favicon.ico'),
          '--manifest',
          path.join(tmp, MANIFEST_NAME),
        ],
        { cwd: familyDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
      );
      return JSON.parse(readFileSync(path.join(tmp, MANIFEST_NAME), 'utf8'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  };
};

/**
 * @param {{ root?: string, digestFiles?: Function|null, regenerate?: Function|null }} [opts]
 * @returns {{ ok: boolean, errors: string[], notices: string[], outputs: Array<object> }}
 */
export const runGeneratedIconsCheck = (opts = {}) => {
  const root = opts.root || process.cwd();
  const familyDir = path.join(root, FAMILY_DIR);
  const manifestPath = path.join(familyDir, MANIFEST_NAME);
  const generatorPath = path.join(familyDir, GENERATOR_NAME);
  const digestFiles = opts.digestFiles === undefined ? makeDigestFiles(root) : opts.digestFiles;
  const regenerate = opts.regenerate === undefined ? makeRegenerate(root) : opts.regenerate;
  const log = opts.quiet ? () => {} : console.log;
  const logError = opts.quiet ? () => {} : console.error;

  const errors = [];
  const notices = [];
  const fail = (message) => errors.push(message);
  const notice = (message) => notices.push(message);

  // ── 1. Un seul générateur d'icônes ───────────────────────────────────────
  const familyFiles = existsSync(familyDir)
    ? readdirSync(familyDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort()
    : [];

  if (!existsSync(generatorPath)) {
    fail(
      `générateur canonique absent : ${FAMILY_LABEL}/${GENERATOR_NAME} doit rester la ` +
        `source de vérité des icônes PWA et du favicon clair`
    );
  }

  for (const name of familyFiles.filter((n) => SCRIPT_EXTENSIONS.includes(path.extname(n).toLowerCase()))) {
    if (name === GENERATOR_NAME) continue;
    if (ICON_READ_ONLY_SCRIPTS.includes(name)) continue;
    fail(
      `script non déclaré dans ${FAMILY_LABEL}/ (${name}) : tout script de la famille doit ` +
        `être soit le générateur canonique ${GENERATOR_NAME}, soit déclaré dans ` +
        `ICON_READ_ONLY_SCRIPTS s'il ne fait que LIRE les icônes`
    );
  }

  // Second générateur au nom anodin, hors du dossier de la famille : contenu qui
  // écrit une image ET vise une sortie de la famille (icon-<n>x<n>.png ou
  // favicon.ico). Le générateur canonique et les lecteurs déclarés sont exclus.
  const scanDirs = [familyDir, path.join(root, 'scripts')];
  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)) {
      if (name === GENERATOR_NAME || ICON_READ_ONLY_SCRIPTS.includes(name)) continue;
      if (!SCRIPT_EXTENSIONS.includes(path.extname(name).toLowerCase())) continue;
      let source = '';
      try {
        source = readFileSync(path.join(dir, name), 'utf8');
      } catch {
        continue; // Binaire ou illisible : rien à inspecter.
      }
      if (WRITES_IMAGE.test(source) && MENTIONS_ICON_OUTPUT.test(source)) {
        fail(
          `second générateur d'icônes détecté (` +
            `${path.relative(root, path.join(dir, name)).replace(/\\/g, '/')}) : ` +
            `ce fichier écrit une image de la famille, or une seule source de vérité est ` +
            `autorisée, ${FAMILY_LABEL}/${GENERATOR_NAME} — s'il ne fait que LIRE les icônes, ` +
            `déclare-le dans ICON_READ_ONLY_SCRIPTS`
        );
      }
    }
  }

  // ── 2. Manifeste écrit par le générateur, et pas périmé ──────────────────
  let manifest = null;
  if (!existsSync(manifestPath)) {
    fail(
      `manifeste ${FAMILY_LABEL}/${MANIFEST_NAME} absent : exécute ` +
        `« python generate_icons.py » depuis ${FAMILY_DIR} puis committe le manifeste ` +
        `(c'est l'empreinte de la famille)`
    );
  } else {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      fail(`${MANIFEST_NAME} illisible (JSON invalide) : ${error.message}`);
    }
  }

  const outputs = [];

  if (manifest) {
    if (existsSync(generatorPath)) {
      const current = generatorFingerprint(generatorPath);
      if (manifest.generator_sha256 !== current) {
        fail(
          `${FAMILY_LABEL}/${GENERATOR_NAME} a changé depuis la dernière génération : relance-le ` +
            `et committe le manifeste (et les fichiers si leurs pixels bougent)`
        );
      }
    }

    const outputs_ = Array.isArray(manifest.outputs) ? manifest.outputs : [];
    const unmanaged = Array.isArray(manifest.unmanaged) ? manifest.unmanaged : [];
    const foreign = Array.isArray(manifest.foreign) ? manifest.foreign : [];
    const maskable = manifest.maskable && typeof manifest.maskable === 'object' ? manifest.maskable : null;
    const maskableOutputs = maskable && Array.isArray(maskable.outputs) ? maskable.outputs : [];

    // ── 3. Inventaire : aucune image de la famille non déclarée ─────────────
    const declared = new Set([
      ...outputs_.map((entry) => entry.file),
      ...maskableOutputs.map((entry) => entry.file),
      ...unmanaged.map((entry) => entry.file),
      ...foreign.map((entry) => entry.file),
    ]);
    const onDisk = familyFiles.filter((name) => IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase()));

    for (const name of onDisk) {
      if (!declared.has(name)) {
        fail(
          `${FAMILY_LABEL}/${name} n'est déclarée par aucun manifeste : ajoute-la aux sorties ` +
            `du générateur, à UNMANAGED_ASSETS (sans générateur) ou à FOREIGN_ASSETS ` +
            `(produite ailleurs) — sans quoi une icône peut changer en silence`
        );
      }
    }
    for (const entry of [...outputs_, ...unmanaged, ...foreign]) {
      if (!entry || typeof entry.file !== 'string') {
        fail(`${MANIFEST_NAME} : entrée sans nom de fichier`);
        continue;
      }
      if (path.basename(entry.file) !== entry.file) {
        fail(`${MANIFEST_NAME} : « ${entry.file} » doit être un nom de fichier de ${FAMILY_LABEL}/`);
        continue;
      }
      if (!existsSync(path.join(familyDir, entry.file))) {
        fail(`${FAMILY_LABEL}/${entry.file} manquant (déclaré par ${MANIFEST_NAME})`);
        continue;
      }
    }

    // ── 4. Sorties : dimensions ET empreinte de pixels ─────────────────────
    const pixelTargets = [];
    for (const entry of outputs_) {
      const filePath = path.join(familyDir, entry.file);
      if (!existsSync(filePath)) continue; // déjà signalé en 3.
      const size = readPngSize(filePath);
      if (!size) {
        fail(`${FAMILY_LABEL}/${entry.file} n'est pas un PNG valide (signature ou IHDR illisible)`);
        continue;
      }
      if (size.width !== entry.width || size.height !== entry.height) {
        fail(
          `${FAMILY_LABEL}/${entry.file} fait ${size.width}×${size.height} alors que ` +
            `${MANIFEST_NAME} déclare ${entry.width}×${entry.height}`
        );
        continue;
      }
      outputs.push({ file: entry.file, width: size.width, height: size.height });
      pixelTargets.push({ entry, filePath, label: `${FAMILY_LABEL}/${entry.file}` });
    }

    // ── 4b. Variantes maskable : le masque ne doit rien rogner ──────────────
    // C'est ici que tombe la faute d'origine : les fichiers « -maskable »
    // committés avait un rayon de contenu de 0,495 pour une limite de 0,400, et
    // le 512 était un duplicata AU PIXEL PRÈS de l'icône normale. Déclarer
    // « maskable » l'un ou l'autre faisait rogner le logo par les plateformes.
    if (!maskable) {
      fail(
        `${MANIFEST_NAME} : section « maskable » absente alors que ${GENERATOR_NAME} en ` +
          `déclare (MASKABLE_SIZES) : relance-le`
      );
    } else {
      const safeZone = Number(maskable.safe_zone_radius);
      const target = Number(maskable.content_radius_target);
      const maskableSizes = new Set((maskable.sizes || []).map(Number));
      if (!Number.isFinite(safeZone) || safeZone <= 0) {
        fail(`${MANIFEST_NAME} : « maskable.safe_zone_radius » illisible`);
      }
      if (Number.isFinite(safeZone) && Number.isFinite(target) && target > safeZone) {
        fail(
          `${MANIFEST_NAME} : « maskable.content_radius_target » (${target}) dépasse la zone de ` +
            `sécurité (${safeZone}) — la cible ne serait pas vérifiable`
        );
      }
      if (maskableSizes.size !== maskableOutputs.length) {
        fail(
          `${MANIFEST_NAME} : « maskable.sizes » annonce ${maskableSizes.size} taille(s) mais ` +
            `${maskableOutputs.length} variante(s) sont décrites`
        );
      }
      for (const entry of maskableOutputs) {
        if (!entry || typeof entry.file !== 'string') {
          fail(`${MANIFEST_NAME} : variante maskable sans nom de fichier`);
          continue;
        }
        if (!/-maskable\.png$/.test(entry.file)) {
          fail(
            `${MANIFEST_NAME} : la variante maskable « ${entry.file} » ne suit pas la convention ` +
              `« icon-<taille>x<taille>-maskable.png »`
          );
        }
        const filePath = path.join(familyDir, entry.file);
        if (!existsSync(filePath)) continue; // déjà signalé en 3.
        const size = readPngSize(filePath);
        if (!size) {
          fail(`${FAMILY_LABEL}/${entry.file} n'est pas un PNG valide (signature ou IHDR illisible)`);
          continue;
        }
        if (size.width !== entry.width || size.height !== entry.height) {
          fail(
            `${FAMILY_LABEL}/${entry.file} fait ${size.width}×${size.height} alors que ` +
              `${MANIFEST_NAME} déclare ${entry.width}×${entry.height}`
          );
          continue;
        }
        if (maskableSizes.size > 0 && !maskableSizes.has(size.width)) {
          fail(
            `${FAMILY_LABEL}/${entry.file} fait ${size.width} px, taille absente de ` +
              `« maskable.sizes » : une variante non déclarée ne sera jamais servie`
          );
        }
        outputs.push({ file: entry.file, width: size.width, height: size.height });
        pixelTargets.push({
          entry,
          filePath,
          label: `${FAMILY_LABEL}/${entry.file}`,
          maskable: true,
          safeZone,
        });
      }
    }

    // Contrôle de cohérence interne : le manifeste doit décrire toutes les
    // tailles que le générateur annonce, ni plus ni moins.
    const sizes = Array.isArray(manifest.sizes) ? manifest.sizes : [];
    if (sizes.length !== outputs_.length) {
      fail(
        `${MANIFEST_NAME} déclare ${sizes.length} taille(s) mais ${outputs_.length} sortie(s) : ` +
          `manifeste incohérent, relance ${GENERATOR_NAME}`
      );
    }

    // ── 5. Favicon clair : ICO structurellement valide ────────────────────
    const favicon = manifest.favicon && typeof manifest.favicon === 'object' ? manifest.favicon : null;
    if (!favicon || typeof favicon.file !== 'string') {
      fail(`${MANIFEST_NAME} : section « favicon » absente ou malformée`);
    } else {
      const faviconPath = path.resolve(path.dirname(manifestPath), favicon.file);
      const faviconLabel = path.relative(root, faviconPath).replace(/\\/g, '/');
      if (!existsSync(faviconPath)) {
        fail(`${faviconLabel} manquant (favicon clair déclaré par ${MANIFEST_NAME})`);
      } else {
        const buffer = readFileSync(faviconPath);
        const directory = readIcoDirectory(buffer);
        if (!directory.ok) {
          fail(
            `${faviconLabel} n'est pas un ICO exploitable (${directory.reason}) — ` +
              `index.html le référence comme favicon principal, un fichier invalide ` +
              `signifie aucun favicon ; relance ${GENERATOR_NAME}`
          );
        } else {
          const entries = Array.isArray(favicon.entries) ? favicon.entries : [];
          if (directory.count !== entries.length) {
            fail(
              `${faviconLabel} contient ${directory.count} image(s) alors que ` +
                `${MANIFEST_NAME} en déclare ${entries.length}`
            );
          }
          for (const [index, entry] of entries.entries()) {
            const actual = directory.entries[index];
            if (!actual) continue; // nombre déjà signalé ci-dessus.
            if (actual.width !== entry.width || actual.height !== entry.height) {
              fail(
                `${faviconLabel} image ${index} fait ${actual.width}×${actual.height} alors que ` +
                  `${MANIFEST_NAME} déclare ${entry.width}×${entry.height}`
              );
              continue;
            }
            if (actual.start + actual.bytes > buffer.length) {
              fail(`${faviconLabel} image ${index} dépasse la fin du fichier (blob tronqué)`);
              continue;
            }
            if (!buffer.subarray(actual.start, actual.start + 8).equals(PNG_SIGNATURE)) {
              fail(
                `${faviconLabel} image ${index} n'est pas un PNG embarqué : ` +
                  `le générateur n'écrit que des entrées PNG`
              );
              continue;
            }
            outputs.push({ file: `${faviconLabel} [${actual.width}]`, width: actual.width, height: actual.height });
          }
          pixelTargets.push({ entry: { file: favicon.file, pixel_sha256: null }, filePath: faviconPath, label: faviconLabel, ico: true, entries });
        }
      }
    }

    // ── 6a. Actifs non gérés : dérive d'octets assumée ou refusée ──────────
    for (const entry of unmanaged) {
      if (!entry || typeof entry.file !== 'string') continue;
      const filePath = path.join(familyDir, entry.file);
      if (!existsSync(filePath)) continue; // déjà signalé en 3.
      const data = readFileSync(filePath);
      if (entry.missing) {
        fail(
          `${MANIFEST_NAME} déclare ${FAMILY_LABEL}/${entry.file} comme absent alors que le ` +
            `fichier existe : manifeste périmé, relance ${GENERATOR_NAME}`
        );
        continue;
      }
      if (entry.sha256 !== sha256(data)) {
        fail(
          `${FAMILY_LABEL}/${entry.file} a changé depuis le manifeste (actif SANS générateur, ` +
            `donc non reproductible) : si ce changement est voulu, relance ${GENERATOR_NAME} ` +
            `pour réenregistrer son empreinte ; sinon, restaure le fichier`
        );
      }
    }

    // ── 6b. Actifs « produits ailleurs » : le manifeste étranger doit le dire ─
    const ogManifestPath = path.join(root, OG_MANIFEST_PATH);
    let ogFiles = null;
    if (foreign.length > 0) {
      if (!existsSync(ogManifestPath)) {
        fail(
          `${MANIFEST_NAME} déclare des actifs produits ailleurs mais ` +
            `${OG_MANIFEST_PATH} est absent : impossible de vérifier la délégation`
        );
      } else {
        try {
          const ogManifest = JSON.parse(readFileSync(ogManifestPath, 'utf8'));
          ogFiles = new Set((ogManifest.assets || []).map((asset) => asset.file));
        } catch (error) {
          fail(`${OG_MANIFEST_PATH} illisible (JSON invalide) : ${error.message}`);
        }
      }
    }
    for (const entry of foreign) {
      if (!entry || typeof entry.file !== 'string' || typeof entry.generated_by !== 'string') {
        fail(`${MANIFEST_NAME} : entrée « foreign » malformée`);
        continue;
      }
      if (unmanaged.some((other) => other && other.file === entry.file)) {
        fail(
          `${entry.file} est déclaré à la fois « unmanaged » et « foreign » : un actif ne peut ` +
            `pas être sans générateur ET produit ailleurs`
        );
      }
      if (!ogFiles) continue;
      const expected = `${path.basename(FAMILY_DIR)}/${entry.file}`.replace(/\\/g, '/');
      if (!ogFiles.has(expected)) {
        fail(
          `${FAMILY_LABEL}/${entry.file} est déclaré produit par ${entry.generated_by}, mais ` +
            `${OG_MANIFEST_PATH} ne le liste pas : la délégation ne tient plus — corrige la ` +
            `déclaration ou régénère le manifeste de l'autre famille`
        );
      }
    }

    // ── 7. Preuve de comportement : rejeu du générateur ────────────────────
    if (typeof regenerate === 'function') {
      let fresh = null;
      try {
        fresh = regenerate();
      } catch (error) {
        fail(`rejeu du générateur impossible : ${error.message}`);
      }
      if (fresh) {
        const freshOutputs = new Map((fresh.outputs || []).map((entry) => [entry.file, entry]));
        for (const entry of outputs_) {
          const replayed = freshOutputs.get(entry.file);
          if (!replayed) {
            fail(
              `${GENERATOR_NAME} ne produit plus ${entry.file} : manifeste périmé, relance-le`
            );
            continue;
          }
          if (replayed.pixel_sha256 !== entry.pixel_sha256) {
            fail(
              `${entry.file} : les pixels produits par ${GENERATOR_NAME} ont changé ` +
                `(${String(replayed.pixel_sha256).slice(0, 12)}… ≠ ` +
                `${String(entry.pixel_sha256).slice(0, 12)}… du manifeste) — relance-le et ` +
                `committe les fichiers : une icône ne doit pas changer d'aspect sans trace`
            );
          }
        }
        const freshFavicon = (fresh.favicon && fresh.favicon.entries) || [];
        const recordedFavicon = (favicon && favicon.entries) || [];
        if (freshFavicon.length !== recordedFavicon.length) {
          fail(
            `${GENERATOR_NAME} embarque ${freshFavicon.length} image(s) dans le favicon au lieu ` +
              `de ${recordedFavicon.length} : manifeste périmé`
          );
        } else {
          for (const [index, entry] of recordedFavicon.entries()) {
            if (freshFavicon[index].pixel_sha256 !== entry.pixel_sha256) {
              fail(
                `favicon clair, image ${index} (${entry.width}×${entry.height}) : pixels ` +
                  `différents de ceux produits par ${GENERATOR_NAME} — relance-le`
              );
            }
          }
        }
        // Les variantes maskable sont rejouées comme le reste : sans cela, seul
        // l'empreinte du script protégerait leur algorithme, alors que le rejeu
        // prouve le comportement.
        const freshMaskable = new Map(
          (((fresh.maskable && fresh.maskable.outputs) || []).map((entry) => [entry.file, entry]))
        );
        for (const entry of maskableOutputs) {
          const replayed = freshMaskable.get(entry.file);
          if (!replayed) {
            fail(
              `${GENERATOR_NAME} ne produit plus la variante maskable ${entry.file} : ` +
                `manifeste périmé, relance-le`
            );
            continue;
          }
          if (replayed.pixel_sha256 !== entry.pixel_sha256) {
            fail(
              `${entry.file} : les pixels de la variante maskable produits par ${GENERATOR_NAME} ` +
                `ont changé — relance-le et committe les fichiers`
            );
          }
        }

        if (fresh.source && manifest.source && fresh.source.pixel_sha256 !== manifest.source.pixel_sha256) {
          fail(
            `${MANIFEST_NAME} décrit une source différente de celle que ${GENERATOR_NAME} ` +
              `utilise aujourd'hui : manifeste périmé`
          );
        }
      }
    } else {
      notice(
        'Python indisponible : le rejeu du générateur (preuve de comportement) est sauté. ' +
          'Les contrôles de structure, dimension et inventaire restent actifs.'
      );
    }

    // ── Empreintes de pixels des fichiers COMMITTÉS ────────────────────────
    // Le manifeste dit ce que le générateur produit ; ce contrôle-ci dit que les
    // fichiers versionnés sont bien ces pixels-là (et pas une retouche à la main).
    if (pixelTargets.length > 0) {
      if (typeof digestFiles !== 'function') {
        notice(
          'Python indisponible : la comparaison des pixels des fichiers committés avec le ' +
            'manifeste est sautée.'
        );
      } else {
        let digests = null;
        try {
          digests = digestFiles(pixelTargets.map((target) => target.filePath));
        } catch (error) {
          fail(`calcul des empreintes de pixels impossible : ${error.message}`);
        }
        if (digests) {
          for (const target of pixelTargets) {
            const digest = digests[target.filePath];
            if (!digest || digest.error) {
              fail(
                `${target.label} : empreinte de pixels illisible ` +
                  `(${(digest && digest.error) || 'aucune réponse du générateur'})`
              );
              continue;
            }
            if (target.ico) {
              const entries = (digest.entries || []).map((entry) => entry.pixel_sha256);
              for (const [index, entry] of target.entries.entries()) {
                if (entries[index] !== entry.pixel_sha256) {
                  fail(
                    `${target.label} image ${index} (${entry.width}×${entry.height}) : pixels du ` +
                      `fichier committé différents du manifeste — relance ${GENERATOR_NAME}`
                  );
                }
              }
              continue;
            }
            if (digest.pixel_sha256 !== target.entry.pixel_sha256) {
              fail(
                `${target.label} : pixels du fichier committé différents du manifeste ` +
                  `(${String(digest.pixel_sha256).slice(0, 12)}… ≠ ` +
                  `${String(target.entry.pixel_sha256).slice(0, 12)}…) — icône retouchée à la main ` +
                  `ou non régénérée`
              );
              continue;
            }
            if (target.maskable) {
              // Le fond est opaque : c'est la différence avec sa couleur qui
              // délimite le contenu, pas la transparence (voir le générateur).
              const measured = Number(digest.content_radius_background);
              if (digest.opaque !== true) {
                fail(
                  `${target.label} n'est pas entièrement opaque : un masque laisserait voir le ` +
                    `fond du système à travers l'icône (relance ${GENERATOR_NAME})`
                );
              }
              if (!Number.isFinite(measured) || measured > target.safeZone) {
                fail(
                  `${target.label} : contenu jusqu'à un rayon de ${measured} alors que le masque ` +
                    `ne garantit que ${target.safeZone} — l'icône serait rognée ; réduis le contenu ` +
                    `dans ${GENERATOR_NAME}`
                );
              }
              const recorded = Number(target.entry.content_radius);
              if (Number.isFinite(measured) && Number.isFinite(recorded) && Math.abs(measured - recorded) > 0.002) {
                fail(
                  `${target.label} : rayon mesuré ${measured} ≠ ${recorded} enregistré dans ` +
                    `${MANIFEST_NAME}`
                );
              }
            }
          }
        }
      }
    }

    // Doublons hérités à la RACINE de public/ : une copie d'une icône de la
    // famille y était servie publiquement alors que plus rien ne la référence
    // (le manifeste PWA, index.html et vercel.json pointent tous vers /icons/).
    // Ils ont été supprimés — favicon.png, icon-192x192.png, icon-512x512.png —
    // et la règle est désormais BLOQUANTE, sans aucun nom en dur, pour que la
    // copie d'une icône ne puisse pas être réintroduite en silence. La seule
    // image servie à la racine reste favicon.ico, exigé par index.html.
    const publicRoot = path.join(root, 'public');
    if (existsSync(publicRoot)) {
      const rootImages = readdirSync(publicRoot)
        .filter((name) => /^icon-\d+x\d+\.png$/.test(name) || name === 'favicon.png')
        .sort();
      for (const name of rootImages) {
        fail(
          `public/${name} duplique une icône de la famille à la racine de public/ : ` +
            `référencé nulle part (le manifeste PWA, index.html et vercel.json pointent ` +
            `vers /icons/) — supprime-le, sa place est dans ` +
            `${FAMILY_LABEL}/ s'il est produit par ${GENERATOR_NAME}`
        );
      }
    }
  }

  if (errors.length > 0) {
    logError(`❌ Famille d'icônes non conforme (${errors.length} problème(s)) :`);
    for (const message of errors) logError(`   • ${message}`);
    for (const message of notices) logError(`   ℹ️  ${message}`);
    return { ok: false, errors, notices, outputs };
  }

  log(
    `Générateur unique : ${FAMILY_LABEL}/${GENERATOR_NAME} ` +
      `(${familyFiles.length} fichiers inspectés, ${outputs.length} sorties vérifiées)`
  );
  for (const output of outputs) {
    log(`  ${output.file.padEnd(30)} ${output.width}×${output.height}`);
  }
  for (const message of notices) log(`  ℹ️  ${message}`);
  log(
    `✅ Famille d'icônes verrouillée : inventaire complet, dimensions et empreintes de ` +
      `pixels conformes à ${MANIFEST_NAME}, favicon clair valide, variantes maskable dans la ` +
      `zone de sécurité`
  );
  return { ok: true, errors, notices, outputs };
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = runGeneratedIconsCheck();
  if (!result.ok) process.exit(1);
}
