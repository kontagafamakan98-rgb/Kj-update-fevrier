import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  CircleDollarSign,
  ClipboardList,
  GraduationCap,
  Hammer,
  Leaf,
  MessageSquare,
  Monitor,
  PlusCircle,
  Sparkles,
  Wrench,
  Zap
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import OwnerService from '../services/ownerService';
import PreciseLocationDemo from '../components/PreciseLocationDemo';
import { jobsAPI } from '../services/api';
import { getLocaleForLanguage, makeScopedTranslator } from '../utils/pack2PageI18n';
import { safeLog } from '../utils/env';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalJobs: 0,
    activeJobs: 0,
    completedJobs: 0,
    totalEarnings: 0
  });
  const [recentJobs, setRecentJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFamakan, setIsFamakan] = useState(false);

  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'dashboard');
  const locale = useMemo(() => getLocaleForLanguage(currentLanguage), [currentLanguage]);

  useEffect(() => {
    loadDashboardData();
    setIsFamakan(OwnerService.isFamakanLoggedIn());
  }, []);

  const loadDashboardData = async () => {
    try {
      const jobs = await jobsAPI.getAll();
      const jobsList = Array.isArray(jobs) ? jobs : jobs?.data || [];

      if (user.user_type === 'client') {
        const clientJobs = jobsList.filter((job) => job.client_id === user.id);
        setStats({
          totalJobs: clientJobs.length,
          activeJobs: clientJobs.filter((job) => job.status === 'open' || job.status === 'in_progress').length,
          completedJobs: clientJobs.filter((job) => job.status === 'completed').length,
          totalEarnings: 0
        });
        setRecentJobs(clientJobs.slice(0, 5));
      } else {
        setRecentJobs(jobsList.slice(0, 5));
      }
    } catch (error) {
      safeLog.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const translateStatus = (status) => {
    if (status === 'in_progress') return pageT('status_in_progress');
    return pageT(`status_${status}`) || t(status) || status;
  };

  const translateCategory = (category) => t(category) || category;

  const statCards = [
    { label: t('activeJobs'), value: stats.activeJobs, icon: ClipboardList },
    { label: t('completedJobs'), value: stats.completedJobs, icon: Sparkles },
    { label: t('totalJobs'), value: stats.totalJobs, icon: Briefcase },
    { label: t('totalEarnings'), value: `${stats.totalEarnings.toLocaleString(locale)} XOF`, icon: CircleDollarSign }
  ];

  const quickActions = (() => {
    const baseActions = user.user_type === 'client'
      ? [
          { to: '/create-job', label: t('postJob'), icon: PlusCircle, iconClass: 'text-orange-600 bg-orange-100' },
          { to: '/jobs', label: t('myJobs'), icon: Briefcase, iconClass: 'text-blue-600 bg-blue-100' },
          { to: '/messages', label: t('messages'), icon: MessageSquare, iconClass: 'text-green-600 bg-green-100' }
        ]
      : [
          { to: '/jobs', label: `${t('searchJobs')} ${t('jobs')}`, icon: Briefcase, iconClass: 'text-orange-600 bg-orange-100' },
          { to: '/profile', label: t('workerProfile'), icon: Wrench, iconClass: 'text-blue-600 bg-blue-100' },
          { to: '/messages', label: t('messages'), icon: MessageSquare, iconClass: 'text-green-600 bg-green-100' }
        ];

    if (isFamakan) {
      baseActions.push({
        to: '/payment-demo',
        label: t('languagesPayments'),
        subtitle: t('publicFeature'),
        icon: Monitor,
        iconClass: 'text-amber-600 bg-amber-100',
        cardClass: 'bg-gradient-to-r from-orange-50 to-yellow-50'
      });
    }

    return baseActions;
  })();

  const popularCategories = [
    { key: 'plumbing', icon: Wrench },
    { key: 'electrical', icon: Zap },
    { key: 'mechanics', icon: Briefcase },
    { key: 'construction', icon: Hammer },
    { key: 'cleaning', icon: Sparkles },
    { key: 'gardening', icon: Leaf },
    { key: 'tutoring', icon: GraduationCap },
    { key: 'computing', icon: Monitor }
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600">{pageT('loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          {t('welcomeUser')} {user.first_name}!
        </h1>
        <p className="text-gray-600 mt-1">
          {user.user_type === 'client' ? t('manageProjectsClient') : t('discoverOpportunitiesWorker')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-600">{item.label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{item.value}</p>
                </div>
                <div className="rounded-xl bg-orange-50 p-3 text-orange-600">
                  <Icon className="w-6 h-6" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {isFamakan && (
        <div className="mb-8 p-6 bg-gradient-to-r from-orange-50 to-red-50 border border-orange-200 rounded-lg">
          <div className="flex items-center mb-4">
            <span className="text-2xl mr-3">👑</span>
            <h2 className="text-xl font-semibold text-orange-900">{t('famakanAccess')}</h2>
          </div>
          <p className="text-sm text-orange-800 mb-4">{t('famakanDescription')}</p>

          <div className="flex flex-wrap gap-4">
            <Link to="/mobile-test" className="inline-flex items-center px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors shadow-md">
              📱 {t('testMobileFeatures')}
            </Link>
            <Link to="/create-job" className="inline-flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-md">
              🚀 {t('createJobGPS')}
            </Link>
            <Link to="/photo-test" className="inline-flex items-center px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shadow-md">
              📷 {t('debugPhotos')}
            </Link>
            <Link to="/commission-dashboard" className="inline-flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-md">
              💼 {t('commissionDashboard')}
            </Link>
          </div>

          <div className="mt-6">
            <PreciseLocationDemo />
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">{t('quickActions')}</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.to + action.label}
                  to={action.to}
                  className={`flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors ${action.cardClass || ''}`}
                >
                  <div className={`shrink-0 rounded-xl p-3 ${action.iconClass}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-medium text-gray-900 block">{action.label}</span>
                    {action.subtitle ? <p className="text-xs text-gray-500 mt-1">{action.subtitle}</p> : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">{t('popularCategories')}</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {popularCategories.map((category) => {
              const Icon = category.icon;
              return (
                <Link key={category.key} to={`/jobs?category=${category.key}`} className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors group">
                  <div className="mb-3 rounded-xl bg-orange-50 p-3 text-orange-600 group-hover:bg-orange-100">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-medium text-gray-900 text-center">{t(category.key)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">
            {user.user_type === 'client' ? t('myRecentJobs') : t('availableJobs')}
          </h2>
        </div>
        <div className="divide-y divide-gray-200">
          {recentJobs.length > 0 ? (
            recentJobs.map((job) => (
              <Link key={job.id} to={`/jobs/${job.id}`} className="block p-6 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-900">{job.title}</h3>
                    <p className="text-sm text-gray-600 mt-1">{job.description}</p>
                    <div className="flex items-center mt-2 space-x-4 flex-wrap">
                      <span className="text-xs text-gray-500">{translateCategory(job.category)}</span>
                      <span className="text-xs text-gray-500">{pageT('recentBudget', { min: job.budget_min, max: job.budget_max })}</span>
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        job.status === 'open'
                          ? 'bg-green-100 text-green-800'
                          : job.status === 'in_progress'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-800'
                      }`}>
                        {translateStatus(job.status)}
                      </span>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
                  </svg>
                </div>
              </Link>
            ))
          ) : (
            <div className="p-6 text-center text-gray-500">
              {user.user_type === 'client' ? t('noJobsPosted') : t('noJobsAvailable')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
