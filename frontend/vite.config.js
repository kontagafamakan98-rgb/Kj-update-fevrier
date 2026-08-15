import { defineConfig, loadEnv, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const publicEnv = {
    ...Object.fromEntries(
      Object.entries(env).filter(([key]) => key.startsWith('REACT_APP_'))
    ),
    NODE_ENV: mode,
    PUBLIC_URL: '',
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
    ],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), 'src'),
      },
    },
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
