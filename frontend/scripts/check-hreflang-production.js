#!/usr/bin/env node
/**
 * SONDE DE PRODUCTION — les documents `/en` servent-ils `lang`, `canonical` et
 * des `hreflang` RÉCIPROQUES, et le sitemap les énumère-t-il ?
 *
 * ── Le fait que cette sonde mesure ─────────────────────────────────────────
 * Depuis le 30/10/2026, le frontend publie un document par langue indexée
 * (`/jobs` en français, `/en/jobs` en anglais) et chaque document porte ses
 * `<link rel="alternate" hreflang>`. Trois gardes hors ligne le tiennent :
 * `frontend/scripts/check-prerender-shells.js` (section 10, sur l'ARTEFACT du
 * build), `backend/tests/test_hreflang_sitemap.py` (le sitemap annonce les
 * mêmes URL) et le test du module de déclaration. Aucun des trois ne peut dire
 * ce que le DÉPLOIEMENT sert :
 *
 *   • un rewrite Vercel perdu (`/en/jobs` → `/en/jobs.html`, cf.
 *     `frontend/vercel.json`) ne casse pas le build : il rend la 404, ou pire
 *     la coquille de l'application — un document VALIDE, à la mauvaise langue ;
 *   • un `lang="fr"` resté dans une coquille anglaise, un `canonical` qui pointe
 *     la version française ou une liste `hreflang` écrite d'un seul côté
 *     (« une page B qui pointe A sans que A pointe B est ignorée ») ne se voient
 *     ni dans git ni dans un test : ils se lisent sur l'origine servie ;
 *   • un sitemap qui n'énumère que le français dit au moteur que l'anglais
 *     n'existe pas, quelle que soit la qualité des documents.
 *
 * C'est exactement ce triangle que cette sonde mesure, une fois par jour.
 *
 * ── Ce qu'elle lit, et ce qu'elle ne RECOPIE pas ───────────────────────────
 *   • les ROUTES : `src/config/page-meta.js` (la table unique des pages
 *     pré-rendues) — une page ajoutée là est jugée le lendemain ;
 *   • les LANGUES et les URL : `src/config/langues-indexees.js`
 *     (`cheminDansLaLangue`, `alternatesHreflang`) — les mêmes fonctions que le
 *     build, donc la sonde juge la DÉCLARATION, pas une seconde copie ;
 *   • les pages MONOLINGUES : `src/config/liens-seo.js` (villes, métiers,
 *     guides) — elles ne doivent déclarer AUCUNE alternative ;
 *   • l'origine publiée : `SITE_ORIGIN` (`scripts/site-meta.js`), parce que les
 *     `canonical` et `hreflang` sont ABSOLUS dans les documents pré-rendus. Un
 *     `--base` de preview change où l'on DEMANDE les pages, jamais ce qu'elles
 *     doivent déclarer.
 *
 * ── Trois sorties, jamais deux ─────────────────────────────────────────────
 * 0 = chaque page déclarée sert, dans chaque langue, son `lang`, son
 *     `canonical`, la MÊME liste `hreflang` (réciproque, `x-default` compris),
 *     et le sitemap énumère les deux versions de chaque page qu'il publie ;
 * 1 = refus nommé (statut inattendu, coquille SPA servie à la place du
 *     document, `lang` faux, `canonical` croisé, alternative manquante ou en
 *     trop, sitemap à moitié bilingue, alternative déclarée sur une page
 *     monolingue) ;
 * 2 = prémisse : corpus vide (la déclaration n'a pas été lue), aucune page
 *     lisible, ou SITEMAP ILLISIBLE — la sonde n'a alors pas jugé
 *     l'énumération, et un vert dirait qu'elle l'a fait. Une prémisse rougit
 *     le run.
 *
 * ── Ce qu'elle ne dit pas, écrit plutôt que tu ─────────────────────────────
 *   • elle lit ce qui est SERVI, pas ce que le moteur en fait : un `hreflang`
 *     correct n'est pas une indexation, et Google peut ignorer une alternative
 *     pour d'autres raisons (qualité, duplication) qu'aucune sonde HTTP ne voit ;
 *   • le CONTENU des traductions n'est pas comparé : deux documents qui
 *     déclarent la même famille peuvent publier deux textes différents, et
 *     c'est `i18nParity.test.js` + le refus de corps déclaré du build qui le
 *     tiennent, hors ligne ;
 *   • les pages ville, métier et guides sont jugées sur le sitemap seulement
 *     (aucune alternative), pas page par page : leurs documents sont mesurés
 *     par `check-typo-pages-production.js`.
 *
 * Usage :
 *   node scripts/check-hreflang-production.js                    # production
 *   node scripts/check-hreflang-production.js --base https://…   # une preview
 *   node scripts/check-hreflang-production.js --route /jobs      # une page
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  LANGUES_INDEXEES,
  LANGUE_DE_SECOURS,
  alternatesHreflang,
  cheminDansLaLangue,
} from '../src/config/langues-indexees.js';
import { PAGE_META } from '../src/config/page-meta.js';
import { GROUPES_LIENS_SEO } from '../src/config/liens-seo.js';
import { SITE_ORIGIN } from './site-meta.js';

/** L'origine interrogée par défaut (production). */
export const DEFAULT_BASE = SITE_ORIGIN;

/** La famille de cette sonde — ce qu'un rouge prononcé ici veut dire. */
export const FAMILLE = 'hreflang des documents par langue';

/** Le seul titre d'annotation que cette sonde publie. */
export const TITRE_ERREUR = 'Hreflang production';

/** Marque des refus de PRÉMISSE : la sonde n'a pas pu juger — elle ne juge pas. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/**
 * Le PLANCHER de couverture du sitemap.
 *
 * Le sitemap est ici juge et référence : sa liste de pages françaises dit ce
 * qu'il a choisi d'indexer, et la règle « une page publiée dans une langue l'est
 * dans toutes » se vérifie dessus. Il faut donc deux pages qu'aucune lecture ne
 * peut retirer sans que le site cesse d'être décrit : la racine et la place de
 * marché. Sans ce plancher, un sitemap réduit à des pages monolingues passerait
 * la règle de symétrie en ne publiant aucune page bilingue.
 */
export const PAGES_OBLIGATOIRES = ['/', '/jobs'];

/** Le sitemap servi par l'origine du site (rewrite Vercel → `/api/sitemap.xml`). */
export const CHEMIN_SITEMAP = '/sitemap.xml';

/**
 * La marque d'une page PRÉ-RENDUE, par opposition à la coquille de
 * l'application (`app.html`, dont le point de montage est VIDE).
 *
 * Un rewrite perdu ne rend pas forcément un 404 : servi par le repli SPA, le
 * document est valide, il a un `lang`, souvent le bon — il n'a simplement pas
 * la page dedans. Sans cette marque, la sonde serait verte sur le mauvais objet.
 */
export const MARQUEUR_DE_PAGE = '<div id="root"><div class="App">';

const TIMEOUT_MS = 20000;

const strip = (valeur) => String(valeur ?? '').trim().replace(/\/+$/, '');

/** Les routes PRÉ-RENDUES, lues dans la table unique (jamais recopiées). */
export function routesAJuger() {
  return Object.keys(PAGE_META).sort();
}

/** Le libellé qui préfixe chaque refus : la famille, et l'origine jugée. */
export const libelleSonde = (base) =>
  `${FAMILLE} — ${strip(base)} sert-il chaque langue de sa famille avec ses alternatives réciproques`;

/** Les attributs d'une balise ouvrante (`<link … />`, `<html …>`). */
export function attributsDeBalise(balise) {
  const attributs = {};
  for (const trouve of String(balise).matchAll(/([a-zA-Z:_-]+)\s*=\s*"([^"]*)"/g)) {
    attributs[trouve[1].toLowerCase()] = trouve[2];
  }
  return attributs;
}

/** Tous les `<link>` du document, attributs lus un par un (ordre indifférent). */
export function liensDuDocument(html) {
  return [...String(html).matchAll(/<link\b[^>]*>/gi)].map((trouve) =>
    attributsDeBalise(trouve[0])
  );
}

/** Le `lang` de `<html>`, ou `''` s'il n'y en a pas. */
export function langDuDocument(html) {
  const ouverture = String(html).match(/<html\b[^>]*>/i);
  return ouverture ? (attributsDeBalise(ouverture[0]).lang || '') : '';
}

/** Le `href` du `canonical`, ou `''`. */
export function canonicalDuDocument(html) {
  const canonique = liensDuDocument(html).find(
    (lien) => (lien.rel || '').toLowerCase() === 'canonical'
  );
  return canonique ? (canonique.href || '').trim() : '';
}

/**
 * Les `(hreflang, href)` des `<link rel="alternate">`, dans l'ordre publié.
 *
 * L'ORDRE compte : c'est celui de la déclaration, et deux documents de la même
 * famille qui publieraient les mêmes couples dans un ordre différent
 * divergeraient à la première relecture — le comparer est gratuit.
 */
export function alternativesDuDocument(html) {
  return liensDuDocument(html)
    .filter((lien) => (lien.rel || '').toLowerCase() === 'alternate' && lien.hreflang)
    .map((lien) => [lien.hreflang, (lien.href || '').trim()]);
}

/** Décode les cinq entités qu'un sitemap peut porter dans une URL. */
function decoderEntites(texte) {
  return String(texte)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Les `<url>` d'un sitemap : `{loc, alternatives}` dans l'ordre publié. */
export function blocsDuSitemap(xml) {
  return [...String(xml).matchAll(/<url>([\s\S]*?)<\/url>/g)].map((bloc) => {
    const loc = (bloc[1].match(/<loc>([\s\S]*?)<\/loc>/) || [])[1] || '';
    const alternatives = [...bloc[1].matchAll(/<xhtml:link\b[^>]*>/g)]
      .map((balise) => attributsDeBalise(balise[0]))
      .filter((lien) => (lien.rel || '').toLowerCase() === 'alternate' && lien.hreflang)
      .map((lien) => [lien.hreflang, (lien.href || '').trim()]);
    return { loc: decoderEntites(loc).trim(), alternatives };
  });
}

/** Les couples attendus, sous la forme publiée par les documents et le sitemap. */
const attendues = (route) =>
  alternatesHreflang(route, strip(SITE_ORIGIN)).map(({ hreflang, href }) => [hreflang, href]);

/** La différence entre deux listes de couples, dite dans les deux sens. */
function decrireEcart(trouvees, attenduesList) {
  const cle = (couple) => `${couple[0]} ${couple[1]}`;
  const trouveesCles = new Set(trouvees.map(cle));
  const attenduesCles = new Set(attenduesList.map(cle));
  const manquantes = attenduesList.filter((couple) => !trouveesCles.has(cle(couple))).map(cle);
  const enTrop = trouvees.filter((couple) => !attenduesCles.has(cle(couple))).map(cle);
  const morceaux = [];
  if (manquantes.length) morceaux.push(`manque ${manquantes.join(', ')}`);
  if (enTrop.length) morceaux.push(`en trop ${enTrop.join(', ')}`);
  if (!morceaux.length) morceaux.push('même contenu, ORDRE différent');
  return morceaux.join(' ; ');
}

/**
 * Juge UN document : statut, marque de page, `lang`, `canonical`, alternatives.
 *
 * @param {{url: string, route: string, langue: object, statut: number, html: string}} page
 * @returns {string[]} Les refus (vide = conforme).
 */
export function jugerDocument({ url, route, langue, statut, html }) {
  const problemes = [];
  const chemin = cheminDansLaLangue(route, langue.code);

  if (statut !== 200) {
    problemes.push(
      `${url} répond HTTP ${statut} : la page déclarée ${chemin} n'est pas servie — vérifier le ` +
        `rewrite de frontend/vercel.json et le fichier que le build a écrit (build/${chemin}.html).`
    );
    return problemes;
  }

  if (!String(html).includes(MARQUEUR_DE_PAGE)) {
    problemes.push(
      `${url} ne contient pas la page pré-rendue (point de montage React vide) : c'est la coquille ` +
        `de l'application qui est servie — un rewrite perdu rend un document VALIDE, à la mauvaise ` +
        `langue et sans la page dedans.`
    );
  }

  const lang = langDuDocument(html);
  if (lang !== langue.htmlLang) {
    problemes.push(
      `${url} déclare <html lang="${lang || '(absent)'}"> au lieu de « ${langue.htmlLang} » : un moteur ` +
        `lit cette langue avant tout le reste, et une version anglaise annoncée « fr » n'est pas une ` +
        `version anglaise.`
    );
  }

  const canonicalAttendu = `${strip(SITE_ORIGIN)}${chemin}`;
  const canonical = canonicalDuDocument(html);
  if (canonical !== canonicalAttendu) {
    problemes.push(
      `${url} publie un canonical « ${canonical || '(absent)'} » au lieu de « ${canonicalAttendu} » : ` +
        `un canonical croisé fait indexer la page française à la place de l'anglaise (ou l'inverse).`
    );
  }

  const trouvees = alternativesDuDocument(html);
  const attenduesList = attendues(route);
  if (JSON.stringify(trouvees) !== JSON.stringify(attenduesList)) {
    problemes.push(
      `${url} publie ${trouvees.length} alternative(s) hreflang au lieu de ${attenduesList.length} ` +
        `(${decrireEcart(trouvees, attenduesList)}) : la liste doit être la MÊME dans chaque document ` +
        `de la famille, « ${LANGUE_DE_SECOURS} » compris — une déclaration non réciproque est ignorée.`
    );
  }

  return problemes;
}

/**
 * Juge le SITEMAP : symétrie des langues, alternatives, plancher, monolingues.
 *
 * La règle centrale ne recopie aucune liste : pour chaque page PRÉ-RENDUE, si le
 * sitemap en publie une version il doit en publier toutes (le français dit que
 * l'anglais existe, ou n'en dit rien du tout) ; et chaque entrée publiée porte
 * les alternatives de SA famille.
 *
 * @param {{xml: string}} entree
 * @returns {string[]} Les refus (vide = conforme).
 */
export function jugerSitemap({ xml }) {
  const problemes = [];
  const base = strip(SITE_ORIGIN);
  const blocs = blocsDuSitemap(xml);
  /** @type {Map<string, {loc: string, alternatives: string[][]}>} */
  const parChemin = new Map();
  for (const bloc of blocs) {
    if (!bloc.loc.startsWith(base)) continue;
    const chemin = bloc.loc.slice(base.length) || '/';
    parChemin.set(chemin, bloc);
  }

  for (const route of routesAJuger()) {
    const chemins = LANGUES_INDEXEES.map((langue) => cheminDansLaLangue(route, langue.code));
    const publies = chemins.filter((chemin) => parChemin.has(chemin));
    if (!publies.length) continue;
    if (publies.length !== chemins.length) {
      const manquants = chemins.filter((chemin) => !parChemin.has(chemin));
      problemes.push(
        `le sitemap énumère ${publies.join(', ')} sans ${manquants.join(', ')} : un sitemap à moitié ` +
          `bilingue dit au moteur que la moitié absente n'existe pas, quels que soient les documents.`
      );
      continue;
    }
    const attenduesList = attendues(route);
    for (const chemin of chemins) {
      const bloc = parChemin.get(chemin);
      if (JSON.stringify(bloc.alternatives) !== JSON.stringify(attenduesList)) {
        problemes.push(
          `l'entrée ${bloc.loc} du sitemap porte ${bloc.alternatives.length} alternative(s) au lieu de ` +
            `${attenduesList.length} (${decrireEcart(bloc.alternatives, attenduesList)}) : le sitemap et ` +
            `les documents doivent annoncer la MÊME famille, sinon la déclaration n'est servie qu'à moitié.`
        );
      }
    }
  }

  for (const route of PAGES_OBLIGATOIRES) {
    for (const langue of LANGUES_INDEXEES) {
      const chemin = cheminDansLaLangue(route, langue.code);
      if (!parChemin.has(chemin)) {
        problemes.push(
          `plancher de couverture : ${chemin} manque au sitemap — la racine et la place de marché ne ` +
            `peuvent pas être retirées sans que le fichier cesse de décrire le site (une symétrie entre ` +
            `deux langues vides serait vraie à vide).`
        );
      }
    }
  }

  // Une page MONOLINGUE ne déclare aucune alternative : en publier une sur une
  // page qui n'en a pas serait la même faute, dans l'autre sens — un `hreflang`
  // vers une version qui n'existe pas.
  for (const { href } of GROUPES_LIENS_SEO.flatMap((groupe) => groupe.liens)) {
    const bloc = parChemin.get(href);
    if (bloc && bloc.alternatives.length) {
      problemes.push(
        `l'entrée ${bloc.loc} du sitemap déclare ${bloc.alternatives.length} alternative(s) alors que ` +
          `cette page est MONOLINGUE (aucune version traduite n'existe) : un hreflang vers une page qui ` +
          `n'existe pas est une déclaration fausse.`
      );
    }
  }

  return problemes;
}

/**
 * Lit une URL sans masquer un statut par une erreur de lecture.
 *
 * @returns {Promise<{statut: number, corps: string, erreur: string}>}
 */
async function lire({ url, fetchImpl, accept }) {
  try {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': 'kojo-hreflang-probe/1.0', accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const corps = await res.text().catch(() => '');
    return { statut: res.status, corps, erreur: '' };
  } catch (err) {
    return { statut: 0, corps: '', erreur: err.message };
  }
}

/**
 * La sonde complète.
 *
 * @param {object} [options]
 * @param {string} [options.base] Origine interrogée (défaut : production).
 * @param {string[]} [options.routes] Routes à juger à la place de la table.
 *   `undefined` (le défaut) lit `page-meta.js` ; `[]` ne juge AUCUNE page —
 *   c'est le corpus vide, qui est une prémisse et se teste comme tel.
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {boolean} [options.quiet] Tait la progression.
 * @returns {Promise<{ok: boolean, premisse: boolean, errors: string[], notices: string[],
 *   checked: string[], pages: string[], cout: object}>}
 */
export async function runHreflangProbe({
  base = process.env.KOJO_HREFLANG_BASE_URL || DEFAULT_BASE,
  routes,
  fetchImpl = fetch,
  quiet = false,
} = {}) {
  const BASE = strip(base);
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };
  const errors = [];
  const notices = [];
  const checked = [];
  const pages = [];
  const debut = Date.now();
  let requetes = 0;
  const result = { ok: false, premisse: false, errors, notices, checked, pages, cout: {} };
  const libelle = libelleSonde(BASE);

  const aJuger = Array.isArray(routes) ? [...routes].sort() : routesAJuger();

  // ── Un corpus VIDE ne vaut pas un vert ──────────────────────────────────
  if (!aJuger.length || !LANGUES_INDEXEES.length) {
    result.premisse = true;
    notices.push(
      `${MARQUE_PREMISSE} : aucune page ou aucune langue indexée à juger — la déclaration ` +
        `(src/config/page-meta.js, src/config/langues-indexees.js) n'a rien rendu. Rien n'a été mesuré.`
    );
    log(`⚠️ ${notices[notices.length - 1]}`);
    return result;
  }

  // ── 1. Les documents, une langue après l'autre ──────────────────────────
  /** @type {Map<string, Map<string, string[][]>>} route → langue → alternatives */
  const listesParRoute = new Map();
  for (const route of aJuger) {
    for (const langue of LANGUES_INDEXEES) {
      const chemin = cheminDansLaLangue(route, langue.code);
      const url = `${BASE}${chemin}`;
      requetes += 1;
      const page = await lire({ url, fetchImpl, accept: 'text/html,application/xhtml+xml' });
      if (page.erreur) {
        errors.push(`${url} n'a pas pu être lu (${page.erreur}) : cette langue de ${route} n'est pas jugée.`);
        continue;
      }
      pages.push(url);
      const problemes = jugerDocument({
        url,
        route,
        langue,
        statut: page.statut,
        html: page.corps,
      });
      errors.push(...problemes);
      if (!problemes.length) checked.push(`  ✓ ${langue.code} ${chemin} (${url})`);
      if (page.statut === 200) {
        if (!listesParRoute.has(route)) listesParRoute.set(route, new Map());
        listesParRoute.get(route).set(langue.code, alternativesDuDocument(page.corps));
      }
    }
  }

  // ── Rien de lu = rien de jugé ───────────────────────────────────────────
  if (!pages.length) {
    result.premisse = true;
    notices.push(
      `${MARQUE_PREMISSE} : aucun document de ${BASE} n'a pu être lu (${errors.length} erreur(s) de ` +
        `lecture) — ni les langues ni les alternatives n'ont été mesurées.`
    );
    log(`⚠️ ${notices[notices.length - 1]}`);
    return result;
  }

  // ── 2. La RÉCIPROCITÉ, mesurée entre les documents de la famille ─────────
  // La comparaison à la déclaration (étape 1) garantit déjà la liste ; ce
  // contrôle-ci dit le fait tel qu'il se lit sur l'origine : les deux documents
  // publient la MÊME liste, dans le même ordre. Sans lui, deux documents
  // également faux passeraient pour cohérents.
  for (const [route, parLangue] of listesParRoute) {
    if (parLangue.size < 2) continue;
    const listes = [...parLangue.entries()].map(([code, liste]) => [code, JSON.stringify(liste)]);
    const distinctes = new Set(listes.map(([, liste]) => liste));
    if (distinctes.size > 1) {
      const detail = listes.map(([code, liste]) => `${code} : ${liste}`).join(' | ');
      errors.push(
        `les documents de ${route} ne publient pas la même liste hreflang (${detail}) : une ` +
          `alternative non réciproque est ignorée par le moteur, donc la famille n'est pas déclarée.`
      );
    }
  }

  // ── 3. Le sitemap, qui porte le fait d'énumération ───────────────────────
  requetes += 1;
  const sitemap = await lire({
    url: `${BASE}${CHEMIN_SITEMAP}`,
    fetchImpl,
    accept: 'application/xml,text/xml,*/*',
  });
  if (sitemap.erreur) {
    // Le sitemap est la MOITIÉ du fait mesuré ici. Sans lui, la sonde a jugé les
    // documents et pas l'énumération : un vert dirait qu'elle a tout mesuré.
    result.premisse = true;
    notices.push(
      `${MARQUE_PREMISSE} : le sitemap de ${BASE} n'a pas pu être lu (${sitemap.erreur}) — ` +
        `l'énumération des versions par langue n'a pas été jugée, et les documents seuls ne suffisent pas.`
    );
    log(`⚠️ ${notices[notices.length - 1]}`);
    return result;
  }
  if (sitemap.statut !== 200) {
    errors.push(
      `${BASE}${CHEMIN_SITEMAP} répond HTTP ${sitemap.statut} : le sitemap n'est pas servi, donc aucune ` +
        `version anglaise n'est annoncée (vérifier le rewrite /sitemap.xml de frontend/vercel.json).`
    );
  } else {
    const blocs = blocsDuSitemap(sitemap.corps);
    if (!blocs.length) {
      errors.push(
        `${BASE}${CHEMIN_SITEMAP} ne contient aucune entrée <url> : un sitemap vide n'énumère rien, et il ` +
          `passerait pour conforme à une règle qui ne juge que ce qu'il publie.`
      );
    } else {
      const problemes = jugerSitemap({ xml: sitemap.corps });
      errors.push(...problemes);
      if (!problemes.length) {
        checked.push(`  ✓ sitemap (${blocs.length} entrée(s), deux langues par page publiée)`);
      }
    }
  }

  result.cout = {
    langues: LANGUES_INDEXEES.length,
    documents: pages.length,
    routes: aJuger.length,
    requetes,
    dureeMs: Date.now() - debut,
  };

  result.ok = errors.length === 0;
  if (result.ok) {
    log(
      `\n${libelle} : conforme (${pages.length} document(s) sur ${aJuger.length} route(s) et ` +
        `${LANGUES_INDEXEES.length} langue(s), ${requetes} requête(s), ${result.cout.dureeMs} ms).`
    );
  }
  return result;
}

/** Les options de ligne de commande. */
export function parseArguments(argv = process.argv.slice(2)) {
  const options = { base: '', routes: [], quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base') options.base = argv[(index += 1)] || '';
    else if (argument === '--route') options.routes.push(argv[(index += 1)] || '');
    else if (argument === '--quiet') options.quiet = true;
  }
  return { ...options, routes: options.routes.filter(Boolean) };
}

/**
 * Le point d'entrée, séparé pour que le VERDICT (0/1/2) se juge sans réseau.
 *
 * @param {string[]} [argv] Arguments après `node script`.
 * @param {object} [deps] `run`, `log`, `error`.
 * @returns {Promise<number>} Code de sortie.
 */
export async function main(
  argv = process.argv.slice(2),
  { run = runHreflangProbe, log = console.log, error = console.error } = {}
) {
  const options = parseArguments(argv);
  const resultat = await run({
    base: options.base || undefined,
    routes: options.routes.length ? options.routes : undefined,
    quiet: options.quiet,
  });

  log(`\n${libelleSonde(options.base || DEFAULT_BASE)}`);
  for (const ligne of resultat.checked) log(ligne);
  const cout = resultat.cout || {};
  if (cout.requetes) {
    log(
      `ℹ️  Coût de la passe : ${cout.documents} document(s), ${cout.routes} route(s), ` +
        `${cout.requetes} requête(s), ${cout.dureeMs} ms.`
    );
  }

  if (resultat.premisse) {
    error(`::error title=${TITRE_ERREUR}::${resultat.notices.join(' ') || MARQUE_PREMISSE}`);
    for (const notice of resultat.notices) error(`  • ${notice}`);
    for (const message of resultat.errors) error(`  • ${message}`);
    return 2;
  }

  if (resultat.errors.length) {
    error(`\n❌ ${resultat.errors.length} défaut(s) — ${TITRE_ERREUR} :`);
    for (const message of resultat.errors) error(`  • ${message}`);
    error(
      `\n   → les langues et les URL sont déclarées UNE fois, dans src/config/langues-indexees.js ` +
        `(lue par le build ET par le sitemap, cf. backend/kojo_langues.py) ; un rewrite perdu se ` +
        `corrige dans frontend/vercel.json, un document muet dans les coquilles pré-rendues ` +
        `(vite-plugins/prerender/hreflang.js), et une entrée absente du sitemap dans les ` +
        `static_paths de backend/kojo_routers_public.py.`
    );
    error(
      `::error title=${TITRE_ERREUR}::${resultat.errors.length} défaut(s) sur les documents par ` +
        `langue ou leur énumération au sitemap`
    );
    return 1;
  }

  log(
    `\n✅ Les ${cout.documents} document(s) de ${cout.langues} langue(s) servent leur lang, leur ` +
      `canonical et la même liste hreflang (réciproque, x-default compris), et le sitemap énumère ` +
      `les deux versions de chaque page qu'il publie — ${cout.requetes} requête(s) en ${cout.dureeMs} ms.`
  );
  log(
    `ℹ️  Ce que cette sonde ne dit pas : un hreflang correct n'est pas une indexation (le moteur peut ` +
      `ignorer une alternative pour des raisons qu'aucune requête HTTP ne voit), et le TEXTE des ` +
      `traductions n'est pas comparé — c'est i18nParity.test.js qui le tient, hors ligne.`
  );
  return 0;
}

export const estAppelDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estAppelDirect) {
  process.exit(await main());
}
