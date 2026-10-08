#!/usr/bin/env node
/**
 * GARDE-FOU CI : le levier `content-visibility` du formulaire de /register reste
 * en parité entre les deux canaux, avec ses constantes de hauteur de contenu.
 *
 * La règle est dans `scripts/formulaire-differe.js` (et sa preuve d'échec dans
 * `scripts/__tests__/check-formulaire-differe.test.js`). Ce fichier-ci ne fait
 * que lire, appeler et sortir : c'est le bras de la CI.
 *
 * Usage :
 *   node scripts/check-formulaire-differe.js [--racine <chemin>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyserFormulaireDiffere, CANAUX, FEUILLE } from './formulaire-differe.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(ICI, '..');

// Plancher de lecture : sous ce nombre d'octets, le garde refuse de juger —
// il n'a pas lu son sujet (un fichier tronqué n'est pas un fichier sans faute).
const MIN_OCTETS = 2_000;

export function executerVerification(racine = FRONTEND_DIR) {
  const lire = (chemin) => {
    const complet = path.join(racine, chemin);
    if (!fs.existsSync(complet)) {
      throw new Error(`Fichier introuvable : ${chemin} — le garde n'a pas lu son sujet.`);
    }
    const texte = fs.readFileSync(complet, 'utf8');
    if (texte.length < MIN_OCTETS) {
      throw new Error(`${chemin} fait ${texte.length} octets (< ${MIN_OCTETS}) : lecture suspecte, refus de juger.`);
    }
    return texte;
  };

  const feuille = lire(FEUILLE);
  const canaux = CANAUX.map((canal) => ({ nom: canal.nom, texte: lire(canal.chemin) }));
  return analyserFormulaireDiffere({ feuille, canaux });
}

function main() {
  const argRacine = process.argv.indexOf('--racine');
  const racine =
    argRacine > -1 && process.argv[argRacine + 1]
      ? path.resolve(process.argv[argRacine + 1])
      : FRONTEND_DIR;

  let problemes;
  try {
    problemes = executerVerification(racine);
  } catch (err) {
    console.error(`❌ Échec de la vérification : ${err.message}`);
    process.exit(1);
  }

  if (problemes.length > 0) {
    console.error(`❌ ${problemes.length} problème(s) sur le levier différé de /register :`);
    for (const probleme of problemes) console.error(`  • ${probleme}`);
    console.error(
      `\nRemède : poser la même classe « bloc-differe-* » dans ${CANAUX.map((c) => c.chemin).join(' ET ')} ` +
        `et lui donner une « contain-intrinsic-size: auto <hauteur de contenu>px » dans ${FEUILLE}.`
    );
    process.exit(1);
  }

  console.log('✅ Le levier différé de /register est en parité (4 blocs, deux canaux, constantes présentes).');
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('check-formulaire-differe.js')) {
  main();
}
