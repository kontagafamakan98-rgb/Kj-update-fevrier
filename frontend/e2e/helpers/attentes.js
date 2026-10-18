/**
 * LES ATTENTES DE CONDITION DU HARNAIS e2e — et pourquoi il n'y a ici AUCUNE horloge.
 *
 * ── La SEULE exception, et elle est déclarée (28/09/2026) ───────────────────
 * `attendreLaCondition`, en bas de ce module, n'attend PAS une grandeur neutre :
 * elle attend la condition que le cas JUGE, et elle rend sa DURÉE. C'est
 * l'inverse de la règle ci-dessous, et c'est délibéré : la preuve multi-moteurs
 * compare ce que trois moteurs font du MÊME geste, donc il lui faut une durée —
 * et une durée ne s'obtient pas d'une attente neutre. Ce qui protège le cas est
 * ailleurs : `attendreLaCondition` ne lève jamais, elle rend `atteinte: false`
 * avec la DERNIÈRE valeur lue, et l'appelant DOIT l'asserter. Sans cette
 * assertion, la faute que la règle ci-dessous interdit rentrerait par la porte
 * de derrière (un rouge d'attente au lieu d'un rouge de fond).
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

/**
 * Pas de sondage d'une MESURE DE GESTE, en millisecondes.
 *
 * Il est distinct de `PAS_SONDAGE_MS` (50 ms) et c'est une mesure, pas un
 * goût : une bascule de point de rupture dure quelques millisecondes, donc un pas
 * de 50 ms ne la mesurerait pas — il la déciderait. 25 ms est assez fin pour que
 * la borne haute d'une bascule de ~3 ms reste du même ordre.
 */
export const PAS_SONDAGE_GESTE_MS = 25;

/** Plafond par défaut de `attendreLaCondition`, en millisecondes. */
export const PLAFOND_ATTENTE_MS = 3000;

/**
 * Attend qu'un prédicat soit vrai sur la valeur d'une sonde, ET REND LA DURÉE.
 *
 * ── Pourquoi cette fonction existe, alors que le module s'interdit d'attendre le fait jugé ──
 * Parce que la preuve multi-moteurs (28/09/2026) a besoin des deux choses à la
 * fois : attendre un FAIT observable, et PUBLIER le temps qu'il a fallu — c'est
 * cette durée qui se compare d'un moteur à l'autre (Firefox inertiel pour une
 * molette, WebKit attentif au premier rendu), et un délai fixe ne la mesure pas,
 * il la décide. La condition de sortie est donc celle que le cas juge, et
 * l'appelant l'asserte (`atteinte`), ce qui est la contrepartie exigée : sans
 * l'assertion, un fait jamais arrivé passerait pour un succès muet.
 *
 * ── Ce que la durée est, et pourquoi elle est rendue en DEUX bornes ─────────
 * Un sondage mesure un INTERVALLE, pas un point : la condition a été vue VRAIE à
 * `ms`, et elle était fausse à la fin de la lecture précédente (`borneBasseMs`).
 * Une lecture de page peut durer des secondes sur un hôte chargé (re-mise en
 * page, `evaluate` retardé), et cette latence entre ENTIÈRE dans `ms` sans que
 * le fait ait mis ce temps-là — relevé du 28/09/2026 : une bascule publiée à
 * 6 283 ms sur Firefox dont ~6 s étaient une seule lecture, soit un « écart » de
 * 104 616 % entre moteurs qui ne mesurait que la lenteur d'une sonde. C'est donc
 * `fourchetteMs[0]` qu'un tableau d'écarts compare, `ms` restant la borne haute
 * lue, et `latenceMaxMs` nommant le bruit de la sonde.
 *
 * @template T
 * @param {import('@playwright/test').Page} page Page ouverte.
 * @param {() => T} sonde Fonction évaluée DANS la page (donc sérialisable : une
 *   fonction qui prend un `page` en argument ne peut pas s'exécuter là-bas).
 * @param {(valeur: T) => boolean} predicat Condition d'arrêt.
 * @param {{plafondMs?: number, pasMs?: number}} [options]
 * @returns {Promise<{atteinte: boolean, ms: number, dernier: T, borneBasseMs: number, latenceMaxMs: number, lectures: number, fourchetteMs: [number, number]}>}
 */
export async function attendreLaCondition(page, sonde, predicat, options = {}) {
  const plafondMs = options.plafondMs ?? PLAFOND_ATTENTE_MS;
  const pasMs = options.pasMs ?? PAS_SONDAGE_GESTE_MS;
  const debut = Date.now();
  let borneBasseMs = 0;
  let latenceMaxMs = 0;
  let lectures = 0;
  const lire = async () => {
    const avant = Date.now();
    const valeur = await page.evaluate(sonde);
    latenceMaxMs = Math.max(latenceMaxMs, Date.now() - avant);
    lectures += 1;
    return valeur;
  };

  let dernier = await lire();
  while (!predicat(dernier)) {
    const ecoule = Date.now() - debut;
    if (ecoule >= plafondMs) {
      return resultat({ atteinte: false, ms: ecoule, dernier, borneBasseMs, latenceMaxMs, lectures });
    }
    borneBasseMs = Date.now() - debut;
    await dormir(pasMs);
    dernier = await lire();
  }
  return resultat({ atteinte: true, ms: Date.now() - debut, dernier, borneBasseMs, latenceMaxMs, lectures });
}

/** Met la lecture en forme : les deux bornes de la durée, côte à côte. */
function resultat({ atteinte, ms, dernier, borneBasseMs, latenceMaxMs, lectures }) {
  return { atteinte, ms, dernier, borneBasseMs, latenceMaxMs, lectures, fourchetteMs: [borneBasseMs, ms] };
}
