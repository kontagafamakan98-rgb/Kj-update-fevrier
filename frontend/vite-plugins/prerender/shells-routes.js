// Coquilles statiques des routes pré-rendues (hors accueil) : le corps de
// chaque page, écrit une fois pour le crawler et pour le premier paint.
//
import { PHONE_PREFIX_FALLBACK, phoneNumberExample } from '../../src/config/phone-format.js'
import { COUNTRY_PLACEHOLDER } from '../../src/config/country-placeholder.js'
import { photoFormatsLine } from '../../src/config/photo-formats.js'

// Le TEXTE vient du dictionnaire global (T), des dictionnaires de page
// (registerT/jobsT) et des configs partagées avec les pages (préfixe et
// masque du téléphone, placeholder pays, ligne des formats photo) ; la LISTE
// des éléments d'une page vient de sa déclaration (src/config/page-sections.js)
// : la coquille s'en dérive, elle ne peut pas la recopier (le refus est dans
// declared-body.js).
//
// Ce qui reste littéral dans une coquille n'est PAS de la copie : le logo
// (`K`), les numéros d'étape (1/2/3), les emojis et le `+` de la FAQ sont des
// marqueurs décoratifs, sans équivalent i18n et sans homologue à faire
// diverger côté page.

export function buildRouteShells({ esc, T, registerT, jobsT, contact, frDate, pageSections }) {
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
  const jobsPlan = pageSections['/jobs']
  const loginPlan = pageSections['/login']
  const forgotPasswordPlan = pageSections['/forgot-password']
  const paymentPlan = pageSections['/payment']

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

  const SHELLS = {
    jobs: `<div class="h-16 bg-white border-b border-gray-200"></div>`
      + `<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">`
      + `<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">`
      + `<div>`
      + `<h1 class="text-3xl font-bold text-gray-900">${esc(jobsT(jobsPlan.titleKey))}</h1>`
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
      + `<h1 class="mt-6 text-center text-3xl font-extrabold text-gray-900">${esc(T(loginPlan.titleKey))}</h1>`
      + `</div>`
      + `<form class="mt-8 space-y-6">`
      + `<div class="space-y-4">`
      + `<div>`
      + `<label for="email" class="block text-sm font-medium text-gray-700">${esc(T(loginPlan.emailLabelKey))}</label>`
      + `<input id="email" name="email" type="email" autocomplete="email" readonly placeholder="${esc(T(loginPlan.emailLabelKey))}" class="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md sm:text-sm" />`
      + `</div>`
      + `<div>`
      + `<div class="flex items-center justify-between">`
      + `<label for="password" class="block text-sm font-medium text-gray-700">${esc(T(loginPlan.passwordLabelKey))}</label>`
      + `<span class="text-sm font-medium text-orange-600">${esc(T(loginPlan.forgotPasswordLinkKey))}</span>`
      + `</div>`
      + `<div class="relative mt-1">`
      + `<input id="password" name="password" type="password" autocomplete="current-password" readonly placeholder="${esc(T(loginPlan.passwordLabelKey))}" class="appearance-none relative block w-full px-3 py-2 pr-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md sm:text-sm" />`
      + `</div>`
      + `</div>`
      + `</div>`
      + `<div>`
      + `<div class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-orange-600">${esc(T(loginPlan.titleKey))}</div>`
      + `</div>`
      + `<div class="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-gray-300 rounded-md bg-white text-gray-700 text-sm font-medium">${esc(registerT(loginPlan.googleLoginKey))}</div>`
      + `<div class="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-2">`
      + `<p class="text-sm font-semibold text-orange-900">📜 ${esc(registerT('legalNoticeTitle'))}</p>`
      + `<span class="inline-flex items-center text-sm font-medium text-orange-700 underline">${esc(registerT('legalConsentLink'))}</span>`
      + `<p class="text-xs text-gray-600">${esc(registerT('legalContactLine'))}</p>`
      + `</div>`
      + `<div class="text-center">`
      + `<span class="text-sm text-gray-600">${esc(T(loginPlan.noAccountKey))} <span class="font-medium text-orange-600">${esc(T(loginPlan.registerKey))}</span></span>`
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
    // readonly (inertes jusqu'au boot) et TOUS les libellés sont résolus
    // par registerT(T) : le scope de la page, donc la même source que
    // src/pages/Register.js.
    register: `<div class="h-16 bg-white border-b border-gray-200"></div>`
      + `<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">`
      + `<div class="max-w-md w-full space-y-8">`
      + `<div class="text-center mb-8">`
      + `<div class="mx-auto h-16 w-16 bg-orange-600 rounded-full flex items-center justify-center shadow-lg">`
      + `<span class="text-white text-2xl font-bold">K</span>`
      + `</div>`
      + `<h1 class="mt-6 text-center text-3xl font-bold text-gray-900">${esc(registerT('title'))}</h1>`
      + `<p class="mt-2 text-sm text-gray-600">${esc(registerT('subtitle'))}</p>`
      + `<div class="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">`
      + `<div class="flex items-center justify-center py-2">`
      + `<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>`
      + `<span class="text-xs text-blue-700">${esc(T('detectingLocation'))}</span>`
      + `</div>`
      + `<div class="flex items-center gap-3 overflow-x-auto pb-1 text-xs sm:text-sm sm:justify-center sm:space-x-4">`
      + `<div class="flex items-center">`
      + `<div class="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-medium">1</div>`
      + `<span class="ml-2 text-orange-600 font-medium whitespace-nowrap">${esc(registerT('personalInformation'))}</span>`
      + `</div>`
      + `<div class="w-12 h-1 bg-gray-200"></div>`
      + `<div class="flex items-center">`
      + `<div class="w-6 h-6 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-xs font-medium">2</div>`
      + `<span class="ml-2 text-gray-500 font-medium whitespace-nowrap">${esc(registerT('stepEmail'))}</span>`
      + `</div>`
      + `<div class="w-12 h-1 bg-gray-200"></div>`
      + `<div class="flex items-center">`
      + `<div class="w-6 h-6 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-xs font-medium">3</div>`
      + `<span class="ml-2 text-gray-500 font-medium whitespace-nowrap">${esc(registerT('stepPayments'))}</span>`
      + `</div>`
      + `</div>`
      + `<p class="text-xs text-blue-700 mt-3">⚠️ ${esc(registerT('clientStepNotice'))}</p>`
      + `</div>`
      + `</div>`
      + `<form class="mt-8 space-y-6 bg-white p-4 sm:p-8 rounded-xl shadow-md">`
      + `<div class="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-700 text-sm font-medium">${esc(registerT('googleSignup'))}</div>`
      + `<div class="relative">`
      + `<div class="absolute inset-0 flex items-center"><div class="w-full border-t border-gray-200"></div></div>`
      + `<div class="relative flex justify-center text-sm"><span class="bg-white px-3 text-gray-400">${esc(registerT('orSeparator'))}</span></div>`
      + `</div>`
      + `<fieldset>`
      + `<legend class="block text-sm font-medium text-gray-700 mb-3">${esc(registerT('userType'))}</legend>`
      + `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">`
      + `<div class="relative flex items-center justify-center p-4 border-2 border-orange-500 bg-orange-50 rounded-lg">`
      + `<div class="text-center"><div class="text-2xl mb-2">👤</div><span class="text-sm font-medium text-gray-700">${esc(registerT('client'))}</span><p class="text-xs text-gray-500 mt-1">${esc(registerT('iAmClient'))}</p></div>`
      + `</div>`
      + `<div class="relative flex items-center justify-center p-4 border-2 border-gray-300 rounded-lg">`
      + `<div class="text-center"><div class="text-2xl mb-2">🔧</div><span class="text-sm font-medium text-gray-700">${esc(registerT('worker'))}</span><p class="text-xs text-gray-500 mt-1">${esc(registerT('iAmWorker'))}</p></div>`
      + `</div>`
      + `</div>`
      + `</fieldset>`
      + `<div>`
      + `<label class="block text-sm font-medium text-gray-700 mb-2">${esc(registerT('country'))}</label>`
      + `<select readonly class="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-gray-50 text-gray-400">${esc(COUNTRY_PLACEHOLDER(registerT('country')))}</select>`
      + `</div>`
      + `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">`
      + `<div><label class="block text-sm font-medium text-gray-700 mb-2">${esc(registerT('firstName'))}</label><input readonly placeholder="${esc(registerT('firstName'))}..." class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /></div>`
      + `<div><label class="block text-sm font-medium text-gray-700 mb-2">${esc(registerT('lastName'))}</label><input readonly placeholder="${esc(registerT('lastName'))}..." class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /></div>`
      + `</div>`
      + `<div><label class="block text-sm font-medium text-gray-700 mb-2">${esc(registerT('email'))}</label><input readonly type="email" placeholder="${esc(registerT('emailPlaceholder'))}" class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /></div>`
      + `<div>`
      + `<label class="block text-sm font-medium text-gray-700 mb-2">${esc(registerT('phone'))}</label>`
      + `<div class="flex rounded-lg shadow-sm">`
      + `<span class="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">${esc(PHONE_PREFIX_FALLBACK)}</span>`
      + `<input readonly placeholder="${esc(phoneNumberExample())}" class="flex-1 block w-full px-4 py-3 border border-gray-300 rounded-r-lg" />`
      + `</div>`
      + `<p class="mt-1 text-sm text-gray-500">${esc(registerT('phoneFormatHint'))}: ${esc(phoneNumberExample())}</p>`
      + `</div>`
      + `<div><label class="block text-sm font-medium text-gray-700 mb-2">${esc(registerT('password'))}</label><input readonly type="password" class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /><p class="mt-1 text-xs text-gray-500">${esc(registerT('passwordTooShort'))}</p></div>`
      + `<div><label class="block text-sm font-medium text-gray-700 mb-2">${esc(registerT('confirmPassword'))}</label><input readonly type="password" class="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm" /></div>`
      + `<div class="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6">`
      + `<div class="flex items-center mb-4"><span class="text-2xl mr-3">📸</span><h3 class="text-lg font-semibold text-gray-900">${esc(registerT('profilePhotoOptional'))}</h3></div>`
      + `<p class="text-sm text-gray-600 mb-4">${esc(registerT('profilePhotoHelps'))}</p>`
      + `<div class="relative border-2 border-dashed rounded-lg p-6 border-gray-300">`
      + `<div class="text-center"><div class="text-4xl mb-3">📸</div><div class="text-sm text-gray-600"><p class="font-medium">${esc(registerT('addProfilePhoto'))}</p><p>${esc(registerT('clickToChooseOption'))}</p></div><div class="text-xs text-gray-500 mt-2">${esc(photoFormatsLine(registerT('upTo')))}</div></div>`
      + `</div>`
      + `</div>`
      + `<div class="bg-gray-50 border border-gray-200 rounded-lg p-6">`
      + `<div class="flex items-center justify-center">`
      + `<div class="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-500 mr-3"></div>`
      + `<span class="text-gray-600">${esc(registerT('detectingLanguage'))}</span>`
      + `</div>`
      + `</div>`
      + `<div class="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">`
      + `<div><h3 class="text-sm font-semibold text-orange-900">📜 ${esc(registerT('legalNoticeTitle'))}</h3><p class="text-xs text-orange-800 mt-1">${esc(registerT('legalConsentHelp'))}</p></div>`
      + `<span class="inline-flex items-center text-sm font-medium text-orange-700 underline">${esc(registerT('legalConsentLink'))}</span>`
      + `<label class="flex items-start gap-3 cursor-pointer"><input type="checkbox" readonly class="mt-1 h-4 w-4 rounded border-gray-300 text-orange-600" /><span class="text-sm text-gray-700">${esc(registerT('legalConsentLabel'))}</span></label>`
      + `<p class="text-xs text-gray-600">${esc(registerT('legalContactLine'))}</p>`
      + `</div>`
      + `<div><div class="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-orange-600">${esc(registerT('continueButton'))}</div></div>`
      + `<div class="text-center"><span class="text-sm text-gray-600">${esc(registerT('signInPrompt'))} <span class="font-medium text-orange-600">${esc(T('signIn'))}</span></span></div>`
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
      + `<h1 class="mt-6 text-3xl font-extrabold text-gray-900">${esc(T(forgotPasswordPlan.titleKey))}</h1>`
      + `<p class="mt-3 text-sm text-gray-600">${esc(T(forgotPasswordPlan.subtitleKey))}</p>`
      + `</div>`
      + `<div class="bg-white rounded-2xl shadow-md p-6 space-y-6">`
      + `<div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500">`
      + `<span class="text-blue-600">1. ${esc(T(forgotPasswordPlan.stepEmailKey))}</span>`
      + `<span class="text-gray-500">2. ${esc(T(forgotPasswordPlan.stepCodeKey))}</span>`
      + `<span class="text-gray-500">3. ${esc(T(forgotPasswordPlan.stepPasswordKey))}</span>`
      + `</div>`
      + `<form class="space-y-5">`
      + `<div>`
      + `<label for="reset-email" class="block text-sm font-medium text-gray-700">${esc(T(forgotPasswordPlan.emailLabelKey))}</label>`
      + `<input id="reset-email" type="email" autocomplete="email" readonly class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500" placeholder="${esc(T(loginPlan.emailLabelKey))}" />`
      + `</div>`
      + `<p class="text-xs text-gray-500">${esc(T(forgotPasswordPlan.requestMessageKey))}</p>`
      + `<div class="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">${esc(T(forgotPasswordPlan.sendCodeKey))}</div>`
      + `</form>`
      + `<div class="text-center">`
      + `<span class="text-sm font-medium text-orange-600 hover:text-orange-500">${esc(T(forgotPasswordPlan.backToLoginKey))}</span>`
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
      + `<h1 class="text-3xl font-bold text-gray-900 mb-2">${esc(T(paymentPlan.titleKey))}</h1>`
      + `<p class="text-gray-600">${esc(T(paymentPlan.subtitleKey))}</p>`
      + `</div>`
      + `<div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">`
      + `<div class="text-4xl mb-3">💼</div>`
      + `<h2 class="text-xl font-semibold text-gray-900 mb-2">${esc(T(paymentPlan.noJobTitleKey))}</h2>`
      + `<p class="text-gray-600 max-w-lg mx-auto mb-5">${esc(T(paymentPlan.noJobTextKey))}</p>`
      + `<div class="inline-flex items-center rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white">${esc(T(paymentPlan.noJobCtaKey))}</div>`
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
      + `<h1 class="text-3xl md:text-4xl font-bold mb-4">${esc(T(howItWorksPlan.titleKey))}</h1>`
      + `<p class="text-lg opacity-90 max-w-2xl mx-auto">${esc(T(howItWorksPlan.heroKey))}</p>`
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
      + `<h2 class="text-2xl md:text-3xl font-bold text-emerald-900 mb-3">${esc(T(howItWorksPlan.escrowTitleKey))}</h2>`
      + `<p class="text-emerald-800">${esc(T(howItWorksPlan.escrowTextKey))}</p>`
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
      + `<h2 class="text-2xl md:text-3xl font-bold text-gray-900 text-center mb-8">${esc(T(howItWorksPlan.faqTitleKey))}</h2>`
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
      + `<h2 class="text-2xl md:text-3xl font-bold mb-4">${esc(T(howItWorksPlan.readyTitleKey))}</h2>`
      + `<div class="flex flex-col sm:flex-row gap-4 justify-center">`
      + `<a href="/register?type=client" class="bg-white text-orange-600 hover:bg-gray-100 px-8 py-4 rounded-xl font-semibold transition">${esc(T(howItWorksPlan.lookingKey))}</a>`
      + `<a href="/register?type=worker" class="border-2 border-white text-white hover:bg-white hover:text-orange-600 px-8 py-4 rounded-xl font-semibold transition">${esc(T(howItWorksPlan.offerKey))}</a>`
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
    //
    // Aucun LIBELLÉ en dur : les douze venaient du plan, et les cinq de la
    // carte de suivi étaient écrits ici, en français, en double du
    // dictionnaire de la page (titre, sous-titre, deux placeholders, bouton)
    // — corriger l'un laissait l'autre derrière. Ils sont désormais déclarés
    // par le plan et résolus par T(), comme les autres. Ce qui reste littéral
    // ici est décoratif (emoji de la pastille), pas de la copie.
    // Les `aria-label` portent LES MÊMES clés que les placeholders : c'est
    // ce que fait src/components/TicketTracker.js, donc la coquille et le
    // runtime ne peuvent plus annoncer deux libellés différents.
    support: `<div class="h-16 bg-white border-b border-gray-200"></div>`
      + `<div class="max-w-2xl mx-auto px-4 py-8">`
      + `<div class="mb-6 text-center">`
      + `<h1 class="text-3xl font-bold text-gray-900 mb-2">${esc(T(supportPlan.titleKey))}</h1>`
      + `<p class="text-gray-600">${esc(T(supportPlan.subtitleKey))}</p>`
      + `</div>`
      + `<div class="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">`
      + `<h2 class="text-lg font-semibold text-gray-900 mb-1">${esc(T(supportPlan.tracker.titleKey))}</h2>`
      + `<p class="text-sm text-gray-500 mb-4">${esc(T(supportPlan.tracker.subtitleKey))}</p>`
      + `<div class="flex flex-col sm:flex-row gap-2">`
      + `<input type="text" readonly placeholder="${esc(T(supportPlan.tracker.idPlaceholderKey))}" aria-label="${esc(T(supportPlan.tracker.idPlaceholderKey))}" class="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm" />`
      + `<input type="email" readonly placeholder="${esc(T(supportPlan.tracker.emailPlaceholderKey))}" aria-label="${esc(T(supportPlan.tracker.emailPlaceholderKey))}" class="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm" />`
      + `<div class="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white opacity-50">${esc(T(supportPlan.tracker.ctaKey))}</div>`
      + `</div>`
      + `</div>`
      + `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">`
      + supportPlan.modes
          .map(
            ({ shellIcon, badgeClass, titleKey, subtitleKey }) =>
              `<div class="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm transition-all">` +
              `<span class="flex h-12 w-12 items-center justify-center rounded-full ${badgeClass}">${shellIcon}</span>` +
              `<span class="font-semibold text-gray-900">${esc(T(titleKey))}</span>` +
              `<span class="text-xs text-gray-500">${esc(T(subtitleKey))}</span>` +
              `</div>`
          )
          .join('') +
      `</div>`
      + `<div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">`
      + `<h2 class="text-xl font-semibold text-gray-900 mb-1">${esc(T(supportPlan.directCard.titleKey))}</h2>`
      + `<p class="text-sm text-gray-500 mb-5">${esc(T(supportPlan.directCard.subtitleKey))}</p>`
      + `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">`
      + supportPlan.rows
          .map((row) => {
            const interieur =
              `<span class="flex h-10 w-10 items-center justify-center rounded-full ${row.badgeClass}">${row.shellIcon}</span>` +
              `<div><div class="text-sm font-semibold text-gray-900">${esc(T(row.labelKey))}</div>` +
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
            ({ icon, labelKey, badgeClass, href, value, external, breakAll }) =>
              `<a href="${esc(href)}"` +
              (external ? ` target="_blank" rel="noreferrer"` : '') +
              ` class="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">` +
              `<span class="flex h-10 w-10 items-center justify-center rounded-full ${badgeClass}">${icon}</span>` +
              `<div><div class="text-sm font-semibold text-gray-900">${esc(T(labelKey))}</div>` +
              `<div class="text-xs text-gray-500${breakAll ? ' break-all' : ''}">${esc(value)}</div></div>` +
              `</a>`
          )
          .join('') +
      `</div>`
      + `<iframe src="${esc(contact.mapsEmbedUrl)}" title="${esc(T('mapIframeTitle').replace('{address}', contact.address))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" class="mt-6 w-full rounded-xl border border-gray-200" style="height:320px;border:0;"></iframe>`
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
  return SHELLS
}

