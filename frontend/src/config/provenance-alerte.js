/**
 * LA PROVENANCE D'UNE ALERTE EMPLOI (29/10/2026).
 *
 * Une veille se crée TOUJOURS depuis `/jobs` : c'est la carte de cette page qui
 * la pose. Ce qui manquait n'est donc pas la page d'ARRIVÉE mais la page de
 * DÉPART — celle qu'un visiteur lisait quand il a cliqué. Les pages ville et
 * métier servies par le backend (`/emplois/bamako`, `/metiers/plomberie`)
 * déclarent la leur dans leur lien (`&origine=ville`, `&origine=metier`, cf.
 * `backend/kojo_pages_metier.py`) et cette page la transmet telle quelle.
 *
 * RÈGLE : une valeur inconnue de l'URL ne part JAMAIS au serveur. Le backend
 * refuse une provenance hors vocabulaire (422) — c'est ce qu'il faut d'un
 * client qui ment —, mais un lien externe mal recopié ne doit pas empêcher un
 * travailleur de créer son alerte : elle retombe donc sur `directe`, qui dit
 * la vérité (« il est arrivé sur /jobs sans page d'origine déclarée »).
 *
 * `directe` et non `inconnue` : l'absence de provenance DANS L'URL est un fait
 * mesuré, alors que `inconnue` est réservée au serveur pour un client muet —
 * une version d'avant ce champ, dont on ne sait vraiment rien.
 *
 * La liste est la même que `backend/kojo_job_alerts.ORIGINES_ALERTE`, et deux
 * gardes la comparent de part et d'autre (aucune des deux applications ne lit
 * les fichiers de l'autre au runtime : elles sont déployées séparément).
 */
export const ORIGINES_ALERTE = ['ville', 'metier', 'directe'];

/** Ce que déclare une arrivée sur `/jobs` sans page d'origine. */
export const ORIGINE_PAR_DEFAUT = 'directe';

/**
 * La provenance portée par l'URL, ou `directe`.
 *
 * Lit le paramètre `origine` du lien d'une page ville ou métier. Une valeur
 * hors vocabulaire (lien tronqué, paramètre ajouté à la main) est RAMENÉE au
 * défaut au lieu d'être transmise : envoyer « n-importe-quoi » ferait refuser
 * la création de l'alerte pour une faute qui ne concerne pas le visiteur.
 *
 * @param {string|null|undefined} valeur La valeur brute de `?origine=`.
 * @returns {'ville'|'metier'|'directe'} Une valeur du vocabulaire, jamais autre chose.
 */
export function origineDepuisURL(valeur) {
  const candidate = String(valeur ?? '')
    .trim()
    .toLowerCase();
  return ORIGINES_ALERTE.includes(candidate) ? candidate : ORIGINE_PAR_DEFAUT;
}
