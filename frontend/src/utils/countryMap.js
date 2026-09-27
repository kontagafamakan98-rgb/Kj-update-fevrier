import { normalizeCountryCode } from './countryAliases';
import { getDatabase } from '../services/geolocation-database';
import { buildOpenStreetMapBoundsEmbedUrl, buildOpenStreetMapBoundsPageUrl } from './locationMaps';

// ── La carte du PAYS DÉCLARÉ — la seule position qu'un profil possède ───────
//
// Aucun modèle ne porte la position d'un utilisateur : `User` n'a que
// `country` (vérifié dans backend/kojo_models.py), et `WorkerProfile` n'a
// AUCUN champ de localisation — le `location: dict` vit sur `Job`, pas sur le
// profil. Le seul cadre qu'on puisse honnêtement dessiner sur /profile est donc
// celui du pays déclaré, dont la base géographique publie les bornes.
//
// La base est servie par le backend (`/api/geolocation/cities`, cf.
// backend/kojo_geo_data.py) et `services/geolocation-database.js` en garde un
// repli compact qui porte les MÊMES bornes : le cadre est donc disponible au
// PREMIER rendu, avant toute réponse réseau — condition pour que la carte du
// profil ne dépende pas d'un chargement asynchrone (elle serait absente chez
// qui ouvre la page hors ligne, ou pendant la fenêtre de chargement).
//
// Deux nommages coexistent, et c'est un fait du dépôt, pas un choix : le code
// canonique de `countryAliases.js` dit « ivory_coast », la base géographique
// dit « cote_divoire » (`kojo_geo_data.py`). L'alias est déclaré ICI, une fois,
// plutôt que normalisé dans les deux modules : une seconde table de synonymes
// finirait par diverger de la première.

/** Le nom du pays DANS LA BASE GÉOGRAPHIQUE, quand il diffère du code canonique. */
const CLE_DANS_LA_BASE_GEOGRAPHIQUE = { ivory_coast: 'cote_divoire' };

/**
 * La carte du pays déclaré, ou `null` si le cadre est inutilisable.
 *
 * `null` est une réponse honnête, pas un échec : un pays hors des quatre
 * couverts (ou une base corrompue, bornes absentes ou inversées) ne doit PAS
 * peindre un bloc de carte vide — le profil n'affiche alors simplement pas de
 * section de localisation.
 *
 * @param {string} codePays Code de pays tel que le profil le porte (« senegal »,
 *   « SN », « ivory_coast »… — `normalizeCountryCode` fait le reste).
 * @returns {{ src: string, href: string, nom: string } | null} L'URL d'embed,
 *   l'URL de la page qui montre le même cadre, et le nom du pays dans la langue
 *   de la base (sert au titre de l'iframe, jamais au libellé visible : celui-ci
 *   vient du dictionnaire, cf. `CountryDisplay`).
 */
export const countryMapFor = (codePays) => {
  const canonique = normalizeCountryCode(codePays);
  if (!canonique) return null;

  const donnees = getDatabase()?.[CLE_DANS_LA_BASE_GEOGRAPHIQUE[canonique] || canonique];
  const src = buildOpenStreetMapBoundsEmbedUrl(donnees?.bounds);
  if (!src) return null;

  return {
    src,
    href: buildOpenStreetMapBoundsPageUrl(donnees.bounds),
    nom: String(donnees?.nameFrench || donnees?.country || '').trim(),
  };
};
