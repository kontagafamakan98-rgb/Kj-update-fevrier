import { useEffect, useRef, useState } from 'react';
import { jobsAPI } from '../services/apiEndpoints';
import { handleApiError } from '../services/api';
import { normalizeJobList } from '../utils/jobDisplayBridge';
import { safeLog } from '../utils/env';

export const JOB_TAB_DISCOVER = 'discover';
export const JOB_TAB_APPLICATIONS = 'applications';
export const JOB_TAB_MISSIONS = 'missions';
export const JOBS_PAGE_SIZE = 12;

export function useJobsData({ effectiveTab, filters, setFilters, searchParams, user, errorMessages, consumePrefetch }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [appliedJobIds, setAppliedJobIds] = useState(null);
  const requestSequence = useRef(0);

  const loadJobs = async ({ append = false, page: requestedPage = null } = {}) => {
    const requestId = ++requestSequence.current;
    const targetPage = requestedPage ?? (append ? page + 1 : 1);
    append ? setLoadingMore(true) : setLoading(true);
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

      if (!append && effectiveTab === JOB_TAB_DISCOVER) {
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
