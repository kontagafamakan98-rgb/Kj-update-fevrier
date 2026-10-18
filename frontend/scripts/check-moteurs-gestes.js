#!/usr/bin/env node
/**
 * GARDE-FOU CI : le périmètre des projets `firefox` et `webkit` de Playwright.
 *
 * Ce que ce garde refuse (le détail des règles est dans `scripts/moteurs-gestes.js`) :
 * un parcours qui MESURE UN GESTE sans être rejoué sur les trois moteurs, un
 * parcours rejoué qui ne PUBLIE rien, une déclaration que la source démentit, deux
 * périmètres différents entre moteurs, ou une CI qui n'installe plus les trois
 * binaires.
 *
 * Pourquoi il n'est pas un commentaire dans `playwright.config.js` : la liste
 * « qui mérite trois moteurs » y vivait, et rien n'aurait rougi si un parcours de
 * geste ajouté demain en était resté dehors.
 *
 * Usage :
 *   node scripts/check-moteurs-gestes.js [--frontend <dossier>] [--ci <fichier>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_SPECS,
  PARCOURS_DE_GESTE,
  parcoursDetectes,
  refusDuPerimetreMoteurs,
} from './moteurs-gestes.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(ICI, '..');

function argument(nom, defaut) {
  const index = process.argv.indexOf(nom);
  return index > -1 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : defaut;
}

const DOSSIER_FRONTEND = argument('--frontend', FRONTEND_DIR);
const FICHIER_CI = argument('--ci', path.join(DOSSIER_FRONTEND, '..', '.github', 'workflows', 'ci.yml'));

/** Lit les sources du périmètre (toute l'I/O du garde est ici). */
export function lireLesSources({ dossierFrontend = DOSSIER_FRONTEND, fichierCi = FICHIER_CI } = {}) {
  const dossierSpecs = path.join(dossierFrontend, 'e2e');
  if (!fs.existsSync(dossierSpecs)) {
    throw new Error(`Dossier des parcours introuvable : ${dossierSpecs}`);
  }
  if (!fs.existsSync(fichierCi)) {
    throw new Error(`Workflow de CI introuvable : ${fichierCi}`);
  }
  const config = fs.readFileSync(path.join(dossierFrontend, 'playwright.config.js'), 'utf8');
  const ci = fs.readFileSync(fichierCi, 'utf8');
  const fichiers = fs
    .readdirSync(dossierSpecs)
    .filter((nom) => nom.endsWith('.spec.js'))
    .sort();
  const specs = fichiers.map((fichier) => ({
    fichier,
    source: fs.readFileSync(path.join(dossierSpecs, fichier), 'utf8'),
  }));
  if (specs.length < MIN_SPECS) {
    throw new Error(
      `Nombre de parcours lus insuffisant (${specs.length} < ${MIN_SPECS}) : le garde n'a pas lu son sujet.`
    );
  }
  return { config, ci, specs };
}

/**
 * Le verdict : `{ refus, detectes, couverts, fichiersLus }`.
 *
 * @param {{dossierFrontend?: string, fichierCi?: string}} [options]
 */
export function executerVerification(options = {}) {
  const sources = lireLesSources(options);
  const detectes = parcoursDetectes(sources.specs);
  return {
    refus: refusDuPerimetreMoteurs(sources),
    detectes,
    // Le `testMatch` ne couvre que les REJOUÉS : c'est donc eux que le compte du
    // journal doit nommer, sinon un vert dirait « 5 parcours » en mesurant 3.
    registre: PARCOURS_DE_GESTE.filter(({ horsPerimetre }) => !horsPerimetre).map(({ fichier }) => fichier),
    exclus: PARCOURS_DE_GESTE.filter(({ horsPerimetre }) => horsPerimetre).map(
      ({ fichier, horsPerimetre }) => `${fichier} (${horsPerimetre})`
    ),
    fichiersLus: sources.specs.length,
    gestesDetectes: detectes.map(({ fichier, gestes }) => `${fichier} (${gestes.join(', ')})`),
  };
}

function main() {
  let rapport;
  try {
    rapport = executerVerification();
  } catch (erreur) {
    console.error(`❌ Échec de la vérification : ${erreur.message}`);
    process.exit(1);
  }

  if (rapport.refus.length > 0) {
    console.error('❌ Le périmètre multi-moteurs est rompu :');
    for (const refus of rapport.refus) console.error(`  • ${refus}`);
    process.exit(1);
  }

  const couverts = rapport.registre.join(', ');
  console.log(
    `::notice::périmètre multi-moteurs : ${rapport.registre.length} parcours rejoués sur chromium, firefox et webkit ` +
      `(${couverts}) ; ${rapport.fichiersLus} parcours lus, dont ${rapport.detectes.length} portent un geste de bas ` +
      `niveau : ${rapport.gestesDetectes.join(' · ')}`
  );
  console.log(
    `✅ Les trois moteurs couvrent le même périmètre (${rapport.registre.length} parcours), et chaque parcours du ` +
      'périmètre publie ses mesures.'
  );
  // Les exclusions sont PUBLIÉES : un silence sur ce qui n'est PAS mesuré est
  // exactement ce que ce garde existe pour empêcher.
  if (rapport.exclus.length) {
    console.log(`⚠️  Hors périmètre, avec leur raison (${rapport.exclus.length}) : ${rapport.exclus.join(' · ')}`);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
