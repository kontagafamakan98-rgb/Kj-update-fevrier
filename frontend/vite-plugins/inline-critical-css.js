// Inline le CSS render-blocking de l'index dans le HTML de build.

import fs from 'node:fs'
import path from 'node:path'

export function inlineCriticalCssPlugin() {
  return {
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
  }
}
