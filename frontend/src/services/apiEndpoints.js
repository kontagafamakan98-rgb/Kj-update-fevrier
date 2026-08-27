// ============================================================================
// ENDPOINTS API utilisés par les pages LAZY uniquement.
//
// Pourquoi ce module séparé de services/api.js : api.js est importé par le
// shell (AuthContext → services/api). Comme les pages lazy (Jobs, Profile,
// Messages...) importaient jobsAPI/usersAPI/reviewAPI... DEPUIS services/api,
// Rollup devait conserver TOUTES les exportations de api.js dans le chunk
// d'entrée (module partagé entre l'entrée et les chunks lazy) → le chunk
// index embarque l'intégralité de la surface API (~120 kB raw), même les
// endpoints jamais utilisés au boot.
//
// En déplaçant ici les groupes d'endpoints que SEULES les pages lazy
// consomment, ils sortent du chunk d'entrée et vivent dans les chunks lazy
// correspondants (chargés uniquement à la navigation) → boot React plus léger.
// Le core (api, authAPI, geolocationAPI, notificationAPI, helpers d'erreur)
// reste dans services/api.js, importé par le shell.
// ============================================================================
import { api } from './api';

export const jobsAPI = {
  /** @returns {Promise<object>} {jobs, total, page, limit, has_more...}. */
  getAll: (params = {}) => api.get('/jobs', { params }),
  /** @returns {Promise<object>} {job} mission complète. */
  getById: (id) => api.get(`/jobs/${id}`),
  /** @returns {Promise<object>} {job} mission créée (response_model=Job). */
  create: (jobData) => api.post('/jobs', jobData),
  // NOTE: pas de update — le backend n'expose AUCUNE route PUT /jobs/{id}
  // (une mission est créée puis complétée, jamais éditée). L'ancienne
  // méthode pointait vers une route inexistante (audit_api_returns.cjs).
  /** @returns {Promise<object>} {success: true} mission supprimée. */
  delete: (id) => api.delete(`/jobs/${id}`),
  /** @returns {Promise<object>} {proposal} candidature envoyée. */
  apply: (jobId, applicationData) => api.post(`/jobs/${jobId}/proposals`, applicationData),
  /** @returns {Promise<object>} {proposals} liste des candidatures. */
  getApplications: (jobId) => api.get(`/jobs/${jobId}/proposals`),
  /** @returns {Promise<object>} {proposals} liste des candidatures. */
  getProposals: (jobId) => api.get(`/jobs/${jobId}/proposals`),
  /** @returns {Promise<object>} {proposal, job} candidature acceptée. */
  acceptProposal: (jobId, proposalId, payload = {}) => api.post(`/jobs/${jobId}/proposals/${proposalId}/accept`, payload),
  /** @returns {Promise<object>} {proposals} candidatures du travailleur. */
  getMyProposals: () => api.get('/proposals/mine'),
  /** @returns {Promise<object>} {job} mission marquée terminée. */
  completeJob: (jobId) => api.post(`/jobs/${jobId}/complete`),
  /** @returns {Promise<object>} {status, payout_status...} statut du paiement. */
  getPaymentStatus: (jobId) => api.get(`/jobs/${jobId}/payment-status`),
};

const stripKojoMarker = (value) => String(value || '').replace(/\[KOJO_JOB:[^\]]+\]\s*/gi, '').trim();

const getCleanPersonName = (person) => {
  const direct = person?.full_name || person?.fullName || person?.display_name || person?.displayName || person?.name || person?.username;
  if (typeof direct === 'string' && stripKojoMarker(direct)) return stripKojoMarker(direct);
  const combined = [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim();
  if (combined) return stripKojoMarker(combined);
  if (typeof person?.email === 'string' && person.email.trim()) return stripKojoMarker(person.email.trim());
  return '';
};

const normalizeMessageItem = (message) => ({
  ...message,
  content: stripKojoMarker(message?.content || message?.message || ''),
  message: stripKojoMarker(message?.message || message?.content || ''),
  sender_name: stripKojoMarker(message?.sender_name || message?.senderName || getCleanPersonName(message?.sender)),
  receiver_name: stripKojoMarker(message?.receiver_name || message?.receiverName || getCleanPersonName(message?.receiver)),
});

const normalizeMessageListResponse = (payload) => {
  if (Array.isArray(payload)) return payload.map(normalizeMessageItem);
  if (Array.isArray(payload?.data)) return { ...payload, data: payload.data.map(normalizeMessageItem) };
  if (Array.isArray(payload?.items)) return { ...payload, items: payload.items.map(normalizeMessageItem) };
  if (Array.isArray(payload?.results)) return { ...payload, results: payload.results.map(normalizeMessageItem) };
  if (payload && typeof payload === 'object') return normalizeMessageItem(payload);
  return payload;
};

const normalizeConversationItem = (conversation) => {
  const lastMessage = conversation?.last_message || conversation?.lastMessage || conversation?.latest_message || conversation?.latestMessage || {};
  const participant = conversation?.participant || conversation?.user || conversation?.other_user || conversation?.counterpart || {};
  const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
  const participantNames = participants.map(getCleanPersonName).filter(Boolean);
  const resolvedName = stripKojoMarker(
    conversation?.display_name
    || conversation?.displayName
    || conversation?.participant_name
    || conversation?.participantName
    || conversation?.other_user_name
    || conversation?.otherUserName
    || conversation?.user_name
    || conversation?.userName
    || conversation?.title
    || getCleanPersonName(participant)
    || stripKojoMarker(lastMessage?.sender_name || lastMessage?.receiver_name)
    || participantNames[0]
    || ''
  ) || 'Interlocuteur';

  return {
    ...conversation,
    display_name: resolvedName,
    displayName: resolvedName,
    participant_name: resolvedName,
    participantName: resolvedName,
    other_user_name: resolvedName,
    otherUserName: resolvedName,
    user_name: resolvedName,
    userName: resolvedName,
    title: resolvedName,
    name: resolvedName,
    full_name: resolvedName,
    last_message: lastMessage && typeof lastMessage === 'object' ? normalizeMessageItem(lastMessage) : lastMessage,
    lastMessage: lastMessage && typeof lastMessage === 'object' ? normalizeMessageItem(lastMessage) : lastMessage,
  };
};

const normalizeConversationListResponse = (payload) => {
  if (Array.isArray(payload)) return payload.map(normalizeConversationItem);
  if (Array.isArray(payload?.data)) return { ...payload, data: payload.data.map(normalizeConversationItem) };
  if (Array.isArray(payload?.items)) return { ...payload, items: payload.items.map(normalizeConversationItem) };
  if (Array.isArray(payload?.results)) return { ...payload, results: payload.results.map(normalizeConversationItem) };
  if (payload && typeof payload === 'object') return normalizeConversationItem(payload);
  return payload;
};

export const messagesAPI = {
  /** @returns {Promise<object>} {message, conversation...} message envoyé. */
  send: (payload) => api.post('/messages', payload),
  /** @returns {Promise<object>} {message, conversation...} message envoyé. */
  sendMessage: (payload) => api.post('/messages', payload),
  /** @returns {Promise<Array<object>>} messages normalisés (KOJO_JOB strippé). */
  list: async () => normalizeMessageListResponse(await api.get('/messages')),
  /** @returns {Promise<Array<object>>} conversations normalisées. */
  getConversations: async () => normalizeConversationListResponse(await api.get('/messages/conversations')),
  /** @returns {Promise<Array<object>>} messages de la conversation normalisés. */
  getConversation: async (conversationId) => normalizeMessageListResponse(await api.get(`/messages/${conversationId}`)),
  /** @returns {Promise<Array<object>>} messages paginés normalisés. */
  getMessages: async (conversationId, { limit = 100, offset = 0, order = 'asc' } = {}) => normalizeMessageListResponse(await api.get(`/messages/${conversationId}`, { params: { limit, offset, order } })),
};

const camelToKebab = (value) => String(value || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/_/g, '-')
  .toLowerCase();

const createResourceApi = (resourceName) => {
  const basePath = `/${String(resourceName || '').replace(/^\/+|\/+$/g, '')}`;

  const baseApi = {
    list: (params = {}) => api.get(basePath, { params }),
    getAll: (params = {}) => api.get(basePath, { params }),
    getById: (id) => api.get(`${basePath}/${id}`),
    get: (id, params = {}) => id ? api.get(`${basePath}/${id}`, { params }) : api.get(basePath, { params }),
    create: (payload) => api.post(basePath, payload),
    post: (payload) => api.post(basePath, payload),
    update: (id, payload) => api.put(`${basePath}/${id}`, payload),
    patch: (id, payload) => api.patch(`${basePath}/${id}`, payload),
    remove: (id) => api.delete(`${basePath}/${id}`),
    delete: (id) => api.delete(`${basePath}/${id}`),
  };

  return new Proxy(baseApi, {
    get(target, prop) {
      if (typeof prop !== 'string') return target[prop];
      if (prop in target) return target[prop];

      return (...args) => {
        const action = camelToKebab(prop);
        const firstArg = args[0];
        const secondArg = args[1];

        if (prop.startsWith('get') || prop.startsWith('list') || prop.startsWith('fetch')) {
          if (typeof firstArg === 'string' || typeof firstArg === 'number') {
            return api.get(`${basePath}/${firstArg}`);
          }
          return api.get(`${basePath}/${action}`, { params: firstArg || {} });
        }

        if (prop.startsWith('create') || prop.startsWith('init') || prop.startsWith('start') || prop.startsWith('submit') || prop.startsWith('pay') || prop.startsWith('process')) {
          return api.post(`${basePath}/${action}`, firstArg || {});
        }

        if (prop.startsWith('update') || prop.startsWith('set')) {
          if (typeof firstArg === 'string' || typeof firstArg === 'number') {
            return api.put(`${basePath}/${firstArg}`, secondArg || {});
          }
          return api.put(`${basePath}/${action}`, firstArg || {});
        }

        if (prop.startsWith('delete') || prop.startsWith('remove') || prop.startsWith('cancel')) {
          if (typeof firstArg === 'string' || typeof firstArg === 'number') {
            return api.delete(`${basePath}/${firstArg}`);
          }
          return api.post(`${basePath}/${action}`, firstArg || {});
        }

        return api.post(`${basePath}/${action}`, firstArg || {});
      };
    },
  });
};

// paymentAPI est defini explicitement (pas via createResourceApi) car le
// proxy generique construit des URLs qui ne correspondent PAS aux vraies
// routes backend pour ce module (ex: getConfig() -> /payments/get-config
// au lieu de /payments/config, en GET au lieu du bon verbe HTTP, etc.)
// Voir backend/server.py pour les routes reelles.
export const paymentAPI = {
  /** @returns {Promise<object>} {provider, configured, channels...}. */
  getConfig: () => api.get('/payments/config'),
  /** @returns {Promise<object>} {provider, amount, commission, total...}. */
  getQuote: (payload) => api.post('/payments/quote', payload),
  /** @returns {Promise<object>} {payment, checkout_url...} paiement créé. */
  createCheckout: (payload) => api.post('/payments/checkout', payload),
  /** @returns {Promise<object>} {status, payout_status...} statut du paiement. */
  getPaymentStatus: (paymentId) => api.get(`/payments/status/${paymentId}`),
  /** @returns {Promise<object>} {status, payout_status...} statut via token. */
  getPaymentStatusByToken: (invoiceToken) => api.get(`/payments/status/token/${invoiceToken}`),
  /** @returns {Promise<object>} {payments} paiements de l'utilisateur. */
  getMyPayments: () => api.get('/payments/my'),
};
export const paymentsAPI = paymentAPI;
export const userAPI = createResourceApi('users');
export const usersAPI = {
  ...userAPI,
  // Profile photo methods
  /** @returns {Promise<object>} {photo_url} ou {photo_url: null} sans photo. */
  getProfilePhoto: () => api.get('/users/profile-photo'),
  /** @returns {Promise<object>} {photo_url} photo du profil ciblé. */
  getUserProfilePhoto: (userId) => api.get(`/users/${userId}/profile-photo`),
  /** @returns {Promise<object>} {photo_url} photo téléversée. */
  uploadProfilePhoto: (formData) => api.post('/users/profile-photo', formData),
  /** @returns {Promise<object>} {success: true} photo supprimée. */
  deleteProfilePhoto: () => api.delete('/users/profile-photo'),
  /** @returns {Promise<object>} {message, deleted: true} compte supprimé. */
  deleteAccount: () => api.delete('/users/account'),
  // Profile update
  /** @returns {Promise<object>} {user} profil mis à jour. */
  updateProfile: (payload) => api.put('/users/profile', payload),
  // Portfolio travailleur (photos de réalisations)
  /** @returns {Promise<object>} {portfolio_images} liste d'URLs. */
  getPortfolio: () => api.get('/users/portfolio'),
  /** @returns {Promise<object>} {portfolio_images} image ajoutée. */
  addPortfolioImage: (formData) => api.uploadFile('/users/portfolio', formData),
  /** @returns {Promise<object>} {portfolio_images} image retirée. */
  removePortfolioImage: (index) => api.delete(`/users/portfolio/${index}`),
  // Parrainage
  /** @returns {Promise<object>} {referral_code, reward_balance...}. */
  getReferral: () => api.get('/users/referral'),
  /** @returns {Promise<object>} {filleuls} liste des filleuls. */
  getReferralFilleuls: () => api.get('/users/referral/filleuls'),
  /** @returns {Promise<object>} {success: true, referral_code...}. */
  applyReferral: (code) => api.post('/users/referral/apply', { code }),
  /** @returns {Promise<object>} {success: true} récompense retirée. */
  withdrawReferral: () => api.post('/users/referral/withdraw'),
};
export const profileAPI = userAPI;
export const profilesAPI = userAPI;
export const workerAPI = createResourceApi('workers');
export const workersAPI = workerAPI;
export const workerProfileAPI = {
  /** @returns {Promise<object>} {profile} profil travailleur. */
  get: () => api.get('/workers/profile'),
  /** @returns {Promise<object>} {profile} profil travailleur créé. */
  create: (payload) => api.post('/workers/profile', payload),
  /** @returns {Promise<object>} {profile} profil travailleur mis à jour. */
  update: (payload) => api.put('/workers/profile', payload),
};
// Avis / notes : endpoints explicites (le proxy générique construisait des
// URLs qui ne correspondent pas aux vraies routes backend).
export const reviewAPI = {
  /** @returns {Promise<object>} {review} avis créé. */
  create: (jobId, payload) => api.post(`/jobs/${jobId}/reviews`, payload),
  /** @returns {Promise<object>} {reviews} avis de la mission. */
  getJobReviews: (jobId) => api.get(`/jobs/${jobId}/reviews`),
  /** @returns {Promise<object>} {reviews} avis de l'utilisateur. */
  getUserReviews: (userId) => api.get(`/users/${userId}/reviews`),
  /** @returns {Promise<object>} {success: true} avis supprimé. */
  remove: (reviewId) => api.delete(`/reviews/${reviewId}`),
};
export const reviewsAPI = reviewAPI;
export const supportAPI = {
  /** @returns {Promise<object>} {ticket} ticket créé. */
  createTicket: (payload) => api.post('/support/tickets', payload),
  /** @returns {Promise<object>} {ticket, status...} statut du ticket. */
  getTicketStatus: (ticketId, email) => api.post('/support/tickets/status', { ticket_id: ticketId, email }),
  /** @returns {Promise<object>} {tickets} liste des tickets. */
  listTickets: (statusFilter) => api.get('/support/tickets', { params: statusFilter ? { status_filter: statusFilter } : {} }),
  /** @returns {Promise<object>} {ticket} statut mis à jour. */
  updateTicketStatus: (ticketId, status) => api.patch(`/support/tickets/${ticketId}/status`, { status }),
};
export const messageAPI = {
  /** @returns {Promise<Array<object>>} messages normalisés. */
  list: (params = {}) => messagesAPI.list(params),
  /** @returns {Promise<Array<object>>} messages normalisés. */
  getAll: (params = {}) => messagesAPI.list(params),
  /** @returns {Promise<Array<object>>} messages de la conversation. */
  getById: (id) => messagesAPI.getConversation(id),
  /** @returns {Promise<Array<object>>} conversation ou liste selon l'argument. */
  get: (id) => id ? messagesAPI.getConversation(id) : messagesAPI.list(),
  /** @returns {Promise<object>} message envoyé. */
  create: (payload) => messagesAPI.send(payload),
  /** @returns {Promise<object>} message envoyé. */
  post: (payload) => messagesAPI.send(payload),
  /** @returns {Promise<object>} message envoyé. */
  send: (payload) => messagesAPI.send(payload),
  /** @returns {Promise<Array<object>>} conversations normalisées. */
  getConversations: () => messagesAPI.getConversations(),
  /** @returns {Promise<Array<object>>} messages de la conversation. */
  getConversation: (id) => messagesAPI.getConversation(id),
};
export const conversationAPI = messageAPI;
export const conversationsAPI = messageAPI;
export const publicAPI = {
  /** @returns {Promise<object>} {jobs, workers, completed_jobs...} compteurs. */
  getStats: () => api.get('/public/stats'),
};

