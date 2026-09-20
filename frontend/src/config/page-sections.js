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
// Textes FRANÇAIS que la coquille de /support publie. Ils vivent ici — et non
// dans Support.js — parce que le build les écrit, et Support.js les LIT pour son
// dictionnaire français : un seul exemplaire du texte, donc pas de seconde
// déclaration à faire suivre. Les quatre autres langues restent dans Support.js.
export const SUPPORT_COPY_FR = {
  title: 'Support',
  subtitle: 'Une question, un problème ? Nous sommes là pour vous aider.',
  robotTitle: 'Parler avec le robot',
  robotSubtitle: "L'assistant vous guide en quelques questions",
  directTitle: 'Contacter directement le support',
  directSubtitle: 'Appel, e-mail ou WhatsApp',
  directCardTitle: 'Contacter directement le support',
  directCardSubtitle: 'Nous sommes joignables aux coordonnées ci-dessous.',
  call: 'Appeler',
  whatsapp: 'WhatsApp',
  sendEmail: 'Envoyer un e-mail',
  address: 'Adresse',
};

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
      { labelKey: 'general', icon: '🛠️' },
      { labelKey: 'plumbing', icon: '🔧' },
      { labelKey: 'electrical', icon: '⚡' },
      { labelKey: 'construction', icon: '🏗️' },
      { labelKey: 'cleaning', icon: '🧽' },
      { labelKey: 'gardening', icon: '🌱' },
      { labelKey: 'tutoring', icon: '📚' },
      { labelKey: 'mechanics', icon: '🔩' },
      { labelKey: 'carpentry', icon: '🪚' },
      { labelKey: 'computing', icon: '💻' },
    ],
    promises: [
      { icon: '💼', titleKey: 'findWork', descriptionKey: 'findWorkDescription' },
      { icon: '🤝', titleKey: 'connect', descriptionKey: 'connectDescription' },
      { icon: '💰', titleKey: 'securePayments', descriptionKey: 'securePaymentsDescription' },
    ],
    steps: [
      { icon: '1️⃣', titleKey: 'homeStep1Title', descriptionKey: 'homeStep1Desc' },
      { icon: '2️⃣', titleKey: 'homeStep2Title', descriptionKey: 'homeStep2Desc' },
      { icon: '3️⃣', titleKey: 'homeStep3Title', descriptionKey: 'homeStep3Desc' },
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
  },

  // /how-it-works : la coquille répliquait TROIS listes de src/pages/HowItWorks.js
  // — les trois étapes, les quatre garanties de séquestre et les cinq questions
  // de la FAQ — écrites en littéraux au mauvais endroit. Ajouter une question à
  // la page laissait la coquille derrière, en silence : le même défaut que les
  // pages de confiance, sur une page de contenu.
  '/how-it-works': {
    steps: [
      { icon: '📝', titleKey: 'howStep1Title', descriptionKey: 'howStep1Desc' },
      { icon: '🛡️', titleKey: 'howStep2Title', descriptionKey: 'howStep2Desc' },
      { icon: '✅', titleKey: 'howStep3Title', descriptionKey: 'howStep3Desc' },
    ],
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
  },

  // /support : le bloc de contact de la coquille était recopié, libellé par
  // libellé, face au dictionnaire de src/pages/Support.js.
  '/support': {
    texts: SUPPORT_COPY_FR,
    modes: [
      {
        shellIcon: '💬',
        badgeClass: 'bg-orange-100 text-orange-600',
        title: SUPPORT_COPY_FR.robotTitle,
        subtitle: SUPPORT_COPY_FR.robotSubtitle,
      },
      {
        shellIcon: '📞',
        badgeClass: 'bg-emerald-100 text-emerald-600',
        title: SUPPORT_COPY_FR.directTitle,
        subtitle: SUPPORT_COPY_FR.directSubtitle,
      },
    ],
    rows: [
      {
        shellIcon: '📞',
        label: SUPPORT_COPY_FR.call,
        badgeClass: 'bg-orange-100 text-orange-600',
        href: telHref,
        value: CONTACT.phoneDisplay,
        rowClass: LIGNE_LIEN,
      },
      {
        shellIcon: '💬',
        label: SUPPORT_COPY_FR.whatsapp,
        badgeClass: 'bg-emerald-100 text-emerald-600',
        href: CONTACT.whatsappUrl,
        value: CONTACT.phoneDisplay,
        external: true,
        rowClass: LIGNE_LIEN,
      },
      {
        shellIcon: '✉️',
        label: SUPPORT_COPY_FR.sendEmail,
        badgeClass: 'bg-blue-100 text-blue-600',
        href: mailtoHref,
        value: CONTACT.email,
        breakAll: true,
        rowClass: LIGNE_LIEN,
      },
      {
        shellIcon: '📍',
        label: SUPPORT_COPY_FR.address,
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
      { icon: '💼', titleKey: 'findWork', descriptionKey: 'findWorkDescription' },
      { icon: '🤝', titleKey: 'connect', descriptionKey: 'connectDescription' },
      { icon: '💰', titleKey: 'securePayments', descriptionKey: 'securePaymentsDescription' },
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
    actions: [
      {
        icon: '📞',
        label: 'Appeler',
        badgeClass: 'bg-orange-100 text-orange-600',
        href: telHref,
        value: CONTACT.phoneDisplay,
      },
      {
        icon: '💬',
        label: 'WhatsApp',
        badgeClass: 'bg-emerald-100 text-emerald-600',
        href: CONTACT.whatsappUrl,
        value: CONTACT.phoneDisplay,
        external: true,
      },
      {
        icon: '✉️',
        label: 'Envoyer un e-mail',
        badgeClass: 'bg-blue-100 text-blue-600',
        href: mailtoHref,
        value: CONTACT.email,
        breakAll: true,
      },
      {
        icon: '📍',
        label: 'Adresse',
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
