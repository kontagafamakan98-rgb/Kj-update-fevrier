#!/usr/bin/env node
/**
 * GARDE-FOU CI : Détection des contrôles interactifs qu'un changement d'état
 * déclenché PENDANT l'appui démonte avant que le `click` n'arrive (autre moitié
 * de la classe de bug du panneau de notifications).
 *
 * ── Pourquoi ce garde existe ────────────────────────────────────────────────
 * Sur appareil tactile comme à la souris, l'appui précède le `click` :
 *
 *     pointerdown → touchstart → touchend → mousedown → mouseup → click
 *
 * Un `setState` dans `onMouseDown` / `onPointerDown` / `onTouchStart` qui retire
 * l'élément pressé du DOM (fermeture d'une surface, bascule, retour anticipé)
 * supprime l'élément AVANT le `click` : l'action portée par `onClick` ne part
 * jamais. C'est le symptôme « je clique et rien ne se passe ».
 *
 * La première moitié du défaut (écouteur global dépendant d'une ref locale) est
 * couverte par `check-composants-etat-partage-ecouteurs.js` ; ce garde balaie
 * TOUS les contrôles interactifs de `src/` pour la seconde moitié.
 *
 * Usage :
 *   node scripts/check-appui-demontage-controles.js [--src <chemin>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyserDossierSource,
  MIN_FICHIERS_LUS,
  MIN_CONTROLES_ANALYSES,
} from './appui-demontage-controles.js';

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

  const { fichiersLus, controlesAnalyses, resultats } = analyserDossierSource(dossierSrc);

  if (fichiersLus < MIN_FICHIERS_LUS) {
    throw new Error(
      `Nombre de fichiers analysés insuffisant (${fichiersLus} < ${MIN_FICHIERS_LUS}) : ` +
      `le vérificateur n'a pas lu son sujet.`
    );
  }

  if (controlesAnalyses < MIN_CONTROLES_ANALYSES) {
    throw new Error(
      `Nombre de contrôles interactifs analysés insuffisant (${controlesAnalyses} < ${MIN_CONTROLES_ANALYSES}) : ` +
      `le vérificateur n'a pas balayé les contrôles de l'application.`
    );
  }

  return { fichiersLus, controlesAnalyses, resultats };
}

function main() {
  let rapport;
  try {
    rapport = executerVerification();
  } catch (err) {
    console.error(`❌ Échec de la vérification : ${err.message}`);
    process.exit(1);
  }

  const { fichiersLus, controlesAnalyses, resultats } = rapport;

  if (resultats.length > 0) {
    console.error(
      `❌ ${resultats.length} composant(s) avec au moins un contrôle démonté pendant l'appui détecté(s) :`
    );
    for (const res of resultats) {
      console.error(`\n• [${res.fichier}] Composant <${res.nomComposant}> :`);
      for (const v of res.violations) {
        console.error(`  - Ligne ${v.ligne} : ${v.message}`);
      }
    }
    console.error(
      `\nRemède : ne pas changer d'état qui démonte le contrôle dans un gestionnaire d'appui ` +
      `('onMouseDown'/'onPointerDown'/'onTouchStart'). Déplacer l'action dans 'onClick', ` +
      `ou différer la mise à jour d'état (après le clic) pour que l'événement 'click' ait lieu.`
    );
    process.exit(1);
  }

  console.log(
    `✅ Aucun contrôle interactif n'est démonté pendant l'appui (${fichiersLus} fichiers, ` +
    `${controlesAnalyses} contrôles interactifs analysés).`
  );
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('check-appui-demontage-controles.js')) {
  main();
}
