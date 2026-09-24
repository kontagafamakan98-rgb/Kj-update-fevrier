// Coquille statique de l'ACCUEIL (index.html) : le corps de « / », écrit
// une fois pour le crawler et pour le premier paint, avec les classes de
// src/pages/Home.js — createRoot efface #root au montage et rend la même
// structure, donc la bascule est invisible.
//
// Pays, catégories, promesses, étapes et chiffres ne sont pas recopiés ici :
// la coquille lit les MÊMES listes que la page — les pays dans
// src/config/countries.js, le reste dans la déclaration du corps de
// l'accueil (src/config/page-sections.js, que lit src/pages/Home.js).

import { COUNTRIES } from '../../src/config/countries.js'

export function buildHomeShell({ esc, T, contact, socialLinks, pageSections }) {
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

  // Les quatre moyens de contact du bloc ci-dessous sont déclarés UNE fois,
  // par /contact (`actions` de src/config/page-sections.js) — la même
  // déclaration que lit src/pages/Contact.js. Ce bloc lisait leurs glyphes en
  // littéral, donc changer l'icône d'un moyen de contact laissait derrière lui
  // l'appel, WhatsApp, l'e-mail ou l'adresse. La correspondance est explicite
  // (le libellé de l'accueil dit « Appeler le support », celui de /contact dit
  // « Appeler ») et une ligne disparue de /contact CASSE le build au lieu de
  // peindre une pastille vide sans que personne ne le voie.
  const glypheDeContact = (labelKey) => {
    const action = pageSections['/contact'].actions.find((a) => a.labelKey === labelKey)
    if (!action) {
      throw new Error(
        `prerender-shells : /contact ne déclare plus la ligne « ${labelKey} » ` +
          "(src/config/page-sections.js) — le bloc de contact de l'accueil lit ses glyphes là-bas."
      )
    }
    return esc(T(action.iconKey))
  }

  return [
    // Placeholder navbar (hauteur réelle) — comme les shells /jobs et
    // /login : le marqueur visuel est en place dès le premier paint.
    `<div class="h-16 bg-white border-b border-gray-200"></div>`,
    `<div class="min-h-screen">`,

    // Hero : le h1 est l'élément LCP de l'accueil.
    `<section class="bg-gradient-to-br from-orange-600 via-orange-700 to-red-600 text-white relative overflow-hidden">`,
    `<div class="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 md:py-24">`,
    `<div class="text-center">`,
    `<span class="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-xs sm:text-sm font-medium text-white ring-1 ring-inset ring-white/25 mb-6">`,
    `<span aria-hidden="true">${esc(T('iconEscrow'))}</span>`,
    `${esc(T('escrowBannerTitle'))}`,
    `</span>`,
    `<h1 class="text-3xl md:text-5xl lg:text-6xl font-bold mb-4 md:mb-6 leading-tight max-w-4xl mx-auto">${esc(T('heroTitle'))}</h1>`,
    `<p class="text-lg md:text-xl lg:text-2xl mb-8 opacity-90 max-w-3xl mx-auto">${esc(T('heroSubtitle'))}</p>`,
    `<div class="flex flex-col sm:flex-row gap-4 justify-center items-center">`,
    `<a href="/register" class="w-full sm:w-auto bg-white text-orange-600 hover:bg-orange-50 px-8 py-4 rounded-xl font-semibold text-lg shadow-xl transform transition hover:-translate-y-0.5">${esc(T('getStarted'))}</a>`,
    `<a href="/jobs" class="w-full sm:w-auto border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-4 rounded-xl font-semibold text-lg transition">${esc(T('viewJobs'))}</a>`,
    `</div>`,
    // Bandeau de confiance (mêmes clés i18n que src/pages/Home.js).
    `<div class="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-white/90">`,
    `<span class="inline-flex items-center gap-2"><span aria-hidden="true">${esc(T('iconEscrow'))}</span>${esc(T('escrowTrustTitle'))}</span>`,
    `<span class="inline-flex items-center gap-2"><span aria-hidden="true">${esc(T('iconPromiseSecurePayments'))}</span>${esc(T('securePayments'))}</span>`,
    `<a href="/how-it-works" class="font-semibold text-white underline underline-offset-4 hover:text-orange-100">${esc(T('howItWorksLink'))}</a>`,
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
        `<div class="${country.color} rounded-2xl p-6 text-center shadow-md ring-1 ring-inset ring-black/5">` +
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
        `<a href="/jobs?category=${category.labelKey}" class="group bg-white rounded-2xl shadow-md ring-1 ring-inset ring-black/5 p-6 text-center transition hover:shadow-lg hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">` +
        `<div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-orange-50 text-3xl md:text-4xl transition group-hover:scale-110" aria-hidden="true">${esc(T(category.iconKey))}</div>` +
        `<h3 class="font-medium text-gray-900 text-sm md:text-base">${esc(T(category.labelKey))}</h3>` +
        `</a>`
    ),
    `</div>`,
    `</div>`,
    `</section>`,

    // Trois promesses
    `<section class="py-12 md:py-16 bg-white">`,
    `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
    `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">`,
    ...homePlan.promises.map(
      ({ iconKey, titleKey, descriptionKey: textKey }) =>
        `<div class="rounded-2xl border border-gray-100 bg-gray-50/60 p-6 text-center shadow-sm transition hover:shadow-md hover:bg-white">` +
        `<div class="bg-orange-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"><span class="text-2xl" aria-hidden="true">${esc(T(iconKey))}</span></div>` +
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
    `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">`,
    ...homePlan.steps.map(
      ({ iconKey, numberKey, titleKey, descriptionKey: textKey }) =>
        `<div class="relative bg-white rounded-2xl shadow-md ring-1 ring-inset ring-black/5 p-6 pt-8 text-center">` +
        `<span class="absolute -top-4 left-1/2 -translate-x-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-orange-600 text-sm font-bold text-white shadow-md">${esc(T(numberKey))}</span>` +
        `<div class="bg-orange-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"><span class="text-2xl" aria-hidden="true">${esc(T(iconKey))}</span></div>` +
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
    `<div class="rounded-3xl border-2 border-emerald-200 bg-emerald-50 p-8 md:p-10 shadow-sm">`,
    `<div class="flex flex-col md:flex-row items-center gap-6">`,
    `<div class="text-5xl" aria-hidden="true">${esc(T(homePlan.escrowIconKey))}</div>`,
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
    `<a href="/register?type=client" class="bg-white text-orange-600 hover:bg-orange-50 px-8 py-4 rounded-xl font-semibold shadow-xl transform transition hover:-translate-y-0.5">${esc(T('lookingForServices'))}</a>`,
    `<a href="/register?type=worker" class="border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-4 rounded-xl font-semibold transition">${esc(T('offerServices'))}</a>`,
    `</div>`,
    `</div>`,
    `</section>`,

    // Chiffres (valeurs de repli de Home.js avant /public/stats, pour
    // que le remplacement par React ne décale rien). Le texte publié
    // ici et le repli que lit Home.js sortent de la MÊME déclaration
    // (homePlan.stats) : une seule liste, deux rendus.
    `<section class="py-12 md:py-16 bg-gray-50">`,
    `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">`,
    `<div class="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 text-center rounded-2xl bg-white p-8 shadow-md ring-1 ring-inset ring-black/5">`,
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
    `<h2 class="text-2xl md:text-3xl font-bold text-gray-900 mb-4">${esc(T('contactTitle'))}</h2>`,
    `<p class="text-gray-600 max-w-2xl mx-auto">${esc(T('homeContactText'))}</p>`,
    `</div>`,
    `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl mx-auto">`,
    `<a href="tel:${esc(contact.phone)}" class="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">`,
    `<span class="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-orange-600">${esc(glypheDeContact('contactCall'))}</span>`,
    `<div><div class="text-sm font-semibold text-gray-900">${esc(T('homeContactCall'))}</div><div class="text-xs text-gray-500">${esc(contact.phoneDisplay)}</div></div>`,
    `</a>`,
    `<a href="${esc(contact.whatsappUrl)}" target="_blank" rel="noreferrer" class="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">`,
    `<span class="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">${esc(glypheDeContact('contactWhatsapp'))}</span>`,
    `<div><div class="text-sm font-semibold text-gray-900">${esc(T('contactWhatsapp'))}</div><div class="text-xs text-gray-500">${esc(contact.phoneDisplay)}</div></div>`,
    `</a>`,
    `<a href="mailto:${esc(contact.email)}?subject=Contact%20KOJO" class="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">`,
    `<span class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">${esc(glypheDeContact('contactSendEmail'))}</span>`,
    `<div><div class="text-sm font-semibold text-gray-900">${esc(T('contactSendEmail'))}</div><div class="text-xs text-gray-500 break-all">${esc(contact.email)}</div></div>`,
    `</a>`,
    `<a href="${esc(contact.mapsUrl)}" target="_blank" rel="noreferrer" aria-label="Google Maps" title="Google Maps" class="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">`,
    `<span class="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600">${esc(glypheDeContact('contactAddress'))}</span>`,
    `<div><div class="text-sm font-semibold text-gray-900">${esc(T('contactAddress'))}</div><div class="text-xs text-gray-500">${esc(contact.address)}</div></div>`,
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
          `<h3 class="text-lg font-semibold text-gray-900 mb-3">${esc(T('homeContactFollow'))}</h3>`,
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
    `<iframe src="${esc(contact.mapsEmbedUrl)}" title="${esc(T('mapIframeTitle').replace('{address}', contact.address))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" class="mt-8 w-full rounded-xl border border-gray-200" style="height:320px;border:0;"></iframe>`,
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
    `<a href="${esc(contact.whatsappUrl)}" target="_blank" rel="noreferrer" class="hover:text-orange-700 underline underline-offset-2">${esc(T('contactWhatsapp'))}</a>`,
    `<a href="${esc(contact.mapsUrl)}" target="_blank" rel="noreferrer" aria-label="Google Maps" title="Google Maps" class="hover:text-orange-700 underline underline-offset-2">${esc(T('footerItinerary'))}</a>`,
    `</address>`,
    `<div class="flex flex-wrap items-center justify-center md:justify-end gap-4 text-sm text-orange-700">`,
    // Les trois pages de confiance, liées depuis le corps de page :
    // c'est par ces liens qu'un crawler sans JavaScript les DÉCOUVRE.
    `<a href="/about" class="hover:text-orange-800 underline underline-offset-2">${esc(T('aboutTitle'))}</a>`,
    `<a href="/contact" class="hover:text-orange-800 underline underline-offset-2">${esc(T('contactTitle'))}</a>`,
    `<a href="/privacy" class="hover:text-orange-800 underline underline-offset-2">${esc(T('privacyTitle'))}</a>`,
    `<a href="/legal/kojo_politique_confidentialite_et_cgu_fusionnees.docx" target="_blank" rel="noreferrer" class="hover:text-orange-800 underline underline-offset-2">${esc(T('footerTerms'))}</a>`,
    ...socialLinks.map(
      (social) =>
        `<a href="${esc(social.url)}" target="_blank" rel="me noreferrer" class="hover:text-orange-800 underline underline-offset-2">${esc(social.label)}</a>`
    ),
    `</div>`,
    `</div>`,
    `</footer>`,
  ].join('')
}

