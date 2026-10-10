// ── LE DOMICILE DES CLASSES DU CHROME, lu par les DEUX canaux ────────────────
//
// Le chrome de l'application — l'enveloppe `.App`, la colonne `min-h-screen` qui
// ancre le pied de page, la navbar, `main.flex-1` et le pied de page — est peint
// DEUX FOIS : par React au montage (src/App.js, src/components/Navbar.js) et par
// les coquilles pré-rendues avant tout JavaScript
// (vite-plugins/prerender/app-chrome.js). Ces deux peintures DOIVENT porter les
// mêmes classes : une classe qui n'existe que d'un côté ne déplace pas un texte,
// elle change une couleur, une bordure ou une ombre AU MONTAGE de React — et
// c'est invisible dans les sondes qui comparent l'encre et les mots.
//
// La règle du dépôt est déjà celle-là pour la GÉOMÉTRIE des héros
// (`heroTitleClass` et compagnie, src/config/page-sections.js) : une seule
// déclaration, deux lecteurs. Ce module étend la même règle au chrome, et il
// existe parce que la mesure l'a exigée : les coquilles recopiaient 18 listes de
// classes du chrome, dont 16 ont un jumeau exact dans src/App.js (relevé du
// 09/10/2026). Rien ne rougissait quand l'un des deux côtés changeait seul.
//
// ── Comment le domicile est TENU (frontend/scripts/check-classes-coquilles.js) ─
//   • chaque champ exporté ici doit être LU par au moins un module de pré-rendu
//     ET par au moins une source React — un domicile que personne ne lit est une
//     déclaration morte, et un champ lu par un seul canal est une divergence en
//     puissance ;
//   • aucune coquille ne doit RECOPIER la valeur d'un champ : la valeur ne doit
//     pas réapparaître en littéral dans `vite-plugins/prerender/**` (lire un
//     champ, pas le retaper) ;
//   • le reste des littéraux des coquilles est GELÉ, nommé et justifié dans
//     `scripts/classes-coquilles.js` : une liste gelée qui change sans que sa
//     déclaration change fait rougir le garde, donc une divergence ne peut plus
//     passer en silence.
//
// ── Composez plutôt que de recopier ─────────────────────────────────────────
// `PIED_INTERIEUR_CLASS` est `CONTENEUR_CLASS` + son pas vertical,
// `PIED_LIEN_LONG_CLASS` reprend `PIED_LIEN_CLASS`, et la rangée de la navbar
// `NAV_RANGEE_CLASS` reprend `HAUTEUR_NAV_CLASS` : les valeurs se construisent à partir d'un seul littéral,
// sinon le domicile recréerait la duplication qu'il supprime.

/** L'enveloppe de l'application (`src/App.js`, chrome des coquilles). */
export const APP_CLASS = 'App';

/** La colonne qui ancre le pied de page : hauteur minimale + papier sable. */
export const COLONNE_CLASS = 'min-h-screen fond-sable relative flex flex-col';

/**
 * La navbar : la coquille en publie un PLACEHOLDER de la même hauteur
 * (`NAV_PLACEHOLDER`, app-chrome.js), React la vraie barre. Les deux portent
 * cette classe, et c'est la hauteur qui compte : 1 px de `border-b` + `h-16`
 * (64 px) = les 65 px mesurés aux deux profils (412 et 1350 px). Un placeholder
 * à 64 px décalait tout le contenu au montage de React.
 */
export const NAV_CLASS = 'sticky top-0 z-50 border-b bg-white/95 shadow-sm backdrop-blur';

/**
 * Le suffixe PWA de la navbar (encoche de l'écran) — React seul le pose, quand
 * `isPWA()` est vrai, et il est donc HORS de `CLASSES_CHROME` comme la rangée :
 * une coquille pré-rendue n'a jamais cette classe (le HTML servi est le même pour
 * un onglet et pour une application installée). Le champ reste ici parce que sa
 * valeur appartient à la MÊME décision que `NAV_CLASS` — les deux se composent —
 * et qu'une retouche de la navbar doit les voir côte à côte.
 */
export const NAV_PWA_SUFFIXE = 'pt-safe-area-inset-top';

/** Le conteneur de page, réutilisé partout : un seul littéral pour tous. */
export const CONTENEUR_CLASS = 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8';

/**
 * La hauteur de la navbar : le `h-16` du placeholder ET la rangée de React.
 *
 * C'est le seul morceau de la rangée intérieure qui soit PARTAGÉ — et c'est
 * aussi celui qui décide de la géométrie : `border-b` (1 px) + `h-16` (64 px)
 * = les 65 px mesurés aux deux profils (412 et 1350 px), donc l'endroit où
 * démarre tout le contenu.
 *
 * La rangée interne (`NAV_RANGEE_CLASS`) porte cette hauteur. Elle est lue par les
 * DEUX canaux : React (src/components/Navbar.js) et la coquille (`NAV_PLACEHOLDER`,
 * app-chrome.js), qui publie la même structure — conteneur, puis rangée vide de
 * même hauteur. Une coquille qui ne posait cette classe que sur le conteneur
 * laissait React la poser sur la rangée : la même boîte, deux porteurs — un
 * écart déclaré que la sonde de classes calculées a rendu visible (09/10/2026).
 */
const HAUTEUR_NAV_CLASS = 'h-16';

/** La rangée de la navbar : `flex justify-between` et la hauteur partagée. */
export const NAV_RANGEE_CLASS = `flex justify-between ${HAUTEUR_NAV_CLASS}`;

/** `main.flex-1` : le contenu s'étire, le pied de page reste ancré. */
export const MAIN_CLASS = 'flex-1 pb-24 md:pb-0';

/** Le pied de page légal, peint par src/App.js et par chaque coquille. */
export const PIED_CLASS = 'border-t border-orange-100 bg-white/95 backdrop-blur-sm';
export const PIED_INTERIEUR_CLASS = `${CONTENEUR_CLASS} py-4 space-y-3`;
export const PIED_ADRESSE_CLASS =
  'not-italic flex flex-wrap items-center justify-center md:justify-end gap-x-4 gap-y-2 text-xs text-gray-600';
export const PIED_LIEN_CLASS = 'hover:text-orange-700 underline underline-offset-2';
export const PIED_LIEN_LONG_CLASS = `${PIED_LIEN_CLASS} break-all`;
export const PIED_NAV_CLASS = 'flex flex-wrap items-center justify-center md:justify-end gap-4 text-sm text-orange-700';
export const PIED_NAV_LIEN_CLASS = 'hover:text-orange-800 underline underline-offset-2';

/**
 * Le relevé lu par le garde : les champs du domicile, nom → valeur. Le garde lit
 * CETTE table (jamais une liste recopiée à part) pour exiger que chaque champ
 * soit lu par au moins une coquille ET par au moins une source React, et pour
 * refuser qu'une coquille retape l'une de ces valeurs.
 *
 * Seuls les champs que les DEUX canaux PEIGNENT sont ici : `NAV_PWA_SUFFIXE` et
 * la rangée intérieure de React en sont absents, et c'est délibéré (voir leurs
 * commentaires plus haut) — un champ que React seul lit ne peut pas diverger
 * entre les deux peintures.
 */
export const CLASSES_CHROME = {
  APP_CLASS,
  COLONNE_CLASS,
  NAV_CLASS,
  CONTENEUR_CLASS,
  NAV_RANGEE_CLASS,
  MAIN_CLASS,
  PIED_CLASS,
  PIED_INTERIEUR_CLASS,
  PIED_ADRESSE_CLASS,
  PIED_LIEN_CLASS,
  PIED_LIEN_LONG_CLASS,
  PIED_NAV_CLASS,
  PIED_NAV_LIEN_CLASS,
};
