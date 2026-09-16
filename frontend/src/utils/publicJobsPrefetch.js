// ── Préchargement PARALLÈLE de la liste publique (découverte) ───────────────
//
// Sans lui, la liste n'était demandée qu'APRÈS que le chunk lazy soit chargé,
// que React monte le composant ET que son useEffect s'exécute — une cascade
// réseau (chunk → boot React → fetch → rendu liste) qui retardait le LCP de
// /jobs. La requête publique par défaut (découverte : status open, 1re page)
// est donc démarrée dès l'ÉVALUATION du module du chunk, EN PARALLÈLE du boot
// React et du montage ; le composant réutilise le résultat au lieu d'en refaire
// une (cf. consumePublicJobsPrefetch).
//
// Volontairement limité à la vue « Découvrir » publique, déterministe et sans
// état utilisateur : les onglets « Mes candidatures » / « Mes missions » et les
// filtres dépendent de l'utilisateur/URL, connus seulement au montage — ils
// chargent comme avant. Un échec du préchargement est bénin : le cache reste
// null et le composant recharge normalement.
//
// Extrait de Jobs.js dans une FABRIQUE pour être testable sans navigateur ni
// réseau (voir utils/__tests__/publicJobsPrefetch.test.js) : cette optimisation
// n'avait aucun test, donc rien n'empêchait sa déduplication ou sa
// consommation de casser silencieusement (au prix d'une requête en double, ou
// d'un préchargement jamais réutilisé).

/**
 * Un vrai navigateur est-il disponible ? Évité sous jsdom/tests ainsi que dans
 * tout environnement sans localStorage (SSR, pré-rendu).
 */
export const canUseNetworkPrefetch = () =>
  typeof window !== 'undefined' &&
  typeof window.localStorage !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !/jsdom/.test(String(navigator && navigator.userAgent));

/**
 * Construit un préchargement de liste publique.
 *
 * @param {object} deps
 * @param {{getAll: Function}} deps.jobsAPI  Service de liste (jobsAPI).
 * @param {Function} deps.normalizeJobList   Normalisation des enregistrements.
 * @param {{warn: Function}} deps.safeLog    Logger non bloquant.
 * @param {number} deps.pageSize             Taille de page de la liste (JOBS_PAGE_SIZE).
 * @param {boolean} [deps.enabled]           Force/neutralise le préchargement (tests).
 * @returns {{kick: Function, consume: Function, matches: Function, params: object, pending: object|null}}
 */
export const makePublicJobsPrefetch = ({
  jobsAPI,
  normalizeJobList,
  safeLog,
  pageSize,
  enabled,
}) => {
  const params = { limit: pageSize, page: 1, status: 'open' };
  const isEnabled = enabled === undefined ? canUseNetworkPrefetch() : Boolean(enabled);

  // { requestParams, promise } | null — null après consommation (ou si le
  // préchargement n'a pas été lancé). Réinitialisé après usage pour ne pas
  // resservir un résultat périmé sur une NAVIGATION ultérieure.
  let pending = null;

  // Compare les params réels du composant à ceux du préchargement : on ne
  // réutilise le cache que pour la MÊME requête (découverte, 1re page, open,
  // sans filtre/mine/ids). Tout écart → on recharge normalement.
  const matches = (requestParams = {}) =>
    requestParams.limit === pageSize &&
    requestParams.page === 1 &&
    requestParams.status === 'open' &&
    !requestParams.q &&
    !requestParams.category &&
    !requestParams.mine &&
    !requestParams.ids;

  // Déduplique : un second appel pendant que la requête est en vol renvoie le
  // même cache au lieu de lancer une requête concurrente.
  const kick = () => {
    if (!isEnabled) return null;
    if (pending && pending.promise) return pending;
    const promise = jobsAPI
      .getAll(params)
      .then((response) =>
        normalizeJobList(Array.isArray(response) ? response : response?.data || [])
      )
      .catch((error) => {
        // Bénin : laisse le cache null pour que le composant recharge seul.
        safeLog.warn('Public jobs prefetch failed (component will reload)', error);
        return null;
      });
    pending = { requestParams: params, promise };
    return pending;
  };

  // Consomme le préchargement depuis le chargement de la liste : si la requête
  // demandée correspond à celle déjà lancée en parallèle, on l'attend au lieu
  // d'en refaire une. Renvoie null si non consommable (le composant recharge).
  const consume = async (requestParams) => {
    if (!matches(requestParams)) return null;
    if (!pending || !pending.promise) return null;
    const jobs = await pending.promise;
    pending = null;
    if (!jobs) return null; // échec → laisser le composant refaire sa requête
    return { jobs, hasMore: jobs.length === pageSize };
  };

  return {
    kick,
    consume,
    matches,
    params,
    get pending() {
      return pending;
    },
  };
};

export default makePublicJobsPrefetch;
