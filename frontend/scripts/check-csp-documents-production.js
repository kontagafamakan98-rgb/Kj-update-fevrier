#!/usr/bin/env node
/**
 * SONDE DE PRODUCTION — les documents pré-rendus portent-ils la CSP du SITE ?
 *
 * ── Le fait que cette sonde juge, et pourquoi le contrat hors ligne ne suffit
 *    pas ─────────────────────────────────────────────────────────────────────
 * `check-csp-contract.js` prouve que la déclaration JS (`src/config/csp.js`) et
 * sa copie Python (`backend/kojo_csp.py`) rendent la MÊME politique pour les
 * mêmes entrées, et que les quatre documents pré-rendus la publient. C'est
 * nécessaire, et ce n'est pas suffisant : les deux côtés lisent des
 * environnements DIFFÉRENTS.
 *
 *   • le build Vercel lit `VITE_API_URL`, `VITE_PLAUSIBLE_DOMAIN`,
 *     `VITE_GA_MEASUREMENT_ID`, `VITE_POSTHOG_KEY` ;
 *   • le backend Fly lit `BACKEND_PUBLIC_URL`, `PLAUSIBLE_DOMAIN`,
 *     `GA_MEASUREMENT_ID`, `POSTHOG_KEY` (secrets).
 *
 * Rien dans le dépôt ne dit que ces deux jeux de valeurs coïncident — ils
 * peuvent diverger au premier identifiant d'analytique ajouté d'un seul côté,
 * et la politique des documents se met alors à refuser ce que celle du site
 * autorise (ou l'inverse). Le seul endroit où les deux sont observables
 * ensemble est la PRODUCTION : cette sonde lit la politique que le site SERT sur
 * une page du build, puis celle que les documents pré-rendus SERVENT, et exige
 * l'égalité — en nommant la directive en écart, jamais « deux CSP diffèrent ».
 *
 * ── Trois sorties, jamais deux ─────────────────────────────────────────────
 * 0 = le site et les documents servent la même politique ;
 * 1 = refus nommé (page du site muette, document muet, politique divergente,
 *     document injoignable) ;
 * 2 = prémisse : ni fiche `/jobs/:id` ni profil `/workers/:id` au sitemap — il
 *     n'y a alors AUCUN document pré-rendu à comparer, et une prémisse n'est
 *     jamais un vert. Un seul des deux suffit à mesurer le fait ; l'absence de
 *     l'autre est publiée en `::notice`, pas transformée en verdict.
 *
 * ── Ce qu'elle ne juge pas, et qui est écrit ──────────────────────────────
 *   • la politique elle-même (ses directives) : elle est déclarée dans
 *     `src/config/csp.js` et jugée hors ligne par le contrat ;
 *   • les en-têtes HTTP (`frame-ancestors` de `frontend/vercel.json`) : ils ne
 *     sont pas dans le document, et la sonde le dit quand elle publie la
 *     politique comparée ;
 *   • le montage de l'application : `check-job-interactive-production.js`.
 *
 * Usage :
 *   node scripts/check-csp-documents-production.js                    # production
 *   node scripts/check-csp-documents-production.js --base https://…   # une preview
 *   node scripts/check-csp-documents-production.js --job <id> --worker <id>
 *   node scripts/check-csp-documents-production.js --reference /about  # page témoin du build
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { SITE_ORIGIN } from './site-meta.js';
import { cspDeDocument, ecartsDePolitiques, DIRECTIVE_ENTETE } from './csp-document.js';
import { cheminFiche, resoudreJob } from './check-job-page-production.js';
import { cheminProfil, resoudreProfil } from './check-worker-page-production.js';

export const DEFAULT_BASE = SITE_ORIGIN;

/** La famille de cette sonde — ce qu'un rouge prononcé ici veut dire. */
export const FAMILLE = 'CSP des documents pré-rendus';

/** Le seul titre d'annotation que cette sonde publie. */
export const TITRE_ERREUR = 'CSP documents pré-rendus production';

/** Marque des refus de PRÉMISSE : la sonde n'a pas pu juger — elle ne juge pas. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/**
 * La page du BUILD qui sert de témoin.
 *
 * L'accueil est une page du build (`index.html`), donc elle porte la politique
 * injectée par `vite-plugins/inject-production-csp.js` — c'est la valeur de
 * référence. `--reference` permet d'en désigner une autre si un jour l'accueil
 * cesse d'être ce document (une coquille pré-rendue, par exemple).
 */
export const PAGE_REFERENCE = '/';

/** Le rappel de ce qui doit être réglé quand les deux politiques divergent. */
export const REMEDE_ENV =
  'les réglages des deux déploiements doivent porter les mêmes valeurs : sur Fly, ' +
  'BACKEND_PUBLIC_URL / PLAUSIBLE_DOMAIN / GA_MEASUREMENT_ID / POSTHOG_KEY ; sur Vercel, ' +
  'VITE_API_URL / VITE_PLAUSIBLE_DOMAIN / VITE_GA_MEASUREMENT_ID / VITE_POSTHOG_KEY. Poser le ' +
  'secret manquant sur Fly, ou retirer la valeur du build — jamais laisser les deux se contredire.';

const TIMEOUT_MS = 20000;

const strip = (valeur) => String(valeur ?? '').trim().replace(/\/+$/, '');

/**
 * Le libellé qui préfixe chaque refus : la famille, et l'origine jugée.
 *
 * @param {string} base Origine servie.
 * @returns {string}
 */
export const libelleSonde = (base) =>
  `${FAMILLE} — les documents pré-rendus de ${strip(base)} portent-ils la politique du site`;

/**
 * Lit une page et rend son HTML, sans masquer un statut par une erreur de
 * lecture.
 *
 * @param {object} options
 * @param {string} options.url Adresse absolue.
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @returns {Promise<{status: number, html: string, csp: string, error: string}>}
 */
export async function lirePage({ url, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(url, {
      headers: {
        'user-agent': 'kojo-csp-documents-probe/1.0',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const html = await res.text().catch(() => '');
    return { status: res.status, html, csp: cspDeDocument(html), error: '' };
  } catch (err) {
    return { status: 0, html: '', csp: '', error: err.message };
  }
}

/**
 * Juge UN document pré-rendu contre la politique du site. PUR.
 *
 * @param {object} options
 * @param {string} options.nom Nom lisible du document (« /jobs/:id »).
 * @param {string} options.url Adresse demandée.
 * @param {string} options.attendue Politique servie par le site.
 * @param {string} options.html Document servi.
 * @returns {string[]} Problèmes (vide = le document porte la politique du site).
 */
export const jugerDocument = ({ nom, url, attendue, html }) => {
  const servie = cspDeDocument(html);
  if (!servie) {
    return [
      `${nom} (${url}) ne publie AUCUNE meta CSP — il démarre l'application sans la ` +
        `politique du site, alors que le site la sert. Vérifier que kojo_csp.balise_csp() est ` +
        `appelé dans le <head> du document (backend/kojo_job_og.py, backend/kojo_worker_og.py).`,
    ];
  }
  const ecarts = ecartsDePolitiques({ attendue, servie });
  if (ecarts.length) {
    return [
      `${nom} (${url}) publie une CSP qui n'est PAS celle du site :\n` +
        ecarts.map((ecart) => `      • ${ecart}`).join('\n') +
        `\n      → ${REMEDE_ENV}`,
    ];
  }
  return [];
};

/**
 * La sonde complète.
 *
 * @param {object} [options]
 * @param {string} [options.base] Origine frontend servie (défaut : production).
 * @param {string} [options.job] Identifiant ou URL de fiche (défaut : sitemap).
 * @param {string} [options.worker] Identifiant ou URL de profil (défaut : sitemap).
 * @param {string} [options.reference] Page du build servant de témoin.
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {boolean} [options.quiet] Tait la progression.
 * @returns {Promise<{ok: boolean, premisse: boolean, errors: string[], notices: string[],
 *   checked: string[], politique: string, pages: string[]}>}
 */
export async function runCspDocumentsProbe({
  base = process.env.KOJO_JOB_BASE_URL || DEFAULT_BASE,
  job = process.env.KOJO_JOB_ID || '',
  worker = process.env.KOJO_WORKER_ID || '',
  reference = PAGE_REFERENCE,
  fetchImpl = fetch,
  quiet = false,
} = {}) {
  const BASE = strip(base);
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };
  const errors = [];
  const notices = [];
  const checked = [];
  const pages = [];
  const result = { ok: false, premisse: false, errors, notices, checked, politique: '', pages };
  const libelle = libelleSonde(BASE);

  // ── 1. La politique du SITE, sur une page du build ──────────────────────
  const urlReference = `${BASE}${reference.startsWith('/') ? reference : `/${reference}`}`;
  const page = await lirePage({ url: urlReference, fetchImpl });
  if (page.error) {
    errors.push(
      `la page de référence ${urlReference} n'a pas pu être lue (${page.error}) : sans elle, ` +
        `la politique du site n'est pas connue, donc aucun document ne peut être comparé.`
    );
    return result;
  }
  if (page.status !== 200) {
    errors.push(
      `la page de référence ${urlReference} répond HTTP ${page.status} : la politique du site ` +
        `n'est pas mesurable sur cette origine (vérifier la page témoin, ou passer --reference).`
    );
    return result;
  }
  // La page a été LUE, même si elle se révèle muette : c'est un fait du run que
  // la sonde publie, et il distingue « rien lu » de « lu, mais muet ».
  pages.push(urlReference);
  if (!page.csp) {
    errors.push(
      `la page du site ${urlReference} ne publie AUCUNE CSP : c'est la politique de RÉFÉRENCE, ` +
        `donc rien ne peut être comparé. Soit le build a perdu l'injection ` +
        `(vite-plugins/inject-production-csp.js), soit la page témoin n'est pas une page du ` +
        `build — le dire, plutôt que de comparer les documents à du vide.`
    );
    return result;
  }
  const attendue = page.csp;
  result.politique = attendue;
  checked.push(
    `  ✓ politique du site lue sur ${urlReference} (${attendue.length} caractères, ` +
      `sans ${DIRECTIVE_ENTETE} — celui-ci vit dans l'en-tête HTTP de frontend/vercel.json)`
  );

  // ── 2. Les documents à comparer ─────────────────────────────────────────
  // Le sitemap est la surface par laquelle un crawler les découvre ; `--job` et
  // `--worker` servent à en désigner un précis. Les résolveurs sont ceux des
  // sondes de document : une seule lecture du sitemap dans tout le dépôt.
  const fiche = await resoudreJob({ base: BASE, job, fetchImpl });
  if (fiche.erreur) {
    errors.push(`la fiche à comparer n'a pas pu être résolue : ${fiche.erreur}`);
  }
  const profil = await resoudreProfil({ base: BASE, worker, fetchImpl });
  if (profil.erreur) {
    errors.push(`le profil à comparer n'a pas pu être résolu : ${profil.erreur}`);
  }
  if (errors.length) return result;

  const aJuger = [];
  if (fiche.id) aJuger.push({ nom: '/jobs/:id', chemin: cheminFiche(fiche.id), id: fiche.id });
  else {
    notices.push(
      'aucune fiche /jobs/:id au sitemap : le document de mission n’a PAS été comparé ' +
        '(publier une mission, ou passer --job <id|url>).'
    );
  }
  if (profil.id) aJuger.push({ nom: '/workers/:id', chemin: cheminProfil(profil.id), id: profil.id });
  else {
    notices.push(
      'aucun profil /workers/:id au sitemap : le document de profil n’a PAS été comparé ' +
        '(ou passer --worker <id|url>).'
    );
  }

  if (!aJuger.length) {
    result.premisse = true;
    const message =
      `${MARQUE_PREMISSE} : ni fiche /jobs/:id ni profil /workers/:id au sitemap de ${BASE} — ` +
      `aucun document pré-rendu n'a donc été comparé à la politique du site (lue, elle, sur ` +
      `${urlReference}). Publier une mission ou un profil, ou passer --job / --worker.`;
    notices.push(message);
    log(`⚠️ ${message}`);
    return result;
  }

  // ── 3. Chaque document porte-t-il cette politique ? ────────────────────
  for (const { nom, chemin } of aJuger) {
    const url = `${BASE}${chemin}`;
    const doc = await lirePage({ url, fetchImpl });
    pages.push(url);
    if (doc.error) {
      errors.push(`${nom} (${url}) n'a pas pu être lu (${doc.error}) : rien n'a été comparé.`);
      continue;
    }
    if (doc.status !== 200) {
      errors.push(
        `${nom} (${url}) répond HTTP ${doc.status} : le document pré-rendu n'est pas servi, ` +
          `donc sa CSP ne peut pas être jugée (réécriture Vercel perdue ? cf. la sonde du document).`
      );
      continue;
    }
    const problemes = jugerDocument({ nom, url, attendue, html: doc.html });
    errors.push(...problemes);
    if (!problemes.length) {
      checked.push(
        `  ✓ ${nom} (${url}) : la politique SERVIE est celle du site — mêmes directives, ` +
          `mêmes sources (${doc.csp.length} caractères)`
      );
    }
  }

  for (const notice of notices) {
    log(`::notice title=${TITRE_ERREUR}::${notice}`);
    log(`ℹ️ ${notice}`);
  }

  result.ok = errors.length === 0;
  if (result.ok) {
    log(
      `\n${libelle} : conforme (${checked.length} fait(s) mesuré(s) sur ${aJuger.length} ` +
        `document(s)).`
    );
  }
  return result;
}

/** Les options de ligne de commande. */
export function parseArguments(argv = process.argv.slice(2)) {
  const options = { base: '', job: '', worker: '', reference: '', quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base') options.base = argv[(index += 1)] || '';
    else if (argument === '--job') options.job = argv[(index += 1)] || '';
    else if (argument === '--worker') options.worker = argv[(index += 1)] || '';
    else if (argument === '--reference') options.reference = argv[(index += 1)] || '';
    else if (argument === '--quiet') options.quiet = true;
  }
  return options;
}

/**
 * Le point d'entrée, séparé pour que le VERDICT (0/1/2) se juge sans réseau.
 *
 * @param {string[]} [argv] Arguments après `node script`.
 * @param {object} [deps] `run`, `log`, `error`.
 * @returns {Promise<number>} Code de sortie.
 */
export async function main(
  argv = process.argv.slice(2),
  { run = runCspDocumentsProbe, log = console.log, error = console.error } = {}
) {
  const options = parseArguments(argv);
  const resultat = await run({
    base: options.base || undefined,
    job: options.job || undefined,
    worker: options.worker || undefined,
    reference: options.reference || undefined,
    quiet: options.quiet,
  });

  log(`\n${libelleSonde(options.base || DEFAULT_BASE)}`);
  for (const ligne of resultat.checked) log(ligne);

  if (resultat.premisse) {
    error(`::error title=${TITRE_ERREUR}::${resultat.notices.join(' ') || MARQUE_PREMISSE}`);
    for (const notice of resultat.notices) error(`  • ${notice}`);
    return 2;
  }

  if (resultat.errors.length) {
    error(`\n❌ ${resultat.errors.length} défaut(s) — ${TITRE_ERREUR} :`);
    for (const message of resultat.errors) error(`  • ${message}`);
    error(
      `\n   → la politique est déclarée dans src/config/csp.js ; les documents l'obtiennent de ` +
        `backend/kojo_csp.py (balise_csp). Un document MUET se corrige dans les modules de ` +
        `pré-rendu ; une politique DIFFÉRENTE se corrige dans les réglages des deux ` +
        `déploiements (cf. le remède ci-dessus).`
    );
    error(
      `::error title=${TITRE_ERREUR}::${resultat.errors.length} défaut(s) sur la CSP des ` +
        `documents pré-rendus`
    );
    return 1;
  }

  log(
    `\n✅ les documents pré-rendus servent la CSP du site : la politique lue sur ${options.reference || PAGE_REFERENCE} ` +
      `est identique, directive par directive, à celle publiée par ${resultat.pages
        .slice(1)
        .join(', ')}.`
  );
  return 0;
}

export const estAppelDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estAppelDirect) {
  process.exit(await main());
}
