/**
 * ATTENDRE UNE CONDITION, ET MESURER COMBIEN DE TEMPS ELLE A PRIS.
 *
 * ── Pourquoi pas `waitForTimeout` ──────────────────────────────────────────
 * Une attente fixe n'attend rien : elle laisse passer du temps et parie que le
 * travail est fini. Elle est trop courte sur un hôte chargé (le cas rougit au
 * hasard) et trop longue partout ailleurs. Or les parcours qui mesurent des
 * GESTES ont besoin des deux choses à la fois : attendre un FAIT observable, et
 * PUBLIER le temps qu'il a fallu — c'est cette durée qui se compare d'un moteur
 * à l'autre (Firefox inertiel, WebKit attentif au premier rendu), et un délai
 * fixe ne la mesure pas, il la décide.
 *
 * ── Ce que fait ce harnais ─────────────────────────────────────────────────
 * Il sonde la page avec la fonction fournie par l'appelant et rend la MAIN dès
 * que le prédicat est vrai. Il ne lève pas d'exception quand le plafond est
 * atteint : il rend `atteinte: false` et la DERNIÈRE valeur lue, pour que le
 * cas juge (`expect`) avec un message qui nomme ce qu'il attendait — un délai
 * dépassé doit être un rouge réparable, pas une attente muette.
 *
 * Le pas de sondage et le plafond sont des PARAMÈTRES NOMMÉS : aucun littéral
 * de temps au milieu d'un cas.
 */

/** Pas de sondage, en millisecondes (assez fin pour ne pas fausser une durée de geste). */
export const PAS_SONDAGE_MS = 25;

/** Plafond par défaut, en millisecondes : au-delà, la condition est déclarée non atteinte. */
export const PLAFOND_ATTENTE_MS = 3000;

/**
 * Attend qu'un prédicat soit vrai sur la valeur d'une sonde, et rend la durée.
 *
 * @template T
 * @param {import('@playwright/test').Page} page Page ouverte.
 * @param {() => T} sonde Fonction évaluée dans la page (sérialisée).
 * @param {(valeur: T) => boolean} predicat Condition d'arrêt.
 * @param {{plafondMs?: number, pasMs?: number}} [options]
 * @returns {Promise<{atteinte: boolean, ms: number, dernier: T}>} L'état final, la
 *   durée écoulée et la dernière valeur lue.
 */
export async function attendreLaCondition(page, sonde, predicat, options = {}) {
  const plafondMs = options.plafondMs ?? PLAFOND_ATTENTE_MS;
  const pasMs = options.pasMs ?? PAS_SONDAGE_MS;
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
    await page.waitForTimeout(pasMs);
    dernier = await lire();
  }
  return resultat({ atteinte: true, ms: Date.now() - debut, dernier, borneBasseMs, latenceMaxMs, lectures });
}

/**
 * Met la lecture en forme, et surtout DÉLIMITE la durée.
 *
 * Une durée de sondage est un INTERVALLE, pas un point : la condition a été vue
 * VRAIE à `ms`, et elle était fausse à la fin de la lecture précédente
 * (`borneBasseMs`). Pourquoi c'est écrit noir sur blanc : une lecture de page
 * peut durer des secondes sur un hôte chargé (re-mise en page, `evaluate`
 * retardé), et cette latence rentre ENTIÈRE dans `ms` sans que le fait ait mis
 * ce temps-là. Relevé du 28/09/2026 : une bascule mesurée à 6 283 ms sur Firefox
 * dont une seule lecture avait pris ~6 s — publiée telle quelle, elle donnait un
 * écart de 104 616 % entre moteurs qui ne mesurait que la lenteur d'une sonde.
 * C'est donc `fourchetteMs[0]` qu'un tableau d'écarts compare ; `ms` reste la
 * borne haute lue, et `latenceMaxMs` nomme le bruit de la sonde pour qui veut
 * juger si la fourchette est serrée.
 */
function resultat({ atteinte, ms, dernier, borneBasseMs, latenceMaxMs, lectures }) {
  return { atteinte, ms, dernier, borneBasseMs, latenceMaxMs, lectures, fourchetteMs: [borneBasseMs, ms] };
}

/** Fenêtre de calme par défaut, en millisecondes : sans requête nouvelle, le chargement est fini. */
export const CALME_MS = 400;

/**
 * Attend que le JOURNAL DES REQUÊTES se taise : plus aucune requête nouvelle
 * pendant `calmeMs`.
 *
 * C'est la sortie du `waitForTimeout(700)` d'à côté : ce qu'on veut prouver
 * n'est pas « 700 ms se sont écoulées » mais « plus rien n'arrive » — un
 * `useEffect` tardif qui monterait une iframe tombe dans cette fenêtre, et il y
 * tombe aussi sur un moteur plus lent, où 700 ms ne suffisaient pas.
 *
 * @param {{derniere: number, total: number}} journal Compteur tenu par l'appelant
 *   dans son écouteur `page.on('request')` : l'instant de la dernière requête et
 *   son nombre, pour que le relevé soit celui de la PAGE et non d'un sondage.
 * @param {{calmeMs?: number, plafondMs?: number, pasMs?: number}} [options]
 * @returns {Promise<{silence: boolean, ms: number, requetes: number}>}
 */
export async function attendreLeSilenceDesRequetes(journal, options = {}) {
  const calmeMs = options.calmeMs ?? CALME_MS;
  const plafondMs = options.plafondMs ?? PLAFOND_ATTENTE_MS;
  const pasMs = options.pasMs ?? PAS_SONDAGE_MS;
  const debut = Date.now();
  for (;;) {
    const calmeDepuis = Date.now() - journal.derniere;
    if (journal.derniere > 0 && calmeDepuis >= calmeMs) {
      return { silence: true, ms: Date.now() - debut, requetes: journal.total };
    }
    if (Date.now() - debut >= plafondMs) {
      return { silence: false, ms: Date.now() - debut, requetes: journal.total };
    }
    await new Promise((resoudre) => setTimeout(resoudre, pasMs));
  }
}

/**
 * Un journal de requêtes : à poser sur une page, et à lire ensuite.
 *
 * @param {import('@playwright/test').Page} page Page à écouter.
 * @param {(url: string) => boolean} [filtre] Ne compter que certaines URL
 *   (par défaut : tout ce que la page demande).
 * @returns {{urls: string[], filtre: Function, derniere: number, total: number}}
 */
export function surveillerLesRequetes(page, filtre = () => true) {
  const journal = { urls: [], derniere: 0, total: 0 };
  page.on('request', (requete) => {
    if (!filtre(requete.url())) return;
    journal.urls.push(requete.url());
    journal.derniere = Date.now();
    journal.total += 1;
  });
  return journal;
}
