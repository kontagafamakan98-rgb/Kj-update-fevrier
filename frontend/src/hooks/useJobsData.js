import { useEffect, useRef, useState } from 'react';
import { jobsAPI } from '../services/apiEndpoints';
import { handleApiError } from '../services/api';
import { normalizeJobList } from '../utils/jobDisplayBridge';
import { safeLog } from '../utils/env';

export const JOB_TAB_DISCOVER = 'discover';
export const JOB_TAB_APPLICATIONS = 'applications';
export const JOB_TAB_MISSIONS = 'missions';
export const JOBS_PAGE_SIZE = 12;

export function useJobsData({ effectiveTab, filters, setFilters, searchParams, user, errorMessages, prefetch }) {
  const consumePrefetch = prefetch?.consume;
  const snapshotPrefetch = prefetch?.snapshot;

  // ── Le préchargement est lu PENDANT LE RENDU, pas dans un effet ────────────
  // `kickPublicJobsPrefetch()` part à l'ÉVALUATION du chunk, donc avant ce
  // premier rendu ; un effet arrive après le commit, et le premier rendu
  // n'aurait alors rien à afficher.
  //
  // Il a été lu ici pour SUSPENDRE : le hook jetait la promesse du
  // préchargement, ce qui gardait monté le fallback Suspense de la route
  // (JobsSkeleton) au lieu de laisser la page monter son propre squelette — un
  // seul passage de mise en page de 12 cartes au lieu de deux. C'était le bon
  // calcul pour le travail de rendu, pas pour la peinture : mesuré sur /jobs en
  // desktop (Chrome 152, pile de la CI, 3 runs), le fallback remplaçait le texte
  // RÉEL de la coquille — titre, date et surtout le paragraphe d'intro, qui est
  // l'élément LCP — par des barres grises de 377 ms à 2487 ms, soit 2,1 s de
  // plus grand texte absent pendant que l'API répondait. Conséquence sur les
  // métriques : Render Delay du LCP de 1156 à 2345 ms, `observedLastVisualChange`
  // jusqu'à 9,6 s et un Speed Index à 3008 / 5246 / 4573 — la SEULE note sous
  // 1,00 du profil desktop (FCP, LCP, TBT et CLS y étaient tous parfaits).
  //
  // Le compromis est donc inversé : la page peint son premier écran
  // immédiatement — texte réel + squelette de LISTE, la même hauteur — et seule
  // la liste attend la réponse. Le fallback Suspense ne couvre plus que le
  // chargement du chunk, déjà préchargé (`modulepreload`, mesuré ~20 ms), donc
  // la passe de mise en page que la suspension supprimait n'existe plus de
  // toute façon.
  //
  // Deux cas en lisant l'état du préchargement ici :
  //   • il est EN VOL → `loading` naît vrai : la page peint son propre écran de
  //     chargement et la liste réelle arrive quand la requête répond ;
  //   • il est DÉJÀ ARRIVÉ → la page démarre seedée (liste réelle au premier
  //     rendu, aucun squelette côté page) et `loading` naît faux : rejouer
  //     `loading = true` ferait clignoter le squelette une image de plus.
  //
  // Le préchargement ne couvre QUE la vue « Découvrir » sans filtre : les
  // params ci-dessous sont exactement ceux de `loadJobs`, donc `matches()` est
  // faux pour tout autre onglet (mine/ids présents) ou tout filtre actif
  // (q/category renseignés), et la page suit son chemin normal.
  const prefetchParams = {
    limit: JOBS_PAGE_SIZE,
    page: 1,
    q: filters.search.trim() || undefined,
    category: filters.category || undefined,
    mine: effectiveTab === JOB_TAB_MISSIONS
      ? (user?.user_type === 'client' ? 'posted' : 'assigned')
      : undefined,
    ids: effectiveTab === JOB_TAB_APPLICATIONS ? 'applications' : undefined,
    status: effectiveTab === JOB_TAB_DISCOVER ? 'open' : filters.status || 'open',
  };
  // Aucune impurity : `snapshot` ne consomme rien, c'est l'effet qui consomme.
  const prefetchState = snapshotPrefetch ? snapshotPrefetch(prefetchParams) : null;
  const seed = prefetchState?.value
    ? { jobs: prefetchState.value, hasMore: prefetchState.value.length === JOBS_PAGE_SIZE }
    : null;

  const [jobs, setJobs] = useState(() => seed?.jobs ?? []);
  const [loading, setLoading] = useState(() => !seed);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(() => seed?.hasMore ?? false);
  const [loadError, setLoadError] = useState(null);
  const [appliedJobIds, setAppliedJobIds] = useState(null);
  const requestSequence = useRef(0);

  const loadJobs = async ({ append = false, page: requestedPage = null } = {}) => {
    const requestId = ++requestSequence.current;
    const targetPage = requestedPage ?? (append ? page + 1 : 1);
    // Sur la charge INITIALE déjà seedée par le préchargement, `loading` doit
    // rester faux : le remettre à vrai ferait rendre le squelette au lieu de la
    // liste — soit exactement la passe de mise en page que ce chemin supprime.
    append ? setLoadingMore(true) : setLoading(!seed);
    setLoadError(null);

    try {
      const params = { limit: JOBS_PAGE_SIZE, page: targetPage };
      if (filters.search.trim()) params.q = filters.search.trim();
      if (filters.category) params.category = filters.category;

      if (effectiveTab === JOB_TAB_MISSIONS) {
        params.mine = user?.user_type === 'client' ? 'posted' : 'assigned';
      } else if (effectiveTab === JOB_TAB_APPLICATIONS) {
        const response = await jobsAPI.getMyProposals();
        const proposals = Array.isArray(response) ? response : response?.data || [];
        const ids = proposals.map((proposal) => proposal.job_id).filter(Boolean);
        if (!ids.length) {
          if (requestId !== requestSequence.current) return;
          setJobs([]);
          setHasMore(false);
          return;
        }
        params.ids = ids.join(',');
      } else {
        params.status = 'open';
      }
      if (effectiveTab !== JOB_TAB_DISCOVER && filters.status) params.status = filters.status;

      if (!append && effectiveTab === JOB_TAB_DISCOVER && consumePrefetch) {
        const prefetched = await consumePrefetch(params);
        if (prefetched) {
          if (requestId !== requestSequence.current) return;
          setJobs(prefetched.jobs);
          setPage(1);
          setHasMore(prefetched.hasMore);
          return;
        }
      }

      const response = await jobsAPI.getAll(params);
      const nextJobs = normalizeJobList(Array.isArray(response) ? response : response?.data || []);
      if (requestId !== requestSequence.current) return;
      setJobs((previous) => (append ? [...previous, ...nextJobs] : nextJobs));
      setPage(targetPage);
      setHasMore(nextJobs.length === JOBS_PAGE_SIZE);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      safeLog.error('Jobs load error', error);
      const networkFailure = !error?.response;
      const fallback = networkFailure ? errorMessages.network : errorMessages.server;
      setLoadError({
        reseau: networkFailure,
        message: handleApiError(error, fallback),
        requete: { append, page: targetPage },
      });
      if (!append) setJobs([]);
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    const category = searchParams.get('category') || '';
    setFilters((previous) => previous.category === category ? previous : { ...previous, category });
    if (user?.user_type === 'worker') {
      jobsAPI.getMyProposals()
        .then((response) => {
          const proposals = Array.isArray(response) ? response : response?.data || [];
          setAppliedJobIds(new Set(proposals.map((proposal) => String(proposal.job_id)).filter(Boolean)));
        })
        .catch((error) => safeLog.error('Failed to load my proposals', error));
    } else {
      setAppliedJobIds(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user?.id, user?.user_type]);

  useEffect(() => {
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTab, filters.search, filters.category, filters.status, user?.id, user?.user_type]);

  return {
    jobs,
    loading,
    loadingMore,
    page,
    hasMore,
    loadError,
    appliedJobIds,
    loadJobs,
    retry: () => loadJobs(loadError?.requete || {}),
  };
}
