import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GeolocationService from '../services/geolocation';
import { useAuth } from './AuthContext';

const LocationContext = createContext();

export const useLocation = () => {
  const context = useContext(LocationContext);
  if (!context) {
    throw new Error('useLocation must be used within a LocationProvider');
  }
  return context;
};

export const LocationProvider = ({ children }) => {
  const { user } = useAuth();
  const [currentLocation, setCurrentLocation] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [locationHistory, setLocationHistory] = useState([]);

  // Load saved location on app start
  useEffect(() => {
    loadSavedLocation();
  }, []);

  const loadSavedLocation = async () => {
    try {
      const savedLocation = await AsyncStorage.getItem('currentLocation');
      if (savedLocation) {
        setCurrentLocation(JSON.parse(savedLocation));
      }
    } catch (error) {
      console.error('Error loading saved location:', error);
    }
  };

  const saveLocation = async (location) => {
    try {
      await AsyncStorage.setItem('currentLocation', JSON.stringify(location));
      setCurrentLocation(location);
      
      // Add to history
      setLocationHistory(prev => {
        const newHistory = [location, ...prev.slice(0, 4)]; // Keep last 5 locations
        return newHistory;
      });
    } catch (error) {
      console.error('Error saving location:', error);
    }
  };

  const detectCurrentLocation = async () => {
    if (isDetecting) return null;
    
    setIsDetecting(true);
    try {
      const userCountry = user?.country || 'mali';
      const detectedLocation = await GeolocationService.detectUserLocation(userCountry);
      
      if (detectedLocation) {
        await saveLocation(detectedLocation);
        return detectedLocation;
      }
    } catch (error) {
      console.error('Location detection error:', error);
      throw error;
    } finally {
      setIsDetecting(false);
    }
  };

  const getLocationSuggestions = async (searchQuery = '') => {
    const userCountry = user?.country || 'mali';
    return await GeolocationService.getLocationSuggestions(userCountry, searchQuery);
  };

  const formatPhoneWithCurrentLocation = (phone) => {
    if (currentLocation) {
      return GeolocationService.formatPhoneWithLocation(phone, currentLocation);
    }
    return phone;
  };

  const clearLocationData = async () => {
    try {
      await AsyncStorage.removeItem('currentLocation');
      setCurrentLocation(null);
      setLocationHistory([]);
    } catch (error) {
      console.error('Error clearing location data:', error);
    }
  };

  const value = {
    currentLocation,
    isDetecting,
    locationHistory,
    detectCurrentLocation,
    getLocationSuggestions,
    formatPhoneWithCurrentLocation,
    saveLocation,
    clearLocationData
  };

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
};