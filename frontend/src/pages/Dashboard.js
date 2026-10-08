import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
// Le lien interne AVEC la transition de vue native (components/LienVue.js).
import Link from '../components/LienVue';
import {
  Briefcase,
  CircleDollarSign,
  ClipboardList,
  GraduationCap,
  Hammer,
  Leaf,
  LifeBuoy,
  MessageSquare,
  Monitor,
  PlusCircle,
  Sparkles,
  Wrench,
  Zap,
  PanelsTopLeft,
  Crown,
  Smartphone,
  Rocket,
  Camera
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import OwnerService from '../services/ownerService';
const PreciseLocationDemo = lazy(() => import('../components/PreciseLocationDemo'));
import { jobsAPI } from '../services/apiEndpoints';
import { getLocaleForLanguage } from '../utils/pack2PageI18n/core';
import { makeScopedTranslator } from '../utils/pack2PageI18n/dashboard';
import { safeLog } from '../utils/env';
import { Skeleton } from '../components/SkeletonLoader';

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
  const pageT = makeScopedTranslator(currentLanguage, t);
  const locale = useMemo(() => getLocaleForLanguage(currentLanguage), [currentLanguage]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  useEffect(() => {
    setIsFamakan(OwnerService.isOwnerSessionValid(user));
  }, [user]);

  const loadDashboardData = async () => {
    try {
      const jobs = await jobsAPI.getAll();
      const jobsList = Array.isArray(jobs) ? jobs : jobs?.data || [];

      if (user?.user_type === 'client') {
        const clientJobs = jobsList.filter((job) => job.client_id === user?.id);
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
    const baseActions = user?.user_type === 'client'
      ? [
          { to: '/create-job', label: t('postJob'), icon: PlusCircle, iconClass: 'text-orange-600 bg-orange-100' },
          { to: '/jobs', label: t('myJobs'), icon: Briefcase, iconClass: 'text-orange-700 bg-orange-100' },
          { to: '/messages', label: t('messages'), icon: MessageSquare, iconClass: 'text-orange-700 bg-orange-100' }
        ]
      : [
          { to: '/jobs', label: `${t('searchJobs')} ${t('jobs')}`, icon: Briefcase, iconClass: 'text-orange-600 bg-orange-100' },
          { to: '/profile', label: t('workerProfile'), icon: Wrench, iconClass: 'text-orange-700 bg-orange-100' },
          { to: '/messages', label: t('messages'), icon: MessageSquare, iconClass: 'text-orange-700 bg-orange-100' }
        ];

    if (isFamakan) {
      baseActions.push({
        to: '/payment',
        label: t('languagesPayments'),
        subtitle: t('publicFeature'),
        icon: Monitor,
        iconClass: 'text-orange-700 bg-orange-100',
        cardClass: 'bg-gradient-to-r from-orange-50 to-yellow-50'
      });
      baseActions.push({
        to: '/support-admin',
        label: t('supportRequestsTitle'),
        subtitle: t('supportAdminSubtitle'),
        icon: LifeBuoy,
        iconClass: 'text-orange-600 bg-orange-100',
      });
    }

    return baseActions;
  })();

  // Catégories canoniques du backend (kojo_routers_jobs.py) : general,
  // plumbing, electrical, construction, cleaning, gardening, tutoring,
  // mechanics. « carpentry »/« computing » n'existent pas côté serveur (ils
  // seraient normalisés en « general ») — cliquer menait vers un filtre vide.
  const popularCategories = [
    { key: 'plumbing', icon: Wrench },
    { key: 'electrical', icon: Zap },
    { key: 'mechanics', icon: Briefcase },
    { key: 'construction', icon: Hammer },
    { key: 'general', icon: PanelsTopLeft },
    { key: 'cleaning', icon: Sparkles },
    { key: 'gardening', icon: Leaf },
    { key: 'tutoring', icon: GraduationCap }
  ];

  // Squelette de chargement : reproduit la STRUCTURE EXACTE de la page (mêmes
  // conteneurs, paddings, grilles et hauteurs) pour que le passage aux données
  // réelles ne déplace AUCUN élément → réduit le CLS (mesuré 0.149 avant).
  // Le bloc bannière/quick-actions/catégories est statique (aucune donnée) :
  // seul le header d'accueil + les 4 cartes + la liste récente dépendent des
  // jobs API. On reserve donc leur hauteur.
  if (loading) {
    const cardWrappers = Array.from({ length: 4 });
    return (
      <SkeletonDashboardShell t={t} pageT={pageT} cardWrappers={cardWrappers} />
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        {/* Le titre de page prend l'échelle serif du site (`.titre-page`,
            src/index.css) : c'est la même page d'arrivée que l'accueil pour un
            utilisateur connecté, elle ne peut pas être typographiée comme un
            gabarit d'administration. */}
        <h1 className="titre-page">
          {t('welcomeUser')} {user?.first_name || 'User'}!
        </h1>
        <p className="text-gray-600 mt-1">
          {user?.user_type === 'client' ? t('manageProjectsClient') : t('discoverOpportunitiesWorker')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((item) => {
          const Icon = item.icon;
          // La carte à FILET du site, et la pastille ronde qui porte le glyphe :
          // le même couple que les cartes de /about et que les lignes de
          // l'accueil. `pastille-rond-large` fait 48 px, soit EXACTEMENT la
          // boîte `p-3` + icône 24 px qu'elle remplace — le squelette ci-dessous
          // garde donc la même hauteur (pas de CLS).
          return (
            <div key={item.label} className="carte-editoriale p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-600">{item.label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{item.value}</p>
                </div>
                <div className="pastille-rond pastille-rond-large">
                  <Icon className="w-6 h-6" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* L'ENCART du site (filet gauche orange, fond sable) à la place du
          dégradé orange → ROUGE : c'était le dernier dégradé vers le rouge du
          site, et il ne disait rien de plus que « voici un bloc à part » — ce
          que l'encart dit mieux, avec une seule teinte. */}
      {isFamakan && (
        <div className="encart mb-8">
          <div className="flex items-center mb-4">
            <Crown className="h-6 w-6 mr-3 text-orange-500" aria-hidden="true" />
            <h2 className="titre-section">{t('famakanAccess')}</h2>
          </div>
          <p className="text-sm text-orange-800 mb-4">{t('famakanDescription')}</p>

          <div className="flex flex-wrap gap-3">
            {/* Liens de test réservés au dev : les routes /mobile-test et
                /photo-test ne sont enregistrées qu'en développement
                (import.meta.env.DEV dans App.js) — en prod elles 404.
                /photo-debug est l'équivalent prod (owner-only). */}
            {import.meta.env.DEV && (
              <Link to="/mobile-test" className="bouton bouton-clair">
                <Smartphone className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" /> {t('testMobileFeatures')}
              </Link>
            )}
            <Link to="/create-job" className="bouton bouton-encre">
              <Rocket className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" /> {t('createJobGPS')}
            </Link>
            {import.meta.env.DEV && (
              /* La branche DEV est ÉLIMINÉE du bundle de production : Tailwind, lui,
                 génère quand même les utilitaires qu'il lit ici. Ce lien de test ne
                 reçoit donc AUCUNE teinte propre — il emprunte le gris neutre que le
                 reste du tableau de bord pose déjà, ce qui ne coûte aucune règle au
                 CSS servi (mesuré le 27/09/2026 : plus aucune teinte pourpre n'est
                 générée, son dernier porteur ayant disparu avec ce lot).
                 PIÈGE MESURÉ : nommer une classe d'une teinte retirée, même en
                 commentaire, la RESSUSCITE — Tailwind lit le TEXTE BRUT des sources,
                 prose comprise, et régénère l'utilitaire qu'on vient de retirer. */
              <Link to="/photo-test" className="bouton bouton-clair">
                <Camera className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" /> {t('debugPhotos')}
              </Link>
            )}
            <Link to="/commission-dashboard" className="bouton bouton-clair">
              <Briefcase className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" /> {t('commissionDashboard')}
            </Link>
          </div>

          <div className="mt-6">
            <Suspense fallback={<div className="rounded-xl border border-orange-100 bg-white/70 px-4 py-3 text-sm text-orange-700">{pageT('loading')}</div>}>
              <PreciseLocationDemo />
            </Suspense>
          </div>
        </div>
      )}

      <div className="carte-editoriale mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">{t('quickActions')}</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
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

      <div className="carte-editoriale mb-8">
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
            {user?.user_type === 'client' ? t('myRecentJobs') : t('availableJobs')}
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
                      {/* Le badge d'ÉTAT est carré : le site a retiré la forme
                          pilule de tous ses badges, et une pastille de statut
                          reste une étiquette. */}
                      <span className={`px-2 py-1 text-xs rounded-lg ${
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
              {user?.user_type === 'client' ? t('noJobsPosted') : t('noJobsAvailable')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Squelette du Dashboard : mêmes conteneurs/grid/paddings que le rendu réel
// pour que l'apparition des données ne déplace rien (anti-CLS). Le contenu
// dépendant des jobs API (header d'accueil, 4 cartes stat, liste récente) est
// remplacé par des blocs skeleton de hauteur identique.
function SkeletonDashboardShell({ t, pageT, cardWrappers }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header d'accueil */}
      <div className="mb-8">
        <Skeleton className="h-8 w-64 max-w-full" />
        <div className="mt-2">
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>

      {/* 4 cartes statistiques : même grille que le rendu final */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {cardWrappers.map((_, index) => (
          <div key={index} className="carte-editoriale p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <Skeleton className="h-4 w-20" />
                <div className="mt-3">
                  <Skeleton className="h-7 w-28" />
                </div>
              </div>
              <Skeleton className="h-12 w-12 rounded-full" />
            </div>
          </div>
        ))}
      </div>

      {/* Section quick-actions : conteneur stable, contenu skeleton */}
      <div className="carte-editoriale mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <div className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        </div>
      </div>

      {/* Liste récente : header + lignes skeleton */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="divide-y divide-gray-200">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <Skeleton className="h-4 w-1/3 max-w-xs" />
                  <div className="mt-2">
                    <Skeleton className="h-3 w-full max-w-lg" />
                  </div>
                  <div className="flex items-center mt-3 space-x-4">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                </div>
                <Skeleton className="h-5 w-5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
