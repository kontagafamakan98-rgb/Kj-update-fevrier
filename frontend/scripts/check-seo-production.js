#!/usr/bin/env node
/**
 * SONDE SEO de la PRODUCTION — rapport informatif, ne bloque rien.
 *
 * Deux MODES : informatif (défaut) et `--strict`, où une intégration REQUISE
 * absente fait ÉCHOUER la sonde (une facultative n'échoue pas : une sonde rouge
 * en permanence est une sonde qu'on ignore). Le mode informatif est ce qui a
 * laissé F9 ouvert : quatre intégrations absentes de la production, et aucun run
 * rouge nulle part.
 *
 * Trois sections, et un `::notice` par fait constaté :
 *
 * 1. INTÉGRATIONS — les quatre réclamées par un audit SEO « sans JavaScript »
 *    (balise Google Analytics 4, meta de vérification Search Console, `sameAs`
 *    des profils sociaux, domaine Plausible dans la CSP) n'existent que si leur
 *    variable est définie AU MOMENT DU BUILD. Le build de CI ne les définit
 *    jamais — une balise tierce dans l'artefact audité fausserait Lighthouse —
 *    donc seo-extras-injection.test.js prouve l'INJECTION, jamais la
 *    CONFIGURATION : rien ne distinguait « pas configuré sur Vercel » de
 *    « configuré et perdu ».
 *
 * 2. DOMAINE — le canonical servi par l'accueil et l'hôte annoncé par le
 *    sitemap, comparés à SITE_ORIGIN (`scripts/site-meta.js`). Le HTML et le
 *    sitemap appartiennent à deux déploiements indépendants (Vercel, et Fly pour
 *    le sitemap) : pendant la migration du 17/09/2026 ils ont annoncé deux
 *    adresses différentes pendant des heures, et rien ne le disait. L'écart est
 *    maintenant nommé, au lieu de se déduire d'une carte OG cassée.
 *
 * 3. PAGES — chaque page du sitemap est lue et doit annoncer son `canonical`,
 *    son `<title>` et sa `description`. Avant, seule l'accueil était sondée : le
 *    sitemap annonçait huit pages dont sept n'étaient jamais lues, donc une page
 *    servie sans description (ou avec le canonical d'une autre) restait
 *    silencieuse. Les fiches `/jobs/:id` du sitemap sont ensuite échantillonnées
 *    (`MAX_JOB_PAGES`) et jugées sur les trois mêmes métadonnées ; leur carte OG
 *    et le verrou 404 après suppression restent à `check-og-job-200.js`.
 *
 * En mode INFORMATIF (celui de `ci.yml`), le script ne fait JAMAIS échouer la
 * CI : une intégration non configurée ou un écart d'adresse sont des faits
 * d'exploitation, pas des régressions de code. Il refuse de conclure sur une
 * base locale (repli des PR) — là, les variables sont absentes par construction,
 * et quatre « ABSENT » ne diraient rien de la production.
 *
 * Usage : cd frontend && node scripts/check-seo-production.js [--base URL]
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SITE_ORIGIN, canonicalHref, isLoopbackUrl, metaContent, titleOf } from './site-meta.js';

// Les quatre intégrations, la variable d'environnement qui les active, et si
// leur ABSENCE est un défaut (`required`) ou un choix d'exploitation.
//
// `required` existe pour que le mode strict ne bloque que sur ce qui doit être
// là : une sonde quotidienne qui échouerait AUSSI sur une intégration
// facultative resterait rouge à jamais après la pose des valeurs requises, et
// une sonde rouge en permanence est une sonde qu'on apprend à ignorer —
// exactement le silence qu'elle est censée fermer.
export const INTEGRATIONS = [
  { key: 'ga4', label: 'Google Analytics 4', env: 'VITE_GA_MEASUREMENT_ID', required: true },
  { key: 'gsc', label: 'Search Console (balise meta)', env: 'VITE_GSC_VERIFICATION', required: true },
  { key: 'plausible', label: 'Plausible (facultatif)', env: 'VITE_PLAUSIBLE_DOMAIN', required: false },
  { key: 'social', label: 'Liens sociaux (sameAs du LocalBusiness)', env: 'VITE_SOCIAL_*', required: true },
];

// Aucun en-tête `cache-control: no-cache` : le HTML est servi en
// `public, max-age=0, must-revalidate`, donc l'edge revalide avant de répondre
// (mesuré le 17/09/2026 : `HIT` + `Age: 1` avec et sans l'en-tête).
const PROBE_HEADERS = { 'user-agent': 'kojo-seo-production-probe/1.0' };

/**
 * Liens sociaux RÉELLEMENT posés dans le HTML servi, restreints aux hôtes que
 * le `sameAs` déclare.
 *
 * `sameAs` prouve que les profils sont déclarés au build ; il ne prouve pas
 * qu'un crawler sans JavaScript les voit. Un `sameAs` rempli avec zéro lien
 * dans le corps de page est exactement le faux vert que ce décompte nomme.
 */
export function socialAnchorsFrom(html, declared) {
  const hosts = new Set();
  for (const url of declared) {
    try {
      hosts.add(new URL(url).host);
    } catch (_error) {
      /* URL déjà écartée du sameAs */
    }
  }
  const source = String(html);
  const count = (chunk) =>
    [...chunk.matchAll(/<a\b[^>]*\shref="(https?:\/\/[^"]+)"/gi)].filter((match) => {
      try {
        return hosts.has(new URL(match[1]).host);
      } catch (_error) {
        return false;
      }
    }).length;
  // Les OCCURRENCES, pas les URL distinctes : le même profil est publié deux
  // fois (bloc « Suivez-nous » du corps + pied de page), et un décompte dédoublonné
  // afficherait le même chiffre avant et après l'ajout du bloc — une mesure qui
  // ne bouge pas ne prouve rien. La part d'AVANT le pied de page est ce qui dit
  // si un crawler voit les liens dans le corps de page.
  const total = count(source);
  const body = count(source.split(/<footer\b/i)[0]);
  return { total, body };
}

/**
 * Ce que le HTML servi contient réellement.
 *
 * `plausible.io` n'apparaît que dans la CSP quand Plausible est activé : son
 * script est chargé par le BUNDLE, donc invisible du HTML statique — un audit
 * « no-JS » ne le verra jamais, ce que dit explicitement le rapport.
 */
export function analyzeSeoServedHtml(html = '') {
  const source = String(html);
  const ga = /googletagmanager\.com\/gtag\/js\?id=([A-Za-z0-9_-]+)/.exec(source);
  const gsc = metaContent(source, 'google-site-verification');
  let social = [];
  try {
    const declared = JSON.parse(/\"sameAs"\s*:\s*(\[[^\]]*\])/.exec(source)?.[1] || '[]');
    social = Array.isArray(declared) ? declared.filter((url) => /^https:\/\//.test(String(url))) : [];
  } catch (_error) {
    social = [];
  }
  return {
    ga4: { present: Boolean(ga), value: ga ? ga[1] : '' },
    gsc: { present: Boolean(gsc), value: gsc },
    plausible: { present: source.includes('plausible.io'), value: '' },
    social: {
      present: social.length > 0,
      value: social.join(', '),
      count: social.length,
      ...socialAnchorsFrom(source, social),
    },
  };
}

/** Une ligne par intégration : ce qui est présent, ou la variable à poser. */
export function noticeFor({ key, label, env, required = true }, state) {
  if (!state.present) {
    return (
      `${label} : ABSENT — poser ${env} dans Vercel → Settings → Environment Variables, puis REDÉPLOYER (les VITE_* sont inlinées au build).` +
      (required ? '' : ' FACULTATIF : son absence ne fait pas échouer la sonde stricte.')
    );
  }
  const detail =
    key === 'ga4'
      ? `gtag/js?id=${state.value}`
      : key === 'gsc'
        ? `jeton ${String(state.value).slice(0, 8)}…`
        : key === 'social'
          ? `${state.count} profil(s) dans le sameAs, ${state.total} lien(s) dans le HTML servi ` +
            `(dont ${state.body} dans le corps, avant le pied de page)` +
            (state.total === 0
              ? " — AUCUN lien social dans le HTML brut : un crawler sans JavaScript ne peut pas les voir (bloc social du shell pré-rendu et footer)"
              : '')
          : 'CSP script-src ouverte (script injecté par le bundle)';
  return `${label} : PRÉSENT — ${detail}`;
}

/**
 * `<loc>` du sitemap servi, ou l'erreur de lecture — jamais une exception : le
 * sitemap peut manquer sans que le reste du rapport perde sa valeur.
 */
async function readSitemap(base, fetchImpl) {
  try {
    const response = await fetchImpl(`${base}/sitemap.xml`, {
      redirect: 'follow',
      headers: PROBE_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const xml = await response.text();
    return { locs: [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]) };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * L'adresse appartient-elle à l'origine attendue ?
 *
 * La frontière compte : `https://kojoforafrica.cc.cd.attaquant.test/` ne doit
 * pas passer pour conforme.
 */
const belongsTo = (address, origin) => address === origin || address.startsWith(`${origin}/`);

/** Le canonical servi, confronté à l'origine attendue. */
function canonicalNotice(href, origin) {
  if (!href) {
    return `Domaine — canonical : ABSENT de l'accueil, un crawler ne peut pas trancher entre les adresses qui répondent (attendu ${origin}/).`;
  }
  if (belongsTo(href, origin)) {
    return `Domaine — canonical servi : ${href} (conforme à l'origine attendue).`;
  }
  return `Domaine — canonical servi : ${href} — ÉCART : l'origine attendue est ${origin}. Migration de domaine à moitié faite, ou HTML d'avant bascule.`;
}

/** L'hôte annoncé par le sitemap, confronté à l'origine attendue. */
function sitemapNotice({ locs, error }, attendue) {
  if (error) {
    return `Domaine — sitemap : non lisible (${error}), l'hôte qu'il annonce reste inconnu.`;
  }
  // Origines distinctes annoncées, dans l'ordre du document : un `<loc>`
  // illisible ne compte pas comme hôte, sans faire tomber le rapport.
  const origins = [];
  for (const loc of locs) {
    try {
      const { origin } = new URL(loc);
      if (!origins.includes(origin)) origins.push(origin);
    } catch (_error) {
      /* ignoré : visible par son absence du décompte */
    }
  }
  const announced = origins.join(', ') || 'aucun hôte lisible';
  if (origins.length === 1 && belongsTo(origins[0], attendue)) {
    return `Domaine — sitemap : ${locs.length} URL, hôte annoncé ${announced} (conforme à l'origine attendue).`;
  }
  return `Domaine — sitemap : ${locs.length} URL, hôte annoncé ${announced} — ÉCART : l'origine attendue est ${attendue}.`;
}

/**
 * Métadonnées qu'une page PUBLIQUE doit annoncer, lues sur le HTML SERVI — ce
 * qu'un crawler sans JavaScript reçoit réellement, pas ce que le build a écrit.
 */
export function analyzePageMetadata(html) {
  return {
    title: titleOf(html),
    description: metaContent(html, 'description'),
    canonical: canonicalHref(html),
  };
}

/** Chemin d'une adresse, barre finale retirée (« / » et « / » restent égaux). */
const normalizePathname = (value) => String(value).replace(/\/+$/, '') || '/';

/** Le chemin d'une URL, ou la chaîne vide si elle est illisible. */
function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch (_error) {
    return String(url);
  }
}

/** Une fiche mission `/jobs/:id` du sitemap (et non la liste `/jobs`). */
const JOB_DETAIL = /^\/jobs\/[^/]+\/?$/;

/** Plafond de pages lues : borne le coût quotidien si un sitemap en annonce trop. */
const MAX_PAGES = 20;

/**
 * Plafond de fiches `/jobs/:id` échantillonnées.
 *
 * Le sitemap en admet jusqu'à 9 000 et l'échantillon ne peut pas les couvrir :
 * il vérifie que la FORME de la fiche tenue par le backend annonce bien
 * `canonical`/`title`/`description`, sur des missions réelles. Ce que
 * `check-og-job-200.js` possède déjà — la carte OG, ses variantes, le verrou
 * 404 après suppression — n'est PAS rejoué ici, et l'échantillon ne prétend pas
 * couvrir les fiches qu'il n'a pas lues (la notice le dit).
 */
const MAX_JOB_PAGES = 3;

/**
 * Défauts d'une page vis-à-vis de sa PROPRE adresse, chacun nommant la page et
 * ce qui manque — un rouge muet obligerait à relire le script.
 *
 * Le canonical est confronté à la page elle-même, pas seulement à l'origine :
 * une route qui annoncerait le canonical d'une AUTRE page a bien une adresse
 * canonique, mais elle envoie les crawlers ailleurs.
 */
export function pageDefects({ url, html, error }) {
  const path = pathOf(url);
  if (error) {
    return [`${path} : non lisible (${error}) — le sitemap annonce une page que la production ne sert pas.`];
  }
  const { title, description, canonical } = analyzePageMetadata(html);
  const defects = [];
  if (!title) {
    defects.push(`${path} : <title> ABSENT — un résultat de recherche s'afficherait avec l'adresse brute.`);
  }
  if (!description) {
    defects.push(`${path} : description ABSENTE — un moteur n'a aucun extrait à afficher.`);
  }
  if (!canonical) {
    defects.push(`${path} : canonical ABSENT — un crawler ne peut pas trancher entre les adresses qui répondent.`);
  } else if (!belongsTo(canonical, SITE_ORIGIN)) {
    defects.push(`${path} : canonical ${canonical} — ÉCART : hors de l'origine attendue ${SITE_ORIGIN}.`);
  } else if (normalizePathname(pathOf(canonical)) !== normalizePathname(path)) {
    defects.push(
      `${path} : canonical ${canonical} — ÉCART : désigne ${normalizePathname(pathOf(canonical))} au lieu de cette page.`,
    );
  }
  return defects;
}

/** Lit une page du sitemap ; jamais d'exception, l'erreur devient un défaut nommé. */
async function readPage(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      headers: PROBE_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { url, error: `HTTP ${response.status}` };
    return { url, html: await response.text() };
  } catch (error) {
    return { url, error: error.message };
  }
}

/**
 * Les pages du sitemap à vérifier : les pages du SITE (toutes, jusqu'au
 * plafond) et un ÉCHANTILLON borné des fiches `/jobs/:id`.
 *
 * @returns {Promise<{checked: Array<{url: string, defects: string[]}>, total: number,
 *   truncated: number, jobs: {checked: Array, total: number, sampled: number}}>}
 */
async function checkSitemapPages({ locs = [], fetchImpl, homeHtml }) {
  const sitePages = [];
  const jobPages = [];
  for (const loc of locs) {
    let pathname;
    try {
      pathname = new URL(loc).pathname;
    } catch (_error) {
      // `<loc>` illisible : déjà visible dans le décompte du sitemap.
      continue;
    }
    const cible = JOB_DETAIL.test(pathname) ? jobPages : sitePages;
    if (!cible.includes(loc)) cible.push(loc);
  }

  const checked = [];
  for (const url of sitePages.slice(0, MAX_PAGES)) {
    // L'accueil est déjà lu pour les intégrations : ne pas le redemander.
    const page =
      pathOf(url) === '/' && homeHtml !== undefined
        ? { url, html: homeHtml }
        : await readPage(url, fetchImpl);
    checked.push({ url, defects: pageDefects(page) });
  }

  const sampled = [];
  for (const url of jobPages.slice(0, MAX_JOB_PAGES)) {
    const page = await readPage(url, fetchImpl);
    // Une fiche peut être clôturée entre la lecture du sitemap et sa lecture :
    // un 404 n'est PAS un défaut (une mission vivante disparaît normalement),
    // c'est une mesure impossible — nommée, pas jugée. Une page servie en 200
    // reste jugée sur ses métadonnées.
    sampled.push(
      page.error ? { url, disparue: page.error } : { url, defects: pageDefects(page) }
    );
  }

  return {
    checked,
    total: sitePages.length,
    truncated: sitePages.length - checked.length,
    jobs: { checked: sampled, total: jobPages.length, sampled: sampled.length },
  };
}

/**
 * Notices de l'échantillon des fiches `/jobs/:id`.
 *
 * @returns {{notices: string[], défauts: string[]}}
 */
export function jobSampleNotices({ checked = [], total = 0, sampled = 0 } = {}) {
  if (total === 0) {
    return {
      notices: [
        "Pages — fiches /jobs/:id : aucune dans le sitemap — l'échantillon est vide, " +
          'aucune fiche vivante à vérifier (aucune conclusion sur cette forme de page).',
      ],
      défauts: [],
    };
  }
  const défauts = checked.filter(({ defects }) => defects?.length).flatMap(({ defects }) => defects);
  const disparues = checked.filter(({ disparue }) => disparue);
  const notes = [`${sampled} sur ${total} vérifiée(s)`];
  if (disparues.length) notes.push(`${disparues.length} disparue(s) depuis la lecture du sitemap (non jugées)`);
  const résumé =
    `Pages — fiches /jobs/:id : ${notes.join(' ; ')} (canonical, title, description) : ` +
    (défauts.length ? `${défauts.length} défaut(s) nommé(s) ci-dessous` : 'conformes') +
    `. Échantillon borné à ${MAX_JOB_PAGES} : la carte OG et le verrou 404 restent à check-og-job-200.js.`;
  return { notices: [résumé, ...défauts.map((d) => `Pages — ${d}`)], défauts };
}

/**
 * Notices de la section « Pages » : un résumé par famille, puis un `::notice`
 * par défaut.
 *
 * @returns {{notices: string[], défauts: string[]}} Les défauts sont ceux que le
 *   mode strict refuse.
 */
export function pagesNotices({ checked = [], total = 0, truncated = 0, jobs = {}, error }) {
  if (error) {
    return { notices: [`Pages — non vérifiées : le sitemap n'est pas lisible (${error}).`], défauts: [] };
  }
  const notes = [];
  if (truncated) notes.push(`${truncated} page(s) au-delà du plafond de ${MAX_PAGES}`);
  const défauts = checked.filter(({ defects }) => defects.length > 0).flatMap(({ defects }) => defects);
  const résumé =
    `Pages — ${checked.length}/${total} page(s) du sitemap vérifiée(s) (canonical, title, description) : ` +
    (défauts.length ? `${défauts.length} défaut(s) nommé(s) ci-dessous` : 'conformes') +
    (notes.length ? ` (${notes.join(' ; ')})` : '') +
    '.';
  const echantillon = jobSampleNotices(jobs);
  return {
    notices: [résumé, ...défauts.map((d) => `Pages — ${d}`), ...echantillon.notices],
    défauts: [...défauts, ...echantillon.défauts],
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.base] Base sondée (KOJO_LHCI_BASE_URL, sinon SITE_ORIGIN).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @returns {Promise<{skipped: boolean, notices: string[]}>} `skipped` : rien à
 *   conclure (base locale, ou accueil injoignable) — jamais un échec.
 */
export async function runSeoProductionReport({
  base = process.env.KOJO_LHCI_BASE_URL || SITE_ORIGIN,
  fetchImpl = fetch,
  strict = false,
} = {}) {
  const cleanBase = String(base).trim().replace(/\/+$/, '');
  // « Base locale » : la question appartient à `isLoopbackUrl`
  // (scripts/site-meta.js), posée une seule fois pour tous les gardes.
  if (isLoopbackUrl(cleanBase)) {
    return {
      skipped: true,
      manquantes: [],
      notices: [
        `base locale (${cleanBase}) : les intégrations SEO/analytics s'activent par ` +
          "variables d'environnement posées sur Vercel — un build local ne dit rien de " +
          'la production, aucune conclusion publiée.',
      ],
    };
  }

  let html;
  try {
    const response = await fetchImpl(`${cleanBase}/`, {
      redirect: 'follow',
      headers: PROBE_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
  } catch (error) {
    return {
      skipped: true,
      manquantes: [],
      notices: [`accueil non lisible (${error.message}) : aucune conclusion.`],
    };
  }

  const analysis = analyzeSeoServedHtml(html);
  const sitemap = await readSitemap(cleanBase, fetchImpl);
  // La section « Pages » suit le sitemap SERVI : ce qu'un sitemap annonce doit
  // être servi avec ses métadonnées. Son HTML n'est lu que si le sitemap l'est.
  const pages = await checkSitemapPages({
    locs: sitemap.locs || [],
    fetchImpl,
    homeHtml: html,
  });
  const pagesRapport = pagesNotices(sitemap.error ? { error: sitemap.error } : pages);
  const presentes = INTEGRATIONS.filter(({ key }) => analysis[key].present);
  const requises = INTEGRATIONS.filter(({ required }) => required);
  // Ce que le mode strict refuse : les intégrations REQUISES absentes, nommées
  // avec la variable à poser, et chaque page du sitemap qui n'annonce pas ses
  // métadonnées — sinon un rouge ne dirait pas quoi corriger. Une intégration
  // facultative absente est publiée en notice et n'entre pas ici.
  const manquantes = [
    ...requises
      .filter(({ key }) => !analysis[key].present)
      .map((integration) => noticeFor(integration, analysis[integration.key])),
    ...pagesRapport.défauts.map((défaut) => `Pages — ${défaut}`),
  ];
  return {
    skipped: false,
    manquantes,
    analyse: analysis,
    pages: pages.checked,
    jobPages: pages.jobs.checked,
    notices: [
      ...INTEGRATIONS.map((integration) => noticeFor(integration, analysis[integration.key])),
      `${presentes.length}/${INTEGRATIONS.length} intégration(s) présente(s) sur ${cleanBase} ` +
        `(dont ${presentes.filter(({ required }) => required).length}/${requises.length} requise(s)) — ` +
        (strict
          ? 'cette sonde BLOQUE sur les intégrations REQUISES, pas sur les facultatives (cf. CI-COVERAGE.md, F9).'
          : 'ce rapport ne bloque rien (cf. CI-COVERAGE.md, F9).'),
      canonicalNotice(canonicalHref(html), SITE_ORIGIN),
      sitemapNotice(sitemap, SITE_ORIGIN),
      ...pagesRapport.notices,
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // ── Deux modes, et pourquoi ────────────────────────────────────────────────
  // INFORMATIF (défaut, l'étape de ci.yml sur main) : une configuration
  // incomplète est un fait d'exploitation, pas une régression de code — un rouge
  // sur chaque PR bloquerait des fusions pour une variable que personne n'a
  // encore obtenue.
  // STRICT (--strict, la sonde PÉRIODIQUE) : c'est ce mode qui met fin au
  // silence. Une intégration absente, ou une sonde qui ne peut pas conclure,
  // ÉCHOUE bruyamment — sans bloquer une PR.
  const strict = process.argv.includes('--strict');
  const flag = process.argv.indexOf('--base');
  const result = await runSeoProductionReport(
    flag === -1 ? { strict } : { base: process.argv[flag + 1], strict }
  );
  console.log(
    `Sonde SEO de la production — ${result.skipped ? 'sans verdict' : 'verdict publié'}${strict ? ' [strict]' : ''}`
  );
  for (const notice of result.notices) console.log(`::notice title=SEO production::${notice}`);
  if (strict) {
    // Une sonde qui ne peut pas conclure échoue : un « sans verdict » vert
    // voudrait dire « rien de cassé » alors que rien n'a été mesuré.
    const echecs = result.skipped
      ? ['sonde sans verdict : la production n’a pas pu être lue — aucune conclusion n’est possible']
      : result.manquantes;
    for (const echec of echecs) {
      console.error(`::error title=SEO production::${echec}`);
    }
    process.exitCode = echecs.length ? 1 : 0;
  }
}
