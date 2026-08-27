import React, { createContext, useContext, useState, useEffect } from 'react';
import { devLog, safeLog } from '../utils/env';
import fr from '../i18n/fr.json';

// Les traductions vivent dans des fichiers JSON par langue (src/i18n/*.json) :
// faciles à maintenir/éditer sans toucher au code, et extractibles par les
// outils de traduction. Chaque langue contient les mêmes clés (fr/en/wo/bm/mos).
//
// fr.json est importé STATIQUEMENT : c'est la langue par défaut ET le fallback
// universel (toute clé manquante retombe sur le français). Les autres langues
// (en/wo/bm/mos) sont chargées DYNAMIQUEMENT au premier changement : Vite émet
// un chunk par langue, et le chunk d'entrée ne contient plus que le français
// (~35 kB JSON au lieu de ~173 kB pour les 5 locales).
const LANGUAGES = ['fr', 'en', 'wo', 'bm', 'mos'];
const languageLoaders = {
  en: () => import('../i18n/en.json'),
  wo: () => import('../i18n/wo.json'),
  bm: () => import('../i18n/bm.json'),
  mos: () => import('../i18n/mos.json'),
};

const LanguageContext = createContext(null);

const getStoredOrFallbackLanguage = () => {
  try {
    const savedLanguage = localStorage.getItem('language');
    return savedLanguage && LANGUAGES.includes(savedLanguage) ? savedLanguage : 'fr';
  } catch (error) {
    return 'fr';
  }
};

const fallbackLanguageApi = {
  currentLanguage: getStoredOrFallbackLanguage(),
  changeLanguage: () => {},
  t: (key) => {
    // Hors provider : seul le français est disponible (fallback universel).
    return fr[key] || key;
  }
};

export function useLanguage() {
  return useContext(LanguageContext) || fallbackLanguageApi;
}

export function LanguageProvider({ children }) {
  const [currentLanguage, setCurrentLanguage] = useState(getStoredOrFallbackLanguage);
  // Seules les traductions chargées sont en mémoire ; fr est toujours présent.
  const [translations, setTranslations] = useState({ fr });

  // Charge la langue sélectionnée à la demande (une seule fois par langue).
  useEffect(() => {
    if (currentLanguage === 'fr' || translations[currentLanguage]) return;
    let cancelled = false;
    languageLoaders[currentLanguage]()
      .then((mod) => {
        if (!cancelled) {
          setTranslations((prev) => ({ ...prev, [currentLanguage]: mod.default }));
        }
      })
      .catch((error) => {
        safeLog.warn(`⚠️ Traductions "${currentLanguage}" non chargées — repli sur le français`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [currentLanguage, translations]);

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
