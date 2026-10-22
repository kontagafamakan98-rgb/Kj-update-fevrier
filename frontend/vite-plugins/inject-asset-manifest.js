// Publie l'EMPREINTE de chaque actif servi (JS, CSS, polices) et de chaque
// CONTENU (images, cartes OG, icônes), puis l'ANCRE dans le HTML.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import {
  BUILD_ASSETS_META,
  ECHANTILLON_CONTENU,
  MANIFESTE_ACTIFS,
  plagesContenu,
} from '../scripts/site-meta.js'

/**
 * Ce qu'un actif est : du CODE ou une POLICE. Empreinte du fichier ENTIER — son
 * octet exact est ce que la sonde rejoue, et ces fichiers pèsent quelques kio.
 */
export const EXTENSIONS_ACTIFS = ['.js', '.mjs', '.css', '.woff2', '.woff', '.ttf', '.otf']

/**
 * Ce qu'un CONTENU est : une image, une carte OG, une icône. Empreinte par
 * ÉCHANTILLON (tête, milieu et queue, cf. `ECHANTILLON_CONTENU`) : le fichier
 * entier ferait télécharger des mégaoctets à la sonde pour un fait qu'un
 * déploiement mixte change dès les premiers octets, et les trois blocs couvrent
 * aussi une retouche au centre du fichier — celle que deux bords intacts
 * laissaient passer.
 *
 * La distinction est portée par le MANIFESTE (deux sections : `fichiers`,
 * `contenus`), pas par une liste dans la sonde : c'est le build qui sait ce
 * qu'il a publié, et la sonde lit sa déclaration.
 */
export const EXTENSIONS_CONTENUS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.gif',
  '.svg',
  '.ico',
]

/** Empreinte d'octets, en SHA-256 hexadécimal (la même des deux côtés du verdict). */
export function empreinteDe(octets) {
  return createHash('sha256').update(octets).digest('hex')
}

/** Tous les fichiers sous `dossier`, récursivement (chemins absolus). */
function fichiersSous(dossier) {
  const trouves = []
  for (const nom of readdirSync(dossier)) {
    const abs = join(dossier, nom)
    if (statSync(abs).isDirectory()) trouves.push(...fichiersSous(abs))
    else trouves.push(abs)
  }
  return trouves
}

/**
 * Les actifs du build, avec leur CHEMIN PUBLIC (`/assets/…`, `/fonts/…`).
 *
 * Le chemin est dérivé du disque, pas d'une liste écrite à la main : un actif
 * ajouté demain (un chunk, une police) entre dans le manifeste tout seul, et un
 * actif renommé par le hash de Rollup suit sans qu'aucune ligne ne bouge.
 *
 * @param {string} dossier Dossier de sortie du build (`build/`).
 * @returns {Array<{chemin: string, abs: string}>} Triés par chemin public.
 */
export function listerActifs(dossier) {
  return listerParExtension(dossier, EXTENSIONS_ACTIFS)
}

/**
 * Les CONTENUS du build (images, cartes OG, icônes), avec leur chemin public.
 *
 * Même dérivation que les actifs — le disque, jamais une liste écrite à la main —
 * pour la même raison : une carte ajoutée demain entre dans le manifeste seule.
 *
 * @param {string} dossier Dossier de sortie du build (`build/`).
 * @returns {Array<{chemin: string, abs: string}>} Triés par chemin public.
 */
export function listerContenus(dossier) {
  return listerParExtension(dossier, EXTENSIONS_CONTENUS)
}

/**
 * Les fichiers du build dont l'extension est dans `extensions`, triés par chemin
 * public, le manifeste lui-même exclu (il ne se décrit pas).
 *
 * @param {string} dossier Dossier de sortie du build.
 * @param {string[]} extensions Extensions acceptées (en minuscules).
 * @returns {Array<{chemin: string, abs: string}>}
 */
function listerParExtension(dossier, extensions) {
  const trouvés = []
  for (const abs of fichiersSous(dossier)) {
    if (!extensions.some((extension) => abs.toLowerCase().endsWith(extension))) continue
    const chemin = '/' + relative(dossier, abs).split(sep).join('/')
    if (chemin === MANIFESTE_ACTIFS) continue
    trouvés.push({ chemin, abs })
  }
  return trouvés.sort((a, b) => a.chemin.localeCompare(b.chemin))
}

/**
 * L'entrée de manifeste d'un CONTENU : sa taille et l'empreinte de chaque PLAGE
 * (tête, milieu quand il existe, queue) — les mêmes plages que la sonde relira.
 *
 * `echantillon` est publié à côté des empreintes, et ce n'est pas une redondance :
 * la sonde REFUSE un échantillon plus grand que `ECHANTILLON_CONTENU` (un
 * manifeste forgé ne doit pas lui faire télécharger un fichier entier), et un
 * fichier plus petit que le bloc publie sa taille réelle — tête et queue sont
 * alors le même bloc, ce qui est correct et évite un cas particulier.
 *
 * Les plages viennent de `plagesContenu` (`site-meta.js`), pas d'un calcul
 * local : le build et la sonde doivent demander EXACTEMENT les mêmes octets.
 *
 * @param {string} abs Chemin absolu du fichier.
 * @returns {{taille: number, echantillon: number, debut: string, fin: string, milieu?: string}}
 */
export function entreeContenu(abs) {
  const octets = readFileSync(abs)
  const echantillon = Math.min(ECHANTILLON_CONTENU, octets.length)
  const entree = { taille: octets.length, echantillon }
  for (const { champ, debut, fin } of plagesContenu(octets.length, echantillon)) {
    entree[champ] = empreinteDe(octets.subarray(debut, fin + 1))
  }
  return entree
}

/**
 * Écrit `asset-manifest.json` et rend l'empreinte de SES octets.
 *
 * L'ordre des clés est celui des chemins triés : deux builds du même code
 * produisent donc le même manifeste, octet pour octet, et son empreinte ne
 * dépend que des actifs — jamais de l'heure du build ni de l'ordre du disque.
 *
 * @param {string} dossier Dossier de sortie du build.
 * @returns {{empreinte: string, nombre: number, contenus: number}}
 *   `nombre` = actifs listés (code et polices), `contenus` = images et cartes.
 */
export function ecrireManifeste(dossier) {
  const fichiers = {}
  const actifs = listerActifs(dossier)
  for (const { chemin, abs } of actifs) fichiers[chemin] = empreinteDe(readFileSync(abs))

  const contenus = {}
  const images = listerContenus(dossier)
  for (const { chemin, abs } of images) contenus[chemin] = entreeContenu(abs)

  const octets = Buffer.from(JSON.stringify({ fichiers, contenus }, null, 2) + '\n', 'utf8')
  writeFileSync(join(dossier, MANIFESTE_ACTIFS.replace(/^\//, '')), octets)
  return { empreinte: empreinteDe(octets), nombre: actifs.length, contenus: images.length }
}

/**
 * Ancre l'empreinte du manifeste dans CHAQUE page HTML du build, y compris les
 * pages rangées dans un sous-dossier (`legal/…`) : une page oubliée serait une
 * page dont les actifs ne seraient rattachés à aucun manifeste.
 *
 * La balise va dans la tête (avant `</head>`) pour la même raison que les autres
 * métadonnées : c'est ce qu'un client reçoit sans exécuter de JavaScript. Une
 * page sans `</head>` est laissée telle quelle — c'est un défaut du build, et la
 * sonde le nommera en refusant une page d'accueil muette.
 *
 * Idempotent : une page qui porte déjà l'ancre n'est pas réécrite, sinon un
 * second passage empilerait deux balises et la lecture deviendrait ambiguë.
 *
 * @param {string} dossier Dossier de sortie du build.
 * @param {string} empreinte Empreinte du manifeste (64 hexadécimaux).
 * @returns {number} Nombre de pages ancrées.
 */
export function ancrerManifeste(dossier, empreinte) {
  const balise = `<meta name="${BUILD_ASSETS_META}" content="${empreinte}">`
  let ancrées = 0
  for (const abs of fichiersSous(dossier)) {
    if (!abs.toLowerCase().endsWith('.html')) continue
    const html = readFileSync(abs, 'utf8')
    if (html.includes(`name="${BUILD_ASSETS_META}"`)) continue
    const index = html.lastIndexOf('</head>')
    if (index === -1) continue
    writeFileSync(abs, html.slice(0, index) + balise + html.slice(index), 'utf8')
    ancrées += 1
  }
  return ancrées
}

/**
 * Plugin Vite : le manifeste d'actifs et son ancre, écrits APRÈS le bundle.
 *
 * `closeBundle` est le premier instant où tous les fichiers sont sur le disque —
 * y compris ceux que Vite recopie depuis `public/` (les polices) et les pages
 * écrites par les autres plugins. C'est donc le seul endroit où l'empreinte d'un
 * actif décrit bien l'octet qui sera servi.
 *
 * Le dossier vient de `configResolved` (`root` + `build.outDir`) : recopier
 * « build » ici ferait écrire le manifeste ailleurs le jour où `outDir` change,
 * et la sonde refuserait une production pourtant correcte.
 *
 * @param {object} [options]
 * @param {string} [options.dossier] Dossier de sortie (défaut : celui de Vite).
 * @returns {object} Plugin Vite.
 */
export function injectAssetManifestPlugin({ dossier = 'build' } = {}) {
  let sortie = resolve(dossier)
  return {
    name: 'inject-asset-manifest',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      sortie = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const { empreinte, nombre } = ecrireManifeste(sortie)
      // Aucun actif : rien à ancrer. Un build sans JS ni CSS n'est pas un site ;
      // la sonde refusera un manifeste vide au lieu de le prendre pour un vert.
      if (!nombre) return
      ancrerManifeste(sortie, empreinte)
    },
  }
}
