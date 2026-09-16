import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import JobCreateModal from '../components/JobCreateModal';
import { ListSkeleton } from '../components/SkeletonLoader';
import { jobsAPI } from '../services/apiEndpoints';
import { getLocaleForLanguage } from '../utils/pack2PageI18n/core';
import { makeScopedTranslator } from '../utils/pack2PageI18n/jobs';
import { getJobUiLabel } from '../utils/jobUiLocale';
import { safeLog } from '../utils/env';
import { formatBudgetRange, formatJobDate, formatJobStatus } from '../utils/jobPageSafeHelpers';
import { normalizeJobList } from '../utils/jobDisplayBridge';
import { getRememberedApplication } from '../utils/jobProposalWorkflow';
import CountrySelector from '../components/CountrySelector';
import JobsMap from '../components/JobsMap';
import { haversineKm, getJobCoordinates } from '../utils/workerTrustLevel';
import { usePageTitle, usePageOpenGraph, ogImageUrl } from '../utils/seo';

function JobCard({ job, user, userType, appliedJobIds, t }) {
  const locationText = job.location_text || t('locationNotSpecified');
  const jobId = job.id || job._id || job.job_id || job.jobId;
  // Source de vérité serveur (appliedJobIds) quand disponible ; retombe sur
  // le marqueur localStorage seulement si le chargement serveur a échoué,
  // pour ne pas régresser en cas de souci réseau ponctuel.
  const hasApplied = userType === 'worker' && (
    appliedJobIds ? appliedJobIds.has(String(jobId)) : Boolean(getRememberedApplication(jobId, user))
  );

  return (
    <Link to={`/jobs/${job.id}`} className="block bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow p-6 border border-gray-100">
      <div className="flex justify-between items-start gap-6 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h3 className="text-lg font-semibold text-gray-900">{job.title}</h3>
            <span className="px-2 py-1 text-xs rounded-full bg-orange-50 text-orange-700 border border-orange-200">
              {formatJobStatus(job.status, t)}
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
          {userType === 'worker' && job.status === 'open' && !hasApplied && (
            <div className="mt-2 inline-flex rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 border border-green-200">
              {t('applyAvailable')}
            </div>
          )}
          {hasApplied && (
            <div className="mt-2 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
              {t('proposalSent')}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

// Onglets de la liste des emplois :
// - « Découvrir » (travailleurs) : offres ouvertes du pays, paginées serveur.
// - « Mes candidatures » (travailleurs) : jobs auxquels j'ai postulé.
// - « Mes missions » (travailleurs) : missions attribuées ; (clients) : mes
//   annonces publiées.
const JOB_TAB_DISCOVER = 'discover';
const JOB_TAB_APPLICATIONS = 'applications';
const JOB_TAB_MISSIONS = 'missions';
const JOBS_PAGE_SIZE = 12;

// ── Préchargement PARALLÈLE de la liste publique (decouverte) ───────────────
// Sans lui, la liste n'était demandée qu'APRÈS que le chunk lazy soit chargé,
// que React monte le composant ET que son useEffect s'exécute — une cascade
// réseau (chunk → boot React → fetch → rendu liste) qui retardait l'affichage
// des jobs. On démarre la requête publique par défaut (découverte : status
// open, 1re page) dès l'ÉVALUATION du module du chunk, donc EN PARALLÈLE du
// boot React et du montage. Le composant réutilise le résultat au lieu d'en
// refaire une (cf. consumePublicJobsPrefetch).
//
// Volontairement limité à la vue « Découvrir » publique, déterministe et sans
// état utilisateur : les onglets « Mes candidatures » / « Mes missions » et
// les filtres dépendent de l'utilisateur/URL, connus seulement au montage —
// ils chargent comme avant. Un échec du préchargement est bénin : le cache
// reste null et le composant recharge normalement.
const PUBLIC_PREFETCH_PARAMS = { limit: JOBS_PAGE_SIZE, page: 1, status: 'open' };
let publicJobsPrefetch = null; // { requestParams, promise } | null
// null pendant le préchargement (en cours), un booléen ensuite. Évitée sous
// jsdom/tests en vérifiant que l'environnement est un vrai navigateur.
const canUseNetworkPrefetch =
  typeof window !== 'undefined' &&
  typeof window.localStorage !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !/jsdom/.test(String(navigator && navigator.userAgent));

// Compare les params réels du composant à ceux du préchargement : on ne
// réutilise le cache que pour la MÊME requête (decouverte, 1re page, open,
// sans filtre/mine/ids). Tout écart → on recharge normalement.
const matchesPublicPrefetch = (params) =>
  params.limit === JOBS_PAGE_SIZE &&
  params.page === 1 &&
  params.status === 'open' &&
  !params.q &&
  !params.category &&
  !params.mine &&
  !params.ids;

const kickPublicJobsPrefetch = () => {
  if (!canUseNetworkPrefetch) return null;
  if (publicJobsPrefetch && publicJobsPrefetch.promise) return publicJobsPrefetch;
  const promise = jobsAPI
    .getAll(PUBLIC_PREFETCH_PARAMS)
    .then((response) => normalizeJobList(Array.isArray(response) ? response : response?.data || []))
    .catch((error) => {
      // Bénin : laisse le cache null pour que le composant recharge seul.
      safeLog.warn('Public jobs prefetch failed (component will reload)', error);
      return null;
    });
  publicJobsPrefetch = { requestParams: PUBLIC_PREFETCH_PARAMS, promise };
  return publicJobsPrefetch;
};

// Consomme le préchargement depuis loadJobs : si la requête demandée
// correspond à celle déjà lancée en parallèle ET que l'onglet réel est la
// découverte, on l'attend au lieu d'en refaire une. Renvoie true si
// consommé (aucun fetch nécessaire). Stores the normalized jobs + hasMore.
const consumePublicJobsPrefetch = async (params) => {
  if (!matchesPublicPrefetch(params)) return null;
  if (!publicJobsPrefetch || !publicJobsPrefetch.promise) return null;
  const jobs = await publicJobsPrefetch.promise;
  // Réinitialise pour ne pas réutiliser ce cache sur une NAVIGATION ulterieure.
  publicJobsPrefetch = null;
  if (!jobs) return null; // échec → laisser loadJobs refaire sa propre requête
  return { jobs, hasMore: jobs.length === JOBS_PAGE_SIZE };
};

// Déclencher À L'ÉTAPE MODULE : dès que le chunk lazy Jobs est évalué, la
// requête part EN PARALLÈLE du boot React et du montage (avant tout useEffect).
// Bénin si ce n'est pas l'onglet par défaut : le cache est consommé uniquement
// par la vue découverte et réinitialisé après usage (une seule requête max).
kickPublicJobsPrefetch();

export default function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filters, setFilters] = useState({ category: '', status: '', search: '' });
  const [radiusKm, setRadiusKm] = useState('');
  const [userCoords, setUserCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [tab, setTab] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  // null = pas encore chargé (JobCard retombe alors sur localStorage) ;
  // Set (même vide) = donnée serveur fiable disponible.
  const [appliedJobIds, setAppliedJobIds] = useState(null);
  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const toast = useToast();
  const pageT = makeScopedTranslator(currentLanguage, t);
  const jobUi = getJobUiLabel(currentLanguage);
  const [searchParams] = useSearchParams();
  const locale = getLocaleForLanguage(currentLanguage);
  usePageTitle(t('jobsMetaTitle'));
  // OG dynamique par route : le partage d'un lien /jobs affiche une carte
  // dédiée (og-jobs.png) avec le titre/description de la page emplois, au
  // lieu de l'image générique de l'accueil.
  usePageOpenGraph({
    title: t('jobsMetaTitle'),
    description:
      t('jobsMetaDescription') ||
      'Trouvez un travailleur qualifié près de chez vous : emplois, missions et talents disponibles dans toute l’Afrique de l’Ouest.',
    image: ogImageUrl('/og-jobs.png'),
  });

  // Onglet par défaut selon le type d'utilisateur : client connecté → « Mes
  // missions » (ses annonces), sinon découverte publique.
  const effectiveTab = tab || (user?.user_type === 'client' ? JOB_TAB_MISSIONS : JOB_TAB_DISCOVER);

  const loadAppliedJobIds = async () => {
    try {
      const response = await jobsAPI.getMyProposals();
      const proposals = Array.isArray(response) ? response : response?.data || [];
      setAppliedJobIds(new Set(proposals.map((p) => String(p.job_id)).filter(Boolean)));
    } catch (error) {
      safeLog.error('Failed to load my proposals', error);
      // On laisse appliedJobIds a null : JobCard retombe alors sur le
      // marqueur localStorage plutot que d'afficher "Postuler disponible"
      // partout par erreur.
    }
  };

  // Tous les filtres (recherche, catégorie, statut) sont appliqués CÔTÉ
  // SERVEUR (pagination + requête MongoDB) : un résultat n'est plus tronqué
  // à 50 jobs puis filtré localement — le 51e job d'une catégorie apparaît
  // enfin.
  const loadJobs = async ({ append = false } = {}) => {
    const targetPage = append ? page + 1 : 1;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setLoadError('');
    try {
      const params = { limit: JOBS_PAGE_SIZE, page: targetPage };
      if (filters.search.trim()) params.q = filters.search.trim();
      if (filters.category) params.category = filters.category;

      if (effectiveTab === JOB_TAB_MISSIONS) {
        // Missions attribuées (travailleur) / annonces publiées (client).
        params.mine = user?.user_type === 'client' ? 'posted' : 'assigned';
      } else if (effectiveTab === JOB_TAB_APPLICATIONS) {
        // Mes candidatures : on interroge le serveur avec la liste de mes
        // job_id postulés (l'ordre et le statut restent filtrés serveur).
        const response = await jobsAPI.getMyProposals();
        const proposals = Array.isArray(response) ? response : response?.data || [];
        const ids = proposals.map((p) => p.job_id).filter(Boolean);
        if (ids.length === 0) {
          setJobs([]);
          setHasMore(false);
          return;
        }
        params.ids = ids.join(',');
      } else {
        // Découverte : uniquement les offres ouvertes (les autres statuts
        // n'ont rien à faire dans la vitrine publique).
        params.status = 'open';
      }
      // Filtre de statut explicite (onglets « Mes candidatures » / « Mes
      // missions ») : appliqué en complément de mine= / ids=.
      if (effectiveTab !== JOB_TAB_DISCOVER && filters.status) {
        params.status = filters.status;
      }

      // Vue découverte : réutilise le préchargement parraillèle si la requête
      // demandée est identique, sinon (premier montage où le préchargement n'a
      // pas encore servi) lance le fetch normal. L'attente du préchargement
      // ne marque pas loading=false plus lentement : la promise est déjà en
      // vol, elle résout dès la réponse réseau.
      if (!append && effectiveTab === JOB_TAB_DISCOVER) {
        const prefetched = await consumePublicJobsPrefetch(params);
        if (prefetched) {
          setJobs(prefetched.jobs);
          setPage(1);
          setHasMore(prefetched.hasMore);
          return;
        }
      }

      const response = await jobsAPI.getAll(params);
      const jobsData = normalizeJobList(Array.isArray(response) ? response : response?.data || []);
      setJobs((prev) => (append ? [...prev, ...jobsData] : jobsData));
      setPage(targetPage);
      setHasMore(jobsData.length === JOBS_PAGE_SIZE);
    } catch (error) {
      safeLog.error('Jobs load error', error);
      setLoadError(error?.response?.data?.detail || error.message || 'Erreur');
      if (!append) setJobs([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const categoryParam = searchParams.get('category');
    if (categoryParam) {
      setFilters((prev) => ({ ...prev, category: categoryParam }));
    }
    if (user?.user_type === 'worker') {
      loadAppliedJobIds();
    } else {
      setAppliedJobIds(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user?.id, user?.user_type]);

  // Recharger quand l'onglet ou un filtre change (page repart de 1).
  // filters.status est inclus : sans lui, changer le statut dans les onglets
  // « Mes candidatures » / « Mes missions » ne redéclenchait jamais loadJobs.
  useEffect(() => {
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTab, filters.search, filters.category, filters.status, user?.id, user?.user_type]);

  const filteredJobs = useMemo(() => {
    // Seul le filtre RAYON reste côté client (distance par rapport à la
    // position de l'utilisateur) : il s'applique aux jobs de la page courante.
    const radius = Number(radiusKm);
    const radiusActive = Number.isFinite(radius) && radius > 0 && Boolean(userCoords);
    if (!radiusActive) return jobs;

    return jobs.filter((job) => {
      const coords = getJobCoordinates(job);
      if (!coords) return false;
      const distance = haversineKm(userCoords.latitude, userCoords.longitude, coords.latitude, coords.longitude);
      return distance <= radius;
    });
  }, [jobs, radiusKm, userCoords]);

  const locateMe = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error(t('geoUnavailable'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error(t('geoPermissionDenied'));
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 }
    );
  };

  const categories = [
    { value: '', label: pageT('allCategories') || t('allCategories') || 'Toutes les catégories' },
    { value: 'plumbing', label: t('plumbing') },
    { value: 'electrical', label: t('electrical') },
    { value: 'construction', label: t('construction') },
    { value: 'cleaning', label: t('cleaning') },
    { value: 'gardening', label: t('gardening') },
    { value: 'tutoring', label: t('tutoring') },
    { value: 'mechanics', label: t('mechanics') },
    { value: 'carpentry', label: t('carpentry') },
    { value: 'computing', label: t('computing') },
    { value: 'general', label: t('general') },
  ];

  const statuses = [
    { value: '', label: pageT('allStatuses') || 'Tous les statuts' },
    { value: 'open', label: t('open') },
    { value: 'in_progress', label: t('inProgress') },
    { value: 'completed', label: t('completed') },
    { value: 'cancelled', label: t('cancelled') },
    { value: 'pending', label: t('pending') },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {effectiveTab === JOB_TAB_MISSIONS ? (pageT('myMissions') || 'Mes missions') : (pageT('availableJobs') || 'Emplois disponibles')}
          </h1>
          <p className="mt-2 text-gray-600">{new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Sélecteur de pays — visible uniquement sur cette page, pour
              les utilisateurs connectés (le changement de pays exige une
              session) */}
          {user && <CountrySelector />}
          {/* Bascule liste / carte */}
          <div className="flex rounded-xl border border-gray-200 bg-white p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${viewMode === 'list' ? 'bg-orange-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              ☰ {t('listView')}
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${viewMode === 'map' ? 'bg-orange-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              🗺️ {t('mapView')}
            </button>
          </div>
          {user?.user_type === 'client' && (
            <button onClick={() => setShowCreateModal(true)} className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700">
              {jobUi.createJob}
            </button>
          )}
        </div>
      </div>

      {/* Onglets : découverte / candidatures / missions */}
      <div className="mb-6 flex flex-wrap gap-2">
        {user?.user_type === 'worker' && (
          <>
            <button
              onClick={() => setTab(JOB_TAB_DISCOVER)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${effectiveTab === JOB_TAB_DISCOVER ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
            >
              {pageT('tabDiscover') || 'Découvrir'}
            </button>
            <button
              onClick={() => setTab(JOB_TAB_APPLICATIONS)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${effectiveTab === JOB_TAB_APPLICATIONS ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
            >
              {pageT('tabApplications') || 'Mes candidatures'}
            </button>
            <button
              onClick={() => setTab(JOB_TAB_MISSIONS)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${effectiveTab === JOB_TAB_MISSIONS ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
            >
              {pageT('tabMissions') || 'Mes missions'}
            </button>
          </>
        )}
        {user?.user_type === 'client' && (
          <button
            onClick={() => setTab(JOB_TAB_MISSIONS)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${effectiveTab === JOB_TAB_MISSIONS ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
          >
            {pageT('myMissions') || 'Mes missions'}
          </button>
        )}
        {!user && (
          <span className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-600 border border-gray-200">
            {pageT('tabDiscover') || 'Découvrir'}
          </span>
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
        {effectiveTab !== JOB_TAB_DISCOVER && (
          <select
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            className="rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
          >
            {statuses.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* Recherche par rayon : trouve les jobs proches de toi (uniquement
          les jobs portant des coordonnées GPS — les autres sont exclus quand
          le filtre est actif). */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4">
        <span className="text-sm font-semibold text-gray-700">{t('nearMe')}</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            value={radiusKm}
            onChange={(e) => setRadiusKm(e.target.value)}
            placeholder={t('radiusKmPlaceholder')}
            className="w-32 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
          />
          <button
            onClick={locateMe}
            disabled={locating}
            className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
          >
            {locating ? t('locating') : (userCoords ? t('myPosition') : t('useMyPosition'))}
          </button>
          {radiusKm && (
            <button
              onClick={() => { setRadiusKm(''); setUserCoords(null); }}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              {t('clear')}
            </button>
          )}
        </div>
        {radiusKm && !userCoords && (
          <span className="text-xs text-gray-500">{t('radiusActivateHint')}</span>
        )}
      </div>

      {loadError && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {loading ? (
        viewMode === 'map' ? (
          // Placeholder à la hauteur exacte de la carte (60vh) : le swap
          // skeleton → carte ne décale rien (anti-CLS, même principe que
          // le skeleton de liste ci-dessous).
          <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm animate-pulse bg-gray-200" style={{ height: '60vh' }} />
        ) : (
          // Skeleton à la hauteur de la liste RÉELLE (JOBS_PAGE_SIZE cartes) :
          // le défaut (3 cartes) laissait le footer ancré (flex-1) remonter de
          // ~9 cartes au swap données chargées → CLS résiduel ~0.034.
          <ListSkeleton count={JOBS_PAGE_SIZE} />
        )
      ) : viewMode === 'map' ? (
        <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm" style={{ height: '60vh' }}>
          <JobsMap jobs={filteredJobs} />
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
          {effectiveTab === JOB_TAB_APPLICATIONS
            ? (pageT('noApplicationsYet') || 'Vous n\'avez pas encore postulé à une mission.')
            : (user?.user_type === 'client' ? t('noJobsForAccount') : t('noJobsAvailableNow'))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4">
            {filteredJobs.map((job) => (
              <JobCard key={job.id} job={job} user={user} userType={user?.user_type} appliedJobIds={appliedJobIds} t={t} />
            ))}
          </div>
          {hasMore && !radiusKm && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => loadJobs({ append: true })}
                disabled={loadingMore}
                className="rounded-xl border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {loadingMore ? (pageT('loadingMore') || 'Chargement…') : (pageT('loadMore') || 'Afficher plus de missions')}
              </button>
            </div>
          )}
        </>
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
