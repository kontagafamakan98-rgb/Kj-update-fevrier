#!/usr/bin/env node
/**
 * Verrouille le chemin 200 de /jobs/:id (fiche mission pré-rendue par le
 * backend) : crée une mission de test, vérifie la carte OG RÉELLE de cette
 * mission, puis la SUPPRIME — toujours, même si la vérification échoue.
 *
 * POURQUOI : check-og-images.js valide la branche 200 seulement si une mission
 * existe déjà en base (il prend la première de la liste publique). Les jours
 * sans mission, il se rabat sur le chemin 404 et émet un ::notice — le chemin
 * qui casse réellement (og:image + og:title d'une mission, cartes Pillow wide +
 * carrée) n'était donc jamais exercé de façon déterministe. Un garde jamais
 * exécuté ne garde rien : ce script crée sa propre mission, avec un titre
 * marqué, et la nettoie derrière lui.
 *
 * PÉRIMÈTRE : la fiche /jobs/:id n'existe QUE sur le déploiement Vercel (rewrite
 * /jobs/(.*) → backend). Sur un repli build local (LHCI_URL=localhost), le
 * script ne fait RIEN : créer une mission en prod pour vérifier une URL qui ne
 * la sert pas serait une écriture inutile. Il sort en 0 avec un ::notice.
 *
 * Ce repli concerne TOUTES les PR (la preview Vercel est protégée, donc
 * resolve-vercel-url.sh retombe sur le build local) : le cycle n'y tournait
 * jamais, et une régression ne se voyait qu'après fusion. Le même fil est donc
 * rejoué EN PROCESSUS, sur le code de la PR, par
 * backend/tests/test_job_og_cycle.py (création → 200 → suppression → 404 +
 * noindex + sitemap), et le maillon de routage par
 * frontend/scripts/check-spa-routes.js (rewrite présent, route backend
 * déclarée, URL inconnue → 404). Ce script reste le seul à prouver le DÉPLOIEMENT réel (rewrite
 * Vercel + CDN + cache CDN) : les trois sont complémentaires, pas redondants.
 *
 * AUTHENTIFICATION : réutilise le jeton du compte CLIENT dédié CI — soit
 * LHCI_AUTH_HEADER (déjà résolu par le job) soit un login avec
 * LHCI_CI_EMAIL/LHCI_CI_PASSWORD. POST /api/jobs exige user_type=client, et
 * DELETE /api/jobs/:id exige d'être la cliente propriétaire : le compte CI est
 * un client vérifié, donc les deux passent.
 *
 * GARANTIE DE NETTOYAGE : l'identifiant supprimé est UNIQUEMENT celui renvoyé
 * par la création (aucune liste, aucun balayage) — le script ne peut pas
 * toucher une mission existante. En cas d'échec de la suppression, il ÉCHOUE
 * (mission de test laissée en base = donnée à nettoyer à la main, ça ne doit
 * pas passer inaperçu).
 *
 * VERROU 404 : le cycle verrouille aussi l'état APRÈS suppression, parce qu'une
 * fiche de mission supprimée qui reste servie en 200 est indexable et conserve
 * sa carte OG. Trois faits sont donc exigés après le DELETE : la fiche répond
 * 404, elle porte noindex (en-tête x-robots-tag ou meta robots), sa carte
 * Pillow répond 404, et le sitemap ne la liste plus. Contrepartie
 * indispensable, sinon le verrou serait vide de sens : AVANT la suppression, la
 * mission DOIT apparaître dans le sitemap — un sitemap qui ne référencerait
 * plus aucune mission rendrait l'assertion d'absence vraie à vide.
 *
 * CACHE : la fiche d'une mission VIVANTE est servie avec
 * « cache-control: public, max-age=3600, s-maxage=3600 » (mesuré en prod), donc
 * interroger l'URL nue juste après le DELETE pourrait renvoyer un 200 sorti du
 * cache CDN. Les contrôles post-suppression ajoutent un paramètre de
 * cache-busting (?kojo_cb=…) : mesuré en prod, la query ne change que la clé de
 * cache du CDN, pas le handler (404 identique avec et sans).
 *
 * Usage : LHCI_URL=https://… node scripts/check-og-job-200.js
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runOgImageCheck, PROD_ORIGIN } from './check-og-images.js';

export const DEFAULT_BASE = PROD_ORIGIN;
export const DEFAULT_BACKEND = 'https://kojo-backend.fly.dev';
// Étiquette du verrou post-suppression (contrôlé après le DELETE).
export const POST_DELETE_LABEL = '/jobs/:id (après suppression)';
// Préfixe repérable pour un humain qui tomberait sur une mission laissée en
// base après un échec de nettoyage.
export const TEST_JOB_TITLE_PREFIX = '[CI] Mission de test OG';
export const TEST_JOB_SKILL = 'ci-og-check';

const TIMEOUT_MS = 20000;
const fetchJson = async (res) => {
  try {
    return await res.json();
  } catch (_e) {
    return null;
  }
};

/**
 * Charge utile de la mission de test : volontairement minimale mais VALIDE au
 * regard de JobCreate (title ≥ 5, description ≥ 20, category ≥ 3, budget et
 * location obligatoires) — sinon la création partirait en 422 et le chemin 200
 * ne serait jamais atteint.
 */
export const buildTestJobPayload = (stamp) => ({
  title: `${TEST_JOB_TITLE_PREFIX} ${stamp}`,
  description:
    "Mission de test automatisée : vérifie le pré-rendu OG de /jobs/:id (og:image, og:title, " +
    'cartes wide + carrée) puis la supprime. Créée et supprimée par la CI, aucune action requise.',
  category: 'plumbing',
  budget_min: 1000,
  budget_max: 2000,
  location: {
    address: 'Hamdallaye ACI 2000, Bamako',
    fullAddress: 'Hamdallaye ACI 2000, Bamako',
    city: 'Bamako',
    district: 'Hamdallaye',
    country: 'Mali',
    countryCode: 'ML',
  },
  required_skills: [TEST_JOB_SKILL],
  urgency: 'normal',
});

/**
 * Résout l'en-tête d'autorisation : jeton explicite → LHCI_AUTH_HEADER (posé
 * par le job CI) → login du compte CI.
 * @returns {Promise<string>} « Bearer … » ou '' si aucune source n'aboutit.
 */
export async function resolveAuthHeader({ backend, token = '', email = '', password = '', fetchImpl = fetch, errors = [] }) {
  if (token) return `Bearer ${token}`;

  const raw = (process.env.LHCI_AUTH_HEADER || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.Authorization) return String(parsed.Authorization);
    } catch (_e) {
      errors.push("LHCI_AUTH_HEADER illisible (JSON invalide) — repli sur le login du compte CI");
    }
  }

  if (!email || !password) return '';

  let res;
  try {
    res = await fetchImpl(`${backend}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    errors.push(`login du compte CI échoué (${err.message})`);
    return '';
  }
  if (!res.ok) {
    errors.push(`login du compte CI HTTP ${res.status} (secrets LHCI_CI_* invalides ?)`);
    return '';
  }
  const data = (await fetchJson(res)) || {};
  return data.access_token ? `Bearer ${data.access_token}` : '';
}

/**
 * Récupère le sitemap servi par `base` (rewrite vercel.json → backend) et
 * renvoie ses <loc>. Sert les DEUX côtés du verrou : la mission doit y être
 * AVANT suppression (sinon le contrôle d'absence est vide) et absente APRÈS.
 *
 * @param {object} [options]
 * @param {string} [options.base]      Base frontend servie.
 * @param {string} [options.cacheBust] Valeur du paramètre anti-cache CDN.
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @returns {Promise<{url: string, status: number, locs: string[], error: string}>}
 */
export async function fetchSitemapLocs({ base, cacheBust = '', fetchImpl = fetch }) {
  const url = `${base}/sitemap.xml${cacheBust ? `?kojo_cb=${encodeURIComponent(cacheBust)}` : ''}`;
  try {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': 'kojo-og-job-cycle/1.0', accept: 'application/xml,text/xml,*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) {
      return {
        url,
        status: res.status,
        locs: [],
        error: `sitemap ${url} HTTP ${res.status} (rewrite /sitemap.xml → backend absent ou cassé ?)`,
      };
    }
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);
    if (!locs.length) {
      return { url, status: 200, locs, error: `sitemap ${url} ne contient aucun <loc> (XML illisible ou sitemap vide)` };
    }
    return { url, status: 200, locs, error: '' };
  } catch (err) {
    return { url, status: 0, locs: [], error: `sitemap ${url} injoignable (${err.message})` };
  }
}

/**
 * Verrou 404 : vérifie qu'une mission SUPPRIMÉE n'est plus atteignable ni
 * indexable — fiche en 404 avec noindex, carte OG en 404, absente du sitemap.
 *
 * Les échecs sont poussés dans `errors` (donc le cycle échoue), jamais dans
 * `notices` : une fiche supprimée encore servie en 200 est indexable et garde
 * sa carte, ce n'est pas un détail consultatif.
 *
 * @returns {Promise<{detail: boolean, noindex: boolean, card: boolean, sitemap: boolean}>}
 */
export async function assertDeletedJobUnreachable({
  base,
  origin,
  jobId,
  cacheBust = '',
  fetchImpl = fetch,
  errors,
  checked,
  quiet = false,
}) {
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };
  const id = encodeURIComponent(jobId);
  const qs = cacheBust ? `?kojo_cb=${encodeURIComponent(cacheBust)}` : '';
  const lock = { detail: false, noindex: false, card: false, sitemap: false };

  // 1. La fiche pré-rendue doit avoir disparu ET rester hors index.
  const detailUrl = `${base}/jobs/${id}${qs}`;
  let status = 0;
  let html = '';
  let robots = '';
  try {
    const res = await fetchImpl(detailUrl, {
      redirect: 'follow',
      headers: { 'user-agent': 'kojo-og-job-cycle/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    robots = res.headers.get('x-robots-tag') || '';
    html = await res.text();
  } catch (err) {
    errors.push(`[${POST_DELETE_LABEL}] fiche ${detailUrl} injoignable : ${err.message}`);
    return lock;
  }

  if (status === 404) {
    lock.detail = true;
  } else {
    errors.push(
      `[${POST_DELETE_LABEL}] fiche ${detailUrl} répond HTTP ${status} après suppression ` +
        `(attendu 404 : une fiche de mission supprimée reste servie, donc indexable, avec sa carte OG)`
    );
  }

  const noindex = /noindex/i.test(robots) || /<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html);
  if (noindex) {
    lock.noindex = true;
  } else {
    errors.push(
      `[${POST_DELETE_LABEL}] fiche en HTTP ${status} mais SANS noindex ` +
        `(ni x-robots-tag, ni <meta name="robots" content="noindex…">)`
    );
  }

  // 2. La carte OG de la mission supprimée ne doit plus être servie.
  const cardUrl = `${origin}/api/og/jobs/${id}.png${qs}`;
  try {
    const res = await fetchImpl(cardUrl, {
      headers: { 'user-agent': 'kojo-og-job-cycle/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) {
      lock.card = true;
    } else {
      errors.push(`[${POST_DELETE_LABEL}] carte OG ${cardUrl} répond HTTP ${res.status} après suppression (attendu 404)`);
    }
  } catch (err) {
    errors.push(`[${POST_DELETE_LABEL}] carte OG ${cardUrl} injoignable : ${err.message}`);
  }

  // 3. Le sitemap ne doit plus la lister.
  const sitemap = await fetchSitemapLocs({ base, cacheBust, fetchImpl });
  if (sitemap.error) {
    errors.push(`[${POST_DELETE_LABEL}] ${sitemap.error}`);
  } else if (sitemap.locs.some((u) => u.includes(jobId))) {
    errors.push(
      `[${POST_DELETE_LABEL}] la mission ${jobId} est TOUJOURS listée dans ${sitemap.url} après suppression ` +
        `(les crawlers continueront de l'indexer une fiche morte)`
    );
  } else {
    lock.sitemap = true;
  }

  if (lock.detail && lock.noindex && lock.card && lock.sitemap) {
    checked.push(
      `  ✓ ${POST_DELETE_LABEL} → 404 + noindex, carte OG 404, absente du sitemap ` +
        `(${sitemap.locs.length} URL référencées)`
    );
    log(`  → verrou 404 validé (${sitemap.locs.length} URL au sitemap)`);
  }

  return lock;
}

/**
 * Cycle complet : créer → vérifier → supprimer.
 *
 * @param {object} [options]
 * @param {string} [options.base]   Base frontend servie (LHCI_URL).
 * @param {string} [options.backend] Base backend (KOJO_BACKEND_URL).
 * @param {string} [options.origin] Origin des cartes OG (KOJO_ORIGIN).
 * @param {string} [options.token]  Jeton Bearer explicite (sinon env/login).
 * @param {string} [options.email]  Identifiant du compte CI.
 * @param {string} [options.password] Mot de passe du compte CI.
 * @param {boolean} [options.quiet] Tait la progression (tests).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {string} [options.stamp]  Suffixe du titre (tests : déterministe).
 * @param {string} [options.cacheBust] Valeur anti-cache CDN (défaut : horodatage).
 * @returns {Promise<{ok: boolean, skipped: boolean, errors: string[],
 *   notices: string[], checked: string[], jobId: string, jobTitle: string,
 *   created: boolean, verified: boolean, deleted: boolean,
 *   postDelete: {detail: boolean, noindex: boolean, card: boolean, sitemap: boolean}}>}
 */
export async function runOgJob200Cycle({
  base = process.env.LHCI_URL || DEFAULT_BASE,
  backend = process.env.KOJO_BACKEND_URL || DEFAULT_BACKEND,
  origin = process.env.KOJO_ORIGIN || PROD_ORIGIN,
  token = '',
  email = process.env.LHCI_CI_EMAIL || process.env.LHCI_TEST_EMAIL || '',
  password = process.env.LHCI_CI_PASSWORD || process.env.LHCI_TEST_PASSWORD || '',
  quiet = false,
  fetchImpl = fetch,
  stamp = new Date().toISOString(),
  cacheBust = String(Date.now()),
} = {}) {
  const BASE = String(base).trim().replace(/\/+$/, '');
  const BACKEND = String(backend).trim().replace(/\/+$/, '');
  const ORIGIN = String(origin).trim().replace(/\/+$/, '');

  const errors = [];
  const notices = [];
  const checked = [];
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };

  const result = {
    ok: false,
    skipped: false,
    errors,
    notices,
    checked,
    jobId: '',
    jobTitle: '',
    created: false,
    verified: false,
    deleted: false,
    postDelete: { detail: false, noindex: false, card: false, sitemap: false },
  };

  // Repli build local : le rewrite Vercel /jobs/(.*) n'existe pas, la fiche
  // mission n'est pas servie. Créer une mission en prod n'apporterait rien.
  const isLocalBase = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(BASE);
  if (isLocalBase) {
    result.skipped = true;
    result.ok = true;
    const notice =
      `Cycle /jobs/:id IGNORÉ : base locale (${BASE}) — le rewrite Vercel et le pré-rendu backend ` +
      `n'existent que sur le déploiement réel. Aucune mission de test créée. ` +
      `(Le cycle est couvert sur les PR par backend/tests/test_job_og_cycle.py et ` +
      `scripts/check-spa-routes.js ; ce script reste celui qui prouve le déploiement réel.)`;
    notices.push(notice);
    log(`  ⚠️ ${notice}`);
    return result;
  }

  const auth = await resolveAuthHeader({ backend: BACKEND, token, email, password, fetchImpl, errors });
  if (!auth) {
    errors.push(
      'Aucun jeton disponible (LHCI_AUTH_HEADER absent et login CI impossible) — impossible de créer ' +
        'la mission de test, donc le chemin 200 reste NON vérifié.'
    );
    return result;
  }

  const payload = buildTestJobPayload(stamp);
  const title = payload.title;

  let created = false;
  try {
    let createRes;
    try {
      createRes = await fetchImpl(`${BACKEND}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: auth },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      errors.push(`création de la mission de test échouée (${err.message})`);
      createRes = null;
    }

    if (createRes) {
      if (!createRes.ok) {
        const body = await createRes.text().catch(() => '');
        errors.push(`création de la mission de test HTTP ${createRes.status} — ${String(body).slice(0, 200)}`);
      } else {
        const data = (await fetchJson(createRes)) || {};
        result.jobId = String(data.id || data.job_id || '');
        result.jobTitle = String(data.title || title);
        if (!result.jobId) {
          errors.push('création de la mission de test sans identifiant dans la réponse — nettoyage impossible');
        } else {
          created = true;
          result.created = true;
          checked.push(`  ✓ mission de test créée : ${result.jobId} (« ${result.jobTitle} »)`);
          log(`  → mission de test créée : ${result.jobId}`);
        }
      }
    }

    // Vérification de la CARTE RÉELLE de cette mission (branche 200).
    if (created) {
      const og = await runOgImageCheck({
        base: BASE,
        backend: BACKEND,
        origin: ORIGIN,
        quiet,
        fetchImpl,
        job: { id: result.jobId, title: result.jobTitle },
        onlyJob: true,
      });
      for (const e of og.errors) errors.push(e);
      for (const line of og.checked) checked.push(line);
      for (const n of og.notices) notices.push(n);
      result.verified = og.ok && og.job200Exercised;
      if (!og.job200Exercised) {
        errors.push('chemin 200 NON exercé alors que la mission de test existe (rewrite /jobs/:id cassé ?)');
      }

      // Contrepartie du verrou 404 : la mission DOIT être listée dans le
      // sitemap AVANT sa suppression. Sans cette assertion, « absente du
      // sitemap après suppression » serait vraie à vide (un sitemap qui ne
      // référencerait plus aucune mission passerait au vert).
      const before = await fetchSitemapLocs({ base: BASE, cacheBust, fetchImpl });
      if (before.error) {
        errors.push(
          `${before.error} — le verrou « absente du sitemap après suppression » ne peut donc pas être vérifié`
        );
      } else if (!before.locs.some((u) => u.includes(result.jobId))) {
        errors.push(
          `la mission de test ${result.jobId} n'apparaît PAS dans ${before.url} (${before.locs.length} URL) ` +
            `juste après sa création : le sitemap ne référence plus les missions, donc le contrôle d'absence ` +
            `après suppression serait vide de sens.`
        );
      } else {
        checked.push(
          `  ✓ mission listée dans le sitemap avant suppression (${before.locs.length} URL — verrou d'absence non vide)`
        );
      }
    }
  } finally {
    // Nettoyage : uniquement l'identifiant créé ci-dessus, jamais une autre mission.
    if (created) {
      try {
        const delRes = await fetchImpl(`${BACKEND}/api/jobs/${encodeURIComponent(result.jobId)}`, {
          method: 'DELETE',
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!delRes.ok) {
          const body = await delRes.text().catch(() => '');
          errors.push(
            `SUPPRESSION de la mission de test échouée (HTTP ${delRes.status}) — mission laissée en base ` +
              `(${result.jobId}, titre « ${result.jobTitle} ») : à nettoyer à la main. ${String(body).slice(0, 160)}`
          );
        } else {
          const data = (await fetchJson(delRes)) || {};
          result.deleted = true;
          checked.push(`  ✓ mission de test supprimée : ${data.job_id || result.jobId}`);
          log(`  → mission de test supprimée : ${result.jobId}`);
        }
      } catch (err) {
        errors.push(
          `SUPPRESSION de la mission de test échouée (${err.message}) — mission laissée en base ` +
            `(${result.jobId}, titre « ${result.jobTitle} ») : à nettoyer à la main.`
        );
      }

      // Verrou 404 : la fiche doit avoir disparu, rester hors index, perdre sa
      // carte OG et sortir du sitemap. Le cache-buster est indispensable ici :
      // la fiche d'une mission VIVANTE est servie avec s-maxage=3600 (mesuré en
      // prod), donc l'URL nue pourrait renvoyer un 200 sorti du cache CDN et
      // faire échouer (ou pire, passer) le contrôle pour la mauvaise raison.
      if (result.deleted) {
        result.postDelete = await assertDeletedJobUnreachable({
          base: BASE,
          origin: ORIGIN,
          jobId: result.jobId,
          cacheBust,
          fetchImpl,
          errors,
          checked,
          quiet,
        });
      }
    }
  }

  const lock = result.postDelete;
  const locked = lock.detail && lock.noindex && lock.card && lock.sitemap;
  result.ok = errors.length === 0 && result.created && result.verified && result.deleted && locked;
  if (!result.ok && errors.length === 0) {
    errors.push('cycle incomplet (création, vérification, suppression ou verrou 404 manquant)');
  }
  return result;
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = await runOgJob200Cycle();

  console.log('\nCycle /jobs/:id (création → carte OG → suppression) :');
  console.log(result.checked.length ? result.checked.join('\n') : '  (rien à vérifier)');
  for (const notice of result.notices) console.log(`::notice title=Chemin 200 — détail::${notice}`);

  if (result.ok) {
    console.log(
      result.skipped
        ? '\n✅ Cycle /jobs/:id ignoré (base locale) — chemin 200 exercé sur le déploiement réel (runs de main),\n   et couvert sur les PR par backend/tests/test_job_og_cycle.py + scripts/check-spa-routes.js.'
        : `\n✅ Chemin 200 de /jobs/:id vérifié sur une mission réelle (${result.jobId}) — puis verrou 404 : ` +
          `fiche 404 + noindex, carte OG 404, absente du sitemap.`
    );
  } else {
    console.error('\n❌ Cycle /jobs/:id en échec — ' + result.errors.length + ' problème(s) :');
    for (const e of result.errors) console.error('  ' + e);
    process.exit(1);
  }
}
