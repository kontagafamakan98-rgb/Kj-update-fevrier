// RÈGLE : UN BUDGET DE VIVACITÉ SE DÉRIVE D'UNE MESURE, IL NE S'EMPRUNTE PAS —
// le module que lit le parcours d'import (`scripts/__tests__/import-health.test.js`),
// qui prononce le verdict.
//
// ── Le défaut, mesuré deux fois plutôt que supposé ──────────────────────────
// Le parcours principal de `import-health` importe ~180 modules ; à froid, seul,
// il lui faut ~7 s sur ce poste. Sous la charge de la suite complète, il a
// dépassé plus d'une fois les 20 s du `testTimeout` GLOBAL (`vite.config.js`) —
// un délai dimensionné pour les gardes qui LANCENT un sous-processus, pas pour ce
// travail-ci. Le test empruntait donc une borne taillée pour un autre, et la CI
// rougissait au hasard : le verdict portait sur la MACHINE. C'est le même défaut
// que celui du garde de hauteur du document pré-rendu, corrigé ailleurs en
// remplaçant un nombre de pixels absolu par une STRUCTURE ; ici, la forme
// portable est un budget DÉRIVÉ.
//
// ── La correction, et pourquoi ce n'est pas « élargir la constante » ────────
// Élargir la constante serait le même défaut en plus large : un rouge qui accuse
// le code pour la lenteur de l'hôte serait simplement plus rare, et personne ne
// saurait plus quand il est vrai. Le budget est donc DÉRIVÉ d'une mesure prise à
// l'exécution : on importe un ÉCHANTILLON de modules du périmètre, on mesure, et
// on extrapole au nombre total avec une marge. Un hôte deux fois plus lent obtient
// un budget deux fois plus grand.
//
// ── Les trois garde-fous, et pourquoi ils ne sont pas décoratifs ────────────
//   • PLANCHER — sur un hôte sain, l'extrapolation vaut moins que ce plancher, et
//     c'est voulu : la zone de flottement observée (≈ 3× la durée solo, donc une
//     vingtaine de secondes sous 85 fichiers) doit être franchie sans bruit.
//   • PLAFOND — un budget élastique sans plafond ne tue plus un vrai blocage : il
//     faudrait attendre un quart d'heure pour apprendre qu'une importation pend.
//   • MARGE — l'extrapolation est linéaire alors que le coût ne l'est pas tout à
//     fait (premiers modules plus lourds, cache à froid). La marge couvre la
//     non-linéarité, PAS la lenteur de l'hôte — celle-ci est déjà mesurée.
//
// ── Ce qui a été mesuré (27/09/2026) ────────────────────────────────────────
// Les 10 premiers modules coûtent 2 615 ms à froid (transformation du graphe par
// Vite), soit 261 ms/module — alors que le parcours COMPLET des 179 modules prend
// 8,8 s, soit 49 ms/module. L'extrapolation linéaire SURESTIME donc d'un facteur
// ~5,3 sur ce poste, et c'est pourquoi la marge vaut 2 et non 6 : elle doit
// couvrir la non-linéarité RÉSIDUELLE, pas doubler une surestimation déjà
// mesurée. Budget obtenu ici : ~78-93 s, contre les 20 s empruntés d'avant (10×
// la durée réelle du parcours) et sous le plafond de 300 s.
//
// ── Ce que le module NE fait PAS (angles morts publiés) ─────────────────────
//   • Il ne décide RIEN de la santé des modules : un module qui ne s'importe pas
//     reste une erreur de module, comptée et nommée. Un budget épuisé lève un
//     `BudgetDeVivaciteEpuise` — les confondre accuserait le code pour la lenteur
//     de la machine, exactement le défaut d'origine.
//   • Il ne mesure pas la charge de la machine, seulement le coût du travail
//     qu'on lui demande : deux hôtes à égalité de charge mais de vitesse
//     différente obtiennent des budgets différents, ce qui est le but.
//   • Il ne prétend pas calibrer sans horloge : mesure absente, nulle ou
//     échantillon vide, il rend le plancher — un fait publié, pas un silence.

/** Modules importés à froid pour estimer le coût unitaire. */
export const ÉCHANTILLON_DE_CALIBRATION = 10;

/** Marge sur l'extrapolation — couvre la non-linéarité, pas la lenteur de l'hôte. */
export const MARGE_DE_VIVACITE = 2;

/** Sous ce nombre, le budget n'est plus une mesure : la zone de flottement connue. */
export const PLANCHER_DE_VIVACITE = 60_000;

/** Au-dessus, ce n'est plus un budget : un vrai blocage doit mourir. */
export const PLAFOND_DE_VIVACITE = 300_000;

/**
 * Budget (ms) DÉRIVÉ d'une mesure, avec plancher et plafond. Fonction PURE : le
 * budget ne dépend que de ses arguments, donc il est éprouvable sans horloge et
 * sans machine — et c'est ce qui rend le verdict portable.
 *
 * @param {{tempsEchantillonMs: number, modulesEchantillon: number, modulesTotal: number,
 *          marge?: number, plancher?: number, plafond?: number}} mesure
 * @returns {number} le budget en millisecondes
 */
export function budgetDeVivacite({
  tempsEchantillonMs,
  modulesEchantillon,
  modulesTotal,
  marge = MARGE_DE_VIVACITE,
  plancher = PLANCHER_DE_VIVACITE,
  plafond = PLAFOND_DE_VIVACITE,
} = {}) {
  const temps = Number(tempsEchantillonMs);
  const echantillon = Number(modulesEchantillon) || 0;
  const total = Math.max(echantillon, Number(modulesTotal) || 0);
  // Sans mesure exploitable (`performance` absent, échantillon vide, temps nul),
  // on ne prétend PAS calibrer — et on ne divise pas par un 1 fabriqué pour faire
  // bonne figure : le plancher fait office de budget, et c'est un fait publié,
  // pas un silence.
  if (!Number.isFinite(temps) || temps <= 0 || echantillon === 0) return plancher;
  const estimation = (temps / echantillon) * total;
  return Math.min(plafond, Math.max(plancher, Math.round(estimation * marge)));
}

/** Un budget épuisé n'est pas un module cassé : c'est une vivacité, et ça se dit. */
export class BudgetDeVivaciteEpuise extends Error {
  constructor(message, { budget, modules, ecoules }) {
    super(message);
    this.name = 'BudgetDeVivaciteEpuise';
    this.budget = budget;
    this.modules = modules;
    this.ecoules = ecoules;
  }
}

/**
 * Ce que ce budget voit, et ce qu'il ne peut pas voir — publié pour être comparé
 * au relevé de CI-COVERAGE.md, pas pour être cru.
 */
export const CE_QUE_CE_BUDGET_VOIT = {
  voit: [
    'le COÛT DU TRAVAIL demandé (importer ~180 modules), mesuré à l’exécution sur un échantillon, et extrapolé : un hôte deux fois plus lent obtient un budget deux fois plus grand',
    'les deux bornes de l’élasticité : un plancher pour la zone de flottement connue (≈ 3× la durée solo), un plafond pour qu’un vrai blocage meure encore',
    'la distinction entre un BUDGET ÉPUISÉ (`BudgetDeVivaciteEpuise`) et un MODULE CASSÉ : le premier n’accuse jamais le code',
  ],
  nePeutPasVoir: [
    'la charge de la machine : seule la vitesse du travail demandé est mesurée',
    'un module dont l’importation PEND sans consommer de temps mesurable sur l’échantillon : le plafond finit par le tuer, mais tard',
    'la justesse de l’échantillon comme représentant du parcours (les 10 premiers modules sont les plus lourds, d’où une surestimation mesurée d’un facteur ~5,3, absorbée par la marge et non par une constante)',
  ],
};
