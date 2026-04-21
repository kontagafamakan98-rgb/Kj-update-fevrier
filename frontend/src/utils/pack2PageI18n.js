import { normalizeCountryCode as normalizeCountryAlias } from './countryAliases';

export const getLocaleForLanguage = (language) => {
  switch (language) {
    case 'en':
      return 'en-US';
    case 'wo':
    case 'bm':
    case 'mos':
    case 'fr':
    default:
      return 'fr-FR';
  }
};

const pages = {
  createJob: {
    fr: {
      pageTitle: 'Créer un nouveau job',
      pageSubtitle: 'Trouvez le travailleur parfait pour votre projet au {country}',
      titleRequired: 'Le titre est requis',
      descriptionRequired: 'La description est requise',
      locationRequired: 'La localisation est requise',
      budgetMinRequired: 'Budget minimum requis',
      budgetMaxRequired: 'Budget maximum requis',
      successCreated: 'Job créé avec succès !',
      errorCreated: 'Erreur lors de la création du job',
      titleLabel: 'Titre du job *',
      titlePlaceholder: 'Ex: Réparation plomberie urgente',
      descriptionLabel: 'Description *',
      descriptionPlaceholder: 'Décrivez en détail le travail à effectuer...',
      categoryLabel: 'Catégorie',
      categoryGeneral: '🔧 Général',
      categoryPlumbing: '🚿 Plomberie',
      categoryElectrical: '⚡ Électricité',
      categoryPainting: '🎨 Peinture',
      categoryCleaning: '🧹 Ménage',
      categoryConstruction: '🏗️ Construction',
      categoryGardening: '🌿 Jardinage',
      categoryMechanics: '🔩 Mécanique',
      locationLabel: 'Localisation *',
      locationPlaceholder: 'Ex: Plateau, Dakar, Sénégal',
      locationHelp: 'ou utilisez le bouton GPS pour détecter automatiquement',
      budgetLabel: 'Budget (XOF) *',
      budgetMinPlaceholder: 'Min (ex: 10000)',
      budgetMaxPlaceholder: 'Max (ex: 25000)',
      requirementsLabel: 'Exigences particulières',
      requirementsPlaceholder: 'Ex: Expérience minimum 3 ans, outils fournis...',
      deadlineLabel: 'Date limite souhaitée',
      urgencyLabel: 'Niveau d\'urgence',
      urgencyLow: 'Pas urgent',
      urgencyNormal: 'Normal',
      urgencyHigh: 'Urgent',
      mechanicInfoTitle: 'Informations importantes pour le mécanicien',
      partsQuestion: 'Le mécanicien doit-il apporter les pièces ?',
      partsDescription: 'Pièces de rechange, composants, etc.',
      toolsQuestion: 'Le mécanicien doit-il apporter les outils ?',
      toolsDescription: 'Outils spécialisés, équipements, etc.',
      yes: '✅ Oui',
      no: '❌ Non',
      extraNotes: '📝 Notes supplémentaires (optionnel)',
      extraNotesPlaceholder: 'Ex: Pièces spécifiques nécessaires, modèle du véhicule, marque des outils requis...',
      extraNotesHelp: '💡 Ces informations aideront le mécanicien à mieux se préparer pour votre intervention',
      mechanicSummary: '📋 Résumé pour le mécanicien :',
      partsSummary: 'Pièces',
      toolsSummary: 'Outils',
      notesSummary: 'Notes',
      byMechanic: 'À apporter par le mécanicien',
      byClient: 'Fournies par le client',
      creating: 'Création en cours...',
      publishButton: '🚀 Publier le job',
      tipsTitle: '💡 Conseils pour un bon job',
      tip1: '• Soyez précis dans la description du travail',
      tip2: '• Proposez un budget réaliste pour attirer des candidats qualifiés',
      tip3: '• Mentionnez si vous fournissez les outils ou matériaux',
      tip4: '• Répondez rapidement aux candidatures'
    },
    en: {
      pageTitle: 'Create a new job',
      pageSubtitle: 'Find the perfect worker for your project in {country}',
      titleRequired: 'Title is required',
      descriptionRequired: 'Description is required',
      locationRequired: 'Location is required',
      budgetMinRequired: 'Minimum budget is required',
      budgetMaxRequired: 'Maximum budget is required',
      successCreated: 'Job created successfully!',
      errorCreated: 'Error while creating the job',
      titleLabel: 'Job title *',
      titlePlaceholder: 'Example: Urgent plumbing repair',
      descriptionLabel: 'Description *',
      descriptionPlaceholder: 'Describe the work to be done in detail...',
      categoryLabel: 'Category',
      categoryGeneral: '🔧 General',
      categoryPlumbing: '🚿 Plumbing',
      categoryElectrical: '⚡ Electrical',
      categoryPainting: '🎨 Painting',
      categoryCleaning: '🧹 Cleaning',
      categoryConstruction: '🏗️ Construction',
      categoryGardening: '🌿 Gardening',
      categoryMechanics: '🔩 Mechanics',
      locationLabel: 'Location *',
      locationPlaceholder: 'Example: Plateau, Dakar, Senegal',
      locationHelp: 'or use the GPS button for automatic detection',
      budgetLabel: 'Budget (XOF) *',
      budgetMinPlaceholder: 'Min (e.g. 10000)',
      budgetMaxPlaceholder: 'Max (e.g. 25000)',
      requirementsLabel: 'Special requirements',
      requirementsPlaceholder: 'Example: Minimum 3 years experience, tools provided...',
      deadlineLabel: 'Preferred deadline',
      urgencyLabel: 'Urgency level',
      urgencyLow: 'Low',
      urgencyNormal: 'Normal',
      urgencyHigh: 'Urgent',
      mechanicInfoTitle: 'Important information for the mechanic',
      partsQuestion: 'Should the mechanic bring the parts?',
      partsDescription: 'Spare parts, components, etc.',
      toolsQuestion: 'Should the mechanic bring the tools?',
      toolsDescription: 'Specialized tools, equipment, etc.',
      yes: '✅ Yes',
      no: '❌ No',
      extraNotes: '📝 Additional notes (optional)',
      extraNotesPlaceholder: 'Example: Specific parts needed, vehicle model, required tool brand...',
      extraNotesHelp: '💡 This information helps the mechanic prepare better for your intervention',
      mechanicSummary: '📋 Summary for the mechanic:',
      partsSummary: 'Parts',
      toolsSummary: 'Tools',
      notesSummary: 'Notes',
      byMechanic: 'To be brought by the mechanic',
      byClient: 'Provided by the client',
      creating: 'Creating...',
      publishButton: '🚀 Publish job',
      tipsTitle: '💡 Tips for a good job post',
      tip1: '• Be precise in the job description',
      tip2: '• Offer a realistic budget to attract qualified candidates',
      tip3: '• Mention whether tools or materials are provided',
      tip4: '• Reply quickly to applications'
    }
  },
  paymentVerification: {
    fr: {
      redirecting: 'Redirection...',
      welcome: 'Bienvenue {firstName} {lastName} !',
      accountType: 'Type de compte',
      geoDetecting: 'Détection de votre position pour ajuster les exemples...',
      position: '📍 Position',
      examplesAdjusted: 'Exemples de numéros et banques ajustés automatiquement',
      positionNotDetected: '📍 Position non détectée - Exemples par défaut utilisés',
      stepPersonal: 'Informations personnelles',
      stepPayments: 'Comptes de paiement',
      stepAccess: 'Accès à l\'application',
      registrationErrorTitle: 'Erreur d\'inscription',
      finalizing: 'Finalisation de l\'inscription...',
      checkingAccounts: 'Vérification des comptes de paiement en cours',
      backToRegister: '← Retour à l\'inscription',
      securityTitle: 'Sécurité et confidentialité',
      security1: '• Vos informations de paiement sont chiffrées et sécurisées',
      security2: '• Nous ne stockons jamais vos codes PIN ou mots de passe',
      security3: '• Les numéros de cartes bancaires sont masqués après validation',
      security4: '• Seuls les numéros de téléphone des portefeuilles mobiles sont conservés',
      security5: '• Ces informations servent uniquement aux transferts de paiement Kojo',
      autoLoginError: 'Erreur lors de la connexion automatique',
      genericError: 'Erreur lors de l\'inscription avec vérification paiement',
      welcomeToast: 'Bienvenue {firstName}! Compte vérifié avec succès 🎉',
      dashboardMessage: 'Bienvenue {firstName}! Votre compte est vérifié avec {count} moyen(s) de paiement.'
    },
    en: {
      redirecting: 'Redirecting...',
      welcome: 'Welcome {firstName} {lastName}!',
      accountType: 'Account type',
      geoDetecting: 'Detecting your position to adjust examples...',
      position: '📍 Position',
      examplesAdjusted: 'Phone number and bank examples adjusted automatically',
      positionNotDetected: '📍 Position not detected - Default examples are used',
      stepPersonal: 'Personal information',
      stepPayments: 'Payment accounts',
      stepAccess: 'App access',
      registrationErrorTitle: 'Registration error',
      finalizing: 'Finalizing registration...',
      checkingAccounts: 'Verifying payment accounts',
      backToRegister: '← Back to registration',
      securityTitle: 'Security and privacy',
      security1: '• Your payment information is encrypted and secured',
      security2: '• We never store your PIN codes or passwords',
      security3: '• Bank card numbers are masked after validation',
      security4: '• Only mobile wallet phone numbers are stored',
      security5: '• This information is used only for Kojo payment transfers',
      autoLoginError: 'Error during automatic login',
      genericError: 'Error while registering with payment verification',
      welcomeToast: 'Welcome {firstName}! Account verified successfully 🎉',
      dashboardMessage: 'Welcome {firstName}! Your account is verified with {count} payment method(s).'
    }
  },
  jobDetails: {
    fr: {
      loadError: 'Erreur lors du chargement de l\'emploi',
      notFound: 'Emploi non trouvé',
      back: 'Retour',
      publishedOn: 'Publié le {date}',
      estimatedDuration: 'Durée estimée : {value}',
      submitProposal: 'Faire une proposition',
      contactClient: 'Contacter le client',
      description: 'Description',
      requiredSkills: 'Compétences requises',
      proposals: 'Propositions ({count})',
      noProposals: 'Aucune proposition reçue pour le moment.',
      information: 'Informations',
      deadline: 'Échéance : {date}',
      client: 'Client',
      anonymousClient: 'Client anonyme',
      viewProfile: 'Voir le profil',
      worker: 'Travailleur',
      duration: 'Durée estimée : {value}',
      accept: 'Accepter',
      reject: 'Refuser',
      status_open: 'Ouvert',
      status_in_progress: 'En cours',
      status_completed: 'Complété',
      status_cancelled: 'Annulé',
      status_pending: 'En attente',
      status_accepted: 'Acceptée',
      status_rejected: 'Refusée',
      backButtonAria: 'Revenir à la page précédente'
    },
    en: {
      loadError: 'Error while loading the job',
      notFound: 'Job not found',
      back: 'Back',
      publishedOn: 'Published on {date}',
      estimatedDuration: 'Estimated duration: {value}',
      submitProposal: 'Submit a proposal',
      contactClient: 'Contact client',
      description: 'Description',
      requiredSkills: 'Required skills',
      proposals: 'Proposals ({count})',
      noProposals: 'No proposals received yet.',
      information: 'Information',
      deadline: 'Deadline: {date}',
      client: 'Client',
      anonymousClient: 'Anonymous client',
      viewProfile: 'View profile',
      worker: 'Worker',
      duration: 'Estimated duration: {value}',
      accept: 'Accept',
      reject: 'Reject',
      status_open: 'Open',
      status_in_progress: 'In progress',
      status_completed: 'Completed',
      status_cancelled: 'Cancelled',
      status_pending: 'Pending',
      status_accepted: 'Accepted',
      status_rejected: 'Rejected',
      backButtonAria: 'Go back to the previous page'
    }
  },
  jobs: {
    fr: {
      searchPlaceholder: 'Titre ou description...',
      categoryLabel: 'Catégorie',
      statusLabel: 'Statut',
      duration: 'Durée : {value}',
      apply: 'Postuler'
    },
    en: {
      searchPlaceholder: 'Title or description...',
      categoryLabel: 'Category',
      statusLabel: 'Status',
      duration: 'Duration: {value}',
      apply: 'Apply'
    }
  },
  messages: {
    fr: {
      otherUser: 'Utilisateur',
      placeholder: 'Tapez votre message...',
      sendMessageAria: 'Envoyer le message'
    },
    en: {
      otherUser: 'User',
      placeholder: 'Type your message...',
      sendMessageAria: 'Send message'
    }
  },
  commissionDashboard: {
    fr: {
      checkingAccess: 'Vérification des accès...',
      accessReserved: 'Accès réservé à Famakan Kontaga Master',
      accessMessage: 'Cette section est réservée exclusivement à Famakan Kontaga Master, le propriétaire de l\'application Kojo.',
      securityNote: 'Note de sécurité : le tableau de bord des commissions contient des informations financières sensibles et n\'est accessible qu\'avec l\'autorisation de Famakan Kontaga Master.',
      connectedUser: '👤 Utilisateur connecté',
      email: '📧 Email',
      accessLevel: '🔐 Niveau d\'accès',
      standardUser: 'Utilisateur standard',
      back: '← Retour',
      title: '💼 Tableau de bord - commissions propriétaire',
      subtitle: 'Suivi de vos commissions automatiques de 14% sur tous les paiements',
      totalCommissions: 'Total commissions',
      totalVolume: 'Volume total',
      transactions: 'Transactions',
      today: 'Aujourd\'hui',
      receptionAccounts: '🏦 Vos comptes de réception',
      saveAccounts: '✅ Sauvegarder',
      editAccounts: '✏️ Modifier',
      updatedSuccess: '✅ Comptes mis à jour avec succès !',
      phoneNumber: 'Numéro de téléphone :',
      accountName: 'Nom du compte :',
      notConfigured: 'Non configuré',
      accountNumber: 'Numéro de compte :',
      bank: 'Banque :',
      history: '📋 Historique des commissions',
      refresh: '🔄 Actualiser',
      noTransactions: 'Aucune transaction avec commission pour le moment',
      noTransactionsHelp: 'Les commissions apparaîtront ici après les premiers paiements',
      transaction: 'Transaction',
      totalAmount: 'Montant total',
      yourCommission: 'Votre commission (14%)',
      workerAmount: 'Travailleur (86%)',
      method: 'Méthode',
      date: 'Date',
      bankCard: 'Carte bancaire'
    },
    en: {
      checkingAccess: 'Checking access...',
      accessReserved: 'Access reserved for Famakan Kontaga Master',
      accessMessage: 'This section is reserved exclusively for Famakan Kontaga Master, the owner of the Kojo application.',
      securityNote: 'Security note: the commission dashboard contains sensitive financial information and is only accessible with authorization from Famakan Kontaga Master.',
      connectedUser: '👤 Logged in user',
      email: '📧 Email',
      accessLevel: '🔐 Access level',
      standardUser: 'Standard user',
      back: '← Back',
      title: '💼 Dashboard - owner commissions',
      subtitle: 'Track your automatic 14% commissions on all payments',
      totalCommissions: 'Total commissions',
      totalVolume: 'Total volume',
      transactions: 'Transactions',
      today: 'Today',
      receptionAccounts: '🏦 Your receiving accounts',
      saveAccounts: '✅ Save',
      editAccounts: '✏️ Edit',
      updatedSuccess: '✅ Accounts updated successfully!',
      phoneNumber: 'Phone number:',
      accountName: 'Account name:',
      notConfigured: 'Not configured',
      accountNumber: 'Account number:',
      bank: 'Bank:',
      history: '📋 Commission history',
      refresh: '🔄 Refresh',
      noTransactions: 'No commission transactions yet',
      noTransactionsHelp: 'Commissions will appear here after the first payments',
      transaction: 'Transaction',
      totalAmount: 'Total amount',
      yourCommission: 'Your commission (14%)',
      workerAmount: 'Worker (86%)',
      method: 'Method',
      date: 'Date',
      bankCard: 'Bank card'
    }
  },
  profile: {
    fr: {
      workerProfileSection: 'Profil travailleur',
      photoTitle: 'Photo de profil',
      firstName: 'Prénom',
      lastName: 'Nom',
      country: 'Pays',
      professionalInfo: 'Informations professionnelles',
      bio: 'Biographie professionnelle',
      bioPlaceholder: 'Décrivez votre expérience, vos qualifications et ce qui vous distingue...',
      bioHelp: 'Une bonne biographie attire plus de clients',
      skills: 'Compétences',
      skillsPlaceholder: 'Ex: Plomberie, Électricité, Peinture, Menuiserie...',
      skillsHelp: 'Séparez les compétences par des virgules',
      specialties: 'Spécialités',
      yearsExperience: 'Années d\'expérience',
      years: '{count} ans',
      availability: 'Disponibilité',
      descriptionOptional: 'Description (optionnelle)',
      descriptionPlaceholder: 'Parlez de vos compétences et expérience...',
      availableForProjects: 'Je suis disponible pour de nouveaux projets',
      createWorkerProfileHelp: 'Créez votre profil travailleur pour recevoir des propositions d\'emploi.',
      createWorkerProfile: 'Créer le profil travailleur',
      add: 'Ajouter',
      specialtyPlaceholder: 'Ex: Plomberie, Électricité...',
      save: 'Enregistrer',
      cancel: 'Annuler',
      errorPrefix: 'Erreur : ',
      description: 'Description'
    },
    en: {
      workerProfileSection: 'Worker profile',
      photoTitle: 'Profile photo',
      firstName: 'First name',
      lastName: 'Last name',
      country: 'Country',
      professionalInfo: 'Professional information',
      bio: 'Professional bio',
      bioPlaceholder: 'Describe your experience, qualifications and what makes you stand out...',
      bioHelp: 'A good bio attracts more clients',
      skills: 'Skills',
      skillsPlaceholder: 'Example: Plumbing, Electrical, Painting, Carpentry...',
      skillsHelp: 'Separate skills with commas',
      specialties: 'Specialties',
      yearsExperience: 'Years of experience',
      years: '{count} years',
      availability: 'Availability',
      descriptionOptional: 'Description (optional)',
      descriptionPlaceholder: 'Talk about your skills and experience...',
      availableForProjects: 'I am available for new projects',
      createWorkerProfileHelp: 'Create your worker profile to receive job proposals.',
      createWorkerProfile: 'Create worker profile',
      add: 'Add',
      specialtyPlaceholder: 'Example: Plumbing, Electrical...',
      save: 'Save',
      cancel: 'Cancel',
      errorPrefix: 'Error: ',
      description: 'Description'
    }
  }
};

const withBase = (base, overrides) => ({ ...base, ...overrides });

export const normalizeCountryCode = (code = '') => normalizeCountryAlias(code);

pages.createJob.wo = withBase(pages.createJob.fr, {
  pageTitle: 'Sos liggéey bu bees',
  pageSubtitle: 'Gis liggéeykat bu baax ngir sa projet ci {country}',
  titleRequired: 'Tur bi war na am',
  descriptionRequired: 'Melokaan bi war na am',
  locationRequired: 'Bér bi war na am',
  budgetMinRequired: 'Bajat bu gëna ndaw war na am',
  budgetMaxRequired: 'Bajat bu gëna mag war na am',
  successCreated: 'Liggéey bi sos na bu baax!',
  errorCreated: 'Njuumte ci sosu liggéey bi',
  publishButton: '🚀 Yégle liggéey bi',
  creating: 'Mi ngi sos...',
  mechanicInfoTitle: 'Leeral yu am solo ngir mekanisien bi',
  yes: '✅ Waaw',
  no: '❌ Déedéet'
});
pages.createJob.bm = withBase(pages.createJob.fr, {
  pageTitle: 'Baara kura da',
  pageSubtitle: 'Baarakɛla ɲuman inin i ka projet ye jamana {country} kɔnɔ',
  titleRequired: 'Tɔgɔ bɛ se ka kɛ',
  descriptionRequired: 'Fɔli bɛ se ka kɛ',
  locationRequired: 'Yɔrɔ bɛ se ka kɛ',
  budgetMinRequired: 'Wari dɔgɔya bɛ se ka kɛ',
  budgetMaxRequired: 'Wari caya bɛ se ka kɛ',
  successCreated: 'Baara dafalen don!',
  errorCreated: 'Fili bɛ baara dafalen na',
  publishButton: '🚀 Baara bila',
  creating: 'Bɛ dafalen...',
  mechanicInfoTitle: 'Kibaru nafama mekanisien ye',
  yes: '✅ Awɔ',
  no: '❌ Ayi'
});
pages.createJob.mos = withBase(pages.createJob.fr, {
  pageTitle: 'Ning tʋʋmã pug-kaseng',
  pageSubtitle: 'Bao tʋʋm-neda sẽn yaa sõma n yɩ f projet wã tẽng {country} pʋgẽ',
  titleRequired: 'Yʋʋr wã sẽn kɛ',
  descriptionRequired: 'Goama wã sẽn kɛ',
  locationRequired: 'Zĩiga wã sẽn kɛ',
  budgetMinRequired: 'Ligdi sẽn pʋg ninsaal sẽn kɛ',
  budgetMaxRequired: 'Ligdi sẽn yɩɩdga sẽn kɛ',
  successCreated: 'Tʋʋmã wã ninge neere!',
  errorCreated: 'Yelle n togs tʋʋmã ningre',
  publishButton: '🚀 Kibar tʋʋmã wã yẽ',
  creating: 'A ningda...',
  mechanicInfoTitle: 'Sẽn tar panga n togs mekanisien wã',
  yes: '✅ Õo',
  no: '❌ Ayo'
});

pages.paymentVerification.wo = withBase(pages.paymentVerification.fr, {
  redirecting: 'Mi ngi jëm ci kanam...',
  accountType: 'Xeetu konto',
  geoDetecting: 'Mi ngi seet sa bér ngir méngale misaal yi...',
  position: '📍 Bér',
  positionNotDetected: '📍 Bér bi kenn gisuko - misaal yu défaut la ñuy jëfandikoo',
  finalizing: 'Mi ngi jeexal bind bi...',
  checkingAccounts: 'Mi ngi saytu kontu fey yi',
  backToRegister: '← Dellu ci bind bi',
  securityTitle: 'Kaaraange ak sutura'
});
pages.paymentVerification.bm = withBase(pages.paymentVerification.fr, {
  redirecting: 'Bɛ taa ka tɛmɛn...',
  accountType: 'Konto sugu',
  geoDetecting: 'Bɛ i ka yɔrɔ ɲini walasa misaaliw ka ladilan...',
  position: '📍 Yɔrɔ',
  positionNotDetected: '📍 Yɔrɔ ma dɔn - misaaliw minnu bɛ yen bɛ baara',
  finalizing: 'Bɛ sɛbɛnni laban...',
  checkingAccounts: 'Bɛ sara kontow lakɔlɔsi',
  backToRegister: '← Segin ka taa inscrire',
  securityTitle: 'Lakanali ni dogoya'
});
pages.paymentVerification.mos = withBase(pages.paymentVerification.fr, {
  redirecting: 'A wa n tɛed n kẽ...',
  accountType: 'Konto buud',
  geoDetecting: 'A bao f zĩiga n maneg misaale...',
  position: '📍 Zĩiga',
  positionNotDetected: '📍 Zĩiga wã ka bãng - misaal défaut n be',
  finalizing: 'A ket n pid bindgre...',
  checkingAccounts: 'A gese yaool konto-rãmba',
  backToRegister: '← Lebg n kẽ bindgre',
  securityTitle: 'Pãnga la sutura'
});

pages.jobDetails.wo = withBase(pages.jobDetails.fr, {
  loadError: 'Njuumte ci yebbi liggéey bi',
  notFound: 'Gisuñu liggéey bi',
  back: 'Dellu',
  submitProposal: 'Def ndigal',
  contactClient: 'Jokkoo ak kliyan bi',
  proposals: 'Ndigal yi ({count})',
  noProposals: 'Amul ndigal ba tey.',
  accept: 'Nangu',
  reject: 'Bañ'
});
pages.jobDetails.bm = withBase(pages.jobDetails.fr, {
  loadError: 'Fili bɛ baara kalan na',
  notFound: 'Baara ma sɔrɔ',
  back: 'Segin',
  submitProposal: 'Hakɛ bila',
  contactClient: 'Kuma ni kliyan ye',
  proposals: 'Hakɛw ({count})',
  noProposals: 'Hakɛ si ma sɔrɔ fɔlɔ.',
  accept: 'Sɔn',
  reject: 'Ban'
});
pages.jobDetails.mos = withBase(pages.jobDetails.fr, {
  loadError: 'Yelle n togs tʋʋmã karengre',
  notFound: 'Ka ges tʋʋmã wã ye',
  back: 'Lebg',
  submitProposal: 'Tʋm tẽngre',
  contactClient: 'Gom ne daaba',
  proposals: 'Tẽngse ({count})',
  noProposals: 'Tẽngre ka be ne taba.',
  accept: 'Sak',
  reject: 'Kis'
});

pages.jobs.wo = withBase(pages.jobs.fr, {
  searchPlaceholder: 'Tur walla melokaan...',
  categoryLabel: 'Wàcc',
  statusLabel: 'Tolluwaay',
  duration: 'Yàgg: {value}',
  apply: 'Dàgg'
});
pages.jobs.bm = withBase(pages.jobs.fr, {
  searchPlaceholder: 'Tɔgɔ walima fɔli...',
  categoryLabel: 'Sugu',
  statusLabel: 'Jateko',
  duration: 'Waati: {value}',
  apply: 'Hakɛ kɛ'
});
pages.jobs.mos = withBase(pages.jobs.fr, {
  searchPlaceholder: 'Yʋʋr bɩ goama...',
  categoryLabel: 'Buud',
  statusLabel: 'Wẽnda',
  duration: 'Waqt: {value}',
  apply: 'Kos'
});

pages.messages.wo = withBase(pages.messages.fr, {
  otherUser: 'Jëfandikookat',
  placeholder: 'Bind sa bataaxal...',
  sendMessageAria: 'Yónnee bataaxal bi'
});
pages.messages.bm = withBase(pages.messages.fr, {
  otherUser: 'Baarakɛla',
  placeholder: 'I ka cikan sɛbɛn...',
  sendMessageAria: 'Cikan ci'
});
pages.messages.mos = withBase(pages.messages.fr, {
  otherUser: 'Ned',
  placeholder: 'Gʋls f koeesã...',
  sendMessageAria: 'Tu koeesã'
});

pages.commissionDashboard.wo = withBase(pages.commissionDashboard.fr, {
  checkingAccess: 'Mi ngi seet sañ-sañ yi...',
  accessReserved: 'Famakan Kontaga Master rekk moo ko yelloo',
  title: '💼 Dashboard - komision propriétaire',
  subtitle: 'Toppaatal sa 14% komision ci fey yépp',
  receptionAccounts: '🏦 Say kontu jot',
  history: '📋 Jaar-jaaru komision yi',
  refresh: '🔄 Yeesal'
});
pages.commissionDashboard.bm = withBase(pages.commissionDashboard.fr, {
  checkingAccess: 'Bɛ sira ɲini...',
  accessReserved: 'Famakan Kontaga Master dɔrɔn de ye',
  title: '💼 Tableau de bord - commissionw',
  subtitle: 'I ka commission automatique 14% filɛ sara bɛɛ kan',
  receptionAccounts: '🏦 I ka konto minnu bɛ sara sɔrɔ',
  history: '📋 Commission tariku',
  refresh: '🔄 Kura'
});
pages.commissionDashboard.mos = withBase(pages.commissionDashboard.fr, {
  checkingAccess: 'A gese sañ-sañ...',
  accessReserved: 'Famakan Kontaga Master bal n tar sañ-sã',
  title: '💼 Tableau de bord - komision',
  subtitle: 'Gese f komision automatique 14% yaoolã bãmb',
  receptionAccounts: '🏦 F konto sẽn deeg yaool',
  history: '📋 Komision gulsgo',
  refresh: '🔄 Lebg n ges'
});

pages.profile.wo = withBase(pages.profile.fr, {
  workerProfileSection: 'Profil liggéeykat',
  photoTitle: 'Nataalu profil',
  professionalInfo: 'Xibaar yu jëm ci liggéey',
  bio: 'Bio bu liggéey',
  skills: 'Mën-mën',
  availability: 'Jàppandikoo',
  createWorkerProfile: 'Sos profil bu liggéeykat'
});
pages.profile.bm = withBase(pages.profile.fr, {
  workerProfileSection: 'Baarakɛla profil',
  photoTitle: 'Profil foto',
  professionalInfo: 'Baara kibaru',
  bio: 'Baara ko fɔli',
  skills: 'Se ka kɛw',
  availability: 'A bɛ se',
  createWorkerProfile: 'Baarakɛla profil da'
});
pages.profile.mos = withBase(pages.profile.fr, {
  workerProfileSection: 'Tʋʋm-neda profil',
  photoTitle: 'Profil pɩture',
  professionalInfo: 'Tʋʋm kibare',
  bio: 'Tʋʋm goama',
  skills: 'Minimã',
  availability: 'Beoogre',
  createWorkerProfile: 'Ning tʋʋm-neda profil'
});

pages.dashboard = {
  fr: {
    loading: 'Chargement du tableau de bord...',
    recentBudget: '{min} - {max} XOF',
    status_open: 'Ouvert',
    status_in_progress: 'En cours',
    status_completed: 'Complété',
    status_cancelled: 'Annulé'
  },
  en: {
    loading: 'Loading dashboard...',
    recentBudget: '{min} - {max} XOF',
    status_open: 'Open',
    status_in_progress: 'In progress',
    status_completed: 'Completed',
    status_cancelled: 'Cancelled'
  }
};
pages.dashboard.wo = withBase(pages.dashboard.fr, {
  loading: 'Mi ngi yebbi dashboard bi...',
  status_open: 'Ubbeeku',
  status_in_progress: 'Mi ngi dox',
  status_completed: 'Jeexna',
  status_cancelled: 'Neenal'
});
pages.dashboard.bm = withBase(pages.dashboard.fr, {
  loading: 'Bɛ tableau de bord kalan...',
  status_open: 'Dayɛlɛn',
  status_in_progress: 'Bɛ sen',
  status_completed: 'Banbali',
  status_cancelled: 'Dabila'
});
pages.dashboard.mos = withBase(pages.dashboard.fr, {
  loading: 'A kareng tableau de bord...',
  status_open: 'Yɔɔgda',
  status_in_progress: 'A tʋmda',
  status_completed: 'A séose',
  status_cancelled: 'A yãage'
});

pages.register = {
  fr: {
    title: 'Créer un compte',
    subtitle: 'Rejoignez la communauté Kojo',
    geoDetecting: 'Détection de votre position...',
    positionDetected: 'Position détectée',
    adjustedAutomatically: 'Pays et préfixe téléphonique ajustés automatiquement',
    positionNotDetected: 'Position non détectée',
    emailPlaceholder: 'exemple@email.com',
    phonePlaceholder: '77 123 45 67',
    phoneFormatHint: 'Format téléphone',
    workerStepNotice: 'En tant que travailleur, vous ajouterez ensuite vos comptes de paiement pour recevoir vos gains.',
    clientStepNotice: 'En tant que client, vous ajouterez ensuite un moyen de paiement pour régler vos jobs.',
    continueButton: 'Continuer vers la vérification paiement',
    signInPrompt: 'Vous avez déjà un compte ?'
  },
  en: {
    title: 'Create an account',
    subtitle: 'Join the Kojo community',
    geoDetecting: 'Detecting your position...',
    positionDetected: 'Position detected',
    adjustedAutomatically: 'Country and phone prefix adjusted automatically',
    positionNotDetected: 'Position not detected',
    emailPlaceholder: 'example@email.com',
    phonePlaceholder: '77 123 45 67',
    phoneFormatHint: 'Phone format',
    workerStepNotice: 'As a worker, you will add your payment accounts next to receive your earnings.',
    clientStepNotice: 'As a client, you will add a payment method next to pay for your jobs.',
    continueButton: 'Continue to payment verification',
    signInPrompt: 'Already have an account?'
  }
};
pages.register.wo = withBase(pages.register.fr, {
  title: 'Sos konto',
  subtitle: 'Bokk ci mbokkum Kojo',
  geoDetecting: 'Mi ngi seet sa bér...',
  positionDetected: 'Bér bi gis nañu ko',
  adjustedAutomatically: 'Réew mi ak prefixu telefon bi ñu ko réglé otomatik',
  positionNotDetected: 'Gisuñu bér bi',
  phoneFormatHint: 'Formatu telefon',
  workerStepNotice: 'Boo nekkee liggéeykat, nga topp ca yapale sa kontu fey ngir jot sa xaalis.',
  clientStepNotice: 'Boo nekkee kliyan, nga topp ca yapale beneen yoon wu fey ngir fey sa jobs yi.',
  continueButton: 'Doxal ba ci vérification paiement',
  signInPrompt: 'Am nga konto ba noppi?'
});
pages.register.bm = withBase(pages.register.fr, {
  title: 'Konto da',
  subtitle: 'Kojo ka jɛya la don',
  geoDetecting: 'Bɛ i ka yɔrɔ ɲini...',
  positionDetected: 'Yɔrɔ dɔnnen',
  adjustedAutomatically: 'Jamana ni telefɔni prefix ladilanlen don',
  positionNotDetected: 'Yɔrɔ ma dɔn',
  phoneFormatHint: 'Telefɔni fɔrɔma',
  workerStepNotice: 'Ni i ye baarakɛla ye, i bɛ sara konto fara a kan walasa i ka wari sɔrɔ.',
  clientStepNotice: 'Ni i ye kliyan ye, i bɛ sara fɛɛrɛ dɔ fara a kan walasa i ka baaraw sara.',
  continueButton: 'Tɛmɛn ka taa paiement verification la',
  signInPrompt: 'I bɛ konto sɔrɔ kelen kɛ?'
});
pages.register.mos = withBase(pages.register.fr, {
  title: 'Ning konto',
  subtitle: 'Kẽ Kojo yinga',
  geoDetecting: 'A bao f zĩiga...',
  positionDetected: 'Zĩiga bãngame',
  adjustedAutomatically: 'Tẽng la telefõne prefix manegame otomatik',
  positionNotDetected: 'Zĩiga ka bãng',
  phoneFormatHint: 'Telefõne format',
  workerStepNotice: 'F yɩɩ tʋʋm-neda, bɩ n paam yaool yĩnga f n deeg f ligdi.',
  clientStepNotice: 'F yɩɩ daaba, bɩ n paam yaool sira n yaool f tʋʋma.',
  continueButton: 'Kẽ n tɛed paiement verification',
  signInPrompt: 'F tara konto n yaa?'
});

pages.paymentDemo = {
  fr: {
    title: '🌍 Démonstration langues & paiements',
    newFeatures: '🎯 Nouvelles fonctionnalités ajoutées',
    feat1: '✅ Support de l\'anglais ajouté',
    feat2: '✅ Méthodes de paiement: Carte bancaire, Orange Money, Wave',
    feat3: '✅ Système de commission automatique (14% propriétaire, 86% travailleur)',
    feat4: '✅ Traductions complètes en 5 langues (FR, EN, WO, BM, MOS)',
    feat5: '✅ Sélecteur de pays automatique',
    commissionTitle: '🚗 Commission automatique',
    showCommission: 'Tester commission',
    hideCommission: 'Masquer',
    howItWorks: 'Comment ça marche',
    howItWorksText: 'Chaque paiement est automatiquement divisé.',
    ownerShare: '14% vers le propriétaire de l\'application',
    workerShare: '86% vers le travailleur',
    autoTransfer: 'Les transferts partent automatiquement vers les comptes préférés',
    serviceAmount: 'Montant du service (XOF)',
    totalAmount: 'Montant total',
    yourCommission: 'Votre commission (14%)',
    toWorker: 'Vers travailleur (86%)',
    simulatePayment: '🚀 Simuler paiement',
    processing: '⏳ Traitement...',
    paymentSuccess: '✅ Paiement et commission réussis',
    paymentError: '❌ Erreur de paiement',
    transactionId: 'Transaction ID',
    message: 'Message',
    commissionDetails: 'Détails commission',
    seeCommissionDashboard: 'Voir le tableau de bord des commissions',
    languageSelector: '🗣️ Sélecteur de langues',
    dropdownVersion: 'Version menu',
    buttonVersion: 'Version boutons',
    translationExamples: 'Exemples de traductions',
    paymentMethodsTitle: '💳 Méthodes de paiement',
    countryLabel: 'Pays',
    amountLabel: 'Montant (XOF)',
    noCommissionTitle: '💰 Simulation de paiement (sans commission)',
    technicalInfo: '🔧 Informations techniques',
    supportedLanguages: 'Langues supportées',
    supportedMethods: 'Méthodes de paiement',
    supportedCountries: 'Pays supportés',
    currency: 'Monnaie',
    automaticCommission: 'Commission automatique',
    note: 'Note',
    noteText: 'Ceci est une démonstration - les paiements sont simulés',
    exampleHomeKey: 'Clé home',
    exampleJobsKey: 'Clé jobs',
    examplePaymentKey: 'Clé payment',
    exampleBankCardKey: 'Clé bankCard',
    supportedLanguagesValue: '{french}, {english}, {wolof}, {bambara}, {moore}',
    supportedMethodsValue: '{bankCard} (2.5%), {orangeMoney} (1%), {wave} (gratuit)',
    currencyValue: 'Franc CFA (XOF)',
    automaticCommissionValue: '14% propriétaire, 86% travailleur',
    paymentAlertSuccess: 'Paiement réussi ! Transaction : {id}',
    paymentAlertError: 'Erreur de paiement : {error}'
  },
  en: {
    title: '🌍 Languages & payments demo',
    newFeatures: '🎯 New features added',
    feat1: '✅ English support added',
    feat2: '✅ Payment methods: Bank card, Orange Money, Wave',
    feat3: '✅ Automatic commission system (14% owner, 86% worker)',
    feat4: '✅ Complete translations in 5 languages (FR, EN, WO, BM, MOS)',
    feat5: '✅ Automatic country selector',
    commissionTitle: '🚗 Automatic commission',
    showCommission: 'Test commission',
    hideCommission: 'Hide',
    howItWorks: 'How it works',
    howItWorksText: 'Each payment is split automatically.',
    ownerShare: '14% goes to the app owner',
    workerShare: '86% goes to the worker',
    autoTransfer: 'Transfers are sent automatically to preferred accounts',
    serviceAmount: 'Service amount (XOF)',
    totalAmount: 'Total amount',
    yourCommission: 'Your commission (14%)',
    toWorker: 'To worker (86%)',
    simulatePayment: '🚀 Simulate payment',
    processing: '⏳ Processing...',
    paymentSuccess: '✅ Payment and commission successful',
    paymentError: '❌ Payment error',
    transactionId: 'Transaction ID',
    message: 'Message',
    commissionDetails: 'Commission details',
    seeCommissionDashboard: 'See commission dashboard',
    languageSelector: '🗣️ Language selector',
    dropdownVersion: 'Dropdown version',
    buttonVersion: 'Button version',
    translationExamples: 'Translation examples',
    paymentMethodsTitle: '💳 Payment methods',
    countryLabel: 'Country',
    amountLabel: 'Amount (XOF)',
    noCommissionTitle: '💰 Payment simulation (without commission)',
    technicalInfo: '🔧 Technical information',
    supportedLanguages: 'Supported languages',
    supportedMethods: 'Payment methods',
    supportedCountries: 'Supported countries',
    currency: 'Currency',
    automaticCommission: 'Automatic commission',
    note: 'Note',
    noteText: 'This is a demo - payments are simulated',
    exampleHomeKey: 'Home key',
    exampleJobsKey: 'Jobs key',
    examplePaymentKey: 'Payment key',
    exampleBankCardKey: 'Bank card key',
    supportedLanguagesValue: '{french}, {english}, {wolof}, {bambara}, {moore}',
    supportedMethodsValue: '{bankCard} (2.5%), {orangeMoney} (1%), {wave} (free)',
    currencyValue: 'CFA franc (XOF)',
    automaticCommissionValue: '14% owner, 86% worker',
    paymentAlertSuccess: 'Payment successful! Transaction: {id}',
    paymentAlertError: 'Payment error: {error}'
  }
};
pages.paymentDemo.wo = withBase(pages.paymentDemo.fr, {
  title: '🌍 Demo làkk ak paiement',
  newFeatures: '🎯 Fonkisiyon yu bees',
  commissionTitle: '🚗 Komision otomatik',
  showCommission: 'Wone komision',
  howItWorks: 'Naka lay doxee',
  serviceAmount: 'Xaalisu service bi (XOF)',
  totalAmount: 'Xaalis bi mépp',
  yourCommission: 'Sa komision (14%)',
  toWorker: 'Ci liggéeykat bi (86%)',
  simulatePayment: '🚀 Def simulate paiement',
  processing: '⏳ Mi ngi liggéey...',
  paymentSuccess: '✅ Paiement ak komision baax na',
  paymentError: '❌ Njuumte paiement',
  languageSelector: '🗣️ Tannukaayu làkk',
  paymentMethodsTitle: '💳 Yoonu paiement',
  countryLabel: 'Réew',
  amountLabel: 'Xaalis (XOF)',
  noCommissionTitle: '💰 Similasiyoŋ paiement',
  technicalInfo: '🔧 Xibaar yu teknik'
});
pages.paymentDemo.bm = withBase(pages.paymentDemo.fr, {
  title: '🌍 Kan ni paiement demo',
  newFeatures: '🎯 Fɛɛrɛ kura',
  commissionTitle: '🚗 Commission automatique',
  showCommission: 'Commission filɛ',
  howItWorks: 'A bɛ kɛ cogo min na',
  serviceAmount: 'Baara sara (XOF)',
  totalAmount: 'Wari bɛɛ',
  yourCommission: 'I ka commission (14%)',
  toWorker: 'Baarakɛla ma (86%)',
  simulatePayment: '🚀 Paiement simuler',
  processing: '⏳ Bɛ baara kɛ...',
  paymentSuccess: '✅ Paiement ni commission seka!',
  paymentError: '❌ Paiement fili',
  languageSelector: '🗣️ Kan sugandibaga',
  paymentMethodsTitle: '💳 Sara fɛɛrɛw',
  countryLabel: 'Jamana',
  amountLabel: 'Wari (XOF)',
  noCommissionTitle: '💰 Paiement demo (commission tɛ)',
  technicalInfo: '🔧 Teknik kibaru'
});
pages.paymentDemo.mos = withBase(pages.paymentDemo.fr, {
  title: '🌍 Demo buud-gomde la paiement',
  newFeatures: '🎯 Noy taaba',
  commissionTitle: '🚗 Komision otomatik',
  showCommission: 'Ges komision',
  howItWorks: 'A tʋmda woto',
  serviceAmount: 'Service ligdi (XOF)',
  totalAmount: 'Ligdi fãa',
  yourCommission: 'F komision (14%)',
  toWorker: 'Na n tʋʋm-neda (86%)',
  simulatePayment: '🚀 Ning paiement demo',
  processing: '⏳ A tʋmda...',
  paymentSuccess: '✅ Paiement la komision n be neere',
  paymentError: '❌ Yelle paiement',
  languageSelector: '🗣️ Gomde sugri',
  paymentMethodsTitle: '💳 Yaool buudu',
  countryLabel: 'Tẽng',
  amountLabel: 'Ligdi (XOF)',
  noCommissionTitle: '💰 Paiement demo (komision ka be)',
  technicalInfo: '🔧 Teknik kibare'
});

pages.photoTest = {
  fr: {
    title: '🧪 Test photo de profil',
    subtitle: 'Page de debug pour tester le système de photos',
    userInfo: 'Informations utilisateur',
    photoComponent: 'Test du composant photo',
    editableMode: 'Mode éditable',
    clickToEdit: 'Cliquez pour modifier',
    readMode: 'Mode lecture',
    readOnly: 'Lecture seule',
    smallFormat: 'Petit format',
    manualTests: 'Tests manuels',
    directFileTest: 'Test sélection fichier direct',
    addLog: 'Ajouter log test',
    clearLogs: 'Vider logs',
    testLogs: 'Logs de test',
    entriesCount: '{count} entrée(s)',
    browserInfo: 'Informations navigateur',
    userAgent: 'User Agent',
    fileApi: 'Support File API',
    canvas: 'Support Canvas',
    localStorage: 'Support LocalStorage',
    supported: '✅ Supporté',
    unsupported: '❌ Non supporté',
    noFileSelected: 'Aucun fichier sélectionné',
    fileInputTesting: 'Test de sélection manuelle de fichier...',
    manualLogEntry: 'Entrée de log manuelle'
  },
  en: {
    title: '🧪 Profile photo test',
    subtitle: 'Debug page to test the photo system',
    userInfo: 'User information',
    photoComponent: 'Photo component test',
    editableMode: 'Editable mode',
    clickToEdit: 'Click to edit',
    readMode: 'Read mode',
    readOnly: 'Read only',
    smallFormat: 'Small format',
    manualTests: 'Manual tests',
    directFileTest: 'Direct file selection test',
    addLog: 'Add test log',
    clearLogs: 'Clear logs',
    testLogs: 'Test logs',
    entriesCount: '{count} entry(ies)',
    browserInfo: 'Browser information',
    userAgent: 'User Agent',
    fileApi: 'File API support',
    canvas: 'Canvas support',
    localStorage: 'LocalStorage support',
    supported: '✅ Supported',
    unsupported: '❌ Not supported',
    noFileSelected: 'No file selected',
    fileInputTesting: 'Testing manual file input...',
    manualLogEntry: 'Manual log entry'
  }
};
pages.photoTest.wo = withBase(pages.photoTest.fr, {
  title: '🧪 Test nataalu profil',
  subtitle: 'Xët bu debug ngir seet sistem nataal bi',
  userInfo: 'Xibaaru jëfandikookat',
  photoComponent: 'Test bu kompozaŋ nataal',
  editableMode: 'Mode soppi',
  clickToEdit: 'Bësal ngir soppi',
  readMode: 'Mode jàng',
  manualTests: 'Test yu loxo',
  directFileTest: 'Test tann fichier bu jub',
  addLog: 'Yokk log',
  clearLogs: 'Far logs yi',
  testLogs: 'Logs yu test'
});
pages.photoTest.bm = withBase(pages.photoTest.fr, {
  title: '🧪 Profil foto test',
  subtitle: 'Debug duw ka foto system filɛ',
  userInfo: 'Baarakɛla kibaru',
  photoComponent: 'Foto composant test',
  editableMode: 'Sopili mode',
  clickToEdit: 'A digi ka soppi',
  readMode: 'Kalan mode',
  manualTests: 'Bololabolo testw',
  directFileTest: 'Fichier sugandi test',
  addLog: 'Log fara',
  clearLogs: 'Logw bɔ',
  testLogs: 'Test logw'
});
pages.photoTest.mos = withBase(pages.photoTest.fr, {
  title: '🧪 Profil pɩture test',
  subtitle: 'Debug page n ges pɩture system',
  userInfo: 'Ned kibare',
  photoComponent: 'Pɩture composant test',
  editableMode: 'Tek mode',
  clickToEdit: 'Pɩlg n tek',
  readMode: 'Kare mode',
  manualTests: 'Lɔɔm test',
  directFileTest: 'Fichier sugri test',
  addLog: 'Paas log',
  clearLogs: 'Moa logs',
  testLogs: 'Test logs'
});

pages.mobileTest = {
  fr: {
    backToDashboard: 'Retour au dashboard',
    title: 'Test mobile Kojo',
    appInfo: '📱 Informations sur l\'application mobile',
    featuresImplemented: '✅ Fonctionnalités implémentées',
    screensIntegrated: '📱 Écrans intégrés',
    testOnMobile: '🚀 Pour tester sur mobile',
    troubleshooting: '🔧 Dépannage',
    feat1: '• Service de gestion d\'images complet (ImageService)',
    feat2: '• Composant ProfilePhoto réutilisable',
    feat3: '• Intégration expo-image-picker pour caméra/galerie',
    feat4: '• Validation et compression d\'images',
    feat5: '• Sauvegarde locale avec AsyncStorage',
    feat6: '• Upload simulé vers serveur',
    feat7: '• Gestion des permissions natives',
    screen1: '• ProfileScreen - Édition de photo avec boutons caméra',
    screen2: '• EditProfileScreen - Formulaire avec photo intégrée',
    screen3: '• DashboardScreen - Photo dans l\'en-tête',
    screen4: '• WorkerProfileScreen - Affichage photos des travailleurs',
    screen5: '• CameraScreen - Interface caméra native',
    step1: '1. Installer Expo Go sur votre téléphone (Android/iOS)',
    step2: '2. Démarrer l\'app mobile',
    step3: '3. Scanner le QR code avec Expo Go',
    step4: '4. Tester les photos dans Profil > Modifier photo',
    help1: '• Vérifier que l\'app mobile React Native fonctionne',
    help2: '• S\'assurer d\'avoir les permissions caméra/galerie',
    help3: '• Tester sur un vrai téléphone (pas navigateur)',
    help4: '• Vérifier la connexion Expo Go'
  },
  en: {
    backToDashboard: 'Back to dashboard',
    title: 'Kojo mobile test',
    appInfo: '📱 Mobile app information',
    featuresImplemented: '✅ Implemented features',
    screensIntegrated: '📱 Integrated screens',
    testOnMobile: '🚀 To test on mobile',
    troubleshooting: '🔧 Troubleshooting',
    feat1: '• Complete image management service (ImageService)',
    feat2: '• Reusable ProfilePhoto component',
    feat3: '• expo-image-picker integration for camera/gallery',
    feat4: '• Image validation and compression',
    feat5: '• Local save with AsyncStorage',
    feat6: '• Simulated upload to server',
    feat7: '• Native permissions handling',
    screen1: '• ProfileScreen - Photo editing with camera buttons',
    screen2: '• EditProfileScreen - Form with integrated photo',
    screen3: '• DashboardScreen - Photo in the header',
    screen4: '• WorkerProfileScreen - Worker photo display',
    screen5: '• CameraScreen - Native camera interface',
    step1: '1. Install Expo Go on your phone (Android/iOS)',
    step2: '2. Start the mobile app',
    step3: '3. Scan the QR code with Expo Go',
    step4: '4. Test photos in Profile > Edit photo',
    help1: '• Check that the React Native mobile app is running',
    help2: '• Make sure camera/gallery permissions are granted',
    help3: '• Test on a real phone (not a browser)',
    help4: '• Check the Expo Go connection'
  }
};
pages.mobileTest.wo = withBase(pages.mobileTest.fr, {
  backToDashboard: 'Dellu ci dashboard',
  title: 'Test mobile Kojo',
  appInfo: '📱 Xibaar ci app mobile bi',
  featuresImplemented: '✅ Fonkisiyon yu sampu',
  screensIntegrated: '📱 Ekran yi dugal nañu leen',
  testOnMobile: '🚀 Ngir test ci mobile',
  troubleshooting: '🔧 Defar njuumte'
});
pages.mobileTest.bm = withBase(pages.mobileTest.fr, {
  backToDashboard: 'Segin ka taa dashboard la',
  title: 'Kojo mobile test',
  appInfo: '📱 Mobile app kibaru',
  featuresImplemented: '✅ Fɛɛrɛw minnu dafalen',
  screensIntegrated: '📱 Écran minnu don',
  testOnMobile: '🚀 Ka test kɛ mobile kan',
  troubleshooting: '🔧 Dɛpannage'
});
pages.mobileTest.mos = withBase(pages.mobileTest.fr, {
  backToDashboard: 'Lebg n kẽ dashboard',
  title: 'Kojo mobile test',
  appInfo: '📱 Mobile app kibare',
  featuresImplemented: '✅ Noy sẽn ninge',
  screensIntegrated: '📱 Écran sẽn paase',
  testOnMobile: '🚀 N ges mobile pʋgẽ',
  troubleshooting: '🔧 Songre'
});

export const makeScopedTranslator = (currentLanguage, fallbackT, scope) => {
  const section = pages[scope] || {};
  const primary = section[currentLanguage] || {};
  const englishFallback = section.en || {};
  const frenchFallback = section.fr || {};

  return (key, vars = {}) => {
    let value =
      primary[key] ??
      englishFallback[key] ??
      frenchFallback[key] ??
      (typeof fallbackT === 'function' ? fallbackT(key) : key);

    if (typeof value !== 'string') {
      return value ?? key;
    }

    return value.replace(/\{(\w+)\}/g, (_, name) => {
      const replacement = vars[name];
      return replacement === undefined || replacement === null ? '' : String(replacement);
    });
  };
};
