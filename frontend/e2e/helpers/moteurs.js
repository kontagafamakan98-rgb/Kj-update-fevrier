/**
 * PUBLIER CE QU'UN MOTEUR MESURE, ET L'ÉCART ENTRE MOTEURS.
 *
 * ── Pourquoi ce harnais existe ─────────────────────────────────────────────
 * Les projets `firefox` et `webkit` de `playwright.config.js` rejouent les
 * parcours qui mesurent des GESTES (appui, molette, bascule de taille) : ce
 * qu'ils mesurent est un fait de MOTEUR — ordre des événements de
 * compatibilité, défilement inertiel, re-mise en page. Jusqu'ici, chaque
 * parcours publiait sa ligne `ℹ️` sans dire de quel moteur elle venait : trois
 * relevés identiques en apparence, donc aucun écart lisible, et un lecteur qui
 * devait déduire le moteur du nom du projet.
 *
 * Ici, chaque mesure est ENREGISTRÉE avec son moteur et PUBLIÉE avec lui, et la
 * fin de fichier imprime le TABLEAU DES ÉCARTS : pour chaque mesure vue sur au
 * moins deux moteurs, la plus petite valeur, la plus grande, l'étendue et
 * l'écart relatif. Une mesure publiée sur un seul moteur est CONSERVÉE (elle
 * dit ce que ce moteur-là fait) mais ne prétend pas à un écart — un écart
 * calculé sur un seul point serait un zéro menteur.
 *
 * ── POURQUOI LES MESURES PASSENT PAR UN FICHIER ────────────────────────────
 * Un registre en mémoire ne peut PAS comparer les moteurs : Playwright donne à
 * chaque projet son propre processus de travail, donc le `chromium` qui mesure
 * et le `firefox` qui mesure ne se rencontrent jamais dans la même mémoire —
 * un tableau lu en `afterAll` concluait « aucune mesure relevée sur deux
 * moteurs » et ne comparait rien. Chaque mesure est donc ÉCRITE sur disque
 * (une ligne JSON par relevé, ajoutée en fin de fichier), et c'est le
 * `globalTeardown` — qui s'exécute UNE fois, après tous les projets — qui relit
 * l'ensemble et publie les écarts par moteur.
 *
 * ── Ce qui est PUR, et pourquoi ────────────────────────────────────────────
 * `calculerEcarts` ne lit ni l'horloge ni la page : elle prend des relevés et
 * rend les écarts. C'est ce qui permet de l'éprouver à l'unité
 * (`scripts/__tests__/check-moteurs-gestes.test.js`) au lieu de croire le
 * tableau imprimé par une exécution.
 */

import fs from 'fs';
import path from 'path';

/** Les moteurs que cette suite peut rejouer, dans l'ordre de `playwright.config.js`. */
export const MOTEURS = ['chromium', 'firefox', 'webkit'];

/**
 * Le fichier des relevés, partagé par tous les processus de la suite. Il vit
 * sous `test-results/` (le dossier de sortie de Playwright, vidé au début de
 * chaque exécution) : deux exécutions ne peuvent donc pas mélanger leurs
 * relevés, et le harnais n'écrit rien hors de ce dossier.
 */
export const FICHIER_DES_MESURES = path.resolve('test-results', 'mesures-moteurs.jsonl');

/** Le registre du PROCESSUS (ce que CE processus a mesuré, pour la lecture locale). */
const MESURES = new Map();

/**
 * Enregistre une mesure pour un moteur.
 *
 * @param {string} mesure Le nom de la mesure, stable entre les moteurs (c'est
 *   la clé de comparaison : « appui → carte montée », « défilement après
 *   900 px de molette »).
 * @param {string} moteur Le nom du projet Playwright (`chromium`…).
 * @param {number|string} valeur La valeur mesurée.
 * @param {string} [fichier] Fichier partagé à alimenter (celui de la suite par
 *   défaut ; les preuves unitaires visent un fichier temporaire, pour ne pas
 *   laisser de relevés dans `test-results/`).
 */
export function enregistrer(mesure, moteur, valeur, fichier = FICHIER_DES_MESURES) {
  if (!MESURES.has(mesure)) MESURES.set(mesure, new Map());
  MESURES.get(mesure).set(moteur, valeur);
  ecrireSurDisque({ mesure, moteur, valeur }, fichier);
}

/**
 * Ajoute un relevé au fichier partagé, sans jamais faire échouer un cas : un
 * relevé non écrit est un écart manquant, pas une sonde cassée.
 *
 * @param {{mesure: string, moteur: string, valeur: number|string}} releve
 * @param {string} fichier
 */
function ecrireSurDisque(releve, fichier) {
  try {
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.appendFileSync(fichier, `${JSON.stringify(releve)}\n`);
  } catch (erreur) {
    console.log(`⚠️  relevé non écrit (${releve.mesure} / ${releve.moteur}) : ${erreur.message}`);
  }
}

/**
 * Relit les relevés écrits par TOUS les processus de l'exécution.
 *
 * Une ligne illisible est IGNORÉE, pas fatale : deux processus peuvent écrire
 * en même temps, et une ligne tronquée ne doit pas emporter le tableau entier.
 *
 * @param {string} [fichier] Chemin du fichier (celui de la suite par défaut).
 * @returns {Array<{mesure: string, moteur: string, valeur: number|string}>}
 */
export function lireLesReleves(fichier = FICHIER_DES_MESURES) {
  if (!fs.existsSync(fichier)) return [];
  const relevesLus = [];
  for (const ligne of fs.readFileSync(fichier, 'utf8').split('\n')) {
    if (!ligne.trim()) continue;
    try {
      relevesLus.push(JSON.parse(ligne));
    } catch {
      // Ligne tronquée ou entrelacée : ignorée, voir le commentaire ci-dessus.
    }
  }
  return relevesLus;
}

/** Les relevés du processus, dans l'ordre d'enregistrement. */
export function releves() {
  const sortie = [];
  for (const [mesure, parMoteur] of MESURES) {
    for (const [moteur, valeur] of parMoteur) sortie.push({ mesure, moteur, valeur });
  }
  return sortie;
}

/** Vide le registre (réservé aux preuves unitaires : un relevé neuf n'hérite de rien). */
export function viderLesReleves() {
  MESURES.clear();
}

/**
 * Les ÉCARTS entre moteurs, mesure par mesure.
 *
 * Une mesure n'entre dans le tableau que si elle a été relevée sur AU MOINS
 * DEUX moteurs : un écart sur un seul point vaudrait zéro, et ce zéro dirait
 * « les moteurs s'accordent » là où il ne dit que « on n'a mesuré qu'un
 * moteur ». Les valeurs non numériques (une séquence d'événements, un état
 * rendu) sont publiées SANS écart chiffré : elles s'accordent ou non, c'est
 * l'identité qu'on lit, pas une différence.
 *
 * @param {Array<{mesure: string, moteur: string, valeur: number|string}>} entrées
 * @returns {Array<{mesure: string, valeurs: Array<{moteur: string, valeur: number|string}>,
 *   min: number|null, max: number|null, etendue: number|null, ecartRelatif: number|null,
 *   numerique: boolean, accord: boolean}>}
 */
export function calculerEcarts(entrees) {
  const parMesure = new Map();
  for (const { mesure, moteur, valeur } of entrees) {
    if (!parMesure.has(mesure)) parMesure.set(mesure, []);
    parMesure.get(mesure).push({ moteur, valeur });
  }

  const lignes = [];
  for (const [mesure, valeurs] of parMesure) {
    const moteursDistincts = new Set(valeurs.map((v) => v.moteur));
    if (moteursDistincts.size < 2) continue;

    const numerique = valeurs.every((v) => typeof v.valeur === 'number' && Number.isFinite(v.valeur));
    if (!numerique) {
      const premiere = String(valeurs[0].valeur);
      lignes.push({
        mesure,
        valeurs,
        min: null,
        max: null,
        etendue: null,
        ecartRelatif: null,
        numerique: false,
        accord: valeurs.every((v) => String(v.valeur) === premiere),
      });
      continue;
    }

    const nombres = valeurs.map((v) => v.valeur);
    const min = Math.min(...nombres);
    const max = Math.max(...nombres);
    const etendue = max - min;
    lignes.push({
      mesure,
      valeurs,
      min,
      max,
      etendue,
      // L'écart RELATIF est rapporté à la plus petite valeur non nulle : une
      // mesure à 0 px sur les trois moteurs n'a pas d'écart relatif (0/0), et
      // c'est un accord, pas une absence de mesure.
      ecartRelatif: min > 0 ? etendue / min : null,
      numerique: true,
      accord: etendue === 0,
    });
  }
  return lignes;
}

/** Le moteur d'un cas, lu à son projet Playwright. */
export function moteurDe(test) {
  return test.info().project.name;
}

/**
 * PUBLIE une mesure : elle est enregistrée pour ce moteur ET imprimée avec lui.
 *
 * @param {import('@playwright/test').TestType} test Le `test` du fichier (pour
 *   connaître le projet, donc le MOTEUR).
 * @param {string} mesure Nom de la mesure.
 * @param {number|string} valeur Valeur relevée.
 * @param {string} [unite] Unité affichée (`ms`, `px`…).
 * @returns {number|string} La valeur, pour l'enchaîner dans une assertion.
 */
export function publier(test, mesure, valeur, unite = '') {
  const moteur = moteurDe(test);
  enregistrer(mesure, moteur, valeur);
  console.log(`ℹ️  [${moteur}] ${mesure} : ${valeur}${unite ? ` ${unite}` : ''}`);
  return valeur;
}

/**
 * Met une ligne d'écart en forme, telle qu'elle se lit au journal ET dans le
 * rapport écrit. Une seule mise en forme, pour que le journal et le fichier ne
 * puissent pas dire deux choses différentes.
 *
 * @param {object} ligne Une ligne de `calculerEcarts`.
 * @returns {string}
 */
export function ligneDEcart(ligne) {
  const detail = ligne.valeurs.map((v) => `${v.moteur}=${v.valeur}`).join(' · ');
  if (!ligne.numerique) {
    return `${ligne.mesure} — ${detail} — ${ligne.accord ? 'IDENTIQUE' : 'DIVERGENT'}`;
  }
  const relatif = ligne.ecartRelatif === null ? 'n/a' : `${(ligne.ecartRelatif * 100).toFixed(1)} %`;
  return (
    `${ligne.mesure} — ${detail} — étendue ${ligne.etendue} (${relatif})` +
    `${ligne.accord ? ' · les moteurs s’accordent' : ''}`
  );
}

/**
 * Le TABLEAU DES ÉCARTS, lu sur le fichier partagé et PUBLIÉ.
 *
 * Appelé par le `globalTeardown` : c'est le seul endroit d'une exécution où les
 * relevés des trois projets coexistent (chaque projet a son propre processus de
 * travail, donc sa propre mémoire). Le tableau est aussi ÉCRIT à côté du
 * journal, pour qu'un écart mesuré laisse une trace consultable après coup.
 *
 * @param {{fichier?: string, rapport?: string, journaliser?: (ligne: string) => void}} [options]
 * @returns {{lignes: Array<object>, moteurs: string[], rapport: string}}
 */
export function publierLesEcarts(options = {}) {
  const fichier = options.fichier ?? FICHIER_DES_MESURES;
  const rapport = options.rapport ?? path.resolve('test-results', 'ecarts-moteurs.md');
  const journaliser = options.journaliser ?? ((ligne) => console.log(ligne));

  const tous = lireLesReleves(fichier);
  const moteurs = [...new Set(tous.map(({ moteur }) => moteur))].sort();
  const lignes = calculerEcarts(tous);

  if (!lignes.length) {
    journaliser(
      `ℹ️  Écarts par moteur : ${tous.length} relevé(s) sur ${moteurs.length} moteur(s) — ` +
        'aucune mesure sur deux moteurs, donc rien à comparer.'
    );
  } else {
    journaliser(`ℹ️  Écarts par moteur (${moteurs.join(', ')}, ${tous.length} relevés) :`);
    for (const ligne of lignes) journaliser(`ℹ️    ${ligneDEcart(ligne)}`);
    const divergents = lignes.filter((l) => !l.accord);
    journaliser(`ℹ️  ${lignes.length - divergents.length}/${lignes.length} mesure(s) identique(s) sur les moteurs.`);
  }

  const titre = [
    '# Écarts par moteur',
    '',
    `Relevés : ${tous.length} · moteurs : ${moteurs.length ? moteurs.join(', ') : 'aucun'}`,
    '',
    ...(lignes.length ? lignes.map((ligne) => `- ${ligneDEcart(ligne)}`) : ['Aucune mesure relevée sur deux moteurs.']),
    '',
  ].join('\n');
  try {
    fs.mkdirSync(path.dirname(rapport), { recursive: true });
    fs.writeFileSync(rapport, titre);
  } catch (erreur) {
    journaliser(`⚠️  rapport des écarts non écrit : ${erreur.message}`);
  }
  return { lignes, moteurs, rapport };
}
