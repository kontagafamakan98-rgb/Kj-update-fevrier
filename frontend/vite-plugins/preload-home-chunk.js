// Précharge le chunk de la page d'accueil depuis index.html (modulepreload).

import fs from 'node:fs'
import path from 'node:path'

export function preloadHomeChunkPlugin() {
  return {
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
  }
}
