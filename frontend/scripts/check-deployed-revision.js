#!/usr/bin/env node
/**
 * Le frontend SERVI est-il celui de ce commit ?
 *
 * ── Le trou que ce garde ferme ─────────────────────────────────────────────
 * Le backend répond quelle révision il exécute (`/health`, champ `revision`) et
 * `deploy-fly` refuse quand ce n'est pas le commit attendu (CI-COVERAGE.md, F8).
 * Le frontend, lui, ne disait RIEN : le déploiement de production est fait par
 * Vercel depuis l'app GitHub, aucun job ne le commande, donc « main est vert »
 * ne pouvait pas distinguer « le site servi est construit depuis ce commit » de
 * « Vercel a échoué / est en retard / n'a pas redéployé ». Rien n'observait la
 * production du frontend pour le CODE — les sondes existantes y regardent le SEO,
 * les OG et le CORS, jamais de quel commit l'artefact est fait.
 *
 * Le build publie donc sa révision dans le HTML statique
 * (`vite-plugins/inject-build-revision.js` → meta `kojo-build-revision`), et ce
 * garde compare cette réponse à ce que `main` aurait dû déployer.
 *
 * ── Quelle révision est ATTENDUE ───────────────────────────────────────────
 * La propriété visée est : aucun changement de `frontend/**` n'est absent de la
 * production. Elle s'écrit avec deux valeurs acceptées, et non une seule, parce
 * que la politique du déployeur n'est pas la nôtre :
 *   • `--attendu` : le commit poussé (Vercel redéploie chaque push de `main`,
 *     mesuré sur 12 commits consécutifs) ;
 *   • `--sinon`   : le dernier commit qui a touché `frontend/**` — l'état que la
 *     production laisse en place si un jour Vercel ignore un push sans
 *     changement de frontend. L'accepter ne relâche rien : dans les deux cas, le
 *     contenu frontend servi est celui de `main`.
 * Accepter une valeur PLUS ANCIENNE ne relâcherait rien non plus, mais serait un
 * refus silencieux de la question posée : un déploiement en retard doit rougir.
 *
 * ── Ce que ce garde refuse, et pourquoi il le NOMME ────────────────────────
 * Trois refus, trois corrections différentes — un seul « échec » les confondrait :
 *   1. le HTML servi n'annonce AUCUNE révision : l'artefact est antérieur à ce
 *      mécanisme, ou construit sans qu'aucune source n'en donne (ni `KOJO_GIT_SHA`,
 *      ni variable système, ni dépôt git — cf. `vite-plugins/inject-build-revision.js`).
 *      Correction : redéployer le frontend sur Vercel.
 *   2. la révision servie n'est ni l'attendue ni la dernière ayant touché le
 *      frontend : la production est en retard (build échoué, en file d'attente
 *      depuis plus longtemps que la fenêtre d'attente, ou déploiement annulé).
 *   3. aucune réponse exploitable : le site ne répond pas, ou le CDN refuse
 *      (défi de sécurité de l'edge Vercel, mesuré le 20/09/2026 et nommé ici :
 *      `X-Vercel-Mitigated`). Rien ne peut alors être affirmé sur le déploiement.
 *
 * Une invocation qui ne dit pas quoi comparer ÉCHOUE (code 2) au lieu de passer :
 * `--attendu` vide ou trop court n'est pas un identifiant de commit.
 *
 * ── Coût, et le risque de faux rouge ───────────────────────────────────────
 * Un appel HTTP par tentative, séquentiels, bornés par `--tentatives` (défaut 9
 * espacés de 20 s ≈ 3 min) : c'est ce qui absorbe un déploiement Vercel en cours
 * sans jamais transformer un refus en succès. Le défi de l'edge Vercel (le seul
 * faux rouge observé sur la production, cf. `resolve-vercel-url.sh`) est nommé
 * comme tel, donc reconnu au lieu d'être confondu avec un frontend en retard.
 *
 * Usage :
 *   cd frontend && node scripts/check-deployed-revision.js \
 *     --attendu "$GITHUB_SHA" --sinon "$(git rev-list -1 HEAD -- frontend/)"
 * Optionnel :
 *   --base https://kojoforafrica.cc.cd   (défaut : SITE_ORIGIN, scripts/site-meta.js)
 *   --tentatives 9 --delai 20
 */
import { pathToFileURL } from 'node:url';
import { BUILD_REVISION_META, SITE_ORIGIN, isLoopbackUrl, metaContent } from './site-meta.js';

// Longueur minimale d'un SHA de commit : en dessous, ce n'est pas un identifiant
// de commit mais une chaîne quelconque — comparer là-dessus serait un faux vert.
export const LONGUEUR_SHA_MIN = 7;

// Valeurs qui ne sont PAS une révision : le champ vide, et ce qu'un artefact
// fabriqué sans révision pourrait annoncer.
export const REVISIONS_ABSENTES = new Set(['', 'inconnue', 'unknown', 'none', 'null', 'undefined', 'n/a']);

// Un seul en-tête, pour que la requête soit identifiable dans les journaux du CDN.
const PROBE_HEADERS = { 'user-agent': 'kojo-deployed-revision/1.0' };

/**
 * La valeur est-elle une RÉVISION ? Vide et « inconnue » ne le sont pas.
 *
 * Une seule fonction pour les deux côtés de la comparaison : sans ça, une
 * révision « inconnue » servie et la même attendue se déclareraient concordantes
 * — le faux vert exact que ce garde existe pour fermer.
 *
 * @param {unknown} valeur Valeur brute (chaîne, null, autre type).
 * @returns {string} La révision, ou '' si la valeur n'en est pas une.
 */
export function normaliser(valeur) {
  if (typeof valeur !== 'string') return '';
  const propre = valeur.trim();
  return REVISIONS_ABSENTES.has(propre.toLowerCase()) ? '' : propre;
}

/**
 * Les révisions acceptées, à partir de ce que l'appelant a fourni.
 *
 * @param {Array<string|undefined>} valeurs `--attendu`, puis `--sinon`.
 * @returns {{valides: string[], invalides: string[]}} Les invalides sont rendues
 *   telles quelles : c'est ce qui permet de les NOMMER dans le refus.
 */
export function revisionsAttendues(valeurs = []) {
  const valides = [];
  const invalides = [];
  for (const valeur of valeurs) {
    const brute = String(valeur ?? '').trim();
    if (!brute) continue;
    const révision = normaliser(brute);
    if (révision.length < LONGUEUR_SHA_MIN) invalides.push(brute);
    else if (!valides.includes(révision)) valides.push(révision);
  }
  return { valides, invalides };
}

/**
 * La révision publiée par le HTML servi, ou '' si la page n'en annonce aucune.
 *
 * @param {string} html Corps de la réponse de la page d'accueil.
 * @returns {string} La révision annoncée.
 */
export function revisionServie(html) {
  return normaliser(metaContent(String(html ?? ''), BUILD_REVISION_META));
}

/**
 * Le verdict, avec le coupable nommé dans chaque cas.
 *
 * @param {string} servie Révision annoncée par la production.
 * @param {string[]} attendues Révisions acceptées.
 * @returns {{ok: boolean, message: string}} Verdict et son explication.
 */
export function comparer(servie, attendues = []) {
  const révision = normaliser(servie);
  const acceptées = attendues.map(normaliser).filter(Boolean);
  const attendu = acceptées.length ? acceptées.map((r) => r.slice(0, 12)).join(' ou ') : '(aucune)';

  if (!révision) {
    return {
      ok: false,
      message:
        `le frontend servi n'annonce AUCUNE révision (meta « ${BUILD_REVISION_META} » absente) : ` +
        "l'artefact déployé est antérieur à ce mécanisme, ou il a été construit sans qu'aucune " +
        'source n\'en donne (KOJO_GIT_SHA, variables système, ou le dépôt git du build). ' +
        'Redéployer le frontend sur Vercel — tant que cette balise se tait, rien ne prouve ' +
        'quel code le site sert.',
    };
  }
  if (acceptées.includes(révision)) {
    return { ok: true, message: `révision servie = attendue (${révision.slice(0, 12)})` };
  }
  return {
    ok: false,
    message:
      `révision servie ≠ attendue : servi=${révision.slice(0, 12)} attendu=${attendu} — ` +
      "le frontend déployé n'est pas celui de main (build Vercel échoué, en file d'attente, " +
      'ou déploiement jamais déclenché).',
  };
}

/**
 * Lit la page d'accueil du site servi.
 *
 * @param {string} base Origine du site (`https://…`, sans slash final).
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {number} [options.timeout] Délai maximal de la requête, en ms.
 * @returns {Promise<{html: string|null, erreur: string|null}>} Jamais d'exception.
 */
export async function interroger(base, { fetchImpl = fetch, timeout = 15000 } = {}) {
  let réponse;
  try {
    réponse = await fetchImpl(`${base}/`, {
      redirect: 'follow',
      headers: PROBE_HEADERS,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    return { html: null, erreur: `${error.name || 'Error'}: ${error.message}` };
  }

  if (!réponse.ok) {
    // Le défi de l'edge Vercel a déjà produit des rouges au hasard sur `main`
    // (403 `X-Vercel-Mitigated: challenge`, cf. resolve-vercel-url.sh) : le nommer
    // ici évite qu'il se lise comme « frontend en retard ».
    const mitigation = réponse.headers?.get?.('x-vercel-mitigated') || '';
    const suffixe = mitigation ? ` — défi de sécurité du CDN Vercel (X-Vercel-Mitigated: ${mitigation})` : '';
    return { html: null, erreur: `HTTP ${réponse.status}${suffixe}` };
  }

  const corps = await réponse.text();
  if (!/<html[\s>]/i.test(corps)) {
    return { html: null, erreur: "la réponse n'est pas du HTML (le site ne sert pas sa page d'accueil)" };
  }
  return { html: corps, erreur: null };
}

/**
 * Interroge la production jusqu'à ce qu'elle annonce une révision acceptée.
 *
 * Les tentatives absorbent le déploiement en cours ; elles ne transforment pas un
 * refus en succès, elles attendent que la réponse change.
 *
 * @param {object} options `base`, `attendues`, `fetchImpl`, `tentatives`, `delai`.
 * @returns {Promise<{ok: boolean, journal: string[]}>} Le verdict et chaque essai.
 */
export async function verifierServie({
  base,
  attendues = [],
  fetchImpl = fetch,
  tentatives = 9,
  delai = 20,
  dormir = (ms) => new Promise((r) => setTimeout(r, ms * 1000)),
  log = console.log,
  interrogerImpl = interroger,
} = {}) {
  const journal = [];
  const total = Math.max(1, Number(tentatives) || 1);
  for (let tentative = 1; tentative <= total; tentative += 1) {
    const { html, erreur } = await interrogerImpl(base, { fetchImpl });
    const verdict = html === null
      ? {
        ok: false,
        message: `aucune réponse exploitable de ${base} : ${erreur} — rien ne peut être affirmé sur le déploiement.`,
      }
      : comparer(revisionServie(html), attendues);
    journal.push(`tentative ${tentative}/${total} : ${verdict.message}`);
    log(`  ${journal[journal.length - 1]}`);
    if (verdict.ok) return { ok: true, journal };
    if (tentative < total) await dormir(delai);
  }
  return { ok: false, journal };
}

/**
 * @param {object} [options]
 * @param {string} [options.base] Site interrogé (défaut `SITE_ORIGIN`).
 * @returns {{ok: boolean, erreur: string|null}} `erreur` : le refus d'invoquer.
 */
export function baseAutorisée(base) {
  const propre = String(base ?? '').trim().replace(/\/+$/, '');
  if (!propre) return { ok: false, erreur: 'aucune base à interroger' };
  if (isLoopbackUrl(propre)) {
    return {
      ok: false,
      erreur:
        `base locale (${propre}) : ce garde mesure la PRODUCTION (ce que Vercel sert) ; ` +
        "un build de poste ne dit rien de la révision déployée.",
    };
  }
  return { ok: true, erreur: null };
}

/**
 * Lit les options de la ligne de commande, sans jamais conclure sur du vide.
 *
 * @param {string[]} argv Arguments (sans `node`/le script).
 * @returns {{base: string, attendues: string[], tentatives: number, delai: number}}
 */
export function lireOptions(argv = []) {
  const valeurDe = (nom) => {
    const index = argv.indexOf(nom);
    return index === -1 ? '' : String(argv[index + 1] ?? '');
  };
  const nombreDe = (nom, défaut) => {
    const brut = valeurDe(nom);
    return brut ? Number(brut) : défaut;
  };
  const { valides, invalides } = revisionsAttendues([valeurDe('--attendu'), valeurDe('--sinon')]);
  if (invalides.length) {
    throw new Error(
      `--attendu/--sinon ne sont pas des identifiants de commit (${invalides
        .map((v) => JSON.stringify(v))
        .join(', ')}) : ce garde compare la révision servie à un commit, il ne peut pas ` +
        'conclure sans lui.'
    );
  }
  if (valides.length === 0) {
    throw new Error(
      '--attendu manquant : passer le commit poussé (et `--sinon` le dernier commit ayant ' +
        'touché frontend/) — sans quoi rien ne dit à quoi comparer la production.'
    );
  }
  return {
    base: valeurDe('--base') || SITE_ORIGIN,
    attendues: valides,
    tentatives: nombreDe('--tentatives', 9),
    delai: nombreDe('--delai', 20),
  };
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = lireOptions(argv);
  } catch (error) {
    console.error(`::error title=Frontend servi — invocation impossible::${error.message}`);
    return 2;
  }

  const base = baseAutorisée(options.base);
  if (!base.ok) {
    console.error(`::error title=Frontend servi — invocation impossible::${base.erreur}`);
    return 2;
  }

  console.log(`Révisions acceptées : ${options.attendues.map((r) => r.slice(0, 12)).join(' ou ')}`);
  console.log(`Interrogation de ${options.base}/…`);
  const { ok, journal } = await verifierServie(options);
  if (ok) {
    console.log(
      `::notice title=Frontend servi::${journal[journal.length - 1]} — le site sert bien un ` +
        'artefact construit depuis main.'
    );
    return 0;
  }

  const dernier = journal[journal.length - 1] || 'aucune tentative';
  if (dernier.includes('AUCUNE révision')) {
    console.log(`::error title=Révision du frontend non annoncée::${dernier}`);
  } else if (dernier.includes('aucune réponse exploitable')) {
    console.log(`::error title=Frontend injoignable::${dernier}`);
  } else {
    console.log(`::error title=Révision du frontend ≠ attendue::${dernier}`);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
