import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import ProposalModal from '../components/ProposalModal';
import { jobsAPI } from '../services/api';
import { makeScopedTranslator } from '../utils/pack2PageI18n';
import { safeLog } from '../utils/env';
import { deleteJobWithFallbacks, ensureJobOwnerActionBar } from '../utils/jobOwnerDeleteRuntime';
import { formatBudgetRange, formatJobDate, formatJobStatus, isOwnedByCurrentUser, normalizeComparableId } from '../utils/jobPageSafeHelpers';
import { normalizeJobRecord } from '../utils/jobDisplayBridge';
import JobReviews from '../components/JobReviews';
import { VerifiedBadge, WorkerTrustBadge } from '../utils/workerTrustLevel';
import { usePageTitle } from '../utils/seo';
import {
  extractProposalId,
  extractProposalMessage,
  extractProposalWorkerId,
  extractProposalWorkerName,
  filterMessagesForPair,
  getCounterpartForWorker,
  getCurrentUserProposal,
  getRememberedAcceptedProposal,
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

const getReadableUserName = (person, fallback) => {
  const direct = person?.full_name || person?.fullName || person?.name || person?.display_name || person?.displayName || person?.username;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const combined = [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim();
  if (combined) return combined;
  if (typeof person?.email === 'string' && person.email.trim()) return person.email.trim();
  return fallback;
};

function ProposalCard({ proposal, isSelected, isAccepted, onOpenDiscussion, onAccept, canAccept }) {
  const { t } = useLanguage();
  const workerName = extractProposalWorkerName(proposal, t('worker'));
  const workerPhoto = proposal?.worker_photo || proposal?.worker?.profile_photo || null;
  const amount = proposal.proposed_amount ?? proposal.amount ?? null;
  const message = extractProposalMessage(proposal);
  // Données de confiance du travailleur (best-effort : disponibles quand le
  // backend les joint à la proposition).
  const workerPerson = proposal?.worker || proposal?.worker_profile || proposal;

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${isSelected ? 'border-orange-300 bg-orange-50/40' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-gray-200 flex items-center justify-center">
            {workerPhoto ? (
              <img src={workerPhoto} alt={workerName} className="h-full w-full object-cover" />
            ) : (
              <span className="text-sm font-semibold text-gray-500">{workerName.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-semibold text-gray-900">{workerName}</div>
              <VerifiedBadge verified={workerPerson?.is_verified} />
              <WorkerTrustBadge person={workerPerson} />
            </div>
            <div className="text-sm text-gray-500">{formatJobDate(proposal.created_at)}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-orange-600">{formatBudgetRange(amount, null)}</div>
          <div className="text-xs text-gray-500">{isAccepted ? t('jobUiAttributed') : formatJobStatus(proposal.status || 'pending', t)}</div>
        </div>
      </div>
      {message && <p className="mt-3 text-sm text-gray-700 whitespace-pre-line">{message}</p>}

      <div className="mt-4 flex flex-wrap gap-3">
        <button onClick={onOpenDiscussion} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          {isSelected ? t('jobUiDiscussionOpen') : t('jobUiOpenDiscussion')}
        </button>
        {canAccept && (
          <button onClick={onAccept} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            {isAccepted ? t('jobUiAttributed') : t('jobUiAcceptWorker')}
          </button>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message, isCurrentUser, authorName }) {
  return (
    <div className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${isCurrentUser ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
        <div className={`mb-1 text-xs font-semibold ${isCurrentUser ? 'text-orange-100' : 'text-gray-500'}`}>
          {authorName}
        </div>
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
  const [completingJob, setCompletingJob] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [paymentStatusLoading, setPaymentStatusLoading] = useState(false);
  const discussionSectionRef = useRef(null);
  const discussionInputRef = useRef(null);

  const { id } = useParams();
  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'jobDetails');
  const navigate = useNavigate();
  usePageTitle(job?.title ? `${job.title} — Kojo` : t('jobDetailsTitleFallback'));

  useEffect(() => {
    loadJobDetails();
  }, [id, user?.id, user?.user_type]);

  const refreshPaymentStatus = async () => {
    if (!job?.id) return;
    setPaymentStatusLoading(true);
    try {
      const response = await jobsAPI.getPaymentStatus(job.id);
      setPaymentStatus(response?.data || null);
    } catch (_err) {
      // Statut de paiement indisponible : on ne bloque jamais l'affichage
      // de la page pour ca, on retombe juste sur "aucune donnee".
      setPaymentStatus(null);
    } finally {
      setPaymentStatusLoading(false);
    }
  };

  useEffect(() => {
    return ensureJobOwnerActionBar(job);
  }, [job]);

  const isJobOwner = isOwnedByCurrentUser(job, user);
  const rememberedApplication = useMemo(() => getRememberedApplication(job?.id, user), [job?.id, user]);
  const rememberedAcceptedProposal = useMemo(() => getRememberedAcceptedProposal(job?.id, user), [job?.id, user]);
  const currentUserProposal = useMemo(() => getCurrentUserProposal(proposals, user) || rememberedApplication, [proposals, user, rememberedApplication]);
  const hasApplied = useMemo(() => hasCurrentUserAppliedToJob(job?.id, proposals, user), [job?.id, proposals, user]);
  // DOIT être déclaré AVANT le useEffect qui l'utilise en dépendance
  // (lignes suivantes) - sinon JavaScript lève une ReferenceError TDZ
  // (Temporal Dead Zone) car const/let ne sont pas hoistés comme var.
  const assignedWorkerId = normalizeComparableId(job?.assigned_worker_id || rememberedAcceptedProposal?.worker_id);

  useEffect(() => {
    if (job?.id && assignedWorkerId) {
      refreshPaymentStatus();
    }
  }, [job?.id, assignedWorkerId]);
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
        name: extractProposalWorkerName(selectedProposal, t('worker')),
      };
    }
    if (!hasApplied) return null;
    return getCounterpartForWorker(job);
  }, [job, isJobOwner, selectedProposal, hasApplied]);

  const getParticipantNameFromIds = (authorId, fallback) => {
    const normalizedAuthorId = normalizeComparableId(authorId);
    if (!normalizedAuthorId) return fallback;

    const clientId = normalizeComparableId(job?.client_id || job?.clientId || job?.client?.id || job?.client?._id);
    if (clientId && normalizedAuthorId === clientId) {
      return getReadableUserName({
        full_name: job?.client_name || job?.client?.full_name,
        name: job?.client?.name,
        email: job?.client_email || job?.client?.email,
      }, t('client'));
    }

    const matchedProposal = (Array.isArray(proposals) ? proposals : []).find((proposal) => extractProposalWorkerId(proposal) === normalizedAuthorId);
    if (matchedProposal) {
      return extractProposalWorkerName(matchedProposal, fallback || t('worker'));
    }

    if (selectedProposal && extractProposalWorkerId(selectedProposal) === normalizedAuthorId) {
      return extractProposalWorkerName(selectedProposal, fallback || t('worker'));
    }

    return fallback;
  };

  const openDiscussionForProposal = (proposalId) => {
    const proposal = proposals.find((item) => extractProposalId(item) === proposalId) || selectedProposal;
    const workerId = extractProposalWorkerId(proposal);
    const workerName = extractProposalWorkerName(proposal, t('worker'));
    setSelectedProposalId(proposalId);

    const params = new URLSearchParams();
    if (job?.id) params.set('jobId', job.id);
    if (workerId) params.set('userId', workerId);
    if (workerName) params.set('name', workerName);
    params.set('source', 'job-details');

    navigate(`/messages?${params.toString()}`);

    if (typeof window !== 'undefined') {
      window.location.hash = 'job-discussion';
    }
    window.setTimeout(() => {
      discussionSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      discussionInputRef.current?.focus();
    }, 120);
  };

  const visibleMessages = useMemo(() => {
    if (!discussionTarget?.id) return [];
    return filterMessagesForPair(messages, user, discussionTarget.id, job?.id);
  }, [messages, user, discussionTarget?.id, job?.id]);

  const currentUserDisplayName = useMemo(() => getReadableUserName(user, t('you')), [user]);

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
      setError(asTextError(jobError?.response?.data?.detail, jobError?.message || pageT('loadError') || t('loadJobFailed')));
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
      setMessageError(asTextError(messagesLoadError?.response?.data?.detail, messagesLoadError?.message || pageT('loadDiscussionFailed')));
    } finally {
      setMessagesLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!job) return;
    const confirmed = window.confirm(pageT('confirmDeleteJob'));
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteJobWithFallbacks(job);
      window.alert(pageT('jobDeletedSuccess'));
      navigate('/jobs');
    } catch (deleteError) {
      window.alert(deleteError?.message || pageT('deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  const handleSendMessage = async () => {
    const content = String(messageDraft || '').trim();
    if (!discussionTarget?.id) {
      setMessageError(pageT('recipientNotFound'));
      return;
    }
    if (!content) {
      setMessageError(pageT('writeMessageBeforeSend'));
      return;
    }

    setSendingMessage(true);
    setMessageError('');
    setMessageSuccess('');
    try {
      await sendProposalConversationMessage({
        receiverId: discussionTarget.id,
        receiverName: discussionTarget.name,
        jobId: job?.id,
        content,
      });
      setMessageDraft('');
      setMessageSuccess(pageT('messageSent'));
      await loadDiscussionMessages(discussionTarget.id);
    } catch (sendError) {
      setMessageError(asTextError(sendError?.response?.data?.detail, sendError?.message || pageT('sendMessageFailed')));
    } finally {
      setSendingMessage(false);
    }
  };

  const captureCurrentLocation = () => new Promise((resolve) => {
    // La localisation est un bonus : si le navigateur ne la supporte pas,
    // si la permission est refusee, ou si ca prend trop de temps, on
    // n'empeche JAMAIS l'attribution du travailleur. On retombe alors sur
    // l'adresse deja renseignee sur le job (geree cote backend).
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    const timeoutId = setTimeout(() => resolve(null), 6000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timeoutId);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => {
        clearTimeout(timeoutId);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
    );
  });

  const handleAcceptProposal = async (proposal) => {
    const workerId = extractProposalWorkerId(proposal);
    const proposalId = extractProposalId(proposal);
    if (!job?.id || !workerId || !proposalId) {
      setMessageError(pageT('assignFailed'));
      return;
    }

    setAcceptingProposal(true);
    setMessageError('');
    setMessageSuccess('');

    try {
      const location = await captureCurrentLocation();

      const response = await jobsAPI.acceptProposal(job.id, proposalId, {
        location: location || undefined,
      });
      const updatedJob = response?.data?.job || response?.data;

      setJob((previous) => (previous ? { ...previous, ...updatedJob } : updatedJob));

      setProposals((previous) => previous.map((item) => ({
        ...item,
        status: extractProposalWorkerId(item) === workerId ? 'accepted' : 'rejected',
      })));

      setSelectedProposalId(proposalId);
      setMessageSuccess(
        location
          ? t('assignSuccessWithLocation')
          : t('assignSuccessWithAddress')
      );
      await loadDiscussionMessages(workerId);

      // Redirection automatique vers le paiement : le client n'a aucune
      // action manuelle supplementaire a faire une fois le travailleur
      // attribue. On laisse 1.5s pour que le message de confirmation
      // ci-dessus soit visible avant de quitter la page.
      const proposedAmount = proposal?.proposed_amount ?? proposal?.amount ?? null;
      const paymentAmount = proposedAmount || job?.budget_max || job?.budget_min || null;
      const paymentParams = new URLSearchParams({
        job_id: job.id,
        worker_id: workerId,
        ...(paymentAmount ? { amount: String(Math.round(paymentAmount)) } : {}),
        ...(job?.title ? { job_title: encodeURIComponent(job.title) } : {}),
      });
      setTimeout(() => {
        navigate(`/payment?${paymentParams.toString()}`);
      }, 1500);
    } catch (acceptError) {
      setMessageError(asTextError(
        acceptError?.response?.data?.detail,
        acceptError?.message || pageT('acceptFailed')
      ));
    } finally {
      setAcceptingProposal(false);
    }
  };

  const handleCompleteJob = async () => {
    if (!job?.id) return;
    if (!window.confirm(pageT('confirmCompleteJob'))) {
      return;
    }

    setCompletingJob(true);
    setMessageError('');
    setMessageSuccess('');

    try {
      const response = await jobsAPI.completeJob(job.id);
      const updatedJob = response?.data?.job || response?.data;
      const payoutStatus = response?.data?.payout_status;

      setJob((previous) => (previous ? { ...previous, ...updatedJob } : updatedJob));

      if (payoutStatus === 'released') {
        setMessageSuccess(pageT('missionClosedPaid'));
      } else if (payoutStatus === 'releasing') {
        setMessageSuccess(pageT('missionClosedProcessing'));
      } else {
        setMessageSuccess(response?.data?.message || pageT('missionClosedManual'));
      }
      await refreshPaymentStatus();
    } catch (completeError) {
      setMessageError(asTextError(
        completeError?.response?.data?.detail,
        completeError?.message || pageT('closeMissionFailed')
      ));
    } finally {
      setCompletingJob(false);
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
          {error || pageT('notFound') || t('jobNotFound')}
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
                  {(() => {
                    const isCompleted = job.status === 'completed';
                    const isInProgress = job.status === 'in_progress' && assignedWorkerId;
                    const label = isCompleted ? pageT('missionDone') : isInProgress ? pageT('attributed') : formatJobStatus(job.status, t);
                    const badgeClass = isCompleted
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : isInProgress
                        ? 'bg-orange-50 text-orange-700 border-orange-200'
                        : 'bg-gray-50 text-gray-700 border-gray-200';
                    return (
                      <span className={`px-3 py-1 rounded-full text-sm font-medium border ${badgeClass}`}>
                        {label}
                      </span>
                    );
                  })()}
                  <span className="text-sm text-gray-500">{t('jobUiPublishedOnPrefix')} {publishedLabel}</span>
                  {hasApplied && !isJobOwner && (
                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {pageT('proposalSentBadge')}
                    </span>
                  )}
                  {assignedToCurrentWorker && (
                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {pageT('youAreAssigned')}
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
                    {t('jobUiMyJobs')}
                  </button>
                  <button onClick={handleDelete} disabled={deleting} className="rounded-xl bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                    {deleting ? t('jobUiDeleting') : t('jobUiDeleteJob')}
                  </button>
                  {job.status === 'in_progress' && assignedWorkerId && paymentStatus?.payment_status === 'completed' && (
                    <button onClick={handleCompleteJob} disabled={completingJob} className="rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                      {completingJob ? pageT('closing') : pageT('workDone')}
                    </button>
                  )}
                </>
              )}

              {canApply && (
                <button onClick={() => setShowProposalModal(true)} className="rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white hover:bg-orange-700">
                  {t('jobUiApply')}
                </button>
              )}
            </div>

            {!canApply && hasApplied && !isJobOwner && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                {pageT('proposalAlreadySent')}
              </div>
            )}

            {assignedWorkerId && (() => {
              const hasPayment = Boolean(paymentStatus?.has_payment);
              const paymentState = hasPayment ? paymentStatus.payment_status : 'none'; // none | pending | completed | failed | cancelled
              const payoutState = paymentStatus?.payout_status; // held | releasing | released | release_failed
              const isCompletedJob = job.status === 'completed';

              const paymentDone = paymentState === 'completed';
              const missionDone = isCompletedJob;

              const steps = [
                { key: 'assigned', label: t('stepAssigned'), done: true },
                { key: 'payment', label: t('stepPayment'), done: paymentDone },
                { key: 'completed', label: t('stepCompleted'), done: missionDone },
              ];

              let statusBadge;
              if (paymentState === 'none') {
                statusBadge = { text: t('payStatusNone'), className: 'bg-gray-100 text-gray-600 border-gray-200' };
              } else if (paymentState === 'pending') {
                statusBadge = { text: t('payStatusPending'), className: 'bg-amber-50 text-amber-700 border-amber-200' };
              } else if (paymentState === 'failed' || paymentState === 'cancelled') {
                statusBadge = { text: t('payStatusFailed'), className: 'bg-red-50 text-red-700 border-red-200' };
              } else if (paymentDone && payoutState === 'released') {
                statusBadge = { text: t('payStatusPaid'), className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
              } else if (paymentDone) {
                statusBadge = { text: t('payStatusEscrowed'), className: 'bg-orange-50 text-orange-700 border-orange-200' };
              } else {
                statusBadge = { text: t('payStatusNone'), className: 'bg-gray-100 text-gray-600 border-gray-200' };
              }

              return (
                <div className="mt-6 border-t border-gray-100 pt-5">
                  <div className="flex items-center">
                    {steps.map((step, idx) => (
                      <Fragment key={step.key}>
                        <div className="flex flex-col items-center gap-1 text-center w-24">
                          <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${step.done ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                            {step.done ? '✓' : idx + 1}
                          </div>
                          <span className={`text-xs leading-tight ${step.done ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{step.label}</span>
                        </div>
                        {idx < steps.length - 1 && (
                          <div className={`h-0.5 flex-1 ${steps[idx + 1].done ? 'bg-emerald-600' : 'bg-gray-200'}`} />
                        )}
                      </Fragment>
                    ))}
                  </div>

                  <div className={`mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${statusBadge.className}`}>
                    {paymentStatusLoading ? t('payStatusChecking') : statusBadge.text}
                  </div>

                  {isJobOwner && paymentState === 'none' && !isCompletedJob && (
                    <div className="mt-3">
                      <button
                        onClick={() => {
                          const proposedAmount = selectedProposal?.proposed_amount ?? selectedProposal?.amount ?? null;
                          const paymentAmount = proposedAmount || job?.budget_max || job?.budget_min || null;
                          const paymentParams = new URLSearchParams({
                            job_id: job.id,
                            worker_id: assignedWorkerId,
                            ...(paymentAmount ? { amount: String(Math.round(paymentAmount)) } : {}),
                            ...(job?.title ? { job_title: encodeURIComponent(job.title) } : {}),
                          });
                          navigate(`/payment?${paymentParams.toString()}`);
                        }}
                        className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-700"
                      >
                        {t('payNow')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {job.shared_location?.maps_url && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3">
                <span className="text-sm text-orange-800">📍 {t('sharedPositionText')}</span>
                <a href={job.shared_location.maps_url} target="_blank" rel="noreferrer" className="flex-shrink-0 text-sm font-semibold text-orange-700 underline underline-offset-2">
                  {t('viewOnMap')}
                </a>
              </div>
            )}
          </div>

          {/* Bandeau de confiance : le paiement séquestré est LE différenciateur */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🛡️</span>
              <div>
                <div className="font-semibold text-emerald-800">{t('escrowBannerTitle')}</div>
                <p className="text-sm text-emerald-700 mt-1">
                  {t('escrowBannerText')}
                </p>
                <Link
                  to="/how-it-works"
                  className="mt-2 inline-block text-sm font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                >
                  {t('howItWorksLink')}
                </Link>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('jobUiDescription')}</h2>
            <p className="text-gray-700 whitespace-pre-line">{job.description}</p>
          </div>

          {isJobOwner && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('jobUiReceivedProposals')}</h2>
              {proposals.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500">
                  {t('jobUiNoProposals')}
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
                        isSelected={proposalId === extractProposalId(selectedProposal)}
                        isAccepted={isAccepted}
                        onOpenDiscussion={() => openDiscussionForProposal(proposalId)}
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
            <div id="job-discussion" ref={discussionSectionRef} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    {pageT('discussionWith', { name: discussionTarget.name || (isJobOwner ? t('worker') : t('client')) })}
                  </h2>
                  <p className="text-sm text-gray-500">
                    {isJobOwner ? pageT('discussionOwnerHint') : pageT('discussionWorkerHint')}
                  </p>
                </div>
                {proposalAccepted && (
                  <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                    {pageT('proposalAssigned')}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => navigate('/messages')}
                  className="text-sm font-medium text-orange-600 hover:text-orange-700 whitespace-nowrap"
                >
                  {t('openInMessages')} →
                </button>
              </div>

              {messageError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{messageError}</div>
              )}
              {messageSuccess && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{messageSuccess}</div>
              )}

              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 min-h-[180px] space-y-3">
                {messagesLoading ? (
                  <div className="text-sm text-gray-500">{pageT('loadingDiscussion')}</div>
                ) : visibleMessages.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    {pageT('noMessagesInDiscussion')}
                  </div>
                ) : (
                  visibleMessages.map((message) => {
                    const authorId = getMessageAuthorId(message);
                    const isCurrentUser = currentUserIds.has(authorId);
                    const authorName = getReadableUserName({
                      full_name: message?.sender_name || message?.senderName || message?.sender?.full_name,
                      name: message?.sender?.name,
                      email: message?.sender?.email,
                    }, getParticipantNameFromIds(authorId, isCurrentUser ? currentUserDisplayName : (discussionTarget?.name || pageT('interlocutorFallback'))));

                    return (
                      <MessageBubble
                        key={message.id || message._id || `${authorId}-${message.created_at || Math.random()}`}
                        message={message}
                        isCurrentUser={isCurrentUser}
                        authorName={authorName}
                      />
                    );
                  })
                )}
              </div>

              <div className="space-y-3">
                <textarea
                  ref={discussionInputRef}
                  rows="4"
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder={pageT('writeMessagePlaceholder')}
                />
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                  <button onClick={handleSendMessage} disabled={sendingMessage} className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
                    {sendingMessage ? pageT('sending') : pageT('sendMessage')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {job.status === 'completed' && (isJobOwner || assignedToCurrentWorker) && (
            <JobReviews jobId={job.id} />
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('jobUiInformation')}</h2>
            <div className="space-y-3 text-gray-700">
              <div>{job.location_text}</div>
              {job.location_precision && <div className="text-sm text-gray-500">{job.location_precision}</div>}
              {job.category && <div className="text-sm text-gray-500">{pageT('categoryLabel', { value: job.category })}</div>}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{t('jobUiClient')}</h2>              <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center font-bold">
                {String(job.client_name || 'C').charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-medium text-gray-900">{job.client_name}</div>
                  <VerifiedBadge verified={job?.client_is_verified || job?.client?.is_verified} />
                </div>
                <div className="text-sm text-gray-500">{job.client_email || t('clientProfile')}</div>
              </div>
            </div>
          </div>

          {!isJobOwner && currentUserProposal && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{pageT('yourProposal')}</h2>
              <div className="space-y-2 text-sm text-gray-700">
                {currentUserProposal?.proposed_amount && <div><span className="font-semibold">{pageT('amountLabel')}</span> {formatBudgetRange(currentUserProposal.proposed_amount, null)}</div>}
                {currentUserProposal?.estimated_completion_time && <div><span className="font-semibold">{pageT('deadlineLabel')}</span> {currentUserProposal.estimated_completion_time}</div>}
                {extractProposalMessage(currentUserProposal) && <div className="whitespace-pre-line"><span className="font-semibold">{pageT('messageLabel')}</span> {extractProposalMessage(currentUserProposal)}</div>}
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
            setMessageSuccess(pageT('proposalSentSuccess'));
            loadJobDetails();
          }}
        />
      )}
    </div>
  );
}
