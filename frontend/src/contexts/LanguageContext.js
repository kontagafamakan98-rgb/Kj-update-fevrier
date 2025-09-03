import React, { createContext, useContext, useState } from 'react';

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
    hourlyRate: 'Tarif horaire (FCFA)',
    rateExamples: 'Exemples de tarifs par heure :',
    profileInfoNote: 'Ces informations apparaîtront sur votre profil public',
    
    // Profile Photo Upload
    profilePhotoOptional: 'Photo de Profil (Optionnel)',
    addProfilePhoto: 'Ajouter une photo de profil',
    clickToChooseOption: 'Cliquez pour choisir une option',
    chooseFromGallery: 'Choisir depuis la galerie',
    selectExistingPhoto: 'Sélectionner une photo existante',
    takePhoto: 'Prendre une photo',
    useCamera: 'Utiliser l\'appareil photo',
    back: 'Retour',
    changePhoto: 'Changer la photo',
    gallery: 'Galerie',
    camera: 'Caméra',
    cancel: 'Annuler',
    photoReadyForRegistration: 'Photo prête pour l\'inscription',
    remove: 'Supprimer',
    tipsGoodPhoto: 'Conseils pour une bonne photo',
    pleaseSelectImage: 'Veuillez sélectionner une image (JPG, PNG, etc.)',
    imageTooLarge: 'L\'image doit faire moins de 5MB',
    errorReadingFile: 'Erreur lors de la lecture du fichier',
    
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
    pleaseIndicateValidRate: 'Veuillez indiquer un tarif horaire valide (minimum 500 FCFA)',
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
    addProfilePhoto: 'Add a profile photo',
    clickToChooseOption: 'Click to choose an option',
    chooseFromGallery: 'Choose from gallery',
    selectExistingPhoto: 'Select an existing photo',
    takePhoto: 'Take a photo',
    useCamera: 'Use camera',
    back: 'Back',
    changePhoto: 'Change photo',
    gallery: 'Gallery',
    camera: 'Camera',
    cancel: 'Cancel',
    photoReadyForRegistration: 'Photo ready for registration',
    remove: 'Remove',
    tipsGoodPhoto: 'Tips for a good photo',
    pleaseSelectImage: 'Please select an image (JPG, PNG, etc.)',
    imageTooLarge: 'Image must be less than 5MB',
    errorReadingFile: 'Error reading file',
    userType: 'User Type',
    iAmClient: 'I am looking for services',
    iAmWorker: 'I offer my services',
    country: 'Country',
    detectedAutomatically: 'Detected automatically',
    positionDetected: 'Position detected',
    adjustedAutomatically: 'Examples and information adjusted automatically',
    positionNotDetected: 'Position not detected - Using default settings (Senegal)',
    personalInformation: 'Personal information',
    paymentAccounts: 'Payment accounts',
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
    addProfilePhoto: 'Yokk nataal profil',
    clickToChooseOption: 'Bët ngir tànn benn yoon',
    chooseFromGallery: 'Tànn ci galeri',
    selectExistingPhoto: 'Tànn nataal bu am',
    takePhoto: 'Jëm nataal',
    useCamera: 'Jëfandikoo kamera',
    back: 'Dellu',
    changePhoto: 'Soppi nataal',
    gallery: 'Galeri',
    camera: 'Kamera',
    cancel: 'Ànd',
    photoReadyForRegistration: 'Nataal bi pare na ngir bind ak tëdd',
    remove: 'Dindi',
    tipsGoodPhoto: 'Àtte yu ñuul ngir nataal bu bax',
    pleaseSelectImage: 'Tànn nataal (JPG, PNG, etc.)',
    imageTooLarge: 'Nataal bi gëna am 5MB',
    errorReadingFile: 'Njub ci jàngi file bi',
    userType: 'Sugu jëfkoykat',
    iAmClient: 'Dama soxla sëriñ yi',
    iAmWorker: 'Dama def liggéey',
    country: 'Réew',
    detectedAutomatically: 'Giss na otomatig',
    positionDetected: 'Bër bi giss na',
    adjustedAutomatically: 'Misaal ak xet yi soppi nañu otomatig',
    positionNotDetected: 'Bër bi gissul - Jëfandikoo paramètres yu defar (Senegaal)',
    personalInformation: 'Xet yu boole',
    paymentAccounts: 'Konte fey',
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
    addProfilePhoto: 'Profil ja fara a kan',
    clickToChooseOption: 'Kliki ka fɛɛrɛ dɔ sugandi',
    chooseFromGallery: 'Ka sugandi galeri kɔnɔ',
    selectExistingPhoto: 'Ja min bɛ yen sugandi',
    takePhoto: 'Ja ta',
    useCamera: 'Camera baara kɛ',
    back: 'Segin',
    changePhoto: 'Ja changé',
    gallery: 'Galeri',
    camera: 'Camera',
    cancel: 'Ban',
    photoReadyForRegistration: 'Ja labɛnnen don tɔgɔ sɛbɛn na',
    remove: 'Bɔ',
    tipsGoodPhoto: 'Ladilikan ja ɲuman ma',
    pleaseSelectImage: 'Ja sugandi (JPG, PNG, etc.)',
    imageTooLarge: 'Ja ka ka bon 5MB kan',
    errorReadingFile: 'Fili ja kalanni na',
    userType: 'Baarakɛla sugu',
    iAmClient: 'Ne bɛ baara ɲini',
    iAmWorker: 'Ne bɛ baara kɛ',
    country: 'Jamana',
    detectedAutomatically: 'A yɛrɛko ye a dɔn',
    positionDetected: 'Yɔrɔ dɔnnen',
    adjustedAutomatically: 'Misali ni kunnafoni yɛrɛko changé',
    positionNotDetected: 'Yɔrɔ ma dɔn - Daminɛko sigida (Senegali)',
    personalInformation: 'Mɔgɔ kunnafoni',
    paymentAccounts: 'Sara konte',
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
  }
};

export function LanguageProvider({ children }) {
  const [currentLanguage, setCurrentLanguage] = useState(() => {
    // Initialize from localStorage or default to French
    const savedLanguage = localStorage.getItem('language');
    return savedLanguage && ['fr', 'en', 'wo', 'bm'].includes(savedLanguage) ? savedLanguage : 'fr';
  });

  const t = (key) => {
    return translations[currentLanguage]?.[key] || key;
  };

  const changeLanguage = (lang) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔄 Changing interface language to: ${lang}`);
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