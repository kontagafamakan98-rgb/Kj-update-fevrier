import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { api } from '../services/api';

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

  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const storedToken = await SecureStore.getItemAsync('auth_token');
      const storedUser = await AsyncStorage.getItem('user_data');
      
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
      }
    } catch (error) {
      console.error('Error loading stored auth:', error);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      const response = await api.post('/auth/login', {
        email,
        password
      });

      const { access_token, user: userData } = response.data;
      
      await SecureStore.setItemAsync('auth_token', access_token);
      await AsyncStorage.setItem('user_data', JSON.stringify(userData));
      
      setToken(access_token);
      setUser(userData);
      api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
      
      return { success: true, user: userData };
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: error.response?.data?.detail || 'Login failed'
      };
    }
  };

  const register = async (userData) => {
    try {
      const response = await api.post('/auth/register', userData);
      
      const { access_token, user: newUser } = response.data;
      
      await SecureStore.setItemAsync('auth_token', access_token);
      await AsyncStorage.setItem('user_data', JSON.stringify(newUser));
      
      setToken(access_token);
      setUser(newUser);
      api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
      
      return { success: true, user: newUser };
    } catch (error) {
      console.error('Registration error:', error);
      return {
        success: false,
        error: error.response?.data?.detail || 'Registration failed'
      };
    }
  };

  const logout = async () => {
    try {
      await SecureStore.deleteItemAsync('auth_token');
      await AsyncStorage.removeItem('user_data');
      
      setToken(null);
      setUser(null);
      delete api.defaults.headers.common['Authorization'];
      
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, error: 'Logout failed' };
    }
  };

  const updateProfile = async (profileData) => {
    try {
      await api.put('/users/profile', profileData);
      
      const updatedUser = { ...user, ...profileData };
      setUser(updatedUser);
      await AsyncStorage.setItem('user_data', JSON.stringify(updatedUser));
      
      return { success: true };
    } catch (error) {
      console.error('Profile update error:', error);
      return {
        success: false,
        error: error.response?.data?.detail || 'Profile update failed'
      };
    }
  };

  const value = {
    user,
    token,
    loading,
    login,
    register,
    logout,
    updateProfile,
    isAuthenticated: !!token && !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};