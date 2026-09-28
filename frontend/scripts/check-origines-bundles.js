#!/usr/bin/env node
/**
 * GARDE-FOU CI : aucune origine TIERCE dans les fichiers LIVRÉS (JS et CSS), et
 * chaque occurrence légitime classée avec son motif.
 *
 * La règle et le classement sont dans `scripts/origines-bundles.js` ; la preuve
 * d'échec dans `scripts/__tests__/check-origines-bundles.test.js`. Ce fichier-ci
 * lit le build, appelle la règle et sort : c'est le bras de la CI.
 *
 * Il lit `build/assets/` — le dossier que Vite écrit — et rien d'autre : le HTML
 * des coquilles appartient à `check-shell-remote-resources.js`. Deux sujets, deux
 * gardes, aucune recopie.
 *
 * Usage :
 *   node scripts/check-origines-bundles.js [--racine <chemin>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyserOriginesLivrees,
  CLASSEMENT_ORIGINES,
  SORTES,
} from './origines-bundles.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(ICI, '..');

// Planchers de LECTURE : sous ceux-là, le garde refuse de juger — il n'a pas lu
// son sujet (un dossier vide, un build absent, un lecteur cassé). Relevé du
// 27/09/2026 sur un build de production : 62 fichiers livrés, 40 occurrences,
// 3 origines nôtres et 14 origines tierces classées (le chunk `/mobile-test`
// n'étant plus émis, la ligne `picsum.photos` a été retirée du classement).
const MIN_FICHIERS = 8;
const MIN_OCCURRENCES = 12;
const MIN_CLASSEES = 8;

/** Les fichiers JS/CSS livrés du build, en clair. */
export function fichiersLivres(racine = FRONTEND_DIR) {
  const sortie = [];
  for (const dossier of ['assets', '.']) {
    const complet = path.join(racine, 'build', dossier);
    if (!fs.existsSync(complet) || !fs.statSync(complet).isDirectory()) continue;
    for (const nom of fs.readdirSync(complet)) {
      const fichier = path.join(complet, nom);
      if (!fs.statSync(fichier).isFile() || !/\.(js|css)$/.test(nom)) continue;
      sortie.push({
        chemin: path.relative(path.join(racine, 'build'), fichier).replace(/\\/g, '/'),
        texte: fs.readFileSync(fichier, 'utf8'),
      });
    }
  }
  // `build/assets/` porte déjà tout le JS/CSS : `build/.` n'ajoute que d'éventuels
  // restes à la racine. On dédoublonne par chemin pour ne pas compter deux fois.
  const vus = new Set();
  return sortie.filter((f) => (vus.has(f.chemin) ? false : vus.add(f.chemin)));
}

/**
 * L'audit complet, avec ses planchers.
 *
 * @param {string} [racine] Racine du frontend (contient `build/`).
 * @returns {object} Le rapport de `analyserOriginesLivrees`, plus `fichiersLus`.
 */
export function executerVerification(racine = FRONTEND_DIR) {
  const fichiers = fichiersLivres(racine);
  if (fichiers.length < MIN_FICHIERS) {
    throw new Error(
      `Fichiers livrés insuffisants (${fichiers.length} < ${MIN_FICHIERS}) : ` +
        `aucun build à auditer, ou le lecteur de build/assets est cassé — refus de juger.`
    );
  }

  const rapport = analyserOriginesLivrees({ fichiers });

  if (rapport.occurrences < MIN_OCCURRENCES) {
    throw new Error(
      `Occurrences d’URL absolue insuffisantes (${rapport.occurrences} < ${MIN_OCCURRENCES}) : ` +
        `le balayage n’a pas lu son sujet — refus de juger.`
    );
  }
  if (rapport.classees.length < MIN_CLASSEES) {
    throw new Error(
      `Origines classées insuffisantes (${rapport.classees.length} < ${MIN_CLASSEES}) : ` +
        `le classement n’a presque rien reconnu — refus de juger.`
    );
  }

  return { ...rapport, fichiersLus: fichiers.length };
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

  const { notres, classees, nonClassees, perimees, occurrences, fichiersLus } = rapport;

  for (const entree of classees) {
    console.log(
      `ℹ️  CLASSÉE ${entree.origine} — ${entree.sorte} · ${entree.occurrences} occurrence(s) ` +
        `dans ${entree.fichiers.length} fichier(s) — « ${entree.motif} » (preuve : ${entree.preuve})`
    );
  }
  for (const entree of notres) {
    console.log(`ℹ️  NÔTRE   ${entree.origine} — ${entree.occurrences} occurrence(s) dans ${entree.fichiers.length} fichier(s)`);
  }

  const refus = [];
  if (nonClassees.length > 0) {
    refus.push(
      `${nonClassees.length} origine(s) TIERCE(S) non classée(s) :\n` +
        nonClassees
          .map(
            (e) =>
              `  • ${e.origine} — ${e.occurrences} occurrence(s) dans ${e.fichiers.join(', ')}\n` +
              `      ex. : ${e.exemples.join(' · ')}`
          )
          .join('\n')
    );
  }
  if (perimees.length > 0) {
    refus.push(
      `${perimees.length} entrée(s) PÉRIMÉE(S) du classement (aucun fichier livré ne les porte plus) :\n` +
        perimees.map((e) => `  • ${e.origine}${e.motif ? '' : ' — motif VIDE'}`).join('\n')
    );
  }

  if (refus.length > 0) {
    console.error(`❌ Origines des fichiers livrés : ${refus.join('\n')}`);
    console.error(
      `\nRemède : pour chaque origine TIERCE, écrire POURQUOI elle a le droit d’être dans un fichier livré ` +
        `dans CLASSEMENT_ORIGINES (${SORTES.IDENTIFIANT} / ${SORTES.MESSAGE} / ${SORTES.LIEN} / ` +
        `${SORTES.APRES_INTERACTION} / ${SORTES.CONDITIONNEL}) avec sa preuve ; si elle est vraiment chargée ` +
        `par le navigateur, la retirer du bundle. Et RETIRER une entrée périmée : une exemption que plus ` +
        `rien ne justifie finira par justifier autre chose.`
    );
    process.exit(1);
  }

  console.log(
    `✅ Aucune origine tierce non classée : ${fichiersLus} fichier(s) livrés, ${occurrences} occurrence(s) ` +
      `d’URL absolue, ${notres.length} origine(s) nôtre(s), ${classees.length} origine(s) tierce(s) ` +
      `classée(s) sur ${CLASSEMENT_ORIGINES.length} entrée(s) de classement.`
  );
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('check-origines-bundles.js')) {
  main();
}
