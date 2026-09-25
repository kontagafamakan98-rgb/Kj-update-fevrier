// ── Les langues de l'interface : UNE déclaration, les deux barres ───────────
// Les deux dispositions de la barre de navigation (`hidden md:flex` et
// `md:hidden`) offrent le MÊME choix, par deux contrôles de formes différentes :
//   • la barre du haut — src/components/LanguageSelector.js (un bouton + une
//     liste, libellés FRANÇAIS et dans la langue elle-même) ;
//   • le tiroir mobile — src/components/Navbar.js (un `<select>` natif, dont
//     les libellés n'ont qu'une place).
//
// ── Ce que ce fichier supprime ──────────────────────────────────────────────
// La liste avait TROIS propriétaires : ce `LANGUAGES` du composant, les cinq
// `<option>` ÉCRITS EN DUR dans le tiroir mobile (« Français » … « Mooré »), et
// les codes nus de `src/contexts/LanguageContext.js`. Une langue ajoutée au
// menu de la barre du haut ne paraissait donc JAMAIS dans celui du tiroir, et
// rien ne rougissait : le seul fait comparable était le libellé du contrôle
// courant, affiché d'un côté comme de l'autre tant qu'il restait « Français ».
// C'est le défaut que `src/config/countries.js` a déjà fermé pour les pays
// (même raison, même remède) : on ne surveille pas une copie, on la supprime.
//
// Aucun rendu ici : pas d'import React, pas de JSX — le module est lu par le
// seul bundle, mais il reste chargeable par tout lecteur.
//
// `nativeName` est le libellé que voit le visiteur (c'est la langue qui se
// nomme elle-même, comme dans le menu de la barre du haut) ; `name` est son nom
// français, publié en second dans cette liste et dans le `<select>` du tiroir,
// qui n'a pas la place d'en peindre deux.
export const LANGUAGES = [
  { code: 'fr', name: 'Français', nativeName: 'Français' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'wo', name: 'Wolof', nativeName: 'Wolof' },
  { code: 'bm', name: 'Bambara', nativeName: 'Bamanankan' },
  { code: 'mos', name: 'Mooré', nativeName: 'Mòoré' },
];
