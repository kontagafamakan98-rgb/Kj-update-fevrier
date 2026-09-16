#!/usr/bin/env node
/**
 * Rapport de taille du bundle publié en COMMENTAIRE de PR.
 *
 * POURQUOI : `check-bundle-size.js` est un garde binaire — il dit « dans les
 * budgets » ou « budget dépassé ». Il ne dit pas *combien* un changement coûte,
 * et ses seuils sont larges (~30-40 % de marge) : une PR qui ajoute 20 Ko au
 * chemin critique reste verte et personne ne le voit avant la fusion. Ce script
 * publie les trois mesures réelles avec leur ÉCART, pour que l'effet d'un
 * changement soit lisible AVANT le merge.
 *
 * Il NE mesure rien lui-même : il réutilise `checkBundleSize()` (source unique
 * de vérité pour la mesure), et ne fait que comparer et mettre en forme. Deux
 * implémentations de la mesure divergeraient.
 *
 * DEUX COMPARAISONS, chacune étiquetée explicitement (jamais de substitution
 * silencieuse) :
 *   • RÉFÉRENCE — la dernière mesure de `main`, transportée par le cache
 *     Actions (clé `bundle-size-baseline-*`). C'est « l'effet de cette PR par
 *     rapport à la base ».
 *   • PRÉCÉDENTE — la mesure publiée par le commentaire précédent de CETTE PR
 *     (charge utile JSON embarquée dans le commentaire). C'est « ce qui a
 *     changé depuis le dernier push », utile pour itérer.
 * Si l'une des deux manque, la colonne correspondante est OMISE et sa raison
 * est dite dans le commentaire — un écart affiché sans référence serait pire
 * qu'aucun écart.
 *
 * Usage :
 *   node scripts/bundle-size-report.js \
 *     --baseline .bundle-size/baseline.json \
 *     --previous .bundle-size/previous.json \
 *     --out      .bundle-size/current.json \
 *     --markdown .bundle-size/comment.md \
 *     --summary  "$GITHUB_STEP_SUMMARY" \
 *     --post
 *
 * Sans `--post`, rien n'est envoyé : le script écrit la charge utile et le
 * Markdown (utilisable en local). `--post` exige `GITHUB_TOKEN`,
 * `GITHUB_REPOSITORY` et le numéro de PR (`PR_NUMBER` ou `GITHUB_EVENT_PATH`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BUDGETS, checkBundleSize } from './check-bundle-size.js';

// Marqueur d'unicité du commentaire : sert à le RETROUVER pour le mettre à jour
// au lieu d'en empiler un par push. Volontairement en HTML pour être invisible.
export const MARKER = '<!-- kojo-bundle-size -->';
// Marqueur de la charge utile machine (mesures du run), relue au run suivant
// pour la comparaison « précédente ».
export const PAYLOAD_MARKER = 'bundle-size-payload';
export const PAYLOAD_RE = /<!--\s*bundle-size-payload\s+(\{[\s\S]*?\})\s*-->/;

// Seuils d'INTERPRÉTATION de l'écart (pas des budgets : ceux-ci restent dans
// check-bundle-size.js). En dessous de NEGLIGIBLE, l'écart est du bruit
// d'arrondi/compression et n'est pas signalé.
export const NEGLIGIBLE_BYTES = 1024; // 1 Ko
export const NOTABLE_PERCENT = 5; // 5 % de la référence

const fmtKo = (bytes) => `${(bytes / 1024).toFixed(1).replace('.', ',')} Ko`;
const fmtMo = (bytes) => `${(bytes / 1024 / 1024).toFixed(2).replace('.', ',')} Mo`;

/**
 * Formate un écart signé. `null` si la référence est absente.
 *
 * @param {number} value    Valeur courante (octets).
 * @param {number} [base]   Valeur de référence (octets).
 * @returns {{bytes: number, percent: number|null, text: string, verdict: string}|null}
 */
export const formatDelta = (value, base) => {
  if (typeof base !== 'number' || Number.isNaN(base)) return null;
  const bytes = value - base;
  const percent = base === 0 ? null : (bytes / base) * 100;
  const sign = bytes > 0 ? '+' : bytes < 0 ? '−' : '±';
  const magnitude = fmtKo(Math.abs(bytes));
  const percentText = percent === null ? '—' : `${percent > 0 ? '+' : percent < 0 ? '−' : '±'}${Math.abs(percent).toFixed(1).replace('.', ',')} %`;

  let verdict = 'neutre';
  if (Math.abs(bytes) < NEGLIGIBLE_BYTES) verdict = 'négligeable';
  else if (bytes < 0) verdict = 'gain';
  else if (percent !== null && percent >= NOTABLE_PERCENT) verdict = 'notable';
  else verdict = 'faible';

  return {
    bytes,
    percent,
    text: `${sign}${magnitude}`,
    percentText,
    verdict,
  };
};

const VERDICT_ICON = {
  négligeable: '✅',
  gain: '🟢',
  faible: '🟡',
  notable: '🔴',
  neutre: '✅',
};

/**
 * Réduit un `stats` de checkBundleSize à la charge utile transportable :
 * trois agrégats + le détail du chemin critique (pour le repli du commentaire).
 *
 * @param {object} stats
 * @param {object} [meta] Contexte du run (référence git, date).
 */
export const buildPayload = (stats, meta = {}) => ({
  version: 1,
  generatedAt: new Date().toISOString(),
  ref: meta.ref || '',
  sha: meta.sha || '',
  initialGzip: stats.initialGzip,
  largestChunk: stats.largest
    ? { file: stats.largest.file, gzip: stats.largest.gzip, raw: stats.largest.raw }
    : null,
  totalRaw: stats.totalRaw,
  initialChunks: (stats.initialChunks || []).map((c) => ({ file: c.file, gzip: c.gzip, raw: c.raw })),
});

const tryJson = (text) => {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_e) {
    return null;
  }
};

/**
 * Lit une charge utile depuis un objet, un FICHIER (JSON, ou corps de
 * commentaire contenant la charge utile embarquée), ou un texte de commentaire.
 *
 * Retourne `null` si absente ou illisible : une référence corrompue ne doit pas
 * faire échouer le rapport — elle disparaît, AVEC sa raison affichée dans le
 * commentaire (jamais d'écart calculé contre une référence douteuse).
 *
 * @param {string|object|null|undefined} source
 * @returns {object|null}
 */
export const readPayload = (source) => {
  if (!source) return null;
  if (typeof source === 'object') return source;
  const text = String(source);
  if (existsSync(text)) {
    const content = readFileSync(text, 'utf8');
    return tryJson(content) || extractPayload(content);
  }
  return extractPayload(text);
};

/**
 * Extrait la charge utile embarquée dans un corps de commentaire.
 * @param {string} body
 * @returns {object|null}
 */
export const extractPayload = (body) => {
  const match = PAYLOAD_RE.exec(String(body || ''));
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_e) {
    return null;
  }
};

const label = (payload, fallback) => {
  if (!payload) return fallback;
  const short = (payload.sha || '').slice(0, 7);
  const date = payload.generatedAt ? payload.generatedAt.replace('T', ' ').slice(0, 16) : '';
  if (payload.ref && short) return `\`${payload.ref}\` @ ${short}${date ? ` (${date} UTC)` : ''}`;
  if (short) return `${short}${date ? ` (${date} UTC)` : ''}`;
  return date || fallback;
};

/**
 * Construit le corps Markdown du commentaire.
 *
 * @param {object} args
 * @param {object} args.current   Charge utile courante.
 * @param {object|null} [args.baseline] Mesure de `main` (référence).
 * @param {object|null} [args.previous] Mesure précédente de cette PR.
 * @param {string} [args.baselineReason] Pourquoi la référence manque.
 * @param {string} [args.previousError] Pourquoi la mesure précédente manque.
 * @returns {string}
 */
export const renderMarkdown = ({ current, baseline = null, previous = null, baselineReason = '', previousError = '' }) => {
  const rows = [
    { label: '**JS initial** (gzip)', value: current.initialGzip, base: baseline?.initialGzip, prev: previous?.initialGzip, fmt: fmtKo },
    {
      label: '**Plus gros chunk** (gzip)',
      value: current.largestChunk?.gzip ?? null,
      base: baseline?.largestChunk?.gzip,
      prev: previous?.largestChunk?.gzip,
      fmt: fmtKo,
    },
    { label: '**Build total** (brut)', value: current.totalRaw, base: baseline?.totalRaw, prev: previous?.totalRaw, fmt: fmtMo },
  ];

  const cell = (row, base) => {
    if (row.value === null || typeof row.value !== 'number') return '—';
    if (typeof base !== 'number') return '—';
    const delta = formatDelta(row.value, base);
    return `${VERDICT_ICON[delta.verdict]} ${delta.text} (${delta.percentText})`;
  };

  const hasBaseline = !!baseline && typeof baseline.initialGzip === 'number';
  const hasPrevious = !!previous && typeof previous.initialGzip === 'number';

  const header = ['| Mesure | Cette PR | Référence | Écart vs référence |'];
  const align = ['|---|---|---|---|'];
  if (hasPrevious) {
    header[0] += ' Écart vs précédente |';
    align[0] += '---|';
  }

  const lines = [MARKER, '### 📦 Taille du bundle', ''];
  lines.push(
    hasBaseline
      ? `Référence : **${label(baseline, 'main')}**.`
      : `Référence indisponible${baselineReason ? ` (${baselineReason})` : ''} — aucun écart ne peut être calculé pour cette PR : c'est une **première mesure**.`
  );
  if (hasPrevious) lines.push(`Mesure précédente de cette PR : ${label(previous, '—')}.`);
  else if (previousError) lines.push(`⚠️ Mesure précédente de cette PR non relue (${previousError}) — colonne omise.`);
  lines.push('');
  lines.push(header[0]);
  lines.push(align[0]);
  for (const row of rows) {
    const cells = [row.label, row.value === null ? '—' : row.fmt(row.value), hasBaseline ? row.fmt(row.base) : '—', cell(row, row.base)];
    if (hasPrevious) cells.push(cell(row, row.prev));
    lines.push(`| ${cells.join(' | ')} |`);
  }

  lines.push('');
  lines.push(
    `Budgets (\`check-bundle-size.js\`) : JS initial ≤ ${fmtKo(BUDGETS.initialGzip)} · plus gros chunk ≤ ${fmtKo(BUDGETS.largestChunkGzip)} · build total ≤ ${fmtMo(BUDGETS.totalRaw)}.`
  );
  lines.push(
    current.largestChunk?.file
      ? `Le plus gros chunk du build est \`${current.largestChunk.file}\`. Il compte dans son budget même s'il n'est pas chargé par la route d'entrée.`
      : 'Aucun chunk JS trouvé dans le build.'
  );
  lines.push('');
  lines.push('Légende : 🟢 gain · ✅ écart négligeable (< 1 Ko) · 🟡 faible · 🔴 ≥ 5 % d\'augmentation.');
  lines.push('');

  const detail = current.initialChunks || [];
  if (detail.length) {
    lines.push('<details><summary>Détail du chemin critique (chunks référencés par <code>index.html</code>)</summary>');
    lines.push('');
    lines.push('| Chunk | gzip | brut |');
    lines.push('|---|---|---|');
    for (const c of [...detail].sort((a, b) => b.gzip - a.gzip)) {
      lines.push(`| \`${c.file}\` | ${fmtKo(c.gzip)} | ${fmtKo(c.raw)} |`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  // Charge utile machine : invisible dans le rendu, relue au run suivant pour
  // la comparaison « précédente ».
  lines.push(`<!-- ${PAYLOAD_MARKER} ${JSON.stringify(current)} -->`);
  return lines.join('\n');
};

/**
 * Publie (ou met à jour) le commentaire de PR portant le marqueur.
 *
 * Cherche d'abord un commentaire EXISTANT contenant le marqueur : sans ça,
 * chaque push empilerait un commentaire et la PR deviendrait illisible. Si le
 * corps est identique, ne fait rien (évite un PATCH inutile et une notification).
 *
 * @param {object} args
 * @param {string} args.body          Corps Markdown.
 * @param {string} args.repo          `owner/name`.
 * @param {number|string} args.issueNumber Numéro de PR.
 * @param {string} args.token         Jeton GitHub.
 * @param {Function} [args.fetchImpl] `fetch` injectable (tests).
 * @param {string} [args.apiBase]
 * @param {boolean} [args.dryRun]     N'envoie rien, retourne l'action calculée.
 * @returns {Promise<{action: string, id: number|null}>}
 */
export const postOrUpdateComment = async ({
  body,
  repo,
  issueNumber,
  token,
  fetchImpl = fetch,
  apiBase = 'https://api.github.com',
  dryRun = false,
}) => {
  const headers = {
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'kojo-bundle-size/1.0',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  };

  const listRes = await fetchImpl(
    `${apiBase}/repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
    { headers }
  );
  if (!listRes.ok) {
    throw new Error(`liste des commentaires HTTP ${listRes.status}`);
  }
  const comments = (await listRes.json()) || [];
  if (!Array.isArray(comments)) throw new Error('réponse GitHub inattendue (pas une liste)');

  const existing = comments.find((c) => typeof c?.body === 'string' && c.body.includes(MARKER));
  if (existing && String(existing.body).trim() === String(body).trim()) {
    return { action: 'inchangé', id: existing.id ?? null };
  }
  if (dryRun) return { action: existing ? 'aurait été mis à jour' : 'aurait été créé', id: existing?.id ?? null };

  if (existing?.id) {
    const res = await fetchImpl(`${apiBase}/repos/${repo}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`mise à jour du commentaire HTTP ${res.status}`);
    return { action: 'mis à jour', id: existing.id };
  }

  const res = await fetchImpl(`${apiBase}/repos/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`création du commentaire HTTP ${res.status}`);
  const created = await res.json();
  return { action: 'créé', id: created?.id ?? null };
};

/**
 * Relit la mesure publiée par le commentaire PRÉCÉDENT de cette PR.
 *
 * C'est ce qui permet de dire « écart par rapport au run précédent » : la
 * charge utile JSON embarquée dans le commentaire marqué est réextraite ici.
 * Un échec d'API ne fait PAS échouer le rapport (le commentaire reste utile
 * sans cette colonne) mais est remonté pour être affiché.
 *
 * @returns {Promise<{payload: object|null, error: string}>}
 */
export const fetchPriorPayload = async ({
  repo,
  issueNumber,
  token,
  fetchImpl = fetch,
  apiBase = 'https://api.github.com',
}) => {
  try {
    const res = await fetchImpl(
      `${apiBase}/repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'kojo-bundle-size/1.0',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
        },
      }
    );
    if (!res.ok) return { payload: null, error: `liste des commentaires HTTP ${res.status}` };
    const comments = (await res.json()) || [];
    if (!Array.isArray(comments)) return { payload: null, error: 'réponse GitHub inattendue (pas une liste)' };
    const prior = comments.find((c) => typeof c?.body === 'string' && c.body.includes(MARKER));
    if (!prior) return { payload: null, error: '' };
    const payload = extractPayload(prior.body);
    return {
      payload,
      error: payload ? '' : 'commentaire précédent trouvé mais charge utile illisible',
    };
  } catch (err) {
    return { payload: null, error: `lecture du commentaire précédent échouée (${err.message})` };
  }
};

/**
 * Lit le numéro de PR : variable explicite, sinon l'événement GitHub.
 * @returns {number|null}
 */
export const resolvePrNumber = (env = process.env) => {
  if (env.PR_NUMBER) return Number(env.PR_NUMBER);
  if (env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH)) {
    try {
      const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
      const num = event?.pull_request?.number ?? event?.issue?.number;
      if (num) return Number(num);
    } catch (_e) {
      return null;
    }
  }
  return null;
};

export const parseArgs = (argv = process.argv.slice(2)) => {
  const args = { out: '', baseline: '', previous: '', markdown: '', summary: '', post: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i] || '';
    else if (a === '--baseline') args.baseline = argv[++i] || '';
    else if (a === '--previous') args.previous = argv[++i] || '';
    else if (a === '--markdown') args.markdown = argv[++i] || '';
    else if (a === '--summary') args.summary = argv[++i] || '';
    else if (a === '--post') args.post = true;
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
};

/**
 * Chaîne complète : mesurer → comparer → rendre → écrire → (publier).
 *
 * @param {object} [options]
 * @param {string} [options.root]     Racine frontend (contient `build/`).
 * @param {object} [options.args]    Arguments parsés.
 * @param {object} [options.env]
 * @param {Function} [options.fetchImpl]
 * @param {boolean} [options.quiet]
 * @returns {Promise<{ok: boolean, errors: string[], payload: object|null, markdown: string, posted: object|null}>}
 */
export const runReport = async ({ root, args = parseArgs(), env = process.env, fetchImpl = fetch, quiet = false } = {}) => {
  const log = (...a) => {
    if (!quiet) console.log(...a);
  };
  const errors = [];

  const measured = checkBundleSize({ root, quiet: true });
  if (!measured.stats) {
    return { ok: false, errors: measured.errors, payload: null, markdown: '', posted: null };
  }

  const payload = buildPayload(measured.stats, { ref: env.GITHUB_REF_NAME || '', sha: env.GITHUB_SHA || '' });
  const baseline = readPayload(args.baseline);
  const issueNumber = resolvePrNumber(env);

  // Mesure précédente : fichier fourni, sinon le commentaire précédent de CETTE
  // PR (relu par le script lui-même, pour ne pas dupliquer une extraction dans
  // le workflow).
  let previous = readPayload(args.previous);
  let previousError = '';
  if (!previous && args.previous) {
    previousError = `fichier illisible (${args.previous})`;
  } else if (!previous && issueNumber && env.GITHUB_TOKEN && env.GITHUB_REPOSITORY) {
    const prior = await fetchPriorPayload({
      repo: env.GITHUB_REPOSITORY,
      issueNumber,
      token: env.GITHUB_TOKEN,
      fetchImpl,
    });
    previous = prior.payload;
    previousError = prior.error;
  }

  const baselineReason = !args.baseline
    ? 'aucune référence fournie'
    : !existsSync(args.baseline)
      ? 'aucune mesure de `main` en cache'
      : 'référence illisible';

  const markdown = renderMarkdown({ current: payload, baseline, previous, baselineReason, previousError });

  if (args.out) {
    mkdirSync(path.dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    log(`Mesures écrites : ${args.out}`);
  }
  if (args.markdown) {
    mkdirSync(path.dirname(args.markdown), { recursive: true });
    writeFileSync(args.markdown, `${markdown}\n`, 'utf8');
    log(`Commentaire écrit : ${args.markdown}`);
  }
  if (args.summary) {
    appendFileSync(args.summary, `${markdown}\n`, 'utf8');
    log(`Résumé de run complété : ${args.summary}`);
  }
  if (!args.markdown) log(markdown);

  let posted = null;
  if (args.post) {
    if (!issueNumber) {
      log('Pas de numéro de PR (push sur main ou dispatch) — aucun commentaire publié.');
    } else if (!env.GITHUB_TOKEN) {
      errors.push('GITHUB_TOKEN absent — commentaire non publié');
    } else {
      posted = await postOrUpdateComment({
        body: markdown,
        repo: env.GITHUB_REPOSITORY,
        issueNumber,
        token: env.GITHUB_TOKEN,
        fetchImpl,
        dryRun: args.dryRun,
      });
      log(`Commentaire : ${posted.action}${posted.id ? ` (#${posted.id})` : ''}`);
    }
  }

  return { ok: errors.length === 0, errors, payload, markdown, posted };
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = await runReport();
  if (!result.ok) {
    console.error('\n❌ Rapport de taille en échec :');
    for (const e of result.errors) console.error(`   • ${e}`);
    process.exit(1);
  }
}
