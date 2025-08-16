import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://profile-photo-fix-1.preview.emergentagent.com/api';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('Error getting auth token:', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid, clear auth data
      try {
        await SecureStore.deleteItemAsync('auth_token');
        await AsyncStorage.removeItem('user_data');
      } catch (clearError) {
        console.error('Error clearing auth data:', clearError);
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  register: (userData) => api.post('/auth/register', userData),
  getProfile: () => api.get('/users/profile'),
  updateProfile: (data) => api.put('/users/profile', data)
};

// Jobs API
export const jobsAPI = {
  getJobs: (params = {}) => api.get('/jobs', { params }),
  getJob: (jobId) => api.get(`/jobs/${jobId}`),
  createJob: (jobData) => api.post('/jobs', jobData),
  updateJob: (jobId, jobData) => api.put(`/jobs/${jobId}`, jobData),
  deleteJob: (jobId) => api.delete(`/jobs/${jobId}`)
};

// Proposals API
export const proposalsAPI = {
  createProposal: (jobId, proposalData) => api.post(`/jobs/${jobId}/proposals`, proposalData),
  getJobProposals: (jobId) => api.get(`/jobs/${jobId}/proposals`),
  updateProposal: (proposalId, data) => api.put(`/proposals/${proposalId}`, data),
  acceptProposal: (proposalId) => api.post(`/proposals/${proposalId}/accept`),
  rejectProposal: (proposalId) => api.post(`/proposals/${proposalId}/reject`)
};

// Messages API
export const messagesAPI = {
  sendMessage: (messageData) => api.post('/messages', messageData),
  getConversations: () => api.get('/messages/conversations'),
  getConversationMessages: (conversationId) => api.get(`/messages/${conversationId}`),
  markAsRead: (messageId) => api.put(`/messages/${messageId}/read`)
};

// Worker Profile API
export const workerAPI = {
  createProfile: (profileData) => api.post('/workers/profile', profileData),
  getProfile: () => api.get('/workers/profile'),
  updateProfile: (profileData) => api.put('/workers/profile', profileData),
  getWorkers: (params = {}) => api.get('/workers', { params })
};

// File Upload API
export const uploadAPI = {
  uploadImage: async (imageUri, type = 'profile') => {
    const formData = new FormData();
    formData.append('file', {
      uri: imageUri,
      type: 'image/jpeg',
      name: `${type}_${Date.now()}.jpg`,
    });
    formData.append('type', type);

    return api.post('/upload/image', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  
  uploadDocument: async (documentUri, type = 'cv') => {
    const formData = new FormData();
    formData.append('file', {
      uri: documentUri,
      type: 'application/pdf',
      name: `${type}_${Date.now()}.pdf`,
    });
    formData.append('type', type);

    return api.post('/upload/document', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }
};

export default api;