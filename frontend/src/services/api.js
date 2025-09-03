/**
 * API Service - Centralized HTTP client for Kojo application
 * Provides consistent API calls with authentication, error handling, and logging
 */

import axios from 'axios';
import { devLog, safeLog } from '../utils/env';
import kojoCache, { CACHE_KEYS } from '../utils/cache';
import networkOptimizer from '../utils/networkOptimizer';

// Get backend URL from environment
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API_BASE_URL = `${BACKEND_URL}/api`;

/**
 * Create axios instance with dynamic configuration based on network quality
 */
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Dynamic timeout based on network quality
apiClient.interceptors.request.use((config) => {
  const networkConfig = networkOptimizer.getConfig();
  config.timeout = networkConfig.requestTimeout || 10000;
  return config;
});

/**
 * Request interceptor - Add authentication token
 */
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    devLog.info(`🔄 API Request: ${config.method?.toUpperCase()} ${config.url}`, {
      data: config.data,
      params: config.params
    });
    
    return config;
  },
  (error) => {
    safeLog.error('❌ Request interceptor error:', error);
    return Promise.reject(error);
  }
);

/**
 * Response interceptor - Handle responses and errors
 */
apiClient.interceptors.response.use(
  (response) => {
    devLog.info(`✅ API Response: ${response.config.method?.toUpperCase()} ${response.config.url}`, {
      status: response.status,
      data: response.data
    });
    
    return response;
  },
  (error) => {
    const { response, config } = error;
    
    // Log error details
    safeLog.error(`❌ API Error: ${config?.method?.toUpperCase()} ${config?.url}`, {
      status: response?.status,
      statusText: response?.statusText,
      data: response?.data,
      message: error.message
    });
    
    // Handle 401 Unauthorized - logout user
    if (response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      
      // Redirect to login if not already there
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    
    // Handle network errors
    if (!response) {
      safeLog.error('❌ Network Error: Unable to reach server');
    }
    
    return Promise.reject(error);
  }
);

/**
 * Generic API methods with intelligent caching for West African networks
 */
export const api = {
  // GET request with smart caching
  get: async (endpoint, config = {}) => {
    try {
      const response = await apiClient.get(endpoint, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // GET with cache support
  getWithCache: async (endpoint, cacheKey, expiryTime = null, config = {}) => {
    try {
      // Use network-aware cache expiry
      const networkConfig = networkOptimizer.getConfig();
      const defaultExpiry = expiryTime || networkConfig.cacheExpiry;
      
      return await kojoCache.cacheWithRetry(
        cacheKey,
        async () => {
          const response = await apiClient.get(endpoint, config);
          return response.data;
        },
        networkOptimizer.getMaxRetries(),
        defaultExpiry
      );
    } catch (error) {
      throw error;
    }
  },

  // POST request
  post: async (endpoint, data = {}, config = {}) => {
    try {
      const response = await apiClient.post(endpoint, data, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // PUT request
  put: async (endpoint, data = {}, config = {}) => {
    try {
      const response = await apiClient.put(endpoint, data, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // DELETE request
  delete: async (endpoint, config = {}) => {
    try {
      const response = await apiClient.delete(endpoint, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // PATCH request
  patch: async (endpoint, data = {}, config = {}) => {
    try {
      const response = await apiClient.patch(endpoint, data, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // File upload
  uploadFile: async (endpoint, formData, onUploadProgress = null) => {
    try {
      const config = {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      };
      
      if (onUploadProgress) {
        config.onUploadProgress = onUploadProgress;
      }
      
      const response = await apiClient.post(endpoint, formData, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  }
};

/**
 * Authentication API endpoints with intelligent caching
 */
export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  register: (userData) => api.post('/auth/register', userData),
  registerVerified: (userData) => api.post('/auth/register-verified', userData),
  logout: () => {
    // Clear all cache on logout
    kojoCache.clear();
    return api.post('/auth/logout');
  },
  getProfile: () => api.getWithCache('/users/profile', CACHE_KEYS.USER_PROFILE),
  updateProfile: async (data) => {
    const result = await api.put('/users/profile', data);
    // Update cache with new profile data
    kojoCache.set(CACHE_KEYS.USER_PROFILE, result);
    return result;
  },
  changePassword: (data) => api.put('/users/change-password', data),
};

/**
 * Jobs API endpoints
 */
export const jobsAPI = {
  getAll: (params = {}) => api.get('/jobs', { params }),
  getById: (id) => api.get(`/jobs/${id}`),
  create: (jobData) => api.post('/jobs', jobData),
  update: (id, jobData) => api.put(`/jobs/${id}`, jobData),
  delete: (id) => api.delete(`/jobs/${id}`),
  apply: (jobId, applicationData) => api.post(`/jobs/${jobId}/apply`, applicationData),
  getApplications: (jobId) => api.get(`/jobs/${jobId}/applications`),
};

/**
 * Users API endpoints
 */
export const usersAPI = {
  getProfile: () => api.get('/users/profile'),
  updateProfile: (data) => api.put('/users/profile', data),
  uploadProfilePhoto: (formData) => api.uploadFile('/users/upload-profile-photo', formData),
  deleteProfilePhoto: () => api.delete('/users/profile-photo'),
  getPaymentAccounts: () => api.get('/users/payment-accounts'),
  updatePaymentAccounts: (data) => api.put('/users/payment-accounts', data),
  verifyPaymentAccess: (data) => api.post('/users/verify-payment-access', data),
};

/**
 * Messages API endpoints
 */
export const messagesAPI = {
  getConversations: () => api.get('/messages/conversations'),
  getMessages: (conversationId) => api.get(`/messages/${conversationId}`),
  sendMessage: (conversationId, messageData) => api.post(`/messages/${conversationId}`, messageData),
  createConversation: (data) => api.post('/messages/conversations', data),
};

/**
 * Owner API endpoints (protected)
 */
export const ownerAPI = {
  getDebugInfo: () => api.get('/owner/debug-info'),
  getUsersManagement: () => api.get('/owner/users-management'),
  getCommissionStats: () => api.get('/owner/commission-stats'),
  getSystemHealth: () => api.get('/owner/system-health'),
};

/**
 * Health check endpoint
 */
export const healthAPI = {
  check: () => api.get('/health'),
};

/**
 * Error handling utilities
 */
export const handleApiError = (error) => {
  if (!error.response) {
    return {
      message: 'Erreur de connexion. Vérifiez votre connexion internet.',
      type: 'network_error'
    };
  }

  const { status, data } = error.response;

  switch (status) {
    case 400:
      return {
        message: data?.detail || 'Données invalides',
        type: 'validation_error'
      };
    case 401:
      return {
        message: 'Session expirée. Veuillez vous reconnecter.',
        type: 'auth_error'
      };
    case 403:
      return {
        message: 'Accès interdit',
        type: 'permission_error'
      };
    case 404:
      return {
        message: 'Ressource non trouvée',
        type: 'not_found_error'
      };
    case 500:
      return {
        message: 'Erreur serveur. Veuillez réessayer plus tard.',
        type: 'server_error'
      };
    default:
      return {
        message: data?.detail || 'Une erreur inattendue s\'est produite',
        type: 'unknown_error'
      };
  }
};

// Export axios instance for advanced use cases
export { apiClient };

// Export default api
export default api;