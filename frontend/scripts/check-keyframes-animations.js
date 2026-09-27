#!/usr/bin/env node
/**
 * GARDE-FOU CI : toute `@keyframes` est JOUÉE, et toute animation JOUÉE est
 * DÉCLARÉE — dans la source de l'application.
 *
 * La règle est dans `scripts/keyframes-animations.js` ; la preuve d'échec dans
 * `scripts/__tests__/check-keyframes-animations.test.js`. Ce fichier-ci lit
 * `src/`, appelle la règle et sort : c'est le bras de la CI.
 *
 * Il n'exige AUCUN build : il lit la source, donc il rougit sur une
 * `@keyframes` orpheline bien avant qu'un build ne la publie — et sur un
 * `animation: nom` dont la déclaration a disparu, qui est le cas SILENCIEUX
 * (un `@keyframes` manquant n'est pas une erreur pour un navigateur : l'animation
 * ne tourne plus, rien ne l'annonce).
 *
 * Pourquoi ce garde lit le JAVASCRIPT et pas seulement le CSS : sur cet arbre,
 * les seules `@keyframes` vivent dans des littéraux de gabarit de composants
 * (`ToastContainer.js`, `serviceWorkerRegistration.js`) et les seuls usages sont
 * des objets de style JSX et un `cssText`. Un lecteur CSS seul ne trouverait
 * NI l'un NI l'autre, et rendrait un vert VIDE — le faux vert que le module
 * `keyframes-animations.js` détaille.
 *
 * Usage :
 *   node scripts/check-keyframes-animations.js [--racine <chemin>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSIONS, analyserSources, CE_QUE_CE_GARDE_VOIT } from './keyframes-animations.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(ICI, '..');

// Planchers de LECTURE : sous ces nombres, le garde refuse de juger — un `src/`
// déplacé ou un décodeur cassé ne doit pas passer pour un « aucun écart ». Relevé
// du 27/09/2026 : 182 fichiers `.css`/`.js`/`.jsx` sous `src/`, 2 `@keyframes`
// (toutes deux dans un gabarit JavaScript) et 2 usages (tous deux en JavaScript).
const MIN_FICHIERS = 120;
const MIN_DECLARATIONS = 1;
const MIN_REFERENCES = 1;

/** Les fichiers de `src/` jugés, en clair, chemins relatifs à la racine. */
export function fichiersSources(racine = FRONTEND_DIR) {
  const src = path.join(racine, 'src');
  const sortie = [];
  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const complet = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        parcourir(complet);
        continue;
      }
      if (!EXTENSIONS.some((suffixe) => entree.name.endsWith(suffixe))) continue;
      sortie.push({
        chemin: path.relative(racine, complet).replace(/\\/g, '/'),
        texte: fs.readFileSync(complet, 'utf8'),
      });
    }
  };
  parcourir(src);
  return sortie;
}

/**
 * L'audit complet, avec ses planchers.
 *
 * @param {string} [racine] Racine du frontend (contient `src/`).
 * @returns {object} Le rapport de `analyserSources`, plus `fichiersLus`.
 */
export function executerVerification(racine = FRONTEND_DIR) {
  const src = path.join(racine, 'src');
  if (!fs.existsSync(src)) {
    throw new Error(
      `dossier \`src/\` introuvable sous « ${racine} » — un garde qui n'a rien lu n'a rien vérifié`
    );
  }

  const fichiers = fichiersSources(racine);
  if (fichiers.length < MIN_FICHIERS) {
    throw new Error(
      `Fichiers jugés insuffisants (${fichiers.length} < ${MIN_FICHIERS}) : ` +
        `le balayage n'a pas lu son sujet — refus de juger.`
    );
  }

  const rapport = { ...analyserSources({ fichiers }), fichiersLus: fichiers.length };
  if (rapport.declarations.length < MIN_DECLARATIONS || rapport.references.length < MIN_REFERENCES) {
    throw new Error(
      `Lecture vide (${rapport.declarations.length} déclaration(s), ${rapport.references.length} usage(s)) — ` +
        `planchers ${MIN_DECLARATIONS} et ${MIN_REFERENCES} : le décodeur n'a pas lu son sujet. ` +
        `Un vert sans lecture est un faux vert.`
    );
  }
  return rapport;
}

function main() {
  const argRacine = process.argv.indexOf('--racine');
  const racine =
    argRacine > -1 && process.argv[argRacine + 1]
      ? path.resolve(process.argv[argRacine + 1])
      : FRONTEND_DIR;

  let rapport;
  try {
    rapport = executerVerification(racine);
  } catch (err) {
    console.error(`❌ Échec de la vérification : ${err.message}`);
    process.exit(1);
  }

  const { declarations, references, jamaisJouees, jamaisDeclarees, illisibles, fichiersLus } = rapport;

  const refus = [];
  if (jamaisJouees.length > 0) {
    refus.push(
      `${jamaisJouees.length} \`@keyframes\` DÉCLARÉE(S) ET JAMAIS JOUÉE(S) (poids mort) :\n` +
        jamaisJouees.map((e) => `  • ${e.chemin}:${e.ligne} — @keyframes ${e.nom}`).join('\n')
    );
  }
  if (jamaisDeclarees.length > 0) {
    refus.push(
      `${jamaisDeclarees.length} ANIMATION(S) JOUÉE(S) ET DÉCLARÉE(S) NULLE PART (l'animation ne tourne plus, en silence) :\n` +
        jamaisDeclarees.map((e) => `  • ${e.chemin}:${e.ligne} — animation ${e.nom}`).join('\n')
    );
  }
  if (illisibles.length > 0) {
    refus.push(
      `${illisibles.length} fichier(s) ILLISIBLE(S) — un fichier qu'on ne sait pas lire n'est pas un fichier propre :\n` +
        illisibles.map((chemin) => `  • ${chemin}`).join('\n')
    );
  }

  if (refus.length > 0) {
    console.error(`❌ @keyframes et animations : ${refus.join('\n')}`);
    console.error(
      `\nRemède : une \`@keyframes\` déclarée doit être JOUÉE (sinon la retirer), et une animation jouée doit ` +
        `être DÉCLARÉE (sinon l'écrire — un \`@keyframes\` manquant ne fait rougir aucun navigateur, ` +
        `c'est un silence).`
    );
    process.exit(1);
  }

  console.log(
    `✅ @keyframes jouées et animations déclarées : ${fichiersLus} fichier(s) de \`src/\` jugé(s), ` +
      `${declarations.length} déclaration(s) et ${references.length} usage(s) lus — ` +
      `${CE_QUE_CE_GARDE_VOIT.voit.length} chose(s) refusée(s), ${CE_QUE_CE_GARDE_VOIT.nePeutPasVoir.length} angle(s) mort(s) assumé(s).`
  );
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('check-keyframes-animations.js')) {
  main();
}
