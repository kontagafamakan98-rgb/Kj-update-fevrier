// ── Les pays couverts : UNE déclaration, deux canaux ────────────────────────
// Ce module est lu par les deux canaux qui publient la carte d'un pays :
//   • le bundle — src/components/CountryDisplay.js (le référentiel de l'app)
//     et src/pages/Home.js (les cartes « Disponible dans 4 pays ») ;
//   • le build — vite.config.js écrit la coquille pré-rendue de l'accueil.
//
// ── Ce que ce fichier supprime ──────────────────────────────────────────────
// La liste avait DEUX propriétaires : `COUNTRIES` dans le composant (nom,
// drapeau, code ISO) et `HOME_COUNTRIES` recopié dans vite.config.js (nom,
// drapeau emoji, couleur de carte). Un pays ajouté au référentiel ne paraissait
// donc jamais dans le HTML que lit un crawler sans JavaScript — et rien ne
// rougissait : seule `check-home-shell.js` comparait les deux listes, c'est-à-
// dire surveillait la copie au lieu de la supprimer.
//
// Aucun rendu ici : pas d'import React, pas de JSX. C'est ce qui rend le module
// chargeable par Node (vite.config.js) autant que par le bundle. `color` est
// l'identité de LA CARTE (une pastille par pays), pas la mise en page de
// l'accueil : les deux canaux peignent donc la même carte.
export const COUNTRIES = [
  {
    code: 'mali',
    name: 'Mali',
    flag: '🇲🇱',
    fullName: 'Mali',
    iso: 'ML',
    color: 'bg-green-100',
  },
  {
    code: 'senegal',
    name: 'Sénégal',
    flag: '🇸🇳',
    fullName: 'Sénégal',
    iso: 'SN',
    color: 'bg-yellow-100',
  },
  {
    code: 'burkina_faso',
    name: 'Burkina Faso',
    flag: '🇧🇫',
    fullName: 'Burkina Faso',
    iso: 'BF',
    color: 'bg-red-100',
  },
  {
    code: 'ivory_coast',
    // Apostrophe ÉCHAPPÉE dans une chaîne simple : c'est la forme que
    // `check-home-shell.js` sait lire (il extrait les `name:` du référentiel
    // pour vérifier que la coquille publie bien chaque pays). En guillemets
    // doubles, ce pays sortait de la vérification sans que rien ne le dise.
    name: 'Côte d’Ivoire',
    flag: '🇨🇮',
    fullName: 'Côte d’Ivoire',
    iso: 'CI',
    color: 'bg-orange-100',
  },
];
