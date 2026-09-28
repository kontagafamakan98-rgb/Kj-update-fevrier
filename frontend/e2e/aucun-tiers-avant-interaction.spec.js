import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROUTES } from './helpers/geometrie.js'
// L'écoute CDP et les deux attentes de journal vivent dans le harnais partagé :
// la sonde INVERSE (`e2e/tiers-apres-interaction.spec.js`) a besoin exactement
// des mêmes, et deux copies divergeraient au premier correctif. Le pourquoi du
// protocole (l'initiateur, que `page.on('request')` ne porte pas dans cette
// version de Playwright) est écrit là-bas, une fois.
import { ecouterLesRequetes, laisserChargerSansAppuyer } from './helpers/requetes.js'
import { shellFileFor } from '../scripts/site-meta.js'
import {
  CE_QUE_LE_GARDE_STATIQUE_VOIT,
  ceQueLeGardeStatiqueVoit,
  divergencesDeTiers,
  estTiers,
} from '../scripts/tiers-avant-interaction.js'

/**
 * AUCUN TIERS CONTACTÉ AVANT TOUTE INTERACTION, sur les routes pré-rendues.
 *
 * ── Le fait observable, et ce qu'il ajoute au garde statique ────────────────
 * `scripts/check-shell-remote-resources.js` lit ce que la coquille DÉCLARE
 * (balises, CSS) : il voit une URL ÉCRITE, jamais une URL ASSEMBLÉE par du code
 * (`fetch('/api' + x)`, `new Image().src`, un script tiers injecté au montage).
 * Ce parcours-ci écoute ce que le navigateur DEMANDE vraiment, sans le moindre
 * appui : c'est le seul endroit où une requête construite à l'exécution devient
 * visible. (Une URL écrite EN CLAIR dans le code, elle, vit dans les fichiers
 * LIVRÉS : c'est `scripts/check-origines-bundles.js` qui la lit — un troisième
 * garde statique, qui voit l'origine écrite mais pas si elle part.) Les deux vues
 * ne se recouvrent pas — `CE_QUE_LE_GARDE_STATIQUE_VOIT`
 * dit ce que chacun ne peut pas voir, et le dernier cas les compare sur les
 * MÊMES documents servis.
 *
 * ── Le protocole ────────────────────────────────────────────────────────────
 * Une page NEUVE par route. On écoute AVANT `goto` (une preuve qui commence à
 * écouter après la première requête ne verrait pas le document lui-même), puis
 * on laisse partir le chargement — sans jamais appuyer, remplir ni défiler : ce
 * qui part ici part SANS qu'un utilisateur l'ait demandé. Sont NÔTRES l'origine
 * qui sert la page, les origines de `site-meta.js` et tout loopback
 * (`scripts/tiers-avant-interaction.js`) : c'est ce qui rend le refus réparable
 * — un tiers est un hôte qu'on n'exploite pas.
 *
 * ── Pourquoi le protocole, pas `page.on('request')` ─────────────────────────
 * Voir `e2e/helpers/requetes.js` : l'initiateur (la moitié utile d'un refus) ne
 * se lit que par `Network.requestWillBeSent` du CDP, et les deux sondes — celle
 * d'AVANT et celle d'APRÈS — partagent cette écoute.
 *
 * ── Les routes ──────────────────────────────────────────────────────────────
 * Dérivées de `src/config/page-meta.js` (comme le harnais de géométrie) : une
 * page pré-rendue ajoutée là est écoutée ici sans qu'on touche à ce fichier.
 * Elles étaient ONZE avant `/terms` ; elles sont DOUZE aujourd'hui.
 *
 * ── Le relevé, publié (26/09/2026) ──────────────────────────────────────────
 * 14 à 27 requêtes par route avant toute interaction, et DEUX origines
 * seulement : `http://127.0.0.1:4173` (la page et ses actifs) et
 * `http://127.0.0.1:8123` (l'API de test). Aucun tiers sur aucune des douze.
 * C'est ce que la sonde imprime à chaque case, et le plancher de lecture (8) est
 * posé SOUS le minimum mesuré (14) — assez haut pour attraper un écouteur à
 * moitié cassé, pas assez pour devenir une assertion de compte exact.
 */

/**
 * La coquille pré-rendue de l'accueil, lue depuis le disque pour la seconde
 * preuve d'échec (un tiers DÉCLARÉ dans le HTML servi — `build/index.html` n'est
 * jamais réécrit, la mutation est servie au vol).
 */
const COQUILLE_ACCUEIL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'build',
  'index.html'
)

test.describe('Aucun tiers contacté avant toute interaction', () => {
  for (const route of ROUTES) {
    test(`${route} — le premier écran ne contacte aucune origine tierce`, async ({ page }) => {
      const { requetes } = await ecouterLesRequetes(page)

      const reponse = await page.goto(route, { waitUntil: 'load' })
      expect(reponse?.status(), `${route} n'a servi aucune page (${shellFileFor(route)})`).toBe(200)

      await laisserChargerSansAppuyer(page, requetes)

      // Plancher de lecture : 14 mesurées au minimum le 26/09/2026, on exige 8.
      // Un écouteur cassé (0) ou à moitié branché passerait sinon pour un vert.
      expect(
        requetes.length,
        `${route} : trop peu de requêtes observées — l'écouteur ne lit pas ce qu'il prétend contrôler (un vert sans lecture est un faux vert)`
      ).toBeGreaterThanOrEqual(8)

      // Le relevé est PUBLIÉ, pas seulement jugé : un nombre et les origines
      // réellement contactées, pour qu'un vert soit lisible sans instrumenter.
      const origines = [
        ...new Set(
          requetes.map((r) => {
            try {
              return new URL(r.url).origin
            } catch (_erreur) {
              return '(relatif)'
            }
          })
        ),
      ].sort()
      console.log(`  ${route} : ${requetes.length} requête(s) avant interaction — ${origines.join(', ')}`)

      const divergences = divergencesDeTiers(requetes, { origineDeLaPage: page.url() })
      expect(
        divergences.map((d) => `${d.url} (${d.sorte}) — lancée par ${d.initiateur}`),
        `${route} : une origine tierce est contactée AVANT toute interaction`
      ).toEqual([])
    })
  }

  test('le garde statique et la sonde s’accordent sur la MÊME coquille, et se complètent', async ({
    request,
    baseURL,
  }) => {
    // 1) Les mêmes documents servis, lus par LE garde statique. Plancher de
    // lecture : sans lui, un lecteur cassé rendrait 0 et passerait pour vert.
    const declarees = []
    for (const route of ROUTES) {
      const reponse = await request.get(route)
      expect(reponse.status(), `${route} n'a pas servi ${shellFileFor(route)}`).toBe(200)
      const html = await reponse.text()
      for (const declaration of ceQueLeGardeStatiqueVoit(html)) {
        declarees.push({ route, ...declaration })
      }
    }
    console.log(
      `  garde statique : ${declarees.length} ressource(s) déclarée(s) lue(s) sur ${ROUTES.length} coquille(s)`
    )
    expect(
      declarees.length,
      'le lecteur de déclarations ne voit presque rien : il ne lit plus ce qu’il prétend contrôler'
    ).toBeGreaterThanOrEqual(100)

    // 2) Et AUCUNE de ces déclarations n'est tierce : les deux vues sont d'accord
    // sur les mêmes octets.
    const declareesTierces = declarees
      .filter((declaration) => estTiers(declaration.url, { origineDeLaPage: baseURL }))
      .map((declaration) => `${declaration.route} déclare <${declaration.balise}> ${declaration.url}`)
    expect(declareesTierces).toEqual([])

    // 3) La limite de l'un est l'apport de l'autre : une URL absente du HTML
    // publié n'existe dans aucun document, donc le garde statique ne peut pas la
    // voir — la sonde, elle, la refuse. C'est ce trou que ce parcours ferme, et
    // la liste des angles morts NOMME le garde statique qui la voit à sa place
    // (`check-origines-bundles.js`, qui lit les fichiers livrés).
    const anglesMorts = CE_QUE_LE_GARDE_STATIQUE_VOIT.nePeutPasVoir.join(' ')
    expect(anglesMorts).toMatch(/origines-bundles\.js/)
    expect(anglesMorts).toMatch(/HTML publié/)
    expect(estTiers('https://analytics.example/collect', { origineDeLaPage: baseURL })).toBe(true)
  })

  test('preuve d’échec rejouée : un tiers injecté AU CHARGEMENT est nommé, avec son initiateur', async ({
    page,
  }) => {
    // La mutation est interceptée (`page.route`) : la requête ne sort PAS de la
    // machine, elle prouve seulement que la sonde la verrait et la NOMMERAIT.
    await page.route('https://tiers.test/**', (route) => route.fulfill({ status: 200, body: '' }))
    await page.addInitScript(() => {
      fetch('https://tiers.test/pixel').catch(() => {})
    })

    const { requetes } = await ecouterLesRequetes(page)
    await page.goto('/', { waitUntil: 'load' })
    await laisserChargerSansAppuyer(page, requetes)

    const divergences = divergencesDeTiers(requetes, { origineDeLaPage: page.url() })
    const noms = divergences.map((d) => d.url)
    expect(noms, 'la sonde n’a PAS vu le tiers injecté — elle est aveugle').toContain(
      'https://tiers.test/pixel'
    )
    expect(divergences[0].initiateur).toBeTruthy()
    expect(divergences[0].initiateur).not.toBe('initiateur inconnu')
  })

  test('preuve d’échec rejouée : un tiers DÉCLARÉ par la coquille est nommé (initiateur analyseur HTML)', async ({
    page,
  }) => {
    // Le cas que le garde statique VOIT aussi : une balise déclarée au premier
    // écran. La mutation est servie AU VOL sur la réponse HTML — `build/index.html`
    // n'est jamais réécrit (même protocole que `style-layout-preuve-echec.spec.js`).
    const coquille = fs.readFileSync(COQUILLE_ACCUEIL, 'utf8')
    await page.route('https://tiers.test/**', (route) => route.fulfill({ status: 200, body: '' }))
    await page.route('http://127.0.0.1:4173/', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: coquille.replace(
          '</head>',
          '<script src="https://tiers.test/declare.js"></script></head>'
        ),
      })
    )

    const { requetes } = await ecouterLesRequetes(page)
    await page.goto('/', { waitUntil: 'load' })
    await laisserChargerSansAppuyer(page, requetes)

    const divergences = divergencesDeTiers(requetes, { origineDeLaPage: page.url() })
    const declaree = divergences.find((d) => d.url === 'https://tiers.test/declare.js')
    expect(declaree, 'la sonde n’a PAS vu le tiers DÉCLARÉ dans la coquille — elle est aveugle').toBeTruthy()
    // Et elle NOMME l’initiateur : ici l’analyseur HTML, pas un script.
    expect(declaree.initiateur).toContain('analyseur')
  })
})
