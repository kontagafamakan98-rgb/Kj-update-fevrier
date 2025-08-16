import { createContext, useContext, useState } from 'react';

const LanguageContext = createContext();

export function useLanguage() {
  return useContext(LanguageContext);
}

const translations = {
  fr: {
    // Navigation
    home: 'Accueil',
    jobs: 'Emplois',
    messages: 'Messages',
    profile: 'Profil',
    dashboard: 'Tableau de bord',
    login: 'Connexion',
    register: 'Inscription',
    logout: 'Déconnexion',
    
    // Common
    save: 'Enregistrer',
    cancel: 'Annuler',
    delete: 'Supprimer',
    edit: 'Modifier',
    submit: 'Soumettre',
    loading: 'Chargement...',
    error: 'Erreur',
    success: 'Succès',
    
    // Auth
    email: 'E-mail',
    password: 'Mot de passe',
    firstName: 'Prénom',
    lastName: 'Nom',
    phone: 'Téléphone',
    confirmPassword: 'Confirmer le mot de passe',
    
    // User Types
    client: 'Client',
    worker: 'Travailleur',
    
    // Countries with flags
    mali: '🇲🇱 Mali',
    senegal: '🇸🇳 Sénégal',
    burkina_faso: '🇧🇫 Burkina Faso',
    ivory_coast: '🇨🇮 Côte d\'Ivoire',
    
    // Job related
    jobTitle: 'Titre du travail',
    jobDescription: 'Description',
    budget: 'Budget',
    location: 'Localisation',
    category: 'Catégorie',
    postJob: 'Publier un emploi',
    applyJob: 'Postuler',
    
    // Home page
    heroTitle: 'Connecter les travailleurs et clients au Mali & Sénégal',
    heroSubtitle: 'Trouvez des services de qualité ou offrez vos compétences dans votre région',
    getStarted: 'Commencer',
    
    // Categories
    plumbing: 'Plomberie',
    electrical: 'Électricité',
    construction: 'Construction',
    cleaning: 'Nettoyage',
    gardening: 'Jardinage',
    tutoring: 'Tutorat'
  },
  wo: {
    // Navigation (Wolof)
    home: 'Kër',
    jobs: 'Liggéey',
    messages: 'Bataaxal',
    profile: 'Profil',
    dashboard: 'Wàllu liggéey',
    login: 'Dugg',
    register: 'Bind ak tëdd',
    logout: 'Génn',
    
    // Common
    save: 'Jël',
    cancel: 'Bàyyi',
    delete: 'Moom',
    edit: 'Soppi',
    submit: 'Yónnë',
    loading: 'Dàng...',
    error: 'Njub',
    success: 'Baax',
    
    // Auth
    email: 'E-mail',
    password: 'Kóodu dugub',
    firstName: 'Tur',
    lastName: 'Sant',
    phone: 'Téléphone',
    confirmPassword: 'Dëggal kóodu dugub',
    
    // User Types
    client: 'Kliyan',
    worker: 'Liggéeykat',
    
    // Countries
    mali: 'Mali',
    senegal: 'Senegaal',
    burkina_faso: 'Burkina Faso',
    ivory_coast: 'Côte d\'Ivoire',
    
    // Job related
    jobTitle: 'Tur liggéey',
    jobDescription: 'Melaxal',
    budget: 'Xaalis',
    location: 'Bër',
    category: 'Wàcc',
    postJob: 'Feesal liggéey',
    applyJob: 'Dàgg-dàgg',
    
    // Home page
    heroTitle: 'Jëmmel liggéeykat ak kliyan ci Mali ak Senegaal',
    heroSubtitle: 'Wut sëriñ yu baax wala fekkali sa xel-xel ci sa cornur',
    getStarted: 'Tambali',
    
    // Categories
    plumbing: 'Ndox',
    electrical: 'Mbër',
    construction: 'Jëf-jëf',
    cleaning: 'Set',
    gardening: 'Jàng',
    tutoring: 'Jàngale'
  },
  bm: {
    // Navigation (Bambara)
    home: 'So',
    jobs: 'Baara',
    messages: 'Cikan',
    profile: 'Jateminè',
    dashboard: 'Baara yèrè',
    login: 'Don',
    register: 'Tɔgɔ sɛbɛn',
    logout: 'Bɔ',
    
    // Common
    save: 'Mara',
    cancel: 'Ban',
    delete: 'Bɔ',
    edit: 'Changé',
    submit: 'Bila',
    loading: 'Ka makɔnɔ...',
    error: 'Fili',
    success: 'Ɲè',
    
    // Auth
    email: 'E-mail',
    password: 'Dogolen daɲègafe',
    firstName: 'Tɔgɔ fɔlɔ',
    lastName: 'Tɔgɔ laban',
    phone: 'Telefɔni',
    confirmPassword: 'Dogolen daɲègafe dafasigi',
    
    // User Types
    client: 'Kiliyan',
    worker: 'Baarakɛla',
    
    // Countries
    mali: 'Mali',
    senegal: 'Senegali',
    burkina_faso: 'Burkina Faso',
    ivory_coast: 'Côte d\'Ivoire',
    
    // Job related
    jobTitle: 'Baara tɔgɔ',
    jobDescription: 'Baara ɲɛfɔli',
    budget: 'Wari',
    location: 'Yɔrɔ',
    category: 'Sugu',
    postJob: 'Baara bila',
    applyJob: 'Ɲinini kɛ',
    
    // Home page
    heroTitle: 'Baarakɛlaw ni kiliyanw jɛɲɔgɔnya Mali ni Senegali',
    heroSubtitle: 'Baara ɲuman sɔrɔ walima i ka seko di i ka sigida la',
    getStarted: 'A daminɛ',
    
    // Categories
    plumbing: 'Ji baara',
    electrical: 'Kuran baara',
    construction: 'Jɔli',
    cleaning: 'Saniya',
    gardening: 'Nakɔ baara',
    tutoring: 'Kalan'
  }
};

export function LanguageProvider({ children }) {
  const [currentLanguage, setCurrentLanguage] = useState('fr');

  const t = (key) => {
    return translations[currentLanguage]?.[key] || key;
  };

  const changeLanguage = (lang) => {
    setCurrentLanguage(lang);
    localStorage.setItem('language', lang);
  };

  const value = {
    currentLanguage,
    changeLanguage,
    t
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}