#!/usr/bin/env node
/**
 * Garde-fou du ROUTAGE de la SPA (frontend/vercel.json).
 *
 * ── Ce que ce garde protège, et pourquoi ─────────────────────────────────────
 * 1. La fiche /jobs/:id est servie par un REWRITE Vercel
 *    (`/jobs/(.*)` → backend `/api/og/jobs/$1`), pas par une page du build :
 *    le cycle complet est vérifié contre le déploiement réel sur `main`, et
 *    depuis le 17/09/2026 sur CHAQUE PR, contre une pile locale qui rejoue
 *    cette même table de rewrites (`scripts/vercel-rewrite-server.js`) devant
 *    le backend de la PR — `check-og-job-200.js` ne s'arrête plus sur une base
 *    locale, il observe si elle sert la route (sonde 404 + noindex).
 *    Le comportement du backend est aussi couvert en processus par
 *    `backend/tests/test_job_og_cycle.py` ; ce garde couvre le maillon
 *    complémentaire : la CONFIGURATION qui achemine la requête.
 * 2. Les pages pré-rendues (`/jobs`, `/login`, …) doivent être servies par
 *    leur `.html` — `check-prerender-shells.js` vérifie le fichier, ce garde
 *    vérifie qu'il est atteignable ET non masqué par une règle plus large. La
 *    liste de ces pages DÉRIVE de src/config/page-meta.js (voir
 *    PRERENDERED_ROUTES) : elle n'est plus déclarée une seconde fois ici.
 * 3. AUCUN catch-all `/(.*)` → `/index.html` : c'est lui qui faisait répondre
 *    **200** à toute URL inconnue (« soft 404 »). Chaque route SPA est donc
 *    déclarée nommément, et le reste tombe sur la page 404 de Vercel (statut
 *    404, `404.html` émis au build).
 * 4. La SÉPARATION des gabarits : une page pré-rendue est servie par son
 *    propre `.html`, toute autre route par `app.html` (nu), et **jamais** par
 *    `index.html`. Servir `index.html` à `/dashboard` publiait le contenu de
 *    l'accueil (h1, 300+ mots, liens internes) sous une dizaine d'adresses :
 *    du contenu dupliqué, et un canonical statique "/" sur toutes ces routes.
 * 5. Les routes PRIVÉES (dashboard, profil, messages, admin…) ne doivent pas
 *    être indexables, et le noindex est dit par les TROIS surfaces qui le
 *    publient — toutes dérivées de la même liste (voir privateRoutesOf) :
 *      • `X-Robots-Tag: noindex` dans vercel.json (l'en-tête, celui qu'un
 *        crawler lit sans exécuter la page) ;
 *      • `<meta name="robots" content="noindex, follow">` dans build/app.html,
 *        le gabarit qui les sert TOUTES — il disait `index, follow` (hérité du
 *        gabarit d'accueil) : l'en-tête et le document se contredisaient ;
 *      • `Disallow` dans build/robots.txt, GÉNÉRÉ au build depuis la même
 *        liste (voir robotsTxtFor) : la liste écrite à la main dans le backend
 *        en couvrait 4 sur 9, et manquait silencieusement les cinq autres.
 *    Ce qu'est une route privée DÉRIVE du routage réel : ajouter une page
 *    oblige à choisir — ses textes dans src/config/page-meta.js (publique),
 *    ou son noindex (privée). Un tableau de bord indexé par un moteur, c'est
 *    une page vide dans les résultats.
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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// La liste des pages pré-rendues se LIT ici, elle ne se recopie pas : c'est la
// table des textes de route dont le BUILD écrit les coquilles (vite.config.js).
import { PAGE_META } from '../src/config/page-meta.js';
import { SITE_ORIGIN, metaContents, shellFileFor } from './site-meta.js';

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
// Gabarit NU des routes clientes (émis par vite.config.js) : aucun contenu de
// page, aucun canonical, aucun JSON-LD — voir le plugin prerender-route-meta.
export const APP_HTML = '/app.html';
// Pages réellement pré-rendues dans le build : chacune a son propre fichier.
// Toute autre route de production doit être servie par APP_HTML.
//
// ── DÉRIVÉE, et non recopiée ─────────────────────────────────────────────────
// Cette liste était écrite à la main ici — une SECONDE déclaration des mêmes
// pages que celle du build. Rien ne les reliait : ajouter une route pré-rendue
// sans l'ajouter ici la faisait servir par app.html (le gabarit nu, titre
// « Kojo », aucun h1) sans qu'aucun test ne le voie, et l'inverse laissait le
// garde exiger un routage pour une page qui n'existe pas.
//
// La source unique est src/config/page-meta.js : ses clés SONT les routes qui
// publient un titre et une description, et c'est exactement ce que
// vite.config.js pré-rend (`<route>.html`), la racine mise à part (index.html).
// Déclarer une page se fait donc à UN endroit, et le garde suit.
export const PRERENDERED_ROUTES = Object.keys(PAGE_META)
  .filter((route) => route !== '/')
  .map((route) => route.slice(1));
// ── Les routes privées DÉRIVENT du routage, elles ne se déclarent pas ────────
// Une route de production n'a que deux états, et c'est le routage réel qui les
// sépare :
//   • PUBLIQUE — ses textes sont déclarés dans src/config/page-meta.js (le build
//     lui écrit sa coquille `<route>.html`), ou elle est servie par un rewrite
//     vers le BACKEND, qui la pré-rend (la fiche /jobs/:id) ;
//   • PRIVÉE   — tout le reste : servie par le gabarit nu app.html, donc tenue
//     au noindex.
//
// Cette liste était écrite à la main ici. Une page ajoutée à App.js et oubliée
// dans cette liste n'appartenait à AUCUN des deux ensembles : servie par
// app.html (dont la coquille dit `robots: index, follow`), sans X-Robots-Tag,
// indexable sous le titre neutre du gabarit — et aucun garde ne le voyait
// (mesuré : une route /nouvelle-page passait en silence). Dérivée du routage,
// cette page tombe maintenant dans le second ensemble et le garde RÉCLAME son
// noindex : l'auteur doit choisir.
//
// @param {string[]} routes Routes de production extraites de App.js.
// @param {Array<{source?: string, destination?: string}>} rewrites Table de
//        routage de vercel.json (une destination hors build = pré-rendue par le
//        serveur).
export function privateRoutesOf(routes, rewrites = []) {
  const servedByServer = (route) =>
    rewrites.some((rule) => {
      if (!rule || /\.html$/.test(String(rule.destination || ''))) return false;
      return rule.source === route || matchesPattern(route, String(rule.source || ''));
    });
  return routes.filter((route) => !Object.hasOwn(PAGE_META, route) && !servedByServer(route));
}

// ── robots.txt : un ARTEFACT DU BUILD, pas une seconde déclaration ───────────
// Le fichier était servi par le BACKEND (`/api/robots.txt`, proxifié par un
// rewrite Vercel), avec sa propre liste `Disallow` écrite à la main dans
// kojo_routers_public.py. Cette liste et la dérivation ci-dessus ne se
// parlaient pas : mesuré le 20/09/2026, elle couvrait **4 routes privées sur 9**
// (`/create-job`, `/email-verification`, `/payment-verification`,
// `/commission-dashboard`, `/support-admin` étaient donc crawlables), et rien
// ne pouvait le voir — la seule assertion portait sur la balise `Sitemap`.
//
// robots.txt est désormais ÉCRIT PAR LE BUILD depuis `privateRoutesOf`, comme
// les coquilles pré-rendues : la même source alimente l'en-tête de vercel.json,
// le meta de app.html et ce fichier, donc une route privée de plus ne peut plus
// manquer à l'un des trois. Le texte est rendu ici — par le module qui DÉRIVE la
// liste — pour qu'il n'existe aucune autre définition de ce qu'un robots.txt
// privé doit contenir.
export const ROBOTS_TXT = 'robots.txt';

// `/api/` n'est pas une route de l'application : c'est le proxy du backend, et
// il n'a jamais eu vocation à être crawlé. Il vit donc ici, avec le rendu, et
// pas dans la liste des pages.
export const API_DISALLOW = '/api/';

/**
 * Contenu du robots.txt publié, DÉRIVÉ de la liste des routes privées.
 *
 * Le `Allow: /` général suffit : les `Allow:` nominatifs qui l'accompagnaient
 * (`/login`, `/register`, `/jobs`, `/how-it-works`) étaient une liste de pages
 * PUBLIQUES tenue à la main de plus, à côté de celle de la dérivation — et
 * redondante, puisque tout chemin non interdit est autorisé.
 *
 * @param {string[]} privateRoutes Routes privées dérivées (voir privateRoutesOf).
 * @param {string} siteOrigin Origine canonique du site (scripts/site-meta.js).
 * @returns {string} Le fichier complet, terminateur de ligne final compris.
 */
export function robotsTxtFor(privateRoutes, siteOrigin) {
  const disallow = [API_DISALLOW, ...privateRoutes].sort();
  return [
    'User-agent: *',
    'Allow: /',
    ...disallow.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${siteOrigin}/sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * Chemins interdits déclarés par un robots.txt — ce que le fichier PUBLIÉ dit,
 * relu pour être comparé à la liste dérivée (et non à une copie du texte).
 *
 * @param {string} body Contenu du fichier.
 * @returns {string[]} Chemins des lignes `Disallow:`, triés.
 */
export function disallowPathsOf(body) {
  const paths = [];
  for (const line of String(body).split(/\r?\n/)) {
    const match = /^\s*Disallow:\s*(\S+)\s*$/.exec(line);
    if (match) paths.push(match[1]);
  }
  return paths.sort();
}

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

  // ── 3. Découverte : sitemap proxifié, robots.txt servi par le build ───────
  // Le sitemap est DYNAMIQUE (il énumère les fiches /jobs/:id vivantes) : il
  // reste proxifié vers le backend. robots.txt, lui, est écrit au build depuis
  // la liste des routes privées — un rewrite le masquerait (la réécriture passe
  // avant le fichier statique), donc l'ancien rewrite n'est plus une exigence
  // mais un DÉFAUT : il servirait une liste figée dans le backend.
  const sitemapRewrite = find('/sitemap.xml');
  if (!sitemapRewrite) {
    errors.push("aucun rewrite « /sitemap.xml » → /api/sitemap.xml : le sitemap dynamique du backend n'est plus servi");
  } else if (!String(sitemapRewrite.destination || '').endsWith('/api/sitemap.xml')) {
    errors.push(`le rewrite « /sitemap.xml » devrait mener à « /api/sitemap.xml », pas « ${sitemapRewrite.destination} »`);
  }
  const robotsRewrite = find('/robots.txt');
  if (robotsRewrite) {
    errors.push(
      `vercel.json réécrit « /robots.txt » vers « ${robotsRewrite.destination} » : ce rewrite MASQUE ` +
        `le ${ROBOTS_TXT} écrit par le build (la réécriture passe avant le fichier statique) — ` +
        'supprimer la règle, et avec elle la seconde liste de routes privées qu\'elle servait'
    );
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
  // Les routes extraites servent aussi au point 6ter : une route privée qui
  // n'existe plus dans App.js ne doit pas être réclamée à vercel.json (sinon on
  // exigerait un en-tête pour une page qui n'est jamais servie).
  let productionRoutes = [];
  const appPath = path.join(frontendDir, APP_JS);
  if (!existsSync(appPath)) {
    errors.push(`${APP_JS} introuvable : impossible de vérifier que chaque route React est routée`);
  } else {
    const { routes, devOnly } = parseAppRoutes(readFileSync(appPath, 'utf8'));
    productionRoutes = routes;
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
          continue;
        }
        const destination = String(rule.destination || '');
        if (!/\.html$/.test(destination)) {
          errors.push(
            `vercel.json : la règle « ${source} » doit servir un fichier .html, pas « ${rule.destination} »`
          );
          continue;
        }
        // Le gabarit attendu dépend de la route : sa propre page pré-rendue
        // si elle existe, sinon app.html — JAMAIS index.html.
        const expected = PRERENDERED_ROUTES.includes(pathname.replace(/^\//, ''))
          ? `/${shellFileFor(pathname)}`
          : APP_HTML;
        if (destination !== expected) {
          errors.push(
            `vercel.json : « ${source} » est servie par « ${destination} » au lieu de « ${expected} »` +
              (destination === SPA_INDEX
                ? ' — servir index.html à une route cliente publie le contenu de l\'accueil' +
                  ' (h1, mots, liens) sous cette adresse : contenu dupliqué'
                : '')
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

  // ── 6bis. index.html ne sert QUE « / » ───────────────────────────────────
  // C'est la contrepartie du shell d'accueil désormais présent dans
  // index.html : tant qu'aucune règle ne l'envoie ailleurs, il n'est peint que
  // sur la racine. La règle ci-dessus (destination attendue) le vérifie route
  // par route, celle-ci couvre les destinations orphelines (une règle ajoutée
  // à la main vers index.html sans route React correspondante).
  for (const rule of rewrites) {
    if (rule && rule.destination === SPA_INDEX) {
      errors.push(
        `vercel.json : « ${rule.source} » → « ${SPA_INDEX} » — index.html porte le shell de ` +
          'l\'accueil et ne doit être servi que sur « / » ; les routes clientes utilisent ' +
          `« ${APP_HTML} »`
      );
    }
  }

  // ── 6ter. Routes privées non indexables ──────────────────────────────────
  const headerRules = Array.isArray(config.headers) ? config.headers : [];
  const robotsTagFor = (route) => {
    for (const entry of headerRules) {
      if (!entry || !Array.isArray(entry.headers)) continue;
      const source = String(entry.source || '');
      // Exact, ou motif qui VISE cette route : « /dashboard/:onglet » ne peut
      // pas être nommée exactement. « /(.*) » la capture aussi, mais il couvre
      // la racine — donc tout le site : un noindex posé là désindexerait les
      // pages publiques au lieu de protéger celle-ci.
      const targeted =
        source === route ||
        (matchesPattern(route, source) && !patternToRegex(source).test('/'));
      if (!targeted) continue;
      const found = entry.headers.find(
        (h) => h && String(h.key).toLowerCase() === 'x-robots-tag'
      );
      if (found) return String(found.value || '');
    }
    return null;
  };
  const privateRoutes = privateRoutesOf(productionRoutes, rewrites);
  for (const route of privateRoutes) {
    const tag = robotsTagFor(route);
    if (tag === null) {
      errors.push(
        `vercel.json : la route « ${route} » n'est déclarée NI publique NI privée — aucun texte ` +
          `dans src/config/page-meta.js (donc servie par le gabarit nu ${APP_HTML}, titre « Kojo ») ` +
          'et aucun X-Robots-Tag noindex. Choisir : déclarer ses textes dans src/config/page-meta.js ' +
          '(page publique, coquille pré-rendue et indexée), ou ajouter « X-Robots-Tag: noindex, ' +
          'follow » pour cette route dans vercel.json (page privée)'
      );
    } else if (!/noindex/i.test(tag)) {
      errors.push(`vercel.json : « ${route} » doit porter noindex, pas « ${tag} »`);
    }
  }

  // ── 7. La page 404 existe réellement dans le build et n'est pas indexable ─
  const notFoundPath = path.join(buildDir, '404.html');
  if (existsSync(buildDir)) {
    // 7bis. La racine : c'est le fichier que Vercel sert pour « / ».
    if (!existsSync(path.join(buildDir, 'index.html'))) {
      errors.push('build/index.html absent : la racine du site ne serait servie par rien');
    }
    // 7ter. Le gabarit des routes clientes existe et reste NU.
    const appPathOnDisk = path.join(buildDir, 'app.html');
    if (!existsSync(appPathOnDisk)) {
      errors.push(
        `build/app.html absent : toutes les routes clientes (${privateRoutes.join(', ')}) ` +
          'serviraient une page inexistante en production'
      );
    } else {
      const appHtml = readFileSync(appPathOnDisk, 'utf8');
      if (/<h1[\s>]/i.test(appHtml)) {
        errors.push(
          "build/app.html contient un <h1> : ce gabarit sert une dizaine de routes, il publierait " +
            "le même titre de page partout (contenu dupliqué) — les titres des routes clientes " +
            'sont posés au runtime par usePageTitle'
        );
      }
      if (/rel="canonical"/i.test(appHtml)) {
        errors.push(
          'build/app.html contient un canonical : une seule valeur ne peut pas décrire dix routes ' +
            '(le canonical par route est posé par usePageTitle)'
        );
      }
      if (/application\/ld\+json/i.test(appHtml)) {
        errors.push(
          'build/app.html contient un JSON-LD : le schéma de l\'organisation se déclare une fois, ' +
            'sur la page d\'accueil'
        );
      }
      if (!/<div id="root"><\/div>/.test(appHtml)) {
        errors.push(
          'build/app.html doit garder <div id="root"></div> VIDE : c\'est un gabarit sans ' +
            'contenu de page (React peint après le boot)'
        );
      }
      // 7ter-bis. Le gabarit des routes CLIENTES ne peut pas se dire indexable :
      // il les sert TOUTES, et toutes sont privées. Il héritait du `index,
      // follow` du gabarit d'accueil par simple recopie : le document et
      // l'en-tête X-Robots-Tag de vercel.json se contredisaient alors sur les
      // mêmes URL (mesuré en production le 20/09/2026 sur /dashboard,
      // /messages, /profile, /photo-debug, /support-admin).
      const appRobots = metaContents(appHtml, 'robots');
      if (!appRobots.some((value) => /noindex/i.test(value))) {
        errors.push(
          'build/app.html doit porter <meta name="robots" content="noindex, follow"> : ' +
            `c'est le gabarit des ${privateRoutes.length} routes privées, et il annonçait ` +
            `« ${appRobots.join(', ') || 'rien'} » quand vercel.json leur envoie X-Robots-Tag noindex — ` +
            'deux verdicts contradictoires sur les mêmes URL'
        );
      }
    }
    // 7quater. Tout fichier .html pré-rendu doit être déclaré : sinon une page
    // est générée par le build mais jamais servie par le routage.
    for (const file of readdirSync(buildDir)) {
      if (!file.endsWith('.html')) continue;
      const route = file.replace(/\.html$/, '');
      if (['index', '404', 'app'].includes(route)) continue;
      if (!PRERENDERED_ROUTES.includes(route)) {
        errors.push(
          `build/${file} est pré-rendu mais AUCUNE route ne le déclare : le routage ne le sert ` +
            'pas (ou le sert au mauvais endroit) — c\'est src/config/page-meta.js qui déclare une ' +
            'page (elle aura alors sa coquille), et frontend/vercel.json qui la route.'
        );
      }
    }

    // 7quinquies. robots.txt : dérivé de la même liste, ou rien.
    // Ce fichier était servi par le backend avec sa propre liste écrite à la
    // main (4 routes privées sur 9, mesuré le 20/09/2026) : il est maintenant
    // écrit par le build, et relu ici. On refuse aussi une SECONDE déclaration
    // (public/robots.txt), qui serait recopiée dans le build à côté du fichier
    // généré — le motif « une copie à côté de la source » que ce dépôt supprime.
    const publicRobots = path.join(frontendDir, 'public', ROBOTS_TXT);
    if (existsSync(publicRobots)) {
      errors.push(
        `public/${ROBOTS_TXT} existe : c'est une seconde déclaration des routes privées, ` +
          `recopiée dans le build à côté du ${ROBOTS_TXT} généré — la supprimer (le build l'écrit ` +
          'depuis la dérivation, voir vite-plugins/write-robots-txt.js)'
      );
    }
    const robotsPath = path.join(buildDir, ROBOTS_TXT);
    if (!existsSync(robotsPath)) {
      errors.push(
        `build/${ROBOTS_TXT} absent : les routes privées (${privateRoutes.join(', ')}) ` +
          'redeviendraient crawlables — ce fichier est écrit par le build'
      );
    } else {
      const robotsBody = readFileSync(robotsPath, 'utf8');
      const expected = [API_DISALLOW, ...privateRoutes].sort();
      const declared = disallowPathsOf(robotsBody);
      const missing = expected.filter((pathname) => !declared.includes(pathname));
      const extra = declared.filter((pathname) => !expected.includes(pathname));
      if (missing.length || extra.length) {
        errors.push(
          `build/${ROBOTS_TXT} ne dérive pas du routage : ` +
            (missing.length ? `il MANQUE ${missing.join(', ')} (routes privées crawlables)` : '') +
            (missing.length && extra.length ? ' ; ' : '') +
            (extra.length
              ? `il interdit ${extra.join(', ')}, qui n'est aucune route privée dérivée`
              : '')
        );
      }
      const sitemapLine = `Sitemap: ${SITE_ORIGIN}/sitemap.xml`;
      if (!robotsBody.includes(sitemapLine)) {
        errors.push(
          `build/${ROBOTS_TXT} doit publier « ${sitemapLine} » — sans elle, la découverte ` +
            'des pages ne passe plus que par un lien externe'
        );
      }
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
      `${rewrites.length} rewrites analysés : fiche /jobs/:id → backend, sitemap proxifié, ` +
        'routes SPA déclarées nommément et aucune règle masquée (URL inconnue → 404)'
    );
    notices.push(
      `${privateRoutes.length} route(s) privée(s) dérivée(s) du routage : X-Robots-Tag dans ` +
        `vercel.json, meta de build/app.html et Disallow de build/${ROBOTS_TXT} — trois surfaces, ` +
        'une seule liste'
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
