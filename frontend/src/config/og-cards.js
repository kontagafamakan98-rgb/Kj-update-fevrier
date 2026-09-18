// Import AVEC attribut : ce module est chargé par Node (vite.config.js et les
// gardes de scripts/) autant que par le bundle — Node n'exécute plus un import
// JSON sans `with { type: 'json' }`, et Vite/vitest acceptent la même écriture.
// Le fichier est lu, pas recopié : voir cardsFromManifest, plus bas.
import manifest from '../../scripts/og-assets.manifest.json' with { type: 'json' };

import { normalizeRoute } from './route-path.js';

// Route de la carte GÉNÉRIQUE : celle de la racine. Elle sert aussi toute page
// sans visuel dédié (/register, /payment…), et c'est le fichier de données
// (`scripts/og-cards/generique.json`) qui la déclare comme les autres — sa paire
// de fichiers n'est donc écrite nulle part ailleurs.
const ROOT_ROUTE = '/';

/**
 * Table route → carte, lue dans le MANIFESTE du générateur.
 *
 * ── Ce qui a changé, et pourquoi ───────────────────────────────────────────
 * La route d'une carte était DÉDUITE du nom de son fichier PNG (`og-<page>.png`),
 * ce qui obligeait la carte générique à vivre hors de la table (ses fichiers ne
 * nomment aucune page) et faisait porter à un nom de fichier une information qui
 * appartient à la donnée. Chaque carte déclare maintenant sa ROUTE, ses textes et
 * ses sorties dans `scripts/og-cards/*.json` ; le générateur recopie cette route
 * ici, et ce module la sert au build comme au runtime. Renommer un PNG ne change
 * donc plus la page qu'une carte sert — et une carte ne peut plus être servie à
 * une page qui n'est pas la sienne.
 *
 * @param {Array<object>} cards Entrées `cards` du manifeste (une par carte).
 * @returns {Object<string, {image: string, imageSquare: string}>} Carte servie,
 *   par route normalisée.
 */
export const cardsFromManifest = (cards) =>
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
 * @param {Array<object>} cards Entrées `cards` du manifeste.
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
export const CARDS_BY_ROUTE = cardsFromManifest(manifest.cards);

// Les textes de page déclarés par les cartes (src/config/page-meta.js les
// fusionne avec ceux des routes qui n'ont pas de visuel).
export const CARD_PAGE_META = cardPageMetaFrom(manifest.cards);

// La carte générique : celle de la racine, servie à toute page sans visuel dédié.
// `check-og-assets.js` refuse un manifeste où aucune carte ne sert la racine —
// sans elle, ces pages n'auraient plus de carte du tout.
export const GENERIC_CARD = CARDS_BY_ROUTE[ROOT_ROUTE];

/**
 * Carte de la route donnée (générique si elle n'a pas de carte déclarée).
 *
 * @param {string} [route] Chemin de la route (« /jobs »). Par défaut : la route
 *   courante du navigateur — un appelant qui ne passe rien ne peut donc pas
 *   annoncer la carte d'une AUTRE route.
 */
export const ogCardFor = (route) => CARDS_BY_ROUTE[normalizeRoute(route)] || GENERIC_CARD;
