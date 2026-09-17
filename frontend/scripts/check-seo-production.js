#!/usr/bin/env node
/**
 * SONDE SEO de la PRODUCTION — rapport informatif, ne bloque rien.
 *
 * ── Pourquoi ce rapport existe ──────────────────────────────────────────────
 * Quatre intégrations réclamées par un audit SEO « sans JavaScript » n'existent
 * que si leur variable est définie AU MOMENT DU BUILD : la balise Google
 * Analytics 4, la meta de vérification Search Console, le `sameAs` du
 * LocalBusiness (profils sociaux) et l'ouverture de la CSP pour GA / Plausible.
 * Le build de CI ne les définit jamais (une balise tierce dans l'artefact
 * audité par Lighthouse fausserait les scores), donc `vitest` prouve seulement
 * que l'injection FONCTIONNE si les variables sont posées — jamais qu'elles le
 * sont sur Vercel. C'est le dernier angle mort de F9 (CI-COVERAGE.md §7.8) :
 * une variable oubliée dans le tableau de bord ne se voyait que par un audit
 * externe, sur la production.
 *
 * Ce script lit le HTML RÉELLEMENT SERVI et publie une annotation `::notice`
 * par intégration (présente / absente + la variable à poser). Il ne fait JAMAIS
 * échouer la CI par défaut : tant que la configuration Vercel n'est pas faite,
 * l'absence est normale et doit être lisible, pas bloquante. `--fail-if-missing`
 * existe pour le jour où la configuration sera faite (bascule d'un mot dans
 * ci.yml) : le rapport peut alors devenir un garde.
 *
 * ── Ce qu'il refuse de conclure ─────────────────────────────────────────────
 * Sur une base LOOPBACK (repli local « forme production » des PR), les quatre
 * variables sont absentes par construction : la sonde s'arrête avec un notice
 * explicite au lieu d'afficher quatre « ABSENT » qui ne diraient rien de la
 * production. De même, la requête porte `cache-control: no-cache` : le HTML est
 * servi avec `must-revalidate`, mais un hit d'edge peut afficher un `Age` de
 * plusieurs minutes (constaté : 1110 s), et conclure « ABSENT » sur une copie
 * antérieure à la configuration est exactement le piège qui a fait croire à un
 * rapport d'audit qu'une correction n'avait pas été déployée.
 *
 * Usage :
 *   cd frontend && node scripts/check-seo-production.js
 *   node scripts/check-seo-production.js --base https://exemple.test --fail-if-missing
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Domaine de production (même valeur que check-og-images.js).
export const PROD_ORIGIN = 'https://kj-update-fevrier.vercel.app';

// L'accueil est la page que lit l'audit ; `/jobs` est pré-rendue elle aussi et
// sert de témoin : l'injection est faite par un plugin `transformIndexHtml`, qui
// s'applique à CHAQUE page pré-rendue — une balise présente sur l'accueil et
// absente ailleurs signalerait une régression que la sonde nomme.
export const PROBED_ROUTES = ['/', '/jobs'];

// Les quatre intégrations concernées, avec la variable qui les active, ce que
// l'audit en dit quand elle manque, et si elle est NÉCESSAIRE.
//
// `required: false` pour Plausible : c'est une ALTERNATIVE payante à GA4, jamais
// un complément — compter son absence comme un manque ferait échouer un
// `--fail-if-missing` sur un site parfaitement configuré. Elle est donc
// rapportée (on veut la voir) mais ne pèse pas sur le verdict.
export const INTEGRATIONS = [
  {
    key: 'ga4',
    label: 'Google Analytics 4',
    env: 'VITE_GA_MEASUREMENT_ID',
    audit: 'No analytics tracking detected (No GA or GTM found)',
    required: true,
  },
  {
    key: 'gsc',
    label: 'Search Console (balise meta)',
    env: 'VITE_GSC_VERIFICATION',
    audit: 'No GSC verification meta tag found',
    required: true,
  },
  {
    key: 'plausible',
    label: 'Plausible (facultatif)',
    env: 'VITE_PLAUSIBLE_DOMAIN',
    audit: null,
    required: false,
  },
  {
    key: 'social',
    label: 'Liens sociaux (sameAs du LocalBusiness)',
    env: 'VITE_SOCIAL_*',
    audit: 'No social media links found',
    required: true,
  },
];

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;

/** La base est-elle la pile locale du repli CI (pas la production) ? */
export const isLoopbackBase = (base) => LOOPBACK.test(String(base || '').trim());

/**
 * Contenu d'une `<meta name="…">`, quel que soit l'ordre des attributs.
 * (Vite sérialise `name` puis `content`, mais l'ordre n'est pas un contrat.)
 */
export function metaContent(html, name) {
  const wanted = String(name).toLowerCase();
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const attribute of tag.matchAll(/([a-zA-Z-]+)\s*=\s*["']([^"']*)["']/g)) {
      attrs[attribute[1].toLowerCase()] = attribute[2];
    }
    if ((attrs.name || '').toLowerCase() === wanted) return attrs.content || '';
  }
  return '';
}

/** Identifiant du flux GA4 chargé par le HTML statique ('' si absent). */
export function gtagMeasurementId(html) {
  const match = /googletagmanager\.com\/gtag\/js\?id=([A-Za-z0-9_-]+)/.exec(String(html));
  return match ? match[1] : '';
}

/** URL de profil social de la première entrée de `sameAs` ('' si vide). */
export function socialProfiles(html) {
  const match = /"sameAs"\s*:\s*(\[[^\]]*\])/.exec(String(html));
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed.filter((url) => /^https:\/\//.test(String(url))) : [];
  } catch (_error) {
    return [];
  }
}

/**
 * Ce que le HTML servi contient réellement.
 *
 * Plausible est détecté via la CSP (`script-src https://plausible.io`) : son
 * script est chargé par le BUNDLE, donc invisible du HTML statique — un audit
 * « no-JS » ne le verra jamais, ce qui est dit explicitement dans le rapport.
 */
export function analyzeSeoServedHtml(html = '') {
  const source = String(html);
  const gaId = gtagMeasurementId(source);
  const gscToken = metaContent(source, 'google-site-verification');
  const profiles = socialProfiles(source);
  return {
    ga4: { present: Boolean(gaId), value: gaId },
    gsc: { present: Boolean(gscToken), value: gscToken },
    plausible: { present: /plausible\.io/.test(source), value: '' },
    social: { present: profiles.length > 0, value: profiles.join(', '), count: profiles.length },
  };
}

/** Récupère le HTML servi, sans cache d'edge (cf. en-tête de ce fichier). */
export async function fetchServedHtml({ url, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'kojo-seo-production-probe/1.0',
        'cache-control': 'no-cache',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      html: await response.text(),
    };
  } catch (error) {
    return { ok: false, status: 0, html: '', error: error.message };
  }
}

/**
 * Exécute le rapport.
 *
 * @param {object} [options]
 * @param {string} [options.base]   Base sondée (KOJO_LHCI_BASE_URL, sinon PROD_ORIGIN).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {string[]} [options.routes] Routes sondées.
 * @param {number} [options.timeoutMs] Délai par requête.
 * @param {boolean} [options.quiet] Tait la sortie lisible (tests).
 * @param {Function} [options.log] Sortie (tests).
 * @returns {Promise<{skipped: boolean, reachable: boolean, ok: boolean,
 *   missing: string[], notices: string[], base: string, pages: object}>}
 *   `skipped` : rien à conclure (base locale seulement) ;
 *   `ok` : les intégrations NÉCESSAIRES sont présentes ET la production a
 *   répondu (Plausible est facultatif : son absence ne pèse pas) ;
 *   l'absence d'une intégration n'en fait PAS un échec par défaut.
 */
export async function runSeoProductionReport({
  base = process.env.KOJO_LHCI_BASE_URL || PROD_ORIGIN,
  fetchImpl = fetch,
  routes = PROBED_ROUTES,
  timeoutMs = 15000,
  quiet = false,
  log = console.log,
} = {}) {
  const notices = [];
  const cleanBase = String(base).trim().replace(/\/+$/, '');

  // Repli local : les quatre variables sont absentes par construction. Publier
  // quatre « ABSENT » laisserait croire à une production non configurée.
  if (isLoopbackBase(cleanBase)) {
    notices.push(
      `base locale (${cleanBase}) : les intégrations SEO/analytics s'activent par variables ` +
        "d'environnement, posées sur Vercel — un build local ne dit rien de la production, " +
        'aucune conclusion publiée.'
    );
    if (!quiet) log(`↷ sonde SEO ignorée : ${notices[0]}`);
    return {
      skipped: true,
      reachable: false,
      ok: true,
      missing: [],
      notices,
      base: cleanBase,
      pages: {},
    };
  }

  const pages = {};

  for (const route of routes) {
    const url = `${cleanBase}${route}`;
    const response = await fetchServedHtml({ url, fetchImpl, timeoutMs });
    if (!response.ok) {
      const detail = response.error
        ? `injoignable (${response.error})`
        : `HTTP ${response.status}`;
      pages[route] = { ok: false, detail, analysis: null };
      continue;
    }
    pages[route] = { ok: true, detail: `HTTP ${response.status}`, analysis: analyzeSeoServedHtml(response.html) };
  }

  const home = pages['/'];
  if (!home || !home.ok) {
    const detail = home ? home.detail : 'route / non sondée';
    notices.push(`accueil non lisible (${detail}) : aucune conclusion sur la configuration SEO.`);
    if (!quiet) log(`::warning title=SEO production injoignable::${detail}`);
    return {
      skipped: false,
      reachable: false,
      ok: false,
      missing: [],
      notices,
      base: cleanBase,
      pages,
    };
  }

  const analysis = home.analysis;
  const missing = INTEGRATIONS.filter(
    ({ key, required }) => required && !analysis[key].present
  ).map(({ key, env, audit }) => `${key} (${env}${audit ? ` — l'audit dit : ${audit}` : ''})`);

  for (const { key, label, env, audit } of INTEGRATIONS) {
    const state = analysis[key];
    if (state.present) {
      const detail =
        key === 'ga4'
          ? `gtag/js?id=${state.value}`
          : key === 'gsc'
            ? `jeton ${String(state.value).slice(0, 8)}…`
            : key === 'social'
              ? `${state.count} profil(s) dans le sameAs`
              : 'CSP script-src ouverte (script injecté par le bundle)';
      notices.push(`${label} : PRÉSENT — ${detail}`);
    } else {
      notices.push(
        `${label} : ABSENT — poser ${env} dans Vercel → Settings → Environment Variables, ` +
          'puis REDÉPLOYER (les VITE_* sont inlinées au build).' +
          (audit ? ` L'audit SEO la signale : « ${audit} ».` : '')
      );
    }
  }

  // Témoin : l'injection est faite pour CHAQUE page pré-rendue.
  for (const route of routes) {
    if (route === '/' || !pages[route]?.ok) continue;
    const other = pages[route].analysis;
    if (Boolean(other.ga4.present) !== Boolean(analysis.ga4.present)) {
      notices.push(
        `injection inégale : la balise GA4 est ${analysis.ga4.present ? 'présente' : 'absente'} ` +
          `sur / mais ${other.ga4.present ? 'présente' : 'absente'} sur ${route} — le plugin ` +
          "inject-seo-extras s'applique à chaque page pré-rendue."
      );
    }
  }

  const configured = INTEGRATIONS.filter(({ key }) => analysis[key].present).length;
  notices.push(
    `${configured}/${INTEGRATIONS.length} intégration(s) présente(s) — ` +
      (missing.length === 0
        ? 'les intégrations NÉCESSAIRES sont posées (Plausible reste facultatif).'
        : `${missing.length} nécessaire(s) absente(s) sur ${cleanBase}. Ce rapport ne bloque rien ` +
          "(cf. CI-COVERAGE.md, F9) ; `--fail-if-missing` permet d'en faire un garde.")
  );

  if (!quiet) {
    log(`Sonde SEO de la production — ${cleanBase}`);
    for (const route of routes) {
      const page = pages[route];
      log(`  ${route.padEnd(7)} ${page.ok ? page.detail : page.detail}`);
    }
    log(`  ${configured}/${INTEGRATIONS.length} intégration(s) présente(s)`);
  }
  for (const notice of notices) {
    log(`::notice title=SEO production::${notice}`);
  }

  return {
    skipped: false,
    reachable: true,
    ok: missing.length === 0,
    missing,
    notices,
    base: cleanBase,
    pages,
  };
}

function parseArgs(argv) {
  const options = { failIfMissing: false, base: undefined, timeoutMs: 15000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fail-if-missing') options.failIfMissing = true;
    else if (arg === '--base') options.base = argv[(index += 1)];
    else if (arg === '--timeout') options.timeoutMs = Number(argv[(index += 1)]);
  }
  return options;
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const options = parseArgs(process.argv.slice(2));
  const result = await runSeoProductionReport({
    base: options.base,
    timeoutMs: options.timeoutMs,
  });
  // Par défaut le rapport ne bloque pas : l'absence de configuration est un fait
  // d'exploitation, pas une régression de code. `--fail-if-missing` est prévu
  // pour le jour où les quatre variables sont posées sur Vercel ; il échoue
  // aussi quand la production est INJOIGNABLE (on ne peut pas confirmer la
  // configuration), mais jamais sur une base locale — là, il n'y a rien à
  // vérifier, et c'est dit.
  if (!result.skipped && !result.ok && options.failIfMissing) process.exit(1);
}
