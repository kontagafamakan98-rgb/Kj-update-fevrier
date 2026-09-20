// Émet un HTML pré-rendu par route (méta OG/Twitter/canonical + corps de la coquille).

import fs from 'node:fs'
import path from 'node:path'

// Les pays couverts : la MÊME donnée que le bundle (src/components/CountryDisplay.js
// en dérive sa carte, src/pages/Home.js ses cartes) — ce module-là n'importe pas
// React, il est donc chargeable par Node.
import { COUNTRIES } from '../src/config/countries.js'

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

      const socialLinks = socialNetworks
        .map(({ label, env: envName }) => ({ label, url: String(env[envName] || '').trim() }))
        .filter((social) => /^https:\/\//.test(social.url))

      // ── Shell statique de l'ACCUEIL (index.html) ────────────────────
      // Mêmes sections et MÊMES classes que src/pages/Home.js, avec les
      // textes réels de src/i18n/fr.json : un crawler sans JavaScript voit
      // un titre h1, du contenu et des liens internes, et l'utilisateur
      // voit la page avant le boot de React (createRoot efface #root au
      // montage, les classes identiques rendent la bascule invisible).
      //
      // ⚠️ Les classes Tailwind utilisées ici doivent EXISTER ailleurs
      // dans les sources scannées (tailwind.config.cjs ne scanne pas ce
      // fichier) : elles sont donc copiées de Home.js / Support.js /
      // App.js, et check-home-shell.js échoue si l'une manque au CSS.
      //
      // Pays, catégories, promesses, étapes et chiffres ne sont plus
      // recopiés ici : la coquille lit les MÊMES listes que la page — les
      // pays dans src/config/countries.js, le reste dans la déclaration du
      // corps de l'accueil (src/config/page-sections.js, que lit
      // src/pages/Home.js). Ajouter un pays, une catégorie ou une promesse
      // laissait autrefois la coquille derrière, en silence.
      const homePlan = pageSections['/']

      const homeShell = [
        // Placeholder navbar (hauteur réelle) — comme les shells /jobs et
        // /login : le marqueur visuel est en place dès le premier paint.
        `<div class="h-16 bg-white border-b border-gray-200"></div>`,
        `<div class="min-h-screen">`,

        // Hero : le h1 est l'élément LCP de l'accueil.
        `<section class="bg-gradient-to-br from-orange-600 via-orange-700 to-red-600 text-white relative overflow-hidden">`,
        `<div class="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">`,
        `<div class="text-center">`,
        `<h1 class="text-3xl md:text-5xl lg:text-6xl font-bold mb-4 md:mb-6 leading-tight">${esc(T('heroTitle'))}</h1>`,
        `<p class="text-lg md:text-xl lg:text-2xl mb-8 opacity-90 max-w-3xl mx-auto">${esc(T('heroSubtitle'))}</p>`,
        `<div class="flex flex-col sm:flex-row gap-4 justify-center items-center">`,
        `<a href="/register" class="w-full sm:w-auto bg-white text-orange-600 hover:bg-gray-100 px-8 py-4 rounded-xl font-semibold text-lg shadow-lg transform transition hover:scale-105">${esc(T('getStarted'))}</a>`,
        `<a href="/jobs" class="w-full sm:w-auto border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-4 rounded-xl font-semibold text-lg transition">${esc(T('viewJobs'))}</a>`,
        `</div>`,
        `</div>`,
        `</div>`,
        `</section>`,

        // Pays couverts
        `<section class="py-12 md:py-16 bg-white">`,
        `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
        `<div class="text-center mb-12">`,
        `<h2 class="text-2xl md:text-3xl font-bold text-gray-900 mb-4">${esc(T('availableIn4Countries'))}</h2>`,
        `<p class="text-gray-600 max-w-2xl mx-auto">${esc(T('kojoConnectsDescription'))}</p>`,
        `</div>`,
        `<div class="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">`,
        ...COUNTRIES.map(
          (country) =>
            `<div class="${country.color} rounded-2xl p-6 text-center shadow-md">` +
            `<div class="flex justify-center mb-3">` +
            `<div class="w-14 h-10 md:w-20 md:h-14 rounded shadow-sm flex items-center justify-center text-3xl">${country.flag}</div>` +
            `</div>` +
            `<h3 class="font-semibold text-gray-900 text-sm md:text-base">${esc(country.name)}</h3>` +
            `<p class="text-xs text-gray-600 mt-1">${esc(T('servicesAvailable'))}</p>` +
            `</div>`
        ),
        `</div>`,
        `</div>`,
        `</section>`,

        // Catégories (liens INTERNES réels, avec le filtre de la liste)
        `<section class="py-12 md:py-16 bg-gray-50">`,
        `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
        `<div class="text-center mb-12">`,
        `<h2 class="text-2xl md:text-3xl font-bold text-gray-900 mb-4">${esc(T('popularServices'))}</h2>`,
        `<p class="text-gray-600">${esc(T('findServiceYouNeed'))}</p>`,
        `</div>`,
        `<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">`,
        ...homePlan.categories.map(
          (category) =>
            `<a href="/jobs?category=${category.labelKey}" class="bg-white rounded-2xl shadow-md p-6 text-center hover:shadow-lg transform transition hover:scale-105">` +
            `<div class="text-3xl md:text-4xl mb-3">${category.icon}</div>` +
            `<h3 class="font-medium text-gray-900 text-sm md:text-base">${esc(T(category.labelKey))}</h3>` +
            `</a>`
        ),
        `</div>`,
        `</div>`,
        `</section>`,

        // Trois promesses
        `<section class="py-12 md:py-16 bg-white">`,
        `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
        `<div class="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">`,
        ...homePlan.promises.map(
          ({ icon, titleKey, descriptionKey: textKey }) =>
            `<div class="text-center">` +
            `<div class="bg-orange-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"><span class="text-2xl">${icon}</span></div>` +
            `<h3 class="text-xl font-semibold mb-4 text-gray-900">${esc(T(titleKey))}</h3>` +
            `<p class="text-gray-600">${esc(T(textKey))}</p>` +
            `</div>`
        ),
        `</div>`,
        `</div>`,
        `</section>`,

        // Comment ça marche
        `<section class="py-12 md:py-16 bg-gray-50">`,
        `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
        `<div class="text-center mb-12">`,
        `<h2 class="text-2xl md:text-3xl font-bold text-gray-900 mb-4">${esc(T('howItWorksTitle'))}</h2>`,
        `<p class="text-gray-600 max-w-2xl mx-auto">${esc(T('homeHowItWorksSubtitle'))}</p>`,
        `</div>`,
        `<div class="grid grid-cols-1 md:grid-cols-3 gap-8">`,
        ...homePlan.steps.map(
          ({ icon, titleKey, descriptionKey: textKey }) =>
            `<div class="bg-white rounded-2xl shadow-md p-6 text-center">` +
            `<div class="bg-orange-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"><span class="text-2xl">${icon}</span></div>` +
            `<h3 class="text-lg font-semibold mb-2 text-gray-900">${esc(T(titleKey))}</h3>` +
            `<p class="text-gray-600 text-sm">${esc(T(textKey))}</p>` +
            `</div>`
        ),
        `</div>`,
        `</div>`,
        `</section>`,

        // Séquestre (confiance)
        `<section class="py-12 md:py-16 bg-white">`,
        `<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">`,
        `<div class="rounded-3xl border-2 border-emerald-200 bg-emerald-50 p-8 md:p-10">`,
        `<div class="flex flex-col md:flex-row items-center gap-6">`,
        `<div class="text-5xl">🛡️</div>`,
        `<div class="text-center md:text-left">`,
        `<h2 class="text-2xl md:text-3xl font-bold text-emerald-900 mb-3">${esc(T('escrowTrustTitle'))}</h2>`,
        `<p class="text-emerald-800">${esc(T('escrowTrustText'))}</p>`,
        `<p class="text-emerald-700 mt-3 text-sm">${esc(T('escrowTrustBullets'))}</p>`,
        `<a href="/how-it-works" class="mt-4 inline-block rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">${esc(T('learnMore'))}</a>`,
        `</div>`,
        `</div>`,
        `</div>`,
        `</div>`,
        `</section>`,

        // Appel à l'action
        `<section class="py-12 md:py-16 bg-gradient-to-r from-orange-600 to-red-600 text-white">`,
        `<div class="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">`,
        `<h2 class="text-2xl md:text-3xl lg:text-4xl font-bold mb-6">${esc(T('joinThousands'))}</h2>`,
        `<p class="text-lg md:text-xl mb-8 opacity-90">${esc(T('startConnectingToday'))}</p>`,
        `<div class="flex flex-col sm:flex-row gap-4 justify-center">`,
        `<a href="/register?type=client" class="bg-white text-orange-600 hover:bg-gray-100 px-8 py-4 rounded-xl font-semibold transform transition hover:scale-105">${esc(T('lookingForServices'))}</a>`,
        `<a href="/register?type=worker" class="border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-4 rounded-xl font-semibold transition">${esc(T('offerServices'))}</a>`,
        `</div>`,
        `</div>`,
        `</section>`,

        // Chiffres (valeurs de repli de Home.js avant /public/stats, pour
        // que le remplacement par React ne décale rien). Le texte publié
        // ici et le repli que lit Home.js sortent de la MÊME déclaration
        // (homePlan.stats) : une seule liste, deux rendus.
        `<section class="py-12 bg-gray-50">`,
        `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
        `<div class="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">`,
        ...homePlan.stats.map(
          ({ labelKey, shellText }) =>
            `<div>` +
            `<div class="text-3xl md:text-4xl font-bold text-orange-600 mb-2">${esc(shellText)}</div>` +
            `<div class="text-sm md:text-base text-gray-600">${esc(T(labelKey))}</div>` +
            `</div>`
        ),
        `</div>`,
        `</div>`,
        `</section>`,

        // Qui sommes-nous : le contenu de fond de l'accueil, ajouté après
        // un audit qui reprochait à la page ses 401 mots — un moteur n'y
        // trouvait pas de quoi comprendre QUI édite le site. Mêmes clés i18n
        // et mêmes classes que la section équivalente de src/pages/Home.js :
        // le crawler sans JavaScript et le navigateur lisent un seul texte.
        `<section class="py-12 md:py-16 bg-white">`,
        `<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">`,
        `<h2 class="text-2xl md:text-3xl font-bold text-gray-900 mb-4">${esc(T('homeAboutTitle'))}</h2>`,
        `<p class="text-gray-600 mb-4">${esc(T('homeAboutText1'))}</p>`,
        `<p class="text-gray-600">${esc(T('homeAboutText2'))}</p>`,
        `<p class="mt-6 text-sm">`,
        `<a href="/about" class="text-orange-600 underline underline-offset-2">${esc(T('aboutTitle'))}</a>`,
        ` · `,
        `<a href="/contact" class="text-orange-600 underline underline-offset-2">${esc(T('contactTitle'))}</a>`,
        ` · `,
        `<a href="/privacy" class="text-orange-600 underline underline-offset-2">${esc(T('privacyTitle'))}</a>`,
        `</p>`,
        `</div>`,
        `</section>`,

        // Contact (N.A.P. + liens cliquables) : section réelle, pas un
        // bloc caché — elle est aussi dans le footer React, donc elle
        // survit au montage.
        `<section class="py-12 md:py-16 bg-white">`,
        `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
        `<div class="text-center mb-12">`,
        `<h2 class="text-2xl md:text-3xl font-bold text-gray-900 mb-4">Nous contacter</h2>`,
        `<p class="text-gray-600 max-w-2xl mx-auto">L'équipe Kojo vous répond par téléphone, par e-mail ou sur WhatsApp, du lundi au samedi, pour toute question sur une mission, un paiement ou votre compte.</p>`,
        `</div>`,
        `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl mx-auto">`,
        `<a href="tel:${esc(contact.phone)}" class="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">`,
        `<span class="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-orange-600">📞</span>`,
        `<div><div class="text-sm font-semibold text-gray-900">Appeler le support</div><div class="text-xs text-gray-500">${esc(contact.phoneDisplay)}</div></div>`,
        `</a>`,
        `<a href="${esc(contact.whatsappUrl)}" target="_blank" rel="noreferrer" class="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">`,
        `<span class="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">💬</span>`,
        `<div><div class="text-sm font-semibold text-gray-900">WhatsApp</div><div class="text-xs text-gray-500">${esc(contact.phoneDisplay)}</div></div>`,
        `</a>`,
        `<a href="mailto:${esc(contact.email)}?subject=Contact%20KOJO" class="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">`,
        `<span class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">✉️</span>`,
        `<div><div class="text-sm font-semibold text-gray-900">Envoyer un e-mail</div><div class="text-xs text-gray-500 break-all">${esc(contact.email)}</div></div>`,
        `</a>`,
        `<a href="${esc(contact.mapsUrl)}" target="_blank" rel="noreferrer" class="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">`,
        `<span class="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600">📍</span>`,
        `<div><div class="text-sm font-semibold text-gray-900">Adresse</div><div class="text-xs text-gray-500">${esc(contact.address)}</div></div>`,
        `</a>`,
        `</div>`,
        // Bloc social : les MÊMES profils que le footer React et que le
        // `sameAs` du LocalBusiness — une seule source,
        // src/config/social-networks.json + VITE_SOCIAL_* (le tableau
        // `socialLinks` est celui du footer juste en dessous). Il est ici,
        // dans le corps de page, et pas seulement au pied de page : c'est
        // le corps qu'un audit « liens sociaux » lit, et un crawler sans
        // JavaScript n'a pas d'autre moyen de voir ces liens.
        ...(socialLinks.length
          ? [
              `<div class="mt-8 rounded-2xl border border-gray-200 bg-gray-50 p-6 text-center">`,
              `<h3 class="text-lg font-semibold text-gray-900 mb-3">Suivez-nous</h3>`,
              `<div class="flex flex-wrap items-center justify-center gap-4 text-sm text-orange-700">`,
              ...socialLinks.map(
                (social) =>
                  `<a href="${esc(social.url)}" target="_blank" rel="me noreferrer" class="font-medium hover:text-orange-800 underline underline-offset-2">${esc(social.label)}</a>`
              ),
              `</div>`,
              `</div>`,
            ]
          : []),
        // Carte intégrée (SEO local). loading=lazy : l'iframe ne concurrence
        // pas le LCP, et pour un utilisateur avec JavaScript elle est
        // remplacée par React avant même de se charger.
        `<iframe src="${esc(contact.mapsEmbedUrl)}" title="Carte — Kojo, ${esc(contact.address)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" class="mt-8 w-full rounded-xl border border-gray-200" style="height:320px;border:0;"></iframe>`,
        `</div>`,
        `</section>`,
        `</div>`,

        // Pied de page (mêmes liens que le footer React : légaux, contact,
        // supports sociaux déclarés).
        `<footer class="border-t border-orange-100 bg-white/95 backdrop-blur-sm">`,
        `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-3">`,
        `<address class="not-italic flex flex-wrap items-center justify-center md:justify-end gap-x-4 gap-y-2 text-xs text-gray-600">`,
        `<span>${esc(contact.address)}</span>`,
        `<a href="tel:${esc(contact.phone)}" class="hover:text-orange-700 underline underline-offset-2">${esc(contact.phoneDisplay)}</a>`,
        `<a href="mailto:${esc(contact.email)}" class="hover:text-orange-700 underline underline-offset-2 break-all">${esc(contact.email)}</a>`,
        `<a href="${esc(contact.whatsappUrl)}" target="_blank" rel="noreferrer" class="hover:text-orange-700 underline underline-offset-2">WhatsApp</a>`,
        `<a href="${esc(contact.mapsUrl)}" target="_blank" rel="noreferrer" class="hover:text-orange-700 underline underline-offset-2">Itinéraire</a>`,
        `</address>`,
        `<div class="flex flex-wrap items-center justify-center md:justify-end gap-4 text-sm text-orange-700">`,
        // Les trois pages de confiance, liées depuis le corps de page :
        // c'est par ces liens qu'un crawler sans JavaScript les DÉCOUVRE.
        `<a href="/about" class="hover:text-orange-800 underline underline-offset-2">${esc(T('aboutTitle'))}</a>`,
        `<a href="/contact" class="hover:text-orange-800 underline underline-offset-2">${esc(T('contactTitle'))}</a>`,
        `<a href="/privacy" class="hover:text-orange-800 underline underline-offset-2">${esc(T('privacyTitle'))}</a>`,
        `<a href="/legal/kojo_politique_confidentialite_et_cgu_fusionnees.docx" target="_blank" rel="noreferrer" class="hover:text-orange-800 underline underline-offset-2">Conditions d'utilisation</a>`,
        ...socialLinks.map(
          (social) =>
            `<a href="${esc(social.url)}" target="_blank" rel="me noreferrer" class="hover:text-orange-800 underline underline-offset-2">${esc(social.label)}</a>`
        ),
        `</div>`,
        `</div>`,
        `</footer>`,
      ].join('')

      // ── Le corps des pages de confiance est DÉCLARÉ, pas recopié ────
      // src/config/page-sections.js est lu par les pages React ET par ici :
      // la liste des promesses d'À propos, celle des sections de la page
      // Confidentialité et celle des moyens de contact n'existent qu'à un
      // seul endroit. Les clés i18n restent la source du TEXTE (T() plus
      // haut casse le build si une clé manque) ; ce que le build refuse
      // désormais, c'est une coquille qui ne porte pas tout ce que la page
      // déclare (voir exigerCorpsDeclare).
      const aboutPlan = pageSections['/about']
      const contactPlan = pageSections['/contact']
      const privacyPlan = pageSections['/privacy']
      const supportPlan = pageSections['/support']
      const howItWorksPlan = pageSections['/how-it-works']

      // Le paragraphe de liens internes en fin de page : même balisage pour
      // chaque coquille, seul l'habillage du paragraphe change.
      const liensDePage = (plan, classes) =>
        `<p class="${classes}">` +
        plan.links
          .map(
            ({ to, labelKey }) =>
              `<a href="${to}" class="text-orange-600 underline underline-offset-2">${esc(T(labelKey))}</a>`
          )
          .join(' · ') +
        `</p>`

      // Refuse une coquille qui ne porte pas tout ce que sa page déclare.
      // Sans ce refus, une section ajoutée à la page React ne paraîtrait que
      // pour un navigateur, et un crawler sans JavaScript lirait une page
      // amputée — le défaut exact que la déclaration unique supprime.
      // Les textes attendus se DÉDUISENT du plan (pageSectionParts) : aucune
      // seconde liste n'est tenue ici.
      const exigerCorpsDeclare = (routePath, route, corps) => {
        const plan = pageSections[routePath]
        if (!plan) return
        if (!corps) {
          throw new Error(
            `prerender-shells : ${routePath} déclare son corps (src/config/page-sections.js) mais sa coquille est VIDE ` +
              `(SHELLS['${route}']) — un crawler sans JavaScript ne lirait rien de cette page.`
          )
        }
        const { cles, textes } = pageSectionParts(plan)
        const attendus = [...cles.map((key) => T(key)), ...textes]
        const manquants = attendus.filter((texte) => !corps.includes(esc(texte)))
        if (manquants.length) {
          throw new Error(
            `prerender-shells : la coquille ${routePath} ne porte pas ${manquants.length} élément(s) déclaré(s) par sa page ` +
              `— « ${manquants[0]} » manque. Le corps d'une page a UN propriétaire (src/config/page-sections.js) : ` +
              'la coquille s\'en dérive, elle ne peut pas le recopier.'
          )
        }
      }

      const SHELLS = {
        home: homeShell,
        jobs: `<div class="h-16 bg-white border-b border-gray-200"></div>`
          + `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">`
          + `<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">`
          + `<div>`
          + `<h1 class="text-3xl font-bold text-gray-900">Emplois disponibles</h1>`
          + `<p class="mt-2 text-gray-600">${frDate}</p>`
          + `</div></div></div>`,
        // Login : réplique la PAGE COMPLÈTE (h2 + formulaire : email,
        // mot de passe, bouton Connexion, Google, mention légale, lien
        // inscription) avec les MÊMES classes que le composant réel — le
        // contenu est centré verticalement (items-center), donc une hauteur
        // statique différente décalerait tout le bloc au montage React
        // (CLS). La bascule est invisible : createRoot efface #root et
        // rend la même structure.
        login: `<div class="h-16 bg-white border-b border-gray-200"></div>`
          + `<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">`
          + `<div class="max-w-md w-full space-y-8">`
          + `<div>`
          + `<div class="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-orange-600">`
          + `<span class="text-white text-xl font-bold">K</span>`
          + `</div>`
          + `<h1 class="mt-6 text-center text-3xl font-extrabold text-gray-900">Connexion</h1>`
          + `</div>`
          + `<form class="mt-8 space-y-6">`
          + `<div class="space-y-4">`
          + `<div>`
          + `<label for="email" class="block text-sm font-medium text-gray-700">E-mail</label>`
          + `<input id="email" name="email" type="email" autocomplete="email" readonly placeholder="E-mail" class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md sm:text-sm" />`
          + `</div>`
          + `<div>`
          + `<div class="flex items-center justify-between">`
          + `<label for="password" class="block text-sm font-medium text-gray-700">Mot de passe</label>`
          + `<span class="text-sm font-medium text-orange-600">Mot de passe oublié ?</span>`
          + `</div>`
          + `<div class="relative mt-1">`
          + `<input id="password" name="password" type="password" autocomplete="current-password" readonly placeholder="Mot de passe" class="appearance-none relative block w-full px-3 py-2 pr-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md sm:text-sm" />`
          + `</div>`
          + `</div>`
          + `</div>`
          + `<div>`
          + `<div class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-orange-600">Connexion</div>`
          + `</div>`
          + `<div class="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-gray-300 rounded-md bg-white text-gray-700 text-sm font-medium">Continuer avec Google</div>`
          + `<div class="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-2">`
          + `<p class="text-sm font-semibold text-orange-900">📜 Informations légales</p>`
          + `<span class="inline-flex items-center text-sm font-medium text-orange-700 underline">Lire la politique de confidentialité</span>`
          + `<p class="text-xs text-gray-600">Contact KOJO : +18193003507 · Email : Kojoapp98@gmail.com · Adresse : Hamdallaye Aci 2000 Bamako Mali</p>`
          + `</div>`
          + `<div class="text-center">`
          + `<span class="text-sm text-gray-600">Pas de compte ? <span class="font-medium text-orange-600">Inscription</span></span>`
          + `</div>`
          + `</form>`
          + `</div></div>`,
        // Register : réplique la PAGE COMPLÈTE (mode client par défaut —
        // ce que voit un visiteur sans ?ref/type) avec les MÊMES classes
        // et les MÊMES états initiaux (détection géo + langue en cours,
        // photo absente) que le composant réel. Le contenu est centré
        // verticalement (items-center) : une hauteur statique différente
        // décalerait tout le bloc au montage React (CLS) — d'où la
        // réplique intégrale (formulaire de ~1800px). Les inputs sont
        // readonly (inertes jusqu'au boot), libellés en français
        // (cohérents avec t()).
        register: `<div class="h-16 bg-white border-b border-gray-200"></div>`
          + `<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">`
          + `<div class="max-w-md w-full space-y-8">`
          + `<div class="text-center mb-8">`
          + `<div class="mx-auto h-16 w-16 bg-orange-600 rounded-full flex items-center justify-center shadow-lg">`
          + `<span class="text-white text-2xl font-bold">K</span>`
          + `</div>`
          + `<h1 class="mt-6 text-center text-3xl font-bold text-gray-900">Créer un compte</h1>`
          + `<p class="mt-2 text-sm text-gray-600">Rejoignez la communauté Kojo</p>`
          + `<div class="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">`
          + `<div class="flex items-center justify-center py-2">`
          + `<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>`
          + `<span class="text-xs text-blue-700">Détection de votre position...</span>`
          + `</div>`
          + `<div class="flex items-center gap-3 overflow-x-auto pb-1 text-xs sm:text-sm sm:justify-center sm:space-x-4">`
          + `<div class="flex items-center">`
          + `<div class="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-medium">1</div>`
          + `<span class="ml-2 text-orange-600 font-medium whitespace-nowrap">Informations personnelles</span>`
          + `</div>`
          + `<div class="w-12 h-1 bg-gray-200"></div>`
          + `<div class="flex items-center">`
          + `<div class="w-6 h-6 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-xs font-medium">2</div>`
          + `<span class="ml-2 text-gray-500 font-medium whitespace-nowrap">Vérification email</span>`
          + `</div>`
          + `<div class="w-12 h-1 bg-gray-200"></div>`
          + `<div class="flex items-center">`
          + `<div class="w-6 h-6 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-xs font-medium">3</div>`
          + `<span class="ml-2 text-gray-500 font-medium whitespace-nowrap">Paiement</span>`
          + `</div>`
          + `</div>`
          + `<p class="text-xs text-blue-700 mt-3">⚠️ Étape suivante : vérifie d'abord ton email, puis tu ajouteras ton moyen de paiement pour régler tes jobs.</p>`
          + `</div>`
          + `</div>`
          + `<form class="mt-8 space-y-6 bg-white p-4 sm:p-8 rounded-xl shadow-md">`
          + `<div class="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-700 text-sm font-medium">S'inscrire avec Google</div>`
          + `<div class="relative">`
          + `<div class="absolute inset-0 flex items-center"><div class="w-full border-t border-gray-200"></div></div>`
          + `<div class="relative flex justify-center text-sm"><span class="bg-white px-3 text-gray-400">ou</span></div>`
          + `</div>`
          + `<fieldset>`
          + `<legend class="block text-sm font-medium text-gray-700 mb-3">Type d'utilisateur</legend>`
          + `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">`
          + `<div class="relative flex items-center justify-center p-4 border-2 border-orange-500 bg-orange-50 rounded-lg">`
          + `<div class="text-center"><div class="text-2xl mb-2">👤</div><span class="text-sm font-medium text-gray-700">Client</span><p class="text-xs text-gray-500 mt-1">Je cherche des services</p></div>`
          + `</div>`
          + `<div class="relative flex items-center justify-center p-4 border-2 border-gray-300 rounded-lg">`
          + `<div class="text-center"><div class="text-2xl mb-2">🔧</div><span class="text-sm font-medium text-gray-700">Travailleur</span><p class="text-xs text-gray-500 mt-1">Je propose mes services</p></div>`
          + `</div>`
          + `</div>`
          + `</fieldset>`
          + `<div>`
          + `<label class="block text-sm font-medium text-gray-700 mb-2">Pays</label>`
          + `<select readonly class="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-gray-50 text-gray-400">Détection...</select>`
          + `</div>`
          + `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">`
          + `<div><label class="block text-sm font-medium text-gray-700 mb-2">Prénom</label><input readonly placeholder="Prénom..." class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /></div>`
          + `<div><label class="block text-sm font-medium text-gray-700 mb-2">Nom</label><input readonly placeholder="Nom..." class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /></div>`
          + `</div>`
          + `<div><label class="block text-sm font-medium text-gray-700 mb-2">E-mail</label><input readonly type="email" placeholder="exemple@email.com" class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /></div>`
          + `<div>`
          + `<label class="block text-sm font-medium text-gray-700 mb-2">Téléphone</label>`
          + `<div class="flex rounded-lg shadow-sm">`
          + `<span class="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">---</span>`
          + `<input readonly placeholder="--- XX XXX XX XX" class="flex-1 block w-full px-4 py-3 border border-gray-300 rounded-r-lg" />`
          + `</div>`
          + `<p class="mt-1 text-sm text-gray-500">Format téléphone: --- XX XXX XX XX</p>`
          + `</div>`
          + `<div><label class="block text-sm font-medium text-gray-700 mb-2">Mot de passe</label><input readonly type="password" class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /><p class="mt-1 text-xs text-gray-500">Le mot de passe doit contenir au moins 8 caractères</p></div>`
          + `<div><label class="block text-sm font-medium text-gray-700 mb-2">Confirmer le mot de passe</label><input readonly type="password" class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /></div>`
          + `<div class="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6">`
          + `<div class="flex items-center mb-4"><span class="text-2xl mr-3">📸</span><h3 class="text-lg font-semibold text-gray-900">Photo de Profil (Optionnel)</h3></div>`
          + `<p class="text-sm text-gray-600 mb-4">Une photo de profil aide à personnaliser votre expérience sur Kojo</p>`
          + `<div class="relative border-2 border-dashed rounded-lg p-6 border-gray-300">`
          + `<div class="text-center"><div class="text-4xl mb-3">📸</div><div class="text-sm text-gray-600"><p class="font-medium">Ajouter une photo de profil</p><p>Cliquez pour choisir une option</p></div><div class="text-xs text-gray-500 mt-2">JPG, PNG jusqu'à 5MB</div></div>`
          + `</div>`
          + `</div>`
          + `<div class="bg-gray-50 border border-gray-200 rounded-lg p-6">`
          + `<div class="flex items-center justify-center">`
          + `<div class="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-500 mr-3"></div>`
          + `<span class="text-gray-600">Détection de votre langue préférée...</span>`
          + `</div>`
          + `</div>`
          + `<div class="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">`
          + `<div><h3 class="text-sm font-semibold text-orange-900">📜 Informations légales</h3><p class="text-xs text-orange-800 mt-1">Pour créer un compte, vous devez accepter la Politique de confidentialité et les conditions d'utilisation.</p></div>`
          + `<span class="inline-flex items-center text-sm font-medium text-orange-700 underline">Lire la politique de confidentialité</span>`
          + `<label class="flex items-start gap-3 cursor-pointer"><input type="checkbox" readonly class="mt-1 h-4 w-4 rounded border-gray-300 text-orange-600" /><span class="text-sm text-gray-700">J'ai lu et j'accepte la Politique de confidentialité et les conditions d'utilisation de KOJO avant de créer mon compte.</span></label>`
          + `<p class="text-xs text-gray-600">Contact KOJO : +18193003507 · Email : Kojoapp98@gmail.com · Adresse : Hamdallaye Aci 2000 Bamako Mali</p>`
          + `</div>`
          + `<div><div class="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-orange-600">Continuer vers la vérification email</div></div>`
          + `<div class="text-center"><span class="text-sm text-gray-600">Vous avez déjà un compte ? <span class="font-medium text-orange-600">Se connecter</span></span></div>`
          + `</form>`
          + `</div></div>`,
        // ForgotPassword : réplique l'ÉTAPE EMAIL (par défaut) — la page
        // est centrée verticalement (items-center), donc une hauteur
        // statique différente décalerait tout le bloc au montage React
        // (CLS). Mêmes classes que le composant réel (thème BLEU),
        // inputs readonly (inertes jusqu'au boot), libellés français.
        'forgot-password': `<div class="h-16 bg-white border-b border-gray-200"></div>`
          + `<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">`
          + `<div class="max-w-md w-full space-y-8">`
          + `<div class="text-center">`
          + `<div class="mx-auto h-14 w-14 flex items-center justify-center rounded-full bg-blue-600 shadow-lg">`
          + `<span class="text-white text-2xl font-bold">✉️</span>`
          + `</div>`
          + `<h1 class="mt-6 text-3xl font-extrabold text-gray-900">Mot de passe oublié</h1>`
          + `<p class="mt-3 text-sm text-gray-600">Recevez un code par email pour sécuriser votre compte et définir un nouveau mot de passe.</p>`
          + `</div>`
          + `<div class="bg-white rounded-2xl shadow-md p-6 space-y-6">`
          + `<div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500">`
          + `<span class="text-blue-600">1. Email</span>`
          + `<span class="text-gray-500">2. Code</span>`
          + `<span class="text-gray-500">3. Nouveau mot de passe</span>`
          + `</div>`
          + `<form class="space-y-5">`
          + `<div>`
          + `<label for="reset-email" class="block text-sm font-medium text-gray-700">Adresse email</label>`
          + `<input id="reset-email" type="email" autocomplete="email" readonly class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500" placeholder="E-mail" />`
          + `</div>`
          + `<p class="text-xs text-gray-500">Si cette adresse email existe, un code de réinitialisation a été envoyé.</p>`
          + `<div class="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Envoyer le code</div>`
          + `</form>`
          + `<div class="text-center">`
          + `<span class="text-sm font-medium text-orange-600 hover:text-orange-500">Retour à la connexion</span>`
          + `</div>`
          + `</div>`
          + `</div></div>`,
        // Payment : page PROTÉGÉE (ProtectedRoute montre un spinner pendant
        // la résolution d'auth, puis la page). Le shell réplique l'ÉTAT
        // PAR DÉFAUT (aucun contexte de mission dans l'URL) : carte titre
        // (h1 = LCP) + carte « mission requise ». Contenu top-aligned (pas
        // de centrage vertical) → pas de décalage au montage React ; les
        // états dynamiques (skeleton de chargement, répartition, paiements)
        // apparaissent après le boot comme sur la page réelle.
        payment: `<div class="h-16 bg-white border-b border-gray-200"></div>`
          + `<div class="min-h-screen bg-gray-50 py-8">`
          + `<div class="max-w-6xl mx-auto px-4 space-y-6">`
          + `<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">`
          + `<h1 class="text-3xl font-bold text-gray-900 mb-2">KOJO Paiements réels</h1>`
          + `<p class="text-gray-600">Payez en toute sécurité par Orange Money, Wave ou carte bancaire.</p>`
          + `</div>`
          + `<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">`
          + `<div class="text-4xl mb-3">💼</div>`
          + `<h2 class="text-xl font-semibold text-gray-900 mb-2">Un paiement doit être rattaché à une mission</h2>`
          + `<p class="text-gray-600 max-w-lg mx-auto mb-5">Les paiements libres ne sont plus possibles : ouvrez une mission depuis la liste des emplois pour la payer en toute sécurité (fonds bloqués jusqu'à la livraison).</p>`
          + `<div class="inline-flex items-center rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white">Voir les missions disponibles</div>`
          + `</div>`
          + `</div></div>`,
        // HowItWorks : page PUBLIQUE de contenu, servie jusqu'ici par
        // app.html — le gabarit NU (titre « Kojo », aucun h1, aucun
        // canonical, 1 mot). Un crawler sans JavaScript n'y voyait donc
        // RIEN, alors que la page explique le fonctionnement, le séquestre
        // et répond aux questions fréquentes (matière à extraits
        // enrichis). Le shell réplique les sections de
        // src/pages/HowItWorks.js, avec les textes réels de fr.json (T()),
        // dans le même ordre et les mêmes classes : la bascule au montage
        // React est invisible.
        'how-it-works': `<div class="h-16 bg-white border-b border-gray-200"></div>`
          + `<section class="bg-gradient-to-br from-orange-600 via-orange-700 to-red-600 text-white">`
          + `<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16 text-center">`
          + `<h1 class="text-3xl md:text-4xl font-bold mb-4">${esc(T('howItWorksTitle'))}</h1>`
          + `<p class="text-lg opacity-90 max-w-2xl mx-auto">${esc(T('howItWorksHero'))}</p>`
          + `</div>`
          + `</section>`
          + `<section class="py-12 md:py-16 bg-white">`
          + `<div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">`
          + `<div class="grid grid-cols-1 md:grid-cols-3 gap-8">`
          + howItWorksPlan.steps
            .map(
              ({ icon, titleKey, descriptionKey: textKey }) =>
                `<div class="rounded-2xl border border-gray-100 shadow-sm p-6">` +
                `<div class="bg-orange-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"><span class="text-2xl">${icon}</span></div>` +
                `<h2 class="text-lg font-semibold text-gray-900 text-center mb-3">${esc(T(titleKey))}</h2>` +
                `<p class="text-gray-600 text-sm">${esc(T(textKey))}</p>` +
                `</div>`
            )
            .join('')
          + `</div>`
          + `</div>`
          + `</section>`
          + `<section class="py-12 md:py-16 bg-gray-50">`
          + `<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">`
          + `<div class="rounded-3xl border-2 border-emerald-200 bg-emerald-50 p-8 md:p-10">`
          + `<div class="flex flex-col md:flex-row items-center gap-6">`
          + `<div class="text-5xl">🛡️</div>`
          + `<div>`
          + `<h2 class="text-2xl md:text-3xl font-bold text-emerald-900 mb-3">${esc(T('escrowWhatTitle'))}</h2>`
          + `<p class="text-emerald-800">${esc(T('escrowWhatText'))}</p>`
          + `<ul class="mt-4 space-y-2 text-emerald-800 text-sm">`
          + howItWorksPlan.guaranteeKeys
            .map((key) => `<li>${esc(T(key))}</li>`)
            .join('')
          + `</ul>`
          + `</div>`
          + `</div>`
          + `</div>`
          + `</div>`
          + `</section>`
          + `<section class="py-12 md:py-16 bg-white">`
          + `<div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">`
          + `<h2 class="text-2xl md:text-3xl font-bold text-gray-900 text-center mb-8">${esc(T('faqTitle'))}</h2>`
          + `<div class="space-y-4">`
          + howItWorksPlan.faq
            .map(
              ({ questionKey, answerKey }) =>
                `<details class="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 group">` +
                `<summary class="cursor-pointer font-semibold text-gray-900 list-none flex items-center justify-between gap-4">` +
                `${esc(T(questionKey))}` +
                `<span class="text-orange-600 transition-transform group-open:rotate-45 text-xl leading-none">+</span>` +
                `</summary>` +
                `<p class="mt-3 text-sm text-gray-600">${esc(T(answerKey))}</p>` +
                `</details>`
            )
            .join('')
          + `</div>`
          + `</div>`
          + `</section>`
          + `<section class="py-12 md:py-16 bg-gradient-to-r from-orange-600 to-red-600 text-white">`
          + `<div class="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">`
          + `<h2 class="text-2xl md:text-3xl font-bold mb-4">${esc(T('readyToStart'))}</h2>`
          + `<div class="flex flex-col sm:flex-row gap-4 justify-center">`
          + `<a href="/register?type=client" class="bg-white text-orange-600 hover:bg-gray-100 px-8 py-4 rounded-xl font-semibold transition">${esc(T('lookingForServices'))}</a>`
          + `<a href="/register?type=worker" class="border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-4 rounded-xl font-semibold transition">${esc(T('offerServices'))}</a>`
          + `</div>`
          // Maillage interne : mêmes liens que ceux ajoutés au composant
          // (HowItWorks.js) — les crawlers atteignent la liste des missions
          // et le support depuis cette page de contenu.
          + `<p class="mt-6 text-sm opacity-90">`
          + `<a href="/jobs" class="underline underline-offset-2">${esc(T('viewJobs'))}</a>`
          + ` · `
          + `<a href="/support" class="underline underline-offset-2">${esc(T('support'))}</a>`
          + `</p>`
          + `</div>`
          + `</section>`,
        // Support : page PUBLIQUE (contact + suivi de ticket) qui était
        // elle aussi servie par le gabarit nu. Le shell réplique l'état
        // INITIAL de src/pages/Support.js (titre, carte de suivi vide,
        // choix du canal, carte de contact) : même ordre, mêmes classes,
        // mêmes hauteurs — le montage React ne décale rien.
        support: `<div class="h-16 bg-white border-b border-gray-200"></div>`
          + `<div class="max-w-2xl mx-auto px-4 py-8">`
          + `<div class="mb-6 text-center">`
          + `<h1 class="text-3xl font-bold text-gray-900 mb-2">${esc(supportPlan.texts.title)}</h1>`
          + `<p class="text-gray-600">${esc(supportPlan.texts.subtitle)}</p>`
          + `</div>`
          + `<div class="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">`
          + `<h2 class="text-lg font-semibold text-gray-900 mb-1">Suivre une demande existante</h2>`
          + `<p class="text-sm text-gray-500 mb-4">Entrez votre n° de ticket et l'e-mail utilisé pour voir où en est votre demande.</p>`
          + `<div class="flex flex-col sm:flex-row gap-2">`
          + `<input type="text" readonly placeholder="N° de ticket (ex : 3fa85f64…)" aria-label="N° de ticket" class="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm" />`
          + `<input type="email" readonly placeholder="Votre e-mail" aria-label="Votre e-mail" class="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm" />`
          + `<div class="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white opacity-50">Vérifier le statut</div>`
          + `</div>`
          + `</div>`
          + `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">`
          + supportPlan.modes
              .map(
                ({ shellIcon, badgeClass, title, subtitle }) =>
                  `<div class="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm transition-all">` +
                  `<span class="flex h-12 w-12 items-center justify-center rounded-full ${badgeClass}">${shellIcon}</span>` +
                  `<span class="font-semibold text-gray-900">${esc(title)}</span>` +
                  `<span class="text-xs text-gray-500">${esc(subtitle)}</span>` +
                  `</div>`
              )
              .join('') +
          `</div>`
          + `<div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">`
          + `<h2 class="text-xl font-semibold text-gray-900 mb-1">${esc(supportPlan.texts.directCardTitle)}</h2>`
          + `<p class="text-sm text-gray-500 mb-5">${esc(supportPlan.texts.directCardSubtitle)}</p>`
          + `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">`
          + supportPlan.rows
              .map((row) => {
                const interieur =
                  `<span class="flex h-10 w-10 items-center justify-center rounded-full ${row.badgeClass}">${row.shellIcon}</span>` +
                  `<div><div class="text-sm font-semibold text-gray-900">${esc(row.label)}</div>` +
                  `<div class="text-xs text-gray-500${row.breakAll ? ' break-all' : ''}">${esc(row.value)}</div></div>`
                return row.href
                  ? `<a href="${esc(row.href)}"${row.external ? ' target="_blank" rel="noreferrer"' : ''} class="${row.rowClass}">${interieur}</a>`
                  : `<div class="${row.rowClass}">${interieur}</div>`
              })
              .join('') +
          `</div>`
          + `</div>`
          // Maillage interne : le support mène au fonctionnement du service
          // et à la liste des missions (page utile pour un crawler qui
          // arrive ici depuis une recherche de contact).
          + liensDePage(supportPlan, 'mt-6 text-center text-sm text-gray-500')
          + `</div>`,
        // ── Les trois pages de CONFIANCE ─────────────────────────────
        // /about, /contact, /privacy : ce qu'un moteur (et une régie
        // publicitaire) exige avant de faire crédit au site — qui l'édite,
        // comment le joindre, ce qu'il fait des données. Elles étaient
        // ABSENTES du site : la politique de confidentialité n'existait
        // qu'en .docx, et « Contact » renvoyait au support.
        //
        // Le shell reproduit l'état INITIAL de la page React (mêmes
        // sections, mêmes classes, mêmes textes via les clés i18n) : un
        // crawler sans JavaScript lit la page entière, et createRoot efface
        // ce contenu au montage sans décaler quoi que ce soit.
        about: `<div class="h-16 bg-white border-b border-gray-200"></div>`
          + `<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">`
          + `<h1 class="text-3xl font-bold text-gray-900 mb-4">${esc(T(aboutPlan.titleKey))}</h1>`
          + `<p class="text-gray-600 mb-8">${esc(T(aboutPlan.introKey))}</p>`
          + `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">`
          + aboutPlan.cards
              .map(
                ({ icon, titleKey, descriptionKey }) =>
                  `<div class="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">` +
                  `<div class="text-2xl mb-3">${icon}</div>` +
                  `<h2 class="text-lg font-semibold text-gray-900 mb-2">${esc(T(titleKey))}</h2>` +
                  `<p class="text-sm text-gray-600">${esc(T(descriptionKey))}</p>` +
                  `</div>`
              )
              .join('') +
          `</div>`
          + `<div class="rounded-3xl border-2 border-emerald-200 bg-emerald-50 p-8 mb-10">`
          + `<h2 class="text-xl font-bold text-emerald-900 mb-3">${esc(T(aboutPlan.highlight.titleKey))}</h2>`
          + `<p class="text-emerald-800">${esc(T(aboutPlan.highlight.textKey))}</p>`
          + `<p class="text-emerald-700 mt-3 text-sm">${esc(T(aboutPlan.highlight.bulletsKey))}</p>`
          + `</div>`
          + liensDePage(aboutPlan, 'text-sm text-gray-500')
          + `</div>`,
        contact: `<div class="h-16 bg-white border-b border-gray-200"></div>`
          + `<div class="max-w-2xl mx-auto px-4 py-8">`
          + `<h1 class="text-3xl font-bold text-gray-900 mb-2">${esc(T(contactPlan.titleKey))}</h1>`
          + `<p class="text-gray-600 mb-3">${esc(T(contactPlan.introKey))}</p>`
          + `<p class="text-sm text-gray-500 mb-6">${esc(T(contactPlan.noteKey))}</p>`
          + `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">`
          + contactPlan.actions
              .map(
                ({ icon, label, badgeClass, href, value, external, breakAll }) =>
                  `<a href="${esc(href)}"` +
                  (external ? ` target="_blank" rel="noreferrer"` : '') +
                  ` class="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">` +
                  `<span class="flex h-10 w-10 items-center justify-center rounded-full ${badgeClass}">${icon}</span>` +
                  `<div><div class="text-sm font-semibold text-gray-900">${esc(label)}</div>` +
                  `<div class="text-xs text-gray-500${breakAll ? ' break-all' : ''}">${esc(value)}</div></div>` +
                  `</a>`
              )
              .join('') +
          `</div>`
          + `<iframe src="${esc(contact.mapsEmbedUrl)}" title="Carte — Kojo, ${esc(contact.address)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" class="mt-6 w-full rounded-xl border border-gray-200" style="height:320px;border:0;"></iframe>`
          + liensDePage(contactPlan, 'mt-6 text-sm text-gray-500')
          + `</div>`,
        privacy: `<div class="h-16 bg-white border-b border-gray-200"></div>`
          + `<div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">`
          + `<h1 class="text-3xl font-bold text-gray-900 mb-4">${esc(T(privacyPlan.titleKey))}</h1>`
          + `<p class="text-gray-600 mb-8">${esc(T(privacyPlan.introKey))}</p>`
          + privacyPlan.sections
              .map(
                ({ titleKey, bodyKey }) =>
                  `<section class="mb-8">` +
                  `<h2 class="text-xl font-semibold text-gray-900 mb-2">${esc(T(titleKey))}</h2>` +
                  `<p class="text-gray-600">${esc(T(bodyKey))}</p>` +
                  `</section>`
              )
              .join('') +
          liensDePage(privacyPlan, 'text-sm text-gray-500')
          + `</div>`,
      }

      // Titre et description par route : plus AUCUN texte écrit ici.
      // La table UNIQUE est src/config/page-meta.js (clés i18n), la même que
      // lit le runtime via usePageMeta() — donc un texte corrigé d'un côté
      // ne peut plus laisser l'autre annoncer l'ancien (la coquille et la
      // page sont comparées hors ligne par scripts/check-page-meta.js).

      // Remplace content="..." d'une meta mono ou multi-lignes.
      const setMeta = (htmlIn, key, value) => {
        const re = new RegExp(`(<meta\\s+(?:property|name)="${key}"[^>]*?content=")[^"]*(")`)
        return htmlIn.replace(re, `$1${value}$2`)
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
      // ── Le texte d'une route, écrit par UNE fonction ───────────────────
      // Titre, `name="title"`, description, og:* et twitter:* viennent tous
      // de src/config/page-meta.js, résolu dans src/i18n/fr.json — T() casse
      // le build si une clé manque. index.html (la route « / ») et les sept
      // coquilles passent par ici : un texte ajouté à la table ne peut donc
      // pas être publié par l'un et oublié par l'autre.
      //
      // La description va AUSSI sur `name="description"`, pas seulement sur
      // og:description : sans elle, les sept pages pré-rendues héritaient de
      // celle de l'accueil (pour un moteur, /jobs, /login, /register…
      // décrivaient toutes la même chose).
      const writeRouteText = (htmlIn, routePath) => {
        const keys = pageMeta[routePath]
        const title = T(keys.title)
        const description = T(keys.description)
        let out = htmlIn.replace(/(<title>)[^<]*(<\/title>)/, `$1${title}$2`)
        for (const [key, value] of [
          ['title', title],
          ['description', description],
          ['og:title', title],
          ['og:description', description],
          ['twitter:title', title],
          ['twitter:description', description],
        ]) {
          out = setMeta(out, key, value)
        }
        return out
      }

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
        const url = `${origin}/${route}`
        const imageUrl = `${origin}${card.image}`
        let out = writeRouteText(html, routePath).replace(
          /(<link rel="canonical" href=")[^"]*(")/,
          `$1${url}$2`
        )
        out = setMeta(out, 'og:image', imageUrl)
        // Variante carrée : la carte carrée STATIQUE de la home (présente
        // dans index.html) est REMPLACÉE par celle de la route (bloc
        // identifié par height="1200" — la carte wide a height="630").
        // Les crawlers qui recadrent en 1:1 lisent les dimensions
        // déclarées et choisissent la variante adaptée à leur rendu.
        const squareUrl = `${origin}${card.imageSquare}`
        const squareBlock =
          `<meta property="og:image" content="${squareUrl}" />` +
          `<meta property="og:image:width" content="1200" />` +
          `<meta property="og:image:height" content="1200" />` +
          `<meta property="og:image:type" content="image/png" />`
        out = out.replace(
          /<meta property="og:image"[^>]*\/>\s*<meta property="og:image:width" content="1200"[^>]*\/>\s*<meta property="og:image:height" content="1200"[^>]*\/>\s*<meta property="og:image:type" content="image\/png"[^>]*\/>/,
          squareBlock
        )
        out = setMeta(out, 'og:url', url)
        out = setMeta(out, 'twitter:url', url)
        out = setMeta(out, 'twitter:image', imageUrl)
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

      // ── Gabarit des routes CLIENTES : app.html ──────────────────────
      // Les routes sans pré-rendu (/dashboard, /profile, /messages,
      // /create-job, /commission-dashboard…) n'ont AUCUN contenu statique
      // propre — et aucune raison d'être indexées : ce sont des écrans
      // connectés, privés par la MÊME dérivation que le garde lit pour exiger
      // leur X-Robots-Tag dans vercel.json (noindex dit ici en plus, dans le
      // document, et en `Disallow` dans le robots.txt écrit par le build). Les pages
      // PUBLIQUES de contenu (/how-it-works, /support) ont, elles, leur
      // propre shell depuis qu'elles ne doivent plus apparaître vides.
      // Leur servir index.html reviendrait à publier le
      // shell de l'ACCUEIL sur dix URL différentes — h1, 300+ mots et
      // liens internes de la home servis sous l'adresse /dashboard, c'est
      // du contenu dupliqué (le défaut exact que l'audit SEO reprochait à
      // l'accueil, déplacé sur les autres routes).
      //
      // app.html est donc le gabarit NU : #root vide (rien qui soit peint
      // puis effacé au montage), titre/description neutres décrivant le
      // SITE et non la page, et surtout AUCUN canonical. Le canonical
      // statique "/" était un défaut connu (voir src/utils/seo.js) : un
      // seul /app.html servant dix routes ne peut pas en déclarer un — le
      // hook usePageTitle en pose un correct au runtime, et `ensureCanonical`
      // crée la balise si elle est absente. Le JSON-LD (LocalBusiness,
      // Organization, WebSite) est retiré pour la même raison : il décrit
      // l'organisation une fois, sur la page d'accueil et sur elle seule.
      const neutralTitle = 'Kojo'
      const neutralDescription =
        "Kojo met en relation clients et travailleurs qualifiés en Afrique de l'Ouest : plomberie, électricité, mécanique, construction, informatique et plus."
      let appHtml = html
        .replace(/(<title>)[^<]*(<\/title>)/, `$1${neutralTitle}$2`)
        .replace(/\s*<link rel="canonical"[^>]*\/?>(?:<\/link>)?/, '')
        .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
      appHtml = setMeta(appHtml, 'description', neutralDescription)
      appHtml = setMeta(appHtml, 'og:title', neutralTitle)
      appHtml = setMeta(appHtml, 'og:description', neutralDescription)
      appHtml = setMeta(appHtml, 'twitter:title', neutralTitle)
      appHtml = setMeta(appHtml, 'twitter:description', neutralDescription)
      // ── robots : le gabarit ne peut pas se dire indexable ─────────────────
      // Il sert UNIQUEMENT les routes privées (dérivées du routage par
      // scripts/check-spa-routes.js, et c'est cette même liste que le garde
      // exige en X-Robots-Tag dans vercel.json). Le fichier héritait pourtant
      // du `index, follow` du gabarit d'accueil, par simple recopie : mesuré en
      // production le 20/09/2026, /dashboard, /messages, /profile,
      // /photo-debug et /support-admin recevaient donc un en-tête `noindex` ET
      // un document qui disait `index, follow` — deux verdicts contradictoires
      // sur les mêmes URL, dont le plus restrictif gagne par chance et non par
      // construction.
      appHtml = setMeta(appHtml, 'robots', 'noindex, follow')
      if (appHtml.includes('<link rel="canonical"') || appHtml.includes('application/ld+json')) {
        throw new Error(
          'prerender-route-meta : app.html contient encore un canonical ou un JSON-LD — ' +
            'le gabarit des routes clientes doit rester neutre (contenu dupliqué sinon)'
        )
      }
      fs.writeFileSync(path.join(outDir, 'app.html'), appHtml, 'utf8')

      // ── Page 404 ────────────────────────────────────────────────
      // Servie par Vercel (statut 404) pour une URL qui ne correspond à
      // aucun fichier ni rewrite. Sans scripts : elle doit fonctionner
      // même si le bundle échoue à se charger. noindex : une page 404
      // indexée est un « soft 404 ».
      const notFoundPage = [
        '<!DOCTYPE html>',
        '<html lang="fr">',
        '<head>',
        '<meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        '<meta name="robots" content="noindex, follow" />',
        '<title>Page introuvable — Kojo</title>',
        '<style>',
        'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;color:#111827}',
        'main{max-width:640px;margin:0 auto;padding:4rem 1.5rem;text-align:center}',
        'h1{font-size:1.875rem;margin:0 0 1rem}',
        'p{color:#4b5563;line-height:1.6}',
        'nav{display:flex;flex-wrap:wrap;gap:1rem;justify-content:center;margin-top:2rem}',
        'a{color:#ea580c;font-weight:600}',
        '</style>',
        '</head>',
        '<body>',
        '<main>',
        '<h1>Page introuvable</h1>',
        '<p>Cette adresse n\'existe pas (ou plus) sur Kojo. La mission a peut-être été clôturée, ou le lien est incomplet.</p>',
        '<nav>',
        '<a href="/">Accueil</a>',
        '<a href="/jobs">Voir les emplois disponibles</a>',
        '<a href="/how-it-works">Comment ça marche ?</a>',
        `<a href="mailto:${contact.email}">Nous contacter</a>`,
        '</nav>',
        `</main></body></html>`,
      ].join('')
      fs.writeFileSync(path.join(outDir, '404.html'), notFoundPage, 'utf8')
    },
  }
}
