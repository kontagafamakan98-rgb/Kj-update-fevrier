// L'icône DESSINÉE, en CHAÎNE, pour les coquilles pré-rendues (Node).
//
// Ce fichier vit côté BUILD, et pas dans `src/config/page-icons.js`, pour une
// raison mesurée : `page-icons.js` est importé par la page (donc par le bundle
// client), et y importer `react-dom/server` faisait passer `vendor-react-dom` de
// 130 à 201 ko (mesuré le 26/09/2026). Ici, le balisage est composé à la main,
// avec les MÊMES attributs et le MÊME contenu que `IconePage` — la coquille et la
// page publient donc le même `<svg>`, sans seconde description à tenir à jour.
import { ATTRIBUTS_SVG, contenuDeLICone } from '../../src/config/page-icons.js';

// L'ordre des attributs est celui que React émet : le même `<svg>` des deux
// côtés, au même octet près.
const ATTRS = Object.entries(ATTRIBUTS_SVG)
  .map(([nom, valeur]) => `${nom}="${valeur}"`)
  .join(' ');

export function svgDeLIcone(nom, classe) {
  return `<svg ${ATTRS} class="${classe}" aria-hidden="true" data-icone="${nom}">${contenuDeLICone(nom)}</svg>`;
}
