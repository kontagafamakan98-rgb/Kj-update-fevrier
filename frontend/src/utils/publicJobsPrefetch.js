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
 * @returns {{kick: Function, consume: Function, snapshot: Function, matches: Function, params: object, pending: object|null}}
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
    pending = { requestParams: params, promise, settled: false, value: null };
    promise.then((jobs) => {
      // Ne renseigne l'état QUE pour la requête encore en cours : `consume`
      // remet `pending` à null, une réponse tardive ne doit pas ressusciter un
      // résultat déjà consommé.
      if (pending && pending.promise === promise) {
        pending.settled = true;
        pending.value = jobs;
      }
    });
    return pending;
  };

  // ── Lecture PENDANT LE RENDU (React) ──────────────────────────────────────
  // `kick` a lancé la requête à l'évaluation du chunk ; `consume` ne peut la
  // reprendre que depuis un effet, donc APRÈS le premier rendu de la page. Entre
  // les deux, `snapshot` rend l'état lisible SANS consommer, ce qui permet à la
  // page de démarrer SEEDÉE quand la réponse est déjà arrivée :
  //   { applicable: false }             → requête hors préchargement
  //   { applicable: true, value: null } → rien à seeder (en vol, ou en échec) :
  //                                       la page peint son propre écran de
  //                                       chargement et attend la réponse
  //   { applicable: true, value }       → liste déjà en main, aucun squelette
  //
  // `snapshot` a aussi servi à SUSPENDRE : la promesse en vol était jetée pour
  // garder le fallback Suspense de la route monté. Le calcul ne portait que sur
  // le TRAVAIL de rendu, pas sur la peinture, et la mesure a tranché contre lui
  // (Chrome 152, /jobs desktop, 3 runs) : le fallback remplaçait le titre, la
  // date et le paragraphe d'intro — l'élément LCP — par des barres grises de
  // 377 ms à 2487 ms, soit 2,1 s de plus grand texte absent le temps de l'API ;
  // Render Delay du LCP 1156 à 2345 ms, `observedLastVisualChange` jusqu'à
  // 9,6 s et Speed Index 3008 / 5246 / 4573, seule note sous 1,00 du profil.
  // La page peint donc son premier écran immédiatement (texte réel + squelette
  // de liste) et seule la liste attend la réponse. Le champ `pending` (la
  // promesse à jeter) est RETIRÉ plutôt que laissé inerte : personne ne doit
  // croire la page suspendue par un état que plus aucun appelant ne consomme.
  const snapshot = (requestParams = {}) => {
    if (!isEnabled || !matches(requestParams)) return { applicable: false };
    if (!pending || !pending.promise || !pending.settled) return { applicable: true, value: null };
    return { applicable: true, value: pending.value };
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
    snapshot,
    matches,
    params,
    get pending() {
      return pending;
    },
  };
};

export default makePublicJobsPrefetch;
