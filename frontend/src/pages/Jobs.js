import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import JobCreateModal from '../components/JobCreateModal';
import { ListSkeleton } from '../components/SkeletonLoader';
import { jobsAPI } from '../services/api';
import { getLocaleForLanguage, makeScopedTranslator } from '../utils/pack2PageI18n';
import { getJobUiLabel } from '../utils/jobUiLocale';
import { safeLog } from '../utils/env';
import { formatBudgetRange, formatJobDate, formatJobStatus, isOwnedByCurrentUser } from '../utils/jobPageSafeHelpers';
import { normalizeJobList } from '../utils/jobDisplayBridge';

function JobCard({ job, userType }) {
  const locationText = job.location_text || 'Localisation non précisée';

  return (
    <Link to={`/jobs/${job.id}`} className="block bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow p-6 border border-gray-100">
      <div className="flex justify-between items-start gap-6 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h3 className="text-lg font-semibold text-gray-900">{job.title}</h3>
            <span className="px-2 py-1 text-xs rounded-full bg-orange-50 text-orange-700 border border-orange-200">
              {formatJobStatus(job.status)}
            </span>
          </div>
          <p className="text-gray-600 line-clamp-2 mb-4">{job.description}</p>
          <div className="flex flex-wrap gap-4 text-sm text-gray-500">
            <span>{formatJobDate(job.posted_at || job.created_at)}</span>
            <span>{locationText}</span>
            {job.category && <span>{job.category}</span>}
          </div>
        </div>

        <div className="ml-0 md:ml-6 text-right min-w-[170px]">
          <div className="text-2xl font-bold text-orange-600">{formatBudgetRange(job.budget_min, job.budget_max)}</div>
          {job.estimated_duration && <div className="text-sm text-gray-500 mt-1">{job.estimated_duration}</div>}
          {userType === 'worker' && job.status === 'open' && (
            <div className="mt-2 inline-flex rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 border border-green-200">
              Postuler disponible
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filters, setFilters] = useState({ category: '', status: '', search: '' });
  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'jobs');
  const jobUi = getJobUiLabel(currentLanguage);
  const [searchParams] = useSearchParams();
  const locale = getLocaleForLanguage(currentLanguage);

  useEffect(() => {
    const categoryParam = searchParams.get('category');
    if (categoryParam) {
      setFilters((prev) => ({ ...prev, category: categoryParam }));
    }
    loadJobs();
  }, [searchParams, user?.id, user?.user_type]);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const response = await jobsAPI.getAll();
      const jobsData = normalizeJobList(Array.isArray(response) ? response : response?.data || []);
      const visibleJobs = user?.user_type === 'client'
        ? jobsData.filter((job) => isOwnedByCurrentUser(job, user))
        : jobsData.filter((job) => job.status === 'open' || !job.status);
      setJobs(visibleJobs);
    } catch (error) {
      safeLog('Jobs load error', error);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (filters.category && job.category !== filters.category) return false;
      if (filters.status && job.status !== filters.status) return false;
      if (filters.search) {
        const haystack = `${job.title || ''} ${job.description || ''} ${job.location_text || ''}`.toLowerCase();
        if (!haystack.includes(filters.search.toLowerCase())) return false;
      }
      return true;
    });
  }, [jobs, filters]);

  const categories = [
    { value: '', label: pageT('allCategories') || 'Toutes les catégories' },
    { value: 'plumbing', label: 'Plomberie' },
    { value: 'electrical', label: 'Électricité' },
    { value: 'construction', label: 'Construction' },
    { value: 'cleaning', label: 'Nettoyage' },
    { value: 'gardening', label: 'Jardinage' },
    { value: 'tutoring', label: 'Cours' },
    { value: 'mechanics', label: 'Mécanique' },
    { value: 'general', label: 'Général' },
  ];

  const statuses = [
    { value: '', label: pageT('allStatuses') || 'Tous les statuts' },
    { value: 'open', label: 'Ouvert' },
    { value: 'in_progress', label: 'En cours' },
    { value: 'completed', label: 'Terminé' },
    { value: 'cancelled', label: 'Annulé' },
    { value: 'pending', label: 'En attente' },
  ];

  if (loading) {
    return <ListSkeleton />;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {user?.user_type === 'client' ? (pageT('myJobs') || 'Mes emplois') : (pageT('availableJobs') || 'Emplois disponibles')}
          </h1>
          <p className="mt-2 text-gray-600">{new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())}</p>
        </div>
        {user?.user_type === 'client' && (
          <button onClick={() => setShowCreateModal(true)} className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700">
            {jobUi.createJob}
          </button>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <input
          value={filters.search}
          onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          placeholder={pageT('searchPlaceholder') || 'Rechercher un job'}
          className="rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
        />
        <select
          value={filters.category}
          onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
          className="rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
        >
          {categories.map((category) => (
            <option key={category.value} value={category.value}>{category.label}</option>
          ))}
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
          className="rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
        >
          {statuses.map((status) => (
            <option key={status.value} value={status.value}>{status.label}</option>
          ))}
        </select>
      </div>

      {filteredJobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
          {user?.user_type === 'client' ? 'Aucun job trouvé pour ce compte.' : 'Aucun job disponible pour le moment.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredJobs.map((job) => (
            <JobCard key={job.id} job={job} userType={user?.user_type} />
          ))}
        </div>
      )}

      {showCreateModal && (
        <JobCreateModal
          onClose={() => setShowCreateModal(false)}
          onJobCreated={() => {
            setShowCreateModal(false);
            loadJobs();
          }}
        />
      )}
    </div>
  );
}
