import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import ProposalModal from '../components/ProposalModal';
import { jobsAPI } from '../services/api';
import { makeScopedTranslator } from '../utils/pack2PageI18n';
import { safeLog } from '../utils/env';
import { deleteJobWithFallbacks, ensureJobOwnerActionBar } from '../utils/jobOwnerDeleteRuntime';
import { formatBudgetRange, formatJobDate, formatJobStatus, isOwnedByCurrentUser, normalizeComparableId } from '../utils/jobPageSafeHelpers';
import { normalizeJobRecord } from '../utils/jobDisplayBridge';
import { getJobProposalUiLabel } from '../utils/jobProposalLocale';
import {
  buildAcceptanceConversationMessage,
  extractProposalId,
  extractProposalMessage,
  extractProposalWorkerId,
  extractProposalWorkerName,
  filterMessagesForPair,
  getCounterpartForWorker,
  getCurrentUserProposal,
  getRememberedApplication,
  hasCurrentUserAppliedToJob,
  normalizeApiList,
  normalizeMessages,
  rememberAppliedJob,
  loadProposalConversationMessages,
  sendProposalConversationMessage,
} from '../utils/jobProposalWorkflow';

const asTextError = (value, fallback) => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return item.msg || item.message || '';
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
    if (text) return text;
  }
  if (value && typeof value === 'object') return value.msg || value.message || fallback;
  return fallback;
};

const getMessageAuthorId = (message) => normalizeComparableId(
  message?.sender_id || message?.senderId || message?.sender?.id || message?.sender?._id || message?.user_id,
);

function ProposalCard({ proposal, ui, isSelected, isAccepted, onOpenDiscussion, onAccept, canAccept }) {
  const workerName = extractProposalWorkerName(proposal, ui.workerFallback || 'Travailleur');
  const amount = proposal.proposed_amount ?? proposal.amount ?? null;
  const message = extractProposalMessage(proposal);

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${isSelected ? 'border-orange-300 bg-orange-50/40' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold text-gray-900">{workerName}</div>
          <div className="text-sm text-gray-500">{formatJobDate(proposal.created_at)}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-orange-600">{formatBudgetRange(amount, null)}</div>
          <div className="text-xs text-gray-500">{isAccepted ? 'Attribuée' : formatJobStatus(proposal.status || 'pending')}</div>
        </div>
      </div>
      {message && <p className="mt-3 text-sm text-gray-700 whitespace-pre-line">{message}</p>}

      <div className="mt-4 flex flex-wrap gap-3">
        <button onClick={onOpenDiscussion} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          {isSelected ? 'Discussion ouverte' : 'Ouvrir la discussion'}
        </button>
        {canAccept && (
          <button onClick={onAccept} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            {isAccepted ? 'Attribuée' : 'Accepter ce travailleur'}
          </button>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message, isCurrentUser }) {
  return (
    <div className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${isCurrentUser ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
        <div className="whitespace-pre-line">{message?.content || message?.message || ''}</div>
        <div className={`mt-2 text-[11px] ${isCurrentUser ? 'text-orange-100' : 'text-gray-500'}`}>
          {formatJobDate(message?.created_at || message?.updated_at)}
        </div>
      </div>
    </div>
  );
}

export default function JobDetails() {
  const [job, setJob] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [selectedProposalId, setSelectedProposalId] = useState('');
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageError, setMessageError] = useState('');
  const [messageSuccess, setMessageSuccess] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [acceptingProposal, setAcceptingProposal] = useState(false);

  const { id } = useParams();
  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'jobDetails');
  const ui = getJobProposalUiLabel(currentLanguage);
  const navigate = useNavigate();

  useEffect(() => {
    loadJobDetails();
  }, [id, user?.id, user?.user_type]);

  useEffect(() => {
    return ensureJobOwnerActionBar(job);
  }, [job]);

  const isJobOwner = isOwnedByCurrentUser(job, user);
  const rememberedApplication = useMemo(() => getRememberedApplication(job?.id, user), [job?.id, user]);
  const currentUserProposal = useMemo(() => getCurrentUserProposal(proposals, user) || rememberedApplication, [proposals, user, rememberedApplication]);
  const hasApplied = useMemo(() => hasCurrentUserAppliedToJob(job?.id, proposals, user), [job?.id, proposals, user]);
  const assignedWorkerId = normalizeComparableId(job?.assigned_worker_id);
  const currentUserIds = useMemo(() => new Set([
    normalizeComparableId(user?._id),
    normalizeComparableId(user?.id),
    normalizeComparableId(user?.user_id),
    normalizeComparableId(user?.userId),
  ].filter(Boolean)), [user]);

  const selectedProposal = useMemo(() => {
    if (isJobOwner) {
      return proposals.find((proposal) => extractProposalId(proposal) === selectedProposalId) || proposals[0] || null;
    }
    return currentUserProposal || null;
  }, [isJobOwner, proposals, selectedProposalId, currentUserProposal]);

  const discussionTarget = useMemo(() => {
    if (!job) return null;
    if (isJobOwner) {
      if (!selectedProposal) return null;
      return {
        id: extractProposalWorkerId(selectedProposal),
        name: extractProposalWorkerName(selectedProposal, ui.workerFallback || 'Travailleur'),
      };
    }
    if (!hasApplied) return null;
    return getCounterpartForWorker(job);
  }, [job, isJobOwner, selectedProposal, hasApplied, ui.workerFallback]);

  const visibleMessages = useMemo(() => {
    if (!discussionTarget?.id) return [];
    return filterMessagesForPair(messages, user, discussionTarget.id, job?.id);
  }, [messages, user, discussionTarget?.id, job?.id]);

  const canApply = user?.user_type === 'worker' && (job?.status === 'open' || !job?.status) && !assignedWorkerId && !hasApplied;

  useEffect(() => {
    if (!isJobOwner) return;
    if (!proposals.length) {
      setSelectedProposalId('');
      return;
    }
    const hasSelected = proposals.some((proposal) => extractProposalId(proposal) === selectedProposalId);
    if (!hasSelected) {
      setSelectedProposalId(extractProposalId(proposals[0]));
    }
  }, [isJobOwner, proposals, selectedProposalId]);

  useEffect(() => {
    if (!discussionTarget?.id) {
      setMessages([]);
      return;
    }
    loadDiscussionMessages(discussionTarget.id);
  }, [discussionTarget?.id, user?.id]);

  const loadJobDetails = async () => {
    setLoading(true);
    setError('');
    setMessageError('');
    try {
      const jobData = normalizeJobRecord(await jobsAPI.getById(id));
      setJob(jobData);

      const shouldTryLoadingProposals = Boolean(user) && (isOwnedByCurrentUser(jobData, user) || user?.user_type === 'worker');
      if (shouldTryLoadingProposals) {
        try {
          const proposalsResponse = await (jobsAPI.getProposals ? jobsAPI.getProposals(id) : jobsAPI.getApplications(id));
          const proposalData = normalizeApiList(proposalsResponse);
          setProposals(proposalData);
          const ownProposal = getCurrentUserProposal(proposalData, user);
          if (ownProposal) {
            rememberAppliedJob({
              jobId: jobData?.id || id,
              proposal: ownProposal,
              job: jobData,
              user,
            });
          }
        } catch (proposalError) {
          safeLog?.error?.('Error loading proposals:', proposalError);
          setProposals([]);
        }
      } else {
        setProposals([]);
      }
    } catch (jobError) {
      safeLog?.error?.('Error loading job details:', jobError);
      setError(asTextError(jobError?.response?.data?.detail, jobError?.message || pageT('loadError') || 'Impossible de charger ce job'));
    } finally {
      setLoading(false);
    }
  };

  const loadDiscussionMessages = async (targetId) => {
    if (!targetId) return;
    setMessagesLoading(true);
    setMessageError('');
    try {
      const messagesResponse = await loadProposalConversationMessages();
      setMessages(normalizeMessages(messagesResponse));
    } catch (messagesLoadError) {
      safeLog?.error?.('Error loading discussion messages:', messagesLoadError);
      setMessages([]);
      setMessageError(asTextError(messagesLoadError?.response?.data?.detail, messagesLoadError?.message || 'Impossible de charger la discussion'));
    } finally {
      setMessagesLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!job) return;
    const confirmed = window.confirm('Veux-tu vraiment supprimer ce job ?');
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteJobWithFallbacks(job);
      window.alert('Job supprimé avec succès');
      navigate('/jobs');
    } catch (deleteError) {
      window.alert(deleteError?.message || 'Suppression impossible');
    } finally {
      setDeleting(false);
    }
  };

  const handleSendMessage = async () => {
    const content = String(messageDraft || '').trim();
    if (!discussionTarget?.id) {
      setMessageError('Destinataire introuvable.');
      return;
    }
    if (!content) {
      setMessageError('Écris un message avant l’envoi.');
      return;
    }

    setSendingMessage(true);
    setMessageError('');
    setMessageSuccess('');
    try {
      await sendProposalConversationMessage({
        receiverId: discussionTarget.id,
        jobId: job?.id,
        content,
      });
      setMessageDraft('');
      setMessageSuccess('Message envoyé.');
      await loadDiscussionMessages(discussionTarget.id);
    } catch (sendError) {
      setMessageError(asTextError(sendError?.response?.data?.detail, sendError?.message || 'Envoi du message impossible'));
    } finally {
      setSendingMessage(false);
    }
  };

  const handleAcceptProposal = async (proposal) => {
    const workerId = extractProposalWorkerId(proposal);
    if (!job?.id || !workerId) {
      setMessageError('Impossible d’attribuer ce travailleur.');
      return;
    }

    setAcceptingProposal(true);
    setMessageError('');
    setMessageSuccess('');

    try {
      await jobsAPI.update(job.id, {
        assigned_worker_id: workerId,
        status: 'assigned',
        accepted_proposal_id: extractProposalId(proposal),
      });

      try {
        await sendProposalConversationMessage({
          receiverId: workerId,
          jobId: job?.id,
          content: buildAcceptanceConversationMessage({ job }),
        });
      } catch (_messageError) {
        // The assignment should not fail just because the notification fails.
      }

      setMessageSuccess('Travailleur attribué. La discussion reste ouverte pour finaliser la mission.');
      await loadJobDetails();
    } catch (acceptError) {
      setMessageError(asTextError(
        acceptError?.response?.data?.detail,
        acceptError?.message || 'Attribution impossible. Vérifie que le backend accepte bien la mise à jour du job.'
      ));
    } finally {
      setAcceptingProposal(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
          {error || pageT('notFound') || 'Job introuvable'}
        </div>
      </div>
    );
  }

  const publishedLabel = formatJobDate(job.posted_at || job.created_at || job.updated_at);
  const proposalAccepted = selectedProposal && assignedWorkerId && extractProposalWorkerId(selectedProposal) === assignedWorkerId;
  const assignedToCurrentWorker = Boolean(assignedWorkerId) && currentUserIds.has(assignedWorkerId);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button onClick={() => navigate(-1)} className="mb-6 flex items-center text-orange-600 hover:text-orange-700 font-medium">
        ← {pageT('back') || 'Retour'}
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">{job.title}</h1>
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="px-3 py-1 rounded-full text-sm font-medium bg-orange-50 text-orange-700 border border-orange-200">
                    {assignedWorkerId ? 'Attribué' : formatJobStatus(job.status)}
                  </span>
                  <span className="text-sm text-gray-500">{ui.publishedOnPrefix} {publishedLabel}</span>
                  {hasApplied && !isJobOwner && (
                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Proposition envoyée
                    </span>
                  )}
                  {assignedToCurrentWorker && (
                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Vous êtes attribué sur cette mission
                    </span>
                  )}
                </div>
              </div>
              <div className="text-left lg:text-right">
                <div className="text-3xl font-bold text-orange-600">{formatBudgetRange(job.budget_min, job.budget_max)}</div>
                {job.estimated_duration && <div className="text-sm text-gray-500 mt-1">{job.estimated_duration}</div>}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {isJobOwner && (
                <>
                  <button onClick={() => navigate('/jobs')} className="rounded-xl border border-gray-200 px-4 py-3 font-semibold text-gray-700 hover:bg-gray-50">
                    {ui.myJobs}
                  </button>
                  <button onClick={handleDelete} disabled={deleting} className="rounded-xl bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                    {deleting ? ui.deleting : ui.deleteJob}
                  </button>
                </>
              )}

              {canApply && (
                <button onClick={() => setShowProposalModal(true)} className="rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white hover:bg-orange-700">
                  {ui.apply}
                </button>
              )}
            </div>

            {!canApply && hasApplied && !isJobOwner && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                Votre proposition a déjà été envoyée. Le bouton « Postuler » reste masqué et la discussion avec le client est disponible plus bas.
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{ui.description}</h2>
            <p className="text-gray-700 whitespace-pre-line">{job.description}</p>
          </div>

          {isJobOwner && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{ui.receivedProposals}</h2>
              {proposals.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500">
                  Aucune proposition reçue pour le moment.
                </div>
              ) : (
                <div className="space-y-4">
                  {proposals.map((proposal) => {
                    const proposalId = extractProposalId(proposal);
                    const isAccepted = Boolean(assignedWorkerId) && extractProposalWorkerId(proposal) === assignedWorkerId;
                    return (
                      <ProposalCard
                        key={proposalId || `${extractProposalWorkerId(proposal) || 'proposal'}-${proposal.created_at || Math.random()}`}
                        proposal={proposal}
                        ui={ui}
                        isSelected={proposalId === extractProposalId(selectedProposal)}
                        isAccepted={isAccepted}
                        onOpenDiscussion={() => setSelectedProposalId(proposalId)}
                        onAccept={() => handleAcceptProposal(proposal)}
                        canAccept={!isAccepted && !acceptingProposal}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {discussionTarget?.id && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    {isJobOwner ? `Discussion avec ${discussionTarget.name}` : 'Discussion avec le client'}
                  </h2>
                  <p className="text-sm text-gray-500">
                    {isJobOwner
                      ? 'Réponds directement à la proposition et attribue la mission quand tu es prêt.'
                      : 'Tu peux échanger ici avec le client après l’envoi de ta proposition.'}
                  </p>
                </div>
                {proposalAccepted && (
                  <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                    Proposition attribuée
                  </div>
                )}
              </div>

              {messageError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{messageError}</div>
              )}
              {messageSuccess && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{messageSuccess}</div>
              )}

              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 min-h-[180px] space-y-3">
                {messagesLoading ? (
                  <div className="text-sm text-gray-500">Chargement de la discussion...</div>
                ) : visibleMessages.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    Aucun message pour l’instant. Tu peux envoyer le premier message ici.
                  </div>
                ) : (
                  visibleMessages.map((message) => (
                    <MessageBubble
                      key={message.id || message._id || `${getMessageAuthorId(message)}-${message.created_at || Math.random()}`}
                      message={message}
                      isCurrentUser={currentUserIds.has(getMessageAuthorId(message))}
                    />
                  ))
                )}
              </div>

              <div className="space-y-3">
                <textarea
                  rows="4"
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="Écris ton message ici"
                />
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                  <button onClick={handleSendMessage} disabled={sendingMessage} className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
                    {sendingMessage ? 'Envoi...' : 'Envoyer le message'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{ui.information}</h2>
            <div className="space-y-3 text-gray-700">
              <div>{job.location_text}</div>
              {job.location_precision && <div className="text-sm text-gray-500">{job.location_precision}</div>}
              {job.category && <div className="text-sm text-gray-500">Catégorie : {job.category}</div>}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{ui.client}</h2>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center font-bold">
                {String(job.client_name || 'C').charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-medium text-gray-900">{job.client_name}</div>
                <div className="text-sm text-gray-500">{job.client_email || 'Profil client'}</div>
              </div>
            </div>
          </div>

          {!isJobOwner && currentUserProposal && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Votre proposition</h2>
              <div className="space-y-2 text-sm text-gray-700">
                {currentUserProposal?.proposed_amount && <div><span className="font-semibold">Montant :</span> {formatBudgetRange(currentUserProposal.proposed_amount, null)}</div>}
                {currentUserProposal?.estimated_completion_time && <div><span className="font-semibold">Délai :</span> {currentUserProposal.estimated_completion_time}</div>}
                {extractProposalMessage(currentUserProposal) && <div className="whitespace-pre-line"><span className="font-semibold">Message :</span> {extractProposalMessage(currentUserProposal)}</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      {showProposalModal && canApply && (
        <ProposalModal
          job={job}
          onClose={() => setShowProposalModal(false)}
          onProposalSubmitted={() => {
            setShowProposalModal(false);
            setMessageSuccess('Proposition envoyée. La discussion avec le client est maintenant disponible.');
            loadJobDetails();
          }}
        />
      )}
    </div>
  );
}
