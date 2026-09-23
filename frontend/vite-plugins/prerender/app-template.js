// Le gabarit des routes CLIENTES : app.html, servi aux routes privées qui
// n'ont aucun contenu statique propre. Il doit rester NU (aucun canonical,
// aucun JSON-LD) et se dire non indexable.

export function buildAppTemplate({ html, T, setMeta }) {
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
  // Ces deux textes appartiennent au dictionnaire : app.html sert dix routes
  // privées, et une phrase recopiée ici serait un second domicile. T() lève
  // si la clé manque → le build refuse la divergence au lieu de publier des
  // métadonnées neutres périmées.
  const neutralTitle = T('neutralTitle')
  const neutralDescription = T('neutralDescription')
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
  return appHtml
}

