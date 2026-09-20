// Écrit `build/robots.txt` depuis la liste DÉRIVÉE des routes privées.
//
// ── Ce que ce plugin remplace ────────────────────────────────────────────────
// robots.txt était servi par le BACKEND (`GET /api/robots.txt`, proxifié par un
// rewrite Vercel) avec sa propre liste `Disallow` écrite à la main. Cette liste
// et le routage ne se parlaient pas : mesuré le 20/09/2026, elle interdisait
// 4 routes privées sur 9 — `/create-job`, `/email-verification`,
// `/payment-verification`, `/commission-dashboard` et `/support-admin` restaient
// crawlables — et la seule assertion qui portait sur ce fichier vérifiait la
// balise `Sitemap`. Deux listes pour une décision, donc : le motif que le dépôt
// supprime partout ailleurs.
//
// Le fichier est maintenant un ARTEFACT DU BUILD, comme les coquilles
// pré-rendues : il est rendu par le module qui DÉRIVE la liste
// (`robotsTxtFor`, dans scripts/check-spa-routes.js), à partir de la même
// dérivation que l'en-tête `X-Robots-Tag` de vercel.json et que le meta de
// app.html. Une route privée de plus ne peut donc plus manquer à l'un des trois.
//
// ── Pourquoi écrire dans `writeBundle` ───────────────────────────────────────
// C'est le moment où le dossier de sortie est complet (les autres plugins du
// build écrivent leurs coquilles au même hook), et le garde qui relit ce fichier
// (`scripts/check-spa-routes.js`) tourne APRÈS le build en CI : le fichier qu'il
// vérifie est bien celui qui part en pré-déploiement.

import fs from 'node:fs'
import path from 'node:path'
// La liste des routes privées et le RENDU du fichier ont UN propriétaire : le
// module qui les dérive. Ce plugin ne fait qu'écrire ses octets.
import { ROBOTS_TXT, robotsTxtFor } from '../scripts/check-spa-routes.js'

/**
 * @param {{privateRoutes: string[], siteOrigin: string}} options
 *   `privateRoutes` — routes privées dérivées du routage (privateRoutesOf).
 *   `siteOrigin` — origine canonique du site, pour la balise `Sitemap`.
 */
export function writeRobotsTxtPlugin({ privateRoutes, siteOrigin }) {
  let publicDir = null
  return {
    name: 'write-robots-txt',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir
    },
    writeBundle(options) {
      const outDir = options.dir
      if (!outDir) return

      // Un `public/robots.txt` serait copié dans le build À CÔTÉ du fichier
      // généré : deux textes pour la même URL, dont celui qu'on relit dépend de
      // l'ordre de copie. On refuse plutôt que de laisser coexister deux
      // déclarations — la source est la dérivation, pas un fichier à tenir à jour.
      const secondeDeclaration = publicDir ? path.join(publicDir, ROBOTS_TXT) : null
      if (secondeDeclaration && fs.existsSync(secondeDeclaration)) {
        throw new Error(
          `public/${ROBOTS_TXT} existe : c'est une SECONDE déclaration des routes privées, ` +
            'à côté de celle que ce plugin dérive du routage. Supprimer ce fichier : ' +
            `build/${ROBOTS_TXT} est écrit depuis scripts/check-spa-routes.js.`
        )
      }

      fs.writeFileSync(
        path.join(outDir, ROBOTS_TXT),
        robotsTxtFor(privateRoutes, siteOrigin),
        'utf8'
      )
    },
  }
}
