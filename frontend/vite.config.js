import { defineConfig, loadEnv, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'

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
          const scriptSrc = plausibleDomain
            ? "script-src 'self' https://plausible.io"
            : "script-src 'self'"
          const csp = [
            "default-src 'self'",
            scriptSrc,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https://res.cloudinary.com https://tile.openstreetmap.org",
            // Géolocalisation 100% centralisée derrière le backend Kojo :
            // détection IP (/geolocation/detect), reverse geocoding
            // (/geolocation/reverse) et base villes/quartiers
            // (/geolocation/cities) passent tous par apiOrigin. Plus aucun
            // appel direct à ipapi.co / ipinfo.io / nominatim depuis le
            // navigateur → connect-src réduit au strict minimum.
            `connect-src 'self' ${apiOrigin}`,
            // Cartes : les aperçus de localisation sont des iframes
            // (CreateJob / JobCreateModal → buildMapEmbedUrl) Google Maps ou
            // OpenStreetMap. Sans frame-src, default-src 'self' les bloque
            // (console : « Refused to frame »).
            "frame-src 'self' https://www.google.com https://www.openstreetmap.org",
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
            if (id.includes('/react-router-dom/')) return 'vendor-router'
            if (id.includes('/react/')) return 'vendor-react'
            if (id.includes('/axios/')) return 'vendor-axios'
            if (id.includes('/lucide-react/')) return 'vendor-lucide'
            if (id.includes('/prop-types/')) return 'vendor-prop-types'
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
