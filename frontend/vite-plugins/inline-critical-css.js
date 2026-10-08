// Inline le CSS render-blocking de l'index dans le HTML de build.
//
// ── Le fichier n'est PAS supprimé, et c'est la correction d'un défaut vécu ──
// Ce plugin remplace le `<link rel="stylesheet">` de l'index par une balise
// `<style>` : le CSS render-blocking ne bloque plus le premier rendu (~140 ms
// gagnés). Il SUPPRIMAIT ensuite la feuille du disque, ce qui était vrai tant
// que la feuille de l'entrée n'était référencée que par l'index.
//
// Depuis que la carte (`JobsMap`) est importée en `import()` par
// `src/pages/Jobs.js`, Vite inscrit le CSS de l'entrée dans la TABLE DE
// DÉPENDANCES du chunk qui déclare l'import dynamique (`__vite__mapDeps`) : le
// groupe de chunks dépend transitivement de l'entrée. `__vitePreload` télécharge
// alors CHAQUE entrée de cette table avant d'évaluer le module — la feuille
// supprimée rendait un 404, le préchargement rejetait, `React.lazy` jetait, et
// l'`ErrorBoundary` remplaçait la page. Symptôme mesuré en production le
// 26/09/2026 : au clic sur « Carte », « Oups ! Quelque chose s'est mal passé »
// (`Unable to preload CSS for /assets/index-BYK0oy-w.css`).
//
// Le fichier reste donc sur disque : la balise `<link>` de l'index a disparu
// (aucune requête render-blocking au premier rendu), et les imports dynamiques
// trouvent leur dépendance. Le CSS de leaflet, lui, n'a jamais été concerné : il
// n'est pas référencé par l'index et reste un fichier séparé.

import fs from 'node:fs'
import path from 'node:path'

export function inlineCriticalCssPlugin() {
  return {
    name: 'inline-critical-css',
    apply: 'build',
    // writeBundle s'exécute APRÈS l'écriture des fichiers : le HTML final (avec
    // les URLs hashées) et les CSS sont tous deux sur disque. On inline la
    // feuille de l'index dans le HTML. Le fichier reste sur disque — cf. l'en-tête
    // du module : le supprimer casse les imports dynamiques du même build.
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
      }
      fs.writeFileSync(htmlPath, html, 'utf8')
    },
  }
}
