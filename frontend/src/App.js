import { useEffect, useState, lazy, Suspense } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { devLog, safeLog } from './utils/env';

import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LanguageProvider, useLanguage } from "./contexts/LanguageContext";
import { PaymentProvider } from './contexts/PaymentContext';
import { ToastProvider } from './contexts/ToastContext';
import Navbar from "./components/Navbar";
import OfflineIndicator from "./components/OfflineIndicator";
import MobileBottomNav from "./components/MobileBottomNav";
import ErrorBoundary from "./components/ErrorBoundary";
import NetworkStatus from "./components/NetworkStatus";
import PerformanceMonitor from "./components/PerformanceMonitor";
import AccessibilityHelper from "./components/AccessibilityHelper";
import ToastContainer from "./components/ToastContainer";
import PageLoader from "./components/PageLoader";
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

function AppRoutes() {
  const [pwaReady, setPwaReady] = useState(false);
  const { user } = useAuth();

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
        <Suspense fallback={<PageLoader message="Chargement de la page..." />}>
          <Routes>
            {/* Public routes - eagerly loaded */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
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
            <Route path="/payment-demo" element={<PaymentDemo />} />
            <Route path="/payment-verification" element={<PaymentVerificationPage />} />
            <Route path="/commission-dashboard" element={
              <ProtectedRoute>
                <CommissionDashboard />
              </ProtectedRoute>
            } />
          </Routes>
        </Suspense>
      </main>
      
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

    // Handle online/offline status
    const handleOnline = () => {
      devLog.info('App is online');
      // Could trigger data sync here
    };
    
    const handleOffline = () => {
      devLog.info('App is offline');
      // Could save pending actions for later sync
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Handle PWA app installed event
    const handleAppInstalled = () => {
      devLog.info('PWA was installed');
      // Could track analytics or show welcome message
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  return (
    <div className="App">
      <ErrorBoundary>
        <PerformanceMonitor />
        <AccessibilityHelper />
        <BrowserRouter>
          <LanguageProvider>
            <AuthProvider>
              <PaymentProvider>
                <ToastProvider>
                  <AppRoutes />
                </ToastProvider>
              </PaymentProvider>
            </AuthProvider>
          </LanguageProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </div>
  );
}

export default App;