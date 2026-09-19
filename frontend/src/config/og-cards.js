// Import AVEC attribut : ce module est chargé par Node (vite.config.js et les
// gardes de scripts/) autant que par le bundle — Node n'exécute plus un import
// JSON sans `with { type: 'json' }`, et Vite/vitest acceptent la même écriture.
//
// ── La source des cartes, et pourquoi le runtime la lit directement ─────────
// Ces imports sont les FICHIERS DE DONNÉES des cartes (scripts/og-cards/), les
// mêmes que scripts/gen-og-images.py lit pour dessiner les PNG. Le runtime n'en
// lit aucune copie : la carte et sa page sortent donc du MÊME fichier, par
// construction, là où un garde devait auparavant comparer le manifeste au
// fichier de données, champ par champ.
//
// Le manifeste ne porte plus que ce que le générateur a MESURÉ (dimensions et
// empreintes des PNG, lignes réellement dessinées, polices, empreinte du
// générateur) : c'est ce qui permet de prouver qu'un PNG versionné correspond
// encore à sa page, ce qu'aucune déclaration ne peut dire à sa place.
//
// Ajouter une carte dédiée, c'est donc ajouter un fichier de données ET le
// lister ci-dessous. Que ce second geste ne puisse pas être oublié est vérifié
// sur le dépôt réel par src/config/__tests__/og-cards.test.js : chaque fichier
// de scripts/og-cards/ doit être servi par cette table.
import generique from '../../scripts/og-cards/generique.json' with { type: 'json' };
import jobs from '../../scripts/og-cards/jobs.json' with { type: 'json' };
import login from '../../scripts/og-cards/login.json' with { type: 'json' };

import { normalizeRoute } from './route-path.js';

// Route de la carte GÉNÉRIQUE : celle de la racine. Elle sert aussi toute page
// sans visuel dédié (/register, /payment…), et c'est le fichier de données
// (`scripts/og-cards/generique.json`) qui la déclare comme les autres — sa paire
// de fichiers n'est donc écrite nulle part ailleurs.
const ROOT_ROUTE = '/';

// Les cartes déclarées, un objet par fichier de données.
const DECLARED_CARDS = [generique, jobs, login];

/**
 * Table route → carte, lue dans les déclarations des fichiers de données.
 *
 * ── Ce qui a changé, et pourquoi ───────────────────────────────────────────
 * Deux copies ont disparu ici. La route d'une carte était d'abord DÉDUITE du nom
 * de son fichier PNG (`og-<page>.png`), ce qui obligeait la carte générique à
 * vivre hors de la table (ses fichiers ne nomment aucune page) et faisait porter
 * à un nom de fichier une information qui appartient à la donnée. Puis le
 * générateur recopiait route, clés de texte et sorties dans le manifeste, et le
 * runtime lisait cette copie : renommer un texte sans régénérer laissait carte et
 * page d'accord sur un texte périmé, mais un manifeste retouché à la main les
 * faisait diverger — un garde devait comparer les deux.
 *
 * Ici, la route d'une carte est celle que SON fichier déclare, et c'est ce même
 * fichier que lit le générateur pour dessiner le visuel. Une carte ne peut donc
 * plus être servie à une page qui n'est pas la sienne, ni annoncer un autre texte
 * que sa page : les deux surfaces lisent un seul document.
 *
 * @param {Array<object>} cards Les cartes déclarées (objets des fichiers JSON).
 * @returns {Object<string, {image: string, imageSquare: string}>} Carte servie,
 *   par route normalisée.
 */
export const cardsFromDeclarations = (cards) =>
  Object.fromEntries(
    (cards || [])
      .filter((card) => card && typeof card.route === 'string' && card.wide && card.square)
      .map((card) => [
        normalizeRoute(card.route),
        { image: `/${card.wide}`, imageSquare: `/${card.square}` },
      ])
  );

/**
 * Les textes de page qu'une carte déclare : route → clés i18n.
 *
 * La carte DESSINE le titre et la description de sa page (voir
 * scripts/gen-og-images.py), donc c'est son fichier de données qui les déclare —
 * une seule fois. src/config/page-meta.js lit cette table pour les routes servies
 * par une carte et refuse qu'une même route soit déclarée des deux côtés : les
 * deux surfaces ne peuvent donc pas annoncer deux textes.
 *
 * @param {Array<object>} cards Les cartes déclarées (objets des fichiers JSON).
 * @returns {Object<string, {title: string, description: string}>}
 */
export const cardPageMetaFrom = (cards) =>
  Object.fromEntries(
    (cards || [])
      .filter(
        (card) =>
          card &&
          typeof card.route === 'string' &&
          typeof card.title === 'string' &&
          typeof card.description === 'string'
      )
      .map((card) => [
        normalizeRoute(card.route),
        { title: card.title, description: card.description },
      ])
  );

// Les cartes servies par le build ET par le runtime : la clé est la route
// DÉCLARÉE par le fichier de données, jamais le nom d'un PNG.
export const CARDS_BY_ROUTE = cardsFromDeclarations(DECLARED_CARDS);

// Les textes de page déclarés par les cartes (src/config/page-meta.js les
// fusionne avec ceux des routes qui n'ont pas de visuel).
export const CARD_PAGE_META = cardPageMetaFrom(DECLARED_CARDS);

// La carte générique : celle de la racine, servie à toute page sans visuel dédié.
// `check-og-assets.js` refuse une table où aucune carte ne sert la racine — sans
// elle, ces pages n'auraient plus de carte du tout.
export const GENERIC_CARD = CARDS_BY_ROUTE[ROOT_ROUTE];

/**
 * Carte de la route donnée (générique si elle n'a pas de carte déclarée).
 *
 * @param {string} [route] Chemin de la route (« /jobs »). Par défaut : la route
 *   courante du navigateur — un appelant qui ne passe rien ne peut donc pas
 *   annoncer la carte d'une AUTRE route.
 */
export const ogCardFor = (route) => CARDS_BY_ROUTE[normalizeRoute(route)] || GENERIC_CARD;
