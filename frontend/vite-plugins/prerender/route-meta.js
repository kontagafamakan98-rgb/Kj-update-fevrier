// Le texte d'une route (titre, description, og:*, twitter:*) et ses cartes
// OG : écrit par UNE fonction, pour index.html comme pour les coquilles.

// Titre et description par route : plus AUCUN texte écrit ici.
// La table UNIQUE est src/config/page-meta.js (clés i18n), la même que
// lit le runtime via usePageMeta() — donc un texte corrigé d'un côté
// ne peut plus laisser l'autre annoncer l'ancien (la coquille et la
// page sont comparées hors ligne par scripts/check-page-meta.js).

// Remplace content="..." d'une meta mono ou multi-lignes.
export function setMeta(htmlIn, key, value) {
  const re = new RegExp(`(<meta\\s+(?:property|name)="${key}"[^>]*?content=")[^"]*(")`)
  return htmlIn.replace(re, `$1${value}$2`)
}

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
export function makeWriteRouteText({ pageMeta, T }) {
  return (htmlIn, routePath) => {
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
}

// Applique à une coquille les méta qui dépendent de la route : canonical,
// carte OG (wide + variante carrée), og:url et twitter:*.

export function applyOgCard({ html, routePath, route, origin, card, writeRouteText, setMeta }) {
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
  return out
}

