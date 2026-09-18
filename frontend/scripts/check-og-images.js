#!/usr/bin/env node
/**
 * Vérification OG des pages auditées par Lighthouse CI (job lighthouse-ci).
 *
 * La liste des routes vient des PAGES DU PROJET (`DEPLOYMENT_PATHS` de
 * lighthouserc.cjs, lues par lighthouseAuditedPaths) et la table route → carte
 * OG en DÉRIVE (`ROUTES`, plus bas) : vite.config.js l'importe pour écrire les
 * coquilles pré-rendues, donc le producteur, le vérificateur et le périmètre
 * Lighthouse ne peuvent plus diverger — une page pré-rendue absente de la liste
 * fait ÉCHOUER le build, et une carte dédiée qui ne désigne aucune de ces pages
 * aussi (voir deriveRoutes).
 *
 * Pour chaque route de la table, fetch le HTML SERVI (ce que reçoit un crawler
 * sans JS) et vérifie :
 *   1. la meta og:image est présente ;
 *   2. elle est en URL ABSOLUE (https://…) — une URL relative est ignorée
 *      par les crawlers de partage ;
 *   3. elle pointe vers la carte dérivée pour cette route, et la variante
 *      CARRÉE dérivée est elle aussi présente ;
 *   4. twitter:image est aussi absolue.
 * Et, avant tout appel réseau : la table n'est pas vide (une liste illisible ne
 * doit pas produire un contrôle qui ne vérifie rien).
 * Puis, pour /jobs/:id (fiche mission pré-rendue par le backend), valide la
 * carte DYNAMIQUE de la mission (méta OG réelles + cartes Pillow wide/carrée)
 * lorsqu'une mission existe, et le chemin 404 (noindex) sinon.
 *
 * Échoue (exit 1) dès qu'une route ne respecte pas ces règles → la PR est
 * bloquée si un og:image casse (régression du pré-rendu OG).
 *
 * Le check est écrit comme une FONCTION exportée (comme check-og-assets.js) :
 * la logique est donc testable sans réseau ni prod via les tests de
 * scripts/__tests__/check-og-images.test.js, qui pilotent des serveurs stubs.
 * Sans cela, la branche 200 de /jobs/:id n'était exercée que les jours où une
 * mission existait en base — un garde jamais exécuté ne garde rien.
 *
 * Usage : KOJO_LHCI_BASE_URL=https://x.vercel.app node scripts/check-og-images.js
 * (par défaut : build local sur le port 4173 — valeur héritée de l'époque où le
 * repli de la CI servait le build avec `vite preview` ; la CI passe désormais sa
 * propre base, la pile locale de rewrites sur 4174.)
 *
 * Le nom de la variable évite le préfixe `LHCI_` : lhci active yargs
 * `.env('LHCI')`, donc `LHCI_URL` deviendrait l'option `--url` du collecteur
 * Lighthouse (voir frontend/lighthouserc.cjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { API_ORIGIN, SITE_ORIGIN, declaresNoIndex, metaContent, metaContents } from './site-meta.js';
// Les cartes par route sont la propriété de src/config/og-cards.js : ce module
// (et le build qui l'importe) n'en garde AUCUNE copie, donc la coquille
// pré-rendue et la page au runtime ne peuvent pas annoncer deux cartes
// différentes. Ici on ne fait que DÉRIVER la table des pages du projet.
import { CARDS_BY_ROUTE, ogCardFor } from '../src/config/og-cards.js';
import { normalizeRoute } from '../src/config/route-path.js';

/**
 * Table route → carte, à partir des routes à couvrir.
 *
 * `vite.config.js` importe le résultat et n'en garde AUCUNE copie : il écrit les
 * coquilles pré-rendues à partir d'ici, et refuse de builder une route qui n'y
 * figure pas (sinon og:image serait absente du shell).
 *
 * Exportée séparément pour être éprouvable : la table du module, elle, est
 * calculée une fois au chargement depuis la config réelle.
 *
 * ── Ce qui ÉCHOUE ici, et pas seulement dans un test ───────────────────────
 * Une carte DÉCLARE la route qu'elle sert dans son fichier de données
 * (scripts/og-cards/) : si cette route n'est aucune page du projet, la carte ne
 * servirait personne et la dérivation la perdrait EN SILENCE — un PNG livré,
 * jamais annoncé par le build, jamais vérifié (le chemin mal orthographié est le
 * cas réaliste : `/job` pour `/jobs` produit une carte morte que rien ne
 * signale). Le refus est donc dans la fonction, pas dans un test : elle s'exécute
 * au CHARGEMENT de ce module, que `vite.config.js` importe pour écrire les
 * coquilles — `vite build` échoue — comme check-prerender-shells.js et
 * check-page-meta.js, qui dérivent la table.
 *
 * `paths === null` (config illisible) n'est pas jugé ici : il n'y a alors aucune
 * liste à confronter, et runOgImageCheck en fait une erreur explicite (plus bas).
 *
 * @param {string[]|null} paths Chemins à couvrir (null = config illisible).
 * @throws {Error} Une carte déclare une route absente de `paths`.
 */
export function deriveRoutes(paths) {
  if (paths) {
    const pages = new Set(paths.map(normalizeRoute));
    const orphans = Object.keys(CARDS_BY_ROUTE).filter((route) => !pages.has(route));
    if (orphans.length) {
      throw new Error(
        `carte(s) pour une route absente des pages du projet (lighthouserc.cjs, ` +
          `DEPLOYMENT_PATHS) : ${orphans
            .map((route) => `${CARDS_BY_ROUTE[route].image} → ${route}`)
            .join(', ')} — chaque carte déclare la route qu'elle sert dans son ` +
          `fichier de données (scripts/og-cards/), et elle ne peut servir qu'une ` +
          `page qui existe. Corriger la route dans ce fichier, ou déclarer la page ` +
          `dans les pages du projet.`
      );
    }
  }
  return (paths || []).map((routePath) => ({ path: routePath, ...ogCardFor(routePath) }));
}

// Résolu au niveau module, comme check-home-shell.js : sous vitest,
// `import.meta.url` n'est pas exploitable pour construire une URL relative.
const LIGHTHOUSERC_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'lighthouserc.cjs'
);

/**
 * Pages du projet, lues dans lighthouserc.cjs — SOURCE UNIQUE des routes.
 *
 * ── Pourquoi les lire au lieu de les recopier ──────────────────────────────
 * /forgot-password était auditée (budget CLS des PR #19/#20) mais ABSENTE de
 * la table des cartes : sa carte OG n'était vérifiée par personne. Recopier la
 * liste ici aurait recréé exactement le même écart ; la DÉRIVER le rend
 * impossible — il n'y a plus deux ensembles à comparer.
 *
 * `DEPLOYMENT_PATHS` et non la liste effective du run : cette dernière vaut
 * ['/'] quand aucune base n'est fournie (repli local de Lighthouse), ce qui
 * viderait la table de son sens. On veut les pages du projet, pas celles du run
 * en cours.
 *
 * @param {string} [configPath] Chemin de la config (injectable pour les tests).
 * @returns {string[]|null} Chemins audités, ou null si illisible — l'appelant
 *   décide quoi en faire (runOgImageCheck en fait une erreur explicite).
 */
export function lighthouseAuditedPaths(configPath = LIGHTHOUSERC_PATH) {
  let source = '';
  try {
    source = fs.readFileSync(configPath, 'utf8');
  } catch (_err) {
    return null;
  }
  const block = source.match(/const\s+DEPLOYMENT_PATHS\s*=\s*\[([^\]]*)\]/);
  if (!block) return null;
  const paths = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  return paths.length ? paths : null;
}

// La table du module : elle exige LIGHTHOUSERC_PATH, donc elle est calculée
// APRÈS la lecture (avant, elle laissait une dépendance dans le vide).
export const ROUTES = deriveRoutes(lighthouseAuditedPaths());

export const DEFAULT_BASE = 'http://localhost:4173';
// Origine de l'API : propriété de scripts/site-meta.js (avec SITE_ORIGIN, car
// c'est leur PAIRE que le backend doit autoriser en CORS).
export const DEFAULT_BACKEND = API_ORIGIN;

// Identifiant qui ne peut pas exister : sert de SONDE DE CAPACITÉ.
export const PROBE_JOB_ID = '00000000-0000-4000-8000-000000000000';

/**
 * La base auditée sert-elle RÉELLEMENT la route backend /jobs/:id ?
 *
 * ── Pourquoi une sonde et plus une heuristique ──────────────────────────────
 * La couverture de /jobs/:id était décidée par une heuristique d'ADRESSE
 * (`/^https?:\/\/(localhost|127\.0\.0\.1)/` → « pas de rewrite, on saute »).
 * Elle était juste tant que la seule base locale possible était `vite preview`,
 * qui ne sert effectivement aucune règle de vercel.json. Mais elle devenait
 * FAUSSE — dans le sens dangereux — dès qu'une base locale émule la table de
 * rewrites (scripts/vercel-rewrite-server.js) : la sonde de comportement dit
 * « la route est servie », l'heuristique disait « localhost, donc non », et le
 * chemin 200 restait non exercé sur les PR en affichant un vert.
 *
 * La règle est donc désormais OBSERVÉE et non devinée : une fiche inconnue
 * servie par le pré-rendu backend répond 404 AVEC noindex (x-robots-tag ou
 * méta robots — kojo_routers_public.py). Un serveur statique sans rewrite
 * répond au mieux un 200 HTML sans noindex (repli SPA) : la sonde les
 * distingue, quelle que soit l'adresse.
 *
 * @param {object} [options]
 * @param {string} [options.base] Base à sonder (frontend servi).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {number} [options.timeoutMs] Délai de la sonde.
 * @returns {Promise<{serves: boolean, status: number, url: string, detail: string}>}
 */
export async function baseServesJobOgRoute({ base, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const clean = String(base).trim().replace(/\/+$/, '');
  const url = `${clean}/jobs/${PROBE_JOB_ID}`;
  try {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'kojo-job-og-probe/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const robots = res.headers.get('x-robots-tag') || '';
    const body = res.status === 404 ? await res.text() : '';
    const noindex = declaresNoIndex(body, robots);
    const serves = res.status === 404 && noindex;
    return {
      serves,
      status: res.status,
      url,
      detail: serves
        ? '404 + noindex (pré-rendu backend servi)'
        : `HTTP ${res.status}${noindex ? ' avec noindex mais pas 404' : ' sans 404 + noindex'} (route backend /jobs/:id non servie par cette base)`,
    };
  } catch (error) {
    return { serves: false, status: 0, url, detail: `injoignable (${error.message})` };
  }
}

/**
 * Exécute la vérification complète.
 *
 * @param {object} [options]
 * @param {string} [options.base]     Base du frontend servi (KOJO_LHCI_BASE_URL).
 * @param {string} [options.backend]  Base de l'API backend (KOJO_BACKEND_URL).
 * @param {string} [options.origin]   Origin attendu des cartes backend (KOJO_ORIGIN).
 * @param {boolean} [options.quiet]   Tait la sortie de progression (tests).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {{id: string, title?: string}} [options.job] Mission IMPOSÉE à
 *   vérifier, au lieu de prendre la première de la liste publique : utilisé par
 *   scripts/check-og-job-200.js, qui crée une mission de test pour exercer la
 *   branche 200 avec une fiche CONNUE (l'ordre de /api/jobs n'est pas garanti).
 * @param {boolean} [options.onlyJob] Ne vérifier QUE la fiche mission (sauter
 *   les routes statiques déjà couvertes par le run principal du check).
 * @param {Array} [options.routes] Table route → carte à vérifier (défaut :
 *   `ROUTES`, dérivée des pages du projet ; injectable pour les tests).
 * @returns {Promise<{ok: boolean, errors: string[], checked: string[],
 *   jobId: string, jobTitle: string, job200Exercised: boolean,
 *   jobRoute: {serves: boolean, status: number, url: string, detail: string},
 *   jobRouteServed: boolean, notices: string[]}>}
 */
export async function runOgImageCheck({
  base = process.env.KOJO_LHCI_BASE_URL || DEFAULT_BASE,
  backend = process.env.KOJO_BACKEND_URL || DEFAULT_BACKEND,
  origin = process.env.KOJO_ORIGIN || SITE_ORIGIN,
  quiet = false,
  fetchImpl = fetch,
  job = null,
  onlyJob = false,
  routes = ROUTES,
} = {}) {
  const pinnedJob = job && job.id ? { id: String(job.id), title: String(job.title || '') } : null;
  const BASE = String(base).trim().replace(/\/+$/, '');
  const BACKEND = String(backend).trim().replace(/\/+$/, '');
  const ORIGIN = String(origin).trim().replace(/\/+$/, '');

  const log = (...args) => {
    if (!quiet) console.log(...args);
  };
  const logError = (...args) => console.error(...args);

  const errors = [];
  const checked = [];
  const notices = [];

  const isAbsolute = (value) => /^https?:\/\//.test(value || '');

  // ── Vérification HTTP des cartes OG (GET réel sur chaque og:image) ──────
  // Les dimensions sont décodées depuis l'en-tête IHDR du PNG (octets 16-24) :
  // width/height big-endian. Format attendu : 1200x630 (wide) / 1200x1200
  // (carré) — cohérent avec les cartes statiques (public/) et les cartes
  // dynamiques backend (Pillow, /api/og/jobs/:id[.png|-square.png]).
  const checkedUrls = new Set();
  const imageUrlsToCheck = [];
  const queueImageUrl = (url, label) => {
    if (!url || checkedUrls.has(url)) return;
    checkedUrls.add(url);
    imageUrlsToCheck.push({ url, label });
  };

  // GET réel + assertions : 200, content-type image/png, dimensions IHDR.
  async function checkOgImageHttp(url, label) {
    let res;
    try {
      res = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'kojo-og-image-check/1.0' },
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      errors.push(`[${label}] og:image fetch ${url} échoué : ${err.message}`);
      return;
    }
    if (!res.ok) {
      errors.push(`[${label}] og:image HTTP ${res.status} (attendu 200) : ${url}`);
      return;
    }
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/png')) {
      errors.push(`[${label}] og:image content-type "${contentType}" (attendu image/png) : ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) {
      errors.push(`[${label}] og:image n'est pas un PNG valide : ${url}`);
      return;
    }
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const [ew, eh] = url.includes('square') ? [1200, 1200] : [1200, 630];
    if (width !== ew || height !== eh) {
      errors.push(`[${label}] og:image dimensions ${width}x${height} (attendu ${ew}x${eh}) : ${url}`);
      return;
    }
    checked.push(`  ✓ og:image HTTP 200 ${width}x${height} (${contentType}) : ${url}`);
  }

  // ── Garde de non-vacuité : la table dérive des pages du projet, donc une
  // liste illisible ne laisse PAS une garde muette mais un contrôle qui ne
  // porte sur rien. C'est le seul faux vert que la dérivation rend possible —
  // et il est nommé ici plutôt que traversé en silence (le build, lui, échoue
  // aussi : une coquille pré-rendue sans carte l'arrête).
  if (!onlyJob && routes.length === 0) {
    errors.push(
      'aucune page lue dans lighthouserc.cjs (DEPLOYMENT_PATHS illisible ou vide) : la table ' +
        'route → carte en DÉRIVE, donc ce contrôle ne porterait sur aucune page'
    );
  }

  for (const route of onlyJob ? [] : routes) {
    const url = `${BASE}${route.path}`;
    let html = '';
    try {
      const res = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'kojo-og-image-check/1.0' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        errors.push(`[${route.path}] HTTP ${res.status} sur ${url}`);
        continue;
      }
      html = await res.text();
    } catch (err) {
      errors.push(`[${route.path}] fetch ${url} échoué : ${err.message}`);
      continue;
    }

    const ogImages = metaContents(html, 'og:image');
    const ogImage = ogImages[0] || '';
    const twitterImage = metaContent(html, 'twitter:image');

    if (!ogImage) {
      errors.push(`[${route.path}] og:image ABSENT du HTML servi`);
    } else if (!isAbsolute(ogImage)) {
      errors.push(`[${route.path}] og:image NON absolue : "${ogImage}" (URL relative ignorée par les crawlers)`);
    } else if (!ogImage.endsWith(route.image)) {
      errors.push(`[${route.path}] og:image inattendu : "${ogImage}" (attendu se terminant par "${route.image}")`);
    }

    // Variante carrée : doit être présente ET pointer vers le fichier déclaré
    // dans ROUTES (les réseaux qui recadrent en 1:1).
    const squareImage = ogImages.find((u) => u.includes('square'));
    if (!squareImage) {
      errors.push(`[${route.path}] variante CARRÉE og:image ABSENTE du HTML servi (attendu "${route.imageSquare}")`);
    } else if (!isAbsolute(squareImage)) {
      errors.push(`[${route.path}] variante carrée og:image NON absolue : "${squareImage}"`);
    } else if (!squareImage.endsWith(route.imageSquare)) {
      errors.push(`[${route.path}] variante carrée inattendue : "${squareImage}" (attendu se terminant par "${route.imageSquare}")`);
    }

    if (!twitterImage) {
      errors.push(`[${route.path}] twitter:image ABSENT`);
    } else if (!isAbsolute(twitterImage)) {
      errors.push(`[${route.path}] twitter:image NON absolue : "${twitterImage}"`);
    }

    // Chaque og:image servi (wide + carré) sera vérifié en HTTP (200 + PNG +
    // dimensions) dans la passe dédiée en fin de script. Seules les URL
    // ABSOLUES sont mises en file : une URL relative a déjà échoué à la
    // vérification d'absoluité ci-dessus (et fetch() la rejetterait).
    for (const u of ogImages) if (isAbsolute(u)) queueImageUrl(u, route.path);

    checked.push(`  ✓ ${route.path} → ${ogImage || '(absent)'}` + (squareImage ? ` (+ carré ${squareImage})` : ''));
  }

  // ── /jobs/:id — fiche mission (pré-rendu par le BACKEND) ───────────────
  // Le backend (GET /api/og/jobs/{id}, kojo_routers_public.py) sert le HTML de
  // chaque fiche avec les méta OG de la mission : og:image → carte backend
  // (.png) + variante carrée (-square.png) + og:title réel — aiguillé par le
  // rewrite Vercel /jobs/(.*). On récupère un VRAI job sur l'API publique du
  // backend pour tester le chemin 200. Sans job en base, le chemin 200 est
  // impossible à vérifier (état des données, pas une régression) : on le
  // signale EXPLICITEMENT (annotation ::notice + verdict final) et on teste le
  // chemin 404 (pré-rendu backend + aiguillage + noindex). Un vert qui laisse
  // croire que le chemin 200 a été validé serait pire que pas de check.
  //
  // Exception : sur le REPLI build local (preview Vercel indisponible ou
  // protégée — KOJO_LHCI_BASE_URL = http://localhost:4173), le chemin /jobs/:id n'existe
  // pas : c'est le rewrite Vercel + le pré-rendu backend qui le servent, pas le
  // build statique (SPA fallback → index.html en 200, sans noindex). Les
  // assertions 404/noindex seraient donc des faux positifs → section ignorée.
  // Capacité observée (et non devinée d'après l'adresse) : voir
  // baseServesJobOgRoute. Une base qui ne sert pas la route backend ne peut
  // pas être jugée sur /jobs/:id — ses 404 seraient des faux positifs.
  const jobRoute = await baseServesJobOgRoute({ base: BASE, fetchImpl });
  const servesJobOg = jobRoute.serves;

  const jobDetailLabel = '/jobs/:id';
  let jobId = '';
  let jobTitle = '';
  if (!servesJobOg) {
    // Aucun intérêt à interroger le backend (et à le solliciter) quand la
    // section est de toute façon ignorée. La couverture manquante remonte en
    // annotation : le résumé du run doit dire que la fiche mission n'a PAS été
    // vérifiée, pas seulement « vert ».
    const notice =
      `${jobDetailLabel} : la base auditée (${BASE}) ne sert PAS la route backend ` +
      `/jobs/:id (sonde ${jobRoute.url} → ${jobRoute.detail}) — rewrite Vercel + ` +
      `pré-rendu backend absents, la fiche mission n'a PAS été vérifiée par ce run ` +
      `(elle l'est contre le déploiement Vercel réel, c'est-à-dire sur les runs de main).`;
    notices.push(notice);
    log(`  ⚠️ ${notice}`);
  } else if (pinnedJob) {
    // Mission fournie par l'appelant : on vérifie CETTE fiche. C'est le seul
    // moyen d'exercer la branche 200 de façon DÉTERMINISTE — dépendre de la
    // première mission de la liste publique rendait le chemin 200 tributaire
    // de l'état des données (et parfois absent).
    jobId = pinnedJob.id;
    jobTitle = pinnedJob.title;
  } else {
    try {
      const jres = await fetchImpl(`${BACKEND}/api/jobs?limit=1`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (jres.ok) {
        const data = await jres.json();
        const list = Array.isArray(data) ? data : (data.jobs || data.items || []);
        const first = list[0] || {};
        jobId = String(first.id || first._id || '');
        jobTitle = String(first.title || '');
      }
    } catch (err) {
      log(`  ⚠️ backend ${BACKEND} injoignable (${err.message}) — vérification /jobs/:id incomplète`);
    }
    if (!jobId) {
      const notice =
        `${jobDetailLabel} : aucune mission en base sur ${BACKEND} — ` +
        `la branche 200 (carte de la mission) n'a PAS été exercée ; ` +
        `seul le chemin 404 (pré-rendu backend + rewrite + noindex) est vérifié à la place.`;
      notices.push(notice);
      log(`  ⚠️ ${notice}`);
    }
  }

  if (servesJobOg) {
    const detailId = encodeURIComponent(jobId || 'check-nonexistent-job');
    const detailUrl = `${BASE}/jobs/${detailId}`;
    let detailStatus = 0;
    let detailHtml = '';
    let detailNoIndex = false;
    try {
      const res = await fetchImpl(detailUrl, {
        redirect: 'follow',
        headers: { 'user-agent': 'kojo-og-image-check/1.0' },
        signal: AbortSignal.timeout(20000),
      });
      detailStatus = res.status;
      detailNoIndex = (res.headers.get('x-robots-tag') || '').includes('noindex');
      detailHtml = await res.text();
    } catch (err) {
      errors.push(`[${jobDetailLabel}] fetch ${detailUrl} échoué : ${err.message}`);
    }

    if (jobId) {
      // Chemin 200 : la fonction doit injecter les méta OG de la mission.
      if (detailStatus !== 200) {
        errors.push(`[${jobDetailLabel}] HTTP ${detailStatus} attendu 200 pour un job EXISTANT (fonction Vercel ou aiguillage cassé ?)`);
      }
      const ogImages = metaContents(detailHtml, 'og:image');
      const wide = ogImages[0] || '';
      const square = ogImages.find((u) => u.includes('square')) || '';
      const expectedWide = `${ORIGIN}/api/og/jobs/${detailId}.png`;
      const expectedSquare = `${ORIGIN}/api/og/jobs/${detailId}-square.png`;
      if (!wide.endsWith(expectedWide)) {
        errors.push(`[${jobDetailLabel}] og:image mission inattendu : "${wide}" (attendu se terminant par "${expectedWide}")`);
      }
      if (!square.endsWith(expectedSquare)) {
        errors.push(`[${jobDetailLabel}] variante carrée mission inattendue : "${square}" (attendu se terminant par "${expectedSquare}")`);
      }
      if (jobTitle && !detailHtml.includes(jobTitle)) {
        errors.push(`[${jobDetailLabel}] og:title — titre de la mission "${jobTitle}" ABSENT du HTML servi`);
      }
      if (detailNoIndex) {
        errors.push(`[${jobDetailLabel}] x-robots-tag noindex présent sur un job EXISTANT`);
      }
      // Cartes dynamiques du job (backend Pillow) : GET réel + dimensions.
      if (isAbsolute(wide)) queueImageUrl(wide, jobDetailLabel);
      if (isAbsolute(square)) queueImageUrl(square, jobDetailLabel);
      checked.push(`  ✓ ${jobDetailLabel} → ${wide || '(absent)'}` + (square ? ` (+ carré ${square})` : '') + ` (job "${jobTitle || detailId}")`);
    } else {
      // Chemin 404 : un job inconnu doit répondre 404 + noindex. Attention à ce
      // que ce 404 PROUVE depuis le 16/09/2026 : le catch-all SPA ayant été
      // retiré (une URL inconnue répond désormais 404), un 404 ne suffit plus à
      // démontrer que le rewrite /jobs/(.*) fonctionne — une règle supprimée
      // donnerait le même code. C'est le chemin 200 (avec un vrai job, plus bas)
      // qui l'établit, et frontend/scripts/check-spa-routes.js qui vérifie la
      // présence du rewrite dans la configuration.
      if (detailStatus !== 404) {
        errors.push(`[${jobDetailLabel}] HTTP ${detailStatus} attendu 404 pour un job inconnu (pré-rendu backend non déployé ou rewrite cassé ?)`);
      }
      if (!detailNoIndex) {
        errors.push(`[${jobDetailLabel}] x-robots-tag noindex absent sur le 404`);
      }
      checked.push(`  ✓ ${jobDetailLabel} (404 + noindex — pré-rendu backend servi, chemin 200 non testé faute de job)`);
    }
  }

  // ── Passe HTTP : dimensions réelles de chaque carte OG servie ───────────
  // GET sur chaque og:image (statique Vercel ou carte dynamique backend),
  // avec les assertions : 200, content-type image/png, width/height IHDR.
  for (const { url, label } of imageUrlsToCheck) {
    await checkOgImageHttp(url, label);
  }

  log('Vérification og:image par route (base : ' + BASE + ') :');
  log(checked.join('\n'));

  const job200Exercised = Boolean(jobId) && servesJobOg;

  if (errors.length) {
    logError('\n❌ og:image invalide — ' + errors.length + ' problème(s) :');
    for (const e of errors) logError('  ' + e);
  } else {
    const coverage = !servesJobOg
      ? `/jobs/:id NON vérifié (cette base ne sert pas la route backend — sonde : ${jobRoute.detail})`
      : job200Exercised
        ? '/jobs/:id vérifié sur une mission réelle (branche 200)'
        : '/jobs/:id vérifié sur le chemin 404 uniquement (aucune mission en base)';
    log(
      '\n✅ Toutes les pages auditées servent un og:image absolu, valide en HTTP (200, image/png, ' +
        'dimensions attendues). Couverture : ' + coverage + '.'
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    checked,
    notices,
    jobId,
    jobTitle,
    job200Exercised,
    // Capacité observée de la base auditée (remplace l'ancien `localFallback`,
    // qui déduisait la couverture de l'adresse et se trompait sur toute base
    // locale émulant les rewrites).
    jobRoute,
    jobRouteServed: servesJobOg,
  };
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = await runOgImageCheck();
  // Les couvertures non exercées remontent en annotation : le résumé du run
  // doit dire ce qui n'a PAS été testé, pas seulement « vert ».
  for (const notice of result.notices) {
    console.log(`::notice title=Chemins non couverts::${notice}`);
  }
  if (!result.ok) process.exit(1);
}
