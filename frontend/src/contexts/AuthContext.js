import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI, handleApiError } from '../services/api';
import { devLog, safeLog } from '../utils/env';
import kojoCache, { CACHE_KEYS } from '../utils/cache';
import networkOptimizer from '../utils/networkOptimizer';
import { clearRegistrationFlow } from '../utils/registrationFlowStorage';
import { registerPushSubscription, unregisterPushSubscription, isPushSupported } from '../utils/pushRegistration';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is logged in on app start
    const token = localStorage.getItem('token');
    if (token) {
      loadUser();
    } else {
      setLoading(false);
    }
  }, []);

  const loadUser = async () => {
    try {
      // Use cached profile if available for faster loading
      const cachedUser = kojoCache.get(CACHE_KEYS.USER_PROFILE);
      if (cachedUser && networkOptimizer.getQuality() === 'poor') {
        setUser(cachedUser);
        setLoading(false);
        devLog.info('🚀 User loaded from cache (poor network)');
        return;
      }
      
      const userData = await authAPI.getProfile();
      setUser(userData);
      
      // Cache user data for offline access
      kojoCache.set(CACHE_KEYS.USER_PROFILE, userData, 60 * 60 * 1000); // 1 hour
      devLog.info('✅ User profile loaded and cached');
      
    } catch (error) {
      safeLog.error('Error loading user:', error);
      
      // Try to load from cache if API fails
      const cachedUser = kojoCache.get(CACHE_KEYS.USER_PROFILE);
      if (cachedUser) {
        setUser(cachedUser);
        devLog.info('📱 User loaded from cache (API failed)');
      } else {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      const response = await authAPI.login({ email, password });
      const { access_token, user } = response;
      
      localStorage.setItem('token', access_token);
      localStorage.setItem('user', JSON.stringify(user));
      setUser(user);
      
      // Cache user data
      kojoCache.set(CACHE_KEYS.USER_PROFILE, user, 24 * 60 * 60 * 1000); // 24 hours
      
      devLog.info('✅ User logged in successfully');

      // Enregistrer la subscription push en arrière-plan (silencieux)
      if (isPushSupported()) {
        registerPushSubscription(user.id).catch(() => {});
      }

      return { success: true, user };
      
    } catch (error) {
      const errorMessage = handleApiError(error);
      safeLog.error('Login failed:', errorMessage);

      // Le backend renvoie "Invalid credentials" en anglais, quelle que
      // soit la langue de l'utilisateur. On detecte precisement ce cas
      // (401 + ce message) pour afficher une version traduite au lieu du
      // texte brut du backend.
      const status = error?.response?.status;
      const rawDetail = typeof error?.response?.data?.detail === 'string' ? error.response.data.detail : '';
      const isInvalidCredentials = status === 401 && /invalid credentials/i.test(rawDetail);

      return {
        success: false,
        error: errorMessage,
        errorKey: isInvalidCredentials ? 'invalidCredentials' : ''
      };
    }
  };

  // Nouvelle fonction pour connexion automatique après inscription
  const autoLoginAfterRegistration = (userData, token) => {
    try {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(userData));
      setUser(userData);
      
      // Cache user data
      kojoCache.set(CACHE_KEYS.USER_PROFILE, userData, 24 * 60 * 60 * 1000); // 24 hours
      
      devLog.info('✅ User auto-logged in after registration');

      // Enregistrer la subscription push en arrière-plan (silencieux)
      if (isPushSupported()) {
        registerPushSubscription(userData.id).catch(() => {});
      }

      return { success: true };
      
    } catch (error) {
      safeLog.error('Auto-login after registration failed:', error);
      return { success: false, error: error.message };
    }
  };

  const register = async (userData) => {
    try {
      const response = await authAPI.register(userData);
      const { access_token, user } = response;
      
      localStorage.setItem('token', access_token);
      localStorage.setItem('user', JSON.stringify(user));
      setUser(user);
      
      // Cache user data
      kojoCache.set(CACHE_KEYS.USER_PROFILE, user, 24 * 60 * 60 * 1000); // 24 hours
      
      devLog.info('✅ User registered successfully');
      return { success: true };
      
    } catch (error) {
      const errorMessage = handleApiError(error);
      safeLog.error('Registration failed:', errorMessage);

      return {
        success: false,
        error: errorMessage
      };
    }
  };

  const logout = async () => {
    try {
      // Révoquer la subscription push avant de se déconnecter
      if (isPushSupported()) {
        unregisterPushSubscription().catch(() => {});
      }
      // Attempt to notify server of logout
      await authAPI.logout();
    } catch (error) {
      devLog.warn('Server logout failed:', error);
    } finally {
      // Always clear local data
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      kojoCache.clear(); // Clear all cached data
      clearRegistrationFlow();
      setUser(null);
      
      devLog.info('✅ User logged out and cache cleared');
    }
  };

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    loadUser,
    autoLoginAfterRegistration
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}