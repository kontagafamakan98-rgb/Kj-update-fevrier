#!/usr/bin/env node
/**
 * Vérifie que le pré-rendu par route est INTACT après `vite build` :
 *
 *   • build/index.html  → #root contient le shell statique de l'ACCUEIL
 *     (h1 + contenu + liens : c'est ce que voit un crawler sans JavaScript,
 *     et le LCP de la page). index.html n'est plus servi que pour « / » —
 *     le catch-all SPA ayant été retiré (une URL inconnue doit répondre 404),
 *     le shell de l'accueil ne peut plus être peint à tort sur /dashboard.
 *     React remplace ce contenu au montage (createRoot efface #root), comme
 *     pour les pages ci-dessous.
 *   • build/jobs.html   → #root contient le shell h1 statique « Emplois
 *     disponibles » (LCP avant boot React), enveloppé du chrome de l'app, +
 *     og:image spécifique (og-jobs.png).
 *
 * Le CHROME de l'app (navbar + `.App` + `main.flex-1`, app-chrome.js) doit
 * envelopper le corps de #root sur TOUTES les pages pré-rendues : ces
 * conteneurs portent la STRUCTURE (les 65 px de la navbar, `main.flex-1`), donc
 * une coquille qui les omet publie une autre géométrie que la page qu'elle
 * pré-rend — c'est par là que l'alignement hérité de `.App` déplaçait l'encre,
 * avant que la refonte du 25/09/2026 ne le retire. Mesuré sur /jobs (Chrome 152,
 * 1350×940) : la 2e ligne du paragraphe d'intro passait de x=67.000 à
 * x=218.578 et l'aire LCP du MÊME texte de 36 002 à 36 049 px² (+0,13 %) —
 * Chrome n'élit un candidat LCP que pour une aire STRICTEMENT plus grande,
 * donc ce +0,13 % suffisait à ré-élire la peinture de React à 2,5 s (3 runs
 * sur 3 en desktop, score 92 au lieu de 100).
 *   • build/login.html  → #root contient le shell formulaire (h2, champs,
 *     bouton) + og:image og-login.png.
 *
 * La carte og:image attendue de chaque coquille n'est PAS recopiée ici : elle
 * est lue dans la table unique (scripts/check-og-images.js), partagée avec
 * vite.config.js qui écrit les coquilles — les deux ne peuvent plus diverger.
 *
 * Et surtout : chaque page PRÉ-RENDUE du build doit être ATTEIGNABLE via
 * frontend/vercel.json (rewrites « /route » et « /route/ » → « /route.html »,
 * et aucune règle masquée). Le plugin peut émettre login.html sans que
 * Vercel ne le serve jamais : la route renverrait alors index.html, sans
 * shell, et l'optimisation serait PERDUE EN SILENCE.
 *
 * Enfin, il vérifie la PROVENANCE des glyphes publiés : aucun module de
 * vite-plugins/prerender/ ne doit RECOPIER un glyphe du dictionnaire (📜, 🛡️,
 * 📸…). Ces glyphes se déclarent par une clé i18n nommée par le plan de leur
 * route (`iconLegalNotice`, `escrowIconKey`…) que la page lit par t() et la
 * coquille par T() : un littéral dans le plugin rendrait cette déclaration
 * décorative et laisserait les deux canaux diverger en silence. Les valeurs
 * interdites sont LUES dans le dictionnaire, jamais listées ici.
 *
 * Et il vérifie l'APOSTROPHE de la copie publiée : un seul caractère, celui que
 * scripts/published-copy.js nomme, sur les deux vues — les SOURCES
 * (dictionnaires, scopes, littéraux publiés de src/, index.html), la vue PAGE
 * (chunks applicatifs du build) et la vue CRAWLER (coquilles HTML). Une page et
 * sa coquille ne doivent pas publier deux octets différents pour le même mot.
 *
 * Échoue (exit 1) en cas de régression silencieuse : plugin
 * prerender-route-meta désactivé/supprimé, shell perdu, contenu statique
 * ajouté à l'index, route pré-rendue non routée par Vercel, glyphe publié
 * recopié au lieu d'être lu depuis sa clé, ou copie publiée qui porte
 * l'apostrophe droite de sa copie (celle qui joint deux lettres). Exécuté dans
 * le job CI frontend-build après le build.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// L'apostrophe publiée — le caractère qui survit, ses surfaces et leur
// contrôle appartiennent à scripts/published-copy.js : ce garde l'exécute, il
// ne redéclare ni le caractère ni la liste des fichiers.
import { valeursMarqueur } from './shell-text-provenance.js';
import {
  APOSTROPHE_PUBLIEE,
  apostrophesHorsConvention,
  chunksPublies,
  coquillesPubliees,
  fichiersDeCopie,
} from './published-copy.js';
import { SITE_ORIGIN, shellFileFor, titleOf, metaContents } from './site-meta.js';
// Le chrome des coquilles (navbar + conteneurs de l'app) est lu à sa source
// unique : la fabrique qui l'injecte et le contrôle qui l'exige ne peuvent
// pas diverger.
import { CHROME_OUVERTURE, NAV_PLACEHOLDER } from '../vite-plugins/prerender/app-chrome.js';
import { PHONE_PREFIX_FALLBACK, phoneNumberExample } from '../src/config/phone-format.js';
import { COUNTRY_PLACEHOLDER } from '../src/config/country-placeholder.js';
import { photoFormatsLine } from '../src/config/photo-formats.js';
import { CONTACT } from '../src/config/contact.js';
// Table UNIQUE de la correspondance route → carte OG, partagée avec
// vite.config.js qui écrit ces coquilles : la carte de chaque shell est LUE
// ici et non recopiée (voir la section « og:image » plus bas).
import { ROUTES as OG_CARD_ROUTES } from './check-og-images.js';
// Les TEXTES attendus ne sont pas recopiés ici : ils viennent des mêmes
// dictionnaires que les coquilles — src/i18n/fr.json pour le dictionnaire
// global, src/utils/pack2PageI18n/*.js pour les pages qui ont leur propre
// scope (Register, Jobs). Un libellé recopié dans ce fichier ne comparait rien :
// corriger la coquille laissait le garde affirmer l'ancien mot.
import { makeScopedTranslator as makeRegisterTranslator } from '../src/utils/pack2PageI18n/register.js';
import { makeScopedTranslator as makeJobsTranslator } from '../src/utils/pack2PageI18n/jobs.js';

// ── L'ALIGNEMENT NE SE CENTRE PLUS PAR HÉRITAGE : c'est la refonte ──────────
// `.App { text-align: center }` a été RETIRÉE de src/App.css le 25/09/2026 : le
// site est aligné à gauche par défaut, et chaque bloc qui doit être centré le
// DÉCLARE (`text-center`). La règle centrait en silence 2 à 28 porteurs de texte
// par route (231 déplacements d'encre relevés sur 11 routes × 2 tailles,
// jusqu'à 543,89 px, élément LCP compris) — c'est cette mesure qui a servi de
// matière à la refonte.
//
// Ce garde vérifie donc l'INVERSE d'avant : plus AUCUNE page pré-rendue ne doit
// republier une centure par héritage. C'est vérifié ICI, statiquement, et pas
// seulement dans le navigateur, parce que les DEUX canaux lisent la même
// feuille : une règle réintroduite centrerait la coquille ET React ensemble,
// donc `e2e/lcp-geometrie.spec.js` resterait vert (il compare les deux peintures
// entre elles) pendant que la moitié du site se recentrerait en silence.
const CSS_CENTRE_PAR_HERITAGE = /\.App\s*\{[^}]*text-align\s*:\s*center/;

const fr = JSON.parse(readFileSync(new URL('../src/i18n/fr.json', import.meta.url), 'utf8'));
const registerT = makeRegisterTranslator('fr', (cle) => fr[cle]);
const jobsT = makeJobsTranslator('fr', (cle) => fr[cle]);

const buildDir = path.join(process.cwd(), 'build');
const errors = [];

// Coquilles lues, indexées par nom de fichier : la section og:image dérive le
// nom attendu du chemin de la route via la correspondance UNIQUE
// (scripts/site-meta.js — `shellFileFor`), partagée avec le build.
const shells = {};

const read = (name) => {
  try {
    shells[name] = readFileSync(path.join(buildDir, name), 'utf8');
  } catch {
    errors.push(`build/${name} introuvable (le build a-t-il tourné ?)`);
    shells[name] = '';
  }
  return shells[name];
};

// 1. index.html : #root doit porter le shell statique de l'accueil.
// (Détail des invariants du shell — h1 unique, longueurs de méta, N.A.P.,
// classes stylées — dans check-home-shell.js, qui échoue séparément.)
const index = read('index.html');
const rootMatch = index.match(/<div id="root">([\s\S]*?)<\/div>/);
if (!rootMatch) {
  errors.push('index.html : <div id="root"> absent du HTML');
} else if (rootMatch[1].trim() === '') {
  errors.push(
    'index.html : <div id="root"> est VIDE — le shell statique de l\'accueil a disparu ' +
      '(plugin prerender-route-meta désactivé ?) : sans lui, la page n\'a ni h1, ni contenu, ni lien'
  );  }

// 1bis. index.html : le chunk lazy de la page d'accueil (Home) doit être
// préchargé en modulepreload — sinon le landing / (audité par les budgets
// Lighthouse) subit un waterfall réseau (index → vendor → import() de Home)
// qui retarde le LCP. Le plugin preload-home-chunk (vite.config.js) injecte
// ce lien à TOUS les builds ; cette vérification bloque une régression
// silencieuse (plugin retiré / lazy Home supprimé / lien perdu).
const homePreload =
  /<link rel="modulepreload"[^>]*href="\/assets\/Home-[^"]*\.js"/.test(index);
if (!homePreload) {
  errors.push('index.html : modulepreload du chunk Home (landing LCP) ABSENT — le plugin preload-home-chunk a-t-il tourné ?');
}

// 1ter. index.html : la SECTION CONTACT et le PIED DE PAGE publient leurs
// textes déclarés. Cette zone n'était vérifiée par AUCUN garde : ses libellés
// étaient recopiés en dur dans le plugin ET dans le pied de page React
// (src/App.js), donc corriger l'un laissait les autres derrière en silence, et
// supprimer une ligne de contact ne faisait échouer personne. Les valeurs
// attendues sont LUES dans le dictionnaire global — ce qui est déclaré ici est
// la liste des textes que la coquille doit porter, jamais leur contenu.
if (index) {
  const sectionContact = [
    fr.contactTitle,
    fr.homeContactText,
    fr.homeContactCall,
    fr.contactWhatsapp,
    fr.contactSendEmail,
    fr.contactAddress,
    fr.footerItinerary,
    fr.footerTerms,
  ];
  const mapTitle = fr.mapIframeTitle.replace('{address}', CONTACT.address);
  if (!index.includes(`title="${mapTitle}"`)) {
    errors.push(`index.html : titre d'iframe « ${mapTitle} » absent (clé i18n mapIframeTitle)`);
  }
  for (const texte of new Set(sectionContact)) {
    if (!index.includes(texte)) {
      errors.push(
        `index.html : « ${texte} » absent de la coquille (section contact / pied de page) — ` +
          'ce texte appartient au dictionnaire global, que publie aussi le pied de page React'
      );
    }
  }
  // Le bloc social n'est émis que si des profils sont configurés
  // (VITE_SOCIAL_*) : son titre est donc exigé SEULEMENT quand le bloc est là
  // — un bloc livré sans son titre serait un shell amputé, pas une option.
  if (index.includes('rel="me noreferrer"') && !index.includes(fr.homeContactFollow)) {
    errors.push(
      `index.html : le bloc social est publié sans son titre « ${fr.homeContactFollow} » ` +
        '(texte déclaré dans le dictionnaire global)'
    );
  }
}

// 1quater. 404.html : les textes de la page servie aux URL inconnues.
// Elle n'appartenait à personne : ses textes n'existaient dans aucun
// dictionnaire et aucun garde ne les regardait (check-spa-routes.js vérifie sa
// présence, son noindex et l'absence de script — pas ce qu'elle dit).
const notFound = read('404.html');
if (notFound) {
  const textes404 = [
    fr.notFoundMetaTitle,
    fr.notFoundTitle,
    fr.notFoundText,
    fr.home,
    fr.notFoundJobsLink,
    fr.howItWorksTitle,
    fr.contactTitle,
  ];
  for (const texte of textes404) {
    if (!notFound.includes(texte)) {
      errors.push(`404.html : « ${texte} » absent de la page d'une URL inconnue`);
    }
  }
}

// 1quinquies. app.html : métadonnées neutres du gabarit privé. Leur contenu
// vient du dictionnaire global, et les six sorties doivent rester alignées.
const app = read('app.html');
if (app) {
  const metadonnees = [
    ['titre', titleOf(app), fr.neutralTitle],
    ['description', metaContents(app, 'description')[0], fr.neutralDescription],
    ['og:title', metaContents(app, 'og:title')[0], fr.neutralTitle],
    ['og:description', metaContents(app, 'og:description')[0], fr.neutralDescription],
    ['twitter:title', metaContents(app, 'twitter:title')[0], fr.neutralTitle],
    ['twitter:description', metaContents(app, 'twitter:description')[0], fr.neutralDescription],
  ];
  for (const [nom, publie, attendu] of metadonnees) {
    if (publie !== attendu) errors.push(`app.html : ${nom} neutre absent ou différent du dictionnaire`);
  }
}

// 2. jobs.html : shell h1 statique + og:image dédié.
const jobs = read('jobs.html');
if (jobs) {
  if (!jobs.includes(`<h1 class="text-3xl font-bold text-gray-900">${jobsT('availableJobs')}</h1>`)) {
    errors.push('jobs.html : shell h1 « Emplois disponibles » ABSENT de #root');
  }
  if (!jobs.includes(NAV_PLACEHOLDER)) {
    errors.push('jobs.html : navbar du chrome de l\'app absente du shell');
  }
}

// 3. login.html : shell formulaire + og:image dédié.
const login = read('login.html');
if (login) {
  // Titre de PAGE en h1 (et non h2) : une page doit avoir UN h1, identique
  // pour un crawler sans JavaScript et pour celui qui exécute le bundle.
  if (!login.includes(`<h1 class="mt-6 text-center text-3xl font-extrabold text-gray-900">${fr.login}</h1>`)) {
    errors.push('login.html : h1 « Connexion » absent du shell');
  }
  if (!login.includes('id="email"')) {
    errors.push('login.html : champ e-mail absent du shell');
  }
  // Le bouton est un `<button>` : `[type="submit"]` (src/styles/
  // kojo-pack-f-readability-no-color.css) porte `min-height: 48px` quand un
  // `<div>` s'arrêtait à 36-40 px — la sonde de géométrie refusait l'écart.
  if (!login.includes(`bg-orange-600">${fr.login}</button>`)) {
    errors.push('login.html : bouton Connexion (bg-orange-600) absent du shell');
  }
  // Le chunk lazy de Login doit être préchargé (modulepreload) dans le HTML
  // pré-rendu : sans lui, le navigateur waterfall le chunk (entrée → vendor →
  // import() de Login) et la re-peinture identique du shell arrive plus tard.
  // Préchargé en parallèle de l'entrée → boot React (LCP du login) plus rapide.
  if (!/<link rel="modulepreload"[^>]*href="[^"]*Login-[^"]*\.js"/.test(login)) {
    errors.push('login.html : modulepreload du chunk Login absent');
  }
}

// 4. register.html : shell formulaire (mode client) + modulepreload du chunk.
const register = read('register.html');
if (register) {
  if (!register.includes(`<h1 class="mt-6 text-center text-3xl font-bold text-gray-900">${registerT('title')}</h1>`)) {
    errors.push('register.html : h1 « Créer un compte » absent du shell');
  }
  // Le bouton Google est CONDITIONNEL : il n'est publié que si le client_id
  // est configuré au build (React le masque sinon, cf. `googleAuth` dans
  // prerender-route-meta.js et CLES_CONDITIONNELLES dans declared-body.js).
  // Le garde suit la même condition — ici, celle du build de la CI.
  const googleAuth = Boolean(String(process.env.VITE_GOOGLE_CLIENT_ID || '').trim());
  if (googleAuth && !register.includes(registerT('googleSignup'))) {
    errors.push('register.html : bouton Google absent du shell (client_id Google configuré)');
  }
  if (register.includes(registerT('googleSignup')) !== googleAuth) {
    errors.push(
      'register.html : le bouton Google est publié alors que le client_id Google n\'est pas configuré ' +
        '— React ne le peint pas, la coquille en peindrait un que le montage retire'
    );
  }
  if (!register.includes(`bg-orange-600">${registerT('continueButton')}</button>`)) {
    errors.push('register.html : bouton submit (bg-orange-600) absent du shell');
  }
  // Champs du formulaire (les LCP/paint du formulaire complet avant React) :
  // prénom/nom, email, téléphone doivent être peints dans le shell statique,
  // pas seulement les boutons — sinon le LCP du formulaire register reste
  // attendu du boot React.
  for (const champ of [`${fr.firstName}...`, `${fr.lastName}...`, registerT('emailPlaceholder')]) {
    if (!register.includes(`placeholder="${champ}"`)) {
      errors.push(`register.html : champ de formulaire « ${champ} » ABSENT du shell`);
    }
  }
  if (!register.includes(`placeholder="${phoneNumberExample()}"`)) {
    errors.push(`register.html : masque téléphone « ${phoneNumberExample()} » absent (src/config/phone-format.js)`);
  }
  // Le préfixe affiché avant toute détection : la coquille publiait `---` (le
  // préfixe du masque) là où la page rend un tiret cadratin, donc le premier
  // paint contredisait l'hydratation sur le même élément.
  if (!register.includes(`>${PHONE_PREFIX_FALLBACK}</span>`)) {
    errors.push(
      `register.html : préfixe téléphone « ${PHONE_PREFIX_FALLBACK} » absent (src/config/phone-format.js) — ` +
        'la page le publie au runtime, la coquille doit publier les mêmes octets'
    );
  }
  // Le contrôle de pays est celui de la PAGE (src/components/CountryDisplay.js :
  // un `<button>` + un input caché), pas un `<select>` : la coquille en
  // publiait un, et ce `<select>` mesurait 1 px de moins que le vrai contrôle
  // — mesuré, les 47 textes du bas du formulaire étaient 1 px trop haut.
  const countryPlaceholder = COUNTRY_PLACEHOLDER(registerT('country'));
  if (!register.includes(`truncate text-gray-400">${countryPlaceholder}</span>`)) {
    errors.push(`register.html : placeholder pays « ${countryPlaceholder} » absent du contrôle de pays`);
  }
  if (register.includes('<select')) {
    errors.push(
      'register.html : la coquille publie encore un <select> pour le pays — ' +
        'le contrôle de la page est un <button> (CountryDisplay.js), et les deux ne mesurent pas la même hauteur'
    );
  }
  // La ligne des formats photo est de la COPIE, partagée avec la page
  // (src/components/ProfilePhotoUpload.js) : elle était recopiée des deux
  // côtés, donc un changement de limite laissait le crawler derrière.
  const formats = photoFormatsLine(registerT('upTo'));
  if (!register.includes(formats)) {
    errors.push(
      `register.html : lignes des formats photo « ${formats} » absente (src/config/photo-formats.js), ` +
        'que publie aussi src/components/ProfilePhotoUpload.js'
    );
  }
  // Mentions légales peintes côté HTML (bloc « Informations légales » +
  // case de consentement Politique de confidentialité) : elles font partie
  // du formulaire complet et ne doivent pas dépendre du boot React.
  if (!register.includes(registerT('legalNoticeTitle')) || !register.includes(fr.privacyTitle)) {
    errors.push('register.html : mentions légales (Informations légales / Politique de confidentialité) absentes du shell');
  }
  // Les trois textes que la coquille écrivait AUTREFOIS en propre, avec une
  // apostrophe droite (') là où la page publiait la typographique (’). Ils
  // dérivent maintenant de leur source unique — le dictionnaire du scope, celui
  // que lit aussi Register.js — donc un octet qui diverge entre la vue page et
  // la vue crawler fait rougir ici, en nommant le texte fautif.
  for (const cle of ['clientStepNotice', 'legalConsentHelp', 'legalConsentLabel']) {
    const texte = registerT(cle);
    if (!register.includes(texte)) {
      errors.push(
        `register.html : « ${texte} » absent du shell (notices et consentement de l'étape register) — ` +
          `ce texte appartient au scope register (clé ${cle}), que lit aussi la page : les deux vues ` +
          'doivent publier les mêmes octets, apostrophe comprise'
      );
    }
  }
  if (!/<link rel="modulepreload"[^>]*href="[^"]*Register-[^"]*\.js"/.test(register)) {
    errors.push('register.html : modulepreload du chunk Register absent');
  }
}

// 4bis. forgot-password.html : shell formulaire étape email (par défaut).
const forgot = read('forgot-password.html');
if (forgot) {
  if (!forgot.includes(`<h1 class="mt-6 text-3xl font-extrabold text-gray-900">${fr.forgotPasswordPageTitle}</h1>`)) {
    errors.push('forgot-password.html : h1 « Mot de passe oublié » absent du shell');
  }
  if (!forgot.includes('id="reset-email"')) {
    errors.push('forgot-password.html : champ e-mail (reset-email) absent du shell');
  }
  if (!forgot.includes('bg-blue-600 px-4 py-2 text-sm font-semibold text-white')) {
    errors.push('forgot-password.html : bouton « Envoyer le code » (bg-blue-600) absent du shell');
  }
  if (!/<link rel="modulepreload"[^>]*href="[^"]*ForgotPassword-[^"]*\.js"/.test(forgot)) {
    errors.push('forgot-password.html : modulepreload du chunk ForgotPassword absent');
  }
}

// 4ter. payment.html : shell carte titre (h1 LCP) + carte « mission requise »
// (état par défaut, sans contexte de mission).
const payment = read('payment.html');
if (payment) {
  if (!payment.includes(`<h1 class="text-3xl font-bold text-gray-900 mb-2">${fr.paymentPageTitle}</h1>`)) {
    errors.push('payment.html : h1 « KOJO Paiements réels » absent du shell');
  }
  if (!payment.includes(fr.paymentPageNoJobTitle)) {
    errors.push('payment.html : carte « mission requise » (💼) absente du shell');
  }
  // Le corps de la carte, lui aussi écrit en propre par la coquille avant que
  // /payment derive ses textes de son plan (apostrophe droite côté coquille,
  // typographique côté page).
  if (!payment.includes(fr.paymentPageNoJobText)) {
    errors.push(
      'payment.html : texte de la carte « mission requise » absent du shell — il appartient au ' +
        'dictionnaire global (paymentPageNoJobText), que lit aussi la page'
    );
  }
  if (!payment.includes(fr.paymentPageNoJobCta)) {
    errors.push('payment.html : CTA « Voir les missions disponibles » absent du shell');
  }
  if (!/<link rel="modulepreload"[^>]*href="[^"]*Payment-[^"]*\.js"/.test(payment)) {
    errors.push('payment.html : modulepreload du chunk Payment absent');
  }
}

// 4quater. how-it-works.html : page PUBLIQUE de contenu (h1, étapes,
// séquestre, FAQ). Avant son shell, elle était servie par le gabarit nu :
// titre « Kojo », aucun h1, aucun canonical, un mot de contenu — invisible
// pour un crawler sans JavaScript.
const howItWorks = read('how-it-works.html');
if (howItWorks) {
  if (!howItWorks.includes(`<h1 class="text-3xl md:text-4xl font-bold mb-4">${fr.howItWorksTitle}</h1>`)) {
    errors.push('how-it-works.html : h1 « Comment ça marche ? » absent du shell');
  }
  if (!howItWorks.includes('<details')) {
    errors.push('how-it-works.html : FAQ (blocs <details>) absente du shell');
  }
  for (const anchor of ['href="/jobs"', 'href="/support"']) {
    if (!howItWorks.includes(anchor)) {
      errors.push(`how-it-works.html : lien interne ${anchor} absent (maillage du site)`);
    }
  }
  if (!/<link rel="modulepreload"[^>]*href="[^"]*HowItWorks-[^"]*\.js"/.test(howItWorks)) {
    errors.push('how-it-works.html : modulepreload du chunk HowItWorks absent');
  }
  if (!howItWorks.includes(`${SITE_ORIGIN}/how-it-works`)) {
    errors.push('how-it-works.html : canonical de la route absent');
  }
}

// 4quinquies. contact.html : le titre de la carte vient du dictionnaire, et la
// carte ne doit PAS se charger au premier écran.
//
// La coquille publiait l'iframe `output=embed` elle-même, en `loading="lazy"` —
// et cela n'a rien empêché : mesuré (Lighthouse 12.6.1, pile de la CI, Chrome
// 152, mobile, 3 runs), l'embed tiers du premier écran repoussait le LCP de
// /contact à 4143 / 4143 / 4397 ms simulés (scores 81 / 85 / 84) alors que
// l'élément LCP de cette page est NOTRE paragraphe d'introduction, et le
// navigateur charge une iframe dès qu'elle approche du viewport — sur desktop
// elle y est déjà. La coquille publie donc le contrôle déclaré par le plan
// (lien vers la fiche Google, qui fonctionne sans JavaScript) : le titre exigé
// ci-dessous est celui de ce contrôle, et l'iframe n'a plus le droit de
// paraître ici.
const contact = read('contact.html');
if (contact) {
  const mapTitle = fr.mapIframeTitle.replace('{address}', CONTACT.address);
  if (!contact.includes(`title="${mapTitle}"`)) {
    errors.push(
      `contact.html : titre « ${mapTitle} » absent (clé i18n mapIframeTitle) — le contrôle de la ` +
        'carte doit porter le libellé du dictionnaire, comme la page'
    );
  }
  if (/output=embed/.test(contact)) {
    errors.push(
      'contact.html : la carte Google (output=embed) est publiée en IFRAME par la coquille — ' +
        'le premier écran charge alors ~300 Ko de tiers qui repoussent le LCP de la page ; ' +
        'publier le contrôle déclaré par le plan dans src/config/page-sections.js ' +
        '(mapButtonKey / mapIconKey / mapFrameClass / mapControlClass)'
    );
  }
}

const support = read('support.html');
if (support) {
  if (!support.includes(`<h1 class="text-3xl font-bold text-gray-900 mb-2">${fr.support}</h1>`)) {
    errors.push('support.html : h1 « Support » absent du shell');
  }
  if (!support.includes(fr.supportTrackTitle)) {
    errors.push('support.html : carte de suivi (« Suivre une demande existante ») absente du shell');
  }
  for (const anchor of ['href="tel:', 'href="mailto:', 'wa.me', 'href="/how-it-works"']) {
    if (!support.includes(anchor)) {
      errors.push(`support.html : lien ${anchor} absent du shell (contact / maillage)`);
    }
  }
  if (!/<link rel="modulepreload"[^>]*href="[^"]*Support-[^"]*\.js"/.test(support)) {
    errors.push('support.html : modulepreload du chunk Support absent');
  }
  if (!support.includes(`${SITE_ORIGIN}/support`)) {
    errors.push('support.html : canonical de la route absent');
  }
}

// 4sexies. og:image de CHAQUE coquille, lu dans la table UNIQUE.
// Cette correspondance était recopiée ici en dur (og-jobs.png, og-login.png,
// og-image-1200x630.png ×3) : c'était une seconde copie de la table de
// scripts/check-og-images.js, qui pouvait diverger en silence — changer une
// carte là-bas laissait ces attentes figées sur l'ancienne. Et deux pages
// (how-it-works, support) n'étaient vérifiées nulle part.
// Le nom de fichier se déduit du chemin (« /jobs » → jobs.html, « / » →
// index.html) ; les routes sans coquille (/dashboard, /profile, servies par
// app.html) sont ignorées faute de fichier.
for (const route of OG_CARD_ROUTES) {
  const name = shellFileFor(route.path);
  const html = shells[name];
  if (!html) continue;
  // ── Le CHROME de l'app autour du corps ────────────────────────────
  // Une coquille sans ces conteneurs n'hérite pas des styles du document
  // comme React : mesuré sur /jobs (Chrome 152, 1350×940), le `.App` de
  // App.css centre le texte, la coquille le publiait aligné à gauche, la 2e
  // ligne de l'intro passait de x=67.000 à x=218.578 et l'aire LCP du MÊME
  // paragraphe de 36 002 à 36 049 px². Chrome n'élit un candidat LCP que
  // pour une aire strictement plus grande : ce +0,13 % suffisait à ré-élire
  // la peinture de React à 2,5 s (3 runs sur 3 en desktop), en facturant
  // toute la chaîne JavaScript au LCP. Le corps doit donc commencer par le
  // chrome, dans #root, sur TOUTES les pages pré-rendues.
  if (!html.includes(`<div id="root">${CHROME_OUVERTURE}`)) {
    errors.push(
      `${name} : #root ne commence pas par le chrome de l’app (app-chrome.js — navbar + .App + ` +
        'main.flex-1) : la coquille hérite alors d’autres styles que la page'
    );
  }
  // ── La centure par héritage, ABSENTE du CSS RÉELLEMENT PUBLIÉ ─────
  // La règle est cherchée dans le CSS publié de la page (identifiants
  // volontairement tolérants aux espaces, le build minifiant) : d'où qu'elle
  // vienne — App.css ou une coquille qui l'écrirait à la main — c'est le même
  // verdict. La refonte est une décision MESURÉE ; la défaire par une ligne de
  // CSS doit demander de rouvrir ce fichier.
  const cssPublie = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  if (CSS_CENTRE_PAR_HERITAGE.test(cssPublie)) {
    errors.push(
      `${name} : le CSS publié recentre par HÉRITAGE (« .App { text-align: center } ») — ` +
        'la refonte du 25/09/2026 a rendu l’alignement EXPLICITE (chaque bloc centré porte ' +
        '`text-center`), et cette règle recentrerait en silence tout ce qui ne la déclare pas. ' +
        'La refaire est possible, mais c’est une refonte : elle se mesure ' +
        '(node scripts/mesure-alignement-app.mjs) avant d’être écrite ici.'
    );
  }
  if (!html.includes(`${SITE_ORIGIN}${route.image}`)) {
    errors.push(
      `${name} : og:image ${route.image} manquant (carte déclarée pour ${route.path} ` +
        'dans la table de scripts/check-og-images.js)'
    );
  }
}

// 5. Fiches /jobs/:id : le pré-rendu HTML (méta OG de la mission + 404
// noindex) est servi par le BACKEND — GET /api/og/jobs/{id} dans
// kojo_routers_public.py, aiguillé par le rewrite Vercel
// /jobs/(.*) → https://api.kojoforafrica.cc.cd/api/og/jobs/$1 (vercel.json).
// L'ancienne fonction serverless api/og-jobs/[id].js a été abandonnée
// (Vercel ne collecte pas api/ en mode outputDirectory statique). La
// couverture de ce pré-rendu vit dans les tests backend
// (tests/test_seo_discovery.py::TestJobOgHtml) + le check check-og-images.

// 6. Chaque page pré-rendue doit être ATTEIGNABLE : le plugin émet
// <route>.html, mais si frontend/vercel.json ne route pas « /route » (et
// « /route/ ») vers ce fichier, Vercel sert index.html — le shell h1 n'est
// jamais peint et l'optimisation LCP est silencieusement annulée. Aucune
// autre vérification ne relie le build (ce qui est émis) au routage (ce qui
// est servi) : c'est exactement le trou par lequel le lot peut régresser.
// 404.html est volontairement EXCLUE : elle n'est pas servie par un rewrite
// (elle l'est par le mécanisme 404 de Vercel, avec un statut 404) — exiger une
// règle « /404 » n'aurait aucun sens. Sa présence et son noindex sont vérifiés
// par check-spa-routes.js.
// app.html est exclue pour la raison inverse : c'est le gabarit NU partagé par
// les routes clientes (/dashboard, /profile, /support…), pas une page. Il est
// émis pour un CAS DE ROUTAGE, pas pour une URL « /app » qui n'existe pas — son
// contrat (destinations attendues, #root vide, ni h1 ni canonical) appartient à
// check-spa-routes.js.
const prerenderedPages = readdirSync(buildDir)
  .filter(
    (name) =>
      name.endsWith('.html') && !['index.html', '404.html', 'app.html'].includes(name)
  )
  .sort();

let vercelRewrites = null;
try {
  const vercelConfig = JSON.parse(readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));
  vercelRewrites = Array.isArray(vercelConfig.rewrites) ? vercelConfig.rewrites : [];
} catch (err) {
  errors.push(`frontend/vercel.json illisible : ${err.message}`);
}

if (vercelRewrites) {
  for (const file of prerenderedPages) {
    const route = file.replace(/\.html$/, '');
    for (const source of [`/${route}`, `/${route}/`]) {
      const rule = vercelRewrites.find((r) => r && r.source === source);
      if (!rule || rule.destination !== `/${file}`) {
        errors.push(
          `vercel.json : rewrite « ${source} » → « /${file} » absent ou erroné — ` +
            `${file} ne serait jamais servi (shell perdu, optimisation LCP annulée)`
        );
      }
    }
  }

  // Aucun catch-all « /(.*) » : c'est lui qui faisait répondre 200 à toute URL
  // inconnue (soft 404) et qui masquait les routes ci-dessus. Une URL inconnue
  // doit tomber sur la page 404 de Vercel (statut 404).
  if (vercelRewrites.some((r) => r && r.source === '/(.*)')) {
    errors.push(
      'vercel.json : la règle catch-all « /(.*) » est revenue — elle capturerait les routes ' +
        'pré-rendues ET ferait répondre 200 aux URL inconnues (soft 404)'
    );
  }
}

// 7. Les GLYPHES publiés par les coquilles ont UN propriétaire, et ce n'est pas
// le plugin : le plan de la route dit QUELLE clé (`escrowIconKey`,
// `step1NumberKey`, `legalNoticeIconKey`…), le dictionnaire global dit la valeur
// (`icon*`, `brandMark`, `faqMarker`), la page l'affiche par t() et la coquille
// par T(). Un module qui RECOPIE le glyphe rend cette déclaration décorative :
// changer la clé laisserait la coquille derrière, en silence — le défaut que ce
// découpage vient de supprimer. Les valeurs interdites sont LUES dans le
// dictionnaire, jamais listées ici.
// Les valeurs de marqueur appartiennent au module de provenance
// (`scripts/shell-text-provenance.js`), qui les dérive du même dictionnaire pour
// la règle des marqueurs : ce garde n'en tient pas une seconde copie. Seuls les
// glyphes NON ASCII sont interdits en littéral ici — un `K` ou un `+` isolé
// n'est pas scannable ligne à ligne sans faux positifs (la règle des marqueurs,
// elle, compare des VALEURS de champ, ce qui les couvre sans ce bruit).
const GLYPHES_INTERDITS = [
  ...valeursMarqueur(fileURLToPath(new URL('..', import.meta.url))).keys(),
].filter((valeur) => /[^\x20-\x7E]/.test(valeur));
const MODULES_PRE_RENDU = [
  'prerender-route-meta.js',
  // Le chrome (navbar + conteneurs de l'app) est un module de coquille comme
  // les autres : sa navbar publiée doit venir du dictionnaire, jamais d'un
  // glyphe recopié.
  'prerender/app-chrome.js',
  'prerender/app-template.js',
  'prerender/declared-body.js',
  'prerender/not-found.js',
  'prerender/route-meta.js',
  'prerender/shells-home.js',
  'prerender/shells-routes.js',
];
// Un COMMENTAIRE ne publie rien (le plugin en porte, avec des accents et des
// emojis d'avertissement) : une ligne dont le premier caractère non blanc ouvre
// un commentaire est ignorée. Les modules sont lus dans le dépôt courant, comme
// `build/` et `vercel.json` — le test du garde les fournit en fixture et peut
// donc y réintroduire un glyphe pour exiger le refus nommé.
for (const rel of MODULES_PRE_RENDU) {
  let source;
  try {
    source = readFileSync(path.join(process.cwd(), 'vite-plugins', rel), 'utf8');
  } catch {
    errors.push(
      `vite-plugins/${rel} introuvable — le module qui publie une coquille a disparu ` +
        '(renommé ?) : ce garde ne peut plus vérifier qu\'aucun glyphe n\'y est recopié'
    );
    continue;
  }
  source.split('\n').forEach((ligne, index) => {
    const debut = ligne.trim();
    if (debut.startsWith('//') || debut.startsWith('*') || debut.startsWith('/*')) return;
    for (const glyphe of GLYPHES_INTERDITS) {
      if (!ligne.includes(glyphe)) continue;
      errors.push(
        `vite-plugins/${rel}:${index + 1} publie « ${glyphe} » en littéral — un glyphe de ` +
          'coquille se déclare par sa clé i18n (le plan la nomme, la page et la coquille ' +
          'la lisent), jamais en dur dans le plugin'
      );
    }
  });
}

// 8. L'APOSTROPHE de la copie publiée : un seul caractère, sur les DEUX vues.
// La page et la coquille d'une même route tiraient leurs mots des mêmes
// dictionnaires mais l'un des deux canaux publiait U+0027 là où l'autre
// publiait U+2019 — l'écart d'octet que la migration a fermé : c'est
// l'apostrophe TYPOGRAPHIQUE qui survit. La règle, la liste des surfaces, le
// caractère survivant et ce qu'est « une apostrophe de copie » (celle qui
// JOINT DEUX LETTRES, jamais le délimiteur `'` d'une chaîne de code)
// appartiennent à scripts/published-copy.js : ce garde ne fait que l'exécuter
// sur l'arbre réel (les SOURCES, la vue PAGE = les chunks applicatifs, la vue
// CRAWLER = les coquilles), et son test l'exécute sur des fixtures. La règle lit
// les LITTÉRAUX, jamais les lignes : l'apostrophe droite est le délimiteur de
// chaîne de JavaScript.
const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let surfacesApostrophe = [];
try {
  surfacesApostrophe = [
    ...fichiersDeCopie(frontendDir),
    ...coquillesPubliees(buildDir),
    ...chunksPublies(buildDir),
  ];
} catch (err) {
  errors.push(
    "surfaces de copie publiée illisibles (build absent ?) — le contrôle de " +
      `l'apostrophe ne comparerait rien : ${err.message}`
  );
}
if (!surfacesApostrophe.length) {
  errors.push(
    "aucune surface de copie publiée trouvée — le contrôle de l'apostrophe ne " +
      'comparerait rien (un vert sans lecture est un faux vert)'
  );
}
for (const violation of apostrophesHorsConvention(surfacesApostrophe)) {
  const ou = violation.ligne ? `${violation.fichier}:${violation.ligne}` : violation.fichier;
  errors.push(
    `${ou} publie « ' » comme apostrophe de copie (elle joint deux lettres) — la copie ` +
      `publiée porte UNE seule apostrophe, la typographique « ${APOSTROPHE_PUBLIEE} » ` +
      `(scripts/published-copy.js), et la page comme la coquille doivent publier les mêmes ` +
      `octets : « …${violation.extrait}… »`
  );
}

if (errors.length) {
  console.error('❌ Pré-rendu par route invalide — ' + errors.length + ' problème(s) :');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log(
  `✅ Pré-rendu par route intact : shell d'accueil dans index.html, shells statiques vérifiés, ` +
    `et les ${prerenderedPages.length} pages pré-rendues (${prerenderedPages.join(', ')}) ` +
    `sont routées par vercel.json (sans catch-all : URL inconnue → 404). Fiches /jobs/:id servies ` +
    `par le backend (GET /api/og/jobs/{id}).`
);
