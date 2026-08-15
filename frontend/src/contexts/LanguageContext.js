import React, { createContext, useContext, useState } from 'react';
import { devLog, safeLog } from '../utils/env';
import fr from '../i18n/fr.json';
import en from '../i18n/en.json';
import wo from '../i18n/wo.json';
import bm from '../i18n/bm.json';
import mos from '../i18n/mos.json';

const LanguageContext = createContext(null);

const getStoredOrFallbackLanguage = () => {
  try {
    const savedLanguage = localStorage.getItem('language');
    return savedLanguage && ['fr', 'en', 'wo', 'bm', 'mos'].includes(savedLanguage) ? savedLanguage : 'fr';
  } catch (error) {
    return 'fr';
  }
};

const fallbackLanguageApi = {
  currentLanguage: getStoredOrFallbackLanguage(),
  changeLanguage: () => {},
  t: (key) => {
    const language = getStoredOrFallbackLanguage();
    return translations?.[language]?.[key] || translations?.en?.[key] || translations?.fr?.[key] || key;
  }
};

export function useLanguage() {
  return useContext(LanguageContext) || fallbackLanguageApi;
}

// Les traductions vivent dans des fichiers JSON par langue (src/i18n/*.json) :
// faciles à maintenir/éditer sans toucher au code, et extractibles par les
// outils de traduction. Chaque langue contient les mêmes clés (fr/en/wo/bm/mos).
const translations = { fr, en, wo, bm, mos };

export function LanguageProvider({ children }) {
  const [currentLanguage, setCurrentLanguage] = useState(() => {
    // Initialize from localStorage or default to French
    const savedLanguage = localStorage.getItem('language');
    return savedLanguage && ['fr', 'en', 'wo', 'bm', 'mos'].includes(savedLanguage) ? savedLanguage : 'fr';
  });

  const t = (key) => {
    return translations[currentLanguage]?.[key] || translations.en?.[key] || translations.fr?.[key] || key;
  };

  const changeLanguage = (lang) => {
    if (process.env.NODE_ENV === 'development') {
      devLog.info(`🔄 Changing interface language to: ${lang}`);
    }
    setCurrentLanguage(lang);
    localStorage.setItem('language', lang);
  };

  const COUNTRY_LANGUAGE_MAP = {
    mali: ['fr', 'en', 'bm'],
    senegal: ['fr', 'en', 'wo'],
    burkina_faso: ['fr', 'en', 'mos'],
    ivory_coast: ['fr', 'en'],
    cote_divoire: ['fr', 'en'],
  };

  const getAvailableLanguagesForCountry = (countryId) => {
    if (!countryId) return ['fr', 'en'];
    return COUNTRY_LANGUAGE_MAP[countryId] || ['fr', 'en'];
  };

  const value = {
    currentLanguage,
    changeLanguage,
    t,
    getAvailableLanguagesForCountry
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
