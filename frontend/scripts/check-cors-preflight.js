#!/usr/bin/env node
/**
 * GARDE CORS de la PRODUCTION — la paire « origine du site ↔ API » que le
 * navigateur exige pour laisser passer une requête.
 *
 * ── Pourquoi cette sonde existe ────────────────────────────────────────────
 * Le 18/09/2026, la bascule du frontend sur `kojoforafrica.cc.cd` a cassé le
 * site SANS UN SEUL JOURNAL CÔTÉ SERVEUR : `server.py` construisait
 * `allow_origins` avec `CORS_ORIGINS` seulement, donc `FRONTEND_APP_URL` n'y
 * entrait jamais. Tant que le site vivait sous `*.vercel.app`, le motif Vercel
 * (`allow_origin_regex`) couvrait la production — le trou restait invisible.
 * Après la bascule, plus aucun motif ne matchait : chaque appel portant un
 * en-tête personnalisé partait en préflight et Starlette répondait
 * `400 — Disallowed CORS origin`, AVANT les routes (d'où l'absence de trace
 * applicative). Les seuls témoins étaient les consoles des visiteurs.
 *
 * Rien dans la CI ne pouvait le dire : les gardes de `scripts/` vérifient le
 * HTML, les cartes OG et les rewrites — la configuration de l'origine, elle,
 * restait une affirmation. Cette sonde la MESURE.
 *
 * ── Ce qu'elle rejoue ──────────────────────────────────────────────────────
 * Exactement ce que fait le navigateur, avec l'origine canonique du site
 * (`SITE_ORIGIN`) et l'API que le build inline (`API_ORIGIN`), tous deux lus
 * dans `scripts/site-meta.js` — jamais recopiés ici, sinon la sonde pourrait
 * rester verte sur une paire que le site n'utilise plus :
 *
 *   1. préflight `OPTIONS` sur un appel que l'accueil fait réellement, avec
 *      `Origin`, `Access-Control-Request-Method` et l'en-tête que le client
 *      envoie (`content-type` — c'est lui qui déclenche le préflight) ;
 *   2. `GET` réel vers le même chemin, avec `Origin` : c'est la requête
 *      créditée (`credentials: 'include'`, cookies httpOnly) que le navigateur
 *      n'exécute QUE si elle porte `access-control-allow-origin`.
 *
 * Et elle refuse deux faux verts :
 *   - `access-control-allow-origin: *` — interdit dès que la requête est
 *     créditée : le navigateur la rejette, donc l'accepter ici mentirait ;
 *   - une réponse sans `access-control-allow-credentials: true` sur le
 *     préflight : la session par cookie ne passerait pas.
 *
 * ── Pourquoi elle ÉCHOUE au lieu d'informer ────────────────────────────────
 * Contrairement à la sonde SEO (une intégration non configurée est un fait
 * d'exploitation acceptable), cette paire est un invariant : si elle casse, le
 * site ne fonctionne plus. Un `::notice` passerait inaperçu — c'est exactement
 * ce qui s'est produit pendant des heures. L'échec est donc bruyant, et un
 * délai de réessai absorbe la fenêtre de bascule : sur `main`, ce job tourne en
 * même temps que le déploiement Fly, où une instance peut encore servir l'ancien
 * code (justement celui qui refuse la nouvelle origine).
 *
 * main uniquement : sur une PR, ce sont les previews qui sont auditées et le
 * déploiement est sauté — la sonde vérifie la production, pas une preview.
 *
 * Usage : cd frontend && node scripts/check-cors-preflight.js
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_ORIGIN, SITE_ORIGIN } from './site-meta.js';

/** Appel public que l'accueil fait réellement (`getStats`), avec préflight. */
export const PROBE_PATH = '/api/public/stats';

/** En-tête envoyé par le client sur ce GET : c'est lui qui force le préflight. */
export const PROBE_REQUEST_HEADERS = 'content-type';

/**
 * Réessais : la bascule Fly d'un run de `main` peut servir l'ancien code
 * quelques secondes. 6 × 15 s couvrent largement un déploiement roulant, sans
 * transformer une panne réelle en attente interminable.
 */
export const ATTEMPTS = 6;
export const RETRY_DELAY_MS = 15000;

const stripSlash = (value) => String(value).trim().replace(/\/+$/, '');

/**
 * Verdict d'UNE tentative, par étape.
 *
 * @param {string} stage   Étiquette de l'étape (`préflight` / `GET réel`).
 * @param {Response} response Réponse observée.
 * @param {string} origin  Origine attendue, comparée EXACTEMENT.
 * @returns {{ok: boolean, detail: string, rejection: boolean}}
 */
function judge(stage, response, origin) {
  const allowed = response.headers.get('access-control-allow-origin') || '';
  const credentials = (response.headers.get('access-control-allow-credentials') || '').toLowerCase();
  const status = response.status;

  if (allowed === '*') {
    return {
      ok: false,
      rejection: true,
      detail: `${stage} : access-control-allow-origin: * avec une requête créditée — le navigateur refuse (il attend ${origin}).`,
    };
  }
  if (allowed !== origin) {
    const observed = allowed || 'ABSENT';
    return {
      ok: false,
      rejection: true,
      detail:
        `${stage} : HTTP ${status}, access-control-allow-origin ${observed} — ` +
        `attendu ${origin}. Origine non autorisée côté API (allow_origins de server.py), ` +
        'le navigateur bloque la requête.',
    };
  }
  if (stage === 'préflight' && credentials !== 'true') {
    return {
      ok: false,
      rejection: true,
      detail: `${stage} : access-control-allow-credentials ${credentials || 'ABSENT'} — la session par cookie ne passerait pas.`,
    };
  }
  return { ok: true, rejection: false, detail: `${stage} : HTTP ${status}, allow-origin ${allowed}.` };
}

/**
 * Une passe complète (préflight + GET réel) sur l'API et l'origine données.
 *
 * @param {object} options
 * @param {string} [options.origin] Origine canonique (SITE_ORIGIN).
 * @param {string} [options.api]    Origine de l'API du build (API_ORIGIN).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @returns {Promise<{ok: boolean, rejection: boolean, details: string[]}>}
 *   `rejection` distingue « l'API a répondu sans autoriser l'origine » (le bug
 *   réel) de « l'API n'a pas répondu » — deux diagnostics différents.
 */
export async function probeCorsPair({ origin = SITE_ORIGIN, api = API_ORIGIN, fetchImpl = fetch } = {}) {
  const cleanOrigin = stripSlash(origin);
  const url = `${stripSlash(api)}${PROBE_PATH}`;
  const details = [];
  let rejection = false;

  const preflight = await fetchImpl(url, {
    method: 'OPTIONS',
    headers: {
      origin: cleanOrigin,
      'access-control-request-method': 'GET',
      'access-control-request-headers': PROBE_REQUEST_HEADERS,
      'user-agent': 'kojo-cors-preflight-probe/1.0',
    },
    signal: AbortSignal.timeout(20000),
  });
  const preflightVerdict = judge('préflight', preflight, cleanOrigin);
  details.push(preflightVerdict.detail);
  rejection = rejection || preflightVerdict.rejection;

  const real = await fetchImpl(url, {
    headers: { origin: cleanOrigin, 'user-agent': 'kojo-cors-preflight-probe/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  const realVerdict = judge('GET réel', real, cleanOrigin);
  details.push(realVerdict.detail);
  rejection = rejection || realVerdict.rejection;

  return { ok: preflightVerdict.ok && realVerdict.ok, rejection, details };
}

/**
 * Sonde complète, avec réessais.
 *
 * @param {object} [options]
 * @param {string} [options.origin]  Origine canonique attendue.
 * @param {string} [options.api]     Origine de l'API interrogée.
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {Function} [options.sleep] Attente entre deux tentatives (tests).
 * @param {number} [options.attempts] Nombre de tentatives.
 * @param {number} [options.delayMs] Délai entre deux tentatives.
 * @param {Function} [options.log] Journal (tests).
 * @returns {Promise<{ok: boolean, errors: string[], notices: string[], attempts: number}>}
 */
export async function runCorsPreflightCheck({
  origin = SITE_ORIGIN,
  api = API_ORIGIN,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = ATTEMPTS,
  delayMs = RETRY_DELAY_MS,
  log = console.log,
} = {}) {
  const cleanApi = stripSlash(api);
  const errors = [];
  const notices = [];
  let last = null;
  let usedAttempts = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    usedAttempts = attempt;
    try {
      last = await probeCorsPair({ origin, api: cleanApi, fetchImpl });
      if (last.ok) break;
    } catch (error) {
      last = { ok: false, rejection: false, details: [`API ${cleanApi} injoignable (${error.message}).`] };
    }
    if (attempt < attempts) {
      log(`  … tentative ${attempt}/${attempts} sans verdict, nouvel essai dans ${Math.round(delayMs / 1000)} s`);
      await sleep(delayMs);
    }
  }

  const used = `paire ${stripSlash(origin)} ↔ ${cleanApi}${PROBE_PATH}`;
  if (last && last.ok) {
    notices.push(
      `CORS production : ${used} autorisée pour les requêtes créditées ` +
        `(préflight + GET réel, ${usedAttempts} tentative(s)).`
    );
  } else if (last && last.rejection) {
    errors.push(
      `${used} : origine NON autorisée par l'API. ${last.details.join(' ')} ` +
        "Le site est cassé pour ses visiteurs — vérifier allow_origins (kojo_core.build_allowed_origins, " +
        'dérivé de FRONTEND_APP_URL) sur le backend déployé.'
    );
  } else {
    errors.push(
      `${used} : impossible de conclure après ${usedAttempts} tentative(s). ${last ? last.details.join(' ') : ''}`
    );
  }

  return { ok: errors.length === 0, errors, notices, attempts: usedAttempts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runCorsPreflightCheck();
  console.log(`Garde CORS de la production — ${result.ok ? 'origine autorisée' : 'DÉFAUT'}`);
  for (const notice of result.notices) console.log(`::notice title=CORS production::${notice}`);
  for (const error of result.errors) console.error(`::error title=CORS production::${error}`);
  if (!result.ok) process.exit(1);
}
