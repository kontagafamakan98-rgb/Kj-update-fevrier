import { defineConfig, loadEnv, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import { buildOgJobsFunctionCode } from './scripts/og-jobs-function.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const publicEnv = {
    ...Object.fromEntries(
      Object.entries(env).filter(([key]) => key.startsWith('REACT_APP_'))
    ),
    NODE_ENV: mode,
    PUBLIC_URL: '',
  }

  // Origin du backend (pour la CSP connect-src en prod) — dynamique selon
  // VITE_API_URL, avec repli sur l'URL Fly par défaut de l'app.
  // En prod, le proxy Vercel (/api/* → Fly) rend l'API même-origine : les
  // requêtes /api/... sont sur 'self'. On garde apiOrigin dans connect-src
  // comme repli pour le mode direct (mobile Capacitor, debug, ou si le
  // proxy est désactivé via VITE_USE_SAME_ORIGIN_API=false).
  const rawApiUrl = (env.VITE_API_URL || env.VITE_API_BASE_URL || env.VITE_BACKEND_URL || '').trim()
  let apiOrigin = 'https://kojo-backend.fly.dev'
  try {
    apiOrigin = new URL(rawApiUrl || 'https://kojo-backend.fly.dev/api').origin
  } catch (_error) {
    // URL invalide : on garde l'origin par défaut
  }

  return {
    plugins: [
      react(),
      {
        name: 'treat-js-files-as-jsx',
        async transform(code, id) {
          if (!id.includes('/src/') || !id.endsWith('.js')) return null
          return transformWithEsbuild(code, id, {
            loader: 'jsx',
            jsx: 'automatic',
          })
        },
      },
      {
        // Critical CSS : inline le CSS de l'entrée dans le HTML (build prod
        // uniquement). Le <link rel="stylesheet"> render-blocking (~12 kB
        // gzip) bloquait le premier rendu (~140 ms de gain Lighthouse).
        // La CSP du projet autorise déjà style-src 'unsafe-inline'. Le CSS
        // de leaflet (chunk lazy, chargé avec la carte) reste un fichier
        // séparé : seule la feuille référencée par l'index est inlinée.
        name: 'inline-critical-css',
        apply: 'build',
        // writeBundle s'exécute APRÈS l'écriture des fichiers : le HTML final
        // (avec les URLs hashées) et les CSS sont tous deux sur disque. On
        // inline la feuille de l'index dans le HTML et on la supprime du
        // disque — supprime la requête render-blocking du premier rendu.
        // Le CSS de leaflet (chunk lazy) n'est pas référencé par l'index et
        // reste un fichier séparé.
        writeBundle(options, bundle) {
          const htmlKey = Object.keys(bundle).find((k) => k.endsWith('.html'))
          if (!htmlKey) return
          const outDir = options.dir
          if (!outDir) return
          const htmlPath = path.join(outDir, htmlKey)
          if (!fs.existsSync(htmlPath)) return
          let html = fs.readFileSync(htmlPath, 'utf8')
          const linkPattern = /<link rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/g
          let match
          while ((match = linkPattern.exec(html)) !== null) {
            const cssPath = path.join(outDir, match[1].replace(/^\//, ''))
            if (!fs.existsSync(cssPath)) continue
            const css = fs.readFileSync(cssPath, 'utf8')
            html = html.replace(match[0], `<style>${css}</style>`)
            fs.rmSync(cssPath, { force: true })
          }
          fs.writeFileSync(htmlPath, html, 'utf8')
        },
      },
      {
        // Génère la fonction Vercel api/og-jobs/[id].js : pré-rendu À LA VOLÉE
        // des fiches /jobs/:id (le pré-rendu statique ne peut pas couvrir une
        // fiche par job). La fonction embarque le HTML final (CSS inliné + CSP
        // + assets hashés), appelle le backend /api/jobs/:id, et sert le HTML
        // avec les méta OG du job + le shell h1 statique. Vercel déploie le
        // fichier (dossier api/) ; le rewrite /jobs/(.*) → /api/og-jobs/$1
        // (vercel.json) achemine les fiches vers elle.
        name: 'generate-og-jobs-function',
        apply: 'build',
        writeBundle(options, bundle) {
          const htmlKey = Object.keys(bundle).find((k) => k.endsWith('index.html'))
          if (!htmlKey) return
          const outDir = options.dir
          if (!outDir) return
          const indexPath = path.join(outDir, htmlKey)
          if (!fs.existsSync(indexPath)) return
          const html = fs.readFileSync(indexPath, 'utf8')
          const funcDir = path.join(outDir, '..', 'api', 'og-jobs')
          fs.mkdirSync(funcDir, { recursive: true })
          const code = buildOgJobsFunctionCode(html)
          const out = path.join(funcDir, '[id].js')
          fs.writeFileSync(out, code, 'utf8')
        },
      },
      {
        // Pré-rendu par route (crawlers sans JS) : pour les routes clés
        // (/jobs, /login), on émet un HTML statique par route (jobs.html,
        // login.html) qui porte les méta Open Graph/Twitter/canonical
        // CORRECTES pour cette route. Les bots de partage (Facebook,
        // LinkedIn, WhatsApp) ne lisent que le HTML servi, sans exécuter le
        // JS : sans ce pré-rendu ils verraient toujours la carte générique
        // de l'accueil. Vercel sert ces fichiers via des rewrites dédiés
        // (frontend/vercel.json) placés avant le catch-all SPA. Au runtime,
        // usePageOpenGraph ré-écrit les mêmes valeurs (cohérent).
        // Ce plugin s'exécute APRÈS inline-critical-css (ordre de
        // registration) : il copie donc le HTML final (CSS inliné + CSP).
        name: 'prerender-route-meta',
        apply: 'build',
        writeBundle(options, bundle) {
          const htmlKey = Object.keys(bundle).find((k) => k.endsWith('index.html'))
          if (!htmlKey) return
          const outDir = options.dir
          if (!outDir) return
          const indexPath = path.join(outDir, htmlKey)
          if (!fs.existsSync(indexPath)) return
          const html = fs.readFileSync(indexPath, 'utf8')

          // Origin du site (doit matcher og:url statique d'index.html).
          const origin = 'https://kj-update-fevrier.vercel.app'

          // Shell statique injecté dans <div id="root"> : réplique EXACTEMENT
          // le premier rendu de la page (placeholder navbar h-16 + header h1)
          // pour que le LCP (le titre) se peigne dès le premier paint HTML,
          // AVANT le boot de React. createRoot() efface ensuite ce contenu au
          // montage — comme le shell reproduit les mêmes classes/position, la
          // bascule est invisible (pas de flash, pas de CLS). Les classes
          // Tailwind sont déjà inlinées par inline-critical-css → le h1 est
          // stylé immédiatement.
          const frDate = new Intl.DateTimeFormat('fr-FR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          }).format(new Date())
          const SHELLS = {
            jobs: `<div class="h-16 bg-white border-b border-gray-200"></div>`
              + `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">`
              + `<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">`
              + `<div>`
              + `<h1 class="text-3xl font-bold text-gray-900">Emplois disponibles</h1>`
              + `<p class="mt-2 text-gray-600">${frDate}</p>`
              + `</div></div></div>`,
            // Login : réplique la PAGE COMPLÈTE (h2 + formulaire : email,
            // mot de passe, bouton Connexion, Google, mention légale, lien
            // inscription) avec les MÊMES classes que le composant réel — le
            // contenu est centré verticalement (items-center), donc une hauteur
            // statique différente décalerait tout le bloc au montage React
            // (CLS). La bascule est invisible : createRoot efface #root et
            // rend la même structure.
            login: `<div class="h-16 bg-white border-b border-gray-200"></div>`
              + `<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">`
              + `<div class="max-w-md w-full space-y-8">`
              + `<div>`
              + `<div class="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-orange-600">`
              + `<span class="text-white text-xl font-bold">K</span>`
              + `</div>`
              + `<h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">Connexion</h2>`
              + `</div>`
              + `<form class="mt-8 space-y-6">`
              + `<div class="space-y-4">`
              + `<div>`
              + `<label for="email" class="block text-sm font-medium text-gray-700">E-mail</label>`
              + `<input id="email" name="email" type="email" autocomplete="email" readonly placeholder="E-mail" class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md sm:text-sm" />`
              + `</div>`
              + `<div>`
              + `<div class="flex items-center justify-between">`
              + `<label for="password" class="block text-sm font-medium text-gray-700">Mot de passe</label>`
              + `<span class="text-sm font-medium text-orange-600">Mot de passe oublié ?</span>`
              + `</div>`
              + `<div class="relative mt-1">`
              + `<input id="password" name="password" type="password" autocomplete="current-password" readonly placeholder="Mot de passe" class="appearance-none relative block w-full px-3 py-2 pr-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md sm:text-sm" />`
              + `</div>`
              + `</div>`
              + `</div>`
              + `<div>`
              + `<div class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-orange-600">Connexion</div>`
              + `</div>`
              + `<div class="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-gray-300 rounded-md bg-white text-gray-700 text-sm font-medium">Continuer avec Google</div>`
              + `<div class="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-2">`
              + `<p class="text-sm font-semibold text-orange-900">📜 Informations légales</p>`
              + `<span class="inline-flex items-center text-sm font-medium text-orange-700 underline">Lire la politique de confidentialité</span>`
              + `<p class="text-xs text-gray-600">Contact KOJO : +18193003507 · Email : Kojoapp98@gmail.com · Adresse : Hamdallaye Aci 2000 Bamako Mali</p>`
              + `</div>`
              + `<div class="text-center">`
              + `<span class="text-sm text-gray-600">Pas de compte ? <span class="font-medium text-orange-600">Inscription</span></span>`
              + `</div>`
              + `</form>`
              + `</div></div>`,
            // Register : réplique la PAGE COMPLÈTE (mode client par défaut —
            // ce que voit un visiteur sans ?ref/type) avec les MÊMES classes
            // et les MÊMES états initiaux (détection géo + langue en cours,
            // photo absente) que le composant réel. Le contenu est centré
            // verticalement (items-center) : une hauteur statique différente
            // décalerait tout le bloc au montage React (CLS) — d'où la
            // réplique intégrale (formulaire de ~1800px). Les inputs sont
            // readonly (inertes jusqu'au boot), libellés en français
            // (cohérents avec t()).
            register: `<div class="h-16 bg-white border-b border-gray-200"></div>`
              + `<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">`
              + `<div class="max-w-md w-full space-y-8">`
              + `<div class="text-center mb-8">`
              + `<div class="mx-auto h-16 w-16 bg-orange-600 rounded-full flex items-center justify-center shadow-lg">`
              + `<span class="text-white text-2xl font-bold">K</span>`
              + `</div>`
              + `<h2 class="mt-6 text-center text-3xl font-bold text-gray-900">Créer un compte</h2>`
              + `<p class="mt-2 text-sm text-gray-600">Rejoignez la communauté Kojo</p>`
              + `<div class="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">`
              + `<div class="flex items-center justify-center py-2">`
              + `<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>`
              + `<span class="text-xs text-blue-700">Détection de votre position...</span>`
              + `</div>`
              + `<div class="flex items-center gap-3 overflow-x-auto pb-1 text-xs sm:text-sm sm:justify-center sm:space-x-4">`
              + `<div class="flex items-center">`
              + `<div class="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-medium">1</div>`
              + `<span class="ml-2 text-orange-600 font-medium whitespace-nowrap">Informations personnelles</span>`
              + `</div>`
              + `<div class="w-12 h-1 bg-gray-200"></div>`
              + `<div class="flex items-center">`
              + `<div class="w-6 h-6 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-xs font-medium">2</div>`
              + `<span class="ml-2 text-gray-500 font-medium whitespace-nowrap">Vérification email</span>`
              + `</div>`
              + `<div class="w-12 h-1 bg-gray-200"></div>`
              + `<div class="flex items-center">`
              + `<div class="w-6 h-6 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-xs font-medium">3</div>`
              + `<span class="ml-2 text-gray-500 font-medium whitespace-nowrap">Paiement</span>`
              + `</div>`
              + `</div>`
              + `<p class="text-xs text-blue-700 mt-3">⚠️ Étape suivante : vérifie d'abord ton email, puis tu ajouteras ton moyen de paiement pour régler tes jobs.</p>`
              + `</div>`
              + `</div>`
              + `<form class="mt-8 space-y-6 bg-white p-4 sm:p-8 rounded-xl shadow-md">`
              + `<div class="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-700 text-sm font-medium">S'inscrire avec Google</div>`
              + `<div class="relative">`
              + `<div class="absolute inset-0 flex items-center"><div class="w-full border-t border-gray-200"></div></div>`
              + `<div class="relative flex justify-center text-sm"><span class="bg-white px-3 text-gray-400">ou</span></div>`
              + `</div>`
              + `<fieldset>`
              + `<legend class="block text-sm font-medium text-gray-700 mb-3">Type d'utilisateur</legend>`
              + `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">`
              + `<div class="relative flex items-center justify-center p-4 border-2 border-orange-500 bg-orange-50 rounded-lg">`
              + `<div class="text-center"><div class="text-2xl mb-2">👤</div><span class="text-sm font-medium text-gray-700">Client</span><p class="text-xs text-gray-500 mt-1">Je cherche des services</p></div>`
              + `</div>`
              + `<div class="relative flex items-center justify-center p-4 border-2 border-gray-300 rounded-lg">`
              + `<div class="text-center"><div class="text-2xl mb-2">🔧</div><span class="text-sm font-medium text-gray-700">Travailleur</span><p class="text-xs text-gray-500 mt-1">Je propose mes services</p></div>`
              + `</div>`
              + `</div>`
              + `</fieldset>`
              + `<div>`
              + `<label class="block text-sm font-medium text-gray-700 mb-2">Pays</label>`
              + `<select readonly class="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-gray-50 text-gray-400">Détection...</select>`
              + `</div>`
              + `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">`
              + `<div><label class="block text-sm font-medium text-gray-700 mb-2">Prénom</label><input readonly placeholder="Prénom..." class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /></div>`
              + `<div><label class="block text-sm font-medium text-gray-700 mb-2">Nom</label><input readonly placeholder="Nom..." class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /></div>`
              + `</div>`
              + `<div><label class="block text-sm font-medium text-gray-700 mb-2">E-mail</label><input readonly type="email" placeholder="exemple@email.com" class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /></div>`
              + `<div>`
              + `<label class="block text-sm font-medium text-gray-700 mb-2">Téléphone</label>`
              + `<div class="flex rounded-lg shadow-sm">`
              + `<span class="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">---</span>`
              + `<input readonly placeholder="--- XX XXX XX XX" class="flex-1 block w-full px-4 py-3 border border-gray-300 rounded-r-lg" />`
              + `</div>`
              + `<p class="mt-1 text-sm text-gray-500">Format téléphone: --- XX XXX XX XX</p>`
              + `</div>`
              + `<div><label class="block text-sm font-medium text-gray-700 mb-2">Mot de passe</label><input readonly type="password" class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /><p class="mt-1 text-xs text-gray-500">Le mot de passe doit contenir au moins 8 caractères</p></div>`
              + `<div><label class="block text-sm font-medium text-gray-700 mb-2">Confirmer le mot de passe</label><input readonly type="password" class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /></div>`
              + `<div class="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6">`
              + `<div class="flex items-center mb-4"><span class="text-2xl mr-3">📸</span><h3 class="text-lg font-semibold text-gray-900">Photo de Profil (Optionnel)</h3></div>`
              + `<p class="text-sm text-gray-600 mb-4">Une photo de profil aide à personnaliser votre expérience sur Kojo</p>`
              + `<div class="relative border-2 border-dashed rounded-lg p-6 border-gray-300">`
              + `<div class="text-center"><div class="text-4xl mb-3">📸</div><div class="text-sm text-gray-600"><p class="font-medium">Ajouter une photo de profil</p><p>Cliquez pour choisir une option</p></div><div class="text-xs text-gray-500 mt-2">JPG, PNG jusqu'à 5MB</div></div>`
              + `</div>`
              + `</div>`
              + `<div class="bg-gray-50 border border-gray-200 rounded-lg p-6">`
              + `<div class="flex items-center justify-center">`
              + `<div class="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-500 mr-3"></div>`
              + `<span class="text-gray-600">Détection de votre langue préférée...</span>`
              + `</div>`
              + `</div>`
              + `<div class="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">`
              + `<div><h3 class="text-sm font-semibold text-orange-900">📜 Informations légales</h3><p class="text-xs text-orange-800 mt-1">Pour créer un compte, vous devez accepter la Politique de confidentialité et les conditions d'utilisation.</p></div>`
              + `<span class="inline-flex items-center text-sm font-medium text-orange-700 underline">Lire la politique de confidentialité</span>`
              + `<label class="flex items-start gap-3 cursor-pointer"><input type="checkbox" readonly class="mt-1 h-4 w-4 rounded border-gray-300 text-orange-600" /><span class="text-sm text-gray-700">J'ai lu et j'accepte la Politique de confidentialité et les conditions d'utilisation de KOJO avant de créer mon compte.</span></label>`
              + `<p class="text-xs text-gray-600">Contact KOJO : +18193003507 · Email : Kojoapp98@gmail.com · Adresse : Hamdallaye Aci 2000 Bamako Mali</p>`
              + `</div>`
              + `<div><div class="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-orange-600">Continuer vers la vérification email</div></div>`
              + `<div class="text-center"><span class="text-sm text-gray-600">Vous avez déjà un compte ? <span class="font-medium text-orange-600">Se connecter</span></span></div>`
              + `</form>`
              + `</div></div>`,
            // ForgotPassword : réplique l'ÉTAPE EMAIL (par défaut) — la page
            // est centrée verticalement (items-center), donc une hauteur
            // statique différente décalerait tout le bloc au montage React
            // (CLS). Mêmes classes que le composant réel (thème BLEU),
            // inputs readonly (inertes jusqu'au boot), libellés français.
            'forgot-password': `<div class="h-16 bg-white border-b border-gray-200"></div>`
              + `<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">`
              + `<div class="max-w-md w-full space-y-8">`
              + `<div class="text-center">`
              + `<div class="mx-auto h-14 w-14 flex items-center justify-center rounded-full bg-blue-600 shadow-lg">`
              + `<span class="text-white text-2xl font-bold">✉️</span>`
              + `</div>`
              + `<h2 class="mt-6 text-3xl font-extrabold text-gray-900">Mot de passe oublié</h2>`
              + `<p class="mt-3 text-sm text-gray-600">Recevez un code par email pour sécuriser votre compte et définir un nouveau mot de passe.</p>`
              + `</div>`
              + `<div class="bg-white rounded-2xl shadow-md p-6 space-y-6">`
              + `<div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500">`
              + `<span class="text-blue-600">1. Email</span>`
              + `<span class="text-gray-500">2. Code</span>`
              + `<span class="text-gray-500">3. Nouveau mot de passe</span>`
              + `</div>`
              + `<form class="space-y-5">`
              + `<div>`
              + `<label for="reset-email" class="block text-sm font-medium text-gray-700">Adresse email</label>`
              + `<input id="reset-email" type="email" autocomplete="email" readonly class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500" placeholder="E-mail" />`
              + `</div>`
              + `<p class="text-xs text-gray-500">Si cette adresse email existe, un code de réinitialisation a été envoyé.</p>`
              + `<div class="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Envoyer le code</div>`
              + `</form>`
              + `<div class="text-center">`
              + `<span class="text-sm font-medium text-orange-600 hover:text-orange-500">Retour à la connexion</span>`
              + `</div>`
              + `</div>`
              + `</div></div>`,
            // Payment : page PROTÉGÉE (ProtectedRoute montre un spinner pendant
            // la résolution d'auth, puis la page). Le shell réplique l'ÉTAT
            // PAR DÉFAUT (aucun contexte de mission dans l'URL) : carte titre
            // (h1 = LCP) + carte « mission requise ». Contenu top-aligned (pas
            // de centrage vertical) → pas de décalage au montage React ; les
            // états dynamiques (skeleton de chargement, répartition, paiements)
            // apparaissent après le boot comme sur la page réelle.
            payment: `<div class="h-16 bg-white border-b border-gray-200"></div>`
              + `<div class="min-h-screen bg-gray-50 py-8">`
              + `<div class="max-w-6xl mx-auto px-4 space-y-6">`
              + `<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">`
              + `<h1 class="text-3xl font-bold text-gray-900 mb-2">KOJO Paiements réels</h1>`
              + `<p class="text-gray-600">Payez en toute sécurité par Orange Money, Wave ou carte bancaire.</p>`
              + `</div>`
              + `<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">`
              + `<div class="text-4xl mb-3">💼</div>`
              + `<h2 class="text-xl font-semibold text-gray-900 mb-2">Un paiement doit être rattaché à une mission</h2>`
              + `<p class="text-gray-600 max-w-lg mx-auto mb-5">Les paiements libres ne sont plus possibles : ouvrez une mission depuis la liste des emplois pour la payer en toute sécurité (fonds bloqués jusqu'à la livraison).</p>`
              + `<div class="inline-flex items-center rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white">Voir les missions disponibles</div>`
              + `</div>`
              + `</div></div>`,
          }

          const ROUTES = {
            jobs: {
              title: 'Emplois disponibles — Kojo',
              description:
                "Trouvez un travailleur qualifié près de chez vous : emplois, missions et talents disponibles dans toute l'Afrique de l'Ouest.",
              image: '/og-jobs.png',
              // Variante CARRÉE (1200x1200) pour les réseaux qui recadrent en
              // vignette 1:1 (WhatsApp/Telegram/LinkedIn/aperçus Twitter).
              imageSquare: '/og-jobs-square.png',
            },
            login: {
              title: 'Connexion — Kojo',
              description:
                'Accédez à votre compte client ou travailleur Kojo et suivez vos missions en un clic.',
              image: '/og-login.png',
              imageSquare: '/og-login-square.png',
            },
            register: {
              title: 'Créer un compte — Kojo',
              description:
                "Inscrivez-vous sur Kojo comme client ou travailleur et rejoignez la communauté de services en Afrique de l'Ouest.",
              // Pas de carte dédiée : la carte générique de l'accueil (cohérent
              // avec les autres pages catch-all).
              image: '/og-image-1200x630.png',
              imageSquare: '/og-square-1200x1200.png',
            },
            'forgot-password': {
              title: 'Mot de passe oublié — Kojo',
              description:
                'Recevez un code par email pour sécuriser votre compte et définir un nouveau mot de passe.',
              image: '/og-image-1200x630.png',
              imageSquare: '/og-square-1200x1200.png',
            },
            payment: {
              title: 'Paiements sécurisés — Kojo',
              description:
                'Payez en toute sécurité par Orange Money, Wave ou carte bancaire sur Kojo.',
              image: '/og-image-1200x630.png',
              imageSquare: '/og-square-1200x1200.png',
            },
          }

          // Remplace content="..." d'une meta mono ou multi-lignes.
          const setMeta = (htmlIn, key, value) => {
            const re = new RegExp(`(<meta\\s+(?:property|name)="${key}"[^>]*?content=")[^"]*(")`)
            return htmlIn.replace(re, `$1${value}$2`)
          }

          // ── Preload du chunk lazy de chaque route ─────────────────────────
          // Le chunk de la page (Login/Jobs) ne se télécharge que quand
          // l'entrée exécute import() (waterfall réseau). En le préchargeant
          // via modulepreload dans le HTML pré-rendu (servi pour /login et
          // /jobs), le navigateur le télécharge EN PARALLÈLE de l'entrée →
          // le boot React (et la re-peinture identique du shell) arrive plus
          // tôt, réduisant le LCP simulé. modulepreload déclenche aussi le
          // fetch récursif des imports statiques du module — inutile (et
          // contre-productif : cela embarquerait tous les chunks) d'énumérer
          // la fermeture transitive ici.
          const PAGE_CHUNKS = {
            login: /[\\/]pages[\\/]Login\.js$/,
            jobs: /[\\/]pages[\\/]Jobs\.js$/,
            register: /[\\/]pages[\\/]Register\.js$/,
            'forgot-password': /[\\/]pages[\\/]ForgotPassword\.js$/,
            payment: /[\\/]pages[\\/]Payment\.js$/,
          }
          const chunkFiles = {}
          for (const [file, info] of Object.entries(bundle)) {
            if (typeof info !== 'object' || info === null) continue
            const facade = info.facadeModuleId || info.name || ''
            for (const [route, re] of Object.entries(PAGE_CHUNKS)) {
              if (re.test(facade)) chunkFiles[route] = file
            }
          }
          // modulepreload déjà présents (deps statiques de l'entrée, émis par
          // Vite) — on n'ajoute que le chunk de la route lui-même.
          const existingPreloads = new Set(
            [...html.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1])
          )

          for (const [route, meta] of Object.entries(ROUTES)) {
            const url = `${origin}/${route}`
            const imageUrl = `${origin}${meta.image}`
            let out = html
              .replace(/(<title>)[^<]*(<\/title>)/, `$1${meta.title}$2`)
              .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
            out = setMeta(out, 'og:title', meta.title)
            out = setMeta(out, 'og:description', meta.description)
            out = setMeta(out, 'og:image', imageUrl)
            // Variante carrée : la carte carrée STATIQUE de la home (présente
            // dans index.html) est REMPLACÉE par celle de la route (bloc
            // identifié par height="1200" — la carte wide a height="630").
            // Les crawlers qui recadrent en 1:1 lisent les dimensions
            // déclarées et choisissent la variante adaptée à leur rendu.
            if (meta.imageSquare) {
              const squareUrl = `${origin}${meta.imageSquare}`
              const squareBlock =
                `<meta property="og:image" content="${squareUrl}" />` +
                `<meta property="og:image:width" content="1200" />` +
                `<meta property="og:image:height" content="1200" />` +
                `<meta property="og:image:type" content="image/png" />`
              out = out.replace(
                /<meta property="og:image"[^>]*\/>\s*<meta property="og:image:width" content="1200"[^>]*\/>\s*<meta property="og:image:height" content="1200"[^>]*\/>\s*<meta property="og:image:type" content="image\/png"[^>]*\/>/,
                squareBlock
              )
            }
            out = setMeta(out, 'og:url', url)
            out = setMeta(out, 'twitter:title', meta.title)
            out = setMeta(out, 'twitter:description', meta.description)
            out = setMeta(out, 'twitter:url', url)
            out = setMeta(out, 'twitter:image', imageUrl)
            // Shell statique du LCP : injecté dans <div id="root"> (vide à
            // l'origine) — peint immédiatement, effacé au montage React.
            const shell = SHELLS[route] || ''
            if (shell) {
              out = out.replace('<div id="root"></div>', `<div id="root">${shell}</div>`)
            }
            // Preload du chunk lazy de la route, en parallèle de l'entrée →
            // boot React accéléré (modulepreload fetch aussi ses imports).
            const pageChunk = chunkFiles[route]
            if (pageChunk && !existingPreloads.has(`/${pageChunk}`)) {
              const link = `<link rel="modulepreload" crossorigin href="/${pageChunk}">`
              out = out.replace(
                '<meta charset="utf-8" />',
                `<meta charset="utf-8" />${link}`
              )
            }
            fs.writeFileSync(path.join(outDir, `${route}.html`), out, 'utf8')
          }
        },
      },
      {
        // Franchit la chaîne JS du LANDING (route par défaut /, auditée par
        // les budgets Lighthouse) : précharge via <link rel="modulepreload">
        // le chunk lazy de Home DANS index.html, en parallèle de l'entrée et
        // de ses vendors. Sans lui, le navigateur ne déclenche import() de
        // Home qu'après avoir chargé/enregistré toute la chaîne statique de
        // l'entrée (index → vendor-*) — un waterfall réseau qui retarde le
        // premier rendu de la page. En le mettant en modulepreload ici, la
        // requête part dès le parse du HTML : le polyfill __vitePreload
        // pré-récupère alors aussi les imports statiques du chunk Home (et
        // leurs sous-dépendances), c'est-à-dire toute la sous-chaîne du viewport.
        //
        // C'est « poussé par Vite » au sens où ce plugin lit le bundle réel
        // (facadeModuleId) : le hash du fichier est résolu à CE build, jamais
        // codé en dur. En-tête uniquement (pas de body) : plus rapide à
        // analyser que les modules scripts, et confirme aux navigateurs que
        // le module sera nécessaire.
        //
        // Volontairement LIMITÉ à Home (le landing LCP) dans index.html :
        // les autres pages sont lazy pour de bon (pré-charger toutes leurs
        // chunks d'entrée déferait le code-splitting et téléchargerait le
        // bundle entier au premier chargement). Les routes /jobs, /login,
        // /register (pré-rendues) préchargent déjà leur propre chunk, voir
        // prerender-route-meta.
        name: 'preload-home-chunk',
        apply: 'build',
        writeBundle(options, bundle) {
          const htmlKey = Object.keys(bundle).find((k) => k.endsWith('index.html'))
          if (!htmlKey) return
          const outDir = options.dir
          if (!outDir) return
          const indexPath = path.join(outDir, htmlKey)
          if (!fs.existsSync(indexPath)) return

          // Chunk lazy de Home (emporte aussi ses imports statiques via
          // modulepreload). Si absent (plus de lazy Home), on ne casse rien.
          let homeChunk = null
          for (const [file, info] of Object.entries(bundle)) {
            if (typeof info !== 'object' || info === null) continue
            const facade = info.facadeModuleId || info.name || ''
            if (/[\\/]pages[\\/]Home\.js$/.test(facade)) {
              homeChunk = file
              break
            }
          }
          if (!homeChunk) return

          let html = fs.readFileSync(indexPath, 'utf8')
          // Ne pas dupliquer si déjà présent (idempotence entre runs).
          if (html.includes(`/${homeChunk}`)) return
          // Insère juste après l'entrée (avant le script module de l'entrée)
          // pour démarrer la requête le plus tôt possible dans <head>.
          const link = `<link rel="modulepreload" crossorigin href="/${homeChunk}" />`
          html = html.replace(
            '<meta charset="utf-8" />',
            `<meta charset="utf-8" />${link}`
          )
          fs.writeFileSync(indexPath, html, 'utf8')
        },
      },
      {
        // CSP injectée UNIQUEMENT en build de production (le dev Vite a besoin
        // de scripts inline/HMR). Durcissement XSS : bloque les scripts
        // externes injectés et eval, sans casser le bundling Vite.
        name: 'inject-production-csp',
        transformIndexHtml(html) {
          if (mode !== 'production') return html
          // Le script Plausible est chargé via src depuis un module bundlé ;
          // son domaine n'est autorisé dans script-src QUE si l'analytics est
          // réellement configurée (sinon surface d'attaque inutile).
          const plausibleDomain = (env.VITE_PLAUSIBLE_DOMAIN || '').trim()
          // Le SDK Google Identity Services (bouton SSO) est chargé dynamiquement
          // depuis accounts.google.com/gsi/client : sans cette entrée dans
          // script-src, la CSP le bloque et le bouton Google échoue avec
          // « Impossible de charger le SDK Google » (script.onerror).
          const scriptSrc = ["'self'", 'https://accounts.google.com']
          if (plausibleDomain) scriptSrc.push('https://plausible.io')
          const csp = [
            "default-src 'self'",
            `script-src ${scriptSrc.join(' ')}`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https://res.cloudinary.com https://tile.openstreetmap.org",
            // Géolocalisation 100% centralisée derrière le backend Kojo :
            // détection IP (/geolocation/detect), reverse geocoding
            // (/geolocation/reverse) et base villes/quartiers
            // (/geolocation/cities) passent tous par apiOrigin. Plus aucun
            // appel direct à ipapi.co / ipinfo.io / nominatim depuis le
            // navigateur → connect-src réduit au strict minimum (Google
            // Identity Services ajouté pour le SSO).
            `connect-src 'self' ${apiOrigin} https://accounts.google.com`,
            // Cartes : les aperçus de localisation sont des iframes
            // (CreateJob / JobCreateModal → buildMapEmbedUrl) Google Maps ou
            // OpenStreetMap. Sans frame-src, default-src 'self' les bloque
            // (console : « Refused to frame »). accounts.google.com est
            // nécessaire au sélecteur de compte du SSO Google.
            "frame-src 'self' https://www.google.com https://www.openstreetmap.org https://accounts.google.com",
            "font-src 'self' data:",
            "object-src 'none'",
            "base-uri 'self'",
            // frame-ancestors est IGNORÉ dans une balise <meta> (navigateurs) et
            // provoque un warning console à chaque chargement de page. Il est
            // envoyé comme véritable en-tête HTTP dans frontend/vercel.json.
            "worker-src 'self'",
            "manifest-src 'self'",
          ].join('; ')
          return {
            html,
            tags: [
              {
                tag: 'meta',
                attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
                injectTo: 'head-prepend',
              },
            ],
          }
        },
      },
    ],
    // NOTE: l'alias '@' (shadcn/ui) a été supprimé avec les composants ui/
    // inutilisés — plus rien ne l'importe dans src/. jsconfig.json le garde
    // uniquement pour l'éditeur ; ne pas le réintroduire dans Vite sans besoin.
    define: {
      'process.env': publicEnv,
    },
    optimizeDeps: {
      esbuildOptions: {
        loader: {
          '.js': 'jsx',
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
    },
    build: {
      outDir: 'build',
      sourcemap: false,
      // Minification activée : réduit la taille des bundles (~40-60% selon
      // le code), accélère le premier chargement - critique pour les
      // connexions mobiles 3G/4G en Afrique de l'Ouest. Désactivé par
      // défaut dans l'ancien code, probablement pour faciliter le debug.
      // Pour déboguer un problème de prod : passer temporairement à
      // `minify: false` localement, jamais en prod.
      minify: 'esbuild',
      cssMinify: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            // @sentry/* AVANT la règle '/react/' : le chemin de '@sentry/react'
            // contient '/react/' et serait sinon aspiré dans vendor-react, ce
            // qui séparait @sentry/core dans un AUTRE chunk (vendor, avec
            // react-router) et créait un cycle d'imports entre chunks → au
            // chargement, React était encore undefined quand react-router
            // exécutait createContext → page blanche en production.
            if (id.includes('@sentry')) return 'vendor-sentry'
            if (id.includes('/react-dom/')) return 'vendor-react-dom'
            // react-router v7 : react-router-dom ré-exporte depuis
            // react-router (le code réel vit dans node_modules/react-router/).
            // Matcher les DEUX chemins pour bien isoler le router.
            if (id.includes('/react-router')) return 'vendor-router'
            if (id.includes('/react/')) return 'vendor-react'
            if (id.includes('/axios/')) return 'vendor-axios'
            if (id.includes('/lucide-react/')) return 'vendor-lucide'
            if (id.includes('/prop-types/')) return 'vendor-prop-types'
            // leaflet (cartes) n'est utilisé que par JobsMap.js : chunk séparé
            // pour ne pas alourdir le bundle initial des autres pages.
            if (id.includes('/leaflet/')) return 'vendor-leaflet'
            return 'vendor'
          },
        },
      },
    },
    // Config Vitest — les tests utilisent `vite.config.js`, pas besoin
    // d'un fichier séparé. Lancer avec `npm test`.
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.js',
      css: true,
    },
  }
})
