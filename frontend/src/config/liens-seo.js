// LE MAILLAGE INTERNE DES PAGES SEO — villes, métiers, guides — déclaré UNE fois.
//
// POURQUOI CE MODULE EXISTE (mesuré le 27/10/2026) : les 32 pages servies par le
// backend (`/emplois/{ville}`, `/metiers/{metier}`, `/guides/{guide}`) n'étaient
// atteignables que par le sitemap. Le sitemap est un plan de découverte, pas un
// maillage : une page qu'aucune page du site ne cite n'a aucun texte de lien
// entrant, et c'est ce texte que lit un moteur pour comprendre ce que la page
// répond. Le pied de page — rendu sur TOUTES les routes — les cite donc
// désormais par leur nom.
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
// Les DEUX rendus qui publient ce bloc — le pied de page React (src/App.js) et
// le pied de page des coquilles (vite-plugins/prerender/app-chrome.js) —
// importent CE module : la bascule coquille → React ne peut ni déplacer un
// lien, ni en changer le libellé.
//
// UN SEUL DOMAINE PAR DOCUMENT (29/10/2026). L'accueil (src/pages/Home.js) et
// sa coquille publiaient EN PLUS leur propre section de maillage, juste
// au-dessus du pied de page, qui publie la même. Mesuré sur l'artefact servi
// (`build/index.html` et la production) : « / » portait le bloc DEUX fois —
// les trois mêmes « Villes / Métiers / Guides » dans le même écran, celui du
// pied de page suivant immédiatement l'autre —, /jobs et /login une seule.
// Cette section-là a été retirée : le pied de page est rendu sur toutes les
// routes, il n'y avait rien à ajouter ailleurs. Le garde
// `backend/tests/test_pages_seo_maillage.py` refuse qu'un troisième rendu
// réapparaisse.
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
// Le bloc est peint sur le VERRE du pied de page (`rgba(253, 250, 244, 0.78)` sur
// le sable ou sur l'encre) : depuis le 29/10/2026 c'est sa SEULE surface, la
// section de l'accueil qui le peignait aussi sur le papier ayant été retirée.
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
// pied de page. Protocole et chiffres du 28/10/2026, quand le bloc était
// TOUJOURS déplié : 45 liens sur quatre lignes, bloc de 64 px, pied de page de
// 157 px arrêté (168 px à l'insertion), CLS mesuré **0,0376** sur les deux
// branches de /payment pour un plafond de 0,06 — et 0,0611 avant le
// raccourcissement du même jour, avec un pied de 228 px.
//
// MESURÉ LE 29/10/2026 APRÈS LE DÉPLIANT (Chromium, artefact de `build/`,
// 1350×940 et 412×823, la boîte de `footer` et celle du bloc) : bloc FERMÉ
// 32 px, pied de page **125 px** en desktop (157 → 125) ; bloc 88 px, pied
// **241 px** en mobile (565 → 241). Dépliant « Guides » ouvert en desktop :
// bloc 128 px, pied 221 px, 23 liens peints. Le CLS de /payment n'a PAS été
// re-mesuré (son harnais exige la connexion à la fixture, qui échoue dans
// l'environnement de cette passe) : la hauteur baisse de 32 px, donc la part du
// pied de page dans le décalage baisse — ce n'est pas une mesure, et c'est écrit
// comme tel plutôt que présenté comme un gain constaté.
//
// L'OUVERTURE D'UN DÉPLIANT ne coûte aucun CLS : le décalage suit un APPUI, et
// un déplacement consécutif à une interaction n'entre pas dans la métrique.
// Aucune réserve de hauteur n'est posée sur le bloc : il EST son propre contenu,
// ouvert comme fermé.
//
// ── LA DISPOSITION, ET POURQUOI ELLE NE PEINT PLUS 45 LIENS ─────────────────
// Au-delà du point de rupture, les trois dépliants partagent UNE rangée centrée
// (le conteneur devient un flux horizontal) : fermés, ils tiennent sur 32 px et
// le pied de page ne montre que trois noms — « Villes », « Métiers », « Guides ».
// En dessous, ils s'empilent sur 88 px. Ouvert, un panneau déroule SES liens
// sous son titre ; le paragraphe qui les porte perd sa boîte au-delà du point de
// rupture (mode d'affichage partagé), donc ses liens s'enchaînent en ligne dans
// le panneau, à la taille du bloc d'adresse du pied de page. Ce sont des liens
// secondaires : il n'y a pas de corps « de maillage » à inventer.
//
// ── LE DÉPLIANT, PARCE QU'UNE MURAILLE DE LIENS N'EST PAS UN MAILLAGE LISIBLE
// (29/10/2026) : 45 liens dépliés sur QUATRE lignes en desktop et DIX-HUIT en
// mobile. Un visiteur ne lit pas un index de 45 entrées en bas de page : il le
// traverse en le prenant pour du bruit, et le pied de page en devenait une
// muraille. Chaque famille est donc un DÉPLIANT natif — un élément du HTML, pas
// un composant à état : fermé par défaut, ouvert au clic ou au clavier, sans une
// ligne de JavaScript, donc identique à l'identique dans les deux canaux (la
// coquille pré-rendue n'a rien à simuler, React n'a rien à hydrater).
//
// CE QUE ÇA NE CHANGE PAS, ET QUI EST LE POINT : les 45 liens restent DANS le
// document servi. Un dépliant fermé MASQUE du contenu, il ne le retire pas — le
// HTML publié porte les mêmes `<a href>` qu'avant, dans le même ordre, donc le
// texte de lien entrant qui justifiait ce bloc existe toujours pour un moteur
// qui lit le document sans exécuter de script. C'est la condition pour que le
// raccourcissement ne défasse pas le maillage : un bloc qui n'aurait chargé ses
// liens qu'à l'ouverture aurait rendu les 45 pages invisibles, en silence.
//
// Le prix assumé, écrit noir sur blanc plutôt que passé sous silence : un moteur
// peut accorder moins de poids à un lien masqué qu'à un lien peint. Le bloc
// reste donc sur la surface où il a été mesuré utile (le pied de page, rendu sur
// toutes les routes), et les trois titres de famille restent VISIBLES, fermés
// compris — c'est eux qu'un lecteur pressé lit,
// et le dépliant ne les cache jamais.
//
// ── CE QUE CE BLOC COÛTE EN CSS CRITIQUE, ET COMMENT ON L'A PAYÉ MOINS CHER ──
// Toute classe utilisée ici devient une règle de CSS CRITIQUE INLINÉ, lue AVANT
// le premier paint et recopiée dans les 13 documents pré-rendus. Le garde
// `scripts/check-css-inline-budget.js` a REFUSÉ le premier jet (+199 o sur
// 86 016, mesuré le 28/10/2026), et la correction n'a pas été de relever le
// budget : c'est la mise en page elle-même qui payait des règles inutiles.
//   1. L'espacement entre les éléments se paie sur l'ÉLÉMENT (une marge à droite
//      portée par le titre et par le lien, donc UNE règle) au lieu de deux
//      gouttières sur le conteneur : c'est deux règles de moins, et l'interligne
//      des lignes repliées reste celui du texte.
//   2. `space-y-2`, qui espace les groupes empilés sur mobile, n'a pas à être
//      neutralisé en desktop : ses marges tombent sur des enfants devenus des
//      boîtes du flux flexible, mais une seule règle de marge les couvre — voir
//      le point 1, la gouttière de ligne ayant disparu.
//   3. **Tailwind v4 lit aussi les COMMENTAIRES** : un nom d'utilitaire cité dans
//      cette prose est émis dans la feuille, qu'il soit posé ou non. Mesuré le
//      28/10/2026 en comparant les deux builds : +11 règles ajoutées, dont SIX
//      que le code n'utilisait plus. C'est pourquoi ce paragraphe décrit les
//      utilitaires au lieu de les nommer.
export const LIENS_SEO_CLASS = 'space-y-2 gap-x-3 md:flex md:flex-wrap md:justify-center';
// Le CORPS vit sur le GROUPE et pas sur le conteneur, et c'est une mesure, pas un
// goût : un élément au mode d'affichage partagé ne peint pas de boîte mais
// transmet TOUJOURS ses propriétés héritées. Mesuré le 28/10/2026 : le corps posé
// sur le conteneur calculait bien 12 px / 16 px pendant que les LIENS restaient à
// 14 px / 20 px — le bloc restait à cinq lignes de 20 px.
export const LIENS_SEO_GROUPE_CLASS =
  'flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 text-sm md:contents md:text-xs';
// LE TITRE DEVIENT LE DÉCLENCHEUR du dépliant : c'est le même dessin qu'avant
// (gras, encre de titre) sur l'élément qui ouvre et ferme, donc le visiteur voit
// les trois familles sans ouvrir une seule ligne. Il ne porte AUCUNE classe
// nouvellement écrite : ce sont les deux seules règles que le bloc payait déjà.
export const LIENS_SEO_SOMMAIRE_CLASS = 'font-semibold text-stone-800 md:mr-2';
export const LIENS_SEO_LIEN_CLASS =
  'text-orange-900 underline underline-offset-2 hover:text-orange-950 md:mr-2';
