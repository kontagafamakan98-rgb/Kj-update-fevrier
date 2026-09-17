#!/usr/bin/env node
/**
 * SONDE SEO de la PRODUCTION — rapport informatif, ne bloque rien.
 *
 * Deux sections, et deux `::notice` par fait constaté :
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
 * Le script ne fait JAMAIS échouer la CI : une intégration non configurée ou un
 * écart d'adresse sont des faits d'exploitation, pas des régressions de code. Il
 * refuse de conclure sur une base locale (repli des PR) — là, les variables sont
 * absentes par construction, et quatre « ABSENT » ne diraient rien de la
 * production.
 *
 * Usage : cd frontend && node scripts/check-seo-production.js [--base URL]
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SITE_ORIGIN, canonicalHref, metaContent } from './site-meta.js';

// Les quatre intégrations, et la variable d'environnement qui les active.
export const INTEGRATIONS = [
  { key: 'ga4', label: 'Google Analytics 4', env: 'VITE_GA_MEASUREMENT_ID' },
  { key: 'gsc', label: 'Search Console (balise meta)', env: 'VITE_GSC_VERIFICATION' },
  { key: 'plausible', label: 'Plausible (facultatif)', env: 'VITE_PLAUSIBLE_DOMAIN' },
  { key: 'social', label: 'Liens sociaux (sameAs du LocalBusiness)', env: 'VITE_SOCIAL_*' },
];

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;

// Aucun en-tête `cache-control: no-cache` : le HTML est servi en
// `public, max-age=0, must-revalidate`, donc l'edge revalide avant de répondre
// (mesuré le 17/09/2026 : `HIT` + `Age: 1` avec et sans l'en-tête).
const PROBE_HEADERS = { 'user-agent': 'kojo-seo-production-probe/1.0' };

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
    social: { present: social.length > 0, value: social.join(', '), count: social.length },
  };
}

/** Une ligne par intégration : ce qui est présent, ou la variable à poser. */
function noticeFor({ key, label, env }, state) {
  if (!state.present) {
    return `${label} : ABSENT — poser ${env} dans Vercel → Settings → Environment Variables, puis REDÉPLOYER (les VITE_* sont inlinées au build).`;
  }
  const detail =
    key === 'ga4'
      ? `gtag/js?id=${state.value}`
      : key === 'gsc'
        ? `jeton ${String(state.value).slice(0, 8)}…`
        : key === 'social'
          ? `${state.count} profil(s) dans le sameAs`
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
 * @param {object} [options]
 * @param {string} [options.base] Base sondée (KOJO_LHCI_BASE_URL, sinon SITE_ORIGIN).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @returns {Promise<{skipped: boolean, notices: string[]}>} `skipped` : rien à
 *   conclure (base locale, ou accueil injoignable) — jamais un échec.
 */
export async function runSeoProductionReport({
  base = process.env.KOJO_LHCI_BASE_URL || SITE_ORIGIN,
  fetchImpl = fetch,
} = {}) {
  const cleanBase = String(base).trim().replace(/\/+$/, '');
  if (LOOPBACK.test(cleanBase)) {
    return {
      skipped: true,
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
    return { skipped: true, notices: [`accueil non lisible (${error.message}) : aucune conclusion.`] };
  }

  const analysis = analyzeSeoServedHtml(html);
  const sitemap = await readSitemap(cleanBase, fetchImpl);
  const present = INTEGRATIONS.filter(({ key }) => analysis[key].present).length;
  return {
    skipped: false,
    notices: [
      ...INTEGRATIONS.map((integration) => noticeFor(integration, analysis[integration.key])),
      `${present}/${INTEGRATIONS.length} intégration(s) présente(s) sur ${cleanBase} — ce rapport ` +
        'ne bloque rien (cf. CI-COVERAGE.md, F9).',
      canonicalNotice(canonicalHref(html), SITE_ORIGIN),
      sitemapNotice(sitemap, SITE_ORIGIN),
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const flag = process.argv.indexOf('--base');
  const result = await runSeoProductionReport(flag === -1 ? {} : { base: process.argv[flag + 1] });
  console.log(`Sonde SEO de la production — ${result.skipped ? 'sans verdict' : 'verdict publié'}`);
  for (const notice of result.notices) console.log(`::notice title=SEO production::${notice}`);
}
