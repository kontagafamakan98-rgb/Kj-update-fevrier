import { useEffect, useState, lazy, Suspense } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";

import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LanguageProvider, useLanguage } from "./contexts/LanguageContext";
import { ToastProvider } from './contexts/ToastContext';
import { CountryProvider } from "./contexts/CountryContext";
import { NotificationProvider } from './contexts/NotificationContext';
import Navbar from "./components/Navbar";
import CountryChangePopup from "./components/CountryChangePopup";
import OfflineIndicator from "./components/OfflineIndicator";
import MobileBottomNav from "./components/MobileBottomNav";
import ErrorBoundary from "./components/ErrorBoundary";
import NetworkStatus from "./components/NetworkStatus";
import { PageSkeleton, JobsSkeleton, JobDetailsSkeleton, LoginSkeleton, ForgotPasswordSkeleton, DashboardSkeleton, ProfileSkeleton, MessagesSkeleton, PaymentSkeleton } from "./components/SkeletonLoader";
import OwnerService from './services/ownerService';
import { CONTACT, SOCIAL_LINKS, mailtoHref, telHref } from './config/contact';
import { isPWASupported, requestNotificationPermission } from "./utils/pwa";
import { useNotifications } from './contexts/NotificationContext';


// Toutes les pages sont lazy-loadées (bundle initial minimal) : seul le
// shell (nav + contexte auth) est dans le chunk principal. Home et Login
// utilisent un skeleton comme fallback pour un premier affichage rapide.
const Home = lazy(() => import("./pages/Home"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const HowItWorks = lazy(() => import("./pages/HowItWorks"));
// Les trois pages de CONFIANCE (qui édite le site, comment le joindre, ce qu'il
// fait des données) : pré-rendues comme les autres pages publiques, donc leur
// liste vit dans src/config/page-meta.js et leur coquille dans vite.config.js.
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const Privacy = lazy(() => import("./pages/Privacy"));

// Lazy load protected pages (loaded only when needed after authentication)
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Jobs = lazy(() => import("./pages/Jobs"));
const JobDetails = lazy(() => import("./pages/JobDetails"));
const Messages = lazy(() => import("./pages/Messages"));
const Profile = lazy(() => import("./pages/Profile"));
const CreateJob = lazy(() => import('./pages/CreateJob'));

// Lazy load test and demo pages (rarely used)
const MobileTest = lazy(() => import('./pages/MobileTest'));
const PhotoTest = lazy(() => import('./pages/PhotoTest'));
const Payment = lazy(() => import('./pages/Payment'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const EmailVerificationPage = lazy(() => import('./pages/EmailVerificationPage'));
const PaymentVerificationPage = lazy(() => import('./pages/PaymentVerificationPage'));
const CommissionDashboard = lazy(() => import('./pages/CommissionDashboard'));
// ToastContainer (rendu + icônes + i18n toast) est lazy : l'état vit dans
// ToastProvider (eager, léger) ; le RENDU n'est nécessaire qu'à l'apparition
// du premier toast (après interaction utilisateur). Le chunk toast (renderer
// + toastScopedI18n) sort ainsi du chunk d'entrée — l'index gzip s'allège.
// fallback={null} : position fixed, rien à peindre avant les toasts.
const ToastContainer = lazy(() => import('./components/ToastContainer'));
const Support = lazy(() => import('./pages/Support'));
const SupportAdmin = lazy(() => import('./pages/SupportAdmin'));

// Note: Axios configuration moved to /services/api.js for centralized management

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  
  if (loading) {
    return (
      // anti-CLS mesuré (probe CDP, viewport 412×823) : ce bloc vit DANS
      // main.flex-1, mais il représente un ÉTAT DE CHARGEMENT, pas une page —
      // il doit donc GARDER LE FOOTER HORS DE L'ÉCRAN, pas le combler.
      // En 100vh (+ pb-24 mobile) main vaut 919 px → footer à 984 px, invisible
      // pendant tout le contrôle d'auth. En min-h-full main tombait à 705 px →
      // footer à 770 px, donc VISIBLE, puis les pages protégées (main mesuré
      // 1401-1946 px sur /dashboard, /profile, /messages) le tiraient 865 à
      // 1180 px plus bas : CLS prédit 0,064 contre 0,0010 mesuré aujourd'hui
      // (modèle validé sur 4 mesures : 0,0012 / 0,0042 / 0,0167 / 0,0000).
      // Les pages, elles, suivent la règle inverse (min-h-full) — cf. le garde
      // antiClsSkeletons : la règle dépend de ce que l'état doit recouvrir.
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500 mx-auto"></div>
          <div className="mt-4 text-orange-600 font-medium">{t('loading')}</div>
        </div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const requiredMinimum = user.user_type === 'worker' ? 2 : 1;
  const paymentAccountsCount = Number(user.payment_accounts_count || 0);
  const requiresRegistrationCompletion = !user.is_verified || paymentAccountsCount < requiredMinimum;

  if (requiresRegistrationCompletion) {
    return <Navigate to="/payment-verification" replace state={{ resumeAfterLogin: true, userData: user }} />;
  }
  
  return children;
}

function OwnerOnlyRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!user || !OwnerService.isOwnerSessionValid(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

// Mobile-optimized loading component
function MobileLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-r from-orange-600 to-orange-700">
      <div className="text-center">
        <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
          <span className="text-3xl font-bold text-orange-600">K</span>
        </div>
        <div className="text-white text-2xl font-bold mb-2">Kojo</div>
        <div className="text-orange-200 text-sm mb-6">Afrique de l'Ouest</div>
        <div className="flex justify-center space-x-2">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
        </div>
      </div>
    </div>
  );
}

function LegalFooter() {
  const { t } = useLanguage();
  const legalDocumentUrl = '/legal/kojo_politique_confidentialite_et_cgu_fusionnees.docx';
  // Les libellés du pied de page sont des CLÉS i18n (src/i18n/*.json), les
  // mêmes que celles que publie la coquille statique de l'accueil : cette
  // carte locale était un troisième domicile pour « Itinéraire », « Conditions
  // d'utilisation » et « Politique de confidentialité », recopiées de leur côté
  // par vite-plugins/prerender-route-meta.js. Les clés `footer*` comblent aussi
  // un trou : `mos` n'avait pas de valeur « itinerary », donc le lien du pied
  // de page y était rendu SANS texte.

  return (
    <footer className="border-t border-orange-100 bg-white/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-3">
        {/* Liens cliquables tel:/mailto: + N.A.P. : ce sont eux qui rendent le
            contact possible en un appui sur mobile (un audit d'accessibilité
            et de référencement local les exige). Adresse, téléphone et e-mail
            viennent de src/config/contact.json — la même source que la page
            Support, le shell statique de l'accueil et le LocalBusiness. */}
        <address className="not-italic flex flex-wrap items-center justify-center md:justify-end gap-x-4 gap-y-2 text-xs text-gray-600">
          <span>{CONTACT.address}</span>
          <a href={telHref} className="hover:text-orange-700 underline underline-offset-2">
            {CONTACT.phoneDisplay}
          </a>
          <a href={mailtoHref} className="hover:text-orange-700 underline underline-offset-2 break-all">
            {CONTACT.email}
          </a>
          <a href={CONTACT.whatsappUrl} target="_blank" rel="noreferrer" className="hover:text-orange-700 underline underline-offset-2">
            {t('contactWhatsapp')}
          </a>
          <a href={CONTACT.mapsUrl} target="_blank" rel="noreferrer" className="hover:text-orange-700 underline underline-offset-2">
            {t('footerItinerary')}
          </a>
        </address>
        <div className="flex flex-wrap items-center justify-center md:justify-end gap-4 text-sm text-orange-700">
          {/* Les trois pages de confiance, en LIEN INTERNE : un crawler sans
              JavaScript ne les trouve que par ici (et par le pied de page de la
              coquille statique, qui porte les mêmes liens). « Contact » menait
              au support — une page de suivi de ticket, pas une page de
              contact — et « Politique de confidentialité » à un .docx dont un
              moteur ne lisait rien. */}
          <Link to="/about" className="hover:text-orange-800 underline underline-offset-2">
            {t('footerAbout')}
          </Link>
          <Link to="/contact" className="hover:text-orange-800 underline underline-offset-2">
            {t('contactTitle')}
          </Link>
          <Link to="/privacy" className="hover:text-orange-800 underline underline-offset-2">
            {t('footerPrivacy')}
          </Link>
          <a href={legalDocumentUrl} target="_blank" rel="noreferrer" className="hover:text-orange-800 underline underline-offset-2">
            {t('footerTerms')}
          </a>
          {SOCIAL_LINKS.map((social) => (
            <a
              key={social.key}
              href={social.url}
              target="_blank"
              rel="me noreferrer"
              className="hover:text-orange-800 underline underline-offset-2"
            >
              {social.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

function AppRoutes() {
  const [pwaReady, setPwaReady] = useState(false);
  const { user } = useAuth();
  const { t } = useLanguage();
  const { addLocalNotification } = useNotifications();

  useEffect(() => {
    setPwaReady(true);

    if (isPWASupported() && user) {
      Promise.resolve(requestNotificationPermission()).catch(() => {});
    }
  }, [user]);

  // Écouter les messages du Service Worker push (notifications foreground)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handler = (event) => {
      if (!event.data) return;
      const { type, payload } = event.data;
      if (type === 'KOJO_PUSH_FOREGROUND' && payload) {
        // Ajouter dans le centre de notifications sans afficher le toast système
        // L'identifiant SERVEUR vient avec le push (kojo_shared.notify_user le
        // joint) : la ligne affichée ici EST celle que le serveur connaît, donc
        // la supprimer ou la marquer lue aboutit. Sans lui (push plus ancien,
        // ou stockage échoué côté serveur), l'entrée est purement locale et le
        // dit : aucune requête ne peut viser un identifiant inventé.
        const serverId = payload.data?.notification_id || null;
        addLocalNotification({
          id: serverId || `local_${Date.now()}`,
          local: !serverId,
          title: payload.title || 'Kojo',
          body: payload.body || '',
          type: payload.data?.type || 'general',
          related_id: payload.data?.job_id || null,
          related_type: payload.data?.job_id ? 'job' : null,
          is_read: false,
          created_at: new Date().toISOString(),
        });
      }
    };

    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [addLocalNotification]);

  if (!pwaReady) {
    return <MobileLoader />;
  }

  return (
    <div className="min-h-screen bg-gray-50 relative flex flex-col">
      {/* Network Status and Offline Indicator */}
      <NetworkStatus />
      <OfflineIndicator />

      {/* Main Navigation */}
      <Navbar />
      
      {/* Toast Notifications — lazy (cf. déclaration plus haut) */}
      <Suspense fallback={null}>
        <ToastContainer />
      </Suspense>
      
      {/* Geolocation Popup */}
      <CountryChangePopup />

      {/* Main Content with Suspense for lazy loaded routes.
          flex-1 : le contenu s'étire pour combler l'espace libre sous la
          navbar. Combiné au flex-col du conteneur, le LegalFooter reste
          ANCRÉ en bas de la viewport tant que le contenu ne dépasse pas —
          quand les données arrivent (skeleton → contenu réel), le footer ne
          bouge plus verticalement → élimine le CLS mesuré (0.129 volet
          Dashboard, 0.112 Profile) causé par le footer qui accompagnait la
          hauteur du contenu en chargement. */}
      <main className="flex-1 pb-24 md:pb-0">
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            {/* Public routes - eagerly loaded */}
            <Route path="/" element={<Home />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/login" element={
              <Suspense fallback={<LoginSkeleton />}>
                <Login />
              </Suspense>
            } />
            <Route path="/forgot-password" element={
              <Suspense fallback={<ForgotPasswordSkeleton />}>
                <ForgotPassword />
              </Suspense>
            } />
            <Route path="/register" element={<Register />} />
            
            {/* Protected routes - lazy loaded */}
            {/* /dashboard et /profile ont aussi leur skeleton Suspense DÉDIÉ :
                leur phase de chargement des données affiche un shell structuré
                (SkeletonDashboardShell / ProfileSkeleton) — le fallback
                générique PageSkeleton (3 blocs courts) faisait sauter le footer
                ancré au remplacement du chunk (CLS 0.149 / 0.112). Le squelette
                dédié réplique ce shell → chaîne chunk→données→page stable. */}
            <Route path="/dashboard" element={
              <Suspense fallback={<DashboardSkeleton />}>
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              </Suspense>
            } />
            {/* Lecture des jobs PUBLIQUE (découverte sans compte) : les
                actions (créer, postuler, accepter, supprimer) restent
                réservées aux utilisateurs connectés — le backend refuse
                toute mutation non authentifiée, et les pages affichent
                une invitation à se connecter pour les actions. */}
            {/* /jobs et /jobs/:id ont des skeletons Suspense DÉDIÉS (grille de
                cartes / détail structuré à hauteur réelle) : le fallback
                générique (PageSkeleton, 3 blocs courts) laissait un saut de
                ~118 px au remplacement du chunk → CLS résiduel sur /jobs. */}
            <Route path="/jobs" element={
              <Suspense fallback={<JobsSkeleton />}>
                <Jobs />
              </Suspense>
            } />
            <Route path="/jobs/:id" element={
              <Suspense fallback={<JobDetailsSkeleton />}>
                <JobDetails />
              </Suspense>
            } />
            {/* /messages et /payment ont aussi un skeleton Suspense DÉDIÉ :
                sans lui, le fallback générique (PageSkeleton) affichait 3
                blocs courts là où ces pages rendent une carte de 75vh / des
                cartes de formulaire, d'où un saut au remplacement du chunk.
                Payment.js et Messages.js partagent ces squelettes avec leur
                propre état de chargement (mêmes hauteurs dans les 2 phases). */}
            <Route path="/messages" element={
              <Suspense fallback={<MessagesSkeleton />}>
                <ProtectedRoute>
                  <Messages />
                </ProtectedRoute>
              </Suspense>
            } />
            <Route path="/profile" element={
              <Suspense fallback={<ProfileSkeleton />}>
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              </Suspense>
            } />
            <Route path="/create-job" element={
              <ProtectedRoute>
                <CreateJob />
              </ProtectedRoute>
            } />
            
            {/* Test and demo routes - lazy loaded.
                Gardées derrière import.meta.env.DEV : ces pages étaient
                accessibles à N'IMPORTE QUEL utilisateur connecté en
                production (juste derrière ProtectedRoute, pas de check
                d'environnement). Elles n'ont d'utilité qu'en développement
                local — en build de prod, ces routes ne sont plus enregistrées. */}
            {import.meta.env.DEV && (
              <>
                <Route path="/mobile-test" element={
                  <ProtectedRoute>
                    <MobileTest />
                  </ProtectedRoute>
                } />
                <Route path="/photo-test" element={
                  <ProtectedRoute>
                    <PhotoTest />
                  </ProtectedRoute>
                } />
              </>
            )}
            {/* /photo-debug reste disponible en prod : déjà protégée par
                OwnerOnlyRoute (accès admin uniquement), utile pour diagnostiquer
                un souci d'upload photo en prod sans devoir redéployer. */}
            <Route path="/photo-debug" element={
              <ProtectedRoute>
                <OwnerOnlyRoute>
                  <PhotoTest />
                </OwnerOnlyRoute>
              </ProtectedRoute>
            } />
            <Route path="/payment" element={
              <Suspense fallback={<PaymentSkeleton />}>
                <ProtectedRoute>
                  <Payment />
                </ProtectedRoute>
              </Suspense>
            } />
            <Route path="/email-verification" element={<EmailVerificationPage />} />
            <Route path="/payment-verification" element={<PaymentVerificationPage />} />
            <Route path="/commission-dashboard" element={
              <ProtectedRoute>
                <OwnerOnlyRoute>
                  <CommissionDashboard />
                </OwnerOnlyRoute>
              </ProtectedRoute>
            } />
            <Route path="/support" element={<Support />} />
            <Route path="/support-admin" element={
              <ProtectedRoute>
                <OwnerOnlyRoute>
                  <SupportAdmin />
                </OwnerOnlyRoute>
              </ProtectedRoute>
            } />
          </Routes>
        </Suspense>
      </main>

      <LegalFooter />
      
      {/* Mobile Bottom Navigation */}
      <MobileBottomNav />

    </div>
  );
}

function App() {
  useEffect(() => {
    // Le viewport est déclaré dans index.html (avec zoom autorisé pour
    // l'accessibilité) — on ne le réinjecte plus ici.

    // iOS standalone (ajouté à l'écran d'accueil)
    if (window.navigator.standalone) {
      document.body.classList.add('ios-standalone');
    }

    // PWA display mode standalone
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      document.body.classList.add('pwa-standalone');
    }
  }, []);

  return (
    <div className="App">
      <BrowserRouter>
        <LanguageProvider>
          <AuthProvider>
            <CountryProvider>
              <ToastProvider>
                <NotificationProvider>
                  <ErrorBoundary>
                    <AppRoutes />
                  </ErrorBoundary>
                </NotificationProvider>
              </ToastProvider>
            </CountryProvider>
          </AuthProvider>
        </LanguageProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;