import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import OwnerService from '../services/ownerService';
import PreciseLocationDemo from '../components/PreciseLocationDemo';
import { devLog, safeLog } from '../utils/env';

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
  const { t } = useLanguage();

  useEffect(() => {
    loadDashboardData();
    // Vérifier si l'utilisateur connecté est Famakan Kontaga Master
    setIsFamakan(OwnerService.isFamakanLoggedIn());
  }, []);

  const loadDashboardData = async () => {
    try {
      const jobsResponse = await axios.get('/jobs');
      const jobs = jobsResponse.data;
      
      // Calculate stats based on user type
      if (user.user_type === 'client') {
        const clientJobs = jobs.filter(job => job.client_id === user.id);
        setStats({
          totalJobs: clientJobs.length,
          activeJobs: clientJobs.filter(job => job.status === 'open' || job.status === 'in_progress').length,
          completedJobs: clientJobs.filter(job => job.status === 'completed').length,
          totalEarnings: 0 // Will be calculated with payment data
        });
        setRecentJobs(clientJobs.slice(0, 5));
      } else {
        // For workers, we need to get jobs they've applied to or are assigned to
        setRecentJobs(jobs.slice(0, 5));
      }
    } catch (error) {
      safeLog.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Welcome Section */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          {t('welcomeUser')} {user.first_name}!
        </h1>
        <p className="text-gray-600 mt-1">
          {user.user_type === 'client' ? t('manageProjectsClient') : t('discoverOpportunitiesWorker')}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{t('activeJobs')}</p>
              <p className="text-2xl font-bold text-gray-900">{stats.activeJobs}</p>
            </div>
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m8 0V6a2 2 0 012 2v6l-3.396 1.132A12.083 12.083 0 0112 15m8-9v2a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h12a2 2 0 012 2z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Jobs terminés</p>
              <p className="text-2xl font-bold text-gray-900">{stats.completedJobs}</p>
            </div>
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total jobs</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalJobs}</p>
            </div>
            <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Gains totaux</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalEarnings.toLocaleString()} XOF</p>
            </div>
            <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Test Buttons - SEUL FAMAKAN KONTAGA MASTER PEUT Y ACCÉDER */}
      {isFamakan && (
        <div className="mb-8 p-6 bg-gradient-to-r from-orange-50 to-red-50 border border-orange-200 rounded-lg">
          <div className="flex items-center mb-4">
            <span className="text-2xl mr-3">👑</span>
            <h2 className="text-xl font-semibold text-orange-900">
              Accès Famakan Kontaga Master
            </h2>
          </div>
          <p className="text-sm text-orange-800 mb-4">
            Fonctionnalités réservées exclusivement au propriétaire de l'application
          </p>
          
          <div className="flex flex-wrap gap-4">
            <Link 
              to="/mobile-test"
              className="inline-flex items-center px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors shadow-md"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v16a1 1 0 001 1z" />
              </svg>
              📱 Test Fonctionnalités Mobile
            </Link>
            
            <Link 
              to="/create-job"
              className="inline-flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-md"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              🚀 Créer Job avec GPS
            </Link>

            <Link 
              to="/photo-test"
              className="inline-flex items-center px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shadow-md"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              📷 Debug Photos
            </Link>
            
            <Link
              to="/commission-dashboard"
              className="inline-flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-md"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"></path>
              </svg>
              💼 Commission Dashboard
            </Link>
          </div>

          {/* Démo Géolocalisation Ultra-Précise */}
          <div className="mt-6">
            <PreciseLocationDemo />
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Actions rapides</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {user.user_type === 'client' ? (
              <>
                <Link
                  to="/jobs/create"
                  className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="p-2 bg-orange-100 rounded-lg mr-3">
                    <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path>
                    </svg>
                  </div>
                  <span className="font-medium text-gray-900">{t('postJob')}</span>
                </Link>
                <Link
                  to="/jobs"
                  className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="p-2 bg-blue-100 rounded-lg mr-3">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                  </div>
                  <span className="font-medium text-gray-900">Mes {t('jobs')}</span>
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/jobs"
                  className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="p-2 bg-blue-100 rounded-lg mr-3">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                  </div>
                  <span className="font-medium text-gray-900">Chercher {t('jobs')}</span>
                </Link>
                <Link
                  to="/profile"
                  className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="p-2 bg-green-100 rounded-lg mr-3">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                    </svg>
                  </div>
                  <span className="font-medium text-gray-900">Profil travailleur</span>
                </Link>
              </>
            )}
            <Link
              to="/messages"
              className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="p-2 bg-purple-100 rounded-lg mr-3">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                </svg>
              </div>
              <span className="font-medium text-gray-900">{t('messages')}</span>
            </Link>
            
            {/* Nouveau lien vers la démo - Accessible à tous */}
            <Link
              to="/payment-demo"
              className="flex items-center p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors bg-gradient-to-r from-orange-50 to-yellow-50"
            >
              <div className="p-2 bg-orange-100 rounded-lg mr-3">
                <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path>
                </svg>
              </div>
              <div>
                <span className="font-medium text-gray-900">🌍 Langues & Paiements</span>
                <p className="text-xs text-gray-500 mt-1">Fonctionnalité publique</p>
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* Popular Categories */}
      <div className="bg-white rounded-lg shadow mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Catégories populaires</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            <Link
              to="/jobs?category=plumbing"
              className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors group"
            >
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-2 group-hover:bg-blue-200">
                <span className="text-2xl">🔧</span>
              </div>
              <span className="text-sm font-medium text-gray-900 text-center">{t('plumbing')}</span>
            </Link>
            
            <Link
              to="/jobs?category=electrical"
              className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:bg-yellow-50 hover:border-yellow-300 transition-colors group"
            >
              <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-2 group-hover:bg-yellow-200">
                <span className="text-2xl">⚡</span>
              </div>
              <span className="text-sm font-medium text-gray-900 text-center">{t('electrical')}</span>
            </Link>

            <Link
              to="/jobs?category=mechanics"
              className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors group"
            >
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-2 group-hover:bg-red-200">
                <span className="text-2xl">🔩</span>
              </div>
              <span className="text-sm font-medium text-gray-900 text-center">{t('mechanics')}</span>
            </Link>
            
            <Link
              to="/jobs?category=construction"
              className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:bg-orange-50 hover:border-orange-300 transition-colors group"
            >
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mb-2 group-hover:bg-orange-200">
                <span className="text-2xl">🏗️</span>
              </div>
              <span className="text-sm font-medium text-gray-900 text-center">{t('construction')}</span>
            </Link>
            
            <Link
              to="/jobs?category=cleaning"
              className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors group"
            >
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-2 group-hover:bg-green-200">
                <span className="text-2xl">🧹</span>
              </div>
              <span className="text-sm font-medium text-gray-900 text-center">{t('cleaning')}</span>
            </Link>
            
            <Link
              to="/jobs?category=gardening"
              className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors group"
            >
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-2 group-hover:bg-green-200">
                <span className="text-2xl">🌱</span>
              </div>
              <span className="text-sm font-medium text-gray-900 text-center">{t('gardening')}</span>
            </Link>
            
            <Link
              to="/jobs?category=tutoring"
              className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors group"
            >
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mb-2 group-hover:bg-purple-200">
                <span className="text-2xl">📚</span>
              </div>
              <span className="text-sm font-medium text-gray-900 text-center">{t('tutoring')}</span>
            </Link>
            
            <Link
              to="/jobs?category=computing"
              className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:bg-indigo-50 hover:border-indigo-300 transition-colors group"
            >
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mb-2 group-hover:bg-indigo-200">
                <span className="text-2xl">💻</span>
              </div>
              <span className="text-sm font-medium text-gray-900 text-center">{t('computing')}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Recent Jobs */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">
            {user.user_type === 'client' ? 'Mes emplois récents' : 'Emplois disponibles'}
          </h2>
        </div>
        <div className="divide-y divide-gray-200">
          {recentJobs.length > 0 ? (
            recentJobs.map((job) => (
              <Link
                key={job.id}
                to={`/jobs/${job.id}`}
                className="block p-6 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-900">{job.title}</h3>
                    <p className="text-sm text-gray-600 mt-1">{job.description}</p>
                    <div className="flex items-center mt-2 space-x-4">
                      <span className="text-xs text-gray-500">{job.category}</span>
                      <span className="text-xs text-gray-500">{job.budget_min} - {job.budget_max} FCFA</span>
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        job.status === 'open' ? 'bg-green-100 text-green-800' :
                        job.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {job.status}
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
              {user.user_type === 'client' ? 'Aucun emploi publié' : 'Aucun emploi disponible'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}