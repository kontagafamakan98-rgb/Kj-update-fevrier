#!/usr/bin/env node
/**
 * Pose les DEUX variables SEO sur Vercel (GA4 + jeton Search Console),
 * redéploie la production, puis VÉRIFIE le HTML servi — une seule commande.
 *
 * ── Pourquoi ce script ──────────────────────────────────────────────────────
 * Ces deux valeurs ne vivent que dans Vercel → Settings → Environment
 * Variables : elles n'existent ni dans le dépôt, ni sur Fly, et aucune
 * commande du dépôt ne pouvait les poser. Poser une variable ne suffit pas —
 * les `VITE_*` sont INLINÉES au build, donc il faut REDÉPLOYER, puis relire le
 * HTML servi. Trois étapes qu'on oublie, dans cet ordre, et dont l'oubli se lit
 * comme un bug de code (l'audit reste rouge sur la balise GA4).
 *
 * ── Ce que fait chaque étape, et pourquoi ───────────────────────────────────
 *   1. résout le projet par son NOM (`VERCEL_PROJECT_NAME`), pour utiliser son
 *      `id` ensuite : le nom suffit aux endpoints Vercel, mais l'id évite de
 *      dépendre du slug du compte (équipe perso ou équipe) ;
 *   2. `POST /v10/projects/{id}/env?upsert=true` pour chaque variable, cible
 *      `production` ET `preview` — une preview sans la balise ferait échouer
 *      l'audit sur les PR, et `upsert` rend la commande rejouable (elle met à
 *      jour au lieu d'échouer en « already exists ») ;
 *   3. `POST /v13/deployments` avec `deploymentId` du dernier déploiement de
 *      production : Vercel réutilise ses réglages et les variables DU PROJET
 *      telles qu'elles sont à cet instant (c'est le seul moyen de prendre en
 *      compte un changement de `VITE_*` sans pousser de commit) ;
 *   4. attend `READY`, puis relit le HTML servi avec la MÊME sonde que la CI
 *      (`check-seo-production.js`) et ÉCHOUE si les deux intégrations ne sont
 *      pas visibles. Un déploiement `READY` ne prouve pas que la balise est là.
 *
 * ── `type: 'encrypted'`, pas `sensitive` ────────────────────────────────────
 * Mesuré : une variable `sensitive` n'est plus relisible par l'API (ni par ce
 * script, ni par un futur diagnostic) alors qu'elle finit de toute façon en
 * clair dans `/assets/index-*.js` — la valeur est inlinée dans le bundle. On ne
 * protège donc rien et on perd la seule vérification possible.
 *
 * Usage :
 *   KOJO_GA_MEASUREMENT_ID=G-XXXXXXXXXX KOJO_GSC_VERIFICATION=jeton \
 *   VERCEL_TOKEN=vcp_… node scripts/setup-seo-env.js
 *
 *   … --dry-run          lectures seules : projet, variables déjà posées,
 *                        dernier déploiement, charges utiles qui SERAIENT
 *                        envoyées (aucune écriture, aucun déploiement) ;
 *   … --project <nom>    projet Vercel (défaut VERCEL_PROJECT_NAME ou
 *                        'kj-update-fevrier') ;
 *   … --team <id>        équipe Vercel, si le projet n'est pas sur le compte ;
 *   … --base <url>       origine à sonder (défaut SITE_ORIGIN) ;
 *   … --timeout <s>      attente maximale du déploiement (défaut 600).
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSeoProductionReport } from './check-seo-production.js';
import { SITE_ORIGIN } from './site-meta.js';

const API = 'https://api.vercel.com';
const GA_KEY = 'VITE_GA_MEASUREMENT_ID';
const GSC_KEY = 'VITE_GSC_VERIFICATION';
const ENV_TARGETS = ['production', 'preview'];
const COMMENT = 'SEO production (scripts/check-seo-production.js → setup-seo-env.js)';
// « G- » + au moins 4 caractères : c'est la forme d'un ID de flux GA4. Un ID de
// propriété UA ou une chaîne quelconque produirait une balise qui ne remonte
// rien, et l'audit dirait « PRÉSENT » sur une balise morte.
const GA4_SHAPE = /^G-[A-Z0-9]{4,}$/;

/** Ce qui manque pour que la commande puisse s'exécuter. Vide = prête. */
export function missingInputs(env = process.env, { dryRun = false } = {}) {
  const problems = [];
  const ga = String(env.KOJO_GA_MEASUREMENT_ID || '').trim();
  const gsc = String(env.KOJO_GSC_VERIFICATION || '').trim();
  if (!String(env.VERCEL_TOKEN || '').trim()) {
    problems.push('VERCEL_TOKEN manquant — jeton Vercel ayant accès au projet (Settings → Tokens).');
  }
  if (dryRun) return problems;
  if (!ga) problems.push('KOJO_GA_MEASUREMENT_ID manquant — identifiant de flux GA4, de la forme G-XXXXXXXXXX.');
  else if (!GA4_SHAPE.test(ga)) problems.push(`KOJO_GA_MEASUREMENT_ID « ${ga} » n'a pas la forme d'un identifiant GA4 (G-…).`);
  if (!gsc) problems.push('KOJO_GSC_VERIFICATION manquant — le contenu de la balise google-site-verification de Search Console.');
  return problems;
}

/** Les libellés de la sonde qui doivent dire « PRÉSENT » après le déploiement. */
export const REQUIRED_AFTER_DEPLOY = ['Google Analytics 4', 'Search Console (balise meta)'];

/**
 * Les deux intégrations posées sont-elles RÉELLEMENT dans le HTML servi ?
 *
 * Un `::notice` de la sonde suffit à lire l'état ; il ne suffit pas à décider.
 * Ici on tranche : ce qui n'est pas « PRÉSENT » devient une erreur, avec le
 * texte exact publié — jamais un « déployé, donc c'est bon ».
 */
export function verifyIntegrations(notices, required = REQUIRED_AFTER_DEPLOY) {
  const report = notices.join('\n');
  const problems = [];
  for (const label of required) {
    const line = notices.find((notice) => notice.startsWith(label));
    if (!line) problems.push(`${label} : aucune ligne dans le rapport de la sonde.`);
    else if (!line.includes('PRÉSENT')) problems.push(`${label} : ${line}`);
  }
  if (!report.includes('intégration(s) présente(s)')) {
    problems.push('la sonde n’a publié aucun décompte — base locale ou accueil illisible.');
  }
  return problems;
}

/** Appel REST Vercel : renvoie le JSON, ou lève avec le message de l'API. */
export async function vercelApi(route, { method = 'GET', body, token, teamId, timeout = 30000 } = {}) {
  const url = new URL(API + route);
  if (teamId) url.searchParams.set('teamId', teamId);
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (_error) {
    /* réponse non JSON : le texte brut sert de diagnostic */
  }
  if (!response.ok) {
    const detail = payload?.error?.message || text.slice(0, 200);
    throw new Error(`${method} ${route} → HTTP ${response.status} : ${detail}`);
  }
  return payload;
}

/** Charge utile d'écriture d'une variable (une par clé, upsert). */
export function envPayload(key, value) {
  return { key, value, type: 'encrypted', target: ENV_TARGETS, comment: COMMENT };
}

/**
 * Déploie jusqu'à `READY`, en imprimant chaque changement d'état.
 *
 * `deploymentId` : Vercel reprend les réglages de ce déploiement et les
 * variables telles qu'elles sont au moment du build — c'est ce qui rend le
 * changement de `VITE_*` effectif sans nouveau commit.
 */
export async function redeployAndWait({ project, token, teamId, timeoutMs = 600000, pollMs = 15000, log = console.log }) {
  const list = await vercelApi(`/v6/deployments?projectId=${encodeURIComponent(project.id)}&target=production&limit=1`, { token, teamId });
  const previous = (list?.deployments || [])[0];
  if (!previous) throw new Error('aucun déploiement de production à partir duquel redéployer.');
  const previousId = previous.uid || previous.id;
  log(`↻ Redéploiement depuis ${previousId} (${previous.url || 'URL inconnue'})…`);
  const created = await vercelApi('/v13/deployments', {
    method: 'POST',
    token,
    teamId,
    body: { name: project.name, deploymentId: previousId, target: 'production', withLatestCommit: true },
  });
  const deadline = Date.now() + timeoutMs;
  let state = created?.readyState || 'QUEUED';
  log(`   déploiement ${created?.id} → ${state}`);
  while (!['READY', 'ERROR', 'CANCELED'].includes(state)) {
    if (Date.now() > deadline) throw new Error(`déploiement ${created?.id} toujours en ${state} après ${Math.round(timeoutMs / 1000)} s.`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const current = await vercelApi(`/v13/deployments/${created.id}`, { token, teamId });
    if (current.readyState !== state) log(`   ${current.readyState}`);
    state = current.readyState;
    if (state === 'ERROR' || state === 'CANCELED') {
      throw new Error(`déploiement ${created.id} en ${state} : ${current?.errorMessage || 'sans message'}`);
    }
    if (state === 'READY') return { id: created.id, url: current.url || created.url, state };
  }
  return { id: created.id, url: created.url, state };
}

/** Relit le HTML servi jusqu'à ce que les deux intégrations y soient. */
async function verifyServedHtml({ base, attempts = 5, waitMs = 20000, log = console.log }) {
  let problems = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runSeoProductionReport({ base });
    problems = verifyIntegrations(result.notices);
    log(`\n── HTML servi (${base}) — lecture ${attempt}/${attempts} ──`);
    for (const notice of result.notices) log(`::notice title=SEO production::${notice}`);
    if (problems.length === 0) return [];
    if (attempt < attempts) log(`   … pas encore au vert, nouvel essai dans ${waitMs / 1000} s.`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return problems;
}

export async function runSetup({
  env = process.env,
  argv = process.argv.slice(2),
  log = console.log,
  error = console.error,
} = {}) {
  const flag = (name, fallback = null) => {
    const index = argv.indexOf(name);
    return index === -1 ? fallback : argv[index + 1];
  };
  const dryRun = argv.includes('--dry-run');
  const token = String(env.VERCEL_TOKEN || '').trim();
  const teamId = flag('--team', String(env.VERCEL_TEAM_ID || '').trim() || null);
  const projectName = flag('--project', String(env.VERCEL_PROJECT_NAME || '').trim() || 'kj-update-fevrier');
  const base = String(flag('--base', SITE_ORIGIN)).replace(/\/+$/, '');
  const timeoutMs = Number(flag('--timeout', '600')) * 1000;

  const problems = missingInputs(env, { dryRun });
  if (problems.length > 0) {
    error(dryRun ? '✗ Il manque de quoi interroger Vercel :' : '✗ Il manque une valeur — rien n’a été écrit :');
    for (const problem of problems) error(`   • ${problem}`);
    error(
      dryRun
        ? '\nRelancer avec le jeton Vercel : VERCEL_TOKEN=vcp_… node scripts/setup-seo-env.js --dry-run'
        : '\nPuis : KOJO_GA_MEASUREMENT_ID=G-… KOJO_GSC_VERIFICATION=… VERCEL_TOKEN=vcp_… node scripts/setup-seo-env.js'
    );
    return 2;
  }

  const ga = String(env.KOJO_GA_MEASUREMENT_ID || '').trim();
  const gsc = String(env.KOJO_GSC_VERIFICATION || '').trim();
  const project = await vercelApi(`/v9/projects/${encodeURIComponent(projectName)}`, { token, teamId });
  log(`Projet Vercel : ${project.name} (${project.id})${teamId ? ` — équipe ${teamId}` : ''}`);

  const existing = await vercelApi(`/v10/projects/${project.id}/env?decrypt=false`, { token, teamId });
  const keys = new Set((existing?.envs || []).map((item) => item.key));
  for (const key of [GA_KEY, GSC_KEY]) {
    log(`   ${key} : ${keys.has(key) ? 'déjà posée → sera mise à jour' : 'absente → sera créée'}`);
  }

  const writes = [envPayload(GA_KEY, ga), envPayload(GSC_KEY, gsc)];
  if (dryRun) {
    log('\n--dry-run : aucune écriture, aucun déploiement. Charges utiles prévues :');
    for (const write of writes) {
      // En --dry-run les valeurs peuvent être absentes : on montre alors QUELLE
      // variable sera posée, plutôt qu'un masque vide qui ne dit rien.
      const shown = write.value
        ? `${write.value.slice(0, 6)}… (${write.value.length} caractères)`
        : `<valeur de ${write.key.replace('VITE_', 'KOJO_')}>`;
      log(`   POST /v10/projects/${project.id}/env?upsert=true ${JSON.stringify({ ...write, value: shown })}`);
    }
    const list = await vercelApi(`/v6/deployments?projectId=${encodeURIComponent(project.id)}&target=production&limit=1`, { token, teamId });
    const previous = (list?.deployments || [])[0];
    log(`   POST /v13/deployments ${JSON.stringify({ name: project.name, deploymentId: previous?.uid || previous?.id, target: 'production', withLatestCommit: true })}`);
    log(`\n✓ Commandes vérifiées jusqu’aux écritures (dernier déploiement de production : ${previous?.url || 'inconnu'}).`);
    return 0;
  }

  for (const write of writes) {
    const result = await vercelApi(`/v10/projects/${project.id}/env?upsert=true`, { method: 'POST', token, teamId, body: write });
    if (result?.failed?.length) {
      throw new Error(`écriture refusée pour ${write.key} : ${result.failed[0]?.error?.message || 'sans détail'}`);
    }
    log(`✓ ${write.key} posée (${result?.created?.id || 'mise à jour'}) sur ${ENV_TARGETS.join(', ')}`);
  }

  const deployment = await redeployAndWait({ project, token, teamId, timeoutMs, log });
  log(`✓ Déploiement ${deployment.state} — ${deployment.url}`);

  const remaining = await verifyServedHtml({ base, log });
  if (remaining.length > 0) {
    error('\n✗ Le déploiement est passé, mais le HTML servi ne porte pas ce qu’il devait :');
    for (const problem of remaining) error(`   • ${problem}`);
    error('   Piste : la variable est peut-être limitée à un environnement (elle doit viser production ET preview), ou le build a échoué sans changer l’alias.');
    return 1;
  }
  log('\n✓ GA4 et la meta Search Console sont dans le HTML de production, et les autres sondes sont inchangées.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runSetup();
  } catch (failure) {
    console.error(`✗ ${failure.message}`);
    process.exitCode = 1;
  }
}
