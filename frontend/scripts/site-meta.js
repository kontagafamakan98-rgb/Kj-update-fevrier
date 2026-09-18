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
 * Même cause pour la lecture des balises du HTML servi : chaque garde portait sa
 * requête, avec deux fragilités réelles — l'attribut cherché devait PRÉCÉDER
 * `content=` (donc `<meta content="…" property="og:image">` était invisible), et
 * seule la citation double était acceptée.
 *
 * Et pour la correspondance route → fichier de coquille (`shellFileFor`) : elle
 * était écrite dans le build ET dans trois gardes, plus une liste de fichiers
 * recopiée — voir sa définition.
 */

/** Origine publique canonique du site (l'alias Vercel y redirige en 308). */
export const SITE_ORIGIN = 'https://kojoforafrica.cc.cd';

/**
 * Origine de l'API que ce site appelle en direct depuis le navigateur.
 *
 * Elle vit ici, avec `SITE_ORIGIN`, parce que les deux forment UNE paire : le
 * backend n'accepte que les origines qu'il déclare (`allowed_origins`, dérivé
 * de `FRONTEND_APP_URL` + `CORS_ORIGINS`), donc publier le site sur une nouvelle
 * origine sans que le backend la connaisse casse le site sans une ligne de
 * journal serveur — le préflight est refusé par Starlette AVANT les routes.
 * Constaté le 18/09/2026, et c'est ce que rejoue `check-cors-preflight.js`.
 *
 * Elle était recopiée dans `check-og-images.js`, `check-og-job-200.js`
 * (`DEFAULT_BACKEND`) et deux fois dans `vite.config.js` : quatre copies du même
 * fait, dont aucune n'était comparée à l'origine du site.
 */
export const API_ORIGIN = 'https://api.kojoforafrica.cc.cd';

/**
 * Fichier de coquille pré-rendue qui SERT une route — la seule définition de
 * cette correspondance.
 *
 * Elle était écrite SIX fois : par le build qui écrit les fichiers
 * (`vite.config.js`), par les deux gardes qui les relisent (`check-page-meta.js`,
 * `check-prerender-shells.js`), par la liste `PRERENDERED_PAGES` écrite à la main
 * dans `check-home-shell.js`, par le routage attendu de `check-spa-routes.js`, et
 * dans la fixture du test de `check-page-meta.js`. Une copie qui dérive de
 * quelques caractères ne casse rien tout de suite : elle fait chercher un fichier
 * qui n'existe pas (ou ignorer un fichier écrit), donc la vérification porte sur
 * du vide au lieu de rougir.
 *
 * @param {string} route Route publique, slash initial compris (« / », « /jobs »).
 * @returns {string} Nom du fichier dans `build/` (« index.html », « jobs.html »).
 */
export const shellFileFor = (route) =>
  route === '/' ? 'index.html' : `${route.slice(1)}.html`;

/**
 * Attributs d'une balise, quel que soit leur ordre et le type de citation.
 *
 * ⚠️ La citation qui FERME doit être la même que celle qui ouvre : un motif du
 * type `[\"']([^\"']*)[\"']` tronque toute valeur contenant une apostrophe — la
 * description de l'accueil (« … en Côte d'Ivoire ») s'y lisait 104 caractères
 * au lieu de 151, ce qui a publié un faux chiffre dans CI-COVERAGE.md (F9).
 *
 * @param {string} tag Balise complète, `<` compris.
 * @returns {Object<string, string>} Attributs en minuscules, la dernière
 *   occurrence gagnant (comme un analyseur HTML).
 */
function attributesOf(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([a-zA-Z-]+)\s*=\s*(\"([^\"]*)\"|'([^']*)')/g)) {
    attributes[match[1].toLowerCase()] = match[3] !== undefined ? match[3] : match[4];
  }
  return attributes;
}

/**
 * Contenus des balises `<meta>` qui DÉCLARENT `key` — par `name=`, `property=`
 * ou `itemprop=`, dans l'ordre du document.
 *
 * L'appelant n'a donc pas à savoir PAR QUEL attribut la métadonnée est portée :
 * `og:image` est déclarée en `property=` et `twitter:image` en `name=`. Comme
 * `og:image` est présente deux fois (variante large + carrée), c'est une liste
 * qui est renvoyée.
 *
 * @param {string} html HTML complet.
 * @param {string} key  Métadonnée cherchée (`og:image`, `description`, `robots`…).
 * @returns {string[]} Contenus (chaîne vide pour une balise sans `content`).
 */
export function metaContents(html, key) {
  const wanted = String(key).toLowerCase();
  const contents = [];
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
    const attributes = attributesOf(tag);
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
 * `href` du `<link rel="canonical">` servi — l'adresse que la page réclame
 * comme la sienne.
 *
 * C'est la valeur qui rend une migration de domaine visible : le HTML peut
 * continuer d'annoncer l'ancien hôte après la bascule, et un crawler suit ce
 * qu'il lit, pas ce qu'on croit avoir déployé.
 *
 * @param {string} html HTML complet.
 * @returns {string} L'adresse annoncée, ou `''` si la balise est absente.
 */
export function canonicalHref(html) {
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    const attributes = attributesOf(tag);
    if (String(attributes.rel || '').toLowerCase() === 'canonical') return attributes.href || '';
  }
  return '';
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
