#!/usr/bin/env node
/**
 * Garde-fou du ROUTAGE de la SPA (frontend/vercel.json).
 *
 * ── Ce que ce garde protège, et pourquoi ─────────────────────────────────────
 * 1. La fiche /jobs/:id est servie par un REWRITE Vercel
 *    (`/jobs/(.*)` → backend `/api/og/jobs/$1`), pas par une page du build :
 *    sur `main`, le cycle complet est vérifié contre le déploiement réel par
 *    `check-og-job-200.js` ; sur une PR ce script s'arrête (preview protégée).
 *    Le comportement du backend est couvert en processus par
 *    `backend/tests/test_job_og_cycle.py` ; ce garde couvre le maillon qui
 *    manquait : la CONFIGURATION qui achemine la requête.
 * 2. Les pages pré-rendues (`/jobs`, `/login`, …) doivent être servies par
 *    leur `.html` — `check-prerender-shells.js` vérifie le fichier, ce garde
 *    vérifie qu'il est atteignable ET non masqué par une règle plus large.
 * 3. AUCUN catch-all `/(.*)` → `/index.html` : c'est lui qui faisait répondre
 *    **200** à toute URL inconnue (« soft 404 »). Chaque route SPA est donc
 *    déclarée nommément, et le reste tombe sur la page 404 de Vercel (statut
 *    404, `404.html` émis au build).
 *
 * ── Les pièges vérifiés ──────────────────────────────────────────────────────
 *   • une route React absente de vercel.json → 404 en production (l'app ne la
 *     sert jamais), ou pire : l'inverse d'avant, un catch-all silencieux ;
 *   • une règle EXACTE placée APRÈS une règle à motif qui la capture est
 *     inatteignable : `/jobs/` après `/jobs/(.*)` renvoyait le 404 JSON du
 *     backend pour la page la plus visitée du site (mesuré en production le
 *     16/09/2026) ;
 *   • le rewrite de la fiche qui ne vise plus la route réellement déclarée par
 *     le backend (import/renommage de `kojo_routers_public.py`).
 *
 * Usage : cd frontend && node scripts/check-spa-routes.js
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');

export const VERCEL_JSON = 'vercel.json';
export const BACKEND_ROUTER = 'backend/kojo_routers_public.py';
// Route backend attendue derrière le rewrite (source de vérité côté serveur).
export const BACKEND_OG_ROUTE = '/og/jobs/{job_id}';
export const JOB_REWRITE_SOURCE = '/jobs/(.*)';
// Le rewrite doit produire ce suffixe, quel que soit le backend visé.
export const JOB_REWRITE_SUFFIX = '/api/og/jobs/$1';
export const SPA_CATCH_ALL = '/(.*)';
export const SPA_INDEX = '/index.html';
export const APP_JS = 'src/App.js';
// Routes volontairement NON routées : elles n'existent qu'en développement
// (bloc `import.meta.env.DEV` de App.js) — les router en production exposerait
// des pages de test absentes du build.
export const DEV_ONLY_ROUTES = ['/mobile-test', '/photo-test'];

/**
 * Extrait d'un motif Vercel (`/jobs/(.*)`, `/api/:path*`) la regex qui décide
 * si une source donnée est capturée par cette règle.
 *
 * @param {string} pattern Source d'une règle (`(.*)`, `:param`, `:param*`).
 * @returns {RegExp}
 */
export function patternToRegex(pattern) {
  // Analyse caractère par caractère : échapper d'abord casserait la
  // reconnaissance du motif (`\(` n'est plus `(`), et une simple substitution
  // globale confondrait une parenthèse littérale avec un joker.
  const ANY = '\u0000ANY\u0000';
  const SEGMENT = '\u0000SEG\u0000';
  const source = String(pattern);
  let out = '';
  for (let index = 0; index < source.length; ) {
    if (source.startsWith('(.*)', index)) {
      out += ANY;
      index += 4;
      continue;
    }
    const param = /^:([A-Za-z0-9_]+)(\*)?/.exec(source.slice(index));
    if (param) {
      out += param[2] ? ANY : SEGMENT;
      index += param[0].length;
      continue;
    }
    out += source[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    index += 1;
  }
  const regex = out
    .split(ANY)
    .join('.*')
    .split(SEGMENT)
    .join('[^/]+');
  return new RegExp(`^${regex}$`);
}

/**
 * Vrai si `source` est capturée par `pattern` (motif plus large).
 *
 * @param {string} source
 * @param {string} pattern
 */
export function matchesPattern(source, pattern) {
  if (source === pattern) return false;
  if (!/\(\.\*\)|:[A-Za-z0-9_]+\*?/.test(pattern)) return false;
  return patternToRegex(pattern).test(source);
}

/**
 * Règles exactes rendues inatteignables par une règle à motif placée avant.
 *
 * @param {Array<{source?: string, destination?: string}>} rewrites
 * @returns {Array<{source: string, shadowedBy: string}>}
 */
export function findShadowedRules(rewrites) {
  const shadowed = [];
  rewrites.forEach((rule, index) => {
    const source = rule && rule.source;
    if (typeof source !== 'string') return;
    if (/\(\.\*\)|:/.test(source)) return; // la règle elle-même est un motif
    for (let earlier = 0; earlier < index; earlier += 1) {
      const previous = rewrites[earlier];
      if (previous && typeof previous.source === 'string' && matchesPattern(source, previous.source)) {
        shadowed.push({ source, shadowedBy: previous.source });
        return;
      }
    }
  });
  return shadowed;
}

/**
 * Routes déclarées par App.js, séparées en production / développement.
 *
 * @param {string} source Contenu de src/App.js.
 * @returns {{routes: string[], devOnly: string[]}}
 */
export function parseAppRoutes(source) {
  const routes = [];
  const devOnly = [];
  // Le bloc de développement est délimité par `import.meta.env.DEV && ( … )` :
  // on le reconnaît en comptant les parenthèses (indentation indépendante),
  // et si la fermeture est INTROUVABLE on ne devine rien — tout le fichier
  // serait sinon classé « développement » et le garde deviendrait inerte.
  // `import.meta.env.DEV` apparaît aussi dans les COMMENTAIRES de App.js
  // (explication des routes de test) : on ne retient que la forme
  // conditionnelle du code (`DEV && (`), sinon la recherche démarre dans du
  // texte et classe des routes de production en « développement ».
  const devCondition = /import\.meta\.env\.DEV\s*&&\s*\(/.exec(source);
  const devBlockStart = devCondition ? devCondition.index : -1;
  let devBlock = '';
  if (devBlockStart !== -1) {
    const openIndex = devBlockStart + devCondition[0].length - 1;
    if (openIndex !== -1) {
      let depth = 0;
      for (let index = openIndex; index < source.length; index += 1) {
        if (source[index] === '(') depth += 1;
        else if (source[index] === ')') {
          depth -= 1;
          if (depth === 0) {
            devBlock = source.slice(devBlockStart, index + 1);
            break;
          }
        }
      }
    }
  }
  const pattern = /<Route\s+path="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const route = match[1];
    const inDevBlock =
      devBlock !== '' &&
      devBlockStart < match.index &&
      match.index < devBlockStart + devBlock.length;
    if (inDevBlock) {
      if (!devOnly.includes(route)) devOnly.push(route);
    } else if (!routes.includes(route)) {
      routes.push(route);
    }
  }
  return { routes, devOnly };
}

/**
 * Contrôle l'ensemble du routage.
 *
 * @param {{frontendDir?: string, repoRoot?: string, buildDir?: string}} options
 * @returns {{ok: boolean, errors: string[], notices: string[], rewrites: number}}
 */
export function runSpaRoutesCheck(options = {}) {
  const frontendDir = options.frontendDir || FRONTEND_DIR;
  const repoRoot = options.repoRoot || REPO_ROOT;
  const buildDir = options.buildDir || path.join(frontendDir, 'build');
  const errors = [];
  const notices = [];

  const vercelPath = path.join(frontendDir, VERCEL_JSON);
  if (!existsSync(vercelPath)) {
    return {
      ok: false,
      errors: [`${VERCEL_JSON} introuvable dans ${frontendDir} — le garde ne peut rien vérifier`],
      notices,
      rewrites: 0,
    };
  }

  let config;
  try {
    config = JSON.parse(readFileSync(vercelPath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      errors: [`${VERCEL_JSON} illisible (${error.message}) : un routage non analysable ne peut pas être validé`],
      notices,
      rewrites: 0,
    };
  }

  const rewrites = Array.isArray(config.rewrites) ? config.rewrites : [];
  if (rewrites.length === 0) {
    return {
      ok: false,
      errors: [`${VERCEL_JSON} ne déclare aucun rewrite — plus aucune route n'est servie`],
      notices,
      rewrites: 0,
    };
  }

  const find = (source) => rewrites.find((rule) => rule && rule.source === source);
  const indexOfSource = (source) => rewrites.findIndex((rule) => rule && rule.source === source);

  // ── 1. Le rewrite de la fiche mène bien à la route OG du backend ─────────
  const jobRewrite = find(JOB_REWRITE_SOURCE);
  if (!jobRewrite) {
    errors.push(
      `aucun rewrite « ${JOB_REWRITE_SOURCE} » : la fiche mission pré-rendue n'est plus servie, ` +
        "les crawlers recevront la page React (et son og:image d'accueil)"
    );
  } else {
    const destination = String(jobRewrite.destination || '');
    if (!destination.endsWith(JOB_REWRITE_SUFFIX)) {
      errors.push(
        `le rewrite « ${JOB_REWRITE_SOURCE} » mène à « ${destination} » au lieu de se terminer par ` +
          `« ${JOB_REWRITE_SUFFIX} » — vérifie le chemin côté backend`
      );
    }
    if (!/^https:\/\//.test(destination)) {
      errors.push(
        `le rewrite « ${JOB_REWRITE_SOURCE} » n'est pas une destination absolue (https) : « ${destination} »`
      );
    }
  }

  // ── 2. Cohérence de backend avec le proxy /api ────────────────────────────
  const apiProxy = find('/api/:path*');
  if (!apiProxy) {
    errors.push('aucun rewrite « /api/:path* » : les appels API ne sont plus proxifiés vers le backend');
  } else if (jobRewrite) {
    const host = (url) => {
      try {
        return new URL(String(url).replace('$1', 'x')).host;
      } catch (_error) {
        return null;
      }
    };
    const jobHost = host(jobRewrite.destination);
    const apiHost = host(apiProxy.destination);
    if (jobHost && apiHost && jobHost !== apiHost) {
      errors.push(
        `la fiche mission et le proxy API ne visent pas le même backend ` +
          `(« ${jobHost} » contre « ${apiHost} ») : la fiche afficherait des données d'un autre service`
      );
    }
  }

  // ── 3. Découverte : sitemap et robots servis par le backend ───────────────
  for (const [source, suffix] of [
    ['/sitemap.xml', '/api/sitemap.xml'],
    ['/robots.txt', '/api/robots.txt'],
  ]) {
    const rewrite = find(source);
    if (!rewrite) {
      errors.push(`aucun rewrite « ${source} » → ${suffix} : le sitemap/robots dynamique du backend n'est plus servi`);
    } else if (!String(rewrite.destination || '').endsWith(suffix)) {
      errors.push(`le rewrite « ${source} » devrait mener à « ${suffix} », pas « ${rewrite.destination} »`);
    }
  }

  // ── 4. AUCUN catch-all : sinon toute URL inconnue répond 200 ──────────────
  // C'est le correctif « soft 404 » : une URL inexistante doit répondre 404.
  // Un catch-all `/(.*)` → `/index.html` rend 200 sur n'importe quoi, et un
  // moteur finit par indexer des centaines d'URL vides.
  if (indexOfSource(SPA_CATCH_ALL) !== -1) {
    errors.push(
      `le catch-all « ${SPA_CATCH_ALL} » → « ${SPA_INDEX} » est de retour : toute URL inconnue ` +
        'répondrait 200 (soft 404). Les routes SPA doivent être déclarées nommément'
    );
  }

  // ── 5. Chaque route de production est routée (deux formes) ────────────────
  const appPath = path.join(frontendDir, APP_JS);
  if (!existsSync(appPath)) {
    errors.push(`${APP_JS} introuvable : impossible de vérifier que chaque route React est routée`);
  } else {
    const { routes, devOnly } = parseAppRoutes(readFileSync(appPath, 'utf8'));
    if (routes.length === 0) {
      errors.push(`${APP_JS} : aucune route extraite — le garde ne prouve rien (format des <Route> changé ?)`);
    }
    for (const route of routes) {
      const pathname = route === '/' ? '' : route.replace(/\/$/, '');
      // `/` n'a pas besoin de rewrite : Vercel sert `index.html` à la racine
      // de outputDirectory (vérifié : build/index.html existe, point 7bis).
      if (pathname === '') continue;
      // `/jobs/:id` est servie par le backend (rewrite de la fiche), pas par
      // le build : on exige la forme à motif, vérifiée au point 1.
      if (pathname.includes(':')) continue;
      for (const source of [`${pathname}/`, pathname]) {
        const rule = find(source);
        if (!rule) {
          errors.push(
            `vercel.json : aucune règle pour « ${source} » — cette route React répondrait **404** en production`
          );
        } else if (typeof rule.destination !== 'string' || !/\.html$/.test(rule.destination)) {
          errors.push(
            `vercel.json : la règle « ${source} » doit servir un fichier .html, pas « ${rule.destination} »`
          );
        }
      }
    }
    // Les routes de développement ne doivent PAS être routées : elles
    // n'existent pas dans le build de production.
    for (const route of devOnly) {
      if (find(route) || find(`${route}/`)) {
        errors.push(
          `vercel.json : la route de DÉVELOPPEMENT « ${route} » est routée — elle n'existe pas dans le build de production`
        );
      }
    }
    for (const route of DEV_ONLY_ROUTES) {
      if (!devOnly.includes(route)) {
        errors.push(
          `« ${route} » n'est plus gardée par import.meta.env.DEV dans ${APP_JS} : mettre à jour DEV_ONLY_ROUTES ` +
            'et router la route si elle doit exister en production'
        );
      }
    }
    notices.push(`${routes.length} routes React de production routées (${devOnly.length} route(s) de développement exclue(s))`);
  }

  // ── 6. Aucune règle exacte rendue inatteignable par une règle à motif ─────
  for (const { source, shadowedBy } of findShadowedRules(rewrites)) {
    errors.push(
      `règle « ${source} » inatteignable : « ${shadowedBy} » (placée avant) la capture — ` +
        'cette URL serait servie par la mauvaise destination'
    );
  }

  // ── 7. La page 404 existe réellement dans le build et n'est pas indexable ─
  const notFoundPath = path.join(buildDir, '404.html');
  if (existsSync(buildDir)) {
    // 7bis. La racine : c'est le fichier que Vercel sert pour « / ».
    if (!existsSync(path.join(buildDir, 'index.html'))) {
      errors.push('build/index.html absent : la racine du site ne serait servie par rien');
    }
    if (!existsSync(notFoundPath)) {
      errors.push('build/404.html absent : les URL inconnues n\'auraient pas de page dédiée (elles répondraient 404, mais sans contenu utile)');
    } else {
      const html = readFileSync(notFoundPath, 'utf8');
      if (!/name="robots"[^>]*noindex/i.test(html)) {
        errors.push('build/404.html doit être en noindex (une page 404 indexable est un « soft 404 »)');
      }
      if (/<script/i.test(html)) {
        errors.push('build/404.html ne doit contenir AUCUN script : elle doit s\'afficher même si le bundle échoue');
      }
    }
  }

  // ── 8. Cohérence avec la route réellement déclarée par le backend ─────────
  const routerPath = path.join(repoRoot, BACKEND_ROUTER);
  if (!existsSync(routerPath)) {
    errors.push(`${BACKEND_ROUTER} introuvable : impossible de vérifier que la route OG existe côté backend`);
  } else if (!readFileSync(routerPath, 'utf8').includes(`"${BACKEND_OG_ROUTE}"`)) {
    errors.push(
      `la route backend « ${BACKEND_OG_ROUTE} » n'est plus déclarée dans ${BACKEND_ROUTER} : ` +
        `le rewrite « ${JOB_REWRITE_SOURCE} » pointe vers un chemin qui n'existe plus`
    );
  }

  if (errors.length === 0) {
    notices.push(
      `${rewrites.length} rewrites analysés : fiche /jobs/:id → backend, découverte proxifiée, ` +
        'routes SPA déclarées nommément et aucune règle masquée (URL inconnue → 404)'
    );
  }

  return { ok: errors.length === 0, errors, notices, rewrites: rewrites.length };
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = runSpaRoutesCheck();
  if (!result.ok) {
    console.error(`❌ Routage non conforme (${result.errors.length} problème(s)) :`);
    for (const message of result.errors) console.error(`   • ${message}`);
    process.exit(1);
  }
  console.log(`✅ Routage verrouillé (${VERCEL_JSON}) :`);
  for (const message of result.notices) console.log(`   ℹ️  ${message}`);
}
