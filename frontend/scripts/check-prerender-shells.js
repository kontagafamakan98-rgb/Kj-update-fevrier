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
 *     disponibles » + placeholder navbar (LCP avant boot React) + og:image
 *     spécifique (og-jobs.png).
 *   • build/login.html  → #root contient le shell formulaire (h2, champs,
 *     bouton) + og:image og-login.png.
 *
 * Et surtout : chaque page PRÉ-RENDUE du build doit être ATTEIGNABLE via
 * frontend/vercel.json (rewrites « /route » et « /route/ » → « /route.html »,
 * et aucune règle masquée). Le plugin peut émettre login.html sans que
 * Vercel ne le serve jamais : la route renverrait alors index.html, sans
 * shell, et l'optimisation serait PERDUE EN SILENCE.
 *
 * Échoue (exit 1) en cas de régression silencieuse : plugin
 * prerender-route-meta désactivé/supprimé, shell perdu, contenu statique
 * ajouté à l'index, ou route pré-rendue non routée par Vercel. Exécuté dans
 * le job CI frontend-build après le build.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const buildDir = path.join(process.cwd(), 'build');
const errors = [];

const read = (name) => {
  try {
    return readFileSync(path.join(buildDir, name), 'utf8');
  } catch {
    errors.push(`build/${name} introuvable (le build a-t-il tourné ?)`);
    return '';
  }
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

// 2. jobs.html : shell h1 statique + og:image dédié.
const jobs = read('jobs.html');
if (jobs) {
  if (!jobs.includes('<h1 class="text-3xl font-bold text-gray-900">Emplois disponibles</h1>')) {
    errors.push('jobs.html : shell h1 « Emplois disponibles » ABSENT de #root');
  }
  if (!jobs.includes('class="h-16 bg-white border-b border-gray-200"')) {
    errors.push('jobs.html : placeholder navbar (h-16) absent du shell');
  }
  if (!jobs.includes('https://kj-update-fevrier.vercel.app/og-jobs.png')) {
    errors.push('jobs.html : og:image og-jobs.png manquant');
  }
}

// 3. login.html : shell formulaire + og:image dédié.
const login = read('login.html');
if (login) {
  // Titre de PAGE en h1 (et non h2) : une page doit avoir UN h1, identique
  // pour un crawler sans JavaScript et pour celui qui exécute le bundle.
  if (!login.includes('<h1 class="mt-6 text-center text-3xl font-extrabold text-gray-900">Connexion</h1>')) {
    errors.push('login.html : h1 « Connexion » absent du shell');
  }
  if (!login.includes('id="email"')) {
    errors.push('login.html : champ e-mail absent du shell');
  }
  if (!login.includes('bg-orange-600">Connexion</div>')) {
    errors.push('login.html : bouton Connexion (bg-orange-600) absent du shell');
  }
  if (!login.includes('https://kj-update-fevrier.vercel.app/og-login.png')) {
    errors.push('login.html : og:image og-login.png manquant');
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
  if (!register.includes('<h1 class="mt-6 text-center text-3xl font-bold text-gray-900">Créer un compte</h1>')) {
    errors.push('register.html : h1 « Créer un compte » absent du shell');
  }
  if (!register.includes("S'inscrire avec Google")) {
    errors.push('register.html : bouton Google absent du shell');
  }
  if (!register.includes('bg-orange-600">Continuer vers la vérification email')) {
    errors.push('register.html : bouton submit (bg-orange-600) absent du shell');
  }
  // Champs du formulaire (les LCP/paint du formulaire complet avant React) :
  // prénom/nom, email, téléphone doivent être peints dans le shell statique,
  // pas seulement les boutons — sinon le LCP du formulaire register reste
  // attendu du boot React.
  for (const field of ['Prénom...', 'Nom...', 'exemple@email.com', '--- XX XXX XX XX']) {
    if (!register.includes(`placeholder="${field}"`)) {
      errors.push(`register.html : champ de formulaire « ${field} » ABSENT du shell`);
    }
  }
  // Mentions légales peintes côté HTML (bloc « Informations légales » +
  // case de consentement Politique de confidentialité) : elles font partie
  // du formulaire complet et ne doivent pas dépendre du boot React.
  if (!register.includes('Informations légales') || !register.includes('Politique de confidentialité')) {
    errors.push('register.html : mentions légales (Informations légales / Politique de confidentialité) absentes du shell');
  }
  if (!/<link rel="modulepreload"[^>]*href="[^"]*Register-[^"]*\.js"/.test(register)) {
    errors.push('register.html : modulepreload du chunk Register absent');
  }
  if (!register.includes('https://kj-update-fevrier.vercel.app/og-image-1200x630.png')) {
    errors.push('register.html : og:image générique manquant');
  }
}

// 4bis. forgot-password.html : shell formulaire étape email (par défaut).
const forgot = read('forgot-password.html');
if (forgot) {
  if (!forgot.includes('<h1 class="mt-6 text-3xl font-extrabold text-gray-900">Mot de passe oublié</h1>')) {
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
  if (!forgot.includes('https://kj-update-fevrier.vercel.app/og-image-1200x630.png')) {
    errors.push('forgot-password.html : og:image générique manquant');
  }
}

// 4ter. payment.html : shell carte titre (h1 LCP) + carte « mission requise »
// (état par défaut, sans contexte de mission).
const payment = read('payment.html');
if (payment) {
  if (!payment.includes('<h1 class="text-3xl font-bold text-gray-900 mb-2">KOJO Paiements réels</h1>')) {
    errors.push('payment.html : h1 « KOJO Paiements réels » absent du shell');
  }
  if (!payment.includes('Un paiement doit être rattaché à une mission')) {
    errors.push('payment.html : carte « mission requise » (💼) absente du shell');
  }
  if (!payment.includes('Voir les missions disponibles')) {
    errors.push('payment.html : CTA « Voir les missions disponibles » absent du shell');
  }
  if (!/<link rel="modulepreload"[^>]*href="[^"]*Payment-[^"]*\.js"/.test(payment)) {
    errors.push('payment.html : modulepreload du chunk Payment absent');
  }
  if (!payment.includes('https://kj-update-fevrier.vercel.app/og-image-1200x630.png')) {
    errors.push('payment.html : og:image générique manquant');
  }
}

// 4quater. how-it-works.html : page PUBLIQUE de contenu (h1, étapes,
// séquestre, FAQ). Avant son shell, elle était servie par le gabarit nu :
// titre « Kojo », aucun h1, aucun canonical, un mot de contenu — invisible
// pour un crawler sans JavaScript.
const howItWorks = read('how-it-works.html');
if (howItWorks) {
  if (!howItWorks.includes('<h1 class="text-3xl md:text-4xl font-bold mb-4">Comment ça marche ?</h1>')) {
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
  if (!howItWorks.includes('https://kj-update-fevrier.vercel.app/how-it-works')) {
    errors.push('how-it-works.html : canonical de la route absent');
  }
}

// 4quinquies. support.html : page PUBLIQUE (contact + suivi de ticket).
const support = read('support.html');
if (support) {
  if (!support.includes('<h1 class="text-3xl font-bold text-gray-900 mb-2">Support</h1>')) {
    errors.push('support.html : h1 « Support » absent du shell');
  }
  if (!support.includes('Suivre une demande existante')) {
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
  if (!support.includes('https://kj-update-fevrier.vercel.app/support')) {
    errors.push('support.html : canonical de la route absent');
  }
}

// 5. Fiches /jobs/:id : le pré-rendu HTML (méta OG de la mission + 404
// noindex) est servi par le BACKEND — GET /api/og/jobs/{id} dans
// kojo_routers_public.py, aiguillé par le rewrite Vercel
// /jobs/(.*) → https://kojo-backend.fly.dev/api/og/jobs/$1 (vercel.json).
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
