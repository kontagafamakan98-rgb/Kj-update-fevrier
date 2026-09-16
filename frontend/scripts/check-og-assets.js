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
 *      génération finissent toujours par produire des cartes divergentes ;
 *   2. lit le MANIFESTE DANS le générateur lui-même (dimensions des formats
 *      wide/carré, pages couvertes, taille du favicon) : aucune constante
 *      n'est dupliquée ici, donc le check ne peut pas diverger du script ;
 *   3. vérifie que chaque PNG attendu existe, est un VRAI PNG (signature +
 *      chunk IHDR) et porte EXACTEMENT les dimensions déclarées ;
 *   4. refuse tout og-*.png ORPHELIN dans public/ (présent mais absent du
 *      manifeste) : c'est un reliquat que le générateur ne sait pas reproduire.
 *
 * Usage : cd frontend && node scripts/check-og-assets.js
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const GENERATOR_NAME = 'gen-og-images.py';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Les clés d'un dictionnaire Python de premier niveau sont indentées de 4
// espaces ; le bloc s'ouvre sur « Nom = { » en colonne 0 et se ferme sur une
// accolade en colonne 0 (ancrage ligne pour ne pas confondre VARIANTS avec
// SQUARE_VARIANTS, qui contient la même sous-chaîne).
export const blockKeys = (source, blockName) => {
  const open = source.match(new RegExp(`^${blockName} = \\{`, 'm'));
  if (!open) return null;
  const rest = source.slice(open.index);
  const end = rest.indexOf('\n}');
  const block = end === -1 ? rest : rest.slice(0, end);
  return [...block.matchAll(/^\s{4}"([^"]+\.png)":/gm)].map((match) => match[1]);
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

  // ── 1. Un seul générateur OG ──────────────────────────────────────────────
  // Toute variante de nom (gen_og_image.py, gen-og-cards.py, …) est détectée :
  // un second script signifierait deux sources de vérité pour les mêmes cartes.
  const ogGenerators = readdirSync(scriptsDir)
    .filter((name) => /^gen[-_]?og.*\.py$/i.test(name))
    .sort();

  if (!ogGenerators.includes(GENERATOR_NAME)) {
    fail(
      `générateur canonique absent : scripts/${GENERATOR_NAME} doit rester la ` +
        `source de vérité des cartes Open Graph`
    );
  }
  const extraGenerators = ogGenerators.filter((name) => name !== GENERATOR_NAME);
  if (extraGenerators.length > 0) {
    fail(
      `second générateur OG détecté (${extraGenerators.join(', ')}) : ` +
        `une seule source de vérité est autorisée, scripts/${GENERATOR_NAME}`
    );
  }

  // ── 2. Manifeste lu dans le générateur ────────────────────────────────────
  const assets = [];
  if (ogGenerators.includes(GENERATOR_NAME)) {
    const source = readFileSync(generatorPath, 'utf8');

    const wide = source.match(/^W,\s*H\s*=\s*(\d+),\s*(\d+)\s*$/m);
    const square = source.match(/^SQUARE\s*=\s*(\d+)\s*$/m);
    const favicon = source.match(/make_dark_favicon\((\d+)\)/);
    const faviconPath = source.match(/os\.path\.join\(OUT_DIR,\s*'([^']+)',\s*'([^']+)'\)/);
    const widePages = blockKeys(source, 'VARIANTS');
    const squarePages = blockKeys(source, 'SQUARE_VARIANTS');

    if (!wide) fail(`${GENERATOR_NAME} : constante « W, H = … » introuvable`);
    if (!square) fail(`${GENERATOR_NAME} : constante « SQUARE = … » introuvable`);
    if (!favicon) fail(`${GENERATOR_NAME} : appel make_dark_favicon(<taille>) introuvable`);
    if (widePages === null) fail(`${GENERATOR_NAME} : dictionnaire VARIANTS introuvable`);
    if (squarePages === null) fail(`${GENERATOR_NAME} : dictionnaire SQUARE_VARIANTS introuvable`);
    if (!faviconPath) fail(`${GENERATOR_NAME} : chemin du favicon sombre introuvable`);

    if (wide && widePages) {
      for (const file of widePages) {
        assets.push({ file, width: Number(wide[1]), height: Number(wide[2]), format: 'wide' });
      }
    }
    if (square && squarePages) {
      for (const file of squarePages) {
        assets.push({ file, width: Number(square[1]), height: Number(square[1]), format: 'carré' });
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

  if (errors.length > 0) {
    logError(`❌ Cartes Open Graph non conformes (${errors.length} problème(s)) :`);
    for (const message of errors) logError(`   • ${message}`);
    return { ok: false, errors, assets };
  }

  log(`Générateur unique : scripts/${GENERATOR_NAME} (${assets.length} PNG déclarés)`);
  log(lines.join('\n'));
  log(
    `✅ Cartes Open Graph verrouillées : 1 seul générateur, ${assets.length} PNG aux ` +
      `dimensions déclarées, aucun og-*.png orphelin dans public/`
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
