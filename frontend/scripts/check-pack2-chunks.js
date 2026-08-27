#!/usr/bin/env node
/**
 * Régression « chunk partagé pack2PageI18n » : après `vite build`, aucun
 * chunk PARTAGÉ ne doit contenir les dictionnaires de scopes.
 *
 * Contexte : pack2PageI18n a été découpé par scope (src/utils/pack2PageI18n/)
 * — chaque page lazy importe UNIQUEMENT son propre dictionnaire (<scope>.js)
 * + les helpers partagés (core.js, ~1,6 kB). Avant ce découpage, le module
 * monolithique embarquait TOUS les dictionnaires dans un chunk partagé de
 * ~60 kB chargé par toutes les pages secondaires.
 *
 * Un chunk de page peut légitimement contenir PLUSIEURS scopes (sa page +
 * ses composants : JobDetails + JobReviews = 2 ; Login + Register partagent
 * le scope register = 1 ; l'entrée porte les scopes des pages eager = 2).
 * Le VRAI signal de régression — le monolithe ou une fusion de dictionnaires
 * — est un chunk contenant ≥ 3 scopes DIFFÉRENTS : aucun bundle légitime
 * n'en regroupe trois, alors qu'un module monolithique (ou une fusion
 * partielle) en porterait beaucoup.
 *
 * Méthode : marqueurs fr distinctifs par scope extraits des SOURCES, puis
 * scan des chunks buildés (le maximum de scopes distincts par chunk est
 * compté). Les chaînes littérales ne sont pas minifiées dans les bundles →
 * scan fiable.
 *
 * Budget de poids : chaque dictionnaire de scope est mesuré (somme des
 * octets UTF-8 de ses valeurs de traduction, toutes langues, dédupliquées —
 * c'est exactement ce qui part dans le chunk de page : les littéraux ne sont
 * pas minifiés). Si un scope dépasse le budget (PACK2_SCOPE_BUDGET_BYTES,
 * défaut 20 000), le check échoue : un dictionnaire trop gros re-monte le
 * poids du chunk de sa page et mérite d'être audité.
 *
 * Exécuté dans le job CI frontend-build, après `vite build`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

// ── Exports réutilisables (tests unitaires) ────────────────────────────────

// Valeurs de dictionnaire : chaînes citées de ≥ 20 caractères, mono-lignes,
// sans fragments de code (aucune parenthèse/égalité). Les apostrophes
// échappées (\') sont résolues — sinon un "l\'emploi" couperait la valeur.
export const extractCandidates = (src) =>
  [...src.matchAll(/'((?:[^'\\\n]|\\.){20,})'/g)]
    .map((m) => m[1].replace(/\\'/g, "'"))
    .filter((v) => !/[({=<>]/.test(v));

const stripComments = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// Toutes les chaînes citées ≥ 3 octets (après résolution des \'), hors
// fragments de code, hors noms de langue ('fr'/'en'/'wo'/'bm'/'mos') —
// le payload de traduction réellement embarqué dans le chunk de page.
export const extractScopePayload = (src) => {
  const clean = stripComments(src);
  const seen = new Set();
  const values = [];
  for (const m of clean.matchAll(/'((?:[^'\\\n]|\\.){3,})'/g)) {
    const v = m[1].replace(/\\'/g, "'");
    if (/[({=<>]/.test(v)) continue;
    if (['fr', 'en', 'wo', 'bm', 'mos'].includes(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    values.push(v);
  }
  return values;
};

export const scopePayloadBytes = (scopeSrc) =>
  extractScopePayload(scopeSrc).reduce((sum, v) => sum + Buffer.byteLength(v, 'utf8'), 0);

// Estimation gzip du payload (les littéraux sont compressés dans le chunk).
export const scopePayloadGzipBytes = (scopeSrc) =>
  gzipSync(extractScopePayload(scopeSrc).join('\n'), { level: 9 }).length;

export const scopeBudgetBytes = () => {
  const raw = Number(process.env.PACK2_SCOPE_BUDGET_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 20000;
};

// ── Check principal (exécuté uniquement en CLI, pas à l'import) ────────────
const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

export const runPack2Check = (opts = {}) => {
  const rootDir = opts.root || process.cwd();
  const pack2Dir = path.join(rootDir, 'src', 'utils', 'pack2PageI18n');
  const assetsDir = path.join(rootDir, 'build', 'assets');

  const errors = [];

  // ── 1. Marqueurs fr uniques par scope (depuis les SOURCES) ─────────────
  let scopeNames = [];
  try {
    scopeNames = readdirSync(pack2Dir).filter((f) => f.endsWith('.js') && f !== 'core.js');
  } catch {
    errors.push(`src/utils/pack2PageI18n/ introuvable (${pack2Dir}) — le découpage par scope a-t-il été supprimé ?`);
  }

  const sources = new Map(); // scope -> contenu source
  for (const f of scopeNames) {
    try {
      sources.set(f.replace(/\.js$/, ''), readFileSync(path.join(pack2Dir, f), 'utf8'));
    } catch {
      errors.push(`Impossible de lire ${f}`);
    }
  }

  const markers = {}; // scope -> [marqueurs distinctifs]
  for (const [scope, src] of sources) {
    const otherSources = [...sources.entries()]
      .filter(([name]) => name !== scope)
      .map(([, s]) => s);
    const unique = extractCandidates(src).filter(
      (v) => !otherSources.some((s) => s.includes(v))
    );
    if (!unique.length) {
      errors.push(`Scope "${scope}" : aucun marqueur distinctif trouvé — impossible de détecter sa présence dans les chunks`);
      continue;
    }
    markers[scope] = unique.sort((a, b) => b.length - a.length).slice(0, 3);
  }

  // ── 2. Détection : ≥ 3 scopes distincts dans un même chunk ─────────────
  let chunkFiles = [];
  try {
    chunkFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
  } catch {
    errors.push(`build/assets/ introuvable (${assetsDir}) — le build a-t-il tourné ?`);
  }

  const scopeByMarker = {};
  for (const [scope, ms] of Object.entries(markers)) {
    for (const m of ms) scopeByMarker[m] = scope;
  }

  const offenders = [];
  for (const file of chunkFiles) {
    const src = readFileSync(path.join(assetsDir, file), 'utf8');
    const present = new Set();
    for (const m of Object.keys(scopeByMarker)) {
      if (src.includes(m)) present.add(scopeByMarker[m]);
    }
    if (present.size >= 3) {
      offenders.push(`${file} (dictionnaires de ${present.size} scopes : [${[...present].join(', ')}])`);
    }
  }

  if (offenders.length) {
    errors.push(
      `Chunk(s) portant ${offenders.length} fusion(s) de dictionnaires pack2PageI18n : ${offenders.join(' | ')}. ` +
        'Un bundle légitime ne regroupe jamais ≥ 3 scopes — le monolithe pack2PageI18n (ou une fusion partielle) est réapparu.'
    );
  }

  // ── 3. Poids réel de chaque dictionnaire de scope + budget ─────────────
  const budget = opts.budget || scopeBudgetBytes();
  const report = []; // scope -> { raw, gzip }
  for (const [scope, src] of sources) {
    const raw = scopePayloadBytes(src);
    const gzip = scopePayloadGzipBytes(src);
    report.push({ scope, raw, gzip });
    if (raw > budget) {
      errors.push(
        `Scope "${scope}" : dictionnaire de ${raw} octets (${gzip} gzip) > budget ` +
          `${budget} octets (PACK2_SCOPE_BUDGET_BYTES). Réduire les traductions ou scinder le scope.`
      );
    }
  }
  report.sort((a, b) => b.raw - a.raw);

  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  const table = [
    'Poids des dictionnaires pack2PageI18n (payload réel embarqué par chunk de page) :',
    ...report.map(
      ({ scope, raw, gzip }) =>
        `  ${scope.padEnd(22)} ${kb(raw).padStart(9)} raw  ${kb(gzip).padStart(9)} gzip`
    ),
  ].join('\n');
  console.log(table);

  if (errors.length) {
    console.error('❌ Régression chunk pack2PageI18n — ' + errors.length + ' problème(s) :');
    for (const e of errors) console.error('  ' + e);
    return { ok: false, errors, report };
  }
  console.log(
    `✅ Aucun chunk partagé pack2PageI18n : ${scopeNames.length} scopes découpés, ${chunkFiles.length} chunks buildés, aucun chunk commun portant des dictionnaires, aucun dépassement de budget.`
  );
  return { ok: true, errors, report };
};

if (isDirectRun) {
  const result = runPack2Check();
  if (!result.ok) process.exit(1);
}
