#!/usr/bin/env node
/**
 * LA FORME D'UNE FICHE /jobs/:id, JUGÉE MÊME QUAND LA BASE AUDITÉE N'A AUCUNE
 * MISSION VIVANTE : la sonde CRÉE sa mission de contrôle, juge la fiche SERVIE,
 * puis la SUPPRIME.
 *
 * ── Ce qu'est « la forme », et pourquoi elle n'était jugée nulle part ──────
 * Un crawler de partage ou de recherche n'exécute pas JavaScript : ce qu'il lit
 * d'une fiche `/jobs/:id`, c'est le document pré-rendu par le backend
 * (`kojo_job_og.py`, aiguillé par le rewrite Vercel `/jobs/(.*)`). Sa forme, ce
 * sont ses balises — `<title>`, `meta description`, `robots`, `canonical`,
 * `og:url`, `twitter:url`, `og:title` en accord avec le `<title>`, le `<h1>`
 * statique — et ses deux cartes OG.
 *
 * Le 12/10/2026, la production ne servait AUCUNE mission vivante : la forme
 * d'une fiche n'était donc jugée nulle part. `check-og-images.js` et
 * `check-seo-production.js` lisent des missions EXISTANTES (et publient, à juste
 * titre, un ::warning déclaré quand il n'y en a aucune) ; `check-og-job-200.js`
 * n'exerce le chemin 200 que sur une base que le job contrôle, et n'y juge que
 * les cartes. La forme d'une fiche dépendait donc de l'état des DONNÉES du
 * client : un jour sans mission = un jour de silence, précisément quand la
 * demande de travail est faible.
 *
 * Cette sonde coupe cette dépendance : elle fait exister la mission qu'elle
 * juge. La forme est alors jugée par le CODE, à chaque run, que le corpus du
 * client soit vide ou non.
 *
 * ── Le mandat d'écriture : une exception DÉCLARÉE, jamais un accident ──────
 * Le cycle ÉCRIT (POST /api/jobs puis DELETE /api/jobs/:id). La règle du dépôt
 * est écrite dans l'en-tête de `check-og-job-200.js` : « aucune écriture en
 * production depuis la CI » — elle a été posée le 20/09/2026 parce qu'une
 * mission de test s'était créée en base RÉELLE par accident (l'adresse de la
 * base auditée ne dit rien de l'adresse ÉCRITE). Cette sonde ne la contourne
 * pas : elle n'écrit que sur un backend que le job contrôle (loopback), ou en
 * production SEULEMENT si le run pose un MANDAT explicite et délibéré
 * (`KOJO_CANARI_ALLOW_WRITE=1`).
 *
 * Sans mandat, elle saute — et elle le DÉCLARE : la surface est au registre
 * (`corpus-missions.js`, clé `job-form-canari:forme`) avec son motif, son remède
 * et sa date, la sonde publie un `::warning` qui nomme tout cela, ET elle REFUSE
 * (sortie 1) si la surface n'y est plus : un vert qui n'a rien mesuré est le
 * silence que F9 a coûté.
 *
 * ── Ce qu'elle ne remplace pas (écrit pour ne pas être prise pour couverte ──
 * Elle juge la forme d'une fiche de CONTRÔLE : ses textes sont les siens (titre
 * marqué `[CI]`, description de test). Les missions du CLIENT — leurs titres
 * longs, leurs descriptions vides ou échappées, leurs langues — restent lues là
 * où le corpus est réel (`check-seo-production.js`, `check-og-images.js`), et
 * ces deux surfaces restent déclarées aveugles quand il n'y en a pas. Le verrou
 * d'après-suppression, lui, n'est pas recopié : il appartient à
 * `check-og-job-200.js` (`assertDeletedJobUnreachable`), et il est exigé ici
 * comme là-bas — une fiche supprimée encore servie en 200 reste indexable et
 * garde sa carte.
 *
 * ── Une seule définition de « comment on crée une mission de contrôle » ────
 * La charge utile (`buildTestJobPayload`), la résolution du jeton
 * (`resolveAuthHeader`), la lecture du sitemap (`fetchSitemapLocs`) et le verrou
 * (`assertDeletedJobUnreachable`) viennent de la sonde qui les possède. Les
 * recopier ici ferait deux propriétaires d'une même règle, donc deux règles qui
 * divergent au premier changement (un champ obligatoire ajouté à `JobCreate`, un
 * en-tête d'authentification renommé).
 *
 * Usage :
 *   KOJO_LHCI_BASE_URL=http://localhost:4173 KOJO_BACKEND_URL=http://127.0.0.1:8000 \
 *     node scripts/check-job-form-canari.js
 *
 *   Et contre le déploiement réel, seulement avec un mandat délibéré :
 *   KOJO_LHCI_BASE_URL=https://kojoforafrica.cc.cd \
 *   KOJO_BACKEND_URL=https://api.kojoforafrica.cc.cd \
 *     KOJO_CANARI_ALLOW_WRITE=1 node scripts/check-job-form-canari.js
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runOgImageCheck, baseServesJobOgRoute } from './check-og-images.js';
import {
  assertDeletedJobUnreachable,
  buildTestJobPayload,
  fetchSitemapLocs,
  resolveAuthHeader,
} from './check-og-job-200.js';
import { SURFACE_JOB_FORM_CANARI_FORME, verdictDeSurfaceVide } from './corpus-missions.js';
import {
  API_ORIGIN,
  SITE_ORIGIN,
  canonicalHref,
  declaresNoIndex,
  isLoopbackUrl,
  metaContent,
  titleOf,
} from './site-meta.js';

export const DEFAULT_BASE = SITE_ORIGIN;
// Origine de l'API : propriété de scripts/site-meta.js (même valeur que
// DEFAULT_BACKEND de check-og-images.js et check-og-job-200.js).
export const DEFAULT_BACKEND = API_ORIGIN;
// Le mandat d'écriture : la variable qui autorise une écriture HORS loopback.
import { couperDescription } from '../src/utils/jobSeo.js';

// Son nom est public (elle est citée dans le registre, la CI et la doc) : une
// autorisation qui ne se lit que dans un fichier oublié n'est pas une décision.
export const MANDAT_ECRITURE_ENV = 'KOJO_CANARI_ALLOW_WRITE';
// Longueur de l'extrait de description publié par la fiche — la règle vit dans
// `src/utils/jobSeo.js` (`DESCRIPTION_LIMIT`, app) ET `backend/kojo_job_og.py`
// (pré-rendu) : cette constante ne la REDÉFINIT pas, elle dit à quoi la fiche
// servie est comparée.
export const DESCRIPTION_EXCERPT = 150;
// Étiquette du verrou d'après-suppression (le libellé appartient au verrou).
const TIMEOUT_MS = 20000;

/**
 * L'écriture est-elle AUTORISÉE, et pourquoi ? La question est posée à l'adresse
 * que la sonde MODIFIE (le backend), jamais à celle qu'elle audite : le
 * 20/09/2026, c'est exactement cette confusion qui avait créé une mission de
 * test en base réelle depuis une PR dont la preview était auditée.
 *
 * Deux mandats, et deux seulement : une adresse loopback (la pile locale du job,
 * que le job contrôle), ou le mandat explicite `KOJO_CANARI_ALLOW_WRITE=1`.
 *
 * @param {{backend?: string, mandat?: boolean}} [options]
 * @returns {{autorisee: boolean, raison: string}}
 */
export function ecritureAutorisee({ backend, mandat = false } = {}) {
  const cible = String(backend || '').trim();
  if (isLoopbackUrl(cible)) {
    return {
      autorisee: true,
      raison:
        `le backend ciblé (${cible}) est une adresse LOOPBACK : la mission de contrôle est ` +
        `créée et supprimée dans la base que ce job monte lui-même`,
    };
  }
  if (mandat) {
    return {
      autorisee: true,
      raison:
        `MANDAT D'ÉCRITURE posé (${MANDAT_ECRITURE_ENV}=1) : la mission de contrôle sera créée ` +
        `puis supprimée sur ${cible}, chez le client, dans ce run et dans aucun autre`,
    };
  }
  return {
    autorisee: false,
    raison:
      `le backend ciblé (${cible}) n'est pas une adresse contrôlée par ce job (loopback), et ` +
      `aucun mandat d'écriture (${MANDAT_ECRITURE_ENV}=1) n'est posé : la sonde n'écrit pas ` +
      `chez le client par défaut`,
  };
}

/** Décode les entités du HTML servi, pour comparer au TEXTE de la mission. */
export function decoderEntites(valeur) {
  return String(valeur ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    // `&amp;` EN DERNIER : le décoder avant les autres transformerait
    // `&amp;lt;` (le texte littéral « &lt; ») en `<`.
    .replace(/&amp;/g, '&');
}

/**
 * L'extrait de description qu'une fiche publie pour une mission donnée — la
 * règle de l'application (`src/utils/jobSeo.js`, `couperDescription`), DÉLÉGUÉE
 * et non recopiée.
 *
 * Ce n'était pas le cas, et ça s'est vu : le 24/10/2026 la copie locale disait
 * encore `raw_desc[:150]` (coupe dure) alors que l'application et le pré-rendu
 * reculaient au dernier espace — la mission de contrôle, dont la description
 * dépasse 150 caractères, a donc fait rougir `Workflow lint` sur une fiche
 * PARFAITEMENT conforme. Deux règles pour un seul extrait finissent toujours par
 * se contredire ; celle qui reste est celle du produit, pas celle de la sonde.
 *
 * Exporté pour que la sonde et sa preuve partagent la MÊME règle.
 */
export function extraitDeDescription(description) {
  return couperDescription(String(description || ''));
}

/**
 * LES DÉFAUTS DE FORME d'une fiche servie, chacun nommant ce qui manque et ce
 * que ça coûte.
 *
 * Fonction PURE (le HTML est injecté) : la règle est ainsi éprouvée sans serveur,
 * cas par cas, par `__tests__/check-job-form-canari.test.js` — un jugement qu'on
 * ne peut essayer que contre une base vivante est un jugement qu'on ne répare
 * qu'en production.
 *
 * L'origine attendue est celle que le déploiement ANNONCE (`KOJO_ORIGIN`, soit
 * SITE_ORIGIN) : elle n'est pas déduite de la base auditée, sinon une preview
 * ferait passer un canonical de preview pour conforme — et c'est précisément ce
 * qu'un canonical doit empêcher.
 *
 * @param {{html?: string, origin?: string, jobId?: string, missionTitle?: string,
 *   missionDescription?: string, robotsTag?: string}} [options]
 * @returns {string[]} Défauts, dans l'ordre où un crawler les lirait.
 */
export function defautsDeForme({
  html = '',
  origin = SITE_ORIGIN,
  jobId = '',
  missionTitle = '',
  missionDescription = '',
  robotsTag = '',
} = {}) {
  const defauts = [];
  const fiche = `/jobs/${jobId}`;
  const attendue = `${String(origin).trim().replace(/\/+$/, '')}${fiche}`;
  const document = String(html || '');

  const titre = decoderEntites(titleOf(document));
  const description = decoderEntites(metaContent(document, 'description'));
  const robots = metaContent(document, 'robots');
  const canonical = canonicalHref(document) || '';
  const ogUrl = decoderEntites(metaContent(document, 'og:url'));
  const twitterUrl = decoderEntites(metaContent(document, 'twitter:url'));
  const ogTitle = decoderEntites(metaContent(document, 'og:title'));
  const h1 = decoderEntites((document.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');

  // 1. Le titre : la fiche se présente-t-elle COMME cette mission ? Un titre
  //    générique ne se voit pas dans un test de présence — il se voit ici.
  if (!titre.trim()) {
    defauts.push(
      `${fiche} : <title> ABSENT — un résultat de recherche s'afficherait avec l'adresse brute.`
    );
  } else if (!titre.includes(missionTitle)) {
    defauts.push(
      `${fiche} : <title> « ${titre} » ne NOMME PAS la mission (« ${missionTitle} ») — la fiche ` +
        `se présente comme une page générique, donc deux missions se partagent le même titre.`
    );
  }

  // 2. La description : celle de la MISSION, pas celle du site (et l'extrait
  //    est confronté à la longueur que le rendu applique réellement).
  const attendueDesc = extraitDeDescription(missionDescription);
  if (!description.trim()) {
    defauts.push(`${fiche} : meta description ABSENTE — un moteur n'a aucun extrait à afficher.`);
  } else if (description !== attendueDesc) {
    defauts.push(
      `${fiche} : meta description « ${description} » ne dit PAS la mission — attendu l'extrait ` +
        `de ${DESCRIPTION_EXCERPT} caractères de sa description : « ${attendueDesc} ».`
    );
  }

  // 3. L'indexabilité : une fiche VIVANTE servie en 200 doit être indexable. Le
  //    noindex est refusé même s'il vient de l'en-tête HTTP (le second canal).
  if (declaresNoIndex(document, robotsTag)) {
    defauts.push(
      `${fiche} : fiche d'une mission VIVANTE en NOINDEX (x-robots-tag « ${robotsTag} », meta ` +
        `robots « ${robots} ») — elle est servie, donc lisible, sans jamais pouvoir être indexée.`
    );
  } else if (!String(robots).toLowerCase().includes('index')) {
    defauts.push(
      `${fiche} : meta robots « ${robots} » ne déclare pas l'indexation (attendu « index, follow ») ` +
        `— l'absence de directive n'est pas une promesse d'indexation.`
    );
  }

  // 4. Le canonical : l'adresse de CETTE fiche, sur l'origine ANNONCÉE par le
  //    déploiement. Un canonical d'une autre page a bien une valeur, et envoie
  //    les crawlers ailleurs.
  if (!canonical) {
    defauts.push(
      `${fiche} : canonical ABSENT — un crawler ne peut pas trancher entre les adresses qui répondent.`
    );
  } else {
    let lu = null;
    try {
      lu = new URL(canonical);
    } catch (_e) {
      lu = null;
    }
    const attendueUrl = new URL(attendue);
    if (!lu) {
      defauts.push(`${fiche} : canonical « ${canonical} » n'est pas une URL absolue — un crawler l'ignore.`);
    } else if (lu.origin !== attendueUrl.origin) {
      defauts.push(
        `${fiche} : canonical ${canonical} — ÉCART : hors de l'origine attendue ${attendueUrl.origin} ` +
          `(l'adresse annoncée par le déploiement, ${origin}).`
      );
    } else if (lu.pathname.replace(/\/+$/, '') !== attendueUrl.pathname.replace(/\/+$/, '')) {
      defauts.push(
        `${fiche} : canonical ${canonical} — ÉCART : désigne ${lu.pathname} au lieu de cette fiche ` +
          `(${attendueUrl.pathname}).`
      );
    }
  }

  // 5. og:url et twitter:url : un partage doit annoncer l'adresse que le
  //    canonical désigne. Deux canaux, donc deux fois la même vérification.
  for (const [balise, valeur] of [
    ['og:url', ogUrl],
    ['twitter:url', twitterUrl],
  ]) {
    if (!valeur) {
      defauts.push(`${fiche} : ${balise} ABSENTE — un partage ne sait pas quelle adresse il annonce.`);
    } else if (valeur.trim().replace(/\/+$/, '') !== attendue) {
      defauts.push(
        `${fiche} : ${balise} « ${valeur} » ne désigne PAS la fiche servie (« ${attendue} ») — ` +
          `un partage conduirait ailleurs.`
      );
    }
  }

  // 6. og:title et <title> : deux surfaces, une seule phrase. Une divergence
  //    entre elles ne casse rien tout de suite — c'est pourquoi elle est dite.
  if (!ogTitle.trim()) {
    defauts.push(`${fiche} : og:title ABSENT — un partage sans titre n'affiche que l'adresse.`);
  } else if (titre && ogTitle !== titre) {
    defauts.push(
      `${fiche} : og:title « ${ogTitle} » et <title> « ${titre} » ne disent PAS la même chose — ` +
        `un crawler et un partage annonceraient deux titres différents.`
    );
  }

  // 7. Le <h1> statique : ce qu'un crawler sans JavaScript lit DANS le corps.
  if (!h1.trim()) {
    defauts.push(
      `${fiche} : aucun <h1> statique — la fiche pré-rendue n'annonce pas la mission sans JavaScript.`
    );
  } else if (!h1.includes(missionTitle)) {
    defauts.push(`${fiche} : <h1> « ${h1} » ne NOMME PAS la mission (« ${missionTitle} »).`);
  }

  return defauts;
}

/**
 * Le cycle complet : créer → juger la forme → supprimer (toujours) → verrouiller.
 *
 * @param {object} [options]
 * @param {string} [options.base]    Base frontend servie (KOJO_LHCI_BASE_URL).
 * @param {string} [options.backend] Base backend ÉCRITE (KOJO_BACKEND_URL).
 * @param {string} [options.origin]  Origine ANNONCÉE par le déploiement (KOJO_ORIGIN).
 * @param {string} [options.token]   Jeton Bearer explicite (sinon env/login).
 * @param {string} [options.email]   Identifiant du compte CI.
 * @param {string} [options.password] Mot de passe du compte CI.
 * @param {boolean} [options.mandat] Mandat d'écriture explicite (KOJO_CANARI_ALLOW_WRITE).
 * @param {boolean} [options.quiet]  Tait la progression (tests).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {string} [options.stamp]   Suffixe du titre (tests : déterministe).
 * @param {string} [options.cacheBust] Valeur anti-cache CDN (défaut : horodatage).
 * @returns {Promise<{ok: boolean, skipped: boolean, skipReason: string, skipDetail: string,
 *   errors: string[], notices: string[], checked: string[], avertissements: string[],
 *   jobId: string, jobTitle: string, created: boolean, verified: boolean, deleted: boolean,
 *   forme: {status: number, defauts: string[]},
 *   jobRoute: {serves: boolean, status: number, url: string, detail: string},
 *   postDelete: {detail: boolean, noindex: boolean, card: boolean, sitemap: boolean}}>}
 */
export async function runJobFormCanari({
  base = process.env.KOJO_LHCI_BASE_URL || DEFAULT_BASE,
  backend = process.env.KOJO_BACKEND_URL || DEFAULT_BACKEND,
  origin = process.env.KOJO_ORIGIN || SITE_ORIGIN,
  token = '',
  email = process.env.LHCI_CI_EMAIL || process.env.LHCI_TEST_EMAIL || '',
  password = process.env.LHCI_CI_PASSWORD || process.env.LHCI_TEST_PASSWORD || '',
  mandat = process.env[MANDAT_ECRITURE_ENV] === '1',
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
  // Les surfaces aveugles DÉCLARÉES : publiées en `::warning` par l'appelant.
  const avertissements = [];
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };

  const result = {
    ok: false,
    skipped: false,
    skipReason: '',
    skipDetail: '',
    errors,
    notices,
    checked,
    avertissements,
    jobId: '',
    jobTitle: '',
    created: false,
    verified: false,
    deleted: false,
    forme: { status: 0, defauts: [] },
    jobRoute: { serves: false, status: 0, url: '', detail: 'sonde non exécutée' },
    postDelete: { detail: false, noindex: false, card: false, sitemap: false },
  };

  /**
   * La surface n'a pas pu être mesurée : elle est DÉCLARÉE (avertissement,
   * publié par l'appelant) ou elle est un DÉFAUT DE CODE (refus, sortie 1). Le
   * motif exact est publié à côté, en ::notice — le verdict du registre dit la
   * surface et son remède, pas la mesure de CE run.
   */
  const declarerSurfaceAveugle = (detail) => {
    const verdict = verdictDeSurfaceVide({ cle: SURFACE_JOB_FORM_CANARI_FORME, detail });
    if (verdict.erreur) {
      errors.push(verdict.erreur);
      result.ok = false;
    } else {
      avertissements.push(verdict.avertissement);
    }
  };

  // Capacité OBSERVÉE de la base auditée : une base qui ne sert pas la route
  // backend /jobs/:id ne peut pas être jugée sur cette route (ses 404 seraient
  // des faux positifs, et la mission de contrôle n'aurait aucune fiche à servir).
  const jobRoute = await baseServesJobOgRoute({ base: BASE, fetchImpl });
  result.jobRoute = jobRoute;
  if (!jobRoute.serves) {
    result.skipped = true;
    result.skipReason = 'route-non-servie';
    result.ok = true;
    const detail =
      `la base auditée ${BASE} ne sert pas la route backend /jobs/:id (sonde ${jobRoute.url} → ` +
      `${jobRoute.detail}) : ni rewrite Vercel, ni serveur local émulant la table de vercel.json`;
    result.skipDetail = detail;
    notices.push(
      `Canari de forme /jobs/:id IGNORÉ : ${detail}. Aucune mission de contrôle créée. ` +
        `(La forme de la fiche est couverte sur les PR par backend/tests/test_job_og_cycle.py et ` +
        `scripts/check-job-og-contract.js, qui la jugent hors ligne.)`
    );
    log(`  ⚠️ ${notices[notices.length - 1]}`);
    declarerSurfaceAveugle(detail);
    return result;
  }

  // Le mandat : la question porte sur le backend ÉCRIT, pas sur la base auditée.
  const ecriture = ecritureAutorisee({ backend: BACKEND, mandat });
  if (!ecriture.autorisee) {
    result.skipped = true;
    result.skipReason = 'pas-de-mandat';
    result.ok = true;
    const detail = ecriture.raison;
    result.skipDetail = detail;
    notices.push(
      `Canari de forme /jobs/:id IGNORÉ : ${detail}. La forme d'une fiche est jugée là où ce job ` +
        `peut écrire — la pile locale de la CI (KOJO_BACKEND_URL=127.0.0.1) —, ou en production ` +
        `sous mandat délibéré.`
    );
    log(`  ⚠️ ${notices[notices.length - 1]}`);
    declarerSurfaceAveugle(detail);
    return result;
  }

  const auth = await resolveAuthHeader({ backend: BACKEND, token, email, password, fetchImpl, errors });
  if (!auth) {
    errors.push(
      'Aucun jeton disponible (KOJO_LHCI_AUTH_HEADER absent et login CI impossible) — impossible de ' +
        'créer la mission de contrôle, donc la forme de la fiche reste NON vérifiée.'
    );
    return result;
  }

  const payload = buildTestJobPayload(stamp);
  const missionTitle = payload.title;
  const missionDescription = payload.description;

  let created = false;
  try {
    let createRes = null;
    try {
      createRes = await fetchImpl(`${BACKEND}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: auth },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      errors.push(`création de la mission de contrôle échouée (${err.message})`);
    }

    if (createRes) {
      if (!createRes.ok) {
        const body = await createRes.text().catch(() => '');
        errors.push(
          `création de la mission de contrôle HTTP ${createRes.status} — ${String(body).slice(0, 200)}`
        );
      } else {
        const data = (await createRes.json().catch(() => null)) || {};
        result.jobId = String(data.id || data.job_id || '');
        result.jobTitle = String(data.title || missionTitle);
        if (!result.jobId) {
          errors.push(
            'création de la mission de contrôle sans identifiant dans la réponse — nettoyage impossible'
          );
        } else {
          created = true;
          result.created = true;
          checked.push(`  ✓ mission de contrôle créée : ${result.jobId} (« ${result.jobTitle} »)`);
          log(`  → mission de contrôle créée : ${result.jobId}`);
        }
      }
    }

    if (created) {
      // ── LA FORME : le document SERVI de cette fiche, pas le gabarit ────────
      const ficheUrl = `${BASE}/jobs/${encodeURIComponent(result.jobId)}`;
      let html = '';
      let robotsTag = '';
      try {
        const res = await fetchImpl(ficheUrl, {
          redirect: 'follow',
          headers: { 'user-agent': 'kojo-job-form-canari/1.0' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        result.forme.status = res.status;
        robotsTag = res.headers.get('x-robots-tag') || '';
        html = await res.text();
      } catch (err) {
        errors.push(`forme /jobs/:id : lecture de ${ficheUrl} échouée (${err.message})`);
      }

      if (result.forme.status && result.forme.status !== 200) {
        errors.push(
          `forme /jobs/:id : la fiche d'une mission VIVANTE répond HTTP ${result.forme.status} ` +
            `(attendu 200) — le rewrite /jobs/(.*), le pré-rendu backend ou le cache CDN ne servent ` +
            `pas la mission qui existe.`
        );
      }

      const defauts = defautsDeForme({
        html,
        origin: ORIGIN,
        jobId: result.jobId,
        missionTitle,
        missionDescription,
        robotsTag,
      });
      result.forme.defauts = defauts;
      for (const defaut of defauts) errors.push(defaut);

      if (result.forme.status === 200 && defauts.length === 0) {
        const forme = [
          `      <title> « ${String(titleOf(html)).trim()} »`,
          `      meta description = extrait de ${DESCRIPTION_EXCERPT} caractères de la mission`,
          `      meta robots = « ${metaContent(html, 'robots')} », aucun noindex (ni balise, ni en-tête)`,
          `      canonical = ${canonicalHref(html)}`,
          `      og:url = ${metaContent(html, 'og:url')} · twitter:url = ${metaContent(html, 'twitter:url')}`,
          `      <h1> statique porteur du titre de la mission`,
        ].join('\n');
        checked.push(
          `  ✓ forme de /jobs/:id jugée sur la fiche SERVIE (${ficheUrl}) :\n${forme}`
        );
        log(`  → forme de la fiche jugée (${defauts.length} défaut)`);
      }

      // ── Les CARTES OG : jugées par leur propriétaire, sur cette mission ───
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
      if (!og.job200Exercised) {
        errors.push(
          'chemin 200 NON exercé alors que la mission de contrôle existe (rewrite /jobs/:id cassé ?)'
        );
      }

      result.verified =
        result.forme.status === 200 && defauts.length === 0 && og.ok && og.job200Exercised;

      // Contrepartie du verrou : la mission DOIT être listée dans le sitemap
      // AVANT sa suppression, sinon « absente du sitemap après suppression »
      // serait vrai à vide (un sitemap sans mission passerait au vert).
      const before = await fetchSitemapLocs({ base: BASE, cacheBust, fetchImpl });
      if (before.error) {
        errors.push(
          `${before.error} — le verrou « absente du sitemap après suppression » ne peut donc pas être vérifié`
        );
      } else if (!before.locs.some((u) => u.includes(result.jobId))) {
        errors.push(
          `la mission de contrôle ${result.jobId} n'apparaît PAS dans ${before.url} ` +
            `(${before.locs.length} URL) juste après sa création : le sitemap ne référence plus les ` +
            `missions, donc le contrôle d'absence après suppression serait vide de sens.`
        );
      } else {
        checked.push(
          `  ✓ mission listée dans le sitemap avant suppression (${before.locs.length} URL — verrou d'absence non vide)`
        );
      }
    }
  } finally {
    // Nettoyage : uniquement l'identifiant créé ci-dessus, jamais une autre
    // mission (aucune liste, aucun balayage) — et il a lieu même si le jugement
    // de forme a échoué.
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
            `SUPPRESSION de la mission de contrôle échouée (HTTP ${delRes.status}) — mission laissée ` +
              `en base (${result.jobId}, titre « ${result.jobTitle} ») : à nettoyer à la main. ` +
              `${String(body).slice(0, 160)}`
          );
        } else {
          const data = (await delRes.json().catch(() => null)) || {};
          result.deleted = true;
          checked.push(`  ✓ mission de contrôle supprimée : ${data.job_id || result.jobId}`);
          log(`  → mission de contrôle supprimée : ${result.jobId}`);
        }
      } catch (err) {
        errors.push(
          `SUPPRESSION de la mission de contrôle échouée (${err.message}) — mission laissée en base ` +
            `(${result.jobId}, titre « ${result.jobTitle} ») : à nettoyer à la main.`
        );
      }

      // Verrou : le cache-buster est indispensable — la fiche d'une mission
      // VIVANTE est servie avec s-maxage=3600 (mesuré en prod), donc l'URL nue
      // pourrait renvoyer un 200 sorti du cache CDN, et faire échouer (ou pire,
      // passer) le contrôle pour la mauvaise raison.
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
  const verrouille = lock.detail && lock.noindex && lock.card && lock.sitemap;
  result.ok = errors.length === 0 && result.created && result.verified && result.deleted && verrouille;
  if (!result.ok && errors.length === 0) {
    errors.push('cycle incomplet (création, jugement de forme, suppression ou verrou manquant)');
  }
  if (result.ok) {
    checked.push(`  ✓ mandat d'écriture : ${ecriture.raison}`);
  }
  return result;
}

const estAppelDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estAppelDirect) {
  const result = await runJobFormCanari();

  console.log('\nCanari de forme /jobs/:id (création → jugement de forme → suppression) :');
  console.log(result.checked.length ? result.checked.join('\n') : '  (rien à juger)');
  // Une surface AVEUGLE (déclarée) est BRUYANTE : `::warning` nommant la surface
  // non mesurée, son motif et son remède. Non déclarée, elle est passée en
  // `errors` et le refus est publié ci-dessous (sortie 1).
  for (const avertissement of result.avertissements) {
    console.log(`::warning title=Surface aveugle (corpus vide)::${avertissement}`);
  }
  // Et la CAUSE de CE run, en clair : le verdict du registre dit la surface et
  // son remède, pas pourquoi elle est aveugle aujourd'hui (pas de mandat, base
  // qui ne sert pas la route).
  for (const notice of result.notices) console.log(`::notice title=Canari de forme — détail::${notice}`);

  if (result.ok) {
    console.log(
      result.skipped
        ? `\n⚠️ Canari de forme /jobs/:id ignoré (${result.skipReason}) : ${result.skipDetail}\n` +
            "   La surface reste DÉCLARÉE aveugle (avertissement ci-dessus) — elle n'est pas passée\n" +
            '   sous silence.'
        : `\n✅ Forme de /jobs/:id jugée sur une mission de contrôle (${result.jobId}) — puis verrou : ` +
            `fiche 404 + noindex, carte OG 404, absente du sitemap.`
    );
  } else {
    console.error(`\n❌ Canari de forme /jobs/:id en échec — ${result.errors.length} problème(s) :`);
    for (const e of result.errors) console.error('  ' + e);
    process.exit(1);
  }
}
