#!/usr/bin/env node
/**
 * Vérifie que le pré-rendu par route est INTACT après `vite build` :
 *
 *   • build/index.html  → <div id="root"></div> VIDE (le shell SPA doit
 *     rester vide : React monte dans #root — du contenu statique ajouté ici
 *     casserait le montage ou créerait un double rendu).
 *   • build/jobs.html   → #root contient le shell h1 statique « Emplois
 *     disponibles » + placeholder navbar (LCP avant boot React) + og:image
 *     spécifique (og-jobs.png).
 *   • build/login.html  → #root contient le shell formulaire (h2, champs,
 *     bouton) + og:image og-login.png.
 *
 * Échoue (exit 1) en cas de régression silencieuse : plugin
 * prerender-route-meta désactivé/supprimé, shell perdu, ou contenu statique
 * ajouté à l'index. Exécuté dans le job CI frontend-build après le build.
 */
import { readFileSync } from 'node:fs';
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

// 1. index.html : #root doit être VIDE.
const index = read('index.html');
const rootMatch = index.match(/<div id="root">([\s\S]*?)<\/div>/);
if (!rootMatch) {
  errors.push('index.html : <div id="root"> absent du HTML');
} else if (rootMatch[1].trim() !== '') {
  errors.push('index.html : <div id="root"> n\'est PAS vide (contenu statique ajouté ?)');
}

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
  if (!login.includes('<h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">Connexion</h2>')) {
    errors.push('login.html : h2 « Connexion » absent du shell');
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
  if (!register.includes('<h2 class="mt-6 text-center text-3xl font-bold text-gray-900">Créer un compte</h2>')) {
    errors.push('register.html : h2 « Créer un compte » absent du shell');
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
  if (!forgot.includes('<h2 class="mt-6 text-3xl font-extrabold text-gray-900">Mot de passe oublié</h2>')) {
    errors.push('forgot-password.html : h2 « Mot de passe oublié » absent du shell');
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

// 5. Fonction Vercel générée api/og-jobs/[id].js : générée à CHAQUE build par
// le plugin generate-og-jobs-function (fichier gitignoré — s'il n'est pas
// régénéré, la prod servirait une version périmée du pré-rendu ou un 404).
// Vérifie que le fichier existe, qu'il est bien généré, qu'il embarque le
// HTML de CE build (preuve que BASE_HTML n'est pas périmé) et que la logique
// runtime clé (carte carrée, shell h1, 404 noindex) est intacte.
const ogFnPath = path.join(process.cwd(), 'api', 'og-jobs', '[id].js');
let ogFn = '';
try {
  ogFn = readFileSync(ogFnPath, 'utf8');
} catch {
  errors.push('api/og-jobs/[id].js INTROUVABLE (le plugin generate-og-jobs-function a-t-il tourné ?)');
}
if (ogFn) {
  if (!ogFn.includes('AUTO-GÉNÉRÉ par vite.config.js')) {
    errors.push('api/og-jobs/[id].js : en-tête AUTO-GÉNÉRÉ absent (fichier non généré par le plugin)');
  }
  // Chunk d\'entrée de CE build : s'il n'est pas embarqué dans BASE_HTML,
  // la fonction servirait des assets périmés (hash changé entre builds).
  const entryMatch = /<script type="module"[^>]*src="\/(assets\/index-[^"]+\.js)"/.exec(index);
  if (entryMatch && !ogFn.includes(entryMatch[1])) {
    errors.push(`api/og-jobs/[id].js : BASE_HTML périmé — chunk d\'entrée "${entryMatch[1]}" de CE build absent (la fonction date d\'un build antérieur)`);
  }
  // Logique runtime clé du pré-rendu des fiches : carte carrée (remplacement
  // de la carte statique home + endpoint -square.png), shell h1, 404 noindex.
  if (!ogFn.includes('og-square-1200x1200.png')) {
    errors.push('api/og-jobs/[id].js : remplacement de la carte carrée statique absent');
  }
  if (!ogFn.includes('-square.png')) {
    errors.push('api/og-jobs/[id].js : endpoint carré -square.png absent (og:image 1:1 des fiches)');
  }
  if (!ogFn.includes('x-robots-tag')) {
    errors.push('api/og-jobs/[id].js : 404 noindex (x-robots-tag) absent');
  }
  if (!ogFn.includes('text-3xl font-bold text-gray-900')) {
    errors.push('api/og-jobs/[id].js : shell h1 statique des fiches absent');
  }
  // GÉNÉRATION des méta OG par job : la fonction doit produire dynamiquement
  // (setMeta) le titre, l'image et l'URL de chaque fiche — c'est l'essence du
  // pré-rendu OG (les crawlers lisent ces balises, pas le JS). Si ces appels
  // disparaissent (refactor, fichier périmé), les cartes de partage redeviennent
  // génériques et le job CI doit échouer.
  for (const tag of ['og:title', 'og:image', 'og:url']) {
    if (!ogFn.includes(`setMeta(html, '${tag}'`)) {
      errors.push(`api/og-jobs/[id].js : génération des méta ${tag} ABSENTE du code de la fonction`);
    }
  }
}

if (errors.length) {
  console.error('❌ Pré-rendu par route invalide — ' + errors.length + ' problème(s) :');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('✅ Pré-rendu par route intact : index.html #root vide, jobs.html (shell h1), login.html (shell formulaire), register.html (shell formulaire), fonction Vercel api/og-jobs/[id].js générée et à jour.');
