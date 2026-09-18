// Extension explicite : ce fichier est importé AUSSI par Node (vite.config.js et
// les gardes de scripts/), et Node n'exécute pas un import relatif sans extension.
import { normalizeRoute } from './route-path.js';

// Table UNIQUE du titre et de la description publiés par route.
//
// Elle vit ici — et non dans vite.config.js ni dans src/pages/ — parce que les
// DEUX canaux qui publient ces textes la lisent :
//   • les coquilles PRÉ-RENDUES, écrites au build par vite.config.js depuis
//     src/i18n/fr.json (le HTML statique que lit un crawler sans JavaScript) ;
//   • les pages au RUNTIME, dans la langue de l'utilisateur, via usePageMeta()
//     (src/utils/seo.js).
// Les valeurs sont des CLÉS de src/i18n/*.json : les cinq dictionnaires ont les
// mêmes clés (i18nParity.test.js), donc la table dit QUELLES clés une route
// publie et les dictionnaires disent QUOI — une seule déclaration, dans la
// langue de chacun.
//
// Ce que ce fichier supprime : vite.config.js portait sa propre table de titres
// et descriptions EN FRANÇAIS EN DUR, et les pages portaient de leur côté les
// clés i18n de la même route. Deux déclarations pour une URL : renommer un titre
// d'un seul côté ne cassait aucun test, et un crawler (HTML pré-rendu) aurait lu
// un autre texte que le navigateur (page exécutée). Pire, /register,
// /forgot-password et /payment n'avaient AUCUN texte au runtime : après une
// navigation interne, ces pages affichaient encore le titre de la page
// précédente. Ici, une route sans texte n'existe plus : elle est nommée, ou
// elle échoue (scripts/check-page-meta.js).
//
// Une route qui n'a pas de coquille pré-rendue et n'annonce donc rien dans le
// HTML servi (/messages, /profile — servies par app.html, noindex) garde sa
// propre clé dans sa page : rien ne peut diverger là où il n'y a qu'un canal.
export const PAGE_META = {
  '/': { title: 'homeMetaTitle', description: 'homeMetaDescription' },
  '/jobs': { title: 'jobsMetaTitle', description: 'jobsMetaDescription' },
  '/login': { title: 'loginMetaTitle', description: 'loginMetaDescription' },
  '/register': { title: 'registerMetaTitle', description: 'registerMetaDescription' },
  '/forgot-password': {
    title: 'forgotPasswordMetaTitle',
    description: 'forgotPasswordMetaDescription',
  },
  '/payment': { title: 'paymentMetaTitle', description: 'paymentMetaDescription' },
  // Description DÉDIÉE, et non la clé du paragraphe de la page (howItWorksHero /
  // supportHelp) : ce sont deux surfaces distinctes — l'extrait d'un résultat de
  // recherche et le chapô — qui portent aujourd'hui le même texte mais que rien
  // n'oblige à changer ensemble. Une clé partagée ferait du chapô une seconde
  // déclaration de la méta (et serai signalée comme telle par le garde).
  '/how-it-works': {
    title: 'howItWorksMetaTitle',
    description: 'howItWorksMetaDescription',
  },
  '/support': { title: 'supportMetaTitle', description: 'supportMetaDescription' },
};

/**
 * Clés i18n du titre et de la description d'une route.
 *
 * @param {string} [route] Chemin de la route (« /login »). Par défaut : la route
 *   courante du navigateur.
 * @returns {{title: string, description?: string}|null} Clés, ou null pour une
 *   route qui ne publie pas de texte de page (route inconnue, /dashboard…).
 */
export const pageMetaKeys = (route) => PAGE_META[normalizeRoute(route)] || null;
