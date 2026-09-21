// Publie la RÉVISION du build dans le HTML statique (build seulement).

import { execFileSync } from 'node:child_process'

import { BUILD_REVISION_META } from '../scripts/site-meta.js'

/**
 * La révision du DÉPÔT dans lequel ce build tourne, si c'en est un.
 *
 * ── Pourquoi le dépôt, et pas seulement les variables ─────────────────────
 * Les variables système de Vercel (`VERCEL_GIT_COMMIT_SHA`) ne sont présentes
 * que si le projet les expose — c'est un RÉGLAGE du projet (« Automatically
 * expose System Environment Variables »), donc un fait d'exploitation qui peut
 * disparaître sans qu'aucune ligne du dépôt ne change. Le clone, lui, est
 * toujours là : Vercel exécute le build DANS un dépôt git (sa propre fonction
 * « Ignored Build Step » se sert de `git diff HEAD^ HEAD`). `git rev-parse HEAD`
 * est donc la source qui ne peut pas être éteinte par un réglage, et elle dit
 * exactement ce qu'on veut : le commit dont cet artefact est construit.
 *
 * Aucune exception ne sort : un build depuis une archive (pas de `.git`) rend
 * simplement '', et le garde de production refusera en nommant l'absence — au
 * lieu de comparer à une valeur inventée.
 *
 * @param {Function} [commande] Exécuteur injectable (tests).
 * @returns {string} Le SHA de HEAD, ou '' si le répertoire n'est pas un dépôt.
 */
export function revisionDuDepot(commande = execFileSync) {
  try {
    return String(
      commande('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    ).trim()
  } catch (_erreur) {
    return ''
  }
}

/**
 * La révision dont cet artefact est construit.
 *
 * ── Ordre des sources, et pourquoi ──────────────────────────────────────────
 *  1. `KOJO_GIT_SHA` : l'écrasement explicite, et le même nom de fait que côté
 *     backend (l'image Fly reçoit son SHA par `--build-arg KOJO_GIT_SHA`) ;
 *  2. `VERCEL_GIT_COMMIT_SHA`, puis `GITHUB_SHA` : les variables système, quand
 *     le projet les expose (voir `revisionDuDepot` pour ce qu'elles ont de
 *     fragile) — elles ont l'avantage de survivre à un build sans `.git` ;
 *  3. le dépôt lui-même (`git rev-parse HEAD`), qui ne dépend d'aucun réglage.
 *
 * Rien n'est inventé : sans variable ET hors dépôt git, la fonction rend '' et
 * le build n'annonce aucune révision.
 *
 * @param {Object<string, string>} [env] Environnement du build (vite loadEnv).
 * @param {object} [options]
 * @param {Function} [options.depot] Source « dépôt » injectable (tests).
 * @returns {string} La révision, ou '' si aucune source n'en donne.
 */
export function revisionFrom(env = {}, { depot = revisionDuDepot } = {}) {
  for (const source of ['KOJO_GIT_SHA', 'VERCEL_GIT_COMMIT_SHA', 'GITHUB_SHA']) {
    const valeur = String((env || {})[source] || '').trim()
    if (valeur) return valeur
  }
  return String(depot() || '').trim()
}

/**
 * Meta `kojo-build-revision` : ce que le déploiement de production annonce.
 *
 * ── Ce que ce plugin ferme ─────────────────────────────────────────────────
 * Le backend répond quelle révision il exécute (`/health`, champ `revision`) et
 * `deploy-fly` refuse quand la réponse n'est pas le commit attendu (F8). Le
 * frontend, lui, ne disait RIEN de ce qu'il était : « main est vert » ne
 * signifiait pas « le site servi est celui de ce commit », et un déploiement
 * Vercel échoué, en retard, ou jamais déclenché était indistinguable d'un
 * succès. Vercel ne fournit aucun marqueur lisible côté HTML, donc on l'écrit
 * au build — c'est le même choix que côté backend : la révision est une
 * propriété de l'ARTEFACT, pas du runtime, elle ne peut donc pas mentir sur ce
 * qui a été construit.
 *
 * Elle va dans le HTML STATIQUE (pas dans le bundle) pour la même raison que
 * les balises SEO : c'est ce qu'un client reçoit sans exécuter de JavaScript.
 *
 * @param {object} [options]
 * @param {Object<string, string>} [options.env] Environnement du build.
 * @param {Function} [options.depot] Source « dépôt » injectable (tests) : c'est
 *   par elle qu'on exerce le cas « aucune révision disponible » sans sortir du
 *   dépôt, où git en donne toujours une.
 * @returns {object} Plugin Vite.
 */
export function injectBuildRevisionPlugin({ env = {}, depot = revisionDuDepot } = {}) {
  return {
    name: 'inject-build-revision',
    apply: 'build',
    transformIndexHtml(html) {
      const revision = revisionFrom(env, { depot })
      if (!revision) return html
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { name: BUILD_REVISION_META, content: revision },
            injectTo: 'head',
          },
        ],
      }
    },
  }
}
