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
 * Nom de la balise qui publie la RÉVISION dont le frontend a été construit.
 *
 * Deux lecteurs, un seul nom : le build l'écrit (`vite-plugins/inject-build-revision.js`),
 * et `scripts/check-deployed-revision.js` la lit dans le HTML SERVI pour
 * comparer à ce que `main` aurait dû déployer. Elle vit ici pour la même raison
 * que `SITE_ORIGIN` : deux modules qui recopient un nom de balise se
 * désynchronisent au premier renommage, et le garde lirait alors une balise qui
 * n'existe plus — un vert sur du vide.
 */
export const BUILD_REVISION_META = 'kojo-build-revision';

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

/** Hôtes qui désignent CETTE machine (loopback). */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];

/**
 * L'adresse désigne-t-elle CETTE machine ?
 *
 * Deux gardes posaient séparément la même question, avec deux règles qui
 * n'étaient pas d'accord : `check-og-job-200.js` (qui ÉCRIT — POST puis DELETE
 * d'une mission de test) refusait `0.0.0.0`, la casse différente et le moindre
 * chemin ; `check-seo-production.js` acceptait les trois. Deux définitions pour
 * une seule question, c'est une divergence qui attend son jour — et le garde qui
 * écrit est celui qui avait la règle la PLUS stricte, donc rien ne l'aurait dit.
 *
 * La règle est ici, et les trois différences sont arbitrées, pas héritées :
 *   • `0.0.0.0` n'est PAS une adresse locale — c'est l'adresse NON SPÉCIFIÉE,
 *     une adresse d'ÉCOUTE (c'est ainsi que `vite.config.js` s'y lie). Elle est
 *     donc écartée : l'ancienne règle permissive la disait « locale » à tort ;
 *   • la casse ne décide rien : `new URL()` abaisse l'hôte, donc
 *     `HTTP://LOCALHOST:8000` est reconnu — avant, le garde d'écriture le
 *     refusait et SAUTAIT un cycle qu'il pouvait légitimement exercer ;
 *   • le chemin ne décide rien non plus : c'est l'HÔTE qui dit « local »
 *     (`http://127.0.0.1:8000/api` reste cette machine).
 *
 * Elle lit l'URL au lieu d'un motif textuel : `127.0.0.1.evil.test` a bien pour
 * hôte `127.0.0.1.evil.test`, donc il est refusé par construction — un suffixe
 * qui imite un hôte local ne passe pas par la forme du motif.
 *
 * @param {string} value URL à examiner (schéma `http`/`https` exigé).
 * @returns {boolean} Vrai si l'URL a un hôte loopback et un schéma http(s).
 */
export function isLoopbackUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch (_e) {
    // Pas une URL absolue : « localhost:8000 » sans schéma est un schéma nommé
    // « localhost: », pas une adresse — la comparaison d'hôte serait vide.
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // `URL.hostname` rend un littéral IPv6 ENTRE CROCHETS (« [::1] ») : compare
  // sans eux, sinon `http://[::1]:8000` — pourtant la même adresse — serait
  // refusé par un détail de notation.
  const hote = url.hostname.replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.includes(hote);
}

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
 * Texte de l'élément `<title>` servi — ce qu'un moteur affiche comme titre du
 * résultat, et ce qu'un onglet de navigateur montre.
 *
 * Il vit ici, avec `metaContents`/`canonicalHref`, pour la même raison qu'eux :
 * la sonde de production lit le `<title>` de chaque page du sitemap, et un
 * motif recopié par lecteur serait une occasion de divergence de plus.
 *
 * @param {string} html HTML complet.
 * @returns {string} Le titre, espaces de bord retirés, ou `''` si absent.
 */
export function titleOf(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html));
  return match ? match[1].trim() : '';
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
