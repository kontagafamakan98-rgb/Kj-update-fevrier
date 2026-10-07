#!/usr/bin/env node
/**
 * Garde-fou de la MESURE du poinçon : le dessin de la marque est-il encore
 * lisible, contenu, et sans débordement.
 *
 * ── CE QU'IL JUGE, ET POURQUOI CE N'EST PAS « check-generated-icons.js » ──
 * `check-generated-icons.js` juge la FAMILLE : l'inventaire de public/icons/,
 * le manifeste, les dimensions, les empreintes de pixels, la zone de sécurité
 * des variantes maskable. Il dit que l'artefact est CONFORME à ce qu'il déclare.
 * Il ne dit pas que le DESSIN est bon — et rien ne le disait : l'atelier du
 * 28/09/2026 avait mesuré trois choses (le contraste de la lettre, le débordement
 * des cercles, les pixels peints hors du disque), corrigé le dessin avec elles,
 * puis été supprimé. Ce qui restait était de la prose dans un en-tête et deux
 * nombres dans un journal, c'est-à-dire rien qui rougisse quand la géométrie
 * change.
 *
 * Ce garde rejoue ces trois mesures, sur la géométrie DÉCLARÉE
 * (src/config/marque-kojo.json, le même fichier que la page, la coquille et le
 * rasteriseur lisent) et sur l'ARTEFACT SERVI (les PNG clairs, décodés ici).
 * Les trois mesures elles-mêmes vivent dans scripts/marque-kojo-mesures.js, sans
 * E/S, pour être mesurables en isolation avec des cas qui les font mordre.
 *
 * ── CE QU'IL NE JUGE PAS, ET C'EST ÉCRIT POUR NE PAS ÊTRE REDÉCOUVERT ─────
 *   * les variantes MASKABLE : leur fond est OPAQUE par exigence des masques,
 *     donc « un pixel peint » n'y a pas de sens (le pixel est toujours peint,
 *     c'est le fond). Leur contrat est la zone de sécurité du contenu, et c'est
 *     `check-pwa-manifest.js` qui la mesure ;
 *   * le favicon SOMBRE (icon-dark.png) : il est composé par gen-og-images.py sur
 *     le graphite #18181b, donc opaque lui aussi ; sa composition est déjà tenue
 *     par `check-og-assets.js` (source + empreinte du composeur) ;
 *   * les PNG de favicon.ico : ils sont dans un conteneur ICO dont l'extraction
 *     est déjà faite par `check-generated-icons.js` (dimensions + empreintes de
 *     pixels, taille par taille).
 *
 * Usage : cd frontend && node scripts/check-marque-kojo.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

import {
  cerclesDansLeDisque,
  contrasteDeLaLettre,
  PLANCHER_DISQUE_PEINT,
  pixelsHorsDuDisque,
  rayonDuDisque,
  segmentsDeLaLettre,
  SEUIL_CONTRASTE,
} from './marque-kojo-mesures.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const RACINE = path.join(ICI, '..');
export const GEOMETRIE_PATH = path.join('src', 'config', 'marque-kojo.json');
export const ICONES_LABEL = 'public/icons';
export const ICONES_DIR = path.join(RACINE, 'public', 'icons');

/**
 * LES ICÔNES MESURÉES AU PIXEL : les sorties CLAIRES, celles dont le fond est
 * transparent — c'est ce qui donne un sens à « un pixel peint ». Les deux tailles
 * les plus parlantes y sont, et toutes deux sont mesurées : le débordement d'un
 * trait se compte en unités de grille (il est donc le même à toute taille), mais
 * la plus fine le montre au mieux en pixels.
 */
export const REFERENCES_PIXELS = ['icon-192x192.png', 'icon-512x512.png'];

/** Plancher de lecture : sans lui, un balayage cassé rendrait un vert sans rien
 * avoir lu. Deux références déclarées, c'est le plancher. */
export const MIN_PIXELS_LUS = REFERENCES_PIXELS.length;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Type 6 (RGBA) et 8 bits : c'est ce que le rasteriseur écrit. Un autre type est
// REFUSÉ nommément plutôt que mal décodé — un décodage approximatif rendrait un
// verdict sur des pixels qu'on n'a pas lus.
const TYPE_RGBA = 6;
const PROFONDEUR_8 = 8;

/**
 * LE DÉCODEUR PNG, en Node pur (`zlib` + dé-filtrage) : aucune dépendance
 * ajoutée pour mesurer huit cent mille pixels, et surtout aucun appel à un
 * rasteriseur — la mesure porte sur l'artefact SERVI, pas sur un second dessin.
 *
 * Rend `{ width, height, pixels }` (RGBA 8 bits) ou lève, en nommant le fichier
 * et la raison : un garde qui ne sait pas lire son sujet doit le DIRE.
 */
export const decodePng = (chemin, octets = readFileSync(chemin)) => {
  const nom = path.basename(chemin);
  if (octets.length < 8 || !octets.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${nom} : ce n'est pas un PNG (signature absente)`);
  }
  let offset = 8;
  let largeur = 0;
  let hauteur = 0;
  let profondeur = 0;
  let type = 0;
  const donnees = [];
  while (offset + 8 <= octets.length) {
    const longueur = octets.readUInt32BE(offset);
    const nomChunk = octets.toString('ascii', offset + 4, offset + 8);
    const debut = offset + 8;
    const fin = debut + longueur;
    if (fin > octets.length) throw new Error(`${nom} : chunk « ${nomChunk} » tronqué`);
    if (nomChunk === 'IHDR') {
      largeur = octets.readUInt32BE(debut);
      hauteur = octets.readUInt32BE(debut + 4);
      profondeur = octets[debut + 8];
      type = octets[debut + 9];
    } else if (nomChunk === 'IDAT') {
      donnees.push(octets.subarray(debut, fin));
    } else if (nomChunk === 'IEND') {
      break;
    }
    offset = fin + 4; // + CRC
  }
  if (!largeur || !hauteur) throw new Error(`${nom} : en-tête IHDR introuvable`);
  if (type !== TYPE_RGBA || profondeur !== PROFONDEUR_8) {
    throw new Error(
      `${nom} : type de couleur ${type} / profondeur ${profondeur} — la mesure ne décode que ` +
        `le RGBA 8 bits (type ${TYPE_RGBA}), celui que le rasteriseur écrit.`
    );
  }
  const brut = inflateSync(Buffer.concat(donnees));
  const parLigne = largeur * 4;
  const pixels = Buffer.alloc(parLigne * hauteur);
  const precedente = Buffer.alloc(parLigne);
  for (let ligne = 0; ligne < hauteur; ligne += 1) {
    const filtre = brut[ligne * (parLigne + 1)];
    const source = brut.subarray(ligne * (parLigne + 1) + 1, ligne * (parLigne + 1) + 1 + parLigne);
    const cible = pixels.subarray(ligne * parLigne, (ligne + 1) * parLigne);
    for (let index = 0; index < parLigne; index += 1) {
      const gauche = index >= 4 ? cible[index - 4] : 0;
      const haut = precedente[index];
      const diagonale = index >= 4 ? precedente[index - 4] : 0;
      const valeur = source[index];
      let rendu;
      switch (filtre) {
        case 0:
          rendu = valeur;
          break;
        case 1:
          rendu = valeur + gauche;
          break;
        case 2:
          rendu = valeur + haut;
          break;
        case 3:
          rendu = valeur + Math.floor((gauche + haut) / 2);
          break;
        case 4: {
          const p = gauche + haut - diagonale;
          const pa = Math.abs(p - gauche);
          const pb = Math.abs(p - haut);
          const pc = Math.abs(p - diagonale);
          const predit = pa <= pb && pa <= pc ? gauche : pb <= pc ? haut : diagonale;
          rendu = valeur + predit;
          break;
        }
        default:
          throw new Error(`${nom} : filtre PNG inconnu « ${filtre} » ligne ${ligne}`);
      }
      cible[index] = rendu & 0xff;
    }
    precedente.set(cible);
  }
  return { width: largeur, height: hauteur, pixels };
};

/**
 * LE VERDICT. Trois mesures, un rapport. `errors` vide ⇒ `ok`.
 */
export const runMarqueKojoCheck = ({ racine = RACINE, journal = console } = {}) => {
  const log = (message) => journal.log(message);
  const logError = (message) => (journal.error || journal.log)(message);
  const errors = [];
  const notices = [];

  // ── La géométrie DÉCLARÉE ───────────────────────────────────────────────
  const cheminGeometrie = path.join(racine, GEOMETRIE_PATH);
  let geometrie = null;
  try {
    geometrie = JSON.parse(readFileSync(cheminGeometrie, 'utf8'));
  } catch (erreur) {
    // Refus de juger : une géométrie illisible ne peut pas rendre un vert.
    logError(`❌ La géométrie de la marque est illisible : ${GEOMETRIE_PATH} (${erreur.message})`);
    return { ok: false, errors: [`géométrie illisible : ${erreur.message}`], notices, mesures: [] };
  }

  const mesures = [];

  // ── 1. LE CONTRASTE DE LA LETTRE ────────────────────────────────────────
  const contraste = contrasteDeLaLettre(geometrie);
  mesures.push(contraste);
  if (!contraste.ok) {
    errors.push(
      `contraste de la lettre : ${contraste.pire.contraste}:1 au pire point (${contraste.pire.x}, ` +
        `${contraste.pire.y}) sur la matière ${contraste.pire.couleur.join(',')} — le seuil est ` +
        `${SEUIL_CONTRASTE}:1 (WCAG 1.4.11). Rapproche l'arrêt clair du bord ou assombris la matière ` +
        `sous la lettre, dans ${GEOMETRIE_PATH}.`
    );
  }

  // ── 2. LES CERCLES DANS LE DISQUE ───────────────────────────────────────
  const cercles = cerclesDansLeDisque(geometrie);
  mesures.push(cercles);
  if (!cercles.ok) {
    const fautifs = cercles.bords.filter((bord) => bord.debordement > 0);
    for (const bord of fautifs) {
      errors.push(
        `la couche « ${bord.nom} » (${bord.sorte}) peint DEHORS : rayon ${bord.rayon} + demi-trait ` +
          `${(bord.largeur / 2).toFixed(4)} = ${bord.bord} > ${cercles.rayonDisque} (rayon du disque), ` +
          `soit ${bord.debordement} unité(s) de liseré sur le fond.`
      );
    }
  }

  // ── La marge entre le décor et l'encre de la lettre (publiée, pas jugée) ──
  // Elle explique POURQUOI la mesure de contraste porte bien sur la matière
  // seule : aucune couche décorative ne descend jusqu'à l'encre.
  const rayonDisque = rayonDuDisque(geometrie);
  const rayonDeco = Math.min(
    ...geometrie.peintures.marque.couches
      .filter((couche) => couche.sorte === 'cercle' || couche.sorte === 'arc')
      .map((couche) => Number(couche.rayon) - Number(couche.largeur) / 2)
  );
  const rayonEncre = Math.max(
    ...segmentsDeLaLettre(geometrie).flatMap(([depart, arrivee, largeur]) =>
      [depart, arrivee].map(([x, y]) => Math.hypot(x - 24, y - 24) + largeur / 2)
    )
  );
  notices.push(
    `décor et encre ne se rencontrent pas : le décor descend au plus à ${rayonDeco.toFixed(2)} du ` +
      `centre, l'encre monte au plus à ${rayonEncre.toFixed(2)} (marge ${(rayonDeco - rayonEncre).toFixed(2)})`
  );

  // ── 3. LES PIXELS PEINTS HORS DU DISQUE, sur l'ARTEFACT SERVI ───────────
  let lus = 0;
  for (const reference of REFERENCES_PIXELS) {
    const chemin = path.join(racine, ICONES_LABEL, reference);
    let decode;
    try {
      decode = decodePng(chemin);
    } catch (erreur) {
      errors.push(`${ICONES_LABEL}/${reference} : illisible pour la mesure — ${erreur.message}`);
      continue;
    }
    lus += 1;
    const mesure = pixelsHorsDuDisque(decode.pixels, {
      taille: decode.width,
      geometrie,
    });
    mesures.push(mesure);
    if (mesure.hors > 0) {
      errors.push(
        `${ICONES_LABEL}/${reference} : ${mesure.hors} pixel(s) peint(s) HORS du disque, jusqu'à ` +
          `${mesure.excesMaxPixels} px au-delà (${mesure.excesMaxUnites} unité(s) de grille, point ` +
          `${mesure.pointPire.x},${mesure.pointPire.y}) — un trait n'est pas rogné par le cercle qui ` +
          `le porte, et ce débordement se voit sur le fond.`
      );
    }
    if (mesure.partPeinte < PLANCHER_DISQUE_PEINT) {
      errors.push(
        `${ICONES_LABEL}/${reference} : le disque lui-même n'est peint qu'à ${(mesure.partPeinte * 100).toFixed(1)} % ` +
          `(plancher ${(PLANCHER_DISQUE_PEINT * 100).toFixed(0)} %) — « rien hors du disque » serait vrai ` +
          `d'une image transparente.`
      );
    }
  }
  if (lus < MIN_PIXELS_LUS) {
    errors.push(
      `aucune mesure de pixels n'a pu être faite (${lus} référence(s) lue(s) sur ${MIN_PIXELS_LUS} ` +
        `déclarée(s)) : un vert sans lecture ne prouverait rien.`
    );
  }

  if (errors.length > 0) {
    logError(`❌ La mesure du poinçon est en écart (${errors.length} problème(s)) :`);
    for (const message of errors) logError(`   • ${message}`);
    for (const message of notices) logError(`   ℹ️  ${message}`);
    return { ok: false, errors, notices, mesures };
  }

  log(
    `Géométrie mesurée : ${GEOMETRIE_PATH} — grille ${geometrie.grille}, disque r ${rayonDisque}, ` +
      `${geometrie.peintures.marque.couches.length} couches`
  );
  log(
    `  contraste de la lettre   ${contraste.pire.contraste}:1 au pire point ` +
      `(${contraste.pire.x}, ${contraste.pire.y}), ${contraste.moyenne}:1 en moyenne, ` +
      `${contraste.echantillons} échantillons — seuil ${SEUIL_CONTRASTE}:1`
  );
  log(
    `  cercles dans le disque   bord le plus large ${cercles.pire.bord} (${cercles.pire.nom}), ` +
      `marge ${cercles.marge} sous r ${cercles.rayonDisque} — ${cercles.bords.length} couches`
  );
  for (const mesure of mesures.filter((item) => item.nom === 'pixels peints hors du disque')) {
    log(
      `  ${String(mesure.taille).padStart(4)} px                  ${mesure.peints} pixel(s) peint(s), ` +
        `${mesure.hors} hors du disque, disque peint à ${(mesure.partPeinte * 100).toFixed(1)} %`
    );
  }
  for (const message of notices) log(`  ℹ️  ${message}`);
  log(
    '✅ Poinçon mesuré : la lettre reste lisible, les cinq cercles tiennent dans le disque, et ' +
      'aucune icône claire ne peint hors de sa portée.'
  );
  return { ok: true, errors, notices, mesures };
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const resultat = runMarqueKojoCheck();
  if (!resultat.ok) process.exit(1);
}
