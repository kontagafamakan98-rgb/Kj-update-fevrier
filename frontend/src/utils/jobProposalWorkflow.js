import { getStoredSessionUser, normalizeComparableId } from './jobPageSafeHelpers';

const STORAGE_KEY = 'kojo_job_applications_v1';

const getStorageBuckets = () => {
  if (typeof window === 'undefined') return [];
  return [window.localStorage, window.sessionStorage].filter(Boolean);
};

const parseStoredMap = () => {
  for (const bucket of getStorageBuckets()) {
    try {
      const raw = bucket.getItem(STORAGE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_error) {}
  }
  return {};
};

const persistStoredMap = (value) => {
  const serialized = JSON.stringify(value || {});
  for (const bucket of getStorageBuckets()) {
    try {
      bucket.setItem(STORAGE_KEY, serialized);
    } catch (_error) {}
  }
};

export const getCurrentUserIdentitySet = (currentUser) => {
  const user = currentUser || getStoredSessionUser();
  return new Set([
    normalizeComparableId(user?._id),
    normalizeComparableId(user?.id),
    normalizeComparableId(user?.user_id),
    normalizeComparableId(user?.userId),
  ].filter(Boolean));
};

export const extractProposalId = (proposal) => normalizeComparableId(
  proposal?.id || proposal?._id || proposal?.proposal_id || proposal?.proposalId,
);

export const extractProposalWorkerId = (proposal) => normalizeComparableId(
  proposal?.worker_id ||
  proposal?.workerId ||
  proposal?.worker?.user_id ||
  proposal?.worker?.id ||
  proposal?.worker?._id ||
  proposal?.user_id ||
  proposal?.userId
);

export const extractProposalWorkerName = (proposal, fallback = 'Travailleur') => {
  const name = proposal?.worker_name
    || proposal?.worker?.full_name
    || proposal?.worker?.name
    || [proposal?.worker?.first_name, proposal?.worker?.last_name].filter(Boolean).join(' ').trim();
  return typeof name === 'string' && name.trim() ? name.trim() : fallback;
};

export const extractProposalMessage = (proposal) => {
  const value = proposal?.cover_letter || proposal?.message || proposal?.description || '';
  return typeof value === 'string' ? value.trim() : '';
};

export const normalizeApiList = (response) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.results)) return response.results;
  return [];
};

export const normalizeMessages = (response) => {
  const items = normalizeApiList(response);
  return [...items].sort((left, right) => {
    const leftTime = new Date(left?.created_at || left?.updated_at || 0).getTime() || 0;
    const rightTime = new Date(right?.created_at || right?.updated_at || 0).getTime() || 0;
    return leftTime - rightTime;
  });
};

const getStorageKey = (jobId, user) => {
  const userId = [...getCurrentUserIdentitySet(user)][0];
  const normalizedJobId = normalizeComparableId(jobId);
  if (!userId || !normalizedJobId) return '';
  return `${userId}::${normalizedJobId}`;
};

export const rememberAppliedJob = ({ jobId, proposal, job, user }) => {
  const storageKey = getStorageKey(jobId, user);
  if (!storageKey) return;
  const existing = parseStoredMap();
  existing[storageKey] = {
    job_id: normalizeComparableId(jobId),
    proposal_id: extractProposalId(proposal),
    worker_id: [...getCurrentUserIdentitySet(user)][0] || extractProposalWorkerId(proposal),
    client_id: normalizeComparableId(job?.client_id || job?.clientId || job?.client?.id || job?.client?._id),
    worker_name: proposal?.worker_name || '',
    message: extractProposalMessage(proposal),
    proposed_amount: proposal?.proposed_amount ?? proposal?.amount ?? null,
    estimated_completion_time: proposal?.estimated_completion_time || proposal?.estimated_duration || '',
    created_at: proposal?.created_at || new Date().toISOString(),
  };
  persistStoredMap(existing);
};

export const getRememberedApplication = (jobId, user) => {
  const storageKey = getStorageKey(jobId, user);
  if (!storageKey) return null;
  const existing = parseStoredMap();
  return existing[storageKey] || null;
};

export const getCurrentUserProposal = (proposals, currentUser) => {
  const ids = getCurrentUserIdentitySet(currentUser);
  const items = Array.isArray(proposals) ? proposals : [];
  return items.find((proposal) => ids.has(extractProposalWorkerId(proposal))) || null;
};

export const hasCurrentUserAppliedToJob = (jobId, proposals, currentUser) => {
  if (getCurrentUserProposal(proposals, currentUser)) return true;
  return Boolean(getRememberedApplication(jobId, currentUser));
};

const getSenderId = (message) => normalizeComparableId(
  message?.sender_id || message?.senderId || message?.sender?.id || message?.sender?._id || message?.user_id,
);

const getReceiverId = (message) => normalizeComparableId(
  message?.receiver_id || message?.receiverId || message?.receiver?.id || message?.receiver?._id || message?.target_user_id,
);

export const filterMessagesForPair = (messages, currentUser, otherUserId) => {
  const ids = getCurrentUserIdentitySet(currentUser);
  const counterpartId = normalizeComparableId(otherUserId);
  return normalizeMessages(messages).filter((message) => {
    const senderId = getSenderId(message);
    const receiverId = getReceiverId(message);
    return (ids.has(senderId) && receiverId === counterpartId) || (ids.has(receiverId) && senderId === counterpartId);
  });
};

export const getCounterpartForWorker = (job) => ({
  id: normalizeComparableId(job?.client_id || job?.clientId || job?.client?.id || job?.client?._id),
  name: job?.client_name || job?.client?.full_name || job?.client?.name || 'Client',
});

export const buildInitialProposalConversationMessage = ({ job, amount, estimatedCompletionTime, message }) => {
  const jobTitle = job?.title || 'votre job';
  const parts = [
    `Nouvelle proposition envoyée pour « ${jobTitle} ».`,
    amount ? `Montant proposé : ${amount} FCFA.` : '',
    estimatedCompletionTime ? `Délai estimé : ${estimatedCompletionTime}.` : '',
    message ? `Message : ${message}` : '',
  ].filter(Boolean);
  return parts.join(' ');
};

export const buildAcceptanceConversationMessage = ({ job }) => {
  const jobTitle = job?.title || 'votre mission';
  return `Votre proposition a été acceptée pour « ${jobTitle} ». Merci de poursuivre ici pour finaliser les détails.`;
};
