/**
 * Échappement HTML — pour les rares endroits où l'on construit du HTML par
 * concaténation (popups Leaflet, etc.) au lieu de laisser React échapper.
 * React échappe par défaut ; ce helper n'est nécessaire que pour le code qui
 * injecte des chaînes dans du HTML brut (innerHTML, bindPopup…).
 *
 * SÉCURITÉ : sans échappement, une valeur contrôlée par l'utilisateur
 * (ex: l'adresse d'un job saisie à la création) insérée dans du HTML
 * permettrait un XSS stocké (injection de <script> / gestionnaires
 * d'événements). On échappe les 5 caractères HTML sensibles.
 */
export const escapeHtml = (value) => {
  const str = value === null || value === undefined ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export default escapeHtml;
