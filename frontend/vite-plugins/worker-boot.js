// Publie le POINT D'ENTRÉE et la FEUILLE de l'application à des chemins STABLES
// pour les documents pré-rendus `/workers/:id` ET `/jobs/:id`.
//
// ── Pourquoi des chemins stables ─────────────────────────────────────────
// Ces documents sont écrits par le BACKEND (`kojo_worker_og.py`, rewrite Vercel
// /workers/(.*) → /api/og/workers/$1 ; `kojo_job_og.py`, /jobs/(.*) →
// /api/og/jobs/$1) : ils ne peuvent pas citer `/assets/index-A1b2.css`
// ni `/assets/index-X9y8.js`, qui changent à chaque livraison. Il cite donc
// `/boot/worker-boot.js` et `/boot/worker-app.css` (déclarés UNE fois dans
// `scripts/site-meta.js` → `POINT_ENTREE_TRAVAILLEUR`), et ce plugin y écrit ce
// que CE build a produit.
//
// ── Ce que contient le fichier de boot, et pourquoi si peu ───────────────
// Une seule ligne : `import"<entrée hachée>"`. L'entrée est celle que
// `index.html` charge — lue dans le HTML bâti, donc jamais recopiée à la main.
// Conséquence voulue : l'application n'existe qu'UNE fois dans le build, sous
// son nom haché, et le profil profite du même cache immuable que les pages. Une
// seconde entrée Rollup partageait les modules autrement et posait 188 Ko
// d'application sous un nom STABLE — que `must-revalidate` fait revalider à
// chaque visite et que `immutable` figerait : les deux mauvaises réponses.
//
// ── Pourquoi la feuille est une COPIE ────────────────────────────────────
// `src/index.js` importe `index.css`, mais Vite EXTRAIT ce CSS du JavaScript :
// un document qui ne lie pas la feuille démarre l'application SANS style. Le CSS
// est lu dans `build/index.html` (où `inline-critical-css` l'a déjà inliné), ce
// qui garantit que la copie est la feuille SERVIE et non une liste de chunks
// recopiée qui omettrait un jour une dépendance. Repli sur le
// `<link rel="stylesheet">` si l'inline disparaît un jour.
//
// ── Les deux refus ───────────────────────────────────────────────────────
// Pas d'entrée dans le HTML, ou pas de CSS (ni feuille témoin `.titre-page`) :
// le build échoue. Publier un document qui pointerait vers un 404 rendrait la
// page statique et muette — exactement ce que cette passe corrige — et un profil
// sans châssis ni typographie se lirait comme une page cassée.
//
// Les deux fichiers sont écrits AVANT `inject-asset-manifest` (closeBundle) :
// ils entrent donc dans le manifeste d'empreintes, et
// `check-deployed-assets.js` vérifie leurs octets en production.

import fs from 'node:fs'
import path from 'node:path'

import { POINT_ENTREE_TRAVAILLEUR } from '../scripts/site-meta.js'

// Une règle qui n'existe QUE dans la feuille de l'application : sa présence
// prouve que la copie porte le CSS du site, pas un bloc vide ou la feuille d'un
// autre outil.
export const SELECTEUR_TEMOIN = '.titre-page'

/**
 * L'entrée JavaScript que le document HTML charge — le seul fait dont dépend le
 * fichier de boot.
 *
 * @param {string} html Contenu de `build/index.html`.
 * @returns {string} Chemin public (`/assets/index-….js`), ou '' si absent.
 */
export function entreeDuHtml(html) {
  // L'ORDRE des attributs ne décide rien : Vite écrit aujourd'hui
  // `type="module" crossorigin src=…`, et un changement de forme (ou un HTML
  // réécrit par un autre plugin) ne doit pas faire croire qu'il n'y a plus
  // d'entrée — le build s'arrêterait pour un détail de notation.
  for (const motif of [
    /<script\b[^>]*type="module"[^>]*src="([^"]+\.js)"/i,
    /<script\b[^>]*src="([^"]+\.js)"[^>]*type="module"/i,
  ]) {
    const balise = motif.exec(String(html))
    if (balise) return balise[1]
  }
  return ''
}

/**
 * Le CSS que le document HTML porte (blocs `<style>`) ou, à défaut, la feuille
 * qu'il lie.
 *
 * @param {string} html Contenu de `build/index.html`.
 * @param {string} dossier Dossier de sortie du build.
 * @returns {string} CSS, ou '' si le document n'en publie aucun.
 */
export function extraireCss(html, dossier) {
  const blocs = [...String(html).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(
    (m) => m[1]
  )
  if (blocs.length) return blocs.join('\n')
  const lien = /<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+\.css)"/i.exec(String(html))
  if (!lien) return ''
  const abs = path.join(dossier, lien[1].replace(/^\/+/, ''))
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : ''
}

/**
 * Le fichier de boot : une importation statique de l'entrée hachée du build.
 *
 * Statique (et non `import()` différé) : le navigateur découvre l'entrée en
 * même temps que ce fichier, comme s'il l'avait lue dans le HTML, et il n'y a
 * pas de fenêtre où la page serait chargée sans que rien ne démarre.
 *
 * @param {string} entree Chemin public de l'entrée (`/assets/index-….js`).
 * @returns {string} Contenu du module.
 */
export function contenuBoot(entree) {
  return (
    `// Point d'entrée STABLE des documents pré-rendus /workers/:id et /jobs/:id (écrit par le build).\n` +
    `// Importe l'entrée que les pages chargent : l'application n'est pas dupliquée.\n` +
    `import"${entree}";\n`
  )
}

/**
 * Plugin Vite : `build/boot/worker-boot.js` et `build/boot/worker-app.css`, aux
 * chemins de `POINT_ENTREE_TRAVAILLEUR` (réutilisés par `POINT_ENTREE_MISSION`).
 *
 * @param {object} [options]
 * @param {string} [options.script] Chemin public du boot (défaut : site-meta).
 * @param {string} [options.style] Chemin public de la feuille (défaut : site-meta).
 * @returns {object} Plugin Vite.
 */
export function workerBootPlugin({
  script = POINT_ENTREE_TRAVAILLEUR.script,
  style = POINT_ENTREE_TRAVAILLEUR.style,
} = {}) {
  let sortie = path.resolve('build')
  return {
    name: 'worker-boot',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      sortie = path.resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      const htmlPath = path.join(sortie, 'index.html')
      if (!fs.existsSync(htmlPath)) {
        throw new Error(
          'worker-boot : build/index.html introuvable — le point d’entrée et la ' +
            'feuille des documents pré-rendus (/workers/:id, /jobs/:id) ne peuvent ' +
            'pas être publiés, et ces pages resteraient statiques.'
        )
      }
      const html = fs.readFileSync(htmlPath, 'utf8')

      const entree = entreeDuHtml(html)
      if (!entree) {
        throw new Error(
          'worker-boot : aucune entrée `type="module"` dans build/index.html — les ' +
            'documents pré-rendus ne pourraient pas démarrer l’application (pages ' +
            'statiques au lieu de l’app).'
        )
      }
      const bootPath = path.join(sortie, script.replace(/^\/+/, ''))
      fs.mkdirSync(path.dirname(bootPath), { recursive: true })
      fs.writeFileSync(bootPath, contenuBoot(entree), 'utf8')

      const css = extraireCss(html, sortie)
      if (!css) {
        throw new Error(
          'worker-boot : aucune feuille de style dans build/index.html — les ' +
            'documents pré-rendus démarreraient l’application SANS CSS. ' +
            'Vérifier inline-critical-css / le build Vite.'
        )
      }
      if (!css.includes(SELECTEUR_TEMOIN)) {
        throw new Error(
          `worker-boot : la feuille copiée ne contient pas \`${SELECTEUR_TEMOIN}\` — ` +
            'ce n’est pas le CSS de l’application ; la copie publierait une page ' +
            'déshabillée.'
        )
      }
      const cssPath = path.join(sortie, style.replace(/^\/+/, ''))
      fs.mkdirSync(path.dirname(cssPath), { recursive: true })
      fs.writeFileSync(cssPath, css, 'utf8')
    },
  }
}
