import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import ProposalModal from '../components/ProposalModal';
import { jobsAPI } from '../services/api';
import { makeScopedTranslator } from '../utils/pack2PageI18n';
import { safeLog } from '../utils/env';
import { deleteJobWithFallbacks, ensureJobOwnerActionBar } from '../utils/jobOwnerDeleteRuntime';
import { formatBudgetRange, formatJobDate, formatJobStatus, isOwnedByCurrentUser } from '../utils/jobPageSafeHelpers';
import { normalizeJobRecord } from '../utils/jobDisplayBridge';

function ProposalCard({ proposal }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold text-gray-900">{proposal.worker_name || 'Travailleur'}</div>
          <div className="text-sm text-gray-500">{formatJobDate(proposal.created_at)}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-orange-600">{formatBudgetRange(proposal.proposed_amount, null)}</div>
          <div className="text-xs text-gray-500">{formatJobStatus(proposal.status || 'pending')}</div>
        </div>
      </div>
      {proposal.cover_letter && <p className="mt-3 text-sm text-gray-700">{proposal.cover_letter}</p>}
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

  const { id } = useParams();
  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'jobDetails');
  const navigate = useNavigate();

  useEffect(() => {
    loadJobDetails();
  }, [id, user?.id, user?.user_type]);

  useEffect(() => {
    return ensureJobOwnerActionBar(job);
  }, [job]);

  const loadJobDetails = async () => {
    setLoading(true);
    setError('');
    try {
      const jobData = normalizeJobRecord(await jobsAPI.getById(id));
      setJob(jobData);

      if (isOwnedByCurrentUser(jobData, user)) {
        try {
          const proposalsResponse = await jobsAPI.getApplications(id);
          const proposalData = Array.isArray(proposalsResponse) ? proposalsResponse : proposalsResponse?.data || [];
          setProposals(proposalData);
        } catch (proposalError) {
          safeLog.error('Error loading proposals:', proposalError);
          setProposals([]);
        }
      } else {
        setProposals([]);
      }
    } catch (jobError) {
      safeLog.error('Error loading job details:', jobError);
      setError(jobError?.response?.data?.detail || jobError?.message || pageT('loadError') || 'Impossible de charger ce job');
    } finally {
      setLoading(false);
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

  const isJobOwner = isOwnedByCurrentUser(job, user);
  const canApply = user?.user_type === 'worker' && job.status === 'open';
  const publishedLabel = formatJobDate(job.posted_at || job.created_at || job.updated_at);

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
                    {formatJobStatus(job.status)}
                  </span>
                  <span className="text-sm text-gray-500">Publié le {publishedLabel}</span>
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
                    Mes jobs
                  </button>
                  <button onClick={handleDelete} disabled={deleting} className="rounded-xl bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                    {deleting ? 'Suppression...' : 'Supprimer ce job'}
                  </button>
                </>
              )}

              {canApply && (
                <button onClick={() => setShowProposalModal(true)} className="rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white hover:bg-orange-700">
                  {pageT('apply') || 'Postuler'}
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Description</h2>
            <p className="text-gray-700 whitespace-pre-line">{job.description}</p>
          </div>

          {isJobOwner && proposals.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Propositions reçues</h2>
              <div className="space-y-4">
                {proposals.map((proposal) => (
                  <ProposalCard key={proposal.id || proposal._id || Math.random()} proposal={proposal} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Informations</h2>
            <div className="space-y-3 text-gray-700">
              <div>{job.location_text}</div>
              {job.location_precision && <div className="text-sm text-gray-500">{job.location_precision}</div>}
              {job.category && <div className="text-sm text-gray-500">Catégorie : {job.category}</div>}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Client</h2>
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
        </div>
      </div>

      {showProposalModal && canApply && (
        <ProposalModal
          job={job}
          onClose={() => setShowProposalModal(false)}
          onProposalSubmitted={() => {
            setShowProposalModal(false);
            loadJobDetails();
          }}
        />
      )}
    </div>
  );
}
