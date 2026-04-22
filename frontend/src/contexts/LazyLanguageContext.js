import React, { createContext, useContext, useState, useEffect } from 'react';
import { devLog } from '../utils/env';

const LazyLanguageContext = createContext();

// Traductions de base (toujours chargées)
const baseTranslations = {
  fr: {
    loading: 'Chargement...',
    error: 'Erreur',
    retry: 'Réessayer',
  },
  en: {
    loading: 'Loading...',
    error: 'Error',
    retry: 'Retry',
  },
  wo: {
    loading: 'Taxaw...',
    error: 'Fii',
    retry: 'Ceeb',
  },
  bm: {
    loading: 'Ka labɛn...',
    error: 'Fili',
    retry: 'Kɔrɔsi',
  }
};

// Cache pour les traductions chargées
const translationCache = {};

// Fonction pour charger les traductions complètes d'une langue
const loadLanguageTranslations = async (languageCode) => {
  // Si déjà en cache, retourner immédiatement
  if (translationCache[languageCode]) {
    return translationCache[languageCode];
  }

  try {
    // Utiliser l'import dynamique pour le lazy loading
    const module = await import(`../translations/${languageCode}.json`);
    translationCache[languageCode] = module.default;
    return module.default;
  } catch (error) {
    devLog.warn(`Impossible de charger les traductions pour ${languageCode}:`, error);
    // Fallback vers les traductions de base
    return baseTranslations[languageCode] || baseTranslations.fr;
  }
};

export const LazyLanguageProvider = ({ children }) => {
  const [currentLanguage, setCurrentLanguage] = useState('fr');
  const [translations, setTranslations] = useState(baseTranslations[currentLanguage]);
  const [loading, setLoading] = useState(false);

  // Fonction pour changer de langue avec chargement lazy
  const changeLanguage = async (newLanguage) => {
    if (newLanguage === currentLanguage) return;

    setLoading(true);
    
    try {
      // Charger les traductions de la nouvelle langue
      const newTranslations = await loadLanguageTranslations(newLanguage);
      
      setCurrentLanguage(newLanguage);
      setTranslations(newTranslations);
      
      // Sauvegarder dans localStorage
      localStorage.setItem('language', newLanguage);
    } catch (error) {
      devLog.error('Erreur lors du changement de langue:', error);
      // En cas d'erreur, utiliser les traductions de base
      setTranslations(baseTranslations[newLanguage] || baseTranslations.fr);
    } finally {
      setLoading(false);
    }
  };

  // Fonction t() optimisée
  const t = (key, fallback = key) => {
    if (loading) {
      return baseTranslations[currentLanguage]?.loading || 'Loading...';
    }
    
    return translations[key] || fallback;
  };

  // Initialisation
  useEffect(() => {
    const initLanguage = async () => {
      const savedLanguage = localStorage.getItem('language') || 'fr';
      if (savedLanguage !== 'fr') {
        await changeLanguage(savedLanguage);
      }
    };

    initLanguage();
  }, []);

  const value = {
    currentLanguage,
    changeLanguage,
    t,
    loading,
    availableLanguages: ['fr', 'en', 'wo', 'bm'],
  };

  return (
    <LazyLanguageContext.Provider value={value}>
      {children}
    </LazyLanguageContext.Provider>
  );
};

export const useLazyLanguage = () => {
  const context = useContext(LazyLanguageContext);
  if (!context) {
    throw new Error('useLazyLanguage must be used within a LazyLanguageProvider');
  }
  return context;
};

export default LazyLanguageContext;