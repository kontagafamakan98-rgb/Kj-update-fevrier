/**
 * LES ATTENTES DE CONDITION DU HARNAIS e2e — et pourquoi il n'y a ici AUCUNE horloge.
 *
 * ── Le défaut que ce module remplace ────────────────────────────────────────
 * Un `page.waitForTimeout(N)` ne dit pas ce qu'on attend : il dit combien de
 * temps on espère. La mesure prise après lui porte donc sur l'HÔTE autant que
 * sur l'artefact — trop court sur une machine chargée, on lit un état
 * intermédiaire ; et rien ne le signale, parce qu'un délai n'échoue JAMAIS. Le
 * dépôt a payé ce défaut exact, sur un autre sujet que le temps (un garde
 * jugeait la hauteur d'un document contre un nombre de pixels relevé sur une
 * machine : vert ici, rouge ailleurs) — et c'est cet angle mort (n° 19 de
 * CI-COVERAGE.md) qui recensait les dix-neuf `waitForTimeout` de `e2e/`.
 *
 * ── Ce qui est écrit ici, et ce que ce n'est PAS ────────────────────────────
 * Ce sont des CONDITIONS observées — dans la page, ou dans le journal des
 * requêtes d'un parcours. Elles se terminent DÈS QU'ELLES SONT VRAIES, et
 * chacune porte un PLAFOND : une condition qui ne vient jamais doit rendre la
 * main pour que le cas échoue sur la COMPARAISON, jamais sur une attente muette
 * (un rouge d'attente ne dit pas quel défaut existe).
 *
 * Deux familles, et la seconde est celle qui demande le plus de soin :
 *   • un FAIT qu'on attend (une valeur stable, une peinture, un silence) ;
 *   • une GRANDEUR qu'on SONDÉ : on la lit, on la relit, et « stable » veut dire
 *     deux lectures ÉGALES. Le pas de sondage est un PARAMÈTRE NOMMÉ
 *     (`PAS_SONDAGE_MS`) et non un littéral de spec — c'est la prescription de
 *     l'angle mort 19 : le temps d'échantillonnage s'écrit une fois, avec sa
 *     raison, jamais au milieu d'un cas.
 *
 * ── Ce qu'on ne fait PAS ici, et c'est un choix ─────────────────────────────
 * On n'attend JAMAIS la propriété que le cas juge. Attendre « le verrou de
 * défilement est rendu » ferait passer un tiroir resté ouvert (le test ne
 * pourrait plus échouer) : ce qui décide doit rester lu APRÈS coup. Les attentes
 * de ce module portent donc sur des grandeurs NEUTRES — la mise en page, la
 * peinture, la position de défilement, la longueur du journal des requêtes.
 */
import { attendreLaStabilite } from './geometrie.js';

/**
 * Pas de sondage d'une condition, en millisecondes. Ce n'est PAS un verdict :
 * c'est la fréquence à laquelle on regarde. Il est nommé ici pour qu'aucune
 * spec n'ait à décider d'un nombre.
 */
export const PAS_SONDAGE_MS = 50;

/** Deux lectures ÉGALES valent « stable » : c'est la définition, pas un réglage. */
export const LECTURES_EGALES = 2;

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Attend qu'une valeur LUE DANS LA PAGE cesse de changer.
 *
 * @param {import('@playwright/test').Page} page Page ouverte.
 * @param {() => unknown} sonde Sonde évaluée dans la page (doit être sérialisable).
 * @param {{lecturesEgales?: number, pasMs?: number, maxMs?: number}} [options]
 *   `lecturesEgales` est le nombre de lectures identiques CONSÉCUTIVES qui vaut
 *   « stable » (3 = deux intervalles de calme, pour une grandeur qui peut
 *   bouger une fois de plus).
 * @returns {Promise<boolean>} `true` si la stabilité a été observée, `false` si
 *   le plafond a été atteint (l'appelant juge alors sur sa COMPARAISON).
 */
export async function attendreUneValeurStable(
  page,
  sonde,
  { lecturesEgales = LECTURES_EGALES, pasMs = PAS_SONDAGE_MS, maxMs = 3000 } = {}
) {
  const debut = Date.now();
  let precedente;
  let egales = 0;
  while (Date.now() - debut < maxMs) {
    const courante = JSON.stringify(await page.evaluate(sonde));
    egales = courante === precedente ? egales + 1 : 0;
    if (egales >= lecturesEgales - 1) return true;
    precedente = courante;
    await dormir(pasMs);
  }
  return false;
}

/**
 * Attend que le DÉFILEMENT de la page se soit arrêté.
 *
 * C'est la condition du cas « 900 px de molette ont-ils bougé la page ? » : ce
 * qui décide est la position, mais lire une position en plein défilement
 * (fluide, ou amorti par le geste) mesurerait un instant du mouvement. La
 * grandeur sondée — `window.scrollY` — est NEUTRE : un défilement verrouillé
 * reste simplement à 0, et c'est le cas qui le dira.
 */
export async function attendreLaStabiliteDuDefilement(page, options = {}) {
  return attendreUneValeurStable(page, () => Math.round(window.scrollY), options);
}

/**
 * Attend que la page ait PEINT la mise en page courante : deux images
 * d'affichage consécutives.
 *
 * C'est la condition neutre d'un FRANCHISSEMENT DE POINT DE RUPTURE : après un
 * `setViewportSize`, l'application doit avoir re-rendu (le tiroir mobile se
 * ferme sur un écouteur de redimensionnement), et ce qui le prouve sans horloge
 * est que le compositeur a produit une image. On n'attend PAS l'état jugé (le
 * verrou rendu, le tiroir fermé) : on attend que le rendu soit ALLÉ JUSQUE-LÀ.
 *
 * @param {import('@playwright/test').Page} page Page ouverte.
 * @param {number} [images] Nombre de paires d'images à attendre.
 */
export async function attendreLaPeinture(page, images = 2) {
  for (let i = 0; i < images; i += 1) {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
  }
}

/**
 * Une taille nouvelle est appliquée, PEINTE, et sa mise en page ne bouge plus.
 *
 * Les deux moitiés sont nécessaires : `attendreLaStabilite` (signature de mise
 * en page) attrape le re-rendu qui change le document, `attendreLaPeinture`
 * attrape celui qui ne le change pas (une barre qui disparaît en CSS déplace ce
 * que le visiteur voit sans changer la hauteur de la page).
 */
export async function attendreLeRenduApresRedimensionnement(page, options = {}) {
  await attendreLaPeinture(page);
  await attendreLaStabilite(page, options.maxMs);
  await attendreLaPeinture(page);
}

/**
 * Attend que le JOURNAL DES REQUÊTES d'un parcours se taise.
 *
 * Un chargement est « fini » quand plus rien ne part — c'est ce que
 * `waitForTimeout(N)` espérait. On le mesure sur le journal que le verdict
 * utilise déjà (`page.on('request', …)` ou l'écoute CDP), pas sur
 * `networkidle` : l'application interroge son API, et une attente de « réseau
 * au repos » qui ne viendrait jamais serait un rouge sur la montre, pas sur le
 * fond. D'où le PLAFOND — et la lecture PORTE sur la longueur du journal, une
 * grandeur neutre.
 *
 * @param {() => number} longueur Longueur courante du journal (lue à chaque tour).
 * @param {{calmeMs?: number, pasMs?: number, maxMs?: number}} [options]
 *   `calmeMs` est la durée de silence qui vaut « fini ».
 * @returns {Promise<boolean>} `true` si le silence a été observé.
 */
export async function attendreLeSilenceDesRequetes(
  longueur,
  { calmeMs = 400, pasMs = PAS_SONDAGE_MS, maxMs = 2500 } = {}
) {
  const debut = Date.now();
  let derniere = longueur();
  let depuis = Date.now();
  while (Date.now() - debut < maxMs) {
    await dormir(pasMs);
    const courante = longueur();
    if (courante !== derniere) {
      derniere = courante;
      depuis = Date.now();
      continue;
    }
    if (Date.now() - depuis >= calmeMs) return true;
  }
  return false;
}
