// Injecte la CSP stricte dans le HTML de production.

export function injectProductionCspPlugin({ env, mode, apiOrigin }) {
  return {
    // CSP injectée UNIQUEMENT en build de production (le dev Vite a besoin
    // de scripts inline/HMR). Durcissement XSS : bloque les scripts
    // externes injectés et eval, sans casser le bundling Vite.
    name: 'inject-production-csp',
    transformIndexHtml(html) {
      if (mode !== 'production') return html
      // Le script Plausible est chargé via src depuis un module bundlé ;
      // son domaine n'est autorisé dans script-src QUE si l'analytics est
      // réellement configurée (sinon surface d'attaque inutile).
      const plausibleDomain = (env.VITE_PLAUSIBLE_DOMAIN || '').trim()
      // Le SDK Google Identity Services (bouton SSO) est chargé dynamiquement
      // depuis accounts.google.com/gsi/client : sans cette entrée dans
      // script-src, la CSP le bloque et le bouton Google échoue avec
      // « Impossible de charger le SDK Google » (script.onerror).
      const scriptSrc = ["'self'", 'https://accounts.google.com']
      if (plausibleDomain) scriptSrc.push('https://plausible.io')
      // Google Analytics 4 : uniquement si un identifiant est configuré
      // (sinon surface d'attaque inutile). googletagmanager.com sert
      // gtag.js ; les collectes partent vers google-analytics.com
      // (connect-src) et une balise de repli est chargée en <img>
      // (img-src) — sans ces trois entrées, GA serait bloqué en silence.
      const gaMeasurementId = String(env.VITE_GA_MEASUREMENT_ID || '').trim()
      const gaEnabled = /^G-[A-Z0-9]+$/i.test(gaMeasurementId)
      if (gaEnabled) scriptSrc.push('https://www.googletagmanager.com')
      const connectSrc = ["'self'", apiOrigin, 'https://accounts.google.com']
      const imgSrc = [
        "'self'",
        'data:',
        'blob:',
        'https://res.cloudinary.com',
        'https://tile.openstreetmap.org',
      ]
      if (gaEnabled) {
        connectSrc.push(
          'https://www.google-analytics.com',
          'https://region1.google-analytics.com'
        )
        imgSrc.push('https://www.google-analytics.com')
      }
      const csp = [
        "default-src 'self'",
        `script-src ${scriptSrc.join(' ')}`,
        "style-src 'self' 'unsafe-inline'",
        `img-src ${imgSrc.join(' ')}`,
        // Géolocalisation 100% centralisée derrière le backend Kojo :
        // détection IP (/geolocation/detect), reverse geocoding
        // (/geolocation/reverse) et base villes/quartiers
        // (/geolocation/cities) passent tous par apiOrigin. Plus aucun
        // appel direct à ipapi.co / ipinfo.io / nominatim depuis le
        // navigateur → connect-src réduit au strict minimum (Google
        // Identity Services ajouté pour le SSO).
        `connect-src ${connectSrc.join(' ')}`,
        // Cartes : les aperçus de localisation sont des iframes
        // (CreateJob / JobCreateModal → buildMapEmbedUrl) Google Maps ou
        // OpenStreetMap. Sans frame-src, default-src 'self' les bloque
        // (console : « Refused to frame »). accounts.google.com est
        // nécessaire au sélecteur de compte du SSO Google.
        "frame-src 'self' https://www.google.com https://www.openstreetmap.org https://accounts.google.com",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        // frame-ancestors est IGNORÉ dans une balise <meta> (navigateurs) et
        // provoque un warning console à chaque chargement de page. Il est
        // envoyé comme véritable en-tête HTTP dans frontend/vercel.json.
        "worker-src 'self'",
        "manifest-src 'self'",
      ].join('; ')
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}
