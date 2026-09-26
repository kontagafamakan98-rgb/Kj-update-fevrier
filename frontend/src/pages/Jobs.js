import { lazy, Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import JobCreateModal from '../components/JobCreateModal';
import { ListSkeleton } from '../components/SkeletonLoader';
import { jobsAPI } from '../services/apiEndpoints';
import { getLocaleForLanguage } from '../utils/pack2PageI18n/core';
import { makeScopedTranslator } from '../utils/pack2PageI18n/jobs';
import { PAGE_SECTIONS } from '../config/page-sections';
import { getJobUiLabel } from '../utils/jobUiLocale';
import { safeLog } from '../utils/env';
import { DemoJobsEmptyState, JobCard } from '../components/JobsResults';
import { normalizeJobList } from '../utils/jobDisplayBridge';
import CountrySelector from '../components/CountrySelector';
import { haversineKm, getJobCoordinates } from '../utils/workerTrustLevel';
import { usePageMeta } from '../utils/seo';
import { makePublicJobsPrefetch } from '../utils/publicJobsPrefetch';

// Onglets de la liste des emplois :
// - « Découvrir » (travailleurs) : offres ouvertes du pays, paginées serveur.
// - « Mes candidatures » (travailleurs) : jobs auxquels j'ai postulé.
// - « Mes missions » (travailleurs) : missions attribuées ; (clients) : mes
//   annonces publiées.
import {
  useJobsData,
  JOB_TAB_DISCOVER,
  JOB_TAB_APPLICATIONS,
  JOB_TAB_MISSIONS,
  JOBS_PAGE_SIZE,
} from '../hooks/useJobsData';

// ── La carte (Leaflet) n'est téléchargée QUE si on l'ouvre ─────────────────
// `leaflet` ne publie qu'un bundle UMD ES5 (`dist/leaflet-src.js` : ni champ
// `module`, ni `exports`), donc Rollup ne peut rien élaguer et la
// bibliothèque entière part dans son chunk — 155,7 Ko brut / 48,6 Ko gzip, le
// plus gros chunk du build. `JobsMap` était pourtant importé STATIQUEMENT ici :
// le chunk partait à chaque chargement de /jobs, dont la vue par défaut est la
// LISTE. Mesure Lighthouse sur le build de production : 38 des 48 Ko gzip
// étaient téléchargés sans être exécutés (`unused-javascript` 0,5 — la seule
// page du site dans ce cas). `React.lazy` fait passer l'import en `import()` :
// le JS et le CSS de Leaflet ne partent plus qu'au premier clic sur « Carte ».
// Vérifié par le garde scripts/check-bundle-size.js (chunks à la demande).
const JobsMap = lazy(() => import('../components/JobsMap'));

// Placeholder de la carte, à la hauteur exacte de son conteneur (60vh) : le
// swap placeholder → carte ne décale rien (même principe que le skeleton de
// liste ci-dessous, calibré sur JOBS_PAGE_SIZE cartes). Il sert AUSSI de
// repli au suspens de la carte lazy : le chunk arrive derrière une boîte
// déjà à la bonne taille, donc le budget CLS de /jobs (0,01) tient.
const CarteEnChargement = () => (
  <div className="h-full w-full animate-pulse bg-gray-200" aria-hidden="true" />
);

// ── Préchargement PARALLÈLE de la liste publique (decouverte) ───────────────
// Sans lui, la liste n'était demandée qu'APRÈS que le chunk lazy soit chargé,
// que React monte le composant ET que son useEffect s'exécute — une cascade
// réseau (chunk → boot React → fetch → rendu liste) qui retardait l'affichage
// des jobs. On démarre la requête publique par défaut (découverte : status
// open, 1re page) dès l'ÉVALUATION du module du chunk, donc EN PARALLÈLE du
// boot React et du montage. Le composant réutilise le résultat au lieu d'en
// refaire une (cf. consumePublicJobsPrefetch, et `snapshot` pour la lecture
// pendant le rendu).
//
// Volontairement limité à la vue « Découvrir » publique, déterministe et sans
// état utilisateur : les onglets « Mes candidatures » / « Mes missions » et
// les filtres dépendent de l'utilisateur/URL, connus seulement au montage —
// ils chargent comme avant. Un échec du préchargement est bénin : le cache
// reste null et le composant recharge normalement.
// L'implémentation vit dans utils/publicJobsPrefetch.js (fabrique testable,
// voir utils/__tests__/publicJobsPrefetch.test.js) : ici on l'instancie avec
// les dépendances réelles de la page.
const publicJobsPrefetch = makePublicJobsPrefetch({
  jobsAPI,
  normalizeJobList,
  safeLog,
  pageSize: JOBS_PAGE_SIZE,
});
const { kick: kickPublicJobsPrefetch } = publicJobsPrefetch;

// Déclencher À L'ÉTAPE MODULE : dès que le chunk lazy Jobs est évalué, la
// requête part EN PARALLÈLE du boot React et du montage (avant tout useEffect).
// Bénin si ce n'est pas l'onglet par défaut : le cache est consommé uniquement
// par la vue découverte et réinitialisé après usage (une seule requête max).
kickPublicJobsPrefetch();

export default function Jobs() {
  const pagePlan = PAGE_SECTIONS['/jobs'];
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    category: searchParams.get('category') || '',
    status: '',
    search: '',
  }));
  const [radiusKm, setRadiusKm] = useState('');
  const [userCoords, setUserCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [tab, setTab] = useState(null);

  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const toast = useToast();
  const pageT = makeScopedTranslator(currentLanguage, t);
  const jobUi = getJobUiLabel(currentLanguage);
  const locale = getLocaleForLanguage(currentLanguage);
  usePageMeta();

  // Onglet par défaut selon le type d'utilisateur : client connecté → « Mes
  // missions » (ses annonces), sinon découverte publique.
  const effectiveTab = tab || (user?.user_type === 'client' ? JOB_TAB_MISSIONS : JOB_TAB_DISCOVER);

  const { jobs, loading, loadingMore, hasMore, loadError, appliedJobIds, loadJobs, retry } = useJobsData({
    effectiveTab,
    filters,
    setFilters,
    searchParams,
    user,
    errorMessages: {
      network: pageT('loadErrorNetwork'),
      server: pageT('loadErrorServer'),
    },
    // L'objet entier (et non seulement `consume`) : le hook lit `snapshot`
    // pendant le rendu, quand la requête est DÉJÀ arrivée, pour démarrer la page
    // seedée (liste réelle au premier rendu). Il ne suspend plus : mesuré, le
    // fallback Suspense gardait la page sans son plus grand texte (l'intro, qui
    // est l'élément LCP) pendant toute la réponse de l'API (cf. useJobsData.js).
    prefetch: publicJobsPrefetch,
  });

  const reessayer = retry;

  // Filtres qui expliquent une liste vide (et que l'utilisateur peut lever) :
  // sans eux, « rien à afficher » n'a pas la même prochaine étape.
  const filtresActifs = Boolean(filters.search.trim() || filters.category || filters.status || radiusKm);
  const effacerLesFiltres = () => {
    setFilters({ category: '', status: '', search: '' });
    setRadiusKm('');
    setUserCoords(null);
  };

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
    <div className={pagePlan.frameClass}>
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className={pagePlan.titleClass}>
            {effectiveTab === JOB_TAB_MISSIONS ? (pageT('myMissions') || 'Mes missions') : (pageT(pagePlan.titleKey) || 'Emplois disponibles')}
          </h1>
          <p className="mt-2 text-gray-600">{new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Sélecteur de pays — visible uniquement sur cette page, pour
              les utilisateurs connectés (le changement de pays exige une
              session) */}
          {user && <CountrySelector />}
          {/* Bascule liste / carte. Les deux vues sont des boutons d'un même
              groupe : `aria-pressed` dit laquelle est active (les emoji ☰/🗺️
              ne le disaient qu'à l'œil, et différemment selon la plateforme). */}
          <div className="flex rounded-xl border border-gray-200 bg-white p-1" role="group" aria-label={`${t('listView')} / ${t('mapView')}`}>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${viewMode === 'list' ? 'bg-orange-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              {t('listView')}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('map')}
              aria-pressed={viewMode === 'map'}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${viewMode === 'map' ? 'bg-orange-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 4 3.5 6.5v13L9 17l6 2.5 5.5-2.5v-13L15 6.5 9 4z" />
                <path strokeLinecap="round" d="M9 4v13M15 6.5v13" />
              </svg>
              {t('mapView')}
            </button>
          </div>
          {user?.user_type === 'client' && (
            <button onClick={() => setShowCreateModal(true)} className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2">
              {jobUi.createJob}
            </button>
          )}
        </div>
      </div>

      {/* ── Le paragraphe d'intro : le premier paint ne dépend plus de l'API ──
          C'est le plus grand bloc de texte de la page, donc son élément LCP.
          Il est peint par la COQUILLE pré-rendue (avant tout JavaScript) et
          repris ici, à l'identique — même clé du plan, et la GÉOMÉTRIE lue
          dans ce plan (`introClass`, `frameClass`) : ces chaînes n'ont qu'un
          propriétaire, car une divergence d'un seul côté ré-élit un élément
          LCP et fait entrer le JavaScript dans le LCP facturé — pour que la
          bascule coquille → React soit invisible.

          Sans lui, le plus grand texte peint était celui de l'état vide, qui
          n'existe qu'APRÈS la réponse de /api/jobs : mesuré (Lighthouse
          mobile, pile de la CI, 3 runs) LCP 3111 / 3071 / 3106 ms dont
          2657 / 2617 / 2656 ms de `Render Delay`, c'est-à-dire le temps de
          réponse du backend recopié dans le LCP. Le premier paint était déjà
          à ~1,46 s : la marge existait, aucun bloc assez grand ne l'occupait.

          Il est rendu sur TOUS les onglets, comme la coquille (qui ne connaît
          pas l'onglet) : changer d'onglet ne retire donc pas de hauteur, et la
          coquille reste la réplique exacte de ce que la page affiche. */}
      <p className={pagePlan.introClass}>
        {pageT(pagePlan.introKey)}
      </p>

      {/* Onglets : découverte / candidatures / missions. Présentés comme un
          sélecteur unique quand il y en a plusieurs : c'est le même contrôle
          (un jeu d'options dont une seule est active), pas trois boutons
          indépendants. Le visiteur anonyme n'a qu'une vue → une étiquette
          inerte, qui décrit l'onglet courant sans promettre un clic. */}
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

      {/* ── Recherche et filtres : UNE carte, lisible d'un coup d'œil ───────
          Trois contrôles empilés dans la page (champ, catégorie, rayon) se
          lisaient comme trois blocs sans lien. Ils sont ici dans un seul
          panneau, dans l'ordre où on s'en sert : on écrit une recherche, on
          choisit une catégorie, puis on resserre autour de soi. */}
      <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <label htmlFor="jobs-recherche" className="sr-only">{t('search')}</label>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="6.5" />
                <path strokeLinecap="round" d="m16 16 4.5 4.5" />
              </svg>
            </span>
            <input
              id="jobs-recherche"
              type="search"
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              placeholder={pageT('searchPlaceholder') || 'Rechercher un job'}
              // `type="search"` allume le clavier de recherche sur mobile ;
              // WebKit y ajoute AUSSI sa propre croix d'effacement, qui ferait
              // doublon avec celle ci-dessus — elle est donc masquée.
              className="w-full rounded-xl border border-gray-200 py-3 pl-11 pr-11 outline-none transition-colors focus:border-orange-500 focus:ring-2 focus:ring-orange-100 [&::-webkit-search-cancel-button]:hidden"
            />
            {Boolean(filters.search) && (
              <button
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, search: '' }))}
                aria-label={t('clear')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
          {effectiveTab !== JOB_TAB_DISCOVER && (
            <select
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              className="rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 sm:w-56"
            >
              {statuses.map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
          )}
          {filtresActifs && (
            <button
              type="button"
              onClick={effacerLesFiltres}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
              {pageT('clearFilters')}
            </button>
          )}
        </div>

        {/* Catégories en puces : la catégorie active reste VISIBLE sans
            déplier un menu natif, et sur mobile un appui suffit. Le menu
            déroulant précédent demandait d'ouvrir, parcourir puis valider. */}
        <div className="mt-3 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label={pageT('allCategories') || t('allCategories')}>
          {categories.map((category) => {
            const actif = filters.category === category.value;
            return (
              <button
                key={category.value || 'toutes'}
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, category: category.value }))}
                aria-pressed={actif}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${actif ? 'border-orange-600 bg-orange-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700'}`}
              >
                {category.label}
              </button>
            );
          })}
        </div>

        {/* Recherche par rayon : trouve les jobs proches de toi (uniquement
            les jobs portant des coordonnées GPS — les autres sont exclus quand
            le filtre est actif). */}
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21z" />
              <circle cx="12" cy="10.5" r="2.2" />
            </svg>
            {t('nearMe')}
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={radiusKm}
              onChange={(e) => setRadiusKm(e.target.value)}
              aria-label={t('nearMe')}
              placeholder={t('radiusKmPlaceholder')}
              className="w-32 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            />
            <button
              onClick={locateMe}
              disabled={locating}
              className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60"
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
      </div>

      {loadError && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">{loadError.message}</p>
          <button
            onClick={reessayer}
            // Un double clic pendant le rejeu d'une page suivante empilerait
            // deux fois la même page dans la liste.
            disabled={loading || loadingMore}
            className="mt-3 inline-flex items-center rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {loading ? t('loading') : pageT('retry')}
          </button>
        </div>
      )}

      {loading ? (
        viewMode === 'map' ? (
          // Placeholder à la hauteur exacte de la carte (60vh) : le swap
          // skeleton → carte ne décale rien (anti-CLS, même principe que
          // le skeleton de liste ci-dessous).
          <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm" style={{ height: '60vh' }}>
            <CarteEnChargement />
          </div>
        ) : (
          // Skeleton à la hauteur de la liste RÉELLE (JOBS_PAGE_SIZE cartes) :
          // le défaut (3 cartes) laissait le footer ancré (flex-1) remonter de
          // ~9 cartes au swap données chargées → CLS résiduel ~0.034.
          <ListSkeleton count={JOBS_PAGE_SIZE} />
        )
      ) : viewMode === 'map' ? (
        <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm" style={{ height: '60vh' }}>
          <Suspense fallback={<CarteEnChargement />}>
            <JobsMap jobs={filteredJobs} />
          </Suspense>
        </div>
      ) : loadError && filteredJobs.length === 0 ? (
        // L'échec est déjà expliqué par le bandeau ci-dessus, avec son action :
        // afficher ici un état vide ferait passer une panne pour une liste vide.
        // (Une panne qui laisse des missions déjà chargées — page suivante
        // injoignable — ne les efface pas : le bandeau explique, la liste reste.)
        null
      ) : filteredJobs.length === 0 ? (
        !user && effectiveTab === JOB_TAB_DISCOVER && !filtresActifs ? (
          <DemoJobsEmptyState t={t} />
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            {/* Un état vide a besoin d'un VISAGE avant d'avoir une phrase :
                le pictogramme dit en une seconde qu'il n'y a rien à lire, et
                l'action est juste en dessous. */}
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400" aria-hidden="true">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="11" cy="11" r="6.5" />
                <path strokeLinecap="round" d="m16 16 4.5 4.5" />
              </svg>
            </span>
            <p className="font-medium text-gray-600">
              {filtresActifs
                ? pageT('emptyFiltered')
                : (effectiveTab === JOB_TAB_APPLICATIONS
                  ? (pageT('noApplicationsYet') || 'Vous n’avez pas encore postulé à une mission.')
                  : (user?.user_type === 'client' ? t('noJobsForAccount') : t('noJobsAvailableNow')))}
            </p>
            {filtresActifs ? (
              <button
                onClick={effacerLesFiltres}
                className="mt-4 inline-flex items-center rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
              >
                {pageT('clearFilters')}
              </button>
            ) : (
              <p className="mt-2 text-sm text-gray-400">{pageT('emptyHint')}</p>
            )}
          </div>
        )
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
