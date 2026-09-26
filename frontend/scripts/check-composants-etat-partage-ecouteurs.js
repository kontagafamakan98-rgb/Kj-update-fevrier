#!/usr/bin/env node
/**
 * GARDE-FOU CI : Détection des composants à état partagé dont les écouteurs globaux
 * dépendent d'une référence d'instance locale (fermeture de la classe de bug du panneau de notifications).
 *
 * ── Pourquoi ce garde existe ────────────────────────────────────────────────
 * Une surface pilotée par un contexte partagé (ex: `useNotifications`) et montée
 * plusieurs fois (ex: barres desktop et mobile) ne doit JAMAIS écouter les événements
 * globaux (`document.addEventListener('mousedown', ...)`) en vérifiant seulement
 * son conteneur local `ref.current.contains(...)`.
 *
 * Sinon, l'instance masquée reçoit l'événement, constate que le clic n'est pas chez elle,
 * et déclenche l'action de fermeture partagée PENDANT que l'utilisateur clique sur le bouton
 * de l'instance visible, démontant le DOM en plein vol.
 *
 * Usage :
 *   node scripts/check-composants-etat-partage-ecouteurs.js [--src <chemin>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyserDossierSource, MIN_FICHIERS_LUS } from './composants-etat-partage-ecouteurs.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(ICI, '..');

const argSrcIdx = process.argv.indexOf('--src');
const DOSSIER_SRC = argSrcIdx > -1 && process.argv[argSrcIdx + 1]
  ? path.resolve(process.argv[argSrcIdx + 1])
  : path.join(FRONTEND_DIR, 'src');

export function executerVerification(dossierSrc = DOSSIER_SRC) {
  if (!fs.existsSync(dossierSrc)) {
    throw new Error(`Dossier source introuvable : ${dossierSrc}`);
  }

  const { fichiersLus, resultats } = analyserDossierSource(dossierSrc);

  if (fichiersLus < MIN_FICHIERS_LUS) {
    throw new Error(
      `Nombre de fichiers analysés insuffisant (${fichiersLus} < ${MIN_FICHIERS_LUS}) : ` +
      `le vérificateur n'a pas lu son sujet.`
    );
  }

  return { fichiersLus, resultats };
}

function main() {
  let rapport;
  try {
    rapport = executerVerification();
  } catch (err) {
    console.error(`❌ Échec de la vérification : ${err.message}`);
    process.exit(1);
  }

  const { fichiersLus, resultats } = rapport;

  if (resultats.length > 0) {
    console.error(
      `❌ ${resultats.length} composant(s) à état partagé avec écouteur dépendant d'une ref locale détecté(s) :`
    );
    for (const res of resultats) {
      console.error(`\n• [${res.fichier}] Composant <${res.nomComposant}> (instancié ${res.occurrences} fois) :`);
      for (const v of res.violations) {
        console.error(`  - Ligne ${v.ligne} (${v.evenement}) : ${v.message}`);
      }
    }
    console.error(
      `\nRemède : rattacher l'écouteur à une ancre partagée (DOM global data-* ou contexte) ` +
      `ou unifier le composant pour qu'il ne soit monté qu'une seule fois.`
    );
    process.exit(1);
  }

  console.log(
    `✅ Aucun composant à état partagé n'a d'écouteur dépendant d'une référence locale (${fichiersLus} fichiers analysés).`
  );
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('check-composants-etat-partage-ecouteurs.js')) {
  main();
}
