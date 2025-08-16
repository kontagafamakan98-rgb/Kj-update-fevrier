import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import ImageService from '../services/imageService';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profilePhoto, setProfilePhoto] = useState(null);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const storedToken = await AsyncStorage.getItem('auth_token');
      const storedUser = await AsyncStorage.getItem('user_data');
      
      if (storedToken && storedUser) {
        const userData = JSON.parse(storedUser);
        setToken(storedToken);
        setUser(userData);
        api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
        
        // Load profile photo
        const photo = await ImageService.loadProfilePhoto(userData.id);
        if (photo) {
          setProfilePhoto(photo);
        }
      }
    } catch (error) {
      console.error('Error loading stored auth:', error);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const { access_token, user: userData } = response.data;
      
      await AsyncStorage.setItem('auth_token', access_token);
      await AsyncStorage.setItem('user_data', JSON.stringify(userData));
      
      setToken(access_token);
      setUser(userData);
      api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
      
      return { success: true, user: userData };
    } catch (error) {
      return { success: false, error: error.response?.data?.detail || 'Login failed' };
    }
  };

  const register = async (userData) => {
    try {
      const response = await api.post('/auth/register', userData);
      const { access_token, user: newUser } = response.data;
      
      await AsyncStorage.setItem('auth_token', access_token);
      await AsyncStorage.setItem('user_data', JSON.stringify(newUser));
      
      setToken(access_token);
      setUser(newUser);
      api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
      
      return { success: true, user: newUser };
    } catch (error) {
      return { success: false, error: error.response?.data?.detail || 'Registration failed' };
    }
  };

  const logout = async () => {
    try {
      await AsyncStorage.multiRemove(['auth_token', 'user_data']);
      
      // Clear profile photo
      if (user?.id) {
        await ImageService.deleteProfilePhoto(user.id);
      }
      
      setUser(null);
      setToken(null);
      setProfilePhoto(null);
      delete api.defaults.headers.common['Authorization'];
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const updateProfilePhoto = async (imageData) => {
    if (!user?.id) return { success: false, error: 'User not found' };

    try {
      // Save photo locally
      const savedPhoto = await ImageService.saveProfilePhoto(user.id, imageData.uri);
      setProfilePhoto(savedPhoto);
      
      // Upload to server (in real app)
      const uploadResult = await ImageService.uploadProfilePhoto(imageData, user.id);
      
      return uploadResult;
    } catch (error) {
      console.error('Error updating profile photo:', error);
      return { success: false, error: 'Failed to update photo' };
    }
  };

  const removeProfilePhoto = async () => {
    if (!user?.id) return { success: false, error: 'User not found' };

    try {
      await ImageService.deleteProfilePhoto(user.id);
      setProfilePhoto(null);
      
      return { success: true };
    } catch (error) {
      console.error('Error removing profile photo:', error);
      return { success: false, error: 'Failed to remove photo' };
    }
  };

  const value = {
    user,
    token,
    loading,
    profilePhoto,
    login,
    register,
    logout,
    updateProfilePhoto,
    removeProfilePhoto,
    isAuthenticated: !!token && !!user
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};