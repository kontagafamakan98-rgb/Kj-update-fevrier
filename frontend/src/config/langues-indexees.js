// ── LES LANGUES QUI ONT UNE URL PROPRE, DONC UN DOCUMENT ────────────────────
//
// Mesuré le 30/10/2026 (constat F5 de l'audit du 27/10) : le site publiait 976
// clés en cinq langues (fr, en, wo, bm, mos) mais UNE seule surface indexable —
// `<html lang="fr">` sur les douze documents pré-rendus, une URL par page, et
// AUCUN `hreflang`. Un moteur ne pouvait donc pas savoir qu'une version
// anglaise existait, et un visiteur anglophone n'y arrivait qu'en cliquant le
// sélecteur du site.
//
// Les CINQ langues de l'interface sont indexées depuis le 01/11/2026, et c'est
// une conséquence MESURÉE, pas une ambition : les cinq dictionnaires portent les
// mêmes 976 clés à parité (`i18nParity.test.js`), aucune valeur de `wo`/`bm`/`mos`
// n'est une copie du français ou de l'anglais et la dette de traduction y est
// vide depuis le 20/10/2026 (`i18nLangue.test.js`) — donc les coquilles se
// construisent dans ces trois langues avec le même code, sans une ligne de plus
// (cf. vite-plugins/prerender-route-meta.js, qui boucle sur cette liste).
//
// Ce qui avait retenu la déclaration au 30/10/2026 était l'inverse de ce qu'on
// croyait : ce n'était pas une traduction absente, c'était un doute de QUALITÉ
// (`src/i18n/alertes-emploi-revue-native.md` : les 27 termes inventés ou
// empruntés attendent une relecture par un locuteur natif). Publier une page
// n'est pas certifier sa langue : le fait publié ici est « cette URL existe et
// se déclare comme le wolof, le bambara ou le mooré », et les gardes tiennent
// les trois propriétés qui le rendent vrai (document écrit, `lang`, alternatives
// réciproques). La relecture native reste une dette de CONTENU, déclarée.
//
// Un `hreflang` vers une page qui n'existe pas reste une déclaration fausse :
// c'est la règle que les gardes tiennent (scripts/check-prerender-shells.js),
// et c'est elle qui a fait de ce fichier la seule porte à ouvrir.
//
// Ce que ce fichier décide, et qui d'autre le lit :
//   • le PRÉFIXE d'URL de chaque langue (`''` pour la langue par défaut, donc
//     l'adresse d'avant est celle du français — aucune URL existante ne bouge) ;
//   • le `lang` du document et le `og:locale` (vite-plugins/prerender/hreflang.js) ;
//   • les alternatives `hreflang` d'une page, dont le `x-default` ;
//   • le fichier écrit pour chaque langue (build/<préfixe>/<route>.html) ;
//   • le sitemap du backend, qui doit publier les mêmes URL (le test Python
//     compare cette déclaration à la sienne, `backend/tests/test_hreflang_sitemap.py`).
//
// Aucune valeur n'est recopiée : ajouter une langue ici la fait apparaître dans
// les documents, le sitemap et les gardes, ou fait rougir celui qui ne suit pas.

export const LANGUES_INDEXEES = [
  // La langue par défaut : AUCUN préfixe, donc l'URL d'une page est celle
  // qu'elle avait avant le 30/10/2026 (`/jobs`), et le `x-default` pointe ici.
  { code: 'fr', prefixe: '', htmlLang: 'fr', ogLocale: 'fr_FR' },
  // L'anglais — la langue qui a servi de seconde preuve le 30/10/2026.
  { code: 'en', prefixe: 'en', htmlLang: 'en', ogLocale: 'en_US' },
  // Les trois langues nationales du marché (Sénégal, Mali, Burkina Faso).
  // `og:locale` porte le TERRITOIRE de référence de chaque langue, comme
  // `fr_FR`/`en_US` : annoncer `wo` sans région ferait publier un `og:locale`
  // que les réseaux sociaux lisent mal (la forme attendue est langue_PAYS).
  { code: 'wo', prefixe: 'wo', htmlLang: 'wo', ogLocale: 'wo_SN' },
  { code: 'bm', prefixe: 'bm', htmlLang: 'bm', ogLocale: 'bm_ML' },
  { code: 'mos', prefixe: 'mos', htmlLang: 'mos', ogLocale: 'mos_BF' },
];

/** La langue d'une URL sans préfixe — celle que le `x-default` désigne. */
export const LANGUE_PAR_DEFAUT = 'fr';

/** La valeur `hreflang` de repli, celle que Google exige en plus des langues. */
export const LANGUE_DE_SECOURS = 'x-default';

/** La déclaration d'une langue indexée, ou null. */
export const langueIndexee = (code) =>
  LANGUES_INDEXEES.find((langue) => langue.code === code) || null;

/** Le préfixe d'URL d'une langue (`''` quand elle n'en a pas). */
export const prefixeDeLaLangue = (code) => (langueIndexee(code) || {}).prefixe || '';

/**
 * Le chemin d'une page DANS une langue.
 *
 * `('/jobs', 'en')` → `/en/jobs` ; `('/', 'en')` → `/en` (pas de barre finale :
 * c'est la forme que le rewrite Vercel et le sitemap publient) ; toute langue
 * sans préfixe rend le chemin tel quel.
 *
 * @param {string} chemin Chemin sans langue (`/`, `/jobs`…).
 * @param {string} code   Code d'une langue indexée.
 * @returns {string} Le chemin publié pour cette langue.
 */
export function cheminDansLaLangue(chemin, code) {
  const base = String(chemin || '/');
  const prefixe = prefixeDeLaLangue(code);
  if (!prefixe) return base;
  return base === '/' ? `/${prefixe}` : `/${prefixe}${base}`;
}

/**
 * La langue d'un chemin, lue sur son PREMIER segment — null s'il n'en porte pas.
 *
 * Un segment qui n'appartient à aucune langue (`/jobs`) ne fait pas de la page
 * une page « inconnue » : c'est la langue par défaut, et l'appelant décide.
 *
 * @param {string} chemin Chemin éventuellement préfixé (`/en/jobs`).
 * @returns {string|null} Le code de la langue, ou null.
 */
export function langueDuChemin(chemin) {
  const segment = String(chemin || '').split(/[?#]/)[0].split('/')[1] || '';
  const trouvee = LANGUES_INDEXEES.find(
    (langue) => langue.prefixe && langue.prefixe === segment
  );
  return trouvee ? trouvee.code : null;
}

/**
 * Le chemin SANS son préfixe de langue (`/en/jobs` → `/jobs`).
 *
 * C'est ce que le routeur de l'application attend : ses routes sont déclarées
 * sans langue, et le préfixe est porté par le `basename` du routeur.
 *
 * @param {string} chemin Chemin éventuellement préfixé.
 * @returns {string} Le chemin sans langue, jamais vide (`/` au minimum).
 */
export function cheminSansPrefixe(chemin) {
  const brut = String(chemin || '/');
  if (!langueDuChemin(brut)) return brut;
  const reste = brut.split(/[?#]/)[0].split('/').slice(2).join('/');
  return reste ? `/${reste}` : '/';
}

/**
 * Le FICHIER servi pour une page dans une langue, relatif à `build/`.
 *
 * `fichierDansLaLangue('fr', 'jobs.html')` → `jobs.html` ;
 * `fichierDansLaLangue('en', 'jobs.html')` → `en/jobs.html`.
 *
 * Le nom de BASE n'est pas recalculé ici : il a un propriétaire
 * (`shellFileFor`, scripts/site-meta.js), et cette fonction n'ajoute que le
 * préfixe de la langue. Le build écrit ces noms, le garde les relit, le
 * rewrite Vercel les sert : trois lectures d'une seule règle.
 *
 * @param {string} code   Code d'une langue indexée.
 * @param {string} fichier Nom du document sans langue (`jobs.html`).
 * @returns {string} Le même document, préfixé pour une langue préfixée.
 */
export function fichierDansLaLangue(code, fichier) {
  const prefixe = prefixeDeLaLangue(code);
  return prefixe ? `${prefixe}/${fichier}` : fichier;
}

/**
 * Les alternatives `hreflang` d'une page : une par langue indexée, plus le
 * `x-default` sur la langue par défaut.
 *
 * La MÊME liste est écrite dans CHAQUE document de la famille (fr et en) : deux
 * listes à tenir d'accord finiraient par diverger, et un `hreflang` réciproque
 * est ce que Google demande — une page B qui pointe A sans que A pointe B est
 * ignorée.
 *
 * @param {string} chemin Chemin sans langue (`/jobs`).
 * @param {string} origine Origine du site, sans barre finale.
 * @returns {Array<{hreflang: string, href: string}>} Les alternatives, dans
 *   l'ordre de la déclaration, le `x-default` en dernier.
 */
export function alternatesHreflang(chemin, origine) {
  const liens = LANGUES_INDEXEES.map((langue) => ({
    hreflang: langue.htmlLang,
    href: `${origine}${cheminDansLaLangue(chemin, langue.code)}`,
  }));
  return [
    ...liens,
    {
      hreflang: LANGUE_DE_SECOURS,
      href: `${origine}${cheminDansLaLangue(chemin, LANGUE_PAR_DEFAUT)}`,
    },
  ];
}
