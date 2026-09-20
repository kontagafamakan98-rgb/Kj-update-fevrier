// Extension explicite, et attribut sur l'import JSON : ce fichier est chargé par
// Node (vite.config.js écrit les coquilles pré-rendues avec lui) autant que par
// le bundle — Node n'exécute pas d'import relatif sans extension, ni d'import
// JSON sans `with { type: 'json' }`.
import { CONTACT, mailtoHref, telHref } from './contact.js';

// Plan UNIQUE du corps des pages pré-rendues « de confiance » : /about,
// /contact, /privacy — celles qu'un moteur (et une régie publicitaire) exige
// avant de faire crédit au site.
//
// ── Ce que ce fichier supprime ──────────────────────────────────────────────
// Le corps de ces trois pages avait DEUX propriétaires : les listes de la page
// React (`PROMISES` dans About.js, `SECTIONS` dans Privacy.js, les quatre lignes
// de contact écrites à la main dans Contact.js) et les mêmes listes recopiées en
// clés littérales dans les coquilles de vite.config.js. Les textes, eux,
// venaient déjà d'une seule source (src/i18n/*.json) ; ce qui divergeait, c'est
// l'ENSEMBLE : ajouter une quatrième promesse à /about ne touchait pas la
// coquille, et un crawler sans JavaScript lisait une page amputée sans qu'aucun
// test ne rougisse. C'est la classe de défaut que le dépôt a passé des semaines à
// supprimer (table des textes de page, cartes OG, bloc social) : la voici fermée
// pour les pages les plus récentes.
//
// Les clés i18n restent la SEULE source de texte (résolues dans
// src/i18n/fr.json au build, et dans la langue de l'utilisateur au runtime) : ce
// fichier déclare QUELLES clés une page publie, dans quel ordre, avec quelles
// données non textuelles (icônes, destination d'un lien, accent d'une ligne). Le
// build refuse une coquille qui ne porte pas tout ce qui est déclaré ici (voir
// `exigerCorpsDeclare` dans vite.config.js).
export const PAGE_SECTIONS = {
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
 * Clés i18n que le corps d'une page publie, dans l'ordre où il les publie.
 *
 * C'est ce qui permet au build de REFUSER une coquille incomplète sans tenir une
 * seconde liste : les clés attendues se déduisent de la déclaration ci-dessus,
 * jamais d'une table écrite à côté.
 *
 * @param {object} plan Plan d'une page (`PAGE_SECTIONS[route]`).
 * @returns {string[]} Clés i18n, dédoublonnées par ordre d'apparition.
 */
export function pageSectionTextKeys(plan) {
  const keys = [plan.titleKey, plan.introKey, plan.noteKey].filter(Boolean);
  for (const card of plan.cards || []) keys.push(card.titleKey, card.descriptionKey);
  if (plan.highlight) {
    keys.push(plan.highlight.titleKey, plan.highlight.textKey, plan.highlight.bulletsKey);
  }
  for (const section of plan.sections || []) keys.push(section.titleKey, section.bodyKey);
  for (const link of plan.links || []) keys.push(link.labelKey);
  return [...new Set(keys)];
}

/**
 * Textes NON traduits d'une page : ce qu'une ligne de contact publie et que les
 * dictionnaires ne portent pas (libellé, valeur affichée, destination).
 *
 * Ils comptent autant que les clés : une coquille qui aurait gardé trois lignes
 * sur quatre se verrait ici comme ailleurs.
 *
 * @param {object} plan Plan d'une page (`PAGE_SECTIONS[route]`).
 * @returns {string[]} Textes littéraux attendus dans la coquille.
 */
export function pageSectionLiterals(plan) {
  return (plan.actions || []).flatMap((action) => [action.label, action.value, action.href]);
}
