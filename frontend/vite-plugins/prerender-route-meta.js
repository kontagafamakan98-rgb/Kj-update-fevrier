// Émet un HTML pré-rendu par route (méta OG/Twitter/canonical + corps de la coquille).
//
// Ce fichier ne fait que COMPOSER : chaque concern vit dans son module de
// vite-plugins/prerender/ — les coquilles (shells-home.js, shells-routes.js),
// le refus d'une coquille incomplète (declared-body.js), le refus d'une
// coquille DÉSÉQUILIBRÉE (balises.js), les méta de route et les cartes OG
// (route-meta.js), le gabarit app.html (app-template.js) et la page 404
// (not-found.js).

import fs from 'node:fs'
import path from 'node:path'

import { buildHomeShell } from './prerender/shells-home.js'
// La photo de TÊTE du héros de l'accueil : son chemin est lu ici pour être
// PRÉCHARGÉ dans le `<head>` d'index.html (voir le commentaire de l'injection,
// plus bas). Le domicile unique de ces faits est src/config/photos-heros.js —
// jamais un littéral recopié dans index.html, qui ne suivrait pas un changement
// de photo et laisserait l'image LCP hors du chemin critique, en silence.
import { PHOTO_HEROS_SIZES, srcsetHeros } from '../src/config/photos-heros.js'
// La coupure du TITRE du héros : les deux rendus (coquille et page React) en
// dérivent la queue accentuée avec CETTE fonction, donc la condition
// « le titre se coupe » se lit avec elle aussi — une seconde règle de coupure
// ferait exiger l'accent d'un document que React ne l'aurait pas peint.
import { couperLeTitre } from '../src/config/page-sections.js'
import { buildRouteShells } from './prerender/shells-routes.js'
import { chromeDePage, piedDePage } from './prerender/app-chrome.js'
import { makeDeclaredBodyGuard } from './prerender/declared-body.js'
import { makeEquilibreGuard } from './prerender/balises.js'
import { makeWriteRouteText, applyOgCard, setMeta } from './prerender/route-meta.js'
import { buildAppTemplate, NOM_DU_GABARIT_APP } from './prerender/app-template.js'
import { buildNotFoundPage, NOM_DE_LA_PAGE_404 } from './prerender/not-found.js'
import { appliquerLaLangue } from './prerender/hreflang.js'
// Une langue INDEXÉE est un document : sa liste, ses préfixes d'URL et la forme
// des alternatives `hreflang` vivent dans src/config/langues-indexees.js, lue
// aussi par le routeur et le sitemap (cf. le fichier). Aucun de ces faits n'est
// recopié ici — ajouter une langue là-bas écrit ses documents, ou échoue.
import {
  LANGUES_INDEXEES,
  LANGUE_PAR_DEFAUT,
  cheminDansLaLangue,
  fichierDansLaLangue,
} from '../src/config/langues-indexees.js'
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
      // ── Données partagées avec l'application ────────────────────────
      // Contact (N.A.P.) et réseaux sociaux sont lus depuis les MÊMES
      // fichiers que le runtime React (src/config/) : le footer et le HTML
      // statique ne peuvent pas publier deux adresses différentes.
      const readJson = (relative) =>
        JSON.parse(fs.readFileSync(path.join(process.cwd(), relative), 'utf8'))
      const contact = readJson('src/config/contact.json')
      const socialNetworks = readJson('src/config/social-networks.json')
      // Une clé i18n absente doit CASSER le build : un shell amputé
      // (titre manquant, section vide) passerait sinon pour un succès et
      // viderait l'optimisation SEO sans que personne ne le voie. Le refus
      // nomme le DICTIONNAIRE lu, donc la langue fautive.
      const traducteur = (dictionnaire, fichier) => (key) => {
        const value = dictionnaire[key]
        if (typeof value !== 'string' || !value.trim()) {
          throw new Error(
            `prerender-route-meta : clé i18n « ${key} » absente de ${fichier} ` +
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
      const socialLinks = socialNetworks
        .map(({ label, env: envName }) => ({ label, url: String(env[envName] || '').trim() }))
        .filter((social) => /^https:\/\//.test(social.url))

      // La garde, le texte de route et les coquilles : composés à partir des
      // modules, jamais recopiés.
      // Le bouton Google n'existe que si le client_id est configuré AU BUILD :
      // `import.meta.env.VITE_GOOGLE_CLIENT_ID` est inliné par Vite, on lit donc
      // sa source ici — les deux canaux décident sur la même valeur.
      const googleAuth = Boolean(String(env.VITE_GOOGLE_CLIENT_ID || '').trim())
      // Le refus d'une coquille dont les BALISES ne se referment pas. Il est lu
      // par les deux canaux de lecture (ce plugin au build, les gardes de
      // scripts/), et il porte sur les DOUZE pages pré-rendues — pas seulement
      // sur l'accueil, où le défaut avait été trouvé le 27/09/2026 alors qu'il
      // était INVISIBLE à toutes les sondes de navigateur (le parseur répare).
      const exigerBalisesEquilibrees = makeEquilibreGuard({ origine: 'prerender-route-meta' })
      // ── UNE LANGUE INDEXÉE EST UN DOCUMENT (30/10/2026) ──────────────────
      // Le corps d'une coquille ne contient AUCUN texte en dur : il vient des
      // dictionnaires (`T` pour le global, les traducteurs de page pour
      // /register et /jobs). Construire la même coquille avec `en` en face de
      // `fr` publie donc une page réellement anglaise, sans une seconde écriture
      // du balisage — c'est ce qui rend la version anglaise tenable : une seule
      // déclaration de structure, deux lectures. Le refus de corps déclaré
      // (declared-body.js) s'applique à CHAQUE langue : une section oubliée en
      // anglais casse le build au lieu de publier une page amputée.
      const PAR_LANGUE = LANGUES_INDEXEES.map((langue) => {
        const fichier = `src/i18n/${langue.code}.json`
        const dictionnaire = readJson(fichier)
        const T = traducteur(dictionnaire, fichier)
        // Le traducteur de PAGE : même résolution que pageT() au runtime, même
        // repli global, dans la langue du document.
        const registerT = makeRegisterTranslator(langue.code, T)
        const jobsT = makeJobsTranslator(langue.code, T)
        // ── LES CONDITIONS DE BUILD, PAR LANGUE ────────────────────────────
        // `google-auth` est un drapeau (le client Google est-il configuré au
        // build ?) ; `titre-accent` est une DONNÉE (le titre du héros de CETTE
        // langue se coupe-t-il en deux ?). Les deux rendus peignent l'`<em
        // class="accent-heros">` sous cette seule condition, donc le refus de
        // corps déclaré doit la lire de la même façon — sinon il exige d'une
        // coquille wolof une classe que sa page ne peint pas (mesuré le
        // 01/11/2026 : aucune virgule dans les trois titres wolof, bambara et
        // mooré, la coupure n'a donc pas lieu).
        const titreHeros = dictionnaire[pageSections['/'].titleKey]
        const conditions = new Set([
          ...(googleAuth ? ['google-auth'] : []),
          ...(couperLeTitre(titreHeros)[1] ? ['titre-accent'] : []),
        ])
        const exigerCorpsDeclare = makeDeclaredBodyGuard({
          esc, T, registerT, jobsT, pageSections, pageSectionParts,
          conditions,
        })
        // Le PIED DE PAGE appartient au CHROME : React le rend après `</main>`
        // sur toutes les routes, donc les coquilles le publient de la même
        // façon — une fois pour toutes, depuis app-chrome.js (cf. le fichier :
        // sans lui, `main` se partage la hauteur sans le pied de page et les
        // pages centrées verticalement se décalent de 4 à 14 px au montage).
        const pied = piedDePage({ esc, T, socialLinks })
        const homeShell = buildHomeShell({ esc, T, contact, socialLinks, pageSections })
        const SHELLS = {
          home: homeShell,
          ...buildRouteShells({
            esc, T, registerT, jobsT, contact, pageSections,
            googleAuth,
          }),
        }
        return {
          langue,
          T,
          exigerCorpsDeclare,
          pied,
          homeShell,
          SHELLS,
          writeRouteText: makeWriteRouteText({ pageMeta, T }),
        }
      })
      // Le gabarit des routes privées et la 404 ne sont publiés qu'en français :
      // ils sont noindex (un gabarit nu, une page d'erreur), donc une seconde
      // langue n'y aurait aucun lecteur — et `app.html` sert DIX routes, il ne
      // peut pas déclarer la langue d'aucune.
      const FRANCAIS = PAR_LANGUE.find(({ langue }) => langue.code === LANGUE_PAR_DEFAUT)

      /**
       * Le fichier écrit pour une langue : `jobs.html` en français,
       * `en/jobs.html` en anglais, `index.html` / `en/index.html` pour l'accueil.
       */
      const fichierDuDocument = (code, routePath) =>
        fichierDansLaLangue(code, shellFileFor(routePath))
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
      for (const { langue, exigerCorpsDeclare, pied, SHELLS, writeRouteText } of PAR_LANGUE) {
        for (const routePath of Object.keys(pageMeta)) {
          if (routePath === '/') continue // index.html : la MÊME fonction, écrite plus bas
          const route = routePath.slice(1)
          // Le chemin PUBLIÉ de ce document : `/jobs` en français, `/en/jobs` en
          // anglais. C'est lui qui devient le canonical, l'`og:url` et l'entrée
          // `hreflang` — jamais le chemin de la route React.
          const chemin = cheminDansLaLangue(routePath, langue.code)
          const card = ogCards[routePath]
          if (!card) {
            throw new Error(
              `prerender-route-meta : la route pré-rendue « ${routePath} » a un titre/description ` +
                '(src/config/page-meta.js) mais aucune carte OG — la table des cartes en dérive ' +
                '(lighthouserc.cjs, DEPLOYMENT_PATHS). Ajouter la route là-bas (elle y est auditée ' +
                'par Lighthouse), ou retirer son texte.'
            )
          }
          // Méta de la route : texte, canonical, cartes OG, URLs. `routePath`
          // choisit les CLÉS du dictionnaire (`pageMeta`), `urlPath` l'URL que le
          // document annonce : deux rôles, donc deux paramètres — les confondre
          // ferait chercher `/en/jobs` dans une table qui ne connaît que `/jobs`.
          let out = applyOgCard({
            html, routePath, route, urlPath: chemin.slice(1), origin, card, writeRouteText, setMeta,
          })
          // Shell statique du LCP : injecté dans <div id="root"> (vide à
          // l'origine) — peint immédiatement, effacé au montage React.
          const shell = SHELLS[route] || ''
          exigerCorpsDeclare(routePath, route, shell)
          // Le CORPS d'abord (il appartient à shells-routes.js : le refus nomme le
          // module à corriger), puis le document ÉCRIT plus bas (une enveloppe de
          // chrome mal refermée est un défaut d'injection, pas de coquille).
          exigerBalisesEquilibrees(`le corps de la page ${chemin}`, shell)
          if (shell) {
            // Le corps est enveloppé dans le CHROME de l'app (navbar, `.App`,
            // `main.flex-1`) : les coquilles ne publiaient pas ces conteneurs,
            // donc l'héritage des styles du document divergeait de React (cf.
            // app-chrome.js — le `text-align` hérité déplaçait les bornes d'encre
            // du texte LCP et faisait ré-élire la peinture de React).
            out = out.replace('<div id="root"></div>', `<div id="root">${chromeDePage(shell, pied)}</div>`)
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
          // La LANGUE du document : `lang`, `og:locale`, canonical, et les
          // alternatives `hreflang` de SA famille (les mêmes dans les deux
          // langues, par construction).
          out = appliquerLaLangue(out, { chemin: routePath, code: langue.code, origine: origin })
          const fichier = fichierDuDocument(langue.code, routePath)
          exigerBalisesEquilibrees(`la coquille pré-rendue ${chemin} → ${fichier}`, out)
          fs.mkdirSync(path.dirname(path.join(outDir, fichier)), { recursive: true })
          fs.writeFileSync(path.join(outDir, fichier), out, 'utf8')
        }
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
      // (Le corps de l'accueil est VÉRIFIÉ dans la boucle des langues, plus bas :
      // il y a un document par langue indexée, et chacun passe les MÊMES refus.)
      // Même chrome que les routes (cf. app-chrome.js) : l'accueil ne peut pas
      // être la seule page dont la coquille hérite d'un autre alignement que
      // celui que React applique au même corps.
      // ── LE PRÉCHARGEMENT DE LA PHOTO DE TÊTE (07/10/2026) ──────────
      // L'`<img>` du héros est l'élément LCP de « / » (69 920 px², mesuré),
      // mais il se DÉCODE plus tard que le texte : le `<h1>` du héros se peint
      // dans une première trame et l'image dans la suivante. Chrome ré-élit
      // alors un élément LCP plus tardif — deux candidates au lieu d'une — et
      // toute la chaîne JavaScript entre dans le graphe LCP simulé de Lantern.
      // Mesuré (Chromium, 412×823, limitation du CPU par CDP) : à ×8 et ×15,
      // la navigation réelle sortait 2 candidates (`<h1>` puis `<img>`) ; avec
      // ce seul préchargement, elle en sort UNE, l'`<img>`, dès ×1.
      // Le préchargement démarre la requête pendant l'analyse du `<head>`,
      // donc bien avant que le corps — et son `<img>` — ne soit atteint :
      // l'image est en mémoire au premier paint, et les deux peintures tombent
      // dans la MÊME trame. Même mécanisme que les deux préchargements de
      // police d'index.html, et comme eux il est posé AVANT les liens du corps
      // pour ne pas être servi après eux.
      // ── ET DEPUIS LE 08/10/2026, IL PRÉCHARGE LA VARIANTE, PAS LE JPEG ────
      // La photo est publiée dans un `<picture>` (AVIF, WebP, puis JPEG) :
      // précharger le JPEG ferait télécharger un fichier que le navigateur ne
      // choisirait PAS, donc DEUX fichiers pour une seule photo. Le
      // préchargement est donc TYPÉ (`type="image/avif"`) et porte le MÊME
      // `srcset` que les `<source>` du corps, lu du même module : un navigateur
      // qui sait lire l'AVIF précharge exactement le candidat qu'il choisira
      // (même URL, une seule requête), et un navigateur qui ne le sait pas
      // IGNORE ce préchargement — puis découvre sa variante dans le corps, ce
      // qui est le comportement d'avant cette passe pour lui. Ce qu'on perd, et
      // c'est assumé : la priorité haute n'est donnée qu'aux navigateurs AVIF.
      const preloadPhoto =
        `<link rel="preload" as="image" type="image/avif" fetchpriority="high" imagesrcset="${esc(
          srcsetHeros(0, 'avif')
        )}" imagesizes="${esc(PHOTO_HEROS_SIZES)}">`
      const withPreload = html.replace('<head>', `<head>\n    ${preloadPhoto}`)
      if (withPreload === html) {
        throw new Error(
          'prerender-route-meta : <head> introuvable dans index.html — la photo de tête du héros ' +
            "n'est PAS préchargée, et l'élément LCP de « / » repasserait au JavaScript."
        )
      }
      // ── UN DOCUMENT PAR LANGUE, POUR « / » AUSSI ─────────────────────
      // L'accueil passe par le MÊME refus que les onze autres : il n'est pas
      // « déjà couvert » par le garde de scripts/check-home-shell.js, qui lit
      // l'artefact APRÈS le build — ici, la coquille déséquilibrée n'est pas
      // écrite du tout. Le préchargement de la photo est le même pour les deux
      // langues (même héros, même image).
      for (const { langue, exigerCorpsDeclare, pied, homeShell, writeRouteText } of PAR_LANGUE) {
        const chemin = cheminDansLaLangue('/', langue.code)
        exigerCorpsDeclare('/', 'home', homeShell)
        exigerBalisesEquilibrees("le corps de l'accueil (shells-home.js)", homeShell)
        const withHomeShell = withPreload.replace(
          '<div id="root"></div>',
          `<div id="root">${chromeDePage(homeShell, pied)}</div>`
        )
        if (withHomeShell === withPreload) {
          throw new Error(
            `prerender-route-meta : <div id="root"></div> introuvable dans index.html — shell accueil NON injecté (${langue.code})`
          )
        }
        const indexFinal = appliquerLaLangue(writeRouteText(withHomeShell, '/'), {
          chemin: '/',
          code: langue.code,
          origine: origin,
        })
        exigerBalisesEquilibrees(`la page pré-rendue ${chemin}`, indexFinal)
        // index.html porte le texte de « / » : même fonction que les sept
        // coquilles, donc les deux canaux ne peuvent pas diverger. La langue par
        // défaut garde SON fichier (le chemin lu dans le bundle), les autres
        // sont écrites sous leur préfixe.
        const destination =
          langue.code === LANGUE_PAR_DEFAUT
            ? indexPath
            : path.join(outDir, fichierDuDocument(langue.code, '/'))
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.writeFileSync(destination, indexFinal, 'utf8')
      }


      // Gabarit des routes privées (/dashboard, /profile…) : nu, non
      // indexable, sans canonical ni JSON-LD (buildAppTemplate le refuse).
      const appHtml = buildAppTemplate({ html, T: FRANCAIS.T, setMeta })
      // Les DEUX artefacts bâtis par ce plugin qui ne sont PAS des routes
      // passent le MÊME refus que les douze pages : ils étaient construits,
      // écrits, et lus par personne. C'est l'angle que ce contrôle ferme — un
      // document déséquilibré n'est PAS une erreur visible (le parseur le
      // RÉPARE), donc son défaut n'existe que pour qui LIT le fichier livré :
      // un crawler sans JavaScript, un lecteur d'accessibilité, l'extraction du
      // `#root`. Le gabarit app.html y est d'autant plus exposé qu'il est obtenu
      // par RETRAIT (canonical, JSON-LD, méta) : une expression régulière qui
      // emporte une ouvrante sans sa fermante suffit.
      exigerBalisesEquilibrees(`le gabarit des routes privées → ${NOM_DU_GABARIT_APP}`, appHtml)
      fs.writeFileSync(path.join(outDir, NOM_DU_GABARIT_APP), appHtml, 'utf8')

      // La 404 statique : servie par Vercel pour une URL sans rewrite.
      const notFoundPage = buildNotFoundPage({ T: FRANCAIS.T, contact })
      exigerBalisesEquilibrees(`la page 404 → ${NOM_DE_LA_PAGE_404}`, notFoundPage)
      fs.writeFileSync(path.join(outDir, NOM_DE_LA_PAGE_404), notFoundPage, 'utf8')
    },
  }
}
