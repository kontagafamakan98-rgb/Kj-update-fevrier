import React, { createContext, useContext, useState } from 'react';
import { devLog, safeLog } from '../utils/env';

const LanguageContext = createContext();

export function useLanguage() {
  return useContext(LanguageContext);
}

const translations = {
  fr: {
    // Navigation
    home: 'Accueil',
    jobs: 'Emplois',
    
    // Job status translations
    open: 'Ouvert',
    inProgress: 'En cours',
    completed: 'Complété',
    cancelled: 'Annulé',
    
    // Job page descriptions
    manageJobOffers: 'Gérez vos offres d\'emploi et suivez les candidatures',
    discoverOpportunities: 'Découvrez des opportunités dans votre région',
    
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
    heroTitle: 'Connecter les travailleurs et clients en Afrique de l\'Ouest',
    heroSubtitle: 'Trouvez des services de qualité ou offrez vos compétences au Mali, Sénégal, Burkina Faso et Côte d\'Ivoire',
    getStarted: 'Commencer maintenant',
    viewJobs: 'Voir les emplois',
    myDashboard: 'Mon tableau de bord',
    
    // Countries section
    availableIn4Countries: 'Disponible dans 4 pays',
    kojoConnectsDescription: 'Kojo connecte les travailleurs et clients à travers l\'Afrique de l\'Ouest',
    servicesAvailable: 'Services disponibles',
    
    // Services section  
    popularServices: 'Services populaires',
    findServiceYouNeed: 'Trouvez le service dont vous avez besoin',
    
    // Features section
    findWork: 'Trouvez du travail',
    findWorkDescription: 'Découvrez des opportunités dans votre région et développez votre activité',
    connect: 'Connectez-vous',
    connectDescription: 'Échangez directement avec clients et travailleurs via notre messagerie',
    securePayments: 'Paiements sécurisés',
    securePaymentsDescription: 'Orange Money, Wave et autres méthodes de paiement intégrées',
    
    // Call to action
    joinThousands: 'Rejoignez des milliers d\'utilisateurs',
    startConnectingToday: 'Commencez dès aujourd\'hui à connecter avec des clients ou travailleurs qualifiés',
    lookingForServices: 'Je cherche des services',
    offerServices: 'Je propose mes services',
    
    // Stats section
    activeWorkers: 'Travailleurs actifs',
    completedProjects: 'Projets complétés', 
    countriesCovered: 'Pays couverts',
    customerSupport: 'Support client',
    
    // Dashboard section
    welcomeUser: 'Bienvenue,',
    manageProjectsClient: 'Gérez vos projets et trouvez des travailleurs qualifiés',
    discoverOpportunitiesWorker: 'Découvrez de nouvelles opportunités de travail',
    activeJobs: 'Jobs actifs',
    completedJobs: 'Jobs terminés',
    totalJobs: 'Total jobs',
    totalEarnings: 'Gains totaux',
    quickActions: 'Actions rapides',
    searchJobs: 'Chercher',
    workerProfile: 'Profil travailleur',
    languagesPayments: 'Langues & Paiements',
    publicFeature: 'Fonctionnalité publique',
    popularCategories: 'Catégories populaires',
    
    // Famakan section
    famakanAccess: 'Accès Famakan Kontaga Master',
    famakanDescription: 'Fonctionnalités réservées exclusivement au propriétaire de l\'application',
    testMobileFeatures: 'Test Fonctionnalités Mobile',
    createJobGPS: 'Créer Job avec GPS',
    debugPhotos: 'Debug Photos',
    commissionDashboard: 'Commission Dashboard',
    
    // Login/Register pages
    noAccount: 'Pas de compte ?',
    preferredLanguage: 'Langue préférée',
    verified: 'Vérifié',
    no: 'Non',
    
    // Photo upload section
    profilePhotoHelps: 'Une photo de profil aide à personnaliser votre expérience sur Kojo',
    professionalPhotoHelps: 'Une photo de profil professionnelle augmente la confiance des clients et améliore vos chances d\'être sélectionné',
    addProfilePhoto: 'Ajouter une photo de profil',
    clickToChoose: 'Cliquez pour choisir une option',
    tipsGoodPhoto: 'Conseils pour une bonne photo',
    useRecentPhoto: 'Utilisez une photo récente et claire',
    lookCamera: 'Regardez l\'objectif et souriez naturellement',
    avoidGroup: 'Évitez les photos de groupe ou avec des lunettes de soleil',
    neutralBackground: 'Un arrière-plan neutre est préférable',
    professionalOutfit: 'Une tenue professionnelle inspire confiance aux clients',
    upTo: 'jusqu\'à',
    
    // Country language preference messages
    maliLanguagePreference: 'Au Mali, la plupart des utilisateurs préfèrent le Français ou le Bambara',
    senegalLanguagePreference: 'Au Sénégal, la plupart des utilisateurs préfèrent le Français ou le Wolof',
    burkinaLanguagePreference: 'Au Burkina Faso, la plupart des utilisateurs préfèrent le Français ou le Mooré',
    ivoryCoastLanguagePreference: 'En Côte d\'Ivoire, la plupart des utilisateurs préfèrent le Français',
    
    // Payment accounts section
    minimumRequired: 'Minimum requis',
    accountRequired: 'compte (pour effectuer les paiements)',
    accountsLinked: 'comptes liés',
    modify: 'Modifier',
    
    // Geolocation messages
    ivoryCoastPreference: 'En Côte d\'Ivoire, la plupart des utilisateurs préfèrent le Français',
    
    // Payment verification page
    paymentVerification: 'Vérification des Comptes de Paiement',
    lastStep: 'Dernière étape',
    linkAccountsToComplete: 'Pour finaliser votre inscription, vous devez lier vos comptes de paiement',
    workerPaymentRequirement: 'En tant que travailleur, vous devez lier au minimum 2 moyens de paiement pour recevoir vos paiements des clients',
    clientPaymentRequirement: 'En tant que client, vous devez lier au moins 1 moyen de paiement pour effectuer vos paiements aux travailleurs',
    paymentAccountsUpdated: 'Comptes de paiement mis à jour avec succès',
    paymentAccountsLoadError: 'Erreur lors du chargement des comptes de paiement',
    
    // Jobs page
    allCategories: 'Toutes les catégories',
    allStatuses: 'Tous les statuts',
    search: 'Rechercher',
    reset: 'Réinitialiser',
    noJobsFound: 'Aucun emploi trouvé',
    publishFirstJob: 'Commencez par publier votre premier emploi',
    myJobs: 'Mes emplois',
    availableJobs: 'Emplois disponibles',
    
    // Messages page
    noConversations: 'Aucune conversation',
    startApplyingJobs: 'Commencez à postuler à des emplois',
    selectConversation: 'Sélectionnez une conversation pour commencer',
    
    // Categories
    plumbing: 'Plomberie',
    electrical: 'Électricité',
    construction: 'Construction',
    cleaning: 'Nettoyage',
    gardening: 'Jardinage',
    tutoring: 'Tutorat',
    mechanics: 'Mécanique',
    computing: 'Informatique',
    
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
    detectingLanguage: 'Détection de votre langue préférée...',
    
    // Registration
    createAccount: 'Créer un compte',
    joinKojoCommunity: 'Rejoignez la communauté Kojo',
    
    // Professional Skills
    professionalInformationWorker: 'Informations Professionnelles (Travailleur)',
    skillsAndSpecialties: 'Compétences et Spécialités',
    selectedSkills: 'Vos compétences sélectionnées :',
    addCustomSkill: 'Ajouter une compétence personnalisée',
    customSkillPlaceholder: 'Votre compétence personnalisée',
    add: 'Ajouter',
    yearsExperience: 'Années d\'expérience',
    selectExperience: 'Sélectionnez votre expérience',
    beginner: 'Débutant (0-1 an)',

    rateExamples: 'Exemples de tarifs par heure :',
    profileInfoNote: 'Ces informations apparaîtront sur votre profil public',
    
    // Profile Photo Upload
    profilePhotoOptional: 'Photo de Profil (Optionnel)',
    addPhoto: 'Ajouter une photo',
    clickToChooseOption: 'Cliquez pour choisir une option',
    chooseFromGallery: 'Choisir depuis la galerie',
    selectExistingPhoto: 'Sélectionner une photo existante',
    takePhoto: 'Prendre une photo',
    useCamera: 'Utiliser l\'appareil photo',
    back: 'Retour',
    changePhoto: 'Changer la photo',
    gallery: 'Galerie',
    camera: 'Caméra',
    photoReadyForRegistration: 'Photo prête pour l\'inscription',
    remove: 'Supprimer',
    pleaseSelectImage: 'Veuillez sélectionner une image (JPG, PNG, etc.)',
    imageTooLarge: 'L\'image doit faire moins de 5MB',
    errorReadingFile: 'Erreur lors de la lecture du fichier',
    photoUploadedSuccessfully: 'Photo de profil mise à jour avec succès !',
    
    // Network Status
    networkOffline: 'Vous êtes hors ligne. Certaines fonctionnalités peuvent être limitées.',
    networkPoor: 'Connexion lente détectée. Optimisation automatique activée.',
    networkModerate: 'Connexion modérée. Économie de données activée.',
    networkGood: 'Bonne connexion',
    networkExcellent: 'Excellente connexion',
    networkUnknown: 'État du réseau inconnu',
    networkTipsOffline: '• Les actions seront synchronisées au retour de la connexion\n• Les données en cache restent disponibles',
    networkTipsPoor: '• Images optimisées pour économiser la bande passante\n• Fonctionnalités temps-réel désactivées\n• Cache étendu pour éviter les rechargements',
    networkTipsModerate: '• Qualité des images réduite\n• Synchronisation moins fréquente\n• Priorité aux fonctionnalités essentielles',
    userType: 'Type d\'utilisateur',
    iAmClient: 'Je cherche des services',
    iAmWorker: 'Je propose mes services',
    country: 'Pays',
    detectedAutomatically: 'Détecté automatiquement',
    positionDetected: 'Position détectée',
    adjustedAutomatically: 'Exemples et informations ajustés automatiquement',
    positionNotDetected: 'Position non détectée - Utilisation des paramètres par défaut (Sénégal)',
    personalInformation: 'Informations personnelles',
    paymentAccounts: 'Comptes de paiement',
    nextStepWorker: 'Prochaine étape : Vous devrez lier au minimum 2 moyens de paiement (Orange Money, Wave, Compte bancaire)',
    nextStepClient: 'Prochaine étape : Vous devrez lier au moins 1 moyen de paiement (Orange Money, Wave, Compte bancaire)',
    continueToPaymentVerification: 'Continuer → Vérification des comptes',
    detectingLocation: 'Détection de votre position...',
    detectedViaGeolocation: 'Pays détecté via votre localisation géographique',
    atLeast6Characters: 'Au moins 6 caractères',
    phoneFormat: 'Format',
    passwordsDontMatch: 'Les mots de passe ne correspondent pas',
    passwordTooShort: 'Le mot de passe doit contenir au moins 6 caractères',
    workersMustSelectSkills: 'Les travailleurs doivent sélectionner au moins une compétence',
    pleaseIndicateExperience: 'Veuillez indiquer vos années d\'expérience',

    preparing: 'Préparation...',
    alreadyHaveAccount: 'Déjà un compte?',
    signIn: 'Se connecter'
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
    heroTitle: 'Connect Workers and Clients in West Africa',
    heroSubtitle: 'Find quality services or offer your skills in Mali, Senegal, Burkina Faso and Ivory Coast',
    getStarted: 'Get Started Now',
    viewJobs: 'View Jobs',
    myDashboard: 'My Dashboard',
    
    // Countries section
    availableIn4Countries: 'Available in 4 countries',
    kojoConnectsDescription: 'Kojo connects workers and clients across West Africa',
    servicesAvailable: 'Services available',
    
    // Services section  
    popularServices: 'Popular Services',
    findServiceYouNeed: 'Find the service you need',
    
    // Features section
    findWork: 'Find Work',
    findWorkDescription: 'Discover opportunities in your area and grow your business',
    connect: 'Connect',
    connectDescription: 'Chat directly with clients and workers through our messaging system',
    securePayments: 'Secure Payments',
    securePaymentsDescription: 'Orange Money, Wave and other integrated payment methods',
    
    // Call to action
    joinThousands: 'Join thousands of users',
    startConnectingToday: 'Start connecting with qualified clients or workers today',
    lookingForServices: 'I am looking for services',
    offerServices: 'I offer my services',
    
    // Stats section
    activeWorkers: 'Active Workers',
    completedProjects: 'Completed Projects', 
    countriesCovered: 'Countries Covered',
    customerSupport: 'Customer Support',
    
    // Dashboard section
    welcomeUser: 'Welcome,',
    manageProjectsClient: 'Manage your projects and find qualified workers',
    discoverOpportunitiesWorker: 'Discover new work opportunities',
    activeJobs: 'Active Jobs',
    completedJobs: 'Completed Jobs',
    totalJobs: 'Total Jobs',
    totalEarnings: 'Total Earnings',
    quickActions: 'Quick Actions',
    searchJobs: 'Search',
    workerProfile: 'Worker Profile',
    languagesPayments: 'Languages & Payments',
    publicFeature: 'Public feature',
    popularCategories: 'Popular Categories',
    
    // Famakan section
    famakanAccess: 'Famakan Kontaga Master Access',
    famakanDescription: 'Features reserved exclusively for the application owner',
    testMobileFeatures: 'Test Mobile Features',
    createJobGPS: 'Create Job with GPS',
    debugPhotos: 'Debug Photos',
    commissionDashboard: 'Commission Dashboard',
    
    // Login/Register pages
    noAccount: 'No account?',
    personalInformation: 'Personal Information',
    paymentAccounts: 'Payment Accounts',
    preferredLanguage: 'Preferred Language',
    verified: 'Verified',
    no: 'No',
    
    // Photo upload section
    profilePhotoHelps: 'A profile photo helps personalize your experience on Kojo',
    professionalPhotoHelps: 'A professional profile photo increases client confidence and improves your chances of being selected',
    addProfilePhoto: 'Add a profile photo',
    addPhoto: 'Add a photo',
    changePhoto: 'Change photo',
    clickToChoose: 'Click to choose an option',
    tipsGoodPhoto: 'Tips for a good photo',
    useRecentPhoto: 'Use a recent and clear photo',
    lookCamera: 'Look at the camera and smile naturally',
    avoidGroup: 'Avoid group photos or sunglasses',
    neutralBackground: 'A neutral background is preferable',
    professionalOutfit: 'Professional attire inspires client confidence',
    
    // Country language preference messages
    maliLanguagePreference: 'In Mali, most users prefer French or Bambara',
    senegalLanguagePreference: 'In Senegal, most users prefer French or Wolof',
    burkinaLanguagePreference: 'In Burkina Faso, most users prefer French or Mooré',
    ivoryCoastLanguagePreference: 'In Ivory Coast, most users prefer French',
    
    // Payment accounts section
    minimumRequired: 'Minimum required',
    accountRequired: 'account (to make payments)',
    accountsLinked: 'accounts linked',
    modify: 'Edit',
    
    // Geolocation messages
    ivoryCoastPreference: 'In Ivory Coast, most users prefer French',
    
    // Payment verification page
    paymentVerification: 'Payment Account Verification',
    lastStep: 'Final step',
    linkAccountsToComplete: 'To complete your registration, you must link your payment accounts',
    workerPaymentRequirement: 'As a worker, you must link at least 2 payment methods to receive payments from clients',
    clientPaymentRequirement: 'As a client, you must link at least 1 payment method to make payments to workers',
    paymentAccountsUpdated: 'Payment accounts updated successfully',
    paymentAccountsLoadError: 'Error loading payment accounts',
    
    // Jobs page
    allCategories: 'All Categories',
    allStatuses: 'All Statuses',
    search: 'Search',
    reset: 'Reset',
    noJobsFound: 'No jobs found',
    publishFirstJob: 'Start by publishing your first job',
    myJobs: 'My Jobs',
    
    // Job status translations
    open: 'Open',
    inProgress: 'In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
    
    // Job page descriptions
    manageJobOffers: 'Manage your job offers and track applications',
    discoverOpportunities: 'Discover opportunities in your area',
    
    availableJobs: 'Available Jobs',
    
    // Messages page
    noConversations: 'No conversations',
    startApplyingJobs: 'Start applying to jobs',
    selectConversation: 'Select a conversation to start',
    
    // Categories
    plumbing: 'Plumbing',
    electrical: 'Electrical',
    construction: 'Construction',
    cleaning: 'Cleaning',
    gardening: 'Gardening',
    tutoring: 'Tutoring',
    mechanics: 'Mechanics',
    computing: 'Computing',
    
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
    detectingLanguage: 'Detecting your preferred language...',
    
    // Registration
    createAccount: 'Create Account',
    joinKojoCommunity: 'Join the Kojo community',
    
    // Professional Skills
    professionalInformationWorker: 'Professional Information (Worker)',
    skillsAndSpecialties: 'Skills and Specialties',
    selectedSkills: 'Your selected skills:',
    addCustomSkill: 'Add custom skill',
    customSkillPlaceholder: 'Your custom skill',
    add: 'Add',
    yearsExperience: 'Years of experience',
    selectExperience: 'Select your experience',
    beginner: 'Beginner (0-1 year)',
    hourlyRate: 'Hourly rate (FCFA)',
    rateExamples: 'Hourly rate examples:',
    profileInfoNote: 'This information will appear on your public profile',
    
    // Profile Photo Upload
    profilePhotoOptional: 'Profile Photo (Optional)',
    clickToChooseOption: 'Click to choose an option',
    chooseFromGallery: 'Choose from gallery',
    selectExistingPhoto: 'Select an existing photo',
    takePhoto: 'Take a photo',
    useCamera: 'Use camera',
    back: 'Back',
    gallery: 'Gallery',
    camera: 'Camera',
    photoReadyForRegistration: 'Photo ready for registration',
    remove: 'Remove',
    pleaseSelectImage: 'Please select an image (JPG, PNG, etc.)',
    imageTooLarge: 'Image must be less than 5MB',
    errorReadingFile: 'Error reading file',
    
    // Network Status
    networkOffline: 'You are offline. Some features may be limited.',
    networkPoor: 'Slow connection detected. Automatic optimization activated.',
    networkModerate: 'Moderate connection. Data saving activated.',
    networkGood: 'Good connection',
    networkExcellent: 'Excellent connection',
    networkUnknown: 'Network status unknown',
    networkTipsOffline: '• Actions will sync when connection returns\n• Cached data remains available',
    networkTipsPoor: '• Images optimized to save bandwidth\n• Real-time features disabled\n• Extended cache to avoid reloads',
    networkTipsModerate: '• Reduced image quality\n• Less frequent synchronization\n• Priority to essential features',
    userType: 'User Type',
    iAmClient: 'I am looking for services',
    iAmWorker: 'I offer my services',
    country: 'Country',
    detectedAutomatically: 'Detected automatically',
    positionDetected: 'Position detected',
    adjustedAutomatically: 'Examples and information adjusted automatically',
    positionNotDetected: 'Position not detected - Using default settings (Senegal)',
    nextStepWorker: 'Next step: You must link at least 2 payment methods (Orange Money, Wave, Bank account)',
    nextStepClient: 'Next step: You must link at least 1 payment method (Orange Money, Wave, Bank account)',
    continueToPaymentVerification: 'Continue → Account verification',
    detectingLocation: 'Detecting your location...',
    detectedViaGeolocation: 'Country detected via your geographic location',
    atLeast6Characters: 'At least 6 characters',
    phoneFormat: 'Format',
    passwordsDontMatch: 'Passwords do not match',
    passwordTooShort: 'Password must contain at least 6 characters',
    workersMustSelectSkills: 'Workers must select at least one skill',
    pleaseIndicateExperience: 'Please indicate your years of experience',
    pleaseIndicateValidRate: 'Please indicate a valid hourly rate (minimum 500 FCFA)',
    preparing: 'Preparing...',
    alreadyHaveAccount: 'Already have an account?',
    signIn: 'Sign In'
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
    heroTitle: 'Jëmmel liggéeykat ak kliyan ci Afrik bu Sowwu',
    heroSubtitle: 'Wut sëriñ yu baax wala fekkali sa xel-xel ci Mali, Senegaal, Burkina Faso ak Côte d\'Ivoire',
    getStarted: 'Tambali leegi',
    viewJobs: 'Gis liggéey yi',
    myDashboard: 'Sama wàllu liggéey',
    
    // Countries section
    availableIn4Countries: 'Am ci ñent réew',
    kojoConnectsDescription: 'Kojo dafa jëmmal liggéeykat ak kliyan ci Afrik bu Sowwu',
    servicesAvailable: 'Sëriñ yi am',
    
    // Services section  
    popularServices: 'Sëriñ yu bari',
    findServiceYouNeed: 'Soxla sëriñ bu nga bëgg',
    
    // Features section
    findWork: 'Soxla liggéey',
    findWorkDescription: 'Gis tey yu am ci sa cornur te yaatu sa liggéey',
    connect: 'Jëmme',
    connectDescription: 'Waxtaan ak kliyan ak liggéeykat ci bataaxal bu ñu',
    securePayments: 'Fey yu suur',
    securePaymentsDescription: 'Orange Money, Wave ak yeneen yoon yu fey yi',
    
    // Call to action
    joinThousands: 'Bokk ak junni yu am',
    startConnectingToday: 'Tàmbal leegi ak kliyan wala liggéeykat yu gëna baax',
    lookingForServices: 'Dama soxla sëriñ yi',
    offerServices: 'Dama def sëriñ',
    
    // Stats section
    activeWorkers: 'Liggéeykat yu liggéey',
    completedProjects: 'Projet yi jeex', 
    countriesCovered: 'Réew yi daję',
    customerSupport: 'Ndimbal kliyan',
    
    // Dashboard section
    welcomeUser: 'Dalal ak jamm,',
    manageProjectsClient: 'Yëgle sa projet yi te soxla liggéeykat yu gëna baax',
    discoverOpportunitiesWorker: 'Soxla tey yu bees ci liggéey',
    activeJobs: 'Liggéey yu liggéey',
    completedJobs: 'Liggéey yi jeex',
    totalJobs: 'Liggéey yépp',
    totalEarnings: 'Àrte yépp',
    quickActions: 'Jëf yu gaaw',
    searchJobs: 'Soxla',
    workerProfile: 'Liggéeykat am',
    languagesPayments: 'Làkk ak fey',
    publicFeature: 'Jëfandikoo ak këpp',
    popularCategories: 'Xët yu bari',
    
    // Famakan section
    famakanAccess: 'Moom Famakan Kontaga Master',
    famakanDescription: 'Jëfandikoo ku boole aplikaasio bi moom rekk',
    testMobileFeatures: 'Seet jëfandikoo telefon',
    createJobGPS: 'Sos liggéey ak GPS',
    debugPhotos: 'Xalaat nataal yi',
    commissionDashboard: 'Wàllu komisio',
    
    // Login/Register pages
    noAccount: 'Amul konte?',
    personalInformation: 'Xet yu boole',
    paymentAccounts: 'Konte fey',
    preferredLanguage: 'Làkk bu baax',
    verified: 'Xalaat na',
    no: 'Déédéet',
    
    // Photo upload section
    profilePhotoHelps: 'Nataal bu profil dafa ñu ko def ngir am nataal bu boole ci Kojo',
    professionalPhotoHelps: 'Nataal bu profil bu liggéeykat bi dafa yaqu kliyan yi te yaatu sa tànn',
    addProfilePhoto: 'Yokk nataal bu profil',
    addPhoto: 'Yokk nataal',
    changePhoto: 'Soppi nataal',
    clickToChoose: 'Bësal ngir tànn',
    tipsGoodPhoto: 'Làaj yu baax ngir nataal bu baax',
    useRecentPhoto: 'Jëfandikoo nataal bu bees te mu gëna baax',
    lookCamera: 'Gis kameraw bi te bës',
    avoidGroup: 'Ñaanal nataal yu bari wala ak lunettes soleil',
    neutralBackground: 'Ginaw bu dëgg la gëna baax',
    professionalOutfit: 'Yéré bu baax jox kliyan yi cofeel',
    
    // Country language preference messages
    maliLanguagePreference: 'Ci Mali, nit ñu bari gëna bëgg Français wala Bambara',
    senegalLanguagePreference: 'Ci Senegaal, nit ñu bari gëna bëgg Français wala Wolof',
    burkinaLanguagePreference: 'Ci Burkina Faso, nit ñu bari gëna bëgg Français wala Mooré',
    ivoryCoastLanguagePreference: 'Ci Côte d\'Ivoire, nit ñu bari gëna bëgg Français',
    
    // Payment accounts section
    minimumRequired: 'Minimum yu bëgg',
    accountRequired: 'konte (ngir fey)',
    accountsLinked: 'konte yu jëmme',
    modify: 'Soppi',
    
    // Geolocation messages
    ivoryCoastPreference: 'Ci Côte d\'Ivoire, lu bare ci jëfandikukat yi dañu bëgg Farañse',
    
    // Payment verification page
    paymentVerification: 'Xalatug konte fey',
    lastStep: 'Jëru bu mujj',
    linkAccountsToComplete: 'Ngir jeexal sa tànn, war nga jëmmal sa konte fey yi',
    workerPaymentRequirement: 'Ci liggéeykat bi, war nga jëmmal 2 njariñ fey ngir àmm sa xaalis ci kliyan yi',
    clientPaymentRequirement: 'Ci kliyan bi, war nga jëmmal 1 njariñ fey ngir fey liggéeykat yi',
    
    // Jobs page
    allCategories: 'Wàcc yépp',
    allStatuses: 'Sigida yépp',
    search: 'Soxla',
    reset: 'Delloo',
    noJobsFound: 'Liggéey amul',
    publishFirstJob: 'Tàmbal ak sa liggéey bu njëkk',
    myJobs: 'Sama liggéey',
    availableJobs: 'Liggéey yu am',
    
    // Job status translations
    open: 'Ubbi',
    inProgress: 'Ci liggéey',
    completed: 'Jeex na',
    cancelled: 'Neebal',
    
    // Job page descriptions
    manageJobOffers: 'Yëgle sa liggéey yi te suqali yeneen',
    discoverOpportunities: 'Soxla tey yu am ci sa cornur',
    
    // Messages page
    noConversations: 'Waxtaan amul',
    startApplyingJobs: 'Tàmbal ak dàgg-dàgg ci liggéey yi',
    selectConversation: 'Tànn waxtaan ngir tàmbal',
    
    // Categories
    plumbing: 'Ndox',
    electrical: 'Mbër',
    construction: 'Jëf-jëf',
    cleaning: 'Set',
    gardening: 'Jàng',
    tutoring: 'Jàngale',
    mechanics: 'Màkina',
    computing: 'Ordinatër',
    
    // Payments
    payment: 'Fey',
    paymentMethods: 'Yoon yu fey',
    bankCard: 'Kart bank',
    orangeMoney: 'Orange Money',
    wave: 'Wave',
    selectPayment: 'Tànn fey',
    
    // Language Selection
    choosePreferredLanguage: 'Tann sa làkk bu baax',
    basedOnLocation: 'Ci sa bàcc mi',
    languageNote: 'Teerukaay:',
    interfaceWillChange: 'Interface bi dina soppi ak sa tann ak làkk bii dina mel ci sa profil.',
    localLanguage: 'Làkk bu dekk bi',
    selectedLanguage: 'Làkk bu tann',
    interfaceAndProfileUpdated: 'Interface ak profil yi soppi na',
    aboutSelection: 'Ci sa tann bi:',
    interfaceWillChangeNote: 'Interface Kojo bi dina soppi ak sa làkk',
    languageOnProfile: 'Sa làkk dina mel ci sa profil bu xam',
    clientsCanSee: 'Kiliyaan yi man na ko xam làkk bu nga xam',
    canModifyLater: 'Man nga ko soppi ci sa paramètres yi',
    detectingLanguage: 'Daa ngi gis sa làkk...',
    
    // Registration  
    createAccount: 'Dund konte',
    joinKojoCommunity: 'Bokk ci jammiit Kojo',
    
    // Professional Skills
    professionalInformationWorker: 'Xet yu liggéey (Liggéeykat)',
    skillsAndSpecialties: 'Xel-xel ak mbind',
    selectedSkills: 'Sa xel-xel yu tànn:',
    addCustomSkill: 'Yokk xel-xel bu bees',
    customSkillPlaceholder: 'Sa xel-xel bu bees',
    add: 'Yokk',
    yearsExperience: 'At yu liggéey',
    selectExperience: 'Tànn sa liggéey',
    beginner: 'Tambali (0-1 at)',
    hourlyRate: 'Njëkk waxtu (FCFA)',
    rateExamples: 'Misaal njëkk waxtu:',
    profileInfoNote: 'Xet yii dina mel ci sa profil bu xam',
    
    // Profile Photo Upload
    profilePhotoOptional: 'Nataal profil (Bu bëgg nga)',
    clickToChooseOption: 'Bët ngir tànn benn yoon',
    chooseFromGallery: 'Tànn ci galeri',
    selectExistingPhoto: 'Tànn nataal bu am',
    takePhoto: 'Jëm nataal',
    useCamera: 'Jëfandikoo kamera',
    back: 'Dellu',
    gallery: 'Galeri',
    camera: 'Kamera',
    photoReadyForRegistration: 'Nataal bi pare na ngir bind ak tëdd',
    remove: 'Dindi',
    pleaseSelectImage: 'Tànn nataal (JPG, PNG, etc.)',
    imageTooLarge: 'Nataal bi gëna am 5MB',
    errorReadingFile: 'Njub ci jàngi file bi',
    
    // Network Status
    networkOffline: 'Amul conexion. Yeneen yëf yi man na ñu gëna yàqu.',
    networkPoor: 'Conexion bu gëna yàq la gis. Optimization otomatik la ñu def.',
    networkModerate: 'Conexion bu tolluma la. Natangoo donne yi la ñu def.',
    networkGood: 'Conexion bu baax',
    networkExcellent: 'Conexion bu gëna baax',
    networkUnknown: 'Conexion bi xam ko wuul',
    networkTipsOffline: '• Liggéey yi dinañu defar ngir conexion bi delloo\n• Donne yi ci cache yi dañuy am',
    networkTipsPoor: '• Nataal yi optimisé na ngir gërëm bande passante\n• Fonctions temps-réel yi dañuy taxaw\n• Cache bu yàq na ngir wareesul rechargement',
    networkTipsModerate: '• Nataal yi gëna yàq na\n• Synchronisation mu gëna yàq\n• Priorité ci fonctions essentiels yi',
    userType: 'Sugu jëfkoykat',
    iAmClient: 'Dama soxla sëriñ yi',
    iAmWorker: 'Dama def liggéey',
    country: 'Réew',
    detectedAutomatically: 'Giss na otomatig',
    positionDetected: 'Bër bi giss na',
    adjustedAutomatically: 'Misaal ak xet yi soppi nañu otomatig',
    positionNotDetected: 'Bër bi gissul - Jëfandikoo paramètres yu defar (Senegaal)',
    nextStepWorker: 'Xànti bu dekk: Banga jëmm benn ñaar ay yoon yu fey (Orange Money, Wave, Konte bank)',
    nextStepClient: 'Xànti bu dekk: Banga jëmm benn yoon yu fey (Orange Money, Wave, Konte bank)',
    continueToPaymentVerification: 'Taax → Kontròol konte yi',
    detectingLocation: 'Daa ngi gis sa bër...',
    detectedViaGeolocation: 'Réew bi giss na ci sa bër',
    atLeast6Characters: 'Tang benn juude-kronni',
    phoneFormat: 'Muj',
    passwordsDontMatch: 'Kóod yu dugub yi beneen na',
    passwordTooShort: 'Kóodu dugub bi war na tang benn juude-kronni',
    workersMustSelectSkills: 'Liggéeykat yi war na tànn benn xel-xel',
    pleaseIndicateExperience: 'Wadal sa at yu liggéey',
    pleaseIndicateValidRate: 'Wadal njëkk waxtu bu bax (minimum 500 FCFA)',
    preparing: 'Daa ngi yeggal...',
    alreadyHaveAccount: 'Am nga konte?',
    signIn: 'Dugg'
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
    heroTitle: 'Baarakɛlaw ni kiliyanw jɛɲɔgɔnya Afiriki Kɔrɔn fɛ',
    heroSubtitle: 'Baara ɲuman sɔrɔ walima i ka seko di Mali, Senegali, Burkina Faso ani Côte d\'Ivoire',
    getStarted: 'A daminɛ sisan',
    viewJobs: 'Baara filɛ',
    myDashboard: 'N ka baara yɔrɔ',
    
    // Countries section
    availableIn4Countries: 'A bɛ jamana naani kɔnɔ',
    kojoConnectsDescription: 'Kojo bɛ baarakɛlaw ni kiliyanw jɛɲɔgɔnya Afiriki Kɔrɔn fɛ',
    servicesAvailable: 'Baara minnu bɛ yen',
    
    // Services section  
    popularServices: 'Baara dilenw',
    findServiceYouNeed: 'I mako baara ɲinini',
    
    // Features section
    findWork: 'Baara ɲinini',
    findWorkDescription: 'I sigida kɔnɔ cogo ɲumanw ɲinini ani i ka baara yiriwali',
    connect: 'Jɛɲɔgɔnya',
    connectDescription: 'Kiliyanw ni baarakɛlaw ka kumaɲɔgɔnya an ka cikan sira la',
    securePayments: 'Sara lakananen',
    securePaymentsDescription: 'Orange Money, Wave ani sara fɛɛrɛ wɛrɛw',
    
    // Call to action
    joinThousands: 'Don ba caman hakɛ',
    startConnectingToday: 'Bi daminɛ ka jɛɲɔgɔnya da kiliyan walima baarakɛla ɲumanw ma',
    lookingForServices: 'N bɛ baara ɲinini',
    offerServices: 'N bɛ baara di',
    
    // Stats section
    activeWorkers: 'Baarakɛla baarakɛlaw',
    completedProjects: 'Porozɛ dafalen', 
    countriesCovered: 'Jamana minnu kɔrɔ',
    customerSupport: 'Kiliyan dɛmɛni',
    
    // Dashboard section
    welcomeUser: 'I ni ce,',
    manageProjectsClient: 'I ka porozɛw ɲɛmɔgɔya ani baarakɛla ɲumanw ɲinini',
    discoverOpportunitiesWorker: 'Baara kura cogo ɲumanw ɲinini',
    activeJobs: 'Baara baarakɛlaw',
    completedJobs: 'Baara dafalen',
    totalJobs: 'Baara bɛɛ',
    totalEarnings: 'Sara bɛɛ',
    quickActions: 'Ɲɛmɔgɔya teliya',
    searchJobs: 'Ɲinini',
    workerProfile: 'Baarakɛla ka kunnafoni',
    languagesPayments: 'Kan ni sara',
    publicFeature: 'Foroba ka fɛɛrɛ',
    popularCategories: 'Sugu dilennw',
    
    // Famakan section
    famakanAccess: 'Famakan Kontaga Master ka sira',
    famakanDescription: 'Fɛɛrɛw minnu bɛ aplikasiyon tigi ye dɔrɔn',
    testMobileFeatures: 'Telefɔni ka fɛɛrɛw kɔrɔsi',
    createJobGPS: 'Baara da GPS fɛ',
    debugPhotos: 'Foto ɲɛnabɔli',
    commissionDashboard: 'Komiisiyon ka jago',
    
    // Login/Register pages
    noAccount: 'Jatebɔsɛbɛn tɛ?',
    personalInformation: 'Mɔgɔ yɛrɛ ka kunnafoniw',
    paymentAccounts: 'Saraku jatebɔsɛbɛnw',
    preferredLanguage: 'Kan dilenna',
    verified: 'A tiɲɛna',
    no: 'Ayi',
    
    // Photo upload section
    profilePhotoHelps: 'Profil ja bɛ dɛmɛ ka i ka ko kɛcogo ɲɛ Kojo kan',
    professionalPhotoHelps: 'Profil ja ɲuman bɛ kiliyanw ka dannaya yiriwa ani i ka sugandi cogoya ɲɛ',
    addProfilePhoto: 'Profil ja fara a kan',
    addPhoto: 'Ja fara a kan',
    changePhoto: 'Ja yɛlɛma',
    clickToChoose: 'Kliki walasa ka fɛɛrɛ dɔ sugandi',
    tipsGoodPhoto: 'Ja ɲuman kɛcogo',
    useRecentPhoto: 'Ja kɔrɔ ani jɛlen baara kɛ',
    lookCamera: 'Kameraw lajɛ ani nisɔndiya ɲuman kɛ',
    avoidGroup: 'Jama ja walima finitigiw ja tɛmɛ',
    neutralBackground: 'Kɔfɛ jɛlen ka ɲi',
    professionalOutfit: 'Baara fini ɲuman bɛ kiliyanw la danaya sabati',
    
    // Country language preference messages
    maliLanguagePreference: 'Mali kɔnɔ, mɔgɔ caman ka Faransikan walima Bamanankan fɛ',
    senegalLanguagePreference: 'Senegali kɔnɔ, mɔgɔ caman ka Faransikan walima Wolof fɛ',
    burkinaLanguagePreference: 'Burkina Faso kɔnɔ, mɔgɔ caman ka Faransikan walima Mooré fɛ',
    ivoryCoastLanguagePreference: 'Côte d\'Ivoire kɔnɔ, mɔgɔ caman ka Faransikan fɛ',
    
    // Payment accounts section
    minimumRequired: 'Minimum min mako',
    accountRequired: 'jatebɔsɛbɛn (walasa ka sara kɛ)',
    accountsLinked: 'jatebɔsɛbɛn minnu jɛmalen don',
    modify: 'Yɛlɛma',
    
    // Geolocationments
    ivoryCoastPreference: 'Côte d\'Ivoire, baara kɛla fanba bɛ Faransikan diya',
    
    // Payment verification page
    paymentVerification: 'Saraku jatebɔsɛbɛnw kɔlɔsi',
    lastStep: 'Laban laban',
    linkAccountsToComplete: 'Walasa ka i ka tɔgɔsɛbɛnni ban, i ka kan ka saraku jatebɔsɛbɛnw jɛmɛ',
    workerPaymentRequirement: 'I ni baarakɛla ye, i ka kan ka saraku fɛɛrɛ fila jɛmɛ walasa ka saraku sɔrɔ kiliyanw fɛ',
    clientPaymentRequirement: 'Ci kliyan bi, war nga jëmmal 1 njariñ fey ngir fey liggéeykat yi',
    paymentAccountsUpdated: 'Konte fey yi ñu leen soppi ak réussite',
    paymentAccountsLoadError: 'Fii am ci yeb konte fey yi',
    
    // Jobs page
    allCategories: 'Sugu bɛɛ',
    allStatuses: 'Sigida bɛɛ',
    search: 'Ɲinini',
    reset: 'Kɔrɔsi',
    noJobsFound: 'Baara si tɛ',
    publishFirstJob: 'I ka baara fɔlɔ labɛn',
    myJobs: 'N ka baaraw',
    availableJobs: 'Baara minnu bɛ yen',
    
    // Job status translations
    open: 'Da wuli',
    inProgress: 'Ka kɛ',
    completed: 'A ban',
    cancelled: 'A bɔra',
    
    // Job page descriptions
    manageJobOffers: 'I ka baara dila ɲɛmɔgɔya ani kandidaw nɔfɛ',
    discoverOpportunities: 'I ka sigida kɔnɔ cogo ɲumanw ɲinini',
    
    // Messages page
    noConversations: 'Kumaɲɔgɔnya tɛ',
    startApplyingJobs: 'Baara ɲinini daminɛ',
    selectConversation: 'Kumaɲɔgɔnya dɔ sugandi walasa ka daminɛ',
    
    // Categories
    plumbing: 'Ji baara',
    electrical: 'Kuran baara',
    construction: 'Jɔli',
    cleaning: 'Saniya',
    gardening: 'Nakɔ baara',
    tutoring: 'Kalan',
    mechanics: 'Mɔbili baara',
    computing: 'Ɔridinatɛri baara',
    
    // Payments
    payment: 'Sara',
    paymentMethods: 'Sara fɛɛrɛw',
    bankCard: 'Bank karti',
    orangeMoney: 'Orange Money',
    wave: 'Wave',
    selectPayment: 'Sara fɛɛrɛ sugandi',
    
    // Language Selection
    choosePreferredLanguage: 'I ka kan diya sugandi',
    basedOnLocation: 'I sigiyɔrɔ kɔrɔ',
    languageNote: 'Kɔlɔsili:',
    interfaceWillChange: 'Interface bɛ na ka Changé i ka sugandili kɔrɔ ani nin kan bɛ na jira i ka profil la.',
    localLanguage: 'Sigida kan',
    selectedLanguage: 'Kan sugandilen',
    interfaceAndProfileUpdated: 'Interface ni profil changéra',
    aboutSelection: 'I ka sugandili kan:',
    interfaceWillChangeNote: 'Kojo interface bɛ na changé i ka kan sugandilen fɛ',
    languageOnProfile: 'I ka kan bɛ na jira i ka profil foroba la',
    clientsCanSee: 'Kiliyanw bɛ se ka a dɔn i bɛ kan min fɔ',
    canModifyLater: 'I bɛ se ka nin changé kɔfɛ i ka paramètres kɔnɔ',
    detectingLanguage: 'Ka i ka kan diya ɲinini...',
    
    // Registration
    createAccount: 'Konte dilan',
    joinKojoCommunity: 'Don Kojo jamana kɔnɔ',
    
    // Professional Skills
    professionalInformationWorker: 'Baarakɛla kunnafoni (Baarakɛla)',
    skillsAndSpecialties: 'Seko ni dɔnkilidaw',
    selectedSkills: 'I ka seko sugandilen:',
    addCustomSkill: 'Seko kɛrɛnkɛrɛnnen fara a kan',
    customSkillPlaceholder: 'I ka seko kɛrɛnkɛrɛnnen',
    add: 'Fara a kan',
    yearsExperience: 'Baara san',
    selectExperience: 'I ka baara san sugandi',
    beginner: 'Daminɛla (0-1 san)',
    hourlyRate: 'Lɛrɛ sara (FCFA)',
    rateExamples: 'Lɛrɛ misaliw:',
    profileInfoNote: 'Nin kunnafoni bɛ na jira i ka profil foroba la',
    
    // Profile Photo Upload
    profilePhotoOptional: 'Profil ja (Ka i b\'a fɛ)',
    clickToChooseOption: 'Kliki ka fɛɛrɛ dɔ sugandi',
    chooseFromGallery: 'Ka sugandi galeri kɔnɔ',
    selectExistingPhoto: 'Ja min bɛ yen sugandi',
    takePhoto: 'Ja ta',
    useCamera: 'Camera baara kɛ',
    back: 'Segin',
    gallery: 'Galeri',
    camera: 'Camera',
    photoReadyForRegistration: 'Ja labɛnnen don tɔgɔ sɛbɛn na',
    remove: 'Bɔ',
    pleaseSelectImage: 'Ja sugandi (JPG, PNG, etc.)',
    imageTooLarge: 'Ja ka ka bon 5MB kan',
    errorReadingFile: 'Fili ja kalanni na',
    
    // Network Status
    networkOffline: 'I tɛ sira kan. Fɛɛrɛ dɔw bɛ se ka dogo.',
    networkPoor: 'Sira saganman ye. Optimisation yɛrɛmali kɛra.',
    networkModerate: 'Sira caman. Donnew kisi kɛra.',
    networkGood: 'Sira ɲuman',
    networkExcellent: 'Sira ka ɲi kosɛbɛ',
    networkUnknown: 'Sira ko dɔnnen tɛ',
    networkTipsOffline: '• Baaraw bɛ na synchronisé ni sira seginna\n• Cache kɔnɔ donnew sigilen don',
    networkTipsPoor: '• Jaw optimisé walasa ka bande passante kisi\n• Temps-réel fɛɛrɛw dalen\n• Cache yɛlɛmanen walasa ka rechargement kɔgɛlɛya',
    networkTipsModerate: '• Jaw ka dogo\n• Synchronisation fitininba\n• Fɛɛrɛ nafamaw ye priorité ye',
    userType: 'Baarakɛla sugu',
    iAmClient: 'Ne bɛ baara ɲini',
    iAmWorker: 'Ne bɛ baara kɛ',
    country: 'Jamana',
    detectedAutomatically: 'A yɛrɛko ye a dɔn',
    positionDetected: 'Yɔrɔ dɔnnen',
    adjustedAutomatically: 'Misali ni kunnafoni yɛrɛko changé',
    positionNotDetected: 'Yɔrɔ ma dɔn - Daminɛko sigida (Senegali)',
    nextStepWorker: 'Kɔnɔko: I ka kan ka sara fɛɛrɛ fila jate (Orange Money, Wave, Bank konte)',
    nextStepClient: 'Kɔnɔko: I ka kan ka sara fɛɛrɛ kelen jate (Orange Money, Wave, Bank konte)',
    continueToPaymentVerification: 'Taali → Konte kɔlɔsi',
    detectingLocation: 'Ka i ka yɔrɔ ɲinini...',
    detectedViaGeolocation: 'Jamana dɔnnen i ka yɔrɔ la',
    atLeast6Characters: 'Sɛbɛn wɔrɔ kelen',
    phoneFormat: 'Cogo',
    passwordsDontMatch: 'Dogolen daɲègafe tɛ ben ye',
    passwordTooShort: 'Dogolen daɲègafe ka kan ka kɛ sɛbɛn wɔrɔ ye',
    workersMustSelectSkills: 'Baarakɛlaw ka kan ka seko kelen sugandi',
    pleaseIndicateExperience: 'I ka baara san jateminɛ',
    pleaseIndicateValidRate: 'Lɛrɛ sara ɲuman jateminɛ (minimum 500 FCFA)',
    preparing: 'Ka labɛn...',
    alreadyHaveAccount: 'Konte b\'i bolo wa?',
    signIn: 'Don'
  },
  mos: {
    // Navigation (Mooré - Langue du Burkina Faso)
    home: 'Yiri',
    jobs: 'Tʋʋmã',
    messages: 'Koeese',
    profile: 'M sẽn yaa',
    dashboard: 'Tʋʋm zĩiga',
    login: 'Kẽ',
    register: 'Gʋls f yʋʋre',
    logout: 'Yi',
    
    // Common
    save: 'Bĩng',
    cancel: 'Bas',
    delete: 'Yiis',
    edit: 'Tek',
    submit: 'Tʋm',
    loading: 'A wat n kẽeda...',
    error: 'Yelle',
    success: 'A yɩɩ neere',
    
    // Auth
    email: 'E-mail',
    password: 'Kũum sebre',
    firstName: 'Yʋʋr pipi',
    lastName: 'Yʋʋr yaab-rãmba',
    phone: 'Telefõne',
    confirmPassword: 'Wilg kũum sebre',
    
    // User Types
    client: 'Daaba',
    worker: 'Tʋʋm-neda',
    
    // Countries with flags
    mali: '🇲🇱 Mali',
    senegal: '🇸🇳 Senegaal',
    burkina_faso: '🇧🇫 Burkĩna Faso',
    ivory_coast: '🇨🇮 Kodivuaar',
    
    // Job related
    jobTitle: 'Tʋʋmã yʋʋre',
    jobDescription: 'Tʋʋmã goama',
    budget: 'Ligdi',
    location: 'Zĩiga',
    category: 'Buud',
    postJob: 'Ning tʋʋmã',
    applyJob: 'Kos tʋʋmã',
    
    // Home page
    heroTitle: 'Lagem tʋʋm-neba la daab-rãmba Afirik Rɩtgo',
    heroSubtitle: 'Bao sõma tʋʋma bɩ f kõ f minimã Mali, Senegaal, Burkĩna Faso la Kodivuaar',
    getStarted: 'Sɩng masã',
    viewJobs: 'Ges tʋʋmã',
    myDashboard: 'M tʋʋm zĩiga',
    
    // Countries section
    availableIn4Countries: 'A bee tẽns 4 pʋgẽ',
    kojoConnectsDescription: 'Kojo lagmda tʋʋm-neba la daab-rãmba Afirik Rɩtgo',
    servicesAvailable: 'Tʋʋma sẽn beẽ',
    
    // Services section
    popularServices: 'Tʋʋma sẽn yaa sõma',
    findServiceYouNeed: 'Bao tʋʋm ning f sẽn datẽ',
    
    // Features section
    findWork: 'Bao tʋʋmã',
    findWorkDescription: 'Bao n bãng tẽed sẽn be f soolmẽ wã la kẽng f tʋʋmã taoor',
    connect: 'Lagem',
    connectDescription: 'Gom ne daab-rãmba la tʋʋm-neba ne d koeesa',
    securePayments: 'Yaool sẽn tar pãnga',
    securePaymentsDescription: 'Orange Money, Wave la yaool buud-goama',
    
    // Call to action
    joinThousands: 'Naag tusr dãmba',
    startConnectingToday: 'Sɩng rũnna n lagem ne daab-rãmba bɩ tʋʋm-neba sẽn yaa sõma',
    lookingForServices: 'Mam baoda tʋʋma',
    offerServices: 'Mam kõda m minimã',
    
    // Stats section
    activeWorkers: 'Tʋʋm-neba sẽn tʋʋmde',
    completedProjects: 'Poroze sẽn saame',
    countriesCovered: 'Tẽns sẽn naagẽ',
    customerSupport: 'Daab-rãmba sõngre',
    
    // Dashboard section
    welcomeUser: 'Ne y sõnga,',
    manageProjectsClient: 'Ges f poroze rãmba la bao tʋʋm-neba sẽn yaa sõma',
    discoverOpportunitiesWorker: 'Bao tẽed paalse tʋʋmã pʋgẽ',
    activeJobs: 'Tʋʋma sẽn tʋʋmde',
    completedJobs: 'Tʋʋma sẽn saame',
    totalJobs: 'Tʋʋma fãa',
    totalEarnings: 'Yaool fãa',
    quickActions: 'Manesem zĩ-kãsenga',
    searchJobs: 'Bao',
    workerProfile: 'Tʋʋm-ned sẽn yaa',
    languagesPayments: 'Goama la yaool',
    publicFeature: 'Bũmb neba fãa yĩnga',
    popularCategories: 'Buud sẽn yaa sõma',
    
    // Famakan section
    famakanAccess: 'Famakan Kontaga Master zĩiga',
    famakanDescription: 'Bũmb sẽn bee aplikasõ soab bal yĩnga',
    testMobileFeatures: 'Mak telefõn bũmba',
    createJobGPS: 'Maan tʋʋmã ne GPS',
    debugPhotos: 'Foto debeuge',
    commissionDashboard: 'Komisõ zĩiga',
    
    // Login/Register pages
    noAccount: 'F pa tar kõnt?',
    personalInformation: 'F mengã koɛɛga',
    paymentAccounts: 'Yaool kõnta',
    preferredLanguage: 'Goam f sẽn nong n yɩɩda',
    verified: 'A wilgame',
    no: 'Ayo',
    
    // Photo upload section
    profilePhotoHelps: 'Profil foto sõngda f n paam n bãng Kojo neere',
    professionalPhotoHelps: 'Profil foto sẽn yaa sõma pãagda daab-rãmba bas-yãkre la paagd f sũur sẽn na n paam tʋʋmã',
    addProfilePhoto: 'Ning profil foto',
    addPhoto: 'Ning foto',
    changePhoto: 'Tek foto',
    clickToChoose: 'Wĩig n yãk',
    tipsGoodPhoto: 'Sagl-sõma foto yĩnga',
    useRecentPhoto: 'Tall foto sẽn pa kaoos la sẽn yaa vẽenega',
    lookCamera: 'Ges kamera la lae f nengẽ ne sũ-noogo',
    avoidGroup: 'Ra tall foto neba wʋsg bɩ ne lunɛt',
    neutralBackground: 'Poorẽ sẽn yaa vẽeneg n yɩɩda',
    professionalOutfit: 'Tʋʋm fuugu sẽn yaa sõma kõta daab-rãmba bas-yãkre',
    
    // Country language preference messages
    maliLanguagePreference: 'Mali pʋgẽ, neb wʋsg nong Farãnsẽ bɩ Bambara',
    senegalLanguagePreference: 'Senegaal pʋgẽ, neb wʋsg nong Farãnsẽ bɩ Wolof',
    burkinaLanguagePreference: 'Burkĩna Faso pʋgẽ, neb wʋsg nong Farãnsẽ bɩ Mòoré',
    ivoryCoastLanguagePreference: 'Kodivuaar pʋgẽ, neb wʋsg nong Farãnsẽ',
    
    // Payment accounts section
    minimumRequired: 'Sẽn pa segd n yɩɩ',
    accountRequired: 'kõnt (n yaool yĩnga)',
    accountsLinked: 'kõnt sẽn lagme',
    modify: 'Tek',
    
    // Geolocation messages
    ivoryCoastPreference: 'Kodivuaar, neb wʋsg nong Farãnsẽ',
    
    // Payment verification page
    paymentVerification: 'Yaool kõnta wilgre',
    lastStep: 'Sẽn kẽng taoor',
    linkAccountsToComplete: 'N saag f gʋlsgo, f segd n lagm f yaool kõntã',
    workerPaymentRequirement: 'F sã n yaa tʋʋm-neda, f segd n lagm yaool soay 2 n deeg f ligdi daab-rãmba nengẽ',
    clientPaymentRequirement: 'F sã n yaa daaba, f segd n lagm yaool soa 1 n yaool tʋʋm-neba',
    paymentAccountsUpdated: 'Yaool kõnta tekame ne yĩir',
    paymentAccountsLoadError: 'Yell n zĩnd yaool kõnta waoong pʋgẽ',
    
    // Jobs page
    allCategories: 'Buud fãa',
    allStatuses: 'Yɛl fãa',
    search: 'Bao',
    reset: 'Lebg sɩngr',
    noJobsFound: 'Tʋʋmã ka be ye',
    publishFirstJob: 'Sɩng ne f tʋʋm pipi',
    myJobs: 'M tʋʋma',
    availableJobs: 'Tʋʋma sẽn beẽ',
    
    // Job status translations
    open: 'A pakame',
    inProgress: 'A tʋʋmda',
    completed: 'A saame',
    cancelled: 'A basame',
    
    // Job page descriptions
    manageJobOffers: 'Ges f tʋʋm tagsgo la f tũ neb sẽn kos-b rãmba',
    discoverOpportunities: 'Bao tẽed sẽn be f soolmẽ wã',
    
    // Messages page
    noConversations: 'Goam ka be ye',
    startApplyingJobs: 'Sɩng n kos tʋʋma',
    selectConversation: 'Yãk goam n sɩng',
    
    // Categories
    plumbing: 'Koom tʋʋmã',
    electrical: 'Kuurã tʋʋmã',
    construction: 'Metɛr tʋʋmã',
    cleaning: 'Pɩɩsg tʋʋmã',
    gardening: 'Zãng tʋʋmã',
    tutoring: 'Zãmsg tʋʋmã',
    mechanics: 'Moto tʋʋmã',
    computing: 'Ɔrdinatɛɛr tʋʋmã',
    
    // Payments
    payment: 'Yaool',
    paymentMethods: 'Yaool soaya',
    bankCard: 'Bãnk kart',
    orangeMoney: 'Orange Money',
    wave: 'Wave',
    selectPayment: 'Yãk yaool soa',
    
    // Language Selection
    choosePreferredLanguage: 'Yãk goam f sẽn nong n yɩɩda',
    basedOnLocation: 'Ne f zĩigã',
    languageNote: 'Bãngre:',
    interfaceWillChange: 'Aplikasõ na n tek ne f sẽn yãk la goam kãng na n zĩnd f profil pʋgẽ.',
    localLanguage: 'Tẽngã goama',
    selectedLanguage: 'Goam sẽn yãke',
    interfaceAndProfileUpdated: 'Aplikasõ la profil tekame',
    aboutSelection: 'F sẽn yãkã wɛɛngẽ:',
    interfaceWillChangeNote: 'Kojo aplikasõ na n tek ne f goam sẽn yãke',
    languageOnProfile: 'F goam na n zĩnd f profil ning neb fãa getẽ wã pʋgẽ',
    clientsCanSee: 'Daab-rãmba na n tõog n bãng goam ning f sẽn mi sõma',
    canModifyLater: 'F tõe n tek-a rẽ poor f paramɛtr pʋgẽ',
    detectingLanguage: 'D baood f goam sẽn nong n yɩɩda...',
    
    // Registration
    createAccount: 'Maan kõnta',
    joinKojoCommunity: 'Naag Kojo nebã',
    
    // Professional Skills
    professionalInformationWorker: 'Tʋʋm koɛɛga (Tʋʋm-neda)',
    skillsAndSpecialties: 'Minimã la yam',
    selectedSkills: 'F minimã f sẽn yãke:',
    addCustomSkill: 'Paas minim a to',
    customSkillPlaceholder: 'F minim a to',
    add: 'Paas',
    yearsExperience: 'Yʋʋm sẽn tʋʋm',
    selectExperience: 'Yãk f yʋʋm sẽn tʋʋm',
    beginner: 'Sɩngda (0-1 yʋʋm)',
    hourlyRate: 'Wakat yaool (FCFA)',
    rateExamples: 'Wakat yaool makre:',
    profileInfoNote: 'Koɛɛg kãng na n zĩnd f profil ning neb fãa getẽ wã pʋgẽ',
    
    // Profile Photo Upload
    profilePhotoOptional: 'Profil foto (F sã n dat)',
    clickToChooseOption: 'Wĩig n yãk soa',
    chooseFromGallery: 'Yãk galri pʋgẽ',
    selectExistingPhoto: 'Yãk foto sẽn be',
    takePhoto: 'Rɩk foto',
    useCamera: 'Tall kamera',
    back: 'Lebg',
    gallery: 'Galri',
    camera: 'Kamera',
    photoReadyForRegistration: 'Foto seglame gʋlsg yĩnga',
    remove: 'Yiis',
    pleaseSelectImage: 'Yãk foto (JPG, PNG, la a to)',
    imageTooLarge: 'Foto segd n pa yɩɩg 5MB ye',
    errorReadingFile: 'Yell n zĩnd foto karmẽ pʋgẽ',
    photoUploadedSuccessfully: 'Profil foto tekame ne yĩir!',
    
    // Network Status
    networkOffline: 'F pa tar ɛntɛrnɛt ye. Bũmb kẽer tõe n pa tʋʋm ye.',
    networkPoor: 'Ɛntɛrnɛt wĩnd-wĩndre. Optimizasõ otomatik maana.',
    networkModerate: 'Ɛntɛrnɛt yaa bɩr-bɩre. Done bĩngr maana.',
    networkGood: 'Ɛntɛrnɛt sẽn yaa sõma',
    networkExcellent: 'Ɛntɛrnɛt sẽn yaa sõma wʋsgo',
    networkUnknown: 'D pa mi ɛntɛrnɛt yɛlã ye',
    networkTipsOffline: '• Bũmb fãa na n lagm ɛntɛrnɛt sã n wa lebge\n• Done sẽn bĩng beẽ wakat fãa',
    networkTipsPoor: '• Foto yɩɩ bil n bĩnge\n• Temps-réel bũmba paame\n• Cache yalgame n gil rechargema',
    networkTipsModerate: '• Foto yɩɩ bila\n• Lagmg pa naag ye\n• Bũmb sẽn yaa tɩlae yɩɩ taoor',
    userType: 'F sẽn yaa bũmb ning',
    iAmClient: 'Mam baoda tʋʋma',
    iAmWorker: 'Mam kõda tʋʋma',
    country: 'Tẽnga',
    detectedAutomatically: 'A yãa a toor',
    positionDetected: 'Zĩig yãame',
    adjustedAutomatically: 'Makr la koɛɛg tekame a toor',
    positionNotDetected: 'Zĩig pa yãam ye - D tall sɩngr (Senegaal)',
    nextStepWorker: 'Sẽn kẽnga: F segd n lagm yaool soay 2 (Orange Money, Wave, Bãnk kõnt)',
    nextStepClient: 'Sẽn kẽnga: F segd n lagm yaool soa 1 (Orange Money, Wave, Bãnk kõnt)',
    continueToPaymentVerification: 'Kẽng taoor → Kõnta wilgre',
    detectingLocation: 'D baood f zĩigã...',
    detectedViaGeolocation: 'Tẽng yãa ne f zĩigã',
    atLeast6Characters: 'Sẽn pa yɩɩg 6',
    phoneFormat: 'Manesem',
    passwordsDontMatch: 'Kũum sebre pa yembre ye',
    passwordTooShort: 'Kũum sebre segd n tar sẽn pa yɩɩg 6',
    workersMustSelectSkills: 'Tʋʋm-neba segd n yãk minim a yembr',
    pleaseIndicateExperience: 'Wilg f yʋʋm sẽn tʋʋm',
    pleaseIndicateValidRate: 'Wilg wakat yaool sẽn zemse (minimum 500 FCFA)',
    preparing: 'A segenda...',
    alreadyHaveAccount: 'F tara kõnt?',
    signIn: 'Kẽ'
  }
};

export function LanguageProvider({ children }) {
  const [currentLanguage, setCurrentLanguage] = useState(() => {
    // Initialize from localStorage or default to French
    const savedLanguage = localStorage.getItem('language');
    return savedLanguage && ['fr', 'en', 'wo', 'bm', 'mos'].includes(savedLanguage) ? savedLanguage : 'fr';
  });

  const t = (key) => {
    return translations[currentLanguage]?.[key] || key;
  };

  const changeLanguage = (lang) => {
    if (process.env.NODE_ENV === 'development') {
      devLog.info(`🔄 Changing interface language to: ${lang}`);
    }
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