/**
 * LA RÈGLE D'AVANCE DE LA ROTATION DU HÉROS, SORTIE DE LA SONDE POUR ÊTRE
 * PROUVÉE SUR DES JOURNAUX RÉELS.
 *
 * Pourquoi ce module existe : la sonde `e2e/heros-rotation.spec.js` mesure des
 * écarts entre remplacements de photo, et deux d'entre eux ne se mesurent pas
 * comme les autres. Le PREMIER part de l'ANCRE (le montage), un instant lu par
 * un rappel de `MutationObserver` — donc en retard de la latence du runner —,
 * tandis que les suivants séparent deux mutations observées par le MÊME rappel,
 * dont la latence se compense. Une seule marge pour les deux a rendu un rouge le
 * 24/10/2026 sur un artefact sain (run 400639740 : écarts
 * [14524,3 ; 14999,2 ; 15000] ms pour un intervalle déclaré de 15 000 ms).
 *
 * La règle est ici, PURE, pour que le test puisse la faire tourner sur ce
 * journal-là et sur un vrai défaut (un second minuteur) sans monter une page :
 * une tolérance qu'on ne peut pas contredire est une tolérance qui dérive.
 */

/**
 * Les écarts qui avancent PLUS VITE que l'intervalle déclaré.
 *
 * @param {object} options
 * @param {number[]} options.ecarts Écarts mesurés, en ms, dans l'ordre.
 * @param {number} options.delai Intervalle déclaré par le composant, en ms.
 * @param {number} options.margeEntreCrans Marge sous l'intervalle pour un écart
 *   entre deux changements observés (ms).
 * @param {number} options.toleranceAncre Marge sous l'intervalle pour le PREMIER
 *   écart, ancré au montage (ms). Couvre la latence du rappel d'observateur,
 *   qui ne peut QUE retarder l'ancre — jamais l'avancer.
 * @returns {Array<{e: number, i: number, marge: number}>} Les écarts fautifs,
 *   avec leur rang (1 = premier cran) et la marge qui leur a été appliquée.
 */
export const ecartsSousLIntervalle = ({ ecarts, delai, margeEntreCrans, toleranceAncre }) =>
  ecarts
    .map((e, i) => ({ e, i, marge: i === 0 ? toleranceAncre : margeEntreCrans }))
    .filter(({ e, marge }) => e < delai - marge);
