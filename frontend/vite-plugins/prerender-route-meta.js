// Émet un HTML pré-rendu par route (méta OG/Twitter/canonical + corps de la coquille).
//
// Ce fichier ne fait que COMPOSER : chaque concern vit dans son module de
// vite-plugins/prerender/ — les coquilles (shells-home.js, shells-routes.js),
// le refus d'une coquille incomplète (declared-body.js), les méta de route et
// les cartes OG (route-meta.js), le gabarit app.html (app-template.js) et la
// page 404 (not-found.js).

import fs from 'node:fs'
import path from 'node:path'

import { buildHomeShell } from './prerender/shells-home.js'
import { buildRouteShells } from './prerender/shells-routes.js'
import { makeDeclaredBodyGuard } from './prerender/declared-body.js'
import { makeWriteRouteText, applyOgCard, setMeta } from './prerender/route-meta.js'
import { buildAppTemplate } from './prerender/app-template.js'
import { buildNotFoundPage } from './prerender/not-found.js'
// Les dictionnaires de PAGE (scopes pack2) : ce sont EUX que lisent
// src/pages/Register.js et src/pages/Jobs.js (pageT), pas le dictionnaire
// global. Les coquilles pré-rendues publiaient les mêmes mots en littéral,
// donc corriger une traduction laissait l'autre canal derrière. Le même
// module est lu par le build et par scripts/check-prerender-shells.js,
// d'où les extensions explicites dans src/utils/pack2PageI18n/*.js.
import { makeScopedTranslator as makeRegisterTranslator } from '../src/utils/pack2PageI18n/register.js'
import { makeScopedTranslator as makeJobsTranslator } from '../src/utils/pack2PageI18n/jobs.js'

// NOTE : le pré-rendu des fiches /jobs/:id (og:image + titre réels de la
// mission, 404 noindex) est servi par le BACKEND
// (GET /api/og/jobs/{id} — kojo_routers_public.py) via le rewrite Vercel
// /jobs/(.*) → https://api.kojoforafrica.cc.cd/api/og/jobs/$1. L'ancienne
// fonction serverless api/og-jobs/[id].js a été abandonnée : Vercel ne
// collecte PAS le dossier api/ quand outputDirectory est défini
// (déploiement traité comme 100% statique) — la fonction n'était jamais
// déployée et /jobs/:id retombait sur le catch-all SPA.

export function prerenderRouteMetaPlugin({ ogCards, pageMeta, pageSections, pageSectionParts, siteOrigin, shellFileFor, env, mode }) {
  return {
    // Pré-rendu par route (crawlers sans JS) : pour les routes clés
    // (/jobs, /login), on émet un HTML statique par route (jobs.html,
    // login.html) qui porte les méta Open Graph/Twitter/canonical
    // CORRECTES pour cette route. Les bots de partage (Facebook,
    // LinkedIn, WhatsApp) ne lisent que le HTML servi, sans exécuter le
    // JS : sans ce pré-rendu ils verraient toujours la carte générique
    // de l'accueil. Vercel sert ces fichiers via des rewrites dédiés
    // (frontend/vercel.json) placés avant le catch-all SPA. Au runtime,
    // usePageOpenGraph ré-écrit les mêmes valeurs (cohérent).
    // Ce plugin s'exécute APRÈS inline-critical-css (ordre de
    // registration) : il copie donc le HTML final (CSS inliné + CSP).
    name: 'prerender-route-meta',
    apply: 'build',
    writeBundle(options, bundle) {
      const htmlKey = Object.keys(bundle).find((k) => k.endsWith('index.html'))
      if (!htmlKey) return
      const outDir = options.dir
      if (!outDir) return
      const indexPath = path.join(outDir, htmlKey)
      if (!fs.existsSync(indexPath)) return
      const html = fs.readFileSync(indexPath, 'utf8')

      // Origin du site (doit matcher og:url statique d'index.html).
      const origin = siteOrigin

      // Shell statique injecté dans <div id="root"> : réplique EXACTEMENT
      // le premier rendu de la page (placeholder navbar h-16 + header h1)
      // pour que le LCP (le titre) se peigne dès le premier paint HTML,
      // AVANT le boot de React. createRoot() efface ensuite ce contenu au
      // montage — comme le shell reproduit les mêmes classes/position, la
      // bascule est invisible (pas de flash, pas de CLS). Les classes
      // Tailwind sont déjà inlinées par inline-critical-css → le h1 est
      // stylé immédiatement.
      const frDate = new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(new Date())

      // ── Données partagées avec l'application ────────────────────────
      // Contact (N.A.P.) et réseaux sociaux sont lus depuis les MÊMES
      // fichiers que le runtime React (src/config/) : le footer et le HTML
      // statique ne peuvent pas publier deux adresses différentes.
      const readJson = (relative) =>
        JSON.parse(fs.readFileSync(path.join(process.cwd(), relative), 'utf8'))
      const contact = readJson('src/config/contact.json')
      const socialNetworks = readJson('src/config/social-networks.json')
      const siteFr = readJson('src/i18n/fr.json')

      // Une clé i18n absente doit CASSER le build : un shell amputé
      // (titre manquant, section vide) passerait sinon pour un succès et
      // viderait l'optimisation SEO sans que personne ne le voie.
      const T = (key) => {
        const value = siteFr[key]
        if (typeof value !== 'string' || !value.trim()) {
          throw new Error(
            `prerender-route-meta : clé i18n « ${key} » absente de src/i18n/fr.json ` +
              '(shells pré-rendus : texte de route ou accueil)'
          )
        }
        return value
      }
      const esc = (value) =>
        String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
      // Le français des dictionnaires de page : même résolution que pageT()
      // au runtime (la langue du build est le français), même repli global.
      const registerT = makeRegisterTranslator('fr', T)
      const jobsT = makeJobsTranslator('fr', T)

      const socialLinks = socialNetworks
        .map(({ label, env: envName }) => ({ label, url: String(env[envName] || '').trim() }))
        .filter((social) => /^https:\/\//.test(social.url))

      // La garde, le texte de route et les coquilles : composés à partir des
      // modules, jamais recopiés.
      const exigerCorpsDeclare = makeDeclaredBodyGuard({
        esc, T, registerT, jobsT, pageSections, pageSectionParts,
      })
      const writeRouteText = makeWriteRouteText({ pageMeta, T })
      const homeShell = buildHomeShell({ esc, T, contact, socialLinks, pageSections })
      const SHELLS = {
        home: homeShell,
        ...buildRouteShells({ esc, T, registerT, jobsT, contact, frDate, pageSections }),
      }
      // ── Preload du chunk lazy de chaque route ─────────────────────────
      // Le chunk de la page (Login/Jobs) ne se télécharge que quand
      // l'entrée exécute import() (waterfall réseau). En le préchargeant
      // via modulepreload dans le HTML pré-rendu (servi pour /login et
      // /jobs), le navigateur le télécharge EN PARALLÈLE de l'entrée →
      // le boot React (et la re-peinture identique du shell) arrive plus
      // tôt, réduisant le LCP simulé. modulepreload déclenche aussi le
      // fetch récursif des imports statiques du module — inutile (et
      // contre-productif : cela embarquerait tous les chunks) d'énumérer
      // la fermeture transitive ici.
      const PAGE_CHUNKS = {
        login: /[\\/]pages[\\/]Login\.js$/,
        jobs: /[\\/]pages[\\/]Jobs\.js$/,
        register: /[\\/]pages[\\/]Register\.js$/,
        'forgot-password': /[\\/]pages[\\/]ForgotPassword\.js$/,
        payment: /[\\/]pages[\\/]Payment\.js$/,
        'how-it-works': /[\\/]pages[\\/]HowItWorks\.js$/,
        support: /[\\/]pages[\\/]Support\.js$/,
      }
      const chunkFiles = {}
      for (const [file, info] of Object.entries(bundle)) {
        if (typeof info !== 'object' || info === null) continue
        const facade = info.facadeModuleId || info.name || ''
        for (const [route, re] of Object.entries(PAGE_CHUNKS)) {
          if (re.test(facade)) chunkFiles[route] = file
        }
      }
      // modulepreload déjà présents (deps statiques de l'entrée, émis par
      // Vite) — on n'ajoute que le chunk de la route lui-même.
      const existingPreloads = new Set(
        [...html.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1])
      )

      // ── Coquilles par route : la liste EST la table des textes ────────
      // Une route pré-rendue est une route qui publie un titre et une
      // description (src/config/page-meta.js). La carte de chaque page vient
      // des cartes DÉCLARÉES (scripts/og-cards/ → manifeste →
      // src/config/og-cards.js) : celle de sa route, sinon celle de la
      // racine — et une route du projet sans carte fait échouer le build
      // plutôt que de publier une coquille sans og:image.
      for (const routePath of Object.keys(pageMeta)) {
        if (routePath === '/') continue // index.html : le MÊME texte, écrit plus bas
        const route = routePath.slice(1)
        const card = ogCards[routePath]
        if (!card) {
          throw new Error(
            `prerender-route-meta : la route pré-rendue « ${routePath} » a un titre/description ` +
              '(src/config/page-meta.js) mais aucune carte OG — la table des cartes en dérive ' +
              '(lighthouserc.cjs, DEPLOYMENT_PATHS). Ajouter la route là-bas (elle y est auditée ' +
              'par Lighthouse), ou retirer son texte.'
          )
        }
        // Méta de la route : texte, canonical, cartes OG, URLs.
        let out = applyOgCard({ html, routePath, route, origin, card, writeRouteText, setMeta })
        // Shell statique du LCP : injecté dans <div id="root"> (vide à
        // l'origine) — peint immédiatement, effacé au montage React.
        const shell = SHELLS[route] || ''
        exigerCorpsDeclare(routePath, route, shell)
        if (shell) {
          out = out.replace('<div id="root"></div>', `<div id="root">${shell}</div>`)
        }
        // Preload du chunk lazy de la route, en parallèle de l'entrée →
        // boot React accéléré (modulepreload fetch aussi ses imports).
        const pageChunk = chunkFiles[route]
        if (pageChunk && !existingPreloads.has(`/${pageChunk}`)) {
          const link = `<link rel="modulepreload" crossorigin href="/${pageChunk}">`
          out = out.replace(
            '<meta charset="utf-8" />',
            `<meta charset="utf-8" />${link}`
          )
        }
        fs.writeFileSync(path.join(outDir, shellFileFor(routePath)), out, 'utf8')
      }

      // ── Shell de l'ACCUEIL dans index.html ─────────────────────────
      // index.html n'est plus servi que pour « / » : le catch-all SPA a
      // été retiré de frontend/vercel.json (les routes ont chacune leur
      // rewrite, et une URL inconnue doit répondre 404). Le shell de
      // l'accueil peut donc vivre dans index.html sans être peint à tort
      // sur /dashboard ou /profile — ce qui était la raison de garder
      // #root vide jusqu'ici.
      // Le corps de l'accueil est DÉCLARÉ comme celui des autres pages
      // (plan « / » de src/config/page-sections.js) : la garde s'applique
      // donc ici aussi. index.html est écrit à CET endroit, pas dans la
      // boucle des routes pré-rendues (qui écarte « / » pour cette raison) :
      // sans cet appel, l'accueil serait le seul corps non vérifié — et
      // c'est exactement par là que la dérive silencieuse rentrerait.
      exigerCorpsDeclare('/', 'home', homeShell)
      const withHomeShell = html.replace(
        '<div id="root"></div>',
        `<div id="root">${homeShell}</div>`
      )
      if (withHomeShell === html) {
        throw new Error(
          'prerender-route-meta : <div id="root"></div> introuvable dans index.html — shell accueil NON injecté'
        )
      }
      // index.html porte le texte de « / » : même fonction que les sept
      // coquilles, donc les deux canaux ne peuvent pas diverger.
      fs.writeFileSync(indexPath, writeRouteText(withHomeShell, '/'), 'utf8')


      // Gabarit des routes privées (/dashboard, /profile…) : nu, non
      // indexable, sans canonical ni JSON-LD (buildAppTemplate le refuse).
      const appHtml = buildAppTemplate({ html, T, setMeta })
      fs.writeFileSync(path.join(outDir, 'app.html'), appHtml, 'utf8')

      // La 404 statique : servie par Vercel pour une URL sans rewrite.
      const notFoundPage = buildNotFoundPage({ T, contact })
      fs.writeFileSync(path.join(outDir, '404.html'), notFoundPage, 'utf8')
    },
  }
}
