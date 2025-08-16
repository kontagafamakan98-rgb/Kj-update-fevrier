import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LanguageContext = createContext({});

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

const translations = {
  fr: {
    // Navigation
    home: 'Accueil',
    jobs: 'Emplois',
    messages: 'Messages',
    profile: 'Profil',
    
    // Auth
    login: 'Connexion',
    register: 'Inscription',
    email: 'Email',
    password: 'Mot de passe',
    firstName: 'Prénom',
    lastName: 'Nom',
    phone: 'Téléphone',
    country: 'Pays',
    userType: 'Type d\'utilisateur',
    client: 'Client',
    worker: 'Travailleur',
    
    // Jobs
    postJob: 'Publier un emploi',
    jobTitle: 'Titre de l\'emploi',
    jobDescription: 'Description',
    category: 'Catégorie',
    budget: 'Budget',
    location: 'Localisation',
    
    // Common
    save: 'Enregistrer',
    cancel: 'Annuler',
    submit: 'Soumettre',
    loading: 'Chargement...',
    error: 'Erreur',
    success: 'Succès',
    
    // Countries
    mali: 'Mali',
    senegal: 'Sénégal',
    burkina_faso: 'Burkina Faso',
    ivory_coast: 'Côte d\'Ivoire'
  },
  wo: {
    // Navigation (Wolof)
    home: 'Kër',
    jobs: 'Liggéey',
    messages: 'Battu',
    profile: 'Profil',
    
    // Auth
    login: 'Dugg',
    register: 'Bind',
    email: 'Email',
    password: 'Baacinu dugg',
    firstName: 'Tur',
    lastName: 'Sant',
    phone: 'Telefon',
    country: 'Réew',
    userType: 'Seet bu nit',
    client: 'Kiliyaan',
    worker: 'Liggéeykaat',
    
    // Jobs
    postJob: 'Wax liggéey',
    jobTitle: 'Tur liggéey',
    jobDescription: 'Melokaan',
    category: 'Seet',
    budget: 'Xaalis',
    location: 'Bees',
    
    // Common
    save: 'Yëgle',
    cancel: 'Noppil',
    submit: 'Yónne',
    loading: 'Dafa jël...',
    error: 'Njumte',
    success: 'Baax',
  },
  bm: {
    // Navigation (Bambara)
    home: 'So',
    jobs: 'Baara',
    messages: 'Cikan',
    profile: 'Kunnafoni',
    
    // Auth
    login: 'Don',
    register: 'I tɔgɔ sɛbɛn',
    email: 'Email',
    password: 'Dɔnniya daɲɛgafe',
    firstName: 'Tɔgɔ fɔlɔ',
    lastName: 'Tɔgɔ laban',
    phone: 'Telefoni',
    country: 'Jamana',
    userType: 'Baara kɛcogo',
    client: 'Kiliyɛn',
    worker: 'Baarakɛla',
    
    // Jobs
    postJob: 'Baara bila',
    jobTitle: 'Baara tɔgɔ',
    jobDescription: 'Ɲɛfɔli',
    category: 'Sugu',
    budget: 'Wariko',
    location: 'Yɔrɔ',
    
    // Common
    save: 'Mara',
    cancel: 'Ban',
    submit: 'Ci',
    loading: 'B\'a kɛ...',
    error: 'Fili',
    success: 'A kɛra',
  }
};

export const LanguageProvider = ({ children }) => {
  const [currentLanguage, setCurrentLanguage] = useState('fr');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStoredLanguage();
  }, []);

  const loadStoredLanguage = async () => {
    try {
      const storedLanguage = await AsyncStorage.getItem('app_language');
      if (storedLanguage) {
        setCurrentLanguage(storedLanguage);
      }
    } catch (error) {
      console.error('Error loading stored language:', error);
    } finally {
      setLoading(false);
    }
  };

  const setLanguage = async (language) => {
    try {
      await AsyncStorage.setItem('app_language', language);
      setCurrentLanguage(language);
    } catch (error) {
      console.error('Error setting language:', error);
    }
  };

  const t = (key) => {
    return translations[currentLanguage]?.[key] || key;
  };

  const value = {
    currentLanguage,
    setLanguage,
    t,
    loading,
    availableLanguages: [
      { code: 'fr', name: 'Français', flag: '🇫🇷' },
      { code: 'wo', name: 'Wolof', flag: '🇸🇳' },
      { code: 'bm', name: 'Bambara', flag: '🇲🇱' }
    ]
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};