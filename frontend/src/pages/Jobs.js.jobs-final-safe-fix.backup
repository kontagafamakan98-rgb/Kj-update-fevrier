import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import JobCreateModal from '../components/JobCreateModal';
import MechanicRequirements from '../components/MechanicRequirements';
import { ListSkeleton } from '../components/SkeletonLoader';
import { jobsAPI } from '../services/api';
import { getLocaleForLanguage, makeScopedTranslator } from '../utils/pack2PageI18n';
import { safeLog } from '../utils/env';

export default function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [filteredJobs, setFilteredJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filters, setFilters] = useState({ category: '', status: '', search: '' });

  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'jobs');
  const [searchParams] = useSearchParams();

  useEffect(() => {
    loadJobs();
    const categoryParam = searchParams.get('category');
    if (categoryParam) {
      setFilters((prev) => ({ ...prev, category: categoryParam }));
    }
  }, [searchParams]);

  useEffect(() => {
    filterJobs();
  }, [jobs, filters]);

  const loadJobs = async () => {
    try {
      const response = await jobsAPI.getAll();
      const jobsData = Array.isArray(response) ? response : response?.data || [];

      if (user.user_type === 'client') {
        setJobs(jobsData.filter((job) => job.client_id === user.id));
      } else {
        setJobs(jobsData);
      }
    } catch (error) {
      safeLog.error('Error loading jobs:', error);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  const filterJobs = () => {
    let filtered = [...jobs];

    if (filters.category) {
      filtered = filtered.filter((job) => job.category === filters.category);
    }

    if (filters.status) {
      filtered = filtered.filter((job) => job.status === filters.status);
    }

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(
        (job) => job.title.toLowerCase().includes(searchLower) || job.description.toLowerCase().includes(searchLower)
      );
    }

    setFilteredJobs(filtered);
  };

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const categories = [
    { value: '', label: t('allCategories') },
    { value: 'plumbing', label: t('plumbing') },
    { value: 'electrical', label: t('electrical') },
    { value: 'construction', label: t('construction') },
    { value: 'cleaning', label: t('cleaning') },
    { value: 'gardening', label: t('gardening') },
    { value: 'tutoring', label: t('tutoring') },
    { value: 'mechanics', label: t('mechanics') }
  ];

  const statuses = [
    { value: '', label: t('allStatuses') },
    { value: 'open', label: t('open') },
    { value: 'in_progress', label: t('inProgress') },
    { value: 'completed', label: t('completed') },
    { value: 'cancelled', label: t('cancelled') }
  ];

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-2"></div>
          <div className="h-4 w-64 bg-gray-200 rounded animate-pulse"></div>
        </div>
        <ListSkeleton count={5} type="job" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {user.user_type === 'client' ? t('myJobs') : t('availableJobs')}
          </h1>
          <p className="text-gray-600 mt-1">
            {user.user_type === 'client' ? t('manageJobOffers') : t('discoverOpportunities')}
          </p>
        </div>

        {user.user_type === 'client' && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-2 rounded-lg font-medium"
          >
            {t('postJob')}
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow mb-6 p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('search')}</label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              placeholder={pageT('searchPlaceholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{pageT('categoryLabel')}</label>
            <select
              value={filters.category}
              onChange={(e) => handleFilterChange('category', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500"
            >
              {categories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{pageT('statusLabel')}</label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500"
            >
              {statuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={() => setFilters({ category: '', status: '', search: '' })}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-md"
            >
              {t('reset')}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {filteredJobs.length > 0 ? (
          filteredJobs.map((job) => (
            <JobCard key={job.id} job={job} userType={user.user_type} currentLanguage={currentLanguage} t={t} pageT={pageT} />
          ))
        ) : (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">{t('noJobsFound')}</h3>
            <p className="mt-1 text-sm text-gray-500">
              {user.user_type === 'client' ? t('publishFirstJob') : t('modifySearchCriteria')}
            </p>
            {user.user_type === 'client' && (
              <div className="mt-6">
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md"
                >
                  {t('postJob')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showCreateModal && <JobCreateModal onClose={() => setShowCreateModal(false)} onJobCreated={loadJobs} />}
    </div>
  );
}

function JobCard({ job, userType, currentLanguage, t, pageT }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'open':
        return 'bg-green-100 text-green-800';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return 'bg-blue-100 text-blue-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const locale = getLocaleForLanguage(currentLanguage);
  const formatDate = (dateString) =>
    new Date(dateString).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

  const translateStatus = (status) => {
    switch (status) {
      case 'open':
        return t('open');
      case 'in_progress':
        return t('inProgress');
      case 'completed':
        return t('completed');
      case 'cancelled':
        return t('cancelled');
      default:
        return status;
    }
  };

  return (
    <Link to={`/jobs/${job.id}`} className="block bg-white rounded-lg shadow hover:shadow-md transition-shadow p-6">
      <div className="flex justify-between items-start gap-6 flex-wrap">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2 flex-wrap">
            <h3 className="text-lg font-semibold text-gray-900">{job.title}</h3>
            <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(job.status)}`}>
              {translateStatus(job.status)}
            </span>
          </div>

          <p className="text-gray-600 mb-4 line-clamp-2">{job.description}</p>
          <MechanicRequirements job={job} showTitle={false} compact={true} />

          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
            <div className="flex items-center">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path>
              </svg>
              {job.category}
            </div>

            <div className="flex items-center">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
              </svg>
              {job.location?.address || t('locationNotSpecified')}
            </div>

            <div className="flex items-center">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3a2 2 0 012-2h4a2 2 0 012 2v4m-6 0v1m6-1v1m-6 0H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2h-2m-6 0V7"></path>
              </svg>
              {formatDate(job.posted_at)}
            </div>
          </div>
        </div>

        <div className="ml-0 md:ml-6 text-right min-w-[170px]">
          <div className="text-2xl font-bold text-orange-600">
            {job.budget_min} - {job.budget_max} FCFA
          </div>
          {job.estimated_duration && <div className="text-sm text-gray-500 mt-1">{pageT('duration', { value: job.estimated_duration })}</div>}
          {userType === 'worker' && job.status === 'open' && (
            <button className="mt-2 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded text-sm">
              {pageT('apply')}
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}
