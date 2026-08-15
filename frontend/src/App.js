import { useEffect, useState, lazy, Suspense } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";

import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LanguageProvider, useLanguage } from "./contexts/LanguageContext";
import { PaymentProvider } from './contexts/PaymentContext';
import { ToastProvider } from './contexts/ToastContext';
import { CountryProvider } from "./contexts/CountryContext";
import { NotificationProvider } from './contexts/NotificationContext';
import Navbar from "./components/Navbar";
import CountryChangePopup from "./components/CountryChangePopup";
import OfflineIndicator from "./components/OfflineIndicator";
import MobileBottomNav from "./components/MobileBottomNav";
import ErrorBoundary from "./components/ErrorBoundary";
import NetworkStatus from "./components/NetworkStatus";
import ToastContainer from "./components/ToastContainer";
import PageLoader from "./components/PageLoader";
import OwnerService from './services/ownerService';
import { isPWASupported, requestNotificationPermission } from "./utils/pwa";
import { useNotifications } from './contexts/NotificationContext';


// Eager load critical pages (public pages shown immediately)
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";

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
const Support = lazy(() => import('./pages/Support'));
const SupportAdmin = lazy(() => import('./pages/SupportAdmin'));

// Note: Axios configuration moved to /services/api.js for centralized management

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  
  if (loading) {
    return (
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
  const { currentLanguage } = useLanguage();
  const legalDocumentUrl = '/legal/kojo_politique_confidentialite_et_cgu_fusionnees.docx';
  const copy = {
    fr: {
      legal: 'Politique de confidentialité',
      contact: 'Nous contacter',
    },
    en: {
      legal: 'Privacy Policy',
      contact: 'Contact us',
    },
    wo: {
      legal: 'Politique de confidentialité',
      contact: 'Nous contacter',
    },
    bm: {
      legal: 'Politique de confidentialité',
      contact: 'Nous contacter',
    },
    mos: {
      legal: 'Politique de confidentialité',
      contact: 'Nous contacter',
    }
  };
  const labels = copy[currentLanguage] || copy.fr;

  return (
    <footer className="border-t border-orange-100 bg-white/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center justify-center md:justify-end gap-4 text-sm text-orange-700">
        <a href={legalDocumentUrl} target="_blank" rel="noreferrer" className="hover:text-orange-800 underline underline-offset-2">
          {labels.legal}
        </a>
        <Link to="/support" className="hover:text-orange-800 underline underline-offset-2">
          {labels.contact}
        </Link>
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
        addLocalNotification({
          id: `local_${Date.now()}`,
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
    <div className="min-h-screen bg-gray-50 relative">
      {/* Network Status and Offline Indicator */}
      <NetworkStatus />
      <OfflineIndicator />

      {/* Main Navigation */}
      <Navbar />
      
      {/* Toast Notifications */}
      <ToastContainer />
      
      {/* Geolocation Popup */}
      <CountryChangePopup />

      {/* Main Content with Suspense for lazy loaded routes */}
      <main className="pb-24 md:pb-0">
        <Suspense fallback={<PageLoader message={t('loadingPage')} />}>
          <Routes>
            {/* Public routes - eagerly loaded */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/register" element={<Register />} />
            
            {/* Protected routes - lazy loaded */}
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } />
            <Route path="/jobs" element={
              <ProtectedRoute>
                <Jobs />
              </ProtectedRoute>
            } />
            <Route path="/jobs/:id" element={
              <ProtectedRoute>
                <JobDetails />
              </ProtectedRoute>
            } />
            <Route path="/messages" element={
              <ProtectedRoute>
                <Messages />
              </ProtectedRoute>
            } />
            <Route path="/profile" element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            } />
            <Route path="/create-job" element={
              <ProtectedRoute>
                <CreateJob />
              </ProtectedRoute>
            } />
            
            {/* Test and demo routes - lazy loaded */}
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
            <Route path="/photo-debug" element={
              <ProtectedRoute>
                <OwnerOnlyRoute>
                  <PhotoTest />
                </OwnerOnlyRoute>
              </ProtectedRoute>
            } />
            <Route path="/payment" element={
              <ProtectedRoute>
                <Payment />
              </ProtectedRoute>
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
    // Add mobile viewport optimizations
    const addMobileOptimizations = () => {
      // Prevent zoom on input focus (iOS)
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
      
      const existingMeta = document.querySelector('meta[name="viewport"]');
      if (existingMeta) {
        existingMeta.remove();
      }
      document.head.appendChild(meta);

      // Add iOS status bar styling
      if (window.navigator.standalone) {
        document.body.classList.add('ios-standalone');
      }

      // Add PWA display mode class
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
        document.body.classList.add('pwa-standalone');
      }
    };

    addMobileOptimizations();

  }, []);

  return (
    <div className="App">
      <BrowserRouter>
        <LanguageProvider>
          <AuthProvider>
            <CountryProvider>
              <PaymentProvider>
                <ToastProvider>
                  <NotificationProvider>
                    <ErrorBoundary>
                      <AppRoutes />
                    </ErrorBoundary>
                  </NotificationProvider>
                </ToastProvider>
              </PaymentProvider>
            </CountryProvider>
          </AuthProvider>
        </LanguageProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;