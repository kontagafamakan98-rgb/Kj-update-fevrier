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
// chargeable par Node (vite.config.js) autant que par le bundle. `classeCarte`
// est l'identité de LA CARTE (une pastille par pays), pas la mise en page de
// l'accueil : les deux canaux peignent donc la même carte.
//
// ── Pourquoi `classeCarte` et non `color` (17/10/2026) ──────────────────────
// Tailwind lit le TEXTE des sources : la valeur ci-dessous GÉNÈRE une règle
// livrée, qu'elle soit posée ou non. Or `scripts/check-css-selecteurs-morts.js`
// ne reconnaît un porteur de classe que dans une POSITION de classe (JSX) ou
// sous un nom `classe*` : un champ nommé `color` était donc invisible pour lui,
// et ses quatre teintes n'étaient vivantes que par le `className` qui les
// interpellait ailleurs. Le jour où ce `className` a changé de dessin (la page
// d'inscription a cessé de peindre un pavé jaune), `bg-yellow-100` est devenue
// une règle sans porteur aux yeux du garde — un rouge juste, qui accusait le
// NOM du champ et non la teinte. Renommé, il est lu comme ce qu'il est.
export const COUNTRIES = [
  {
    code: 'mali',
    name: 'Mali',
    fullName: 'Mali',
    iso: 'ML',
    classeCarte: 'bg-green-100',
  },
  {
    code: 'senegal',
    name: 'Sénégal',
    fullName: 'Sénégal',
    iso: 'SN',
    classeCarte: 'bg-yellow-100',
  },
  {
    code: 'burkina_faso',
    name: 'Burkina Faso',
    fullName: 'Burkina Faso',
    iso: 'BF',
    classeCarte: 'bg-red-100',
  },
  {
    code: 'ivory_coast',
    // Apostrophe ÉCHAPPÉE dans une chaîne simple : c'est la forme que
    // `check-home-shell.js` sait lire (il extrait les `name:` du référentiel
    // pour vérifier que la coquille publie bien chaque pays). En guillemets
    // doubles, ce pays sortait de la vérification sans que rien ne le dise.
    name: 'Côte d’Ivoire',
    fullName: 'Côte d’Ivoire',
    iso: 'CI',
    classeCarte: 'bg-orange-100',
  },
];
