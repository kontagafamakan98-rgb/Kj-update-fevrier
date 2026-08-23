import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { authAPI, geolocationAPI } from '../services/api';
import { safeLog } from '../utils/env';

const CountryContext = createContext();

export const useCountry = () => {
  return useContext(CountryContext);
};

export const CountryProvider = ({ children }) => {
  const { user, loadUser } = useAuth();
  const [availableCountries, setAvailableCountries] = useState([]);
  const [loadingCountries, setLoadingCountries] = useState(true);

  // Load available countries once
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        const response = await geolocationAPI.getAvailableCountries();
        setAvailableCountries(response.countries || []);
      } catch (error) {
        safeLog.error('Error fetching available countries:', error);
      } finally {
        setLoadingCountries(false);
      }
    };
    fetchCountries();
  }, []);

  const changeUserCountry = async (newCountry) => {
    if (!user) return false;
    try {
      await authAPI.updateCountry({ country: newCountry });
      // Recharger le profil depuis le backend pour mettre à jour l'état local
      await loadUser();
      return true;
    } catch (error) {
      safeLog.error('Error changing country:', error);
      return false;
    }
  };

  const isOwner = user?.is_owner || false;
  const currentCountry = user?.country || 'senegal';

  // Find country details from the list
  const currentCountryDetails = availableCountries.find(c => c.id === currentCountry) || {
    id: currentCountry,
    name: currentCountry.charAt(0).toUpperCase() + currentCountry.slice(1).replace('_', ' '),
    flag: '🌍',
    languages: ['fr', 'en']
  };

  const value = {
    currentCountry,
    currentCountryDetails,
    availableCountries,
    loadingCountries,
    changeUserCountry,
    isOwner,
  };

  return (
    <CountryContext.Provider value={value}>
      {children}
    </CountryContext.Provider>
  );
};
