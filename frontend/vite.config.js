import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'

// Les plugins du build vivent chacun dans leur module (dossier vite-plugins/) :
// ce fichier ne fait plus que COMPOSER, ce qui rend chaque plugin importable et
// exerçable par un test au lieu d'être atteignable seulement par un build complet.
import { treatJsFilesAsJsxPlugin } from './vite-plugins/treat-js-files-as-jsx.js'
import { inlineCriticalCssPlugin } from './vite-plugins/inline-critical-css.js'
import { prerenderRouteMetaPlugin } from './vite-plugins/prerender-route-meta.js'
import { preloadHomeChunkPlugin } from './vite-plugins/preload-home-chunk.js'
import { injectSeoExtrasPlugin } from './vite-plugins/inject-seo-extras.js'
import { injectProductionCspPlugin } from './vite-plugins/inject-production-csp.js'
import { injectBuildRevisionPlugin } from './vite-plugins/inject-build-revision.js'
import { writeRobotsTxtPlugin } from './vite-plugins/write-robots-txt.js'

// Correspondance route → carte OG : SOURCE UNIQUE dans scripts/check-og-images.js,
// qui est aussi le module vérifiant le HTML servi. Le build n'en garde aucune
// copie (deux tables divergeaient) : une route pré-rendue absente de cette table
// fait échouer le build, plutôt que de publier un og:image troué.
import { ROUTES as OG_CARD_ROUTES } from './scripts/check-og-images.js'

// Textes publiés par route (titre + description) : SOURCE UNIQUE dans
// src/config/page-meta.js — lue AUSSI par les pages au runtime (usePageMeta).
// Une clé absente de src/i18n/fr.json casse le build (T() plus bas) au lieu de
// publier un titre vide.
import { PAGE_META } from './src/config/page-meta.js'

// Dérivation des routes privées (voir PRIVATE_ROUTES plus bas) : elle vit dans
// le garde qui l'applique — `privateRoutesOf` était déjà la seule définition de
// « ce qu'est une route privée », elle l'est désormais aussi pour le build.
import { parseAppRoutes, privateRoutesOf } from './scripts/check-spa-routes.js'

// Identité publique du site : origine canonique ET origine de l'API, possédées
// par scripts/site-meta.js. Le build n'en garde aucune copie — leur PAIRE est ce
// que le backend doit autoriser en CORS (scripts/check-cors-preflight.js).
import { API_ORIGIN, SITE_ORIGIN, shellFileFor } from './scripts/site-meta.js'

// « Une page de route publique annonce-t-elle ses métadonnées, dans chaque langue
// publiée ? » : les règles qui ne lisent QUE les sources sont jouées ICI, par le
// build — la CI les rejoue après le build, mais un oubli partait alors en
// pré-déploiement avant d'être rattrapé. Le plugin est défini par le garde
// lui-même (scripts/check-page-meta.js) : UNE définition, exerçable par un test.
import { requirePageMeta } from './scripts/check-page-meta.js'

// Corps des pages pré-rendues « de confiance » (/about, /contact, /privacy) :
// SOURCE UNIQUE dans src/config/page-sections.js — lue AUSSI par les pages au
// runtime. Les coquilles s'en DÉRIVENT : elles ne recopient ni la liste des
// sections, ni celle des promesses, ni celle des moyens de contact, donc une
// section ajoutée à une page ne peut plus manquer au HTML que lit un crawler
// sans JavaScript (le build refuse une coquille incomplète, plus bas).
import { PAGE_SECTIONS, pageSectionParts } from './src/config/page-sections.js'

const OG_CARDS = Object.fromEntries(
  OG_CARD_ROUTES.map(({ path: routePath, image, imageSquare }) => [routePath, { image, imageSquare }])
)

// Routes PRIVÉES : SOURCE UNIQUE dans scripts/check-spa-routes.js, qui les
// DÉRIVE du routage réel (src/App.js) et de la table de rewrites — la même
// dérivation que celle dont le garde exige ensuite le noindex dans vercel.json.
// Le build n'en garde aucune copie : c'est cette liste qui écrit le `Disallow`
// de robots.txt, donc ajouter une page privée au routage l'interdit aux crawlers
// sans que personne ait à y penser.
const PRIVATE_ROUTES = privateRoutesOf(
  parseAppRoutes(readFileSync(new URL('./src/App.js', import.meta.url), 'utf8')).routes,
  JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).rewrites || []
)

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
  let apiOrigin = API_ORIGIN
  try {
    apiOrigin = new URL(rawApiUrl || `${API_ORIGIN}/api`).origin
  } catch (_error) {
    // URL invalide : on garde l'origin par défaut
  }

  return {
    plugins: [
      // Le refus « page publique muette » est défini par le garde lui-même
      // (requirePageMeta dans scripts/check-page-meta.js) : une définition,
      // exerçable par un test, que le build joue ici.
      requirePageMeta(),
      react(),
      treatJsFilesAsJsxPlugin(),
      inlineCriticalCssPlugin(),
      // La table route → carte OG se dérive de `scripts/check-og-images.js`
      // (source unique des routes) : ce fichier ne la recopie pas.
      prerenderRouteMetaPlugin({
        ogCards: OG_CARDS,
        pageMeta: PAGE_META,
        pageSections: PAGE_SECTIONS,
        pageSectionParts,
        siteOrigin: SITE_ORIGIN,
        shellFileFor,
        env,
        mode,
      }),
      // robots.txt est écrit depuis la MÊME liste que l'en-tête X-Robots-Tag et
      // que le meta de app.html : ce fichier ne recopie aucune route privée.
      writeRobotsTxtPlugin({ privateRoutes: PRIVATE_ROUTES, siteOrigin: SITE_ORIGIN }),
      preloadHomeChunkPlugin(),
      injectSeoExtrasPlugin({ env }),
      // Ce que le déploiement de production ANNONCE de lui-même (meta
      // `kojo-build-revision`) : c'est ce que lit `scripts/check-deployed-revision.js`
      // pour refuser un frontend servi qui n'est pas celui de `main`.
      injectBuildRevisionPlugin({ env }),
      injectProductionCspPlugin({ env, mode, apiOrigin }),
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
      // Cible de transpilation ÉCRITE EXPLICITEMENT. Vite 7 utilise déjà ce jeu
      // par défaut, mais l'écrire ici est ce qui empêche un changement de défaut
      // (ou une option posée ailleurs) de faire redescendre silencieusement le
      // code sous le niveau « Baseline Widely Available ». C'est exactement ce
      // que mesure Lighthouse dans `legacy-javascript` : du code downlevelé, des
      // helpers de transpilation (`__spreadArray`, `_objectSpread`, `_typeof`)
      // ou des polyfills qui partent au navigateur sans lui servir. Mesure du
      // 24/09/2026 sur le build de production : `legacy-javascript` = 1 (rien
      // signalé) sur les 13 pages auditées, aucun helper dans build/assets/*.js,
      // et la syntaxe moderne survit (`??` présent dans les chunks).
      //
      // NE PAS se fier au champ `browserslist` de package.json pour ceci : Vite
      // ne le lit PAS pour le JS (il vient de react-scripts, il ne sert plus
      // qu'à PostCSS/autoprefixer, donc au CSS). Baisser la cible JS se fait ICI,
      // et nulle part ailleurs.
      target: 'baseline-widely-available',
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
      exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/e2e/**'],
      // Marge sur le délai par défaut (5 s). Plusieurs gardes CI testent des
      // scripts qui LANCENT un sous-processus Node/Python (check-bundle-size,
      // check-script-deps, check-generated-icons, check-spa-routes…) : sous la
      // charge de 33 fichiers exécutés en parallèle, leur démarrage dépasse
      // régulièrement 5 s sur une machine de développement — alors qu'ils
      // passent seuls en moins d'une seconde. Trois faux rouges de ce type ont
      // été observés le 16/09/2026 ; un timeout de test qui dépend de la charge
      // de la machine n'est pas un test, c'est une loterie.
      testTimeout: 20000,
    },
  }
})
