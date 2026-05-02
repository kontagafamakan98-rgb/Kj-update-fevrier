import { useEffect, useState, lazy, Suspense } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LanguageProvider, useLanguage } from "./contexts/LanguageContext";
import { PaymentProvider } from './contexts/PaymentContext';
import { ToastProvider } from './contexts/ToastContext';
import Navbar from "./components/Navbar";
import OfflineIndicator from "./components/OfflineIndicator";
import MobileBottomNav from "./components/MobileBottomNav";
import ErrorBoundary from "./components/ErrorBoundary";
import NetworkStatus from "./components/NetworkStatus";
import ToastContainer from "./components/ToastContainer";
import PageLoader from "./components/PageLoader";
import OwnerService from './services/ownerService';
import { isPWASupported, requestNotificationPermission } from "./utils/pwa";


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
const PaymentDemo = lazy(() => import('./pages/PaymentDemo'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const EmailVerificationPage = lazy(() => import('./pages/EmailVerificationPage'));
const PaymentVerificationPage = lazy(() => import('./pages/PaymentVerificationPage'));
const CommissionDashboard = lazy(() => import('./pages/CommissionDashboard'));

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

  if (!user || !OwnerService.isFamakanLoggedIn()) {
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
      contact: 'Contact KOJO',
      addressLabel: 'Adresse'
    },
    en: {
      legal: 'Privacy Policy',
      contact: 'KOJO contact',
      addressLabel: 'Address'
    },
    wo: {
      legal: 'Politique de confidentialité',
      contact: 'Contact KOJO',
      addressLabel: 'Adresse'
    },
    bm: {
      legal: 'Politique de confidentialité',
      contact: 'Contact KOJO',
      addressLabel: 'Adresse'
    },
    mos: {
      legal: 'Politique de confidentialité',
      contact: 'Contact KOJO',
      addressLabel: 'Adresse'
    }
  };
  const labels = copy[currentLanguage] || copy.fr;

  return (
    <footer className="border-t border-orange-100 bg-white/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-sm">
        <div className="text-gray-600 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-gray-800">Kojo</span>
            <span>•</span>
            <a href="tel:+18193003507" className="hover:text-orange-600">+18193003507</a>
            <span>•</span>
            <a href="mailto:Kojoapp98@gmail.com" className="hover:text-orange-600">Kojoapp98@gmail.com</a>
          </div>
          <div className="text-xs text-gray-500">
            {labels.addressLabel} : Hamdallaye Aci 2000 Bamako Mali
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-orange-700">
          <a href={legalDocumentUrl} target="_blank" rel="noreferrer" className="hover:text-orange-800 underline underline-offset-2">
            {labels.legal}
          </a>
          <a href="mailto:Kojoapp98@gmail.com?subject=Contact%20confidentialit%C3%A9%20KOJO" className="hover:text-orange-800 underline underline-offset-2">
            {labels.contact}
          </a>
        </div>
      </div>
    </footer>
  );
}

function AppRoutes() {
  const [pwaReady, setPwaReady] = useState(false);
  const { user } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    // Initialize PWA features
    const initPWA = async () => {
      if (isPWASupported()) {
        // Request notification permission when user is logged in
        if (user) {
          await requestNotificationPermission();
        }
      }
      setPwaReady(true);
    };

    initPWA();
  }, [user]);

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

      {/* Main Content with Suspense for lazy loaded routes */}
      <main className="pb-16 md:pb-0">
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
            <Route path="/photo-debug" element={<PhotoTest />} />
            <Route path="/payment-demo" element={
              <ProtectedRoute>
                <OwnerOnlyRoute>
                  <PaymentDemo />
                </OwnerOnlyRoute>
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
            <PaymentProvider>
              <ToastProvider>
                <ErrorBoundary>
                  <AppRoutes />
                </ErrorBoundary>
              </ToastProvider>
            </PaymentProvider>
          </AuthProvider>
        </LanguageProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;