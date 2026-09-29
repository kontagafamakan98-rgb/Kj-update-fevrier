import { test, expect } from '@playwright/test'
// Les deux règles, chacune chez elle : celle d'AVANT (aucun tiers, jamais) et
// celle d'APRÈS (seulement ce qui est autorisé, nommément). Les deux partagent
// `estTiers` et `nommerInitiateur`, donc elles ne peuvent pas diverger sur QUI
// est tiers.
import { divergencesDeTiers } from '../scripts/tiers-avant-interaction.js'
import {
  CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR,
  estRequeteDAPI,
  jugerApresInteraction,
} from '../scripts/tiers-apres-interaction.js'
// L'ADRESSE AUTORISÉE VIENT DE SON PROPRIÉTAIRE (`contact.json`) : elle n'est
// pas recopiée ici, sinon la sonde autoriserait une adresse que la page ne
// monte plus.
import { CONTACT } from '../src/config/contact.js'
import { MARQUEUR_DE_MONTAGE, TAILLES } from './helpers/geometrie.js'
import { CARTE_TIERS, LIBELLE, REPONSE_CARTE, ROUTES_A_FACADE } from './helpers/parcours-carte.js'
// L'écoute CDP et les attentes de journal sont PARTAGÉES avec la sonde d'avant.
import { attendreLaFinDuGeste, ecouterLesRequetes, laisserChargerSansAppuyer } from './helpers/requetes.js'

/**
 * TIERS CONTACTÉS APRÈS INTERACTION — LE SEUL QUI SORT EST CELUI QU'ON AUTORISE.
 *
 * ── Le complément, et l'inverse, de « aucun tiers avant interaction » ───────
 * `e2e/aucun-tiers-avant-interaction.spec.js` prouve un refus ABSOLU : sans le
 * moindre appui, aucune origine tierce n'est contactée, sur les douze routes
 * pré-rendues. Ce parcours-ci prouve la réciproque EXACTE, qui est une propriété
 * différente — et plus difficile : après un geste, tout ce qui sort de nos
 * origines doit être ce que la règle a DÉCLARÉ pour ce geste, adresse par
 * adresse, et rien d'autre.
 *
 * Pourquoi les deux sont nécessaires : « rien ne part » est vrai de n'importe
 * quelle page cassée. Une façade de carte qui ne monterait JAMAIS son iframe
 * passerait la sonde d'avant avec les honneurs, et l'utilisateur n'aurait pas de
 * carte. C'est ce trou-là que celle-ci ferme, et les deux verdicts sont relus
 * dans le MÊME cas (`ouvrir-la-carte`) : rien avant, l'adresse déclarée après.
 *
 * ── Ce que la sonde NOMME, et pourquoi c'est la moitié du travail ───────────
 * Chaque requête tierce rendue porte son ADRESSE, sa SORTE de ressource et son
 * INITIATEUR (`e2e/helpers/requetes.js` : l'initiateur ne se lit que par le
 * protocole, pas par `page.on('request')`). L'autorisée porte en plus son
 * PROPRIÉTAIRE DÉCLARÉ (`src/components/MapEmbed.js`), c'est-à-dire le code qui
 * a le droit de la demander. Un refus qui dit « une requête tierce » sans dire
 * d'où elle vient ni qui l'a lancée oblige à instrumenter à la main ; celui-ci
 * est directement réparable.
 *
 * ── Le protocole ────────────────────────────────────────────────────────────
 * L'écoute est branchée AVANT la navigation, le chargement est laissé aller sans
 * appui (règle d'avant, relue ici), puis le GESTE est exécuté sur la page réelle
 * — au doigt (`tap`) sur un profil tactile, à la souris sinon, parce que les
 * deux ne produisent pas la même séquence d'événements. Seul le journal PARTI
 * APRÈS le geste est jugé : c'est ce découpage qui permet de dire « ce tiers-là
 * est arrivé à cause de ce geste ».
 *
 * ── Le tiers est REMPLACÉ, jamais joint ─────────────────────────────────────
 * `page.route` sert une réponse minimale à la place de la carte : ce qui est
 * prouvé est que NOUS demandons la bonne adresse, au bon moment, et rien
 * d'autre — jamais que le tiers réponde. (L'effet de bord est heureux : la CI ne
 * dépend pas de Google, et ce que le tiers demanderait ensuite — ses tuiles, ses
 * polices — n'entre pas dans le journal. C'est une LIMITE, et elle est publiée
 * dans `CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR`.)
 *
 * ── Les cinq faits prouvés ──────────────────────────────────────────────────
 *   1. après l'appui sur la façade, la SEULE origine tierce est l'embed déclaré
 *      par `contact.json` — sur les deux routes qui la publient et aux deux
 *      tailles (le contrôle n'est pas le même au doigt et à la souris) ;
 *   2. l'autorisée est NOMMÉE (adresse, sorte, initiateur, propriétaire), et son
 *      initiateur n'est jamais « inconnu » — sans quoi la sonde ne prouverait
 *      pas qu'elle SAIT qui l'a lancée ;
 *   3. une recherche sur /jobs ne fait sortir AUCUN tiers, et la requête du
 *      geste — la nôtre, vers notre API — est nommée elle aussi (plancher de
 *      lecture : un journal vide rendrait « aucun tiers » vrai pour la mauvaise
 *      raison) ;
 *   4. un tiers DÉCLENCHÉ par le geste, que personne n'a autorisé, est refusé et
 *      nommé (preuve d'échec rejouée : la sonde n'est pas aveugle) ;
 *   5. une adresse du MÊME TYPE que l'autorisée, sur un autre hôte, est refusée
 *      elle aussi : l'autorisation est une adresse, pas une indulgence envers
 *      une famille d'hôtes ni envers « un fournisseur de carte ».
 *
 * ── La CSP contraint les mutations, et c'est un fait du site ────────────────
 * La coquille pose une CSP dont le `connect-src` n'autorise QUE nos origines et
 * `accounts.google.com` : un `fetch` vers un hôte non autorisé est BLOQUÉ PAR LE
 * NAVIGATEUR et ne produit AUCUNE requête — une mutation par `fetch` ne
 * prouverait donc rien (elle ne dirait pas si la sonde est aveugle ou si le
 * navigateur a refusé avant elle). Les deux preuves d'échec passent donc par les
 * canaux que la CSP ouvre pour de bon — `img-src` et `frame-src` : c'est
 * précisément par là qu'un vrai tiers arriverait, et c'est donc là qu'une sonde
 * doit savoir le voir. (Corollaire utile : la CSP est une TROISIÈME barrière,
 * statique, que ces cas éprouvent aussi par leur simple existence.)
 *
 * Rien de tout ceci n'est un budget de temps : le journal est attendu par sa
 * CONDITION de silence, jamais par une horloge (`e2e/helpers/attentes.js`).
 */

/** Le terme de recherche du geste d'API : assez distinctif pour être retrouvé. */
const TERME_DE_RECHERCHE = 'kojo-sonde-tiers'

/**
 * L'image tierce de la première preuve d'échec (interceptée, jamais jointe) :
 * une tuile de carte d'un AUTRE fournisseur, chargée à l'occasion du geste.
 * `img-src` la laisse passer (elle est dans la CSP) — c'est un tiers non
 * autorisé, donc un refus, et le cas est observable.
 */
const TUILE_NON_AUTORISEE = 'https://tile.openstreetmap.org/13/4093/2980.png'

/**
 * Le cadre de la seconde preuve : MÊME TYPE de ressource que l'autorisée (un
 * document de carte monté dans la page), autre hôte, autre adresse. `frame-src`
 * l'autorise.
 */
const CADRE_NON_AUTORISE = 'https://www.openstreetmap.org/export/embed.html?bbox=0%2C0%2C1%2C1'

/** Le corps servi à la place d'une image tierce (jamais joint). */
const REPONSE_IMAGE = { status: 200, contentType: 'image/png', body: '' }

/** Les URL d'un verdict, en clair, pour les messages d'échec. */
const nommer = (entrees) =>
  entrees.map((e) => `${e.url} (${e.sorte}) — lancée par ${e.initiateur}`).join(' ; ')

test.describe('Après interaction — le seul tiers est celui qui est autorisé', () => {
  for (const route of ROUTES_A_FACADE) {
    for (const { nom: taille, viewport } of TAILLES) {
      const tactile = taille === 'mobile'

      test(`${route} — ${taille} : après l’appui, la seule origine tierce est l’embed autorisé, et elle est nommée`, async ({
        browser,
      }) => {
        const page = await browser.newPage({ viewport, hasTouch: tactile, isMobile: tactile })
        try {
          const { requetes } = await ecouterLesRequetes(page)
          // Le tiers est remplacé POUR TOUT LE CAS : la sonde juge ce que NOUS
          // demandons, et la CI ne dépend jamais de Google.
          await page.route(CARTE_TIERS, (interceptee) =>
            interceptee.fulfill({
              status: 200,
              contentType: 'text/html; charset=utf-8',
              body: REPONSE_CARTE,
            })
          )

          await page.goto(route)
          await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 })
          await laisserChargerSansAppuyer(page, requetes)

          // ── Le verdict d'AVANT, relu ici : les deux règles se répondent ──
          expect(
            divergencesDeTiers(requetes, { origineDeLaPage: page.url() }),
            `${route} (${taille}) : une origine tierce est contactée AVANT le geste — c'est la règle ` +
              'd’avant-interaction qui rougit, et elle doit rester vraie.'
          ).toEqual([])

          // ── LE GESTE ───────────────────────────────────────────────────────
          const avant = requetes.length
          const controle = page.getByRole('link', { name: LIBELLE, exact: true })
          await expect(
            controle,
            `le contrôle « ${LIBELLE} » n’est pas publié sur ${route} : il n’y a aucun geste à mesurer.`
          ).toHaveCount(1)
          if (tactile) await controle.tap()
          else await controle.click()

          // La carte est montée ET son document est arrivé (une iframe vide ne
          // prouverait pas que la requête est partie).
          await expect(page.locator('iframe'), 'la carte n’est pas montée à l’appui').toHaveCount(1)
          await expect(page.frameLocator('iframe').getByText('carte de test')).toBeVisible()
          await attendreLaFinDuGeste(requetes)

          // ── Le verdict d'APRÈS, sur le SEUL journal du geste ──────────────
          const duGeste = requetes.slice(avant)
          expect(
            duGeste.length,
            `aucune requête journalisée après l’appui sur ${route} (${taille}) : l’écouteur ne lit rien, ` +
              'et un vert sans lecture est un faux vert.'
          ).toBeGreaterThan(0)

          const verdict = jugerApresInteraction(duGeste, {
            interaction: 'ouvrir-la-carte',
            origineDeLaPage: page.url(),
          })

          expect(
            nommer(verdict.refusees),
            `${route} (${taille}) : un tiers NON autorisé est parti après l’appui — seuls les adresses ` +
              'déclarées pour ce geste sont autorisées (scripts/tiers-apres-interaction.js).'
          ).toBe('')

          expect(
            verdict.autorisees,
            `${route} (${taille}) : la sonde n’a PAS vu l’embed autorisé — elle ne prouve alors rien ` +
              '(un tiers autorisé qui ne part jamais est un défaut, pas un vert).'
          ).toHaveLength(1)
          const autorisee = verdict.autorisees[0]
          expect(autorisee.url, 'l’adresse autorisée n’est pas celle que contact.json déclare').toBe(
            CONTACT.mapsEmbedUrl
          )
          expect(autorisee.proprietaire, 'l’autorisation ne nomme pas son propriétaire').toContain('MapEmbed')
          expect(
            autorisee.initiateur,
            'la requête autorisée n’est pas nommée par son initiateur : la sonde la refuse, mais elle ne ' +
              'sait pas dire qui l’a lancée.'
          ).not.toBe('initiateur inconnu')

          console.log(
            `ℹ️  Tiers après « ${verdict.geste} » sur ${route} (${taille}) : ${duGeste.length} requête(s) ` +
              `après l’appui, ${verdict.autorisees.length} tierce AUTORISÉE — ${nommer(verdict.autorisees)} ` +
              `[propriétaire déclaré : ${autorisee.proprietaire}] · 0 refus · ${verdict.notres.length} requête(s) ` +
              'chez nous (dont la carte servie par la sonde)'
          )
        } finally {
          await page.close()
        }
      })
    }
  }

  test('une recherche sur /jobs ne fait sortir AUCUN tiers, et la requête du geste est nommée', async ({
    page,
  }) => {
    const { requetes } = await ecouterLesRequetes(page)
    await page.goto('/jobs')
    await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 })
    await laisserChargerSansAppuyer(page, requetes)

    const avant = requetes.length
    await page.locator('#jobs-recherche').fill(TERME_DE_RECHERCHE)

    // PLANCHER DE LECTURE : la requête DU GESTE doit apparaître dans le journal
    // (et porter le terme écrit). Sans ce contrôle, « aucun tiers » serait vrai
    // pour la mauvaise raison — un journal vide, ou un geste qui n'a rien
    // déclenché.
    await expect
      .poll(() => requetes.slice(avant).filter((r) => r.url.includes(TERME_DE_RECHERCHE)).length, {
        timeout: 10000,
      })
      .toBeGreaterThan(0)
    await attendreLaFinDuGeste(requetes)

    const duGeste = requetes.slice(avant)
    const verdict = jugerApresInteraction(duGeste, {
      interaction: 'chercher-une-mission',
      origineDeLaPage: page.url(),
    })

    expect(
      nommer(verdict.refusees),
      'une recherche sur /jobs fait sortir une origine tierce : ce geste n’en autorise AUCUNE (le ' +
        'déclarant dit « autorisations : [] », c’est une affirmation, pas un oubli).'
    ).toBe('')

    const requeteDApi = verdict.notres.filter((r) => estRequeteDAPI(r.url) && r.url.includes(TERME_DE_RECHERCHE))
    expect(
      requeteDApi.length,
      'la requête du geste n’est pas identifiée comme la nôtre : la sonde ne prouve pas que l’appel ' +
        'est resté chez nous.'
    ).toBeGreaterThanOrEqual(1)
    expect(requeteDApi[0].initiateur, 'la requête d’API n’est pas nommée par son initiateur').not.toBe(
      'initiateur inconnu'
    )

    console.log(
      `ℹ️  Tiers après « ${verdict.geste} » sur /jobs : ${duGeste.length} requête(s) après la saisie, ` +
        `0 tierce (aucune n’est autorisée pour ce geste), la nôtre est nommée — ` +
        `${requeteDApi[0].url} (${requeteDApi[0].sorte}) — lancée par ${requeteDApi[0].initiateur} · ` +
        `${verdict.notres.length} requête(s) chez nous au total`
    )
  })

  test('preuve d’échec rejouée : un tiers déclenché PAR le geste est refusé et nommé', async ({ page }) => {
    // La requête ne sort PAS de la machine : `page.route` la remplace. Ce qui est
    // prouvé est que la sonde l'aurait vue ET nommée — un tiers qui part à
    // l'occasion d'un geste est exactement le défaut que cette sonde existe pour
    // attraper.
    //
    // L'ordre des routes compte : `CARTE_TIERS` couvre AUSSI les tuiles
    // OpenStreetMap, et Playwright fait gagner la DERNIÈRE route déclarée — la
    // tuile est donc enregistrée après, pour être servie par sa propre réponse.
    await page.route(CARTE_TIERS, (interceptee) =>
      interceptee.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: REPONSE_CARTE })
    )
    await page.route('https://tile.openstreetmap.org/**', (interceptee) =>
      interceptee.fulfill(REPONSE_IMAGE)
    )
    await page.addInitScript(
      (url) => {
        document.addEventListener(
          'click',
          () => {
            const image = new Image()
            image.src = url
          },
          { capture: true, once: true }
        )
      },
      TUILE_NON_AUTORISEE
    )

    const { requetes } = await ecouterLesRequetes(page)
    await page.goto('/contact')
    await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 })
    await laisserChargerSansAppuyer(page, requetes)

    const avant = requetes.length
    const controle = page.getByRole('link', { name: LIBELLE, exact: true })
    await controle.click()
    await expect(page.locator('iframe')).toHaveCount(1)
    await attendreLaFinDuGeste(requetes)

    const verdict = jugerApresInteraction(requetes.slice(avant), {
      interaction: 'ouvrir-la-carte',
      origineDeLaPage: page.url(),
    })

    expect(
      verdict.refusees.map((r) => r.url),
      'la sonde n’a PAS vu le tiers déclenché par le geste — elle est aveugle, et son vert ne vaut rien.'
    ).toContain(TUILE_NON_AUTORISEE)
    const refusee = verdict.refusees.find((r) => r.url === TUILE_NON_AUTORISEE)
    expect(refusee.initiateur, 'le refus n’est pas nommé par son initiateur').not.toBe('initiateur inconnu')
    // …et l'autorisée reste autorisée : le verdict ne mélange pas les deux.
    expect(verdict.autorisees.map((a) => a.url)).toContain(CONTACT.mapsEmbedUrl)

    console.log(`ℹ️  Preuve d’échec « tiers déclenché par le geste » : refus nommé — ${nommer([refusee])}`)
  })

  test('preuve d’échec rejouée : une autre adresse de carte est refusée, même par le même geste', async ({
    page,
  }) => {
    // L'autorisation porte sur l'ADRESSE déclarée, pas sur un fournisseur : un
    // SECOND cadre de carte, monté par le même geste, est donc un refus. Si ce
    // cas passait, la règle ne dirait plus ce qu'elle autorise — et « on a le
    // droit d'utiliser une carte » remplacerait « cette adresse-là, et pas une
    // autre ».
    await page.route(CARTE_TIERS, (interceptee) =>
      interceptee.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: REPONSE_CARTE,
      })
    )
    await page.addInitScript(
      (url) => {
        document.addEventListener(
          'click',
          () => {
            const cadre = document.createElement('iframe')
            cadre.src = url
            document.body.appendChild(cadre)
          },
          { capture: true, once: true }
        )
      },
      CADRE_NON_AUTORISE
    )

    const { requetes } = await ecouterLesRequetes(page)
    await page.goto('/contact')
    await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 })
    await laisserChargerSansAppuyer(page, requetes)

    const avant = requetes.length
    await page.getByRole('link', { name: LIBELLE, exact: true }).click()
    // On attend LA carte autorisée (et pas « un seul cadre ») : cette mutation
    // en ajoute un second, exprès — c'est tout son objet.
    await expect(page.locator(`iframe[src="${CONTACT.mapsEmbedUrl}"]`)).toHaveCount(1)
    await attendreLaFinDuGeste(requetes)

    const verdict = jugerApresInteraction(requetes.slice(avant), {
      interaction: 'ouvrir-la-carte',
      origineDeLaPage: page.url(),
    })
    expect(
      verdict.refusees.map((r) => r.url),
      'un SECOND cadre de carte, monté par le même geste, est passé : l’autorisation est devenue une ' +
        'indulgence envers un fournisseur, au lieu de porter sur l’adresse déclarée.'
    ).toContain(CADRE_NON_AUTORISE)
    expect(verdict.autorisees.map((a) => a.url)).toEqual([CONTACT.mapsEmbedUrl])

    console.log(
      `ℹ️  Preuve d’échec « autre adresse de carte » : l’adresse autorisée reste la seule acceptée ` +
        `(${CONTACT.mapsEmbedUrl}), et le second cadre est refusé — ${nommer(verdict.refusees)}`
    )
  })

  test('les limites de la sonde sont publiées, et le geste non déclaré fait lever la règle', async () => {
    // Une limite NON écrite est une confiance implicite. Celles-ci disent ce que
    // la sonde ne peut pas voir, et ce que ce vert ne couvre donc pas.
    expect(CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR.peutVoir.length).toBeGreaterThanOrEqual(3)
    expect(CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR.nePeutPasVoir.length).toBeGreaterThanOrEqual(4)
    expect(
      () => jugerApresInteraction([], { interaction: 'geste-inconnu' }),
      'un geste non déclaré doit FAIRE LEVER : on ne juge pas les droits d’un geste qu’on n’a pas écrits.'
    ).toThrow(/n’est pas déclaré/)
  })
})
