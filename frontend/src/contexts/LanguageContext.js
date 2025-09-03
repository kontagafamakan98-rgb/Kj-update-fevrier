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
    tutoring: 'Tutorat',
    
    // Payments
    payment: 'Paiement',
    paymentMethods: 'Méthodes de paiement',
    bankCard: 'Carte bancaire',
    orangeMoney: 'Orange Money',
    wave: 'Wave',
    selectPayment: 'Sélectionner méthode de paiement',
    
    // Language Selection
    choosePreferredLanguage: 'Choisissez votre langue préférée',
    basedOnLocation: 'Basé sur votre position',
    languageNote: 'Note :',
    interfaceWillChange: 'L\'interface changera selon votre choix et cette langue s\'affichera sur votre profil.',
    localLanguage: 'Langue locale',
    selectedLanguage: 'Langue sélectionnée',
    interfaceAndProfileUpdated: 'Interface et profil mis à jour',
    aboutSelection: 'À propos de votre sélection :',
    interfaceWillChangeNote: 'L\'interface Kojo changera selon votre langue choisie',
    languageOnProfile: 'Votre langue apparaîtra sur votre profil public',
    clientsCanSee: 'Les clients pourront voir quelle langue vous parlez couramment',
    canModifyLater: 'Vous pourrez modifier ce choix plus tard dans vos paramètres',
    detectingLanguage: 'Détection de votre langue préférée...'
  },
  en: {
    // Navigation
    home: 'Home',
    jobs: 'Jobs',
    messages: 'Messages',
    profile: 'Profile',
    dashboard: 'Dashboard',
    login: 'Login',
    register: 'Sign Up',
    logout: 'Logout',
    
    // Common
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    submit: 'Submit',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    
    // Auth
    email: 'Email',
    password: 'Password',
    firstName: 'First Name',
    lastName: 'Last Name',
    phone: 'Phone',
    confirmPassword: 'Confirm Password',
    
    // User Types
    client: 'Client',
    worker: 'Worker',
    
    // Countries with flags
    mali: '🇲🇱 Mali',
    senegal: '🇸🇳 Senegal',
    burkina_faso: '🇧🇫 Burkina Faso',
    ivory_coast: '🇨🇮 Ivory Coast',
    
    // Job related
    jobTitle: 'Job Title',
    jobDescription: 'Description',
    budget: 'Budget',
    location: 'Location',
    category: 'Category',
    postJob: 'Post Job',
    applyJob: 'Apply',
    
    // Home page
    heroTitle: 'Connect Workers and Clients in Mali & Senegal',
    heroSubtitle: 'Find quality services or offer your skills in your area',
    getStarted: 'Get Started',
    
    // Categories
    plumbing: 'Plumbing',
    electrical: 'Electrical',
    construction: 'Construction',
    cleaning: 'Cleaning',
    gardening: 'Gardening',
    tutoring: 'Tutoring',
    
    // Payments
    payment: 'Payment',
    paymentMethods: 'Payment Methods',
    bankCard: 'Bank Card',
    orangeMoney: 'Orange Money',
    wave: 'Wave',
    selectPayment: 'Select payment method',
    
    // Language Selection
    choosePreferredLanguage: 'Choose your preferred language',
    basedOnLocation: 'Based on your location',
    languageNote: 'Note:',
    interfaceWillChange: 'The interface will change according to your choice and this language will appear on your profile.',
    localLanguage: 'Local language',
    selectedLanguage: 'Selected language',
    interfaceAndProfileUpdated: 'Interface and profile updated',
    aboutSelection: 'About your selection:',
    interfaceWillChangeNote: 'The Kojo interface will change according to your chosen language',
    languageOnProfile: 'Your language will appear on your public profile',
    clientsCanSee: 'Clients will be able to see which language you speak fluently',
    canModifyLater: 'You can modify this choice later in your settings',
    detectingLanguage: 'Detecting your preferred language...'
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
    
    // Countries with flags  
    mali: '🇲🇱 Mali',
    senegal: '🇸🇳 Senegaal',
    burkina_faso: '🇧🇫 Burkina Faso',
    ivory_coast: '🇨🇮 Côte d\'Ivoire',
    
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
    tutoring: 'Jàngale',
    
    // Payments
    payment: 'Fey',
    paymentMethods: 'Yoon yu fey',
    bankCard: 'Kart bank',
    orangeMoney: 'Orange Money',
    wave: 'Wave',
    selectPayment: 'Tànn fey'
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
    
    // Countries with flags
    mali: '🇲🇱 Mali', 
    senegal: '🇸🇳 Senegali',
    burkina_faso: '🇧🇫 Burkina Faso',
    ivory_coast: '🇨🇮 Côte d\'Ivoire',
    
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
    tutoring: 'Kalan',
    
    // Payments
    payment: 'Sara',
    paymentMethods: 'Sara fɛɛrɛw',
    bankCard: 'Bank karti',
    orangeMoney: 'Orange Money',
    wave: 'Wave',
    selectPayment: 'Sara fɛɛrɛ sugandi'
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