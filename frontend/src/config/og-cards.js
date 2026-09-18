// Import AVEC attribut : ce module est chargé par Node (vite.config.js et les
// gardes de scripts/) autant que par le bundle — Node n'exécute plus un import
// JSON sans `with { type: 'json' }`, et Vite/vitest acceptent la même écriture.
// Le fichier est lu, pas recopié : voir dedicatedCardsFrom, plus bas.
import manifest from '../../scripts/og-assets.manifest.json' with { type: 'json' };

import { normalizeRoute } from './route-path.js';

// Carte GÉNÉRIQUE : l'accueil et toute page sans visuel dédié.
//
// `image` = carte wide (1200x630) ; `imageSquare` = variante CARRÉE 1200x1200,
// exigée par les réseaux qui recadrent en 1:1. Ces deux fichiers sont les SEULS
// exclus par leur nom de la convention ci-dessous (ils ne nomment aucune page).
export const GENERIC_CARD = {
  image: '/og-image-1200x630.png',
  imageSquare: '/og-square-1200x1200.png',
};

const GENERIC_FILES = new Set([GENERIC_CARD.image, GENERIC_CARD.imageSquare]);

/** Nom de fichier de carte dédiée : `og-<page>.png` (voir gen-og-images.py). */
const DEDICATED_FILE = /^\/og-([a-z0-9-]+)\.png$/;

/**
 * Quelles pages ont un VISUEL DÉDIÉ — déduit des cartes PRÉSENTES, plus d'aucune
 * liste écrite à la main.
 *
 * ── La règle ───────────────────────────────────────────────────────────────
 * Un visuel dédié à la page `/x` existe quand `public/` contient `og-x.png` ET sa
 * variante carrée `og-x-square.png`. Le nom du fichier EST la déclaration : il n'y
 * a rien à ajouter au code pour qu'une page change de carte.
 *
 * ── Pourquoi ce n'est pas une liste déguisée ───────────────────────────────
 * Deux listes vivaient ici et dans le générateur, et elles pouvaient diverger en
 * silence : `DEDICATED_CARDS` était recopiée à la main, donc une carte ajoutée
 * dans `public/` restait annoncée par personne (le commit de la carte seule
 * passait pour un succès). La déduction lit maintenant le MANIFESTE
 * (scripts/og-assets.manifest.json) — le même fichier que le générateur écrit et
 * que `check-og-assets.js` confronte aux PNG versionnés par empreinte SHA-256.
 * Un seul fait, deux chargeurs : l'import (bundle, vitest) et `fs` (scripts
 * Node), comme src/i18n/fr.json. Ajouter une carte = relancer le générateur.
 *
 * @param {string[]} files Noms de fichiers livrés dans public/ (chemin du manifeste).
 * @returns {{cards: Object<string, {image: string, imageSquare: string}>,
 *   incomplete: string[]}} `cards` = pages servies par un visuel dédié ;
 *   `incomplete` = cartes larges SANS variante carrée : elles ne peuvent pas être
 *   servies (les réseaux 1:1 liraient une image absente) — la page reçoit la
 *   carte générique, et scripts/check-page-meta.js refuse cet état.
 */
export const dedicatedCardsFrom = (files) => {
  const present = new Set((files || []).map((file) => `/${String(file).replace(/^\/+/, '')}`));
  const cards = {};
  const incomplete = [];
  for (const file of present) {
    if (GENERIC_FILES.has(file)) continue;
    const match = DEDICATED_FILE.exec(file);
    if (!match) continue;
    const slug = match[1];
    // `og-jobs-square.png` est la variante carrée de la carte de /jobs : ce n'est
    // pas la carte d'une page « jobs-square ».
    if (slug.endsWith('-square')) continue;
    const imageSquare = `/og-${slug}-square.png`;
    if (!present.has(imageSquare)) {
      incomplete.push(file);
      continue;
    }
    cards[`/${slug}`] = { image: file, imageSquare };
  }
  return { cards, incomplete };
};

// La table servie par le build ET par le runtime : ni l'un ni l'autre ne connaît
// la liste des pages, seulement le nom des fichiers présents.
const DEDICATED_CARDS = dedicatedCardsFrom((manifest.assets || []).map((asset) => asset.file)).cards;

/**
 * Carte de la route donnée (générique si elle n'a pas de visuel dédié).
 *
 * @param {string} [route] Chemin de la route (« /jobs »). Par défaut : la route
 *   courante du navigateur — un appelant qui ne passe rien ne peut donc pas
 *   annoncer la carte d'une AUTRE route.
 */
export const ogCardFor = (route) => DEDICATED_CARDS[normalizeRoute(route)] || GENERIC_CARD;
