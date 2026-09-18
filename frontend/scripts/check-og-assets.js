#!/usr/bin/env node
/**
 * Garde-fou du lot « Open Graph » : une seule source de vérité, et des PNG
 * réellement conformes à ce que cette source déclare.
 *
 * Le pré-rendu par route (vite.config.js) pointe vers des cartes OG servies
 * depuis public/ (og-image-1200x630.png, og-jobs.png, og-login.png et leurs
 * variantes carrées) plus le favicon sombre. Ces binaires sont générés par
 * scripts/gen-og-images.py puis versionnés — ils peuvent donc DÉRIVER
 * silencieusement (carte remplacée à la main, mauvais gabarit, fichier oublié,
 * second générateur ajouté à côté) sans qu'aucun test ne s'en aperçoive.
 *
 * Ce check :
 *   1. n'accepte QU'UN générateur OG dans scripts/ — deux scripts de
 *      génération finissent toujours par produire des cartes divergentes.
 *      La détection se fait à deux étages : par le NOM (jeton « og » + verbe
 *      de production, quelle que soit l'extension de script) et, pour un nom
 *      anodin, par le CONTENU (le fichier écrit une image ET vise une carte
 *      OG). Il faut les DEUX signaux : un checker qui ne fait que LIRE les
 *      cartes n'écrit pas d'image, donc il n'a jamais besoin d'exception ;
 *   2. lit les DÉCLARATIONS DANS les données (un fichier par carte sous
 *      scripts/og-cards/, qui nomme la route qu'elle sert, les clés de texte de
 *      cette page et ses deux sorties) et les DIMENSIONS DANS le générateur
 *      lui-même (formats wide/carré, taille du favicon) : aucune constante n'est
 *      dupliquée ici, donc le check ne peut pas diverger ;
 *   3. vérifie que chaque PNG attendu existe, est un VRAI PNG (signature +
 *      chunk IHDR) et porte EXACTEMENT les dimensions déclarées ;
 *   4. refuse tout og-*.png ORPHELIN dans public/ (présent mais absent du
 *      manifeste) : c'est un reliquat que le générateur ne sait pas reproduire.
 *   5. confronte le MANIFESTE de reproductibilité (écrit par le générateur) aux
 *      fichiers commités : empreinte SHA-256 de chaque carte, empreinte du
 *      générateur, empreinte du CONTENU des cartes, polices retenues. C'est ce
 *      qui rend la divergence — carte retouchée à la main, texte changé sans
 *      régénération, cartes refaites ailleurs avec une AUTRE police —
 *      détectable sur n'importe quel runner, sans dépendre des polices
 *      installées ;
 *   6. recompose le TEXTE que chaque carte dessine (les lignes consignées dans
 *      le manifeste) et exige qu'il soit EXACTEMENT le titre et la description
 *      de sa page, lus dans src/i18n/fr.json. C'est cette égalité qui rend
 *      impossible qu'un visuel de partage et la page qu'il annonce disent deux
 *      textes différents : renommer un titre sans régénérer les cartes fait
 *      échouer ce check, au lieu de laisser un PNG périmé derrière un manifeste
 *      « frais ».
 *
 * Usage : cd frontend && node scripts/check-og-assets.js
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const GENERATOR_NAME = 'gen-og-images.py';

// Scripts OG qui NE génèrent RIEN : ils LISENT les cartes pour les vérifier.
const SCRIPT_EXTENSIONS = ['.py', '.js', '.mjs', '.cjs', '.ts', '.sh'];

export const MANIFEST_NAME = 'og-assets.manifest.json';

// Le contenu des cartes : un fichier JSON par carte, à côté du générateur.
// Ajouter une carte dédiée, c'est ajouter un fichier ici — jamais toucher au code.
export const CARDS_DIR_NAME = 'og-cards';

// Polices de l'environnement de RÉFÉRENCE : celles qui ont produit les PNG
// commités (poste Windows, Arial). Le générateur retombe sinon sur DejaVu
// (Linux) ou sur la police bitmap de Pillow, avec un aspect différent à
// l'arrivée : le manifeste consigne la police retenue et ce garde refuse le
// changement tant qu'il n'est pas assumé ici, en connaissance de cause.
export const REFERENCE_FONTS = { regular: 'arial.ttf', bold: 'arialbd.ttf' };

// Ce qu'une carte DOIT déclarer : sa route, les clés i18n du titre et de la
// description de cette page, et ses deux sorties. Le générateur refuse les mêmes
// champs — une carte incomplète n'est pas une carte, et la laisser passer
// reviendrait à dessiner un visuel qui n'annonce rien de vérifiable.
export const REQUIRED_CARD_KEYS = ['route', 'title', 'description', 'wide', 'square'];

// Le dictionnaire dont les cartes dessinent le texte : fr.json, la langue des
// coquilles pré-rendues, donc le texte qu'un crawler sans JavaScript lit.
export const DICTIONARY_PATH = 'src/i18n/fr.json';

/**
 * Étage 1 — le NOM. Un générateur doit le dire : un jeton « og » ET un verbe
 * de production, dans n'importe quel ordre et pour n'importe quelle extension.
 * C'est ce qui rattrape « generate-og-cards.py », « og-generator.py »,
 * « build-og.js » ou « make-og-images.sh », que l'ancien motif
 * /^gen[-_]?og.*\.py$/ (gen+og en tête, Python uniquement) laissait passer.
 */
export const nameLooksLikeOgGenerator = (name) => {
  const ext = path.extname(name).toLowerCase();
  if (!SCRIPT_EXTENSIONS.includes(ext)) return false;
  const stem = name.slice(0, name.length - ext.length).toLowerCase();
  const hasOgToken = /(?:^|[-_.])og(?:[-_.]|$)/.test(stem);
  const hasVerb = /(?:^|[-_.])(?:gen|generate|generator|make|build|create|render|export)(?:[-_.]|$)/.test(
    stem
  );
  return hasOgToken && hasVerb;
};

/**
 * Étage 2 — le CONTENU, pour les noms qui ne disent rien (« cards.py »). Il
 * faut les DEUX signaux : écrire une image (API d'écriture) ET viser une carte
 * OG. Exiger les deux évite de confondre un lecteur qui mentionne forcément
 * « og-*.png » avec un producteur : un lecteur qui ne fait que vérifier les
 * cartes échoue sur la première.
 */
const WRITES_IMAGE = /\.save\(|writeFileSync\(|writeFile\(|createWriteStream\(|\.toBuffer\(|\.toFile\(|Image\.new\(|sharp\(/;
const MENTIONS_OG_ASSET = /og-[a-z0-9-]*\.png|public\/og/i;

export const contentLooksLikeOgGenerator = (source) =>
  WRITES_IMAGE.test(source) && MENTIONS_OG_ASSET.test(source);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Empreinte du générateur : son contenu NORMALISÉ en LF, jamais ses octets bruts.
 *
 * Le fin de ligne d'une copie de travail n'est pas une propriété du code. Un
 * poste Windows matérialise les fichiers texte en CRLF, la CI Linux en LF : le
 * même commit produisait donc deux empreintes, et la CI — qui lit le blob LF —
 * croyait le manifeste périmé et refusait. Ce script vit sous
 * frontend/scripts/** (déjà figé en LF par .gitattributes), mais la règle est
 * ici pour que l'identité du générateur soit la même partout, quel que soit le
 * réglage `core.autocrlf` du poste qui régénère.
 *
 * Le passage par latin1 (bijectif octet ↔ caractère) garantit que la
 * normalisation reste strictement au niveau OCTET, sans supposer d'encodage —
 * identique au `read_bytes().replace(b"\r\n", b"\n")` du générateur Python.
 */
const generatorFingerprint = (filePath) =>
  createHash('sha256')
    .update(Buffer.from(readFileSync(filePath).toString('latin1').replace(/\r\n/g, '\n'), 'latin1'))
    .digest('hex');

/**
 * Le contenu des cartes, lu dans les fichiers de DONNÉES du dossier des cartes.
 *
 * Un fichier par carte, parcouru trié par nom : c'est la source de vérité de la
 * liste des PNG. Chaque carte nomme ses DEUX sorties ; une carte qui n'en nomme
 * qu'une est signalée nommément plutôt que sautée en silence — sinon elle
 * sortirait du périmètre vérifié sans que rien ne le dise.
 */
export const readDeclaredCards = (cardsDir) => {
  if (!existsSync(cardsDir)) {
    return {
      cards: [],
      errors: [
        `${CARDS_DIR_NAME}/ absent : une carte se déclare par un fichier JSON ` +
          `qui nomme ses sorties (voir scripts/${GENERATOR_NAME})`,
      ],
    };
  }
  const errors = [];
  const cards = [];
  for (const name of readdirSync(cardsDir).filter((file) => file.endsWith('.json')).sort()) {
    let data = null;
    try {
      data = JSON.parse(readFileSync(path.join(cardsDir, name), 'utf8'));
    } catch (error) {
      errors.push(`${CARDS_DIR_NAME}/${name} illisible (JSON invalide) : ${error.message}`);
      continue;
    }
    const missing = REQUIRED_CARD_KEYS.filter(
      (key) => typeof data[key] !== 'string' || !data[key].trim()
    );
    if (missing.length > 0) {
      errors.push(
        `${CARDS_DIR_NAME}/${name} ne déclare pas ${missing.join(' ni ')} : une carte nomme ` +
          `la route qu'elle sert, les clés i18n du titre et de la description de cette page, ` +
          `et ses DEUX sorties (wide et square)`
      );
      continue;
    }
    if (!data.route.startsWith('/')) {
      errors.push(
        `${CARDS_DIR_NAME}/${name} : la route « ${data.route} » n'est pas un chemin absolu ` +
          `(« /jobs ») — c'est la page que cette carte sert`
      );
      continue;
    }
    cards.push({
      name,
      route: data.route,
      title: data.title,
      description: data.description,
      wide: data.wide,
      square: data.square,
    });
  }
  if (cards.length === 0 && errors.length === 0) {
    errors.push(`${CARDS_DIR_NAME}/ ne contient aucun fichier *.json : aucune carte à vérifier`);
  }
  return { cards, errors };
};

/**
 * Empreinte du CONTENU des cartes : même recette OCTET POUR OCTET que
 * `cards_sha256()` du générateur (nom de fichier + LF + contenu normalisé en LF,
 * fichiers triés).
 *
 * Le texte n'est plus dans le générateur, donc l'empreinte du générateur ne peut
 * plus le couvrir : sans celle-ci, changer une accroche sans relancer le script
 * laisserait des PNG périmés derrière un manifeste « frais », et la CI dirait
 * vert sur des cartes que plus personne ne peut reproduire.
 */
/**
 * La règle de fond : le texte qu'une carte DESSINE est celui de sa page.
 *
 * Le générateur consigne dans le manifeste les LIGNES réellement dessinées (par
 * format et par champ) ; ici elles sont recomposées (jointes par une espace —
 * le retour à la ligne ne coupe jamais un mot) et comparées au dictionnaire.
 * L'égalité est le seul contrôle possible sans exécuter Pillow, et c'est le bon :
 * elle attrape exactement les deux divergences réelles — un texte de page
 * renommé sans régénérer les cartes, et un manifeste retouché à la main pour y
 * faire dire autre chose que ce que la page publie.
 *
 * `cards` (les fichiers de données) dit ce qui a été DESSINÉ ; le manifeste dit ce
 * qui est VRAI dans les PNG versionnés. Les deux doivent dire la même chose, sinon
 * les empreintes (cards_sha256) et cette égalité désignent le même coupable : une
 * carte à régénérer.
 *
 * @param {object} options
 * @param {Array<object>} options.cards Cartes déclarées (readDeclaredCards).
 * @param {object} options.manifest Manifeste lu sur le disque.
 * @param {object} options.dictionary Dictionnaire français (src/i18n/fr.json).
 * @returns {string[]} Une erreur par divergence, nommée.
 */
export const checkCardTexts = ({ cards = [], manifest, dictionary }) => {
  const errors = [];
  const entries = Array.isArray(manifest?.cards) ? manifest.cards : [];
  if (entries.length === 0) {
    errors.push(
      `${MANIFEST_NAME} ne décrit aucune carte (clé « cards » absente ou vide) : le texte que ` +
        `les cartes dessinent n'est pas vérifiable — relance scripts/${GENERATOR_NAME}`
    );
    return errors;
  }
  const byRoute = new Map(
    entries.filter((entry) => entry && typeof entry.route === 'string').map((entry) => [entry.route, entry])
  );

  for (const card of cards) {
    const entry = byRoute.get(card.route);
    if (!entry) {
      errors.push(
        `${MANIFEST_NAME} ne décrit pas la carte de la route « ${card.route} » ` +
          `(${CARDS_DIR_NAME}/${card.name}) : manifeste périmé — relance scripts/${GENERATOR_NAME}`
      );
      continue;
    }
    for (const key of ['title', 'description', 'wide', 'square']) {
      if (entry[key] !== card[key]) {
        errors.push(
          `${MANIFEST_NAME} : la carte « ${card.route} » y annonce ${key} = « ${entry[key]} », mais ` +
            `${CARDS_DIR_NAME}/${card.name} déclare « ${card[key]} » — manifeste périmé ou retouché ` +
            `à la main, relance scripts/${GENERATOR_NAME}`
        );
      }
    }
    for (const [kind, field] of [
      ['wide', 'title'],
      ['wide', 'description'],
      ['square', 'title'],
      ['square', 'description'],
    ]) {
      const key = card[field];
      const published = typeof dictionary?.[key] === 'string' ? dictionary[key] : null;
      if (published === null) {
        errors.push(
          `${DICTIONARY_PATH} : la clé « ${key} » (${field} de la route « ${card.route} ») est ` +
            'absente ou vide — la carte de cette page dessinerait un texte que la page ne publie pas'
        );
        continue;
      }
      const drawn = entry.lines?.[kind]?.[field];
      if (!Array.isArray(drawn) || drawn.length === 0) {
        errors.push(
          `${MANIFEST_NAME} : la carte ${kind} de « ${card.route} » ne consigne pas les lignes ` +
            `dessinées pour son ${field} — relance scripts/${GENERATOR_NAME}`
        );
        continue;
      }
      if (drawn.join(' ') !== published) {
        errors.push(
          `la carte ${kind} de « ${card.route} » dessine « ${drawn.join(' ')} », alors que ` +
            `${DICTIONARY_PATH} publie « ${published} » pour ${key} : le texte de la page a ` +
            `changé, donc la carte de partage annoncerait autre chose que sa page — relance ` +
            `scripts/${GENERATOR_NAME} et committe les PNG`
        );
      }
    }
  }

  // La carte de la RACINE sert toute page sans visuel dédié (src/config/og-cards.js) :
  // sans elle, ces pages n'annonceraient plus aucune carte.
  if (!byRoute.has('/')) {
    errors.push(
      `aucune carte ne sert la route « / » (${CARDS_DIR_NAME}/) : c'est la carte servie à ` +
        "toute page sans visuel dédié — sans elle, ces pages n'ont plus de carte du tout"
    );
  }
  return errors;
};

const cardsFingerprint = (cardsDir) => {
  const names = existsSync(cardsDir)
    ? readdirSync(cardsDir).filter((name) => name.endsWith('.json')).sort()
    : [];
  const digest = createHash('sha256');
  for (const name of names) {
    const data = readFileSync(path.join(cardsDir, name))
      .toString('latin1')
      .replace(/\r\n/g, '\n');
    digest.update(Buffer.from(name, 'utf8'));
    digest.update('\n');
    digest.update(Buffer.from(data, 'latin1'));
  }
  return digest.digest('hex');
};

// Lecture minimale d'un PNG : signature + premier chunk (IHDR), qui porte les
// dimensions. Aucun décodeur requis — le check reste sans dépendance.
export const readPngSize = (filePath) => {
  const buffer = readFileSync(filePath);
  if (buffer.length < 33) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

/**
 * @param {{ root?: string, quiet?: boolean }} [opts]
 * @returns {{ ok: boolean, errors: string[], assets: Array<{file: string, width: number, height: number, format: string}> }}
 */
export const runOgAssetsCheck = (opts = {}) => {
  const root = opts.root || process.cwd();
  const scriptsDir = path.join(root, 'scripts');
  const publicDir = path.join(root, 'public');
  const generatorPath = path.join(scriptsDir, GENERATOR_NAME);
  const log = opts.quiet ? () => {} : console.log;
  const logError = opts.quiet ? () => {} : console.error;

  const errors = [];
  const fail = (message) => errors.push(message);

  // Les cartes DÉCLARÉES (un fichier de données par carte) : lues UNE fois, elles
  // servent aux dimensions attendues (section 2) puis au texte que la carte
  // dessine (section 6).
  const declared = readDeclaredCards(path.join(scriptsDir, CARDS_DIR_NAME));

  // ── 1. Un seul générateur OG ──────────────────────────────────────────────
  // Toute variante de nom (gen_og_image.py, gen-og-cards.py, …) est détectée :
  // un second script signifierait deux sources de vérité pour les mêmes cartes.
  // Seuls les FICHIERS du dossier sont inspectés : le sous-dossier __tests__
  // contient les fixtures du présent garde (noms de générateurs en chaînes,
  // appels d'écriture factices) et ne doit évidemment pas se dénoncer lui-même.
  const scriptFiles = readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  const hasCanonicalGenerator = scriptFiles.includes(GENERATOR_NAME);
  if (!hasCanonicalGenerator) {
    fail(
      `générateur canonique absent : scripts/${GENERATOR_NAME} doit rester la ` +
        `source de vérité des cartes Open Graph`
    );
  }

  for (const name of scriptFiles) {
    if (name === GENERATOR_NAME) continue;

    let source = '';
    try {
      source = readFileSync(path.join(scriptsDir, name), 'utf8');
    } catch {
      // Fichier illisible (binaire, permissions) : le nom reste le seul signal.
    }

    if (nameLooksLikeOgGenerator(name)) {
      fail(          `second générateur OG détecté (${name}) : son nom annonce un ` +
          `générateur, or une seule source de vérité est autorisée, ` +
          `scripts/${GENERATOR_NAME} — un checker qui se contente de LIRE les ` +
          `cartes n'est pas concerné (il n'écrit aucune image)`
      );
      continue;
    }

    if (contentLooksLikeOgGenerator(source)) {
      fail(          `second générateur OG détecté (${name}) : ce fichier écrit une carte ` +
          `OG, or une seule source de vérité est autorisée, ` +
          `scripts/${GENERATOR_NAME} — un checker qui se contente de LIRE les ` +
          `cartes n'est pas concerné (il n'écrit aucune image)`
      );
    }
  }

  // ── 2. Manifeste lu dans le générateur ────────────────────────────────────
  const assets = [];
  if (hasCanonicalGenerator) {
    const source = readFileSync(generatorPath, 'utf8');

    const wide = source.match(/^W,\s*H\s*=\s*(\d+),\s*(\d+)\s*$/m);
    const square = source.match(/^SQUARE\s*=\s*(\d+)\s*$/m);
    // La taille/le chemin du favicon peuvent être littéraux ou passer par les
    // constantes du script (FAVICON, FAVICON_PATH) : les deux formes sont
    // acceptées, sans quoi une extraction par simple retrait de constante
    // ferait échouer le check pour de mauvaises raisons.
    const favicon =
      source.match(/make_dark_favicon\(\s*(\d+)\s*\)/) || source.match(/^FAVICON\s*=\s*(\d+)\s*$/m);
    const faviconPath =
      source.match(/os\.path\.join\(\s*OUT_DIR\s*,\s*'([^']+)',\s*'([^']+)'\s*\)/) ||
      source.match(/^FAVICON_PATH\s*=\s*os\.path\.join\('([^']+)',\s*'([^']+)'\)\s*$/m);
    if (!wide) fail(`${GENERATOR_NAME} : constante « W, H = … » introuvable`);
    if (!square) fail(`${GENERATOR_NAME} : constante « SQUARE = … » introuvable`);
    if (!favicon) fail(`${GENERATOR_NAME} : appel make_dark_favicon(<taille>) introuvable`);
    if (!faviconPath) fail(`${GENERATOR_NAME} : chemin du favicon sombre introuvable`);

    // La LISTE des cartes vient des données, les DIMENSIONS du code : chacune des
    // deux sources est lue là où elle fait autorité, et aucune n'est recopiée ici.
    for (const message of declared.errors) fail(message);
    for (const card of declared.cards) {
      if (wide) {
        assets.push({ file: card.wide, width: Number(wide[1]), height: Number(wide[2]), format: 'wide' });
      }
      if (square) {
        assets.push({
          file: card.square,
          width: Number(square[1]),
          height: Number(square[1]),
          format: 'carré',
        });
      }
    }
    if (favicon && faviconPath) {
      assets.push({
        file: `${faviconPath[1]}/${faviconPath[2]}`,
        width: Number(favicon[1]),
        height: Number(favicon[1]),
        format: 'favicon sombre',
      });
    }
  }

  // ── 3. Chaque PNG déclaré existe et respecte ses dimensions ───────────────
  const lines = [];
  for (const asset of assets) {
    const filePath = path.join(publicDir, asset.file);
    if (!existsSync(filePath)) {
      fail(`public/${asset.file} manquant (déclaré par ${GENERATOR_NAME} en ${asset.format})`);
      continue;
    }
    const size = readPngSize(filePath);
    if (!size) {
      fail(`public/${asset.file} n'est pas un PNG valide (signature ou IHDR illisible)`);
      continue;
    }
    if (size.width !== asset.width || size.height !== asset.height) {
      fail(
        `public/${asset.file} fait ${size.width}×${size.height} alors que ` +
          `${GENERATOR_NAME} déclare ${asset.width}×${asset.height} (${asset.format})`
      );
      continue;
    }
    lines.push(`  ${asset.file.padEnd(28)} ${size.width}×${size.height}  ${asset.format}`);
  }

  // ── 4. Aucun og-*.png orphelin dans public/ ──────────────────────────────
  const declaredNames = new Set(assets.map((asset) => path.basename(asset.file)));
  const orphans = readdirSync(publicDir)
    .filter((name) => /^og-.*\.png$/i.test(name))
    .filter((name) => !declaredNames.has(name))
    .sort();
  if (orphans.length > 0) {
    fail(
      `og-*.png orphelin(s) dans public/ (absents du manifeste ${GENERATOR_NAME}) : ` +
        orphans.join(', ')
    );
  }

  // ── 5. Manifeste de reproductibilité confronté aux fichiers commités ──────
  // Le générateur consigne à chaque exécution l'empreinte SHA-256 de chaque
  // carte, la sienne et les polices retenues. Ces vérifications tournent sur
  // n'importe quel runner (aucune police requise) : elles détectent la
  // divergence RÉELLE entre les PNG versionnés et ce que le générateur produit.
  const manifestPath = path.join(scriptsDir, MANIFEST_NAME);
  if (!existsSync(manifestPath)) {
    fail(
      `manifeste ${MANIFEST_NAME} absent : exécute scripts/${GENERATOR_NAME} ` +
        `puis committe le manifeste (c'est l'empreinte des cartes versionnées)`
    );
  } else {
    let manifest = null;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      fail(`${MANIFEST_NAME} illisible (JSON invalide) : ${error.message}`);
    }

    if (manifest) {
      // 5a. Le générateur n'a pas changé depuis la génération des cartes.
      if (existsSync(generatorPath)) {
        const generatorSha = generatorFingerprint(generatorPath);
        if (manifest.generator_sha256 !== generatorSha) {
          fail(
            `scripts/${GENERATOR_NAME} a changé depuis la dernière génération : ` +
              `relance-le et committe le manifeste (et les PNG s'ils bougent)`
          );
        }
      }

      // 5a-bis. Le CONTENU des cartes n'a pas changé depuis la génération.
      const cardsSha = cardsFingerprint(path.join(scriptsDir, CARDS_DIR_NAME));
      if (manifest.cards_sha256 !== cardsSha) {
        fail(
          `le contenu des cartes (${CARDS_DIR_NAME}/) a changé depuis la dernière ` +
            `génération : relance scripts/${GENERATOR_NAME} et committe le manifeste ` +
            `(et les PNG s'ils bougent)`
        );
      }

      // 5a-ter. Le texte DESSINÉ est celui de la page.
      //
      // C'est l'égalité qui rend impossible qu'une carte et sa page annoncent deux
      // textes : la carte dessine le titre et la description de la route qu'elle
      // sert, le garde recompose les lignes consignées et les compare au
      // dictionnaire. Un titre renommé sans régénérer les cartes tombe ici (et
      // non dans une impression visuelle, que personne ne joue).
      const dictionaryPath = path.join(root, DICTIONARY_PATH);
      let dictionary = null;
      try {
        dictionary = JSON.parse(readFileSync(dictionaryPath, 'utf8'));
      } catch (error) {
        fail(
          `${DICTIONARY_PATH} illisible (${error.message}) : le texte que les cartes dessinent ne ` +
            'peut pas être confronté à celui que les pages publient — or c’est la seule vérification ' +
            'qui empêche les deux de diverger'
        );
      }
      if (dictionary) {
        for (const message of checkCardTexts({ cards: declared.cards, manifest, dictionary })) {
          fail(message);
        }
      }

      // 5b. Les cartes n'ont pas été refaites avec une autre police.
      const fonts = manifest.fonts || {};
      for (const [weight, expected] of Object.entries(REFERENCE_FONTS)) {
        const recorded = fonts[weight];
        if (recorded !== expected) {
          fail(
            `cartes générées avec la police « ${recorded} » (${weight}) au lieu de la ` +
              `référence « ${expected} » : l'aspect des cartes de partage change — ` +
              `régénère sur un poste avec la police de référence, ou mets à jour ` +
              `REFERENCE_FONTS en connaissance de cause`
          );
        }
      }

      // 5c. Chaque carte commitée correspond à son empreinte.
      const entries = Array.isArray(manifest.assets) ? manifest.assets : [];
      const byFile = new Map(entries.map((entry) => [entry.file, entry]));
      for (const asset of assets) {
        const entry = byFile.get(asset.file);
        if (!entry) {
          fail(
            `${MANIFEST_NAME} ne décrit pas public/${asset.file} : manifeste ` +
              `périmé, relance scripts/${GENERATOR_NAME}`
          );
          continue;
        }
        const filePath = path.join(publicDir, asset.file);
        if (!existsSync(filePath)) continue; // déjà signalé en 3.
        const data = readFileSync(filePath);
        const sha256 = createHash('sha256').update(data).digest('hex');
        if (entry.sha256 !== sha256) {
          fail(
            `public/${asset.file} ne correspond plus au manifeste ` +
              `(empreinte ${sha256.slice(0, 12)}… ≠ ${String(entry.sha256).slice(0, 12)}…) : ` +
              `carte retouchée à la main ou non régénérée — relance ` +
              `scripts/${GENERATOR_NAME} ; pour PROUVER la reproduction exacte sur ` +
              `un poste avec la police de référence : node scripts/check-og-reproducible.js`
          );
          continue;
        }
        if (entry.bytes !== data.length) {
          fail(
            `public/${asset.file} : ${data.length} octets ≠ ${entry.bytes} annoncés par ` +
              `${MANIFEST_NAME}`
          );
        }
        if (entry.width !== asset.width || entry.height !== asset.height) {
          fail(
            `public/${asset.file} : dimensions du manifeste (${entry.width}×${entry.height}) ` +
              `≠ celles déclarées par ${GENERATOR_NAME} (${asset.width}×${asset.height})`
          );
        }
      }

      // 5d. Le manifeste ne décrit pas de carte que le générateur a abandonnée.
      if (hasCanonicalGenerator && assets.length > 0) {
        const declared = new Set(assets.map((asset) => asset.file));
        for (const entry of entries) {
          if (!declared.has(entry.file)) {
            fail(
              `${MANIFEST_NAME} décrit ${entry.file}, que ${GENERATOR_NAME} ne déclare ` +
                `plus : manifeste périmé`
            );
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    logError(`❌ Cartes Open Graph non conformes (${errors.length} problème(s)) :`);
    for (const message of errors) logError(`   • ${message}`);
    return { ok: false, errors, assets };
  }

  log(
    `Générateur unique : scripts/${GENERATOR_NAME} ` +
      `(${scriptFiles.length} fichiers inspectés, ${assets.length} PNG déclarés)`
  );
  log(lines.join('\n'));
  log(
    `✅ Cartes Open Graph verrouillées : 1 seul générateur, ${assets.length} PNG aux ` +
      `dimensions déclarées, empreintes conformes à ${MANIFEST_NAME}, aucun orphelin`
  );
  return { ok: true, errors, assets };
};

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = runOgAssetsCheck();
  if (!result.ok) process.exit(1);
}
