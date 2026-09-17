/**
 * Identité publique du site — ORIGINE canonique et lecture des balises du HTML
 * servi — possédée une seule fois pour tous les gardes de scripts/.
 *
 * L'origine était déclarée dans `check-og-images.js` et
 * `check-seo-production.js`, recopiée dans les sept assertions de
 * `check-prerender-shells.js` et figée une fois de plus par un test qui
 * l'affirmait. La migration de domaine du 17/09/2026 a dû les éditer un par un :
 * c'est cette copie-là que ce module supprime. La valeur d'`index.html` (du
 * HTML, qui ne peut rien importer) reste vérifiée par les gardes de build, qui
 * publient CETTE origine ou échouent.
 *
 * Même cause pour la lecture des `<meta>` : chaque garde portait sa requête,
 * avec deux fragilités réelles — `content=` devait SUIVRE l'attribut cherché
 * (donc `<meta content="…" property="og:image">` était invisible), et seule la
 * citation double était acceptée.
 */

/** Origine publique canonique du site (l'alias Vercel y redirige en 308). */
export const SITE_ORIGIN = 'https://kojoforafrica.cc.cd';

/**
 * Contenus des balises `<meta>` qui DÉCLARENT `key` — par `name=`, `property=`
 * ou `itemprop=`, dans l'ordre du document.
 *
 * L'appelant n'a donc pas à savoir PAR QUEL attribut la métadonnée est portée :
 * `og:image` est déclarée en `property=` et `twitter:image` en `name=`. Comme
 * `og:image` est présente deux fois (variante large + carrée), c'est une liste
 * qui est renvoyée.
 *
 * ⚠️ La citation qui FERME doit être la même que celle qui ouvre : un motif du
 * type `["']([^"']*)["']` tronque toute valeur contenant une apostrophe — la
 * description de l'accueil (« … en Côte d'Ivoire ») s'y lisait 104 caractères
 * au lieu de 151, ce qui a publié un faux chiffre dans CI-COVERAGE.md (F9).
 *
 * @param {string} html HTML complet.
 * @param {string} key  Métadonnée cherchée (`og:image`, `description`, `robots`…).
 * @returns {string[]} Contenus (chaîne vide pour une balise sans `content`).
 */
export function metaContents(html, key) {
  const wanted = String(key).toLowerCase();
  const contents = [];
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
    const attributes = {};
    for (const match of tag.matchAll(/([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attributes[match[1].toLowerCase()] = match[3] !== undefined ? match[3] : match[4];
    }
    const declares =
      attributes.name === wanted ||
      attributes.property === wanted ||
      attributes.itemprop === wanted;
    if (declares) contents.push(attributes.content || '');
  }
  return contents;
}

/**
 * Premier contenu déclarant `key`, ou `''` si la balise est absente.
 *
 * @param {string} html HTML complet.
 * @param {string} key  Métadonnée cherchée.
 * @returns {string} Contenu de la première balise, ou chaîne vide.
 */
export function metaContent(html, key) {
  return metaContents(html, key)[0] || '';
}

/**
 * La réponse interdit-elle l'indexation ?
 *
 * Les deux canaux comptent : l'en-tête `x-robots-tag` et `<meta name="robots">`.
 * Une fiche de mission supprimée qui n'en porterait aucun resterait indexable.
 *
 * @param {string} html Corps de la réponse.
 * @param {string} [robotsTag] Valeur de l'en-tête `x-robots-tag`.
 * @returns {boolean} Vrai si au moins un des deux canaux interdit l'indexation.
 */
export function declaresNoIndex(html, robotsTag = '') {
  if (/noindex/i.test(robotsTag || '')) return true;
  return metaContents(html, 'robots').some((value) => /noindex/i.test(value));
}
