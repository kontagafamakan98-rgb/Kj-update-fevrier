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
 *   2. `POST /v10/projects/{id}/env?upsert=true` pour chaque variable FOURNIE,
 *      cible `production` ET `preview` — une preview sans la balise ferait
 *      échouer l'audit sur les PR, et `upsert` rend la commande rejouable (elle
 *      met à jour au lieu d'échouer en « already exists »). L'unité d'écriture
 *      est la VARIABLE : une valeur non fournie laisse les autres passer et se
 *      nomme en `::warning` (décision du 20/09/2026, voir INTEGRATIONS) ;
 *   3. `POST /v13/deployments` avec `deploymentId` du dernier déploiement de
 *      production : Vercel réutilise ses réglages et les variables DU PROJET
 *      telles qu'elles sont à cet instant (c'est le seul moyen de prendre en
 *      compte un changement de `VITE_*` sans pousser de commit) ;
 *   4. attend `READY`, puis relit le HTML servi avec la MÊME sonde que la CI
 *      (`check-seo-production.js`) et ÉCHOUE si une intégration FOURNIE n'est
 *      pas visible. Un déploiement `READY` ne prouve pas que la balise est là.
 *
 * ── Le verdict ──────────────────────────────────────────────────────────────
 *   0 : tout ce qui a été fourni est posé ET visible dans le HTML servi (les
 *       intégrations non fournies sont nommées en avertissement — la sonde
 *       STRICTE de production reste le gate qui rougit tant qu'elles manquent) ;
 *   1 : une valeur fournie n'a pas atterri (écriture refusée, forme refusée,
 *       déploiement en erreur, ou absente du HTML après déploiement) ;
 *   2 : rien n'a pu être tenté (jeton absent, ou aucune valeur fournie).
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
import { INTEGRATIONS as SONDE, runSeoProductionReport } from './check-seo-production.js';
import { SITE_ORIGIN } from './site-meta.js';

const API = 'https://api.vercel.com';
const ENV_TARGETS = ['production', 'preview'];
const COMMENT = 'SEO production (scripts/check-seo-production.js → setup-seo-env.js)';
// « G- » + au moins 4 caractères : c'est la forme d'un ID de flux GA4. Un ID de
// propriété UA ou une chaîne quelconque produirait une balise qui ne remonte
// rien, et l'audit dirait « PRÉSENT » sur une balise morte.
const GA4_SHAPE = /^G-[A-Z0-9]{4,}$/;

/**
 * ── L'unité d'écriture est la VARIABLE, pas le lot ────────────────────────
 * Et la liste des variables n'est PAS écrite ici : elle est LUE sur la sonde
 * (`INTEGRATIONS` de check-seo-production.js), qui possède ce que « PRÉSENT »
 * veut dire. Déclarer une seconde table ici aurait suffi à faire diverger le
 * libellé vérifié du libellé publié — deux copies d'un même fait, la classe de
 * défaut que ce dépôt supprime depuis des semaines.
 *
 * ── Pourquoi l'écriture n'est PAS tout-ou-rien (décision du 20/09/2026) ───
 * Elle l'a été, et ça a coûté deux semaines : la valeur de Search Console est
 * fournie (`KOJO_GSC_VERIFICATION`, secret créé le 18/09) et n'a JAMAIS atteint
 * la production, parce que `KOJO_GA_MEASUREMENT_ID` manquait — les deux
 * workflows lancés les 18 et 19/09 ont refusé d'écrire la moitié disponible, au
 * motif qu'un état à moitié posé serait « un rouge silencieux côté audit ». Or
 * ce rouge-là n'a rien de silencieux : la sonde nomme l'intégration manquante,
 * chaque jour.
 * Ce qui doit être interdit, c'est d'écrire une valeur ABSENTE (une chaîne vide
 * remplacerait la configuration en place par du vide), et c'est déjà vérifié
 * **par variable**. Coupler deux intégrations indépendantes n'ajoutait aucune
 * sécurité — seulement un livrable bloqué par son voisin.
 *
 * Les deux propriétés qui restent tenues : rien n'est écrit sans valeur, et
 * **rien n'est tu** : chaque intégration laissée de côté est nommée en
 * `::warning` avec la variable à fournir, et la sonde STRICTE de production
 * reste le gate qui rougit tant qu'une intégration requise manque.
 */
/**
 * La forme attendue d'une valeur, par `key` de la sonde. Ce qui est une
 * politique d'ÉCRITURE vit ici ; ce qui est un fait de la sonde (libellé,
 * variable, caractère obligatoire) se lit là-bas.
 *
 * Une intégration requise à variable unique absente de cette table serait
 * posée sans contrôle de forme : c'est visible (elle est écrite puis vérifiée
 * par la sonde), jamais silencieux.
 */
const FORMES = { ga4: GA4_SHAPE };

/**
 * Ce que cette commande sait poser : les intégrations REQUISES de la sonde
 * qu'une variable unique active.
 *
 * Le filtre écarte `VITE_SOCIAL_*` (plusieurs variables, géré au build) sans
 * avoir à le nommer : l'important est qu'aucun libellé ni aucune variable Vercel
 * ne soit recopié ici. C'est la sonde qui possède ce que « PRÉSENT » veut dire —
 * et c'est son libellé, mot pour mot, que la vérification attend en retour.
 */
export const INTEGRATIONS = SONDE.filter(
  (item) => item.required && /^VITE_[A-Z0-9_]+$/.test(item.env)
).map((item) => ({
  label: item.label,
  vercelKey: item.env,
  // Convention du dépôt : le secret GitHub porte le nom de la variable Vercel
  // sans son préfixe `VITE_` (mesuré sur KOJO_GSC_VERIFICATION / VITE_GSC_…).
  envKey: `KOJO_${item.env.replace(/^VITE_/, '')}`,
  shape: FORMES[item.key] || null,
}));

/**
 * Ce qui rend la commande IMPOSSIBLE — et rien d'autre.
 *
 * Le jeton, toujours. Et une valeur à poser : sans aucune valeur fournie, la
 * commande n'aurait qu'un déploiement à produire sans rien changer.
 */
export function blockingInputs(env = process.env, { dryRun = false } = {}) {
  const problems = [];
  if (!String(env.VERCEL_TOKEN || '').trim()) {
    problems.push('VERCEL_TOKEN manquant — jeton Vercel ayant accès au projet (Settings → Tokens).');
  }
  if (!dryRun && !INTEGRATIONS.some((item) => String(env[item.envKey] || '').trim())) {
    problems.push(
      'aucune valeur à poser — fournir au moins ' +
        INTEGRATIONS.map((item) => item.envKey).join(' ou ') +
        ' (poser les deux est l’état attendu).'
    );
  }
  return problems;
}

/**
 * Le plan, par variable : ce qui sera écrit, ce qui est absent, et ce qui est
 * fourni mais inutilisable (forme refusée — jamais écrit, jamais avalé).
 *
 * `absent` reste un AVERTISSEMENT (la sonde stricte en fait un rouge) ; une
 * valeur fournie mais mal formée reste une ERREUR, parce que l'opérateur croit
 * l'avoir donnée : elle empêche l'écriture de CETTE variable et fait échouer la
 * commande.
 */
export function planWrites(env = process.env) {
  const writes = [];
  const absent = [];
  const invalid = [];
  for (const item of INTEGRATIONS) {
    const value = String(env[item.envKey] || '').trim();
    if (!value) {
      absent.push(`${item.label} : ${item.envKey} non fourni — cette intégration ne sera pas posée.`);
      continue;
    }
    if (item.shape && !item.shape.test(value)) {
      invalid.push(
        `${item.envKey} « ${value} » n'a pas la forme attendue (${item.shape}) — écrit tel quel, il produirait ` +
          'une balise morte que la sonde annoncerait « PRÉSENT ».'
      );
      continue;
    }
    writes.push(envPayload(item.vercelKey, value));
  }
  return { writes, absent, invalid };
}

/** Les libellés de la sonde qui doivent dire « PRÉSENT » après le déploiement. */
export const REQUIRED_AFTER_DEPLOY = INTEGRATIONS.map((item) => item.label);

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
/** L'entrée de la table qui possède cette clé Vercel (le libellé de la sonde). */
function itemPour(vercelKey) {
  return INTEGRATIONS.find((item) => item.vercelKey === vercelKey);
}

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

/** Relit le HTML servi jusqu'à ce que les intégrations ÉCRITES y soient. */
async function verifyServedHtml({ base, required, attempts = 5, waitMs = 20000, log = console.log }) {
  let problems = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runSeoProductionReport({ base });
    problems = verifyIntegrations(result.notices, required);
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

  const blocking = blockingInputs(env, { dryRun });
  if (blocking.length > 0) {
    error(dryRun ? '✗ Il manque de quoi interroger Vercel :' : '✗ Rien n’a pu être tenté — aucune écriture :');
    for (const problem of blocking) error(`   • ${problem}`);
    error(
      dryRun
        ? '\nRelancer avec le jeton Vercel : VERCEL_TOKEN=vcp_… node scripts/setup-seo-env.js --dry-run'
        : '\nPuis : KOJO_GA_MEASUREMENT_ID=G-… KOJO_GSC_VERIFICATION=… VERCEL_TOKEN=vcp_… node scripts/setup-seo-env.js'
    );
    return 2;
  }

  const { writes, absent, invalid } = planWrites(env);
  for (const problem of invalid) error(`✗ ${problem}`);
  for (const skip of absent) {
    log(`::warning title=Intégration non fournie::${skip} — elle ne sera PAS posée, et la sonde stricte reste rouge tant qu'elle manque.`);
  }

  const project = await vercelApi(`/v9/projects/${encodeURIComponent(projectName)}`, { token, teamId });
  log(`Projet Vercel : ${project.name} (${project.id})${teamId ? ` — équipe ${teamId}` : ''}`);

  const existing = await vercelApi(`/v10/projects/${project.id}/env?decrypt=false`, { token, teamId });
  const keys = new Set((existing?.envs || []).map((item) => item.key));
  for (const write of writes) {
    log(`   ${write.key} : ${keys.has(write.key) ? 'déjà posée → sera mise à jour' : 'absente → sera créée'}`);
  }
  log(`   ${writes.length}/${INTEGRATIONS.length} intégration(s) à poser dans cette exécution.`);

  if (dryRun) {
    log('\n--dry-run : aucune écriture, aucun déploiement. Charges utiles prévues :');
    for (const write of writes) {
      // Valeur masquée : les deux premiers caractères suffisent à reconnaître
      // « une valeur est bien là » sans la publier dans les logs du run.
      const shown = `${write.value.slice(0, 3)}… (${write.value.length} caractères)`;
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

  // Ce qui est vérifié, c'est ce qui a été ÉCRIT : une intégration non fournie
  // n'est pas un échec de cette commande (elle est déjà nommée en amont, et
  // c'est la sonde stricte qui en fait un rouge).
  const labels = writes.map((write) => itemPour(write.key).label);
  const remaining = await verifyServedHtml({ base, required: labels, log });
  if (remaining.length > 0) {
    error('\n✗ Le déploiement est passé, mais le HTML servi ne porte pas ce qu’il devait :');
    for (const problem of remaining) error(`   • ${problem}`);
    error('   Piste : la variable est peut-être limitée à un environnement (elle doit viser production ET preview), ou le build a échoué sans changer l’alias.');
    return 1;
  }
  log(`\n✓ ${labels.join(' + ')} dans le HTML de production, et les autres sondes sont inchangées.`);

  // Le reste est NOMMÉ, pas tu : c'est la sonde stricte de production qui est le
  // gate, pas cette commande. Ce qui, en revanche, fait échouer la commande,
  // c'est une valeur FOURNIE mais inutilisable : l'opérateur croit l'avoir
  // donnée, donc il n'y a rien à lire ailleurs — ça doit être bruyant ici.
  const restantes = INTEGRATIONS.filter(
    (item) => !writes.some((write) => write.key === item.vercelKey)
  );
  if (restantes.length > 0) {
    log(
      `!! ${restantes.length}/${INTEGRATIONS.length} intégration(s) NON POSÉE(S) ici, faute de valeur : ` +
        restantes.map((item) => `${item.label} (${item.envKey})`).join(', ') +
        ' — la sonde STRICTE de production reste ROUGE tant qu’elles manquent.'
    );
  }
  if (invalid.length > 0) {
    error(
      `\n✗ ${invalid.length} valeur(s) fournie(s) mais refusée(s) : ce qui a été posé l’est, ` +
        'mais l’état attendu reste incomplet — corriger la valeur et relancer.'
    );
    return 1;
  }
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
