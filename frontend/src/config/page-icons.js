// LES ICÔNES DESSINÉES du corps des pages pré-rendues.
//
// ── Pourquoi ce module existe ──────────────────────────────────────────────
// Le corps d'une page publiait ses glyphes décoratifs en EMOJI, par leur clé
// i18n (`iconCategoryGeneral`, `iconHomeStep1`, `iconEscrow`…). Un emoji est un
// GLYPHE DE COULEUR : le moteur doit chercher la police qui le porte et le
// composer, et ce que ça coûte se lit au « Style & Layout ». MESURÉ le
// 26/09/2026 sur la coquille pré-rendue de l'accueil (sonde
// `e2e/style-layout-document.spec.js`, cpu×4, 412×823, 25 runs ENTRELACÉS, min) :
// remplacer les 21 glyphes `aria-hidden` par un caractère latin retire
// **~194 à 202 ms** de « Style & Layout » (632 → 439 ms, médiane 669 → 467 ms),
// soit ~31 % du coût du document, à hauteur et nombre de nœuds INCHANGÉS. Aucun
// levier CSS testé ne s'en approche (présentation texte des emoji, police
// monochrome, taille réduite, pile de polices, `text-rendering` : tous mesurés
// à ~0 ou négatifs — un résultat de −54 ms obtenu en mesurant les variantes à la
// suite était la DÉRIVE de l'hôte, réfuté par le protocole entrelacé). Après
// remplacement, la sonde mesure le document d'accueil à 467 ms (mobile) contre
// 639 ms avant.
//
// ÉTENDU le 26/09/2026 aux QUATRE pages qui en publiaient encore — À propos,
// Comment ça marche, Support, Contact — et aux quatre glyphes du bloc de contact
// de l'accueil. Mesuré ENTRELACÉ (25 à 30 tours, minimum, la variante emoji
// reconstruite dans le document livré) : /contact −22,8 % en mobile et −23,0 % en
// desktop, /support −17,9 % / −20,7 %, /about −5,4 % / −5,1 %, /how-it-works
// −4,6 % / −3,2 %, et l'accueil −12,5 % / −10,0 % pour ses quatre derniers
// glyphes. Le gain n'est donc pas un chiffre unique : il suit le NOMBRE d'emoji
// (~8 à 10 ms par glyphe mobile), ce qui laisse les pages qui n'en portent que
// trois à une quinzaine de millisecondes — mais toujours dans le même sens.
//
// CLOS le 26/09/2026 avec les QUATRE écrans de compte — /login, /register,
// /forgot-password, /payment — les derniers à publier des emoji (leurs clés
// `*IconKey`). Même protocole ENTRELACÉ (25 tours, minimum) : /login −56,3 ms
// mobile (−34 %) / −11,7 desktop, /register −176,2 (−65 %) / −34,3 (huit
// glyphes), /forgot-password −65,6 (−43 %) / −15,6, /payment −47,6 (−30 %)
// / −10,4. LEÇON QUI COMPLÈTE LA PRÉCÉDENTE : le PREMIER emoji d'une page coûte
// à lui seul ~47 à 66 ms mobile (chargement de la police de couleur), donc la loi
// « ~8 à 10 ms par glyphe » ne décrit que les emoji SUIVANTS — une page à un seul
// glyphe gagne autant qu'une page à six. Trois dessins sont RÉUTILISÉS plutôt que
// recopiés, comme `escrow` l'a été : le wrench de `categoryPlumbing` pour le
// travailleur (`workerIcon`), l'enveloppe de `contactSendEmail` pour la
// réinitialisation (`badgeIcon`), la mallette de `promiseFindWork` pour /payment
// (`noJobIcon`).
//
// ── Un propriétaire, deux canaux ───────────────────────────────────────────
// La coquille est écrite par Node (`vite-plugins/prerender/shells-home.js`) et
// la page par React (`src/pages/Home.js`) : les deux doivent publier la MÊME
// icône, à la même taille. Elles passent donc toutes les deux par ICI — la page
// par le composant `IconePage`, la coquille par `svgDeLIcone`
// (`vite-plugins/prerender/icons-serveur.js`), qui rend le même composant en
// chaîne. Un nom d'icône absent, c'est un échec BRUYANT des deux côtés (jamais
// un glyphe vide publié en silence).
//
// ── Pourquoi le balisage est écrit ici, et pas rendu par lucide ────────────
// Les icônes viennent de lucide (les tracés ci-dessous en sont extraits), mais
// le composant lucide ajoute ses PROPRES classes (`lucide lucide-wrench`) au
// `class` : publiées par la coquille, elles feraient échouer `check-home-shell`,
// qui exige que TOUTE classe d'une coquille existe dans le CSS — et ces classes
// n'y sont pas. Le balisage est donc écrit ici, identique pour les deux canaux,
// sans aucune classe lucide. (Rendre le composant lucide côté serveur tirait
// aussi `react-dom/server` dans le bundle client : mesuré, `vendor-react-dom`
// passait de 130 à 201 ko.)
import { createElement } from 'react';

/**
 * Le registre : un NOM STABLE (celui que `page-sections.js` déclare dans un
 * champ `icone`) vers le CONTENU de son `<svg>` (viewBox 24×24, tracé au trait).
 * Renommer une icône dans un plan sans la déclarer ici fait échouer le build
 * (`IconePage` lève) — l'icône ne peut pas disparaître en silence.
 */
const ICONES = {
  escrow: `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path>`,
  promiseFindWork: `<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path><rect width="20" height="14" x="2" y="6" rx="2"></rect>`,
  promiseConnect: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><path d="M16 3.128a4 4 0 0 1 0 7.744"></path><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><circle cx="9" cy="7" r="4"></circle>`,
  promiseSecurePayments: `<rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>`,
  categoryGeneral: `<rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect>`,
  categoryPlumbing: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>`,
  categoryElectrical: `<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"></path>`,
  categoryConstruction: `<path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"></path><path d="M14 6a6 6 0 0 1 6 6v3"></path><path d="M4 15v-3a6 6 0 0 1 6-6"></path><rect x="2" y="15" width="20" height="4" rx="1"></rect>`,
  categoryCleaning: `<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path><path d="M20 3v4"></path><path d="M22 5h-4"></path><path d="M4 17v2"></path><path d="M5 18H3"></path>`,
  categoryGardening: `<path d="M7 20h10"></path><path d="M10 20c5.5-2.5.8-6.4 3-10"></path><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"></path><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"></path>`,
  categoryTutoring: `<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"></path><path d="M22 10v6"></path><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"></path>`,
  categoryMechanics: `<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"></path><circle cx="7" cy="17" r="2"></circle><path d="M9 17h6"></path><circle cx="17" cy="17" r="2"></circle>`,
  categoryCarpentry: `<path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"></path><path d="m18 15 4-4"></path><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"></path>`,
  categoryComputing: `<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"></path>`,
  step1: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" x2="19" y1="8" y2="14"></line><line x1="22" x2="16" y1="11" y2="11"></line>`,
  step2: `<path d="m11 17 2 2a1 1 0 1 0 3-3"></path><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"></path><path d="m21 3 1 11h-2"></path><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"></path><path d="M3 4h8"></path>`,
  step3: `<path d="M21.801 10A10 10 0 1 1 17 3.335"></path><path d="m9 11 3 3L22 4"></path>`,
  // ── Les moyens de contact (lignes de /contact, de /support ET le bloc de
  // contact de l'accueil) : un seul contenu par moyen, lu par les trois
  // surfaces — elles publiaient un emoji `iconContact*` chacune de leur côté.
  contactCall: `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>`,
  contactWhatsapp: `<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path>`,
  contactSendEmail: `<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"></path><rect x="2" y="4" width="20" height="16" rx="2"></rect>`,
  contactAddress: `<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle>`,
  // ── Les deux modes de /support : le robot (lucide `Bot`) et le contact direct
  // (le téléphone, déjà porté par `contactCall`). Le robot remplace un emoji
  // « 💬 » que la PAGE ne publiait déjà pas — elle dessinait `Bot` : les deux
  // canaux publient maintenant le MÊME dessin.
  supportRobot: `<path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path>`,
  // ── Les étapes de « Comment ça marche » : le mémo et le feu vert. L'étape 2
  // publie le bouclier du séquestre (`escrow`), déjà déclaré pour l'accueil et
  // pour le bloc de séquestre de la MÊME page.
  howStep1: `<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"></path><path d="M2 6h4"></path><path d="M2 10h4"></path><path d="M2 14h4"></path><path d="M2 18h4"></path><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"></path>`,
  howStep3: `<path d="M20 6 9 17l-5-5"></path>`,
  // ── Les écrans de compte (26/09/2026, DERNIÈRE vague emoji→SVG) : /login,
  // /register, /forgot-password et /payment publiaient encore les emoji de
  // leurs clés `*IconKey` (📜 ⚠️ 👤 🔧 📸 💡 🌍 ▼ ✉️ 💼). Trois dessins sont
  // RÉUTILISÉS au lieu d'être recopiés, comme `escrow` l'a été pour l'étape 2 de
  // « Comment ça marche » : le marteau du travailleur est le wrench de
  // `categoryPlumbing`, l'enveloppe de la réinitialisation est l'e-mail du contact
  // (`contactSendEmail`), la mallette de /payment est celle des promesses de
  // l'accueil (`promiseFindWork`) — un même contenu, un seul propriétaire.
  legalNotice: `<path d="M15 12h-5"></path><path d="M15 8h-5"></path><path d="M19 17V5a2 2 0 0 0-2-2H4"></path><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"></path>`,
  stepNotice: `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>`,
  client: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>`,
  profilePhoto: `<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle>`,
  photoTips: `<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path>`,
  countryGlobe: `<circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path>`,
  countryChevron: `<path d="m6 9 6 6 6-6"></path>`,
};

/**
 * Les CLASSES des emplacements d'icône du corps de l'accueil, par rôle. Elles
 * remplacent le `text-3xl` / `text-2xl` / `text-5xl` qui dimensionnait l'emoji :
 * un SVG ne suit pas la taille de police, il lui faut une taille explicite, et
 * c'est ICI qu'elle a un propriétaire (les deux canaux la lisent, Tailwind la
 * voit). Le `currentColor` du trait suit la couleur de texte de l'emplacement.
 */
export const CLASSES_ICONE = {
  // Dans les pastilles rondes `h-14 w-14` des catégories (fond orange-50).
  categorie: 'h-8 w-8 text-orange-600',
  // Dans les ronds `h-16 w-16` / `h-14 w-14` des promesses et des étapes.
  promesse: 'h-7 w-7 text-orange-600',
  etape: 'h-7 w-7 text-orange-600',
  // Le grand bouclier du bloc séquestre (fond emerald-50).
  sequestre: 'h-12 w-12 text-emerald-600',
  // Les trois petits repères du héros, sur fond coloré (trait blanc hérité).
  heros: 'h-5 w-5',
  // ── Les emplacements des quatre pages qui publiaient encore des emoji
  // (26/09/2026). Comme pour l'accueil, la classe REMPLACE la taille de police
  // qui dimensionnait le caractère (`text-2xl`, `text-5xl`) : un SVG ne suit pas
  // `font-size`, il lui faut une taille explicite, et elle est écrite ici UNE
  // fois pour les deux canaux.
  // Les cartes de /about (l'ancien `text-2xl mb-3` d'un emoji).
  carte: 'h-6 w-6 text-orange-600',
  // La pastille du contrôle de carte de /contact (l'ancien `text-2xl`) : elle
  // est grise, comme le contrôle qu'elle accompagne.
  carteContact: 'h-6 w-6 text-gray-500',
  // La pastille d'un mode de /support (`h-12 w-12`) — la couleur vient du
  // `badgeClass` de la ligne, donc le trait suit `currentColor`.
  mode: 'h-6 w-6',
  // La pastille d'une ligne de contact (`h-10 w-10`, /contact comme /support) :
  // même héritage de couleur par `currentColor`.
  ligne: 'h-5 w-5',
  // ── Les emplacements des quatre écrans de compte (26/09/2026). Le SVG remplace
  // le CARACTÈRE, il ne suit donc pas `font-size` : la taille est écrite ici, une
  // fois pour les deux canaux.
  // Le glyphe en TÊTE DE PHRASE (bloc légal, notice d'étape, conseils photo), dans
  // un `text-sm` : il s'aligne sur la ligne de texte au lieu de la décaler.
  notice: 'inline h-4 w-4 align-[-0.15em]',
  // Les deux cartes de type de compte de /register (l'ancien `text-2xl` d'un
  // emoji, centré par le `text-center` du parent).
  carteUserType: 'h-8 w-8 text-orange-600',
  // La pastille d'étape de /forgot-password, dans le rond bleu `h-14 w-14` :
  // l'ancien `text-white text-2xl` devient un trait blanc.
  badge: 'h-6 w-6 text-white',
  // Les deux emplacements photo de /register : l'en-tête `text-2xl` et la zone de
  // dépôt `text-4xl` (l'ancien emoji, dans un `text-center`).
  photoTitre: 'inline h-6 w-6 align-[-0.2em] text-gray-500',
  photoZone: 'h-10 w-10 text-gray-400',
  // Le globe et le chevron du sélecteur de pays, dans un `text-lg`/`text-xs`.
  paysGlobe: 'h-5 w-5 text-gray-500',
  paysChevron: 'h-3 w-3',
  // La carte « mission requise » de /payment (l'ancien `text-4xl text-center`).
  carteVide: 'h-12 w-12 text-gray-400',
};

/**
 * Les attributs COMMUNS du `<svg>` — les mêmes pour les deux canaux, donc une
 * seule liste à tenir. L'ordre est celui que React émet, pour que la chaîne de
 * la coquille et le rendu de la page soient au même octet près.
 */
export const ATTRIBUTS_SVG = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};

/** Le repère que le build exige dans une coquille pour CHAQUE icône déclarée. */
export const marqueurDIcone = (nom) => `data-icone="${nom}"`;

/** Le CONTENU (tracés) d'une icône, ou une erreur bruyante si le nom est inconnu. */
export function contenuDeLICone(nom) {
  const contenu = ICONES[nom];
  if (!contenu) {
    throw new Error(
      `page-icons : l’icône « ${nom} » n’est pas déclarée dans le registre — ` +
        'un plan ne peut pas dessiner une icône qui n’existe pas.'
    );
  }
  return contenu;
}

/**
 * Le composant de la PAGE. `nom` doit exister dans le registre ; `classe` vient
 * de `CLASSES_ICONE`. `data-icone` rend l'icône vérifiable par le build (garde
 * `declared-body`) et par toute sonde qui voudrait la compter.
 */
export function IconePage({ nom, classe }) {
  return createElement('svg', {
    ...ATTRIBUTS_SVG,
    className: classe,
    'aria-hidden': true,
    'data-icone': nom,
    dangerouslySetInnerHTML: { __html: contenuDeLICone(nom) },
  });
}

/** Les noms connus — lu par la sonde de provenance des icônes de la coquille. */
export const NOMS_D_ICONES = Object.keys(ICONES);
