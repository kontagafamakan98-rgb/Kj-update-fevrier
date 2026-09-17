#!/usr/bin/env node
/**
 * SONDE SEO de la PRODUCTION — rapport informatif, ne bloque rien.
 *
 * Quatre intégrations réclamées par un audit SEO « sans JavaScript » (balise
 * Google Analytics 4, meta de vérification Search Console, `sameAs` des profils
 * sociaux, domaine Plausible dans la CSP) n'existent que si leur variable est
 * définie AU MOMENT DU BUILD. Le build de CI ne les définit jamais — une balise
 * tierce dans l'artefact audité fausserait Lighthouse — donc
 * seo-extras-injection.test.js prouve l'INJECTION, jamais la CONFIGURATION :
 * rien ne distinguait « pas configuré sur Vercel » de « configuré et perdu ».
 *
 * Ce script lit le HTML réellement servi (l'accueil, la page que lit l'audit) et
 * publie un `::notice` par intégration avec la variable à poser. Il ne fait
 * JAMAIS échouer la CI : l'absence de configuration est un fait d'exploitation,
 * pas une régression de code. Il refuse de conclure sur une base locale (repli
 * des PR) — là, les variables sont absentes par construction, et quatre
 * « ABSENT » ne diraient rien de la production.
 *
 * Usage : cd frontend && node scripts/check-seo-production.js [--base URL]
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Domaine de production (même valeur que check-og-images.js).
export const PROD_ORIGIN = 'https://kj-update-fevrier.vercel.app';

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
 * Contenu d'une `<meta name="…">`, quel que soit l'ordre des attributs.
 *
 * ⚠️ La citation qui FERME doit être la même que celle qui ouvre. Un motif du
 * type `["']([^"']*)["']` tronque toute valeur contenant une apostrophe : la
 * description de l'accueil (« … en Côte d'Ivoire ») s'y lisait 104 caractères
 * au lieu de 151, ce qui a publié un faux chiffre dans CI-COVERAGE.md (F9).
 */
function metaContent(html, name) {
  const wanted = String(name).toLowerCase();
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const attribute of tag.matchAll(/([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attrs[attribute[1].toLowerCase()] = attribute[3] !== undefined ? attribute[3] : attribute[4];
    }
    if ((attrs.name || '').toLowerCase() === wanted) return attrs.content || '';
  }
  return '';
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
 * @param {object} [options]
 * @param {string} [options.base] Base sondée (KOJO_LHCI_BASE_URL, sinon PROD_ORIGIN).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @returns {Promise<{skipped: boolean, notices: string[]}>} `skipped` : rien à
 *   conclure (base locale, ou accueil injoignable) — jamais un échec.
 */
export async function runSeoProductionReport({
  base = process.env.KOJO_LHCI_BASE_URL || PROD_ORIGIN,
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
  const present = INTEGRATIONS.filter(({ key }) => analysis[key].present).length;
  return {
    skipped: false,
    notices: [
      ...INTEGRATIONS.map((integration) => noticeFor(integration, analysis[integration.key])),
      `${present}/${INTEGRATIONS.length} intégration(s) présente(s) sur ${cleanBase} — ce rapport ` +
        'ne bloque rien (cf. CI-COVERAGE.md, F9).',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const flag = process.argv.indexOf('--base');
  const result = await runSeoProductionReport(flag === -1 ? {} : { base: process.argv[flag + 1] });
  console.log(`Sonde SEO de la production — ${result.skipped ? 'sans verdict' : 'verdict publié'}`);
  for (const notice of result.notices) console.log(`::notice title=SEO production::${notice}`);
}
