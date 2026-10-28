// LE MAILLAGE INTERNE DES PAGES SEO — villes, métiers, guides — déclaré UNE fois.
//
// POURQUOI CE MODULE EXISTE (mesuré le 27/10/2026) : les 32 pages servies par le
// backend (`/emplois/{ville}`, `/metiers/{metier}`, `/guides/{guide}`) n'étaient
// atteignables que par le sitemap. Le sitemap est un plan de découverte, pas un
// maillage : une page qu'aucune page du site ne cite n'a aucun texte de lien
// entrant, et c'est ce texte que lit un moteur pour comprendre ce que la page
// répond. L'accueil et le pied de page — présents sur TOUTES les routes — les
// citent donc désormais par leur nom.
//
// Les DONNÉES (slugs, libellés) vivent dans `pages-seo.json`, que le backend
// relit dans `backend/tests/test_pages_seo_maillage.py` : la liste des villes y
// est DÉRIVÉE du référentiel géographique côté serveur, donc une ville ajoutée
// là-bas fait rougir le garde au lieu de rester sans lien. Aucun slug n'est
// recopié ici.
//
// Les liens sont de VRAIS `<a href>`, jamais des `Link` React : ces pages sont
// servies par le backend (rewrites `/emplois/(.*)`, `/metiers/(.*)`,
// `/guides/(.*)` de frontend/vercel.json) et il n'existe AUCUNE route React pour
// elles — un `Link` ferait peindre la 404 de l'application par-dessus un contenu
// correct (c'est la règle qui a fait écrire le CTA des pages ville vers /jobs).
//
// Les quatre rendus qui publient ce bloc — accueil React (src/pages/Home.js),
// coquille de l'accueil (vite-plugins/prerender/shells-home.js), pied de page
// React (src/App.js) et pied de page des coquilles
// (vite-plugins/prerender/app-chrome.js) — importent CE module : la bascule
// coquille → React ne peut ni déplacer un lien, ni en changer le libellé.
import PAGES_SEO from './pages-seo.json' with { type: 'json' };

const CHEMIN = {
  villes: (slug) => `/emplois/${slug}`,
  metiers: (slug) => `/metiers/${slug}`,
  guides: (slug) => `/guides/${slug}`,
};

const groupe = (cle, titreKey) => ({
  cle,
  titreKey,
  liens: PAGES_SEO[cle].map((page) => ({ nom: page.nom, href: CHEMIN[cle](page.slug) })),
});

// L'ORDRE est celui du référentiel géographique (villes), du catalogue de
// métiers, puis des guides — donc celui du sitemap, sans table de tri à part.
export const GROUPES_LIENS_SEO = [
  groupe('villes', 'footerCities'),
  groupe('metiers', 'footerTrades'),
  groupe('guides', 'footerGuides'),
];

// ── LES CLASSES, MESURÉES SUR LES DEUX SURFACES ────────────────────────────
// Le même bloc est peint sur `--kojo-papier` (la section de l'accueil) et sur le
// VERRE du pied de page (`rgba(253, 250, 244, 0.78)` sur le sable ou sur l'encre).
// `orange-900` (#7c2d12) tient 8,86:1 sur le verre posé sur le sable et 5,67:1
// au pire cas, et davantage sur le papier ; son survol `orange-950` (#431407)
// monte à 14,79:1 et 9,47:1. Le titre `stone-800` (#292524) dépasse 9:1 sur le
// pire composite. Ce sont les encres du pied de page déjà mesurées le
// 27/10/2026 (voir src/config/classes-chrome.js) : les répéter ici plutôt que
// les importer garde ce module lisible par les deux canaux sans dépendre du
// chrome, et les valeurs sont les MÊMES.
// ── LA HAUTEUR DU BLOC, PARCE QU'ELLE COÛTE UN CLS ──────────────────────────
// Ce bloc est peint dans le pied de page, donc sur TOUTES les routes, et le pied
// de page est INSÉRÉ quand le splash PWA rend la main : sur une page courte comme
// /payment (706 px de `main` en desktop pour une fenêtre de 940), ce qui entre
// dans l'écran À CE MOMENT-LÀ déplace le document, et le coût suit la HAUTEUR du
// pied de page. Mesuré le 28/10/2026 par `e2e/cadres-app.spec.js` (branches
// « mission requise » et « mission », 1350×940) : pied de 228 px à l'insertion →
// **0,0611**, sous un plafond de 0,07 que la mesure du 28/10 avait déjà dû
// relever ; un pied SANS ce bloc (141 px, 17/10) valait 0,0470.
//
// DESKTOP SEULEMENT, et voici pourquoi : le bloc empilait trois groupes (titre au
// corps du texte, puis ses liens à la ligne suivante) — 124 px sur desktop, dont
// 16 px de pas vertical entre groupes et 3 lignes de titres qui ne portent qu'un
// mot. Au-delà de `md`, les trois groupes partagent donc UN flux : la classe
// `md:contents` retire la boîte du groupe, son titre et ses liens deviennent des
// éléments du même rang, et le titre (gras, `stone-800`) reste ce qui distingue
// les familles — d'autant mieux qu'il n'occupe plus une ligne à lui seul. Le
// corps passe à `text-xs`, celui que le pied de page emploie DÉJÀ pour son bloc
// d'adresse (`PIED_ADRESSE_CLASS`) : il n'y a pas de corps « de maillage » à
// inventer, ces 45 liens sont des liens secondaires. Ce que la mesure interdit
// n'est pas de réduire, c'est de réduire SOUS la destination — ce bloc n'en
// réserve aucune, il EST son propre contenu.
//
// Le MOBILE NE CHANGE PAS : il empile les groupes et garde `text-sm`, ses liens
// ne partageant pas de ligne de toute façon (13 villes y prennent cinq lignes).
// `md:space-y-0` est indispensable et non décoratif : `space-y-2` s'applique à
// `> * + *`, donc aux enfants devenus directs par `md:contents` — sans lui,
// chaque lien du flux hériterait d'un `margin-top: 8px`.
export const LIENS_SEO_CLASS =
  'space-y-2 md:flex md:flex-wrap md:items-baseline md:justify-center md:gap-x-3 md:gap-y-1 md:space-y-0';
// Le CORPS vit sur le GROUPE et pas sur le conteneur, et c'est une mesure, pas un
// goût : un élément en `display: contents` ne peint pas de boîte mais transmet
// TOUJOURS ses propriétés héritées. Mesuré le 28/10/2026 : avec `md:text-xs` sur
// le conteneur et `text-sm` sur le groupe, le conteneur calculait bien 12 px /
// 16 px et les LIENS 14 px / 20 px — le bloc restait à cinq lignes de 20 px.
export const LIENS_SEO_GROUPE_CLASS =
  'flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 text-sm md:contents md:text-xs md:leading-4';
export const LIENS_SEO_TITRE_CLASS = 'font-semibold text-stone-800';
export const LIENS_SEO_LIEN_CLASS =
  'text-orange-900 underline underline-offset-2 hover:text-orange-950';
