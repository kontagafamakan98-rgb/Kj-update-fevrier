// Extension explicite, et attribut sur l'import JSON : ce fichier est chargé par
// Node (vite.config.js écrit les coquilles pré-rendues avec lui) autant que par
// le bundle — Node n'exécute pas d'import relatif sans extension, ni d'import
// JSON sans `with { type: 'json' }`.
import { CONTACT, mailtoHref, telHref } from './contact.js';

// Plan UNIQUE du corps des six pages dont la coquille publie une LISTE :
// / (catégories, promesses, étapes, chiffres), /support (modes et lignes de
// contact), /how-it-works (étapes, garanties de séquestre, FAQ), et les pages
// de confiance /about, /contact, /privacy — celles qu'un moteur (et une régie
// publicitaire) exige avant de faire crédit au site.
//
// ── Ce que ce fichier supprime ──────────────────────────────────────────────
// Le corps de ces pages avait DEUX propriétaires : les listes de la page React
// (`PROMISES` dans About.js, `SECTIONS` dans Privacy.js, les quatre lignes de
// contact écrites à la main dans Contact.js, `HOME_COUNTRIES` et les replis de
// chiffres dans Home.js, les étapes et la FAQ de HowItWorks.js) et les mêmes
// listes recopiées en clés littérales dans les coquilles de vite.config.js. Les
// textes, eux, venaient déjà d'une seule source (src/i18n/*.json) ; ce qui
// divergeait, c'est l'ENSEMBLE : ajouter une quatrième promesse à /about ou une
// sixième question à /how-it-works ne touchait pas la coquille, et un crawler
// sans JavaScript lisait une page amputée sans qu'aucun test ne rougisse. C'est
// la classe de défaut que le dépôt a passé des semaines à supprimer (table des
// textes de page, cartes OG, bloc social) : elle est fermée ici pour les six
// pages pré-rendues qui tiennent une liste.
//
// Les clés i18n restent la SEULE source de texte (résolues dans
// src/i18n/fr.json au build, et dans la langue de l'utilisateur au runtime) : ce
// fichier déclare QUELLES clés une page publie, dans quel ordre, avec quelles
// données non textuelles (icônes, destination d'un lien, accent d'une ligne). Le
// build refuse une coquille qui ne porte pas tout ce qui est déclaré ici (voir
// `exigerCorpsDeclare` dans vite.config.js).
// Les deux formes de ligne du bloc de contact : une ligne cliquable (avec son
// survol) et une ligne de simple information. Elles servent aux DEUX canaux.
const LIGNE_LIEN =
  'flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors';
const LIGNE_INFO = 'flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3';

export const PAGE_SECTIONS = {
  // L'accueil : le corps du shell (trois promesses, trois étapes, catégories)
  // était recopié ici, liste par liste, face aux blocs de src/pages/Home.js —
  // ajouter une catégorie ou une promesse à la page laissait la coquille
  // derrière, sans que rien ne rougisse.
  '/': {
    categories: [
      // `labelKey` est AUSSI le code de catégorie canonique du backend : le
      // libellé affiché et le filtre de /jobs sortent donc de la même valeur.
      { labelKey: 'general', iconKey: 'iconCategoryGeneral' },
      { labelKey: 'plumbing', iconKey: 'iconCategoryPlumbing' },
      { labelKey: 'electrical', iconKey: 'iconCategoryElectrical' },
      { labelKey: 'construction', iconKey: 'iconCategoryConstruction' },
      { labelKey: 'cleaning', iconKey: 'iconCategoryCleaning' },
      { labelKey: 'gardening', iconKey: 'iconCategoryGardening' },
      { labelKey: 'tutoring', iconKey: 'iconCategoryTutoring' },
      { labelKey: 'mechanics', iconKey: 'iconCategoryMechanics' },
      { labelKey: 'carpentry', iconKey: 'iconCategoryCarpentry' },
      { labelKey: 'computing', iconKey: 'iconCategoryComputing' },
    ],
    promises: [
      { iconKey: 'iconPromiseFindWork', titleKey: 'findWork', descriptionKey: 'findWorkDescription' },
      { iconKey: 'iconPromiseConnect', titleKey: 'connect', descriptionKey: 'connectDescription' },
      { iconKey: 'iconPromiseSecurePayments', titleKey: 'securePayments', descriptionKey: 'securePaymentsDescription' },
    ],
    steps: [
      { iconKey: 'iconHomeStep1', titleKey: 'homeStep1Title', descriptionKey: 'homeStep1Desc' },
      { iconKey: 'iconHomeStep2', titleKey: 'homeStep2Title', descriptionKey: 'homeStep2Desc' },
      { iconKey: 'iconHomeStep3', titleKey: 'homeStep3Title', descriptionKey: 'homeStep3Desc' },
    ],
    // Les quatre chiffres de l'accueil. La coquille les publiait dans sa propre
    // liste `[['1 000+', 'activeWorkers'], …]`, pendant que la page tenait ses
    // replis (1000, 500, 4, « 24/7 ») de son côté : deux déclarations du même
    // bloc. `shellText` est le texte EXACT que la coquille écrit ; `fallback`
    // est la valeur d'avant /public/stats que la page affiche — les deux, parce
    // que la page passe par `toLocaleString()` (le séparateur de milliers suit
    // la locale du navigateur) et qu'aucun texte ne doit changer ici.
    stats: [
      { labelKey: 'activeWorkers', fallback: 1000, suffix: '+', shellText: '1 000+' },
      { labelKey: 'completedProjects', fallback: 500, suffix: '+', shellText: '500+' },
      { labelKey: 'countriesCovered', fallback: 4, shellText: '4' },
      { labelKey: 'customerSupport', fallback: '24/7', shellText: '24/7' },
    ],
    // Le bloc « séquestre » de l'accueil ouvre sur un glyphe que la page
    // (src/pages/Home.js) et sa coquille publiaient chacune en littéral — le
    // même bouclier, deux domiciles. Comme les icônes des listes, il est
    // déclaré ici : `escrowIconKey` porte la clé i18n, la page l'affiche par
    // t() et la coquille par T(), donc les deux canaux ne peuvent pas
    // publier deux glyphes différents.
    escrowIconKey: 'iconEscrow',
  },

  // /how-it-works : la coquille répliquait TROIS listes de src/pages/HowItWorks.js
  // — les trois étapes, les quatre garanties de séquestre et les cinq questions
  // de la FAQ — écrites en littéraux au mauvais endroit. Ajouter une question à
  // la page laissait la coquille derrière, en silence : le même défaut que les
  // pages de confiance, sur une page de contenu.
  '/how-it-works': {
    steps: [
      { iconKey: 'iconHowStep1', titleKey: 'howStep1Title', descriptionKey: 'howStep1Desc' },
      // L'étape 2 recopiait le bouclier du séquestre en littéral, alors que la
      // clé `iconEscrow` le détient déjà pour le bloc de séquestre de CETTE page
      // (`escrowIconKey`, plus bas) : deux domiciles pour un seul glyphe, sur une
      // même page — changer la clé aurait laissé l'étape derrière, en silence.
      // `iconKey` est résolu par les deux canaux (t() dans la page, T() dans la
      // coquille), comme les autres clés ; les icônes qui n'ont pas de clé
      // gardent `icon` et appartiennent au plan.
      { iconKey: 'iconEscrow', titleKey: 'howStep2Title', descriptionKey: 'howStep2Desc' },
      { iconKey: 'iconHowStep3', titleKey: 'howStep3Title', descriptionKey: 'howStep3Desc' },
    ],
    // Le glyphe du bloc « séquestre détaillé » et le repère du dépliant de la
    // FAQ : la page les écrivait en littéral et la coquille recopiait les
    // mêmes octets. Ils sont ici par leur clé i18n, comme le reste.
    escrowIconKey: 'iconEscrow',
    faqMarkerKey: 'faqMarker',
    // Les garanties sont des CLÉS i18n : le nom du champ finit par `Key`, donc
    // la coquille doit publier leur TEXTE résolu, pas la clé.
    guaranteeKeys: [
      'escrowGuarantee1',
      'escrowGuarantee2',
      'escrowGuarantee3',
      'escrowGuarantee4',
    ],
    faq: [
      { questionKey: 'faq1q', answerKey: 'faq1a' },
      { questionKey: 'faq2q', answerKey: 'faq2a' },
      { questionKey: 'faq3q', answerKey: 'faq3a' },
      { questionKey: 'faq4q', answerKey: 'faq4a' },
      { questionKey: 'faq5q', answerKey: 'faq5a' },
    ],
    titleKey: 'howItWorksTitle',
    heroKey: 'howItWorksHero',
    escrowTitleKey: 'escrowWhatTitle',
    escrowTextKey: 'escrowWhatText',
    faqTitleKey: 'faqTitle',
    readyTitleKey: 'readyToStart',
    lookingKey: 'lookingForServices',
    offerKey: 'offerServices',
    links: [
      { to: '/jobs', labelKey: 'viewJobs' },
      { to: '/support', labelKey: 'support' },
    ],
  },

  '/jobs': {
    titleKey: 'availableJobs',
  },

  '/login': {
    titleKey: 'login',
    emailLabelKey: 'email',
    passwordLabelKey: 'password',
    forgotPasswordLinkKey: 'forgotPasswordLink',
    submitKey: 'login',
    googleLoginKey: 'googleLogin',
    legalNoticeTitleKey: 'legalNoticeTitle',
    legalConsentLinkKey: 'legalConsentLink',
    legalContactLineKey: 'legalContactLine',
    legalNoticeIconKey: 'iconLegalNotice',
    noAccountKey: 'noAccount',
    registerKey: 'register',
  },

  '/register': {
    titleKey: 'title',
    subtitleKey: 'subtitle',
    detectingLocationKey: 'detectingLocation',
    step1TitleKey: 'personalInformation',
    step2TitleKey: 'stepEmail',
    step3TitleKey: 'stepPayments',
    // Les numéros des trois pastilles de progression : la page les écrivait
    // « 1 », « 2 », « 3 » et la coquille les recopiait. Le rang d'une étape
    // est un fragment publié comme un autre, donc une clé i18n.
    step1NumberKey: 'stepNumber1',
    step2NumberKey: 'stepNumber2',
    step3NumberKey: 'stepNumber3',
    stepNoticeKey: 'clientStepNotice',
    stepNoticeIconKey: 'iconStepNotice',
    clientIconKey: 'iconClient',
    workerIconKey: 'iconWorker',
    photoIconKey: 'iconProfilePhoto',
    legalNoticeIconKey: 'iconLegalNotice',
    googleSignupKey: 'googleSignup',
    orSeparatorKey: 'orSeparator',
    userTypeKey: 'userType',
    clientKey: 'client',
    iAmClientKey: 'iAmClient',
    workerKey: 'worker',
    iAmWorkerKey: 'iAmWorker',
    countryKey: 'country',
    firstNameKey: 'firstName',
    lastNameKey: 'lastName',
    emailKey: 'email',
    emailPlaceholderKey: 'emailPlaceholder',
    phoneKey: 'phone',
    phoneFormatHintKey: 'phoneFormatHint',
    passwordKey: 'password',
    passwordTooShortKey: 'passwordTooShort',
    confirmPasswordKey: 'confirmPassword',
    profilePhotoOptionalKey: 'profilePhotoOptional',
    profilePhotoHelpsKey: 'profilePhotoHelps',
    addProfilePhotoKey: 'addProfilePhoto',
    clickToChooseOptionKey: 'clickToChooseOption',
    upToKey: 'upTo',
    detectingLanguageKey: 'detectingLanguage',
    legalNoticeTitleKey: 'legalNoticeTitle',
    legalConsentHelpKey: 'legalConsentHelp',
    legalConsentLinkKey: 'legalConsentLink',
    legalConsentLabelKey: 'legalConsentLabel',
    legalContactLineKey: 'legalContactLine',
    continueButtonKey: 'continueButton',
    signInPromptKey: 'signInPrompt',
    signInKey: 'signIn',
  },

  '/forgot-password': {
    // La pastille de l'étape e-mail : glyphe publié par la page et par la
    // coquille, donc déclaré une fois.
    badgeIconKey: 'iconPasswordReset',
    titleKey: 'forgotPasswordPageTitle',
    subtitleKey: 'forgotPasswordSubtitle',
    stepEmailKey: 'forgotPasswordStepEmail',
    stepCodeKey: 'forgotPasswordStepCode',
    stepPasswordKey: 'forgotPasswordStepPassword',
    emailLabelKey: 'forgotPasswordEmailLabel',
    emailPlaceholderKey: 'email',
    requestMessageKey: 'forgotPasswordRequestMessage',
    sendCodeKey: 'forgotPasswordSendCode',
    backToLoginKey: 'forgotPasswordBackToLogin',
  },

  '/payment': {
    // Le glyphe de la carte « mission requise » (état par défaut, celui que
    // publie la coquille).
    noJobIconKey: 'iconPaymentEmpty',
    titleKey: 'paymentPageTitle',
    subtitleKey: 'paymentPageSubtitle',
    noJobTitleKey: 'paymentPageNoJobTitle',
    noJobTextKey: 'paymentPageNoJobText',
    noJobCtaKey: 'paymentPageNoJobCta',
  },

  // /support : le bloc de contact de la coquille était recopié, libellé par
  // libellé, face au dictionnaire local de src/pages/Support.js — et cinq
  // textes du suivi de ticket (titre, sous-titre, deux placeholders, bouton)
  // étaient écrits EN DUR dans la coquille elle-même. Plus aucun texte ici :
  // les libellés sont des CLÉS i18n comme pour les cinq autres pages,
  // src/i18n/*.json en est le seul propriétaire, la page les lit au runtime et
  // la coquille au build.
  '/support': {
    // Le titre de la page EST le libellé de son lien (même clé que le pied de
    // page et la page de contact) : un seul texte pour un seul mot.
    titleKey: 'support',
    subtitleKey: 'supportSubtitle',
    // La carte de contact publie le titre du mode « contact direct » — même
    // texte, donc même clé (elle était écrite deux fois dans le dictionnaire).
    directCard: {
      titleKey: 'supportDirectTitle',
      subtitleKey: 'supportDirectCardSubtitle',
    },
    // Le suivi de ticket est PUBLIC et visible avant toute interaction : la
    // coquille le publie, donc ses textes se déclarent ici comme les autres.
    tracker: {
      titleKey: 'supportTrackTitle',
      subtitleKey: 'supportTrackSubtitle',
      idPlaceholderKey: 'supportTicketIdPlaceholder',
      emailPlaceholderKey: 'supportTicketEmailPlaceholder',
      ctaKey: 'supportTrackCta',
    },
    modes: [
      {
        shellIconKey: 'iconSupportRobot',
        badgeClass: 'bg-orange-100 text-orange-600',
        titleKey: 'supportRobotTitle',
        subtitleKey: 'supportRobotSubtitle',
      },
      {
        shellIconKey: 'iconSupportDirect',
        badgeClass: 'bg-emerald-100 text-emerald-600',
        titleKey: 'supportDirectTitle',
        subtitleKey: 'supportDirectSubtitle',
      },
    ],
    rows: [
      {
        shellIconKey: 'iconContactCall',
        labelKey: 'contactCall',
        badgeClass: 'bg-orange-100 text-orange-600',
        href: telHref,
        value: CONTACT.phoneDisplay,
        rowClass: LIGNE_LIEN,
      },
      {
        shellIconKey: 'iconContactWhatsapp',
        labelKey: 'contactWhatsapp',
        badgeClass: 'bg-emerald-100 text-emerald-600',
        href: CONTACT.whatsappUrl,
        value: CONTACT.phoneDisplay,
        external: true,
        rowClass: LIGNE_LIEN,
      },
      {
        shellIconKey: 'iconContactSendEmail',
        labelKey: 'contactSendEmail',
        badgeClass: 'bg-blue-100 text-blue-600',
        href: mailtoHref,
        value: CONTACT.email,
        breakAll: true,
        rowClass: LIGNE_LIEN,
      },
      {
        shellIconKey: 'iconContactAddress',
        labelKey: 'contactAddress',
        badgeClass: 'bg-gray-100 text-gray-600',
        value: CONTACT.address,
        rowClass: LIGNE_INFO,
      },
    ],
    links: [
      { to: '/how-it-works', labelKey: 'howItWorksTitle' },
      { to: '/jobs', labelKey: 'viewJobs' },
    ],
  },

  '/about': {
    titleKey: 'aboutTitle',
    introKey: 'aboutIntro',
    cards: [
      { iconKey: 'iconPromiseFindWork', titleKey: 'findWork', descriptionKey: 'findWorkDescription' },
      { iconKey: 'iconPromiseConnect', titleKey: 'connect', descriptionKey: 'connectDescription' },
      { iconKey: 'iconPromiseSecurePayments', titleKey: 'securePayments', descriptionKey: 'securePaymentsDescription' },
    ],
    highlight: {
      titleKey: 'escrowTrustTitle',
      textKey: 'escrowTrustText',
      bulletsKey: 'escrowTrustBullets',
    },
    links: [
      { to: '/contact', labelKey: 'contactTitle' },
      { to: '/privacy', labelKey: 'privacyTitle' },
      { to: '/how-it-works', labelKey: 'howItWorksTitle' },
    ],
  },

  '/contact': {
    titleKey: 'contactTitle',
    introKey: 'contactIntro',
    noteKey: 'contactHelpText',
    // Une ligne de contact = une donnée (icône, libellé, destination, valeur
    // affichée, accent). `href` vient de src/config/contact.js : la règle `tel:`
    // et la règle `mailto:` (sujet compris) n'existent qu'à cet endroit, donc la
    // page et sa coquille ne peuvent pas publier deux liens différents.
    //
    // `badgeClass` / `breakAll` sont l'identité de LA LIGNE (un accent par moyen
    // de contact, un e-mail qui se coupe proprement) et non la mise en page de la
    // page : les deux canaux doivent rendre la même ligne, donc ils la lisent ici
    // plutôt que de la réécrire chacun de leur côté.
    //
    // Les libellés sont des CLÉS i18n, et les QUATRE MÊMES que les lignes de
    // /support (`rows` plus haut) : « Appeler », « WhatsApp », « Envoyer un
    // e-mail », « Adresse » désignent le même moyen de contact sur les deux
    // pages, donc ils n'ont qu'un texte. Ils étaient écrits ici en français, ce
    // qui laissait /contact publier quatre libellés français dans les cinq
    // langues du site pendant que /support les traduisait.
    actions: [
      {
        iconKey: 'iconContactCall',
        labelKey: 'contactCall',
        badgeClass: 'bg-orange-100 text-orange-600',
        href: telHref,
        value: CONTACT.phoneDisplay,
      },
      {
        iconKey: 'iconContactWhatsapp',
        labelKey: 'contactWhatsapp',
        badgeClass: 'bg-emerald-100 text-emerald-600',
        href: CONTACT.whatsappUrl,
        value: CONTACT.phoneDisplay,
        external: true,
      },
      {
        iconKey: 'iconContactSendEmail',
        labelKey: 'contactSendEmail',
        badgeClass: 'bg-blue-100 text-blue-600',
        href: mailtoHref,
        value: CONTACT.email,
        breakAll: true,
      },
      {
        iconKey: 'iconContactAddress',
        labelKey: 'contactAddress',
        badgeClass: 'bg-gray-100 text-gray-600',
        href: CONTACT.mapsUrl,
        value: CONTACT.address,
        external: true,
      },
    ],
    links: [
      { to: '/about', labelKey: 'aboutTitle' },
      { to: '/privacy', labelKey: 'privacyTitle' },
      { to: '/support', labelKey: 'support' },
    ],
  },

  '/privacy': {
    titleKey: 'privacyTitle',
    introKey: 'privacyIntro',
    sections: [
      { titleKey: 'privacyDataTitle', bodyKey: 'privacyDataBody' },
      { titleKey: 'privacyRetentionTitle', bodyKey: 'privacyRetentionBody' },
      { titleKey: 'privacyRightsTitle', bodyKey: 'privacyRightsBody' },
      { titleKey: 'privacyContactSectionTitle', bodyKey: 'privacyContactBody' },
    ],
    links: [
      { to: '/contact', labelKey: 'contactTitle' },
      { to: '/about', labelKey: 'aboutTitle' },
    ],
  },
};

/**
 * Ce qu'un plan déclare publier, séparé en deux : les CLÉS i18n (résolues dans
 * la langue du canal) et les TEXTES littéraux (déjà dans la langue de la
 * coquille).
 *
 * La règle est la convention du dépôt : un champ dont le nom finit par `Key`
 * porte une clé i18n, `Keys` une LISTE de clés ; TOUT autre texte d'un plan est
 * un texte que la coquille doit publier tel quel. Le build s'en sert pour
 * REFUSER une coquille incomplète sans tenir de seconde liste — les attendus se
 * déduisent du plan, jamais d'une table écrite à côté.
 *
 * Corollaire : un plan ne porte AUCUNE donnée interne. Ce qu'un plan déclare
 * est publié par la coquille, sans exception — y compris la valeur d'un lien.
 *
 * @param {object} plan Plan d'une page (`PAGE_SECTIONS[route]`).
 * @returns {{cles: string[], textes: string[]}} Attendus, dédoublonnés.
 */
export function pageSectionParts(plan) {
  const cles = [];
  const textes = [];
  const porteUneCle = (nom) => Boolean(nom) && /Keys?$/.test(nom);
  const visiter = (valeur, nom) => {
    if (typeof valeur === 'string') {
      (porteUneCle(nom) ? cles : textes).push(valeur);
      return;
    }
    if (Array.isArray(valeur)) {
      valeur.forEach((element) => visiter(element, nom));
      return;
    }
    if (valeur && typeof valeur === 'object') {
      Object.entries(valeur).forEach(([cle, sousValeur]) => visiter(sousValeur, cle));
    }
  };
  visiter(plan, null);
  return { cles: [...new Set(cles)], textes: [...new Set(textes)] };
}
