import { getStoredSessionUser, normalizeComparableId } from './jobPageSafeHelpers';
// Tous les appels réseau passent par le client central `api` (api.js) :
// credentials: 'include' (cookie de session httpOnly) + en-tête X-CSRFToken
// sur les mutations + Bearer legacy si un ancien token traîne en storage.
import { api } from '../services/api';

const STORAGE_KEY = 'kojo_job_applications_v1';
const ACCEPTED_STORAGE_KEY = 'kojo_job_accepted_v1';
const JOB_MARKER_PREFIX = '[KOJO_JOB:';
const MARKER_REGEX = /\[KOJO_JOB:[^\]]+\]\s*/gi;

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

const parseAcceptedMap = () => {
  for (const bucket of getStorageBuckets()) {
    try {
      const raw = bucket.getItem(ACCEPTED_STORAGE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_error) {}
  }
  return {};
};

const persistAcceptedMap = (value) => {
  const serialized = JSON.stringify(value || {});
  for (const bucket of getStorageBuckets()) {
    try {
      bucket.setItem(ACCEPTED_STORAGE_KEY, serialized);
    } catch (_error) {}
  }
};

const fetchApiJson = async (path, options = {}) => {
  const method = String(options.method || 'GET').toUpperCase();
  const rawBody = options.body;
  const body =
    rawBody === undefined
      ? undefined
      : typeof rawBody === 'string'
        ? JSON.parse(rawBody)
        : rawBody;

  try {
    if (method === 'GET') return await api.get(path);
    if (method === 'PUT') return await api.put(path, body);
    if (method === 'PATCH') return await api.patch(path, body);
    if (method === 'DELETE') return await api.delete(path);
    return await api.post(path, body);
  } catch (error) {
    // Compat : les appelants lisent error.status (ex: sendProposalConversationMessage
    // retente d'autres formes de payload sur 400/404/405/422).
    if (error && !error.status && error.response) {
      error.status = error.response.status;
    }
    throw error;
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
  proposal?.userId,
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

export const getJobMarker = (jobId) => {
  const normalized = normalizeComparableId(jobId);
  return normalized ? `${JOB_MARKER_PREFIX}${normalized}]` : '';
};

export const addJobMarkerToMessage = (_jobId, content) => String(content || '').trim();

export const stripJobMarkerFromMessage = (content) => String(content || '')
  .replace(MARKER_REGEX, '')
  .trim();

const messageContainsJobMarker = (message, jobId) => {
  const marker = getJobMarker(jobId);
  if (!marker) return false;
  const values = [
    message?.content,
    message?.message,
    message?.job_reference,
    message?.job_marker,
    message?.metadata?.job_reference,
    message?.metadata?.job_marker,
  ];
  return values.some((value) => String(value || '').includes(marker));
};

const messageMatchesJob = (message, jobId) => {
  const normalizedJobId = normalizeComparableId(jobId);
  if (!normalizedJobId) return true;
  const messageJobId = normalizeComparableId(
    message?.job_id || message?.jobId || message?.job_ref || message?.jobRef || message?.metadata?.job_id || message?.metadata?.jobId,
  );
  if (messageJobId) return messageJobId === normalizedJobId;
  return messageContainsJobMarker(message, normalizedJobId);
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
  return [...items]
    .map((message) => ({
      ...message,
      content: stripJobMarkerFromMessage(message?.content || message?.message || ''),
      message: stripJobMarkerFromMessage(message?.message || message?.content || ''),
      sender_name: stripJobMarkerFromMessage(message?.sender_name || message?.senderName || ''),
      receiver_name: stripJobMarkerFromMessage(message?.receiver_name || message?.receiverName || ''),
      sender: message?.sender ? {
        ...message.sender,
        name: stripJobMarkerFromMessage(message?.sender?.name || ''),
        full_name: stripJobMarkerFromMessage(message?.sender?.full_name || ''),
      } : message?.sender,
      receiver: message?.receiver ? {
        ...message.receiver,
        name: stripJobMarkerFromMessage(message?.receiver?.name || ''),
        full_name: stripJobMarkerFromMessage(message?.receiver?.full_name || ''),
      } : message?.receiver,
    }))
    .sort((left, right) => {
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

export const rememberAcceptedProposal = ({ jobId, proposal, user }) => {
  const storageKey = getStorageKey(jobId, user);
  if (!storageKey) return;
  const existing = parseAcceptedMap();
  existing[storageKey] = {
    job_id: normalizeComparableId(jobId),
    proposal_id: extractProposalId(proposal),
    worker_id: extractProposalWorkerId(proposal),
    worker_name: extractProposalWorkerName(proposal),
    accepted_at: new Date().toISOString(),
  };
  persistAcceptedMap(existing);
};

export const getRememberedAcceptedProposal = (jobId, user) => {
  const storageKey = getStorageKey(jobId, user);
  if (!storageKey) return null;
  const existing = parseAcceptedMap();
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

export const filterMessagesForPair = (messages, currentUser, otherUserId, jobId) => {
  const ids = getCurrentUserIdentitySet(currentUser);
  const counterpartId = normalizeComparableId(otherUserId);
  return normalizeMessages(messages).filter((message) => {
    const senderId = getSenderId(message);
    const receiverId = getReceiverId(message);
    const samePair = (ids.has(senderId) && receiverId === counterpartId) || (ids.has(receiverId) && senderId === counterpartId);
    if (!samePair) return false;
    return messageMatchesJob(message, jobId);
  });
};

export const getCounterpartForWorker = (job) => ({
  id: normalizeComparableId(job?.client_id || job?.clientId || job?.client?.id || job?.client?._id),
  name: stripJobMarkerFromMessage(job?.client_name || job?.client?.full_name || job?.client?.name || 'Client'),
});

export const buildInitialProposalConversationMessage = ({ job, amount, estimatedCompletionTime, message }) => {
  const jobTitle = job?.title || 'votre job';
  const parts = [
    `Nouvelle proposition envoyée pour « ${jobTitle} ».`,
    amount ? `Montant proposé : ${amount} FCFA.` : '',
    estimatedCompletionTime ? `Délai estimé : ${estimatedCompletionTime}.` : '',
    message ? `Message : ${message}` : '',
  ].filter(Boolean);
  return addJobMarkerToMessage(job?.id || job?._id || job?.job_id || job?.jobId, parts.join(' '));
};

export const buildAcceptanceConversationMessage = ({ job }) => {
  const jobTitle = job?.title || 'votre mission';
  return addJobMarkerToMessage(
    job?.id || job?._id || job?.job_id || job?.jobId,
    `Votre proposition a été acceptée pour « ${jobTitle} ». Merci de poursuivre ici pour finaliser les détails.`,
  );
};

const getReadableUserName = (person, fallback) => {
  const direct = person?.full_name || person?.fullName || person?.name || person?.display_name || person?.displayName || person?.username;
  if (typeof direct === 'string' && direct.trim()) return stripJobMarkerFromMessage(direct);
  const combined = [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim();
  if (combined) return stripJobMarkerFromMessage(combined);
  if (typeof person?.email === 'string' && person.email.trim()) return stripJobMarkerFromMessage(person.email.trim());
  return fallback;
};

export const sendProposalConversationMessage = async ({ receiverId, receiverName, content, jobId }) => {
  const markedContent = addJobMarkerToMessage(jobId, content);
  const normalizedJobId = normalizeComparableId(jobId);
  const sender = getStoredSessionUser();
  const senderName = getReadableUserName(sender, 'Vous');
  const cleanReceiverName = stripJobMarkerFromMessage(receiverName || '');
  const basePayload = {
    content: markedContent,
    message: markedContent,
    job_id: normalizedJobId,
    job_reference: normalizedJobId,
    job_marker: '',
    sender_name: senderName,
    receiver_name: cleanReceiverName,
  };
  const payloads = [
    { ...basePayload, receiver_id: receiverId },
    { ...basePayload, receiverId },
    { ...basePayload, recipient_id: receiverId },
    { ...basePayload, target_user_id: receiverId },
  ];

  let lastError = null;
  for (const payload of payloads) {
    try {
      return await fetchApiJson('/messages', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (error) {
      lastError = error;
      if (![400, 404, 405, 422].includes(Number(error?.status))) {
        throw error;
      }
    }
  }

  throw lastError || new Error('Impossible d’envoyer le message');
};

export const loadProposalConversationMessages = async () => {
  const response = await fetchApiJson('/messages', { method: 'GET' });
  return normalizeMessages(response);
};
