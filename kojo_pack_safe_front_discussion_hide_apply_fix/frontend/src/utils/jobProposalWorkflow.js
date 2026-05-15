import { getStoredSessionUser, normalizeComparableId } from './jobPageSafeHelpers';

const STORAGE_KEY = 'kojo_job_applications_v1';
const JOB_MARKER_PREFIX = '[KOJO_JOB:';

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

const trimSlashes = (value) => String(value || '').replace(/\/+$/, '');

const getRuntimeApiBaseUrl = () => {
  if (typeof window !== 'undefined') {
    const fromWindow = window.__KOJO_API_URL__ || window.__API_URL__;
    if (typeof fromWindow === 'string' && fromWindow.trim()) {
      return trimSlashes(fromWindow.trim()).replace(/\/api$/i, '');
    }
  }

  if (typeof import.meta !== 'undefined' && import.meta?.env) {
    const fromEnv = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL;
    if (typeof fromEnv === 'string' && fromEnv.trim()) {
      return trimSlashes(fromEnv.trim()).replace(/\/api$/i, '');
    }
  }

  return 'https://kojo-backend-03az.onrender.com';
};

const getPossibleTokenKeys = () => ([
  'token',
  'authToken',
  'access_token',
  'accessToken',
  'jwt',
  'kojo_token',
  'kojo_auth_token',
  'userToken',
  'authData',
  'auth',
  'session',
  'user',
]);

const extractTokenFromRawValue = (rawValue) => {
  if (!rawValue) return '';
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) return '';
    if (/^Bearer\s+/i.test(trimmed)) return trimmed.replace(/^Bearer\s+/i, '').trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return extractTokenFromRawValue(JSON.parse(trimmed));
      } catch (_error) {
        return trimmed;
      }
    }
    return trimmed;
  }

  if (typeof rawValue === 'object') {
    const candidates = [
      rawValue.token,
      rawValue.access_token,
      rawValue.accessToken,
      rawValue.jwt,
      rawValue.authToken,
      rawValue?.data?.token,
      rawValue?.data?.access_token,
      rawValue?.data?.accessToken,
    ];

    for (const candidate of candidates) {
      const token = extractTokenFromRawValue(candidate);
      if (token) return token;
    }
  }

  return '';
};

const getAuthToken = () => {
  for (const bucket of getStorageBuckets()) {
    for (const key of getPossibleTokenKeys()) {
      try {
        const token = extractTokenFromRawValue(bucket.getItem(key));
        if (token) return token;
      } catch (_error) {}
    }
  }
  return '';
};

const toApiPath = (path) => {
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
  return `${getRuntimeApiBaseUrl()}/api${normalizedPath}`;
};

const extractApiErrorMessage = (payload, fallback) => {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  if (Array.isArray(payload)) {
    const joined = payload
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return item.msg || item.message || item.detail || '';
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
    if (joined) return joined;
  }
  if (payload && typeof payload === 'object') {
    if (typeof payload.detail === 'string' && payload.detail.trim()) return payload.detail.trim();
    if (Array.isArray(payload.detail)) return extractApiErrorMessage(payload.detail, fallback);
    return payload.message || payload.msg || fallback;
  }
  return fallback;
};

const fetchApiJson = async (path, options = {}) => {
  const token = getAuthToken();
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(toApiPath(path), {
    ...options,
    headers,
  });

  const rawText = await response.text();
  let payload = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const fallback = `HTTP ${response.status}`;
    const error = new Error(extractApiErrorMessage(payload, fallback));
    error.status = response.status;
    error.response = { data: payload };
    throw error;
  }

  return payload;
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

export const addJobMarkerToMessage = (jobId, content) => {
  const marker = getJobMarker(jobId);
  const text = String(content || '').trim();
  if (!marker) return text;
  if (!text) return marker;
  return text.startsWith(marker) ? text : `${marker} ${text}`;
};

export const stripJobMarkerFromMessage = (content) => String(content || '')
  .replace(/^\[KOJO_JOB:[^\]]+\]\s*/i, '')
  .trim();

const messageContainsJobMarker = (message, jobId) => {
  const marker = getJobMarker(jobId);
  if (!marker) return false;
  const content = String(message?.content || message?.message || '').trim();
  return content.includes(marker);
};

const messageMatchesJob = (message, jobId) => {
  const normalizedJobId = normalizeComparableId(jobId);
  if (!normalizedJobId) return true;
  const messageJobId = normalizeComparableId(
    message?.job_id || message?.jobId || message?.metadata?.job_id || message?.metadata?.jobId,
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
  return addJobMarkerToMessage(job?.id || job?._id || job?.job_id || job?.jobId, parts.join(' '));
};

export const buildAcceptanceConversationMessage = ({ job }) => {
  const jobTitle = job?.title || 'votre mission';
  return addJobMarkerToMessage(
    job?.id || job?._id || job?.job_id || job?.jobId,
    `Votre proposition a été acceptée pour « ${jobTitle} ». Merci de poursuivre ici pour finaliser les détails.`,
  );
};

export const sendProposalConversationMessage = async ({ receiverId, content, jobId }) => {
  const markedContent = addJobMarkerToMessage(jobId, content);
  const payloads = [
    { receiver_id: receiverId, content: markedContent, job_id: normalizeComparableId(jobId) },
    { receiverId, content: markedContent, job_id: normalizeComparableId(jobId) },
    { recipient_id: receiverId, content: markedContent, job_id: normalizeComparableId(jobId) },
    { receiver_id: receiverId, message: markedContent, job_id: normalizeComparableId(jobId) },
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
