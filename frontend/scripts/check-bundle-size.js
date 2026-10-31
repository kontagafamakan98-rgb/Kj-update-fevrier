#!/usr/bin/env node
/**
 * Budget de taille du bundle — l'étape CI « Check bundle size » ne vérifiait
 * RIEN : elle affichait `du -sh build/` et sortait toujours 0. Un doublement du
 * bundle (dépendance lourde importée dans le shell, chunk lazy repassé en
 * statique, carte/asset géant) passait donc en vert.
 *
 * Ce check pose trois budgets, mesurés sur le build réel puis arrondis :
 *
 *   1. JS INITIAL — somme gzip des chunks référencés par build/index.html
 *      (ce que le navigateur télécharge avant de peindre la première route).
 *      Mesure du 16/09/2026 : 99,2 Ko gzip (index 38,4 + vendor-react-dom 40,7
 *      + vendor-router 13,4 + vendor-react 2,8 + Home 2,3 + vendor 1,6).
 *      Le SDK Sentry n'y figure plus : il était le plus gros chunk du build
 *      (482 715 o brut / 159 751 o gzip) parce que `await import()` renvoyait
 *      l'espace de noms entier, ce qui empêchait Rollup d'élaguer ses exports
 *      (replay, feedback, profiler…). Le déstructurer au site d'appel a ramené
 *      ce chunk à 87 044 o / 29 538 o gzip (−82 %), et son initialisation est
 *      désormais différée après interaction (voir src/utils/sentry.js).
 *   2. PLUS GROS CHUNK — mesure : vendor-leaflet 47,5 Ko gzip.
 *   3. BUILD TOTAL (brut, tous fichiers) — mesure du 11/10/2026 : 5,08 Mo,
 *      dont ~1,3 Mo d'IMAGES DE CONTENU (la famille du héros — les six JPEG,
 *      561 Ko, et leurs 24 variantes AVIF et WebP, 712 Ko — et les quatre photos
 *      de la galerie, 452 Ko) et la MÊME feuille de styles pré-rendue recopiée
 *      dans chaque document — 995 321 o = 0,95 Mo mesurés le 11/10/2026 (14
 *      documents, dont 13 portant la feuille identique : 76 533 o, sha
 *      41d0f2e82d7950d9 ; le 09/10/2026 : 900 980 o, 69 276 o, sha
 *      d8c74e2cb457a497) : le total est donc un budget de CONTENU autant que de
 *      code, et il suit une page ou une photo ajoutée.
 *
 *      Ce chiffre porte une DATE parce que la ligne qui le portait avant avait
 *      DÉRIVÉ : elle annonçait « ~1,5 Mo … recopiée dans les 22 pages (69 Ko ×
 *      22) », soit un compte de pages que le build ne publie pas (14 documents,
 *      dont 13 pages pré-rendues et le 404). C'est exactement ce qu'un budget
 *      global ne peut pas dire — QUELLE page et de COMBIEN — et c'est pourquoi
 *      cette grandeur a désormais son propre garde, page par page :
 *      `scripts/check-css-inline-budget.js` (une ligne par document du build,
 *      dépassement chiffré, plancher, blocs `<style>`, feuille divergente). Le
 *      budget ci-dessous, lui, reste un budget de BUILD : il absorbe cette
 *      duplication dans un seul nombre et ne la distingue plus. Il a été relevé de 4,00 à 4,50 Mo le 29/09/2026, puis de 4,50 à
 *      5,50 Mo le 08/10/2026 avec l'arrivée des variantes du héros (voir le
 *      commentaire de BUDGETS.totalRaw, qui porte les DEUX mesures) — les trois
 *      autres budgets, qui gardent la STRUCTURE (chemin critique, plus gros
 *      chunk, unité paresseuse), ne bougent pas d'un octet.
 *   4. CHUNKS À LA DEMANDE — un chunk listé dans CHUNKS_A_LA_DEMANDE ne doit
 *      être atteignable que par `import()` dynamique. Un budget de TAILLE ne
 *      peut pas attraper cette régression : le chunk existe et pèse pareil dans
 *      les deux cas, seul son POINT D'ENTRÉE change. Mesure du 24/09/2026 sur la
 *      production, avant ce budget : /jobs téléchargait les 48,6 Ko gzip de
 *      Leaflet au chargement alors que sa vue par défaut est la liste, dont
 *      38 Ko sans être exécutés (`unused-javascript` 0,5 — la seule page du site
 *      dans ce cas). Voir CHUNKS_A_LA_DEMANDE pour le détail et le correctif.
 *
 * Les seuils n'échouent pas sur la variance d'arrondi de Vite, mais attrapent
 * une régression de structure (un chunk entier qui revient dans le chemin
 * critique, un vendor dupliqué, la réapparition d'un SDK non élagué, etc.).
 * Ils ont été calibrés quand le plus gros chunk était à 156 Ko ; après le
 * correctif Sentry la marge du 2e budget est devenue très large (47,5 Ko pour
 * 200 Ko). Elle est laissée telle quelle à dessein : un seuil resserré au ras
 * de la mesure courante produirait des rouges sur la simple croissance d'une
 * dépendance (leaflet), pas sur une régression de structure.
 * Le check est une fonction exportée (convention des autres gardes) : il est
 * testé par scripts/__tests__/check-bundle-size.test.js sur des fixtures, donc
 * il n'a pas besoin d'un build réel pour être vérifié.
 *
 * Usage : cd frontend && npm run build && node scripts/check-bundle-size.js
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Budgets en OCTETS (Ko = 1024). Toute modification doit s'accompagner d'une
// mesure du build réel et d'une explication dans le message de commit.
//
// `totalRaw` est passé de 4,00 à 4,50 Mo le 29/09/2026, et la mesure est écrite
// ici pour que la raison survive au commit : build mesuré à 4,28 Mo, dont
// ~950 Ko d'IMAGES DE CONTENU — les six photos du héros de l'accueil (561 Ko
// après ré-échantillonnage, voir src/config/photos-heros.js) et les quatre de la
// galerie (452 Ko). Ce budget n'a jamais été un budget de CODE : le code, lui,
// est borné par les trois autres (JS initial, plus gros chunk, unité paresseuse),
// qui n'ont pas bougé. Un total qui inclut le contenu doit donc suivre le
// contenu — mais il doit le DIRE, et c'est à ça que sert ce paragraphe.
//
// ── 08/10/2026 : 4,50 → 5,50 Mo, POUR LES VARIANTES DU HÉROS ──────────────
// Les six photos du héros sont désormais publiées dans un `<picture>` (AVIF,
// WebP, puis le JPEG en repli) à DEUX largeurs, 480 et 720 : 24 fichiers de
// plus, 746 304 o, soit la famille du héros passant de 574 211 à 1 320 515 o
// (mesuré par scripts/check-hero-images.js, qui relit le manifeste du
// générateur). Build mesuré : 4,34 Mo SANS ces variantes, 5,05 Mo avec — le
// dépassement est donc bien celui de cette passe, et il est de CONTENU.
//
// ET C'EST LÀ QU'IL FAUT LIRE LES DEUX CHIFFRES ENSEMBLE, sans quoi ce
// relèvement ressemblerait à un renoncement : ce que ce budget mesure, c'est ce
// que le BUILD CONTIENT ; ce qu'un VISITEUR télécharge au premier écran, lui, a
// été divisé par 5,4 (la photo de tête passe de 63 509 o de JPEG à 11 854 o
// d'AVIF 480, −81,3 %, et la fenêtre mesurée — photo de tête + préchargement du
// cran suivant — de ~126 Ko à 22 144 o). Les deux nombres ne se contredisent
// pas : un héros qui télécharge moins peut peser plus dans le build, parce que
// le repli reste publié pour les navigateurs qui n'ont pas de décodeur AVIF ni
// WebP. La mesure du téléchargement, elle, se fait dans un vrai navigateur et
// vit ailleurs : e2e/heros-format.spec.js, qui lit les octets de la réponse,
// exige UNE seule requête pour la photo de tête et l'absence de tout JPEG du
// héros sur la navigation.
// ── 22/10/2026 : 130 → 131 Ko, POUR LA PREUVE SOCIALE DE L'ACCUEIL ────────
// La bande de faits du héros lit désormais `GET /api/public/stats` et formate
// ses trois compteurs dans la langue courante (`utils/preuveSociale.js`) : ce
// code vit dans le chunk d'accueil, EAGER parce que c'est la page d'arrivée —
// la charger à la demande ajouterait un aller-retour au premier écran, ce que
// ce budget n'a jamais demandé. Mesure du jour : 130,1 Ko gzip (133 176 o des
// sept chunks référencés), soit 56 o au-dessus de l'ancien plafond — et ce
// n'est pas un import repassé en statique : les six chunks `vendor*` n'ont pas
// bougé (react-dom 41 673 o, router 13 756 o, lucide 7 468 o, react 2 868 o),
// seul `Home` porte la règle. Le plafond passe donc à 131 Ko, avec 0,9 Ko de
// marge : un relèvement de 1 Ko pour 56 o mesurés laisserait sinon le prochain
// hachage de build décider à la place du développeur.
// ── 26/10/2026 (soir) : ELLE REVIENT, SOUS SEUIL ET DANS UN NŒUD DÉJÀ PEINT ──
// Le retrait ci-dessous a laissé la bande sans aucune preuve de ce que la
// plateforme a FAIT. `utils/preuveSociale.js` revient, plus court qu'en octobre
// (seuils + lecture + formatage, aucune phrase) : la page lit de nouveau
// `GET /api/public/stats` APRÈS montage et n'écrit que le TEXTE de la ligne de
// preuve, dans le nœud que la coquille a déjà peint. Mesuré : 132,0 Ko gzip des
// sept chunks référencés, budget 133,0 — la marge tombe à 1,0 Ko, et ce chiffre
// est publié ici pour que le prochain ajout sache qu'il n'y a plus de place
// pour un import lourd dans le chunk d'accueil (le prochain levier est de
// déplacer la lecture, pas de relever le plafond).
// ── 26/10/2026 : la preuve sociale QUITTE l'accueil ───────────────────────
// Rectification du paragraphe ci-dessus, qui n'est plus vrai : la bande de faits
// n'appelle plus `GET /api/public/stats` et ne formate plus de compteur. Mesuré
// en production, elle affichait « 0 mission terminée · 0 avis » ; les deux faits
// qui restent sont déclarés et ne dépendent d'aucune donnée. Le module
// `utils/preuveSociale.js` est supprimé, et le chunk d'accueil perd son appel
// comme sa règle de formatage. Le plafond, lui, ne redescend pas dans ce
// commit : on ne fait pas un budget sur un retrait d'une journée, et la marge
// reste. Ce qui est refusé, en revanche, est écrit plus haut dans
// `scripts/check-prerender-shells.js` : un ZÉRO publié comme preuve sociale.
// ── 24/10/2026 : 131 → 132 Ko et 5,50 → 5,55 Mo, POUR LA MODÉRATION ───────
// `/administration` donne au propriétaire le répertoire des comptes, leur état
// (restreint/banni) et la lecture des fils : c'est une PAGE, et elle est
// paresseuse — son chunk (`Administration`, 26 642 o bruts) n'est PAS dans le
// premier écran. Le premier écran n'a pourtant pas rien payé : `index` passe de
// 193 279 à 194 883 o bruts (61 718 → 62 041 o gzip), soit 323 o gzip pour la
// route et son garde, et les six `vendor*` sont INCHANGÉS (react-dom 41 673,
// router 13 756, lucide 7 468, react 2 868 o gzip) : ce n'est donc pas un
// import repassé en statique. Mesure du jour : 131,3 Ko gzip (134 491 o des
// sept chunks référencés) et 5,51 Mo (5 779 379 o des 148 fichiers) ; la veille
// au matin, 130,9 Ko et 5,48 Mo. Le total suit le CONTENU : la page, le
// dictionnaire de son scope dans les cinq langues et le graphe de préchargement
// des quatorze gabarits. Les plafonds passent à 132 Ko et 5,55 Mo, avec 0,7 Ko
// et 40 Ko de marge, pour la même raison qu'au 22/10 : laisser le prochain
// hachage de build fixer le seuil, c'est laisser un hash décider à la place du
// développeur.
// ── 25/10/2026 : 132 → 133 Ko, POUR LE PARTAGE D'UNE MISSION ──────────────
// Le bouton Partager ajoute une clé au dictionnaire GLOBAL (`shareJob`) : le
// français est le dictionnaire par DÉFAUT, donc il vit dans `index` et la clé y
// coûte ses octets (mesuré sur le chunk minifié : `shareJob:ng,` = 12 o bruts,
// 7 o gzip — la valeur est déjà partagée par le minifieur). Les boutons, eux, ne
// sont PAS dans le premier écran : la carte est dans le chunk `Jobs`, la fiche
// dans `JobDetails`, tous deux paresseux. Mesure du jour : 135 189 o gzip des
// sept chunks référencés, soit 21 o au-dessus de l'ancien plafond — dont 7 o de
// cette clé ; la branche au moment de la mesure en portait 14 de plus, et c'est
// ÉCRIT plutôt qu'attribué à ce seul bouton. Le plafond passe à 133 Ko avec
// 1 Ko de marge, pour la raison du 22/10 : laisser le prochain hachage de build
// fixer le seuil, c'est laisser un hash décider à la place du développeur.
// ── 27/10/2026 : 133 → 134 Ko et 5,55 → 5,63 Mo, POUR LE MAILLAGE SEO ─────
// Les 32 pages ville, métier et guides n'étaient citées par AUCUNE page du
// site (le sitemap était leur seul chemin) : l'accueil et le pied de page les
// citent désormais par leur nom, et le pied de page est dans les DOUZE
// documents pré-rendus. Ce n'est donc pas un chunk qui grossit mais le HTML
// servi, et c'est le prix du texte de lien lui-même : 32 `<a href>` avec leur
// libellé, publiés deux fois sur `/` (bloc d'accueil + pied de page) et une
// fois sur les onze autres coquilles. Mesuré sur le build du jour, même arbre
// à la même heure : `index.html` 132 790 → 141 825 o (+9 035), `login.html`
// 105 333 → 109 812 o (+4 479), build entier 5 807 294 → 5 868 926 o des 149
// fichiers, soit +61 632 o. Le JS initial paie 0,8 Ko gzip de plus (132,0 →
// 132,8) parce que le pied de page vit dans `index` — les libellés et les href
// des 32 pages, une fois, pas par route : les chunks paresseux ne bougent pas.
// Les plafonds passent à 134 Ko et 5,63 Mo, avec 1,2 Ko et 34 Ko de marge, pour
// la raison du 22/10 : laisser le prochain hachage de build fixer le seuil,
// c'est laisser un hash décider à la place du développeur.
// ── 28/10/2026 : 5,63 → 5,66 Mo, POUR LES GUIDES DE PRIX PAR VILLE ───────
// Le point d'étape des guides de ville porte le maillage de 32 à 45 pages
// (13 guides `prix-{ville}` de plus, un par ville du référentiel, publiés au
// sitemap par la même déclaration). Mesuré sur le build du jour : `index.html`
// 141 825 → 145 103 o (+3 278), `login.html` 109 812 → 111 446 o (+1 634),
// build entier 5 868 926 → 5 890 956 o des 149 fichiers, soit +22 030 o — les
// 149 fichiers sont le MÊME compte qu'avant : ces pages sont servies par le
// backend, seule la liste de liens du HTML pré-rendu grandit. Le JS initial ne
// bouge pas (132,8 → 133,0 Ko gzip, le libellé d'un guide est une constante du
// module partagé). Plafond porté à 5,66 Mo, soit 44 Ko de marge, pour la raison
// du 22/10 : laisser le prochain hachage de build fixer le seuil, c'est
// laisser un hash décider à la place du développeur.
//
// Ce qui FERAIT baisser ce total, et qui n'est pas fait ici : les onze
// coquilles hors accueil répètent le même bloc. Le sortir du HTML pré-rendu
// rendrait le maillage invisible au crawler qui ne lit que le document servi
// — c'est-à-dire précisément le cas que ce bloc existe pour couvrir.
// ── 29/10/2026 : 134 → 135 Ko, POUR LE TROISIÈME FOURNISSEUR D'ANALYTICS ──
// PostHog s'ajoute à GA4 et à Plausible (choix du propriétaire, mesuré plus
// bas). Ce que le JS initial paie n'est PAS le SDK : `array.js` est chargé
// depuis `eu-assets.i.posthog.com`, donc hors du bundle et hors de ce budget.
// Il paie le module de constantes (deux origines, la forme `phc_…`), l'injecteur
// consentement-gated et le relais de page vue qui sert désormais les DEUX
// fournisseurs : mesuré sur le build du jour, 134,2 Ko gzip des sept chunks
// référencés par `index.html`, soit +1,2 Ko par rapport aux 133,0 du 28/10 — et
// c'est ce qui a fait REFUSER le premier jet (134,2 > 134,0). Le plafond passe
// à 135 Ko avec 0,8 Ko de marge, pour la raison du 22/10 : laisser le prochain
// hachage de build fixer le seuil, c'est laisser un hash décider à la place du
// développeur. Les chunks paresseux ne bougent pas (rien n'importe PostHog) et
// le total reste à 5,62 Mo.
// ── 30/10/2026 : 134,2 → **126,7 Ko**, LA MARGE RECONQUISE PLUTÔT QUE REPOUSSÉE ──
// L'audit du matin rendait le JS initial à **135,5 Ko gzip pour un budget de
// 135** — marge nulle, et dépassement. Deux postes payés par des visiteurs qui
// n'en avaient pas l'usage ont été retirés, sans relever le plafond :
//   • `lucide-react` (7,4 Ko) était PRÉCHARGÉ par `index.html` parce que six
//     modules du SHELL l'importaient — `NotificationPanel` (neuf glyphes),
//     `NetworkStatus` (six), `ErrorBoundary`, `LanguageSelector`,
//     `CountrySelector`, `CountryDisplay`, `FlagIcon`. Leurs tracés sont
//     désormais dans `src/components/chrome-icons.js`, copiés à l'identique de
//     lucide v0.507.0 (mêmes `d`), donc sans un pixel de différence. Le panneau
//     de notifications d'un visiteur qui ne l'ouvre jamais, et l'indicateur de
//     réseau d'un réseau correct, ne justifiaient pas cette dépense.
//   • `utils/analytics.js` (l'injection Plausible / GA4 / PostHog) n'est plus
//     importé statiquement : `utils/seo.js` lit le planificateur de vue dans
//     `utils/vue-de-page.js`, `ConsentBanner` lit la configuration dans
//     `utils/mesure-audience.js`, et le module d'injection arrive par `import()`
//     sur consentement (`index.js`, `ConsentBanner.js`).
// MESURÉ après : 126,7 Ko gzip des six chunks référencés par `index.html`
// (index 63,7 · vendor-react-dom 40,7 · vendor-router 13,4 · Home 4,4 ·
// vendor-react 2,8 · vendor 1,6), `vendor-lucide` n'étant plus dans le chemin
// critique. Le plafond RESTE à 135 Ko : il a maintenant 8,3 Ko de marge, et il
// ne doit pas servir de cible.
// ── 30/10/2026 : 5,66 → 7,00 Mo, POUR LES DOCUMENTS DE LA SECONDE LANGUE ────
// Une langue INDEXÉE a son propre document (`src/config/langues-indexees.js`) :
// le build écrit douze coquilles de plus dans `build/en/` — les mêmes pages dans
// l'autre langue, avec le CSS critique inliné et les 45 liens du pied de page.
// Mesuré : 1 373 245 o pour les douze (114 Ko de moyenne), build entier à
// **7 257 540 o / 160 fichiers** contre 5 888 238 o / 146 la veille, soit
// +1 369 302 o dont 99,7 % sont ces documents.
// CE QUE LE VISITEUR TÉLÉCHARGE NE BOUGE PAS, et c'est la distinction que ce
// paragraphe existe pour tenir : le JS initial reste à 126,7 Ko gzip (un
// document n'est pas du code, et les quatre autres budgets sont inchangés),
// et un HTML part compressé par Vercel. Ce budget mesure la TAILLE DU BUILD ; il
// paie donc ici une décision de fond — une URL et un `hreflang` réciproque par
// langue, ce que l'audit du 30/10 reprochait au site de ne pas avoir — et non
// une dérive de dépendance. La baisse possible est de NE PAS publier l'anglais
// comme document : c'est exactement le défaut mesuré le matin (mille clés en
// cinq langues, une seule surface indexable, aucun `hreflang`), donc elle est
// REFUSÉE — et écrite, pour qu'un prochain relèvement ne se lise pas comme un
// abandon.
export const BUDGETS = {
  initialGzip: 135 * 1024, // JS initial (chunks référencés par index.html), gzip
  largestChunkGzip: 200 * 1024, // plus gros chunk JS, gzip
  totalRaw: 7.00 * 1024 * 1024, // build/ entier, brut (voir les mesures datées ci-dessus)
  // ── PLAFOND PAR MODULE (31/10/2026) ──────────────────────────────────────
  // Avant ce plafond, un chunk n'était borné QUE s'il était le plus gros du
  // build (`largestChunkGzip`, 200 Ko) : le deuxième, le troisième et les
  // cinquante-neuf suivants pouvaient chacun doubler de taille sans qu'aucun
  // budget ne bronche, pourvu qu'ils restent sous le premier. Le budget total,
  // lui, ne dit rien d'un module : +40 Ko de build éparpillés sur soixante
  // chunks et +40 Ko sur UN chunk paresseux s'y lisent pareil.
  //
  // Mesuré sur le build du 31/10/2026 (62 chunks JS) : le plus gros module HORS
  // chemin critique est `vendor-leaflet` à 47,5 Ko gzip ; les suivants sont
  // `vendor-react-dom` 40,7, `vendor-sentry` 29,0 et les quatre dictionnaires
  // (mos 26,2 / wo 26,2 / en 26,1 / bm 25,3). 56 Ko laisse donc 18 % de marge au
  // plus gros module paresseux — et laisse `vendor-leaflet` (la carte de /jobs,
  // chargée par `import()`) rester le point de comparaison qu'il est.
  //
  // Le CHEMIN CRITIQUE est exclu, et c'est une décision de non-duplication :
  // `index.html` et ses dépendances statiques sont déjà jugés par
  // `initialGzip` (135 Ko pour leur SOMME) et par `largestChunkGzip` — un
  // plafond par module y rendrait un second verdict sur les mêmes octets, et
  // l'entrée (64,1 Ko, le plus gros fichier du build) le franchirait par
  // construction. Ici, chaque module PARESSEUX répond de lui-même.
  chunkGzip: 56 * 1024,
};

// Plancher de LECTURE du budget par module, en NATURE et non en nombre : un
// build où TOUT est dans le chemin critique ne juge aucun module (et c'est un
// changement de structure, pas une mesure à zéro tolérée). Un nombre fixe aurait
// jugé la taille des fixtures autant que celle du build.
const AUCUN_MODULE_HORS_CRITIQUE = 0;

const ko = (bytes) => `${(bytes / 1024).toFixed(1)} Ko`;

// ── Chunks qui doivent rester À LA DEMANDE ────────────────────────────────
// Chaque entrée est un PRÉFIXE de chunk (les noms émis sont hachés :
// `<préfixe>-<hash>.js`). Ensemble, ces chunks forment une UNITÉ paresseuse :
// rien de ce qu'ils contiennent ne doit être téléchargé avant que
// l'utilisateur ne demande la fonctionnalité. La règle tient parce que l'unité
// est ATTEINTE par `import()` : ses membres peuvent s'importer statiquement
// entre eux (c'est une seule fonctionnalité), mais aucun chunk ordinaire ne
// peut en importer un.
//
//   `vendor-leaflet` + `JobsMap` : la carte de /jobs. Leaflet ne publie qu'un
//   bundle UMD ES5 (`dist/leaflet-src.js` — ni champ `module`, ni `exports`)
//   que Rollup ne peut pas élaguer : 155,7 Ko brut / 48,6 Ko gzip pour une
//   carte qu'on n'a pas ouverte. `JobsMap` l'importe STATIQUEMENT — c'est sa
//   dépendance, et c'est légitime DANS l'unité. L'unité reste à la demande
//   parce que src/pages/Jobs.js monte la carte en `React.lazy`. Avant, le
//   `import JobsMap from '../components/JobsMap'` statique faisait partir les
//   48,6 Ko à CHAQUE chargement de /jobs, dont la vue par défaut est la liste —
//   mesuré sur la production : 38 des 48 Ko gzip téléchargés sans être
//   exécutés (`unused-javascript` 0,5, la seule page du site dans ce cas).
//
//   À maintenir ENSEMBLE : renommer un fichier de l'unité fait rougir ce garde
//   (le préfixe ne correspond plus, donc l'unité semble atteinte depuis un
//   chunk ordinaire). C'est voulu : cette liste doit rester la vérité.
export const CHUNKS_A_LA_DEMANDE = ['vendor-leaflet', 'JobsMap'];

/** Ce nom de chunk appartient-il à l'unité paresseuse déclarée ? */
export const estChunkALaDemande = (nom, prefixes = CHUNKS_A_LA_DEMANDE) =>
  prefixes.some((p) => nom.startsWith(`${p}-`) || nom === `${p}.js`);

/**
 * Arêtes d'imports lues dans un chunk buildé, séparées par NATURE.
 *
 * Rollup/ESBuild émettent la forme statique en `from"./x.js"` (import lié) ou
 * `import"./x.js"` (effet de bord), et la forme dynamique en `import("./x.js")`.
 * Les motifs exigent un GUILLEMET juste après `from`/`import` : la parenthèse de
 * la forme dynamique ne peut donc jamais passer pour un import statique — c'est
 * toute la distinction que ce garde exploite.
 *
 * @param {string} source Contenu du chunk.
 * @returns {{statiques: string[], dynamiques: string[]}} Noms de fichiers visés.
 */
export const aretesDImport = (source) => {
  const statiques = [];
  const dynamiques = [];
  for (const m of source.matchAll(/(?:^|[^\w$.])from\s*["']([^"']+)["']/g)) {
    statiques.push(path.basename(m[1]));
  }
  for (const m of source.matchAll(/(?:^|[^\w$.])import\s*["']([^"']+)["']/g)) {
    statiques.push(path.basename(m[1]));
  }
  for (const m of source.matchAll(/(?:^|[^\w$.])import\s*\(\s*["']([^"']+)["']/g)) {
    dynamiques.push(path.basename(m[1]));
  }
  return { statiques, dynamiques };
};

/**
 * Vérifie que l'unité paresseuse est bien restée paresseuse.
 *
 * Deux refus, et il faut LES DEUX :
 *   1. un chunk ordinaire importe statiquement un membre de l'unité →
 *      l'unité entre dans le chemin critique de ce chunk ;
 *   2. aucun `import()` ne mène à l'unité → elle n'est plus « à la demande »
 *      mais « plus atteignable » (un `React.lazy` supprimé laisserait sinon un
 *      garde satisfait par la disparition de ce qu'il surveille).
 *
 * @param {string[]} fichiers Chunks .js du build.
 * @param {string[]} [prefixes] Préfixes de l'unité paresseuse.
 * @returns {string[]} Une ligne par écart.
 */
export const auditChunksALaDemande = (fichiers, prefixes = CHUNKS_A_LA_DEMANDE) => {
  const graphes = fichiers.map((file) => {
    const { statiques, dynamiques } = aretesDImport(readFileSync(file, 'utf8'));
    return { file: path.basename(file), statiques, dynamiques };
  });

  // L'unité paresseuse RÉELLE = ce que le build a produit sous ces préfixes.
  const unite = graphes
    .map((g) => g.file)
    .filter((nom) => estChunkALaDemande(nom, prefixes));

  if (unite.length === 0) {
    return [
      `aucun chunk ${prefixes.join(' / ')} dans le build — l'unité paresseuse ` +
        `déclarée n'existe plus : mettre à jour CHUNKS_A_LA_DEMANDE (le garde ` +
        `surveille sinon un chunk qui n'est jamais émis)`,
    ];
  }

  const erreurs = [];
  const vise = new Set(unite.filter((nom) => nom.endsWith('.js')));

  // Refus 1 : une arête statique venue de l'extérieur de l'unité.
  for (const g of graphes) {
    if (vise.has(g.file)) continue;
    for (const dep of g.statiques) {
      if (!vise.has(dep)) continue;
      erreurs.push(
        `${g.file} importe STATIQUEMENT ${dep} — l'unité à la demande ` +
          `(${prefixes.join(' + ')}) repasserait dans le chargement de ce chunk : ` +
          `le navigateur téléchargerait des octets que la page n'exécute pas ` +
          `(Lighthouse \`unused-javascript\`). La charger par \`import()\` ` +
          `dynamique (React.lazy) : voir src/pages/Jobs.js`
      );
    }
  }

  // Refus 2 : plus aucun `import()` ne mène à l'unité.
  const atteinteEnDynamique = graphes.some((g) =>
    g.dynamiques.some((dep) => vise.has(dep))
  );
  if (!atteinteEnDynamique) {
    erreurs.push(
      `aucun \`import()\` ne mène à ${unite.join(', ')} — l'unité n'est plus ` +
        `« à la demande » mais « plus atteignable » : la fonctionnalité qui la ` +
        `charge a disparu (ou ne passe plus par React.lazy), donc le garde ne ` +
        `surveille plus rien`
    );
  }

  return erreurs;
};

const walkFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
};

/**
 * Vérifie les budgets de taille du build.
 *
 * @param {object} [options]
 * @param {string} [options.root]  Racine frontend (contient build/).
 * @param {boolean} [options.quiet] Tait la sortie de progression (tests).
 * @returns {{ok: boolean, errors: string[], stats: object}}
 */
export const checkBundleSize = ({ root, quiet = false } = {}) => {
  const ROOT = root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const BUILD = path.join(ROOT, 'build');
  const INDEX = path.join(BUILD, 'index.html');

  const log = (...args) => {
    if (!quiet) console.log(...args);
  };
  const errors = [];

  // Un build absent est une ERREUR : sinon le check passerait en ne mesurant
  // rien (exactement le défaut qu'il corrige).
  if (!existsSync(INDEX)) {
    return {
      ok: false,
      errors: [`build/index.html introuvable dans ${BUILD} — lancer \`npm run build\` avant ce check`],
      stats: null,
    };
  }

  const html = readFileSync(INDEX, 'utf8');
  // Chunks du chemin critique : <script src> de l'entrée + modulepreload des
  // dépendances statiques (Vite émet les deux dans index.html).
  const refs = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1])
    ),
  ];

  const initialChunks = [];
  for (const ref of refs) {
    const file = path.join(BUILD, ref.replace(/^\//, ''));
    if (!existsSync(file)) {
      errors.push(`index.html référence ${ref} qui n'existe pas dans build/`);
      continue;
    }
    const raw = statSync(file).size;
    const gzip = gzipSync(readFileSync(file)).length;
    initialChunks.push({ file: path.basename(file), raw, gzip });
  }

  const allFiles = walkFiles(BUILD);
  const totalRaw = allFiles.reduce((sum, f) => sum + statSync(f).size, 0);

  const jsFiles = allFiles.filter((f) => f.endsWith('.js'));
  const chunks = jsFiles
    .map((f) => ({ file: path.basename(f), raw: statSync(f).size, gzip: gzipSync(readFileSync(f)).length }))
    .sort((a, b) => b.gzip - a.gzip);
  const largest = chunks[0] || null;

  const initialGzip = initialChunks.reduce((sum, c) => sum + c.gzip, 0);

  // ── Budget 1 : JS initial ──────────────────────────────────────────────
  if (initialGzip > BUDGETS.initialGzip) {
    errors.push(
      `JS initial ${ko(initialGzip)} gzip > budget ${ko(BUDGETS.initialGzip)} ` +
        `(${initialChunks.length} chunks référencés par index.html) — ` +
        `un import du shell est-il repassé en statique ?`
    );
  }

  // ── Budget 2 : plus gros chunk ─────────────────────────────────────────
  if (largest && largest.gzip > BUDGETS.largestChunkGzip) {
    errors.push(
      `plus gros chunk ${ko(largest.gzip)} gzip (${largest.file}) > budget ` +
        `${ko(BUDGETS.largestChunkGzip)} — vérifier les règles manualChunks`
    );
  }

  // ── Budget 3 : build total ─────────────────────────────────────────────
  if (totalRaw > BUDGETS.totalRaw) {
    errors.push(
      `build total ${(totalRaw / 1024 / 1024).toFixed(2)} Mo > budget ` +
        `${(BUDGETS.totalRaw / 1024 / 1024).toFixed(2)} Mo (${allFiles.length} fichiers)`
    );
  }

  // ── Budget 4 : taille de CHAQUE module hors chemin critique ────────────
  // Un module paresseux qui grossit ne déplace pas forcément le plus gros
  // chunk ni le total d'un octet visible : c'est ce trou que ce budget ferme.
  // Il nomme CHAQUE fautif (pas seulement le pire), avec sa taille et le
  // plafond, et il refuse de conclure sur un build qui ne porte presque plus
  // de modules à juger.
  const nomsInitiaux = new Set(initialChunks.map((c) => c.file));
  const modulesHorsCritique = chunks.filter((c) => !nomsInitiaux.has(c.file));
  if (modulesHorsCritique.length === AUCUN_MODULE_HORS_CRITIQUE) {
    errors.push(
      `budget par module : aucun module hors chemin critique sur ${chunks.length} chunk(s) ` +
        `— tout est devenu initial, donc ce budget ne juge plus rien (et le visiteur ` +
        `télécharge ce qu'il n'exécute pas)`
    );
  }
  for (const module of modulesHorsCritique) {
    if (module.gzip > BUDGETS.chunkGzip) {
      errors.push(
        `module ${module.file} : ${ko(module.gzip)} gzip > plafond ${ko(BUDGETS.chunkGzip)} ` +
          `par module (${(module.gzip / BUDGETS.chunkGzip).toFixed(2)}×) — un module ` +
          `paresseux qui grossit ne déplace ni le plus gros chunk ni le total : ` +
          `le découper (\`import()\`) ou justifier le relèvement dans BUDGETS.chunkGzip`
      );
    }
  }

  // ── Budget 5 : l'unité paresseuse est restée paresseuse ──────────────
  // Aucune arête STATIQUE venue de l'extérieur ne doit mener à un chunk à la
  // demande : elle l'entraînerait dans le chargement de ce chunk.
  const ecartsALaDemande = auditChunksALaDemande(jsFiles);
  errors.push(...ecartsALaDemande);
  // Le préchargement depuis index.html est la même faute par un autre chemin :
  // le chunk partirait avec le shell, avant même que la page existe.
  for (const ref of refs) {
    if (estChunkALaDemande(path.basename(ref))) {
      errors.push(
        `index.html précharge ${ref} — un chunk à la demande ne doit pas figurer ` +
          `dans le chemin critique du shell`
      );
    }
  }

  log('Budgets de taille du bundle :');
  for (const chunk of [...initialChunks].sort((a, b) => b.gzip - a.gzip)) {
    log(`  ${ko(chunk.gzip).padStart(9)} gzip (${ko(chunk.raw).padStart(9)} brut)  ${chunk.file}`);
  }
  log(
    `  JS initial          : ${ko(initialGzip)} gzip / budget ${ko(BUDGETS.initialGzip)}`
  );
  if (largest) {
    log(
      `  plus gros chunk     : ${ko(largest.gzip)} gzip (${largest.file}) / budget ${ko(BUDGETS.largestChunkGzip)}`
    );
  }
  log(
    `  build total         : ${(totalRaw / 1024 / 1024).toFixed(2)} Mo / budget ` +
      `${(BUDGETS.totalRaw / 1024 / 1024).toFixed(2)} Mo`
  );
  // Le plafond par module est publié AVEC son plus gros porteur : un plafond
  // qui n'affiche que son dépassement n'a servi à aucun arbitrage.
  const plusGrosModule = modulesHorsCritique[0] || null;
  log(
    `  modules (hors critique) : ${modulesHorsCritique.length} jugé(s), plus gros ` +
      `${plusGrosModule ? `${ko(plusGrosModule.gzip)} gzip (${plusGrosModule.file})` : 'aucun'} ` +
      `/ plafond ${ko(BUDGETS.chunkGzip)}`
  );
  log(
    `  chunks à la demande : ${CHUNKS_A_LA_DEMANDE.join(' + ')} ` +
      `(${ecartsALaDemande.length} écart(s))`
  );

  const stats = {
    initialGzip,
    largest,
    totalRaw,
    initialChunks,
    modulesHorsCritique,
    ecartsALaDemande,
  };

  if (errors.length > 0) {
    console.error(`\n❌ Budget de bundle dépassé (${errors.length} problème(s)) :`);
    for (const message of errors) console.error(`   • ${message}`);
    return { ok: false, errors, stats };
  }

  log(
    '\n✅ Bundle dans les budgets (JS initial, plus gros chunk, build total, ' +
      'taille de chaque module hors chemin critique, chunks à la demande).'
  );
  return { ok: true, errors, stats };
};

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = checkBundleSize();
  if (!result.ok) process.exit(1);
}
