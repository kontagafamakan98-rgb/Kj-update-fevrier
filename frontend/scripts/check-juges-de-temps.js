#!/usr/bin/env node
/**
 * GARDE-FOU CI : aucune borne de temps ABSOLU ne décide d'un verdict sans être
 * DÉCLARÉE, CLASSÉE et JUSTIFIÉE.
 *
 * La règle (classes, surfaces, déclaration, angles acceptés) est dans
 * `scripts/juges-de-temps.js` ; la preuve d'échec dans
 * `scripts/__tests__/check-juges-de-temps.test.js`. Ce fichier-ci lit les
 * surfaces, appelle la règle et sort : c'est le bras de la CI.
 *
 * Pourquoi ce garde existe : un garde du dépôt jugeait la hauteur du document
 * pré-rendu contre un nombre de pixels ABSOLU relevé sur une machine — vert ici,
 * rouge ailleurs. Le verdict portait sur l'hôte. Ce défaut-là est invisible tant
 * que l'hôte de CI ressemble au poste de développement, et il vit aussi bien
 * dans un budget Lighthouse en millisecondes que dans un délai de test. Le garde
 * ne prétend pas rendre portables les métriques de laboratoire : il empêche
 * qu'une borne en millisecondes entre en SILENCE et décide toute seule.
 *
 * Usage :
 *   node scripts/check-juges-de-temps.js
 *   node scripts/check-juges-de-temps.js --inventaire   (relevé JSON, pour
 *                                                        remplir la déclaration)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLASSES,
  JUGES,
  SURFACES,
  ANGLES_ACCEPTES,
  inventorier,
  confronterInventaire,
  delitsDeDeclaration,
  toutesLesDeclarations,
  CE_QUE_CE_GARDE_VOIT,
} from './juges-de-temps.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
// Les chemins des surfaces sont écrits depuis la RACINE DU DÉPÔT (`frontend/…`) :
// une surface se lit comme un emplacement, pas comme un fichier voisin.
const RACINE = path.resolve(ICI, '..', '..');

// Planchers de LECTURE : sous ces nombres, le garde refuse de juger — une
// surface déplacée ou un motif mal écrit ne doit pas passer pour « aucun écart ».
const MIN_SURFACES = 5;
const MIN_MESURES = 4;

/**
 * Les surfaces déclarées, en clair. Un fichier déclaré ABSENT est un refus : un
 * registre qui décrit un fichier disparu est un registre périmé.
 */
export function lireSurfaces(racine = RACINE) {
  const fichiers = [];
  const absentes = [];
  for (const surface of SURFACES) {
    const complet = path.join(racine, surface.chemin);
    if (!fs.existsSync(complet)) {
      absentes.push(surface.chemin);
      continue;
    }
    fichiers.push({ chemin: surface.chemin, texte: fs.readFileSync(complet, 'utf8') });
  }
  return { fichiers, absentes };
}

/** L'audit complet : inventaire confronté à la déclaration, et délits de classe. */
export function executerVerification(racine = RACINE) {
  const { fichiers, absentes } = lireSurfaces(racine);
  if (absentes.length > 0) {
    throw new Error(
      `surface(s) déclarée(s) INTROUVABLE(S) : ${absentes.join(', ')} — un registre ` +
        `qui décrit un fichier disparu ment ; corriger la déclaration, pas le garde.`
    );
  }
  if (fichiers.length < MIN_SURFACES) {
    throw new Error(
      `Surfaces lues insuffisantes (${fichiers.length} < ${MIN_SURFACES}) : le relevé ` +
        `n'a pas lu son sujet — refus de juger.`
    );
  }

  const inventaire = inventorier({ fichiers });
  const confrontation = confronterInventaire(inventaire, JUGES);
  const delits = delitsDeDeclaration(JUGES, ANGLES_ACCEPTES);

  const declarations = toutesLesDeclarations(JUGES);
  if (declarations.length === 0) {
    throw new Error('Déclaration VIDE — un garde qui n’exige rien ne vérifie rien.');
  }
  const mesures = declarations.filter((declaration) => declaration.classe === 'MESURE');
  if (confrontation.occurrencesReelles < MIN_MESURES) {
    throw new Error(
      `Bornes relevées insuffisantes (${confrontation.occurrencesReelles} < ${MIN_MESURES}) : ` +
        `les motifs ne lisent plus leur sujet — un vert sans lecture est un faux vert.`
    );
  }

  return { inventaire, confrontation, delits, mesures, surfacesLues: fichiers.length };
}

function formater(rapport) {
  const refus = [];
  const { confrontation, delits } = rapport;

  if (confrontation.nonDeclarees.length > 0) {
    refus.push(
      `${confrontation.nonDeclarees.length} BORNE(S) NON DÉCLARÉE(S) — une borne qui décide toute seule :\n` +
        confrontation.nonDeclarees
          .map((b) => `  • ${b.chemin}:${b.motif} → ${b.valeur} (×${b.occurrences})`)
          .join('\n')
    );
  }
  if (confrontation.perimees.length > 0) {
    refus.push(
      `${confrontation.perimees.length} DÉCLARATION(S) PÉRIMÉE(S) — le registre décrit un fichier qui n'existe plus :\n` +
        confrontation.perimees
          .map(
            (b) =>
              `  • ${b.chemin}:${b.motif} → ${b.valeur} déclarée ×${b.attendues}, ` +
              `présente ×${b.reelles}`
          )
          .join('\n')
    );
  }
  const inconnues = delits.filter((d) => d.type === 'CLASSE_INCONNUE');
  const sansJustification = delits.filter((d) => d.type === 'SANS_JUSTIFICATION');
  const sansAngle = delits.filter((d) => d.type === 'DECIDE_SANS_ANGLE');
  if (inconnues.length > 0) {
    refus.push(
      `${inconnues.length} CLASSE(S) INCONNUE(S) (vocabulaire fermé : ${Object.keys(CLASSES).join(', ')}) :\n` +
        inconnues.map((d) => `  • ${d.chemin}:${d.motif} → ${d.valeur} = « ${d.classe} »`).join('\n')
    );
  }
  if (sansJustification.length > 0) {
    refus.push(
      `${sansJustification.length} DÉCLARATION(S) SANS JUSTIFICATION (prose trop courte pour porter une mesure) :\n` +
        sansJustification.map((d) => `  • ${d.chemin}:${d.motif} → ${d.valeur}`).join('\n')
    );
  }
  if (sansAngle.length > 0) {
    refus.push(
      `${sansAngle.length} BORNE(S) QUI DÉCIDENT SANS ANGLE ACCEPTÉ — le défaut d'origine, nommé :\n` +
        sansAngle
          .map((d) => `  • ${d.chemin}:${d.motif} → ${d.valeur}, classe ${d.classe}`)
          .join('\n')
    );
  }
  return refus;
}

function main() {
  const inventaireSeul = process.argv.includes('--inventaire');
  let rapport;
  try {
    rapport = executerVerification();
  } catch (err) {
    console.error(`❌ Échec de la vérification : ${err.message}`);
    process.exit(1);
  }

  if (inventaireSeul) {
    console.log(JSON.stringify(rapport.inventaire.parSurface, null, 2));
    process.exit(0);
  }

  const refus = formater(rapport);
  if (refus.length > 0) {
    console.error(`❌ Verdicts sur un temps absolu : ${refus.join('\n')}`);
    console.error(
      `\nRemède : classer la borne dans le vocabulaire fermé (${Object.keys(CLASSES).join(', ')}) ` +
        `et la déclarer dans \`scripts/juges-de-temps.js\` avec sa justification — ou la rendre ` +
        `portable (une CONDITION ou un travail, jamais une horloge). Une borne de classe HOTE ou ` +
        `MESURE qui décide doit, en plus, avoir un angle ACCEPTÉ nommant ce qui la compense.`
    );
    process.exit(1);
  }

  const { confrontation, surfacesLues, mesures } = rapport;
  console.log(
    `✅ Verdicts sur un temps absolu : ${surfacesLues} surface(s) lue(s), ` +
      `${confrontation.occurrencesReelles} borne(s) relevée(s), ` +
      `${toutesLesDeclarations(JUGES).length} déclarée(s) ` +
      `dont ${mesures.length} MESURE(S) sous angle accepté — ` +
      `${CE_QUE_CE_GARDE_VOIT.voit.length} chose(s) refusée(s), ` +
      `${CE_QUE_CE_GARDE_VOIT.nePeutPasVoir.length} angle(s) mort(s) assumé(s).`
  );
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('check-juges-de-temps.js')) {
  main();
}
