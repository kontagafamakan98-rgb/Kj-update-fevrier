import fs from 'fs';
import { FICHIER_DES_MESURES } from './helpers/moteurs.js';

/**
 * UNE EXÉCUTION, UN FICHIER DE RELEVÉS.
 *
 * Les mesures sont écrites en fin de fichier par les processus de travail, qui
 * ne peuvent pas se parler (un processus par projet Playwright) : le tableau des
 * écarts se reconstitue donc en relisant ce fichier APRÈS la suite. Encore
 * faut-il qu'il ne porte que les relevés de CETTE exécution — un fichier hérité
 * d'une exécution précédente ferait apparaître des mesures que personne n'a
 * prises, et le tableau des écarts comparerait deux exécutions au lieu de deux
 * moteurs.
 *
 * Playwright vide déjà `test-results/` au début d'une exécution, mais s'y fier
 * seul serait une invariante non écrite : la suppression est donc explicite, et
 * ce fichier ne fait que ça.
 */
export default function globalSetup() {
  try {
    fs.rmSync(FICHIER_DES_MESURES, { force: true });
  } catch (erreur) {
    console.log(`⚠️  relevés de l'exécution précédente non effacés : ${erreur.message}`);
  }
}
