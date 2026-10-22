/**
 * LIRE ET COMPARER UNE CSP DANS UN DOCUMENT — la règle, partagée.
 *
 * Deux lecteurs ont besoin de la MÊME règle : le contrat hors ligne
 * (`check-csp-contract.js`, qui juge les documents rendus par le backend) et la
 * sonde de production (`check-csp-documents-production.js`, qui juge les
 * documents SERVIS). Deux copies de cette lecture divergeraient au premier
 * guillemet exotique, et l'une des deux rendrait alors un verdict sur autre
 * chose que ce qu'elle croit lire.
 *
 * Les deux fonctions sont PURES : aucun accès disque, aucun réseau. C'est ce
 * qui permet de prouver qu'elles savent échouer sans toucher au dépôt.
 */

/** Le nom de l'en-tête, tel qu'une balise `<meta>` l'écrit. */
export const ENTETE_CSP = 'Content-Security-Policy';

/** La directive qui n'a RIEN à faire dans une balise `<meta>`. */
export const DIRECTIVE_ENTETE = 'frame-ancestors';

/**
 * Les entités qu'un échappeur d'attribut peut écrire.
 *
 * `&amp;` est en DERNIER : décoder dans l'autre ordre transformerait un
 * `&amp;quot;` littéral en `"` (double décodage).
 */
const ENTITES = [
  ['&quot;', '"'],
  ['&apos;', "'"],
  ['&#x27;', "'"],
  ['&#39;', "'"],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&amp;', '&'],
];

/**
 * Ce que le NAVIGATEUR lit d'un attribut : la valeur décodée.
 *
 * Le backend échappe `&`, `<`, `>` et `"` (jamais l'apostrophe, ordinaire entre
 * guillemets doubles — cf. `_echapper_attribut` dans `backend/kojo_csp.py`),
 * Vite écrit la valeur telle quelle. Comparer les octets BRUTS ferait échouer un
 * garde sur une politique correcte, et pousserait à changer l'échappement pour
 * faire passer un test — exactement ce qu'un garde ne doit pas provoquer.
 *
 * @param {string} valeur Valeur brute d'un attribut.
 * @returns {string} Valeur décodée.
 */
export const decoderEntites = (valeur) =>
  ENTITES.reduce((texte, [entite, char]) => texte.split(entite).join(char), String(valeur || ''));

/**
 * La politique publiée par un document, ou '' s'il n'en publie aucune.
 *
 * Tolérant sur l'ordre des attributs (le backend écrit `http-equiv` puis
 * `content`, Vite peut changer demain) et sur les guillemets.
 *
 * @param {string} html Document servi ou rendu.
 * @returns {string} Politique décodée, ou ''.
 */
export const cspDeDocument = (html) => {
  const texte = String(html || '');
  for (const balise of texte.match(/<meta\b[^>]*>/gi) || []) {
    if (!new RegExp(`http-equiv\\s*=\\s*["']?${ENTETE_CSP}["']?`, 'i').test(balise)) continue;
    const trouve = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(balise);
    if (!trouve) return '';
    return decoderEntites(trouve[1] !== undefined ? trouve[1] : trouve[2]);
  }
  return '';
};

/**
 * Les directives d'une politique, dans l'ordre, avec leurs sources.
 *
 * @param {string} csp Politique complète.
 * @returns {Array<{nom: string, sources: string[]}>}
 */
export const directivesDe = (csp) =>
  String(csp || '')
    .split(';')
    .map((partie) => partie.trim())
    .filter(Boolean)
    .map((partie) => {
      const [nom, ...sources] = partie.split(/\s+/);
      return { nom, sources };
    });

/**
 * Ce qui SÉPARE deux politiques, directive par directive.
 *
 * Un message qui publie deux chaînes de 600 caractères ne dit pas au lecteur ce
 * qu'il doit corriger ; celui-ci nomme la directive et les sources en écart.
 * C'est aussi ce qui rend les mutations utiles : neutraliser la comparaison
 * globale rougit, mais un écart qui ne nomme rien ne se relit pas.
 *
 * @param {object} options
 * @param {string} options.attendue Politique du site (référence).
 * @param {string} options.servie Politique du document jugé.
 * @returns {string[]} Écarts lisibles (vide = politiques égales sur les directives).
 */
export const ecartsDePolitiques = ({ attendue, servie }) => {
  const reference = directivesDe(attendue);
  const jugee = directivesDe(servie);
  const ecarts = [];
  if (!reference.length) return ['la politique de référence est VIDE — rien à comparer'];
  if (!jugee.length) return ['la politique jugée est VIDE — rien n’est publié'];

  const parNom = new Map(jugee.map((directive) => [directive.nom, directive.sources]));
  for (const { nom, sources } of reference) {
    const presentes = parNom.get(nom);
    if (!presentes) {
      ecarts.push(`« ${nom} » est ABSENTE du document (le site la publie : ${sources.join(' ')})`);
      continue;
    }
    parNom.delete(nom);
    const manquantes = sources.filter((source) => !presentes.includes(source));
    const enTrop = presentes.filter((source) => !sources.includes(source));
    if (manquantes.length) {
      ecarts.push(`« ${nom} » n'autorise pas ${manquantes.join(', ')} (le site l'autorise)`);
    }
    if (enTrop.length) {
      ecarts.push(`« ${nom} » autorise en plus ${enTrop.join(', ')} (le site ne l'autorise pas)`);
    }
  }
  for (const [nom, sources] of parNom) {
    ecarts.push(`« ${nom} » n'existe QUE dans le document (${sources.join(' ')})`);
  }
  // Mêmes directives, mêmes sources — et pourtant deux chaînes différentes :
  // un ordre, une casse ou une répétition. La politique du site est comparée
  // octet pour octet ailleurs (contrat JS ↔ Python) : ici, le dire évite qu'un
  // écart de forme passe pour une égalité.
  if (!ecarts.length && servie !== attendue) {
    ecarts.push(
      'les mêmes directives sont publiées, mais la politique n’est pas la MÊME CHAÎNE ' +
        '(ordre, casse ou répétition) — le site et le document doivent servir les mêmes octets'
    );
  }
  return ecarts;
};
