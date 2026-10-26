// ============================================================================
// LA PREUVE SOCIALE DE L'ACCUEIL : un SEUIL, un ÉTAT D'ATTENTE, jamais un zéro.
//
// ── Ce que ce module décide, et pourquoi il existe (26/10/2026) ─────────────
// La bande de faits de l'accueil a publié trois compteurs lus de
// `GET /api/public/stats` du 22/10 au 26/10. En production, faute de missions,
// elle affichait « 3 travailleurs · 0 mission terminée · 0 avis » : deux zéros
// alignés au seuil d'une page qui vend la confiance. La correction du 26/10 a
// retiré les compteurs ET l'appel — mais elle a laissé la bande sans aucune
// preuve de ce que la plateforme a réellement fait.
//
// Ce module rétablit la preuve avec la règle inverse : un chiffre n'est publié
// que lorsqu'il PROUVE quelque chose. Trois missions terminées et deux avis
// forment le plancher ; en dessous, la bande publie un état d'attente («
// chiffres à venir ») au lieu d'un petit nombre qui se lirait comme un test.
//
// ── Pourquoi deux seuils, et pourquoi ces valeurs-là ────────────────────────
// `SEUIL_MISSIONS_TERMINEES = 3` : deux missions terminées peuvent être les
// essais du propriétaire lui-même ; trois engagent une plateforme.
// `SEUIL_AVIS = 2` : un avis unique ne fait pas une réputation, et deux est le
// premier nombre dont le PLURIEL est juste dans les cinq langues du site — le
// singulier demanderait une forme par langue que personne n'a écrite, donc la
// bande ne peut pas le publier. Le seuil n'est donc pas une opinion sur la
// qualité : c'est aussi ce qui rend la phrase traduisible telle quelle.
//
// ── Trois états, jamais deux ────────────────────────────────────────────────
//   • `mesure`   : les deux compteurs sont lisibles ET au-dessus des seuils ;
//   • `attente`  : l'un des deux est sous son seuil (le fait existe, il ne
//                  prouve pas encore) ;
//   • `attente`  aussi pour une lecture ILLISIBLE : une réponse absente, un
//     champ manquant, un NaN ou un négatif ne sont pas des mesures. Une panne
//     qui se lirait « chiffres à venir » ne ment pas ; une panne qui se lirait
//     « 0 » mentirait exactement comme le 26/10.
//
// Ce module ne connaît NI React NI les dictionnaires : il rend des NOMBRES et
// un état. La phrase qui les porte appartient à la page (`Home.js`), qui la
// compose avec `t()` ; le formatage des milliers appartient à `Intl`, donc à la
// langue, et jamais à une constante recopiée.
// ============================================================================

/** Missions terminées minimales pour qu'un chiffre soit publié. */
export const SEUIL_MISSIONS_TERMINEES = 3;

/** Avis minima pour qu'un chiffre soit publié (premier pluriel juste). */
export const SEUIL_AVIS = 2;

/** La bande publie des chiffres mesurés. */
export const ETAT_MESURE = 'mesure';

/** La bande publie son état d'attente : c'est le défaut, pas une erreur. */
export const ETAT_ATTENTE = 'attente';

/**
 * Un compteur publié : un entier positif ou nul. Tout le reste est illisible
 * (chaîne, `null`, `undefined`, `NaN`, flottant, négatif) et ne devient JAMAIS
 * un zéro — c'est la règle qui a coûté un audit le 26/10/2026.
 *
 * @param {unknown} valeur Champ brut de `GET /api/public/stats`.
 * @returns {number|null} Le compteur, ou `null` si la valeur ne se lit pas.
 */
const lireCompteur = (valeur) => (Number.isInteger(valeur) && valeur >= 0 ? valeur : null);

/**
 * L'état de la preuve sociale de l'accueil, à partir de la réponse de l'API.
 *
 * @param {object|null|undefined} stats `{completed_jobs, reviews, …}` ou rien.
 * @returns {{etat: string, missions: number|null, avis: number|null}}
 *   `missions` et `avis` sont les compteurs LUS (même sous le seuil), pour que
 *   le diagnostic puisse dire le fait sans le publier.
 */
export function preuvesDeLAccueil(stats) {
  const missions = lireCompteur(stats?.completed_jobs);
  const avis = lireCompteur(stats?.reviews);

  if (missions === null || avis === null) {
    return { etat: ETAT_ATTENTE, missions, avis };
  }
  if (missions < SEUIL_MISSIONS_TERMINEES || avis < SEUIL_AVIS) {
    return { etat: ETAT_ATTENTE, missions, avis };
  }
  return { etat: ETAT_MESURE, missions, avis };
}

/**
 * Le séparateur de milliers appartient à la LANGUE (`Intl`), pas au code : la
 * repli n'existe que pour un environnement sans `Intl` complet, et il ne
 * prétend pas formater (il rend le nombre tel quel plutôt qu'un groupe inventé).
 *
 * @param {number} valeur Compteur entier positif ou nul.
 * @param {string} [langue] Code de langue (`fr`, `en`, `wo`, `bm`, `mos`).
 * @returns {string}
 */
export function formaterCompteur(valeur, langue = 'fr') {
  if (!Number.isInteger(valeur) || valeur < 0) return String(valeur);
  try {
    return new Intl.NumberFormat(langue).format(valeur);
  } catch (_erreur) {
    return String(valeur);
  }
}
