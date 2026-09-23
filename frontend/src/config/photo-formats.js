// Formats et taille acceptés pour une photo de profil : la page
// (src/components/ProfilePhotoUpload.js) et la coquille pré-rendue du
// formulaire d'inscription (vite-plugins/prerender/shells-routes.js)
// publient la MÊME phrase.
//
// Elle était recopiée en littéral des deux côtés (« JPG, PNG … 5MB ») : deux
// propriétaires pour un seul fait affiché, donc changer la limite côté page
// laissait le crawler annoncer l'ancienne. Même raison que phone-format.js et
// country-placeholder.js : un texte publié sur deux canaux vit ici, une fois.
export const PHOTO_FORMATS = 'JPG, PNG';
export const PHOTO_MAX_SIZE = '5MB';

/**
 * La phrase publiée sous la zone de dépôt : « JPG, PNG jusqu'à 5MB ».
 *
 * @param {string} upTo Traduction de « jusqu'à » (clé i18n `upTo`).
 * @returns {string} La ligne affichée, identique pour la page et la coquille.
 */
export const photoFormatsLine = (upTo) => `${PHOTO_FORMATS} ${upTo} ${PHOTO_MAX_SIZE}`;
