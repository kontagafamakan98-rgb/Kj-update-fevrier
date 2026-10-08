#!/usr/bin/env node
/**
 * GARDE-FOU CI : aucun emoji de drapeau dans la source de l'application, et le
 * champ `flag` des données pays/langue/géolocalisation ne revient pas.
 *
 * La règle est dans `scripts/drapeaux-emoji.js` ; la preuve d'échec dans
 * `scripts/__tests__/check-drapeaux-emoji.test.js`. Ce fichier-ci lit `src/`,
 * appelle la règle et sort : c'est le bras de la CI.
 *
 * Il n'exige AUCUN build : il lit la source, donc il rougit sur un `flag: '🇲🇱'`
 * recopié bien avant que quiconque ne construise la coquille qui le publierait.
 *
 * Usage :
 *   node scripts/check-drapeaux-emoji.js [--racine <chemin>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyserSources,
  CE_QUE_CE_GARDE_VOIT,
  EXTENSIONS,
  MODULES_DONNEES,
} from './drapeaux-emoji.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(ICI, '..');

// Plancher de LECTURE : sous ce nombre de fichiers jugés, le garde refuse de
// juger — un `src/` déplacé ou un balayage cassé ne doit pas passer pour un
// « aucun emoji trouvé ». Relevé du 27/09/2026 : 178 fichiers `.js`/`.jsx`/
// `.json` sous `src/`.
const MIN_FICHIERS = 120;

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
  // Chaque module de données déclaré doit EXISTER : un module disparu
  // rétrécirait le garde en silence, et le champ `flag` pourrait revenir là.
  for (const module of MODULES_DONNEES) {
    if (!fs.existsSync(path.join(racine, module.chemin))) {
      throw new Error(
        `Module de données introuvable : ${module.chemin} — le garde ne surveille plus son sujet (${module.pourquoi}).`
      );
    }
  }

  const fichiers = fichiersSources(racine);
  if (fichiers.length < MIN_FICHIERS) {
    throw new Error(
      `Fichiers jugés insuffisants (${fichiers.length} < ${MIN_FICHIERS}) : ` +
        `le balayage n’a pas lu son sujet — refus de juger.`
    );
  }

  return { ...analyserSources({ fichiers }), fichiersLus: fichiers.length };
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

  const { emoji, champsFlag, illisibles, fichiersLus } = rapport;

  const refus = [];
  if (emoji.length > 0) {
    refus.push(
      `${emoji.length} EMOJI DE DRAPEAU dans le code :\n` +
        emoji.map((e) => `  • ${e.chemin}:${e.ligne}`).join('\n')
    );
  }
  if (champsFlag.length > 0) {
    refus.push(
      `${champsFlag.length} champ(s) \`flag\` dans les données :\n` +
        champsFlag.map((e) => `  • ${e.chemin}:${e.ligne}`).join('\n')
    );
  }
  if (illisibles.length > 0) {
    refus.push(
      `${illisibles.length} fichier(s) ILLISIBLE(S) — un fichier qu’on ne sait pas lire n’est pas un fichier propre :\n` +
        illisibles.map((chemin) => `  • ${chemin}`).join('\n')
    );
  }

  if (refus.length > 0) {
    console.error(`❌ Drapeaux et données pays : ${refus.join('\n')}`);
    console.error(
      `\nRemède : un drapeau est un DESSIN du registre (\`src/config/flags.js\`), jamais un caractère — rendre ` +
        `\`IconeDrapeau\` / \`svgDuDrapeau\` au lieu d’écrire l’emoji. Et ne pas remettre de champ \`flag\` dans les ` +
        `modules de données (${MODULES_DONNEES.map((m) => m.chemin).join(', ')}) : ce champ était une seconde ` +
        `peinture, dépendante de la police du visiteur.`
    );
    process.exit(1);
  }

  console.log(
    `✅ Aucun emoji de drapeau ni champ \`flag\` : ${fichiersLus} fichier(s) de \`src/\` jugé(s), ` +
      `${MODULES_DONNEES.length} module(s) de données surveillé(s) — ${CE_QUE_CE_GARDE_VOIT.voit.length} chose(s) refusée(s), ` +
      `${CE_QUE_CE_GARDE_VOIT.nePeutPasVoir.length} angle(s) mort(s) assumé(s).`
  );
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('check-drapeaux-emoji.js')) {
  main();
}
