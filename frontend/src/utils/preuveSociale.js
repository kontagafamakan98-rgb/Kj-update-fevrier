/**
 * LA PREUVE SOCIALE DE L'ACCUEIL — ce que la bande de faits affiche, et ce
 * qu'elle refuse d'inventer.
 *
 * ── Le défaut que ce module ferme ───────────────────────────────────────────
 * L'accueil a publié des compteurs FABRIQUÉS (« 1 000+ travailleurs »,
 * « 500+ projets ») jusqu'au 07/10/2026 : le HTML pré-rendu les servait à un
 * crawler et le premier paint les montrait à un visiteur, comme s'ils étaient
 * mesurés. Ils ont été retirés, et la bande ne portait plus que des faits
 * vérifiables (4 pays, support 7j/7).
 *
 * Depuis le 22/10/2026 elle porte AUSSI la preuve mesurée par
 * `GET /api/public/stats` (travailleurs, missions terminées, avis). La règle
 * qui rend les deux compatibles est ici, et nulle part ailleurs :
 *
 *   • un chiffre MESURÉ s'affiche tel quel — zéro compris. Un « 0 » publié est
 *     une mesure ; c'est le taire qui serait un mensonge par omission (même
 *     doctrine que les taux d'arbitrage : « 0 % publié reste une mesure ») ;
 *   • une mesure ABSENTE (pas encore de réponse, panne réseau, champ manquant
 *     ou non numérique) laisse le texte DÉCLARÉ du plan — « — », qui ne dit
 *     rien d'autre que « pas mesuré ici ». Aucun repli chiffré n'existe ;
 *   • la valeur est formatée par la LANGUE COURANTE (`Intl.NumberFormat`) :
 *     « 1 250 » en français, « 1,250 » en anglais — un séparateur recopié à la
 *     main se tromperait sur l'une des cinq langues du site.
 *
 * Ce module ne lit ni réseau ni DOM : l'appel vit dans la page (`Home.js`), et
 * la règle se juge ici, sans navigateur (voir son test).
 */

/** Le pont entre une entrée du plan d'accueil et le champ de `/public/stats`. */
export const MESURES_DE_PREUVE = {
  measuredWorkers: 'workers',
  measuredCompletedJobs: 'completed_jobs',
  measuredReviews: 'reviews',
};

/**
 * Un nombre lisible dans la langue demandée, ou `null` si l'entrée n'est pas
 * un nombre fini.
 *
 * Le repli sur le français est EXPLICITE : `Intl` ne lève pas forcément sur une
 * étiquette inconnue — il retombe en silence sur la locale par défaut du
 * runtime (`en-US` sur le runner de CI), donc un séparateur anglais aurait été
 * présenté comme le repli français. Les cinq langues publiées sont donc le seul
 * arbitre, et `fr` le seul repli.
 */
export function nombreLisible(valeur, langue) {
  if (typeof valeur !== 'number' || !Number.isFinite(valeur)) return null;
  const demandee = String(langue || 'fr');
  // `toLocaleString` après le filtre : la langue est toujours l'une des cinq
  // publiées ou `fr`, donc jamais une étiquette qu'`Intl` refuserait.
  return valeur.toLocaleString(/^(fr|en|wo|bm|mos)$/.test(demandee) ? demandee : 'fr');
}

/**
 * La valeur affichée pour une entrée de `PAGE_SECTIONS['/'].stats`.
 *
 * @param {{labelKey: string, fallback: string}} stat  l'entrée DÉCLARÉE.
 * @param {object|null} mesures  la réponse de `/public/stats`, ou `null`.
 * @param {string} langue  code de langue courant (`fr`, `en`, `wo`…).
 * @returns {string} le chiffre mesuré formaté, ou le texte déclaré.
 */
export function valeurDePreuve(stat, mesures, langue) {
  const champ = MESURES_DE_PREUVE[stat?.labelKey];
  // `?? stat.fallback` et non `||` : un « 0 » formaté est une chaîne NON vide,
  // donc une mesure publiée — le seul cas de repli est l'absence de mesure.
  return nombreLisible(champ && mesures ? mesures[champ] : undefined, langue) ?? stat.fallback;
}
