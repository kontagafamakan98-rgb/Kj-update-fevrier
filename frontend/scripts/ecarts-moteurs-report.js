#!/usr/bin/env node
/**
 * Tableau des écarts par moteur publié en COMMENTAIRE de PR.
 *
 * POURQUOI : le tableau des écarts est déjà calculé et écrit par
 * `e2e/helpers/moteurs.js` (via le `globalTeardown`) et déposé par
 * `e2e/reporters/ecarts-moteurs.js` dans `playwright-report/ecarts-moteurs.md`.
 * Il fallait donc TÉLÉCHARGER l'artefact pour le lire, et un artefact se
 * consulte APRÈS coup : au moment où l'on décide, c'est-à-dire pendant la
 * revue de la PR, personne ne l'avait sous les yeux. Ce script publie le MÊME
 * tableau en commentaire de PR — un seul commentaire, MIS À JOUR à chaque
 * push, pour que la PR reste lisible (même mécanique que le rapport de taille
 * du bundle : marqueur invisible + charge utile relue au run suivant).
 *
 * Il ne CALCULE rien : les relevés, les écarts et leur mise en ligne viennent
 * de `e2e/helpers/moteurs.js` (`lireLesReleves`, `calculerEcarts`,
 * `ligneDEcart`), et la publication vient de `bundle-size-report.js`
 * (`postOrUpdateComment`, `fetchPriorPayload`). Deux implémentations d'un même
 * écart, ou deux publications d'un même commentaire, divergeraient.
 *
 * DEUX différences assumées avec le rapport de taille :
 *   • il n'y a pas de « référence main » : ce tableau n'a de sens que pour
 *     l'exécution courante, donc la seule comparaison est « depuis le dernier
 *     push de CETTE PR », et son absence est DITE avec sa raison ;
 *   • un tableau VIDE ne se tait pas : « aucune mesure relevée sur deux
 *     moteurs » est publié avec le nombre de relevés lus — un vert sur une
 *     table vide ne dirait rien de son contenu.
 *
 * Usage :
 *   node scripts/ecarts-moteurs-report.js \
 *     --releves test-results/mesures-moteurs.jsonl \
 *     --table   test-results/ecarts-moteurs.md \
 *     --markdown .ecarts-moteurs/comment.md \
 *     --summary  "$GITHUB_STEP_SUMMARY" \
 *     --post
 *
 * `--post` exige `GITHUB_TOKEN`, `GITHUB_REPOSITORY` et le numéro de PR
 * (`PR_NUMBER` ou `GITHUB_EVENT_PATH`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { MOTEURS, calculerEcarts, ligneDEcart, lireLesReleves } from '../e2e/helpers/moteurs.js';
import { fetchPriorPayload, postOrUpdateComment, resolvePrNumber } from './bundle-size-report.js';

/** Marqueur d'unicité du commentaire (invisible) : sert à le METTRE À JOUR. */
export const MARKER = '<!-- kojo-ecarts-moteurs -->';

/** Marqueur de la charge utile machine, relue au push suivant. */
export const PAYLOAD_MARKER = 'ecarts-moteurs-payload';
export const PAYLOAD_RE = /<!--\s*ecarts-moteurs-payload\s+(\{[\s\S]*?\})\s*-->/;

/** Le fichier des relevés écrit par les trois projets (source du calcul). */
export const FICHIER_DES_RELEVES = path.resolve('test-results', 'mesures-moteurs.jsonl');

/** Le tableau publié par le teardown (ce que l'artefact contient). */
export const FICHIER_DU_TABLEAU = path.resolve('test-results', 'ecarts-moteurs.md');

/**
 * Plancher de LECTURE : en dessous de ce nombre de relevés, le tableau ne
 * compare rien. Il est publié quand même (avec le compte), mais un rapport qui
 * l'ignore laisserait croire que les moteurs s'accordent alors qu'on n'a rien
 * mesuré. Mesuré le 07/10/2026 sur l'exécution locale des trois projets : 4
 * parcours × 3 moteurs publient au moins 12 relevés.
 */
export const MIN_RELEVES = 6;

const formater = (valeur) => (typeof valeur === 'number' ? String(valeur) : valeur);

const valeurDe = (ligne, moteur) => ligne.valeurs.find((v) => v.moteur === moteur)?.valeur;

/**
 * La charge utile transportée par le commentaire : ce qu'il faut pour dire, au
 * push suivant, ce qui a CHANGÉ. Elle porte les valeurs par moteur, pas le
 * rendu (un rendu se re-génère, une mesure non).
 *
 * @param {{lignes: Array<object>, releves: number, moteurs: string[], meta?: object}} args
 */
export const buildPayload = ({ lignes, releves, moteurs, meta = {} }) => ({
  version: 1,
  generatedAt: new Date().toISOString(),
  ref: meta.ref || '',
  sha: meta.sha || '',
  releves,
  moteurs,
  mesures: lignes.map((ligne) => ({
    mesure: ligne.mesure,
    valeurs: Object.fromEntries(ligne.valeurs.map((v) => [v.moteur, v.valeur])),
    numerique: ligne.numerique,
    accord: ligne.accord,
    etendue: ligne.etendue,
    ecartRelatif: ligne.ecartRelatif,
  })),
});

/** La colonne « Écart » d'une ligne, en une cellule. */
const celluleEcart = (ligne) => {
  if (!ligne.numerique) return ligne.accord ? '✅ identique' : '⚠️ divergent';
  if (ligne.accord) return '✅ identique';
  const relatif = ligne.ecartRelatif === null ? 'n/a' : `${(ligne.ecartRelatif * 100).toFixed(1).replace('.', ',')} %`;
  return `⚠️ étendue ${ligne.etendue} (${relatif})`;
};

/**
 * Ce qui a bougé depuis le push précédent, en lignes lisibles.
 *
 * Une mesure dont une valeur a changé est NOMMÉE avec ses deux valeurs (avant →
 * après) ; une mesure dont le verdict (accord / divergence) a basculé sans que
 * les valeurs changent serait un défaut de comparaison et est signalée comme
 * telle. Sans charge utile précédente, la raison est écrite — jamais une
 * substitution silencieuse.
 *
 * @param {object} args
 * @param {object} args.current  Charge utile courante.
 * @param {object|null} [args.previous]
 * @param {string} [args.previousError]
 * @returns {string[]}
 */
export const lignesDuChangement = ({ current, previous = null, previousError = '' }) => {
  if (!previous) {
    return [
      previousError
        ? `⚠️ Comparaison avec le push précédent indisponible (${previousError}).`
        : 'ℹ️ Premier commentaire de cette PR : rien à comparer encore.',
    ];
  }
  const anciennes = new Map((previous.mesures || []).map((m) => [m.mesure, m]));
  const changements = [];
  for (const mesure of current.mesures || []) {
    const avant = anciennes.get(mesure.mesure);
    if (!avant) {
      changements.push(`➕ \`${mesure.mesure}\` — nouvelle mesure`);
      continue;
    }
    for (const [moteur, valeur] of Object.entries(mesure.valeurs)) {
      const precedente = avant.valeurs ? avant.valeurs[moteur] : undefined;
      if (precedente !== valeur) {
        changements.push(`• \`${mesure.mesure}\` — ${moteur} : ${formater(precedente)} → ${formater(valeur)}`);
      }
    }
    if (avant.accord !== mesure.accord && !changements.some((l) => l.includes(mesure.mesure))) {
      changements.push(
        `• \`${mesure.mesure}\` — verdict ${avant.accord ? 'accord' : 'divergence'} → ${
          mesure.accord ? 'accord' : 'divergence'
        } sans changement de valeur (à vérifier)`
      );
    }
  }
  for (const mesure of anciennes.keys()) {
    if (!(current.mesures || []).some((m) => m.mesure === mesure)) {
      changements.push(`➖ \`${mesure}\` — mesure disparue de ce run`);
    }
  }
  return changements.length ? changements : ['✅ Aucune mesure n’a changé depuis le dernier push.'];
};

/**
 * Le corps Markdown du commentaire.
 *
 * @param {object} args
 * @param {object} args.current Charge utile courante.
 * @param {Array<object>} args.lignes Les lignes de `calculerEcarts`.
 * @param {object|null} [args.previous]
 * @param {string} [args.previousError]
 * @param {string} [args.tableau] Chemin du tableau dans l'artefact (affiché).
 * @returns {string}
 */
export const renderMarkdown = ({ current, lignes, previous = null, previousError = '', tableau = '' }) => {
  const lignesTexte = [MARKER, '### 🧭 Écarts par moteur (Firefox + WebKit)', ''];

  const manquants = MOTEURS.filter((moteur) => !(current.moteurs || []).includes(moteur));
  lignesTexte.push(
    `Relevés : **${current.releves}** · moteurs vus : **${(current.moteurs || []).join(', ') || 'aucun'}**` +
      (tableau ? ` · tableau complet : \`${tableau}\`` : '')
  );
  if (manquants.length) {
    lignesTexte.push(
      `⚠️ Aucun relevé pour ${manquants.map((m) => `\`${m}\``).join(', ')} : ce moteur n’a pas tourné, ou rien ` +
        'publié — il n’est donc comparé à personne.'
    );
  }
  if (current.releves < MIN_RELEVES) {
    lignesTexte.push(
      `⚠️ Seulement **${current.releves}** relevé(s) lu(s) (plancher ${MIN_RELEVES}) : le tableau ne compare ` +
        'probablement rien, et un accord lu sur une table vide ne dit rien.'
    );
  }
  lignesTexte.push('');

  if (!lignes.length) {
    lignesTexte.push(
      'Aucune mesure relevée sur **deux moteurs** : un écart sur un seul point vaudrait zéro. ' +
        'Le tableau ne peut rien comparer pour ce run.'
    );
  } else {
    lignesTexte.push(`| Mesure | ${MOTEURS.map((m) => `\`${m}\``).join(' | ')} | Écart |`);
    lignesTexte.push(`|---|${MOTEURS.map(() => '---').join('|')}|---|`);
    for (const ligne of lignes) {
      const cellules = MOTEURS.map((moteur) => {
        const valeur = valeurDe(ligne, moteur);
        return valeur === undefined ? '—' : formater(valeur);
      });
      lignesTexte.push(`| \`${ligne.mesure}\` | ${cellules.join(' | ')} | ${celluleEcart(ligne)} |`);
    }
    const divergents = lignes.filter((l) => !l.accord);
    lignesTexte.push('');
    lignesTexte.push(
      `**${lignes.length - divergents.length}/${lignes.length}** mesure(s) identique(s) sur les moteurs` +
        (divergents.length ? ` — ${divergents.length} divergente(s).` : '.')
    );
    // La mise en ligne du JOURNAL est celle du harnais : si elle divergeait du
    // tableau, deux lecteurs liraient deux choses différentes. Repliée, elle ne
    // sert qu'à retrouver une ligne dans le journal du job.
    lignesTexte.push('');
    lignesTexte.push('<details><summary>Lignes du journal (même mise en forme que le teardown)</summary>');
    lignesTexte.push('');
    for (const ligne of lignes) lignesTexte.push(`- ${ligneDEcart(ligne)}`);
    lignesTexte.push('');
    lignesTexte.push('</details>');
  }

  lignesTexte.push('');
  lignesTexte.push('**Depuis le dernier push**');
  lignesTexte.push('');
  for (const ligne of lignesDuChangement({ current, previous, previousError })) lignesTexte.push(ligne);
  lignesTexte.push('');
  lignesTexte.push(
    'Légende : ⚠️ les moteurs diffèrent (une MESURE à lire, pas une régression — ce qui doit rougir est jugé par ' +
      'le cas lui-même) · ✅ identique.'
  );
  lignesTexte.push('');
  lignesTexte.push(`<!-- ${PAYLOAD_MARKER} ${JSON.stringify(current)} -->`);
  return lignesTexte.join('\n');
};

export const parseArgs = (argv = process.argv.slice(2)) => {
  const args = { releves: '', tableau: '', markdown: '', out: '', summary: '', post: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--releves') args.releves = argv[++i] || '';
    else if (a === '--table') args.tableau = argv[++i] || '';
    else if (a === '--markdown') args.markdown = argv[++i] || '';
    else if (a === '--out') args.out = argv[++i] || '';
    else if (a === '--summary') args.summary = argv[++i] || '';
    else if (a === '--post') args.post = true;
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
};

/**
 * Chaîne complète : lire les relevés → calculer les écarts → rendre → écrire →
 * (publier). Ne LÈVE pas sur une table vide : une table vide est un FAIT, qui
 * se publie avec son compte de relevés (le silence serait le seul faux vert).
 *
 * @param {object} [options]
 * @param {object} [options.args]
 * @param {object} [options.env]
 * @param {Function} [options.fetchImpl]
 * @param {boolean} [options.quiet]
 * @returns {Promise<{ok: boolean, errors: string[], payload: object, markdown: string, posted: object|null}>}
 */
export const runReport = async ({ args = parseArgs(), env = process.env, fetchImpl = fetch, quiet = false } = {}) => {
  const log = (...a) => {
    if (!quiet) console.log(...a);
  };
  const errors = [];

  const fichierReleves = args.releves || FICHIER_DES_RELEVES;
  const releves = existsSync(fichierReleves) ? lireLesReleves(fichierReleves) : [];
  if (!releves.length) {
    log(
      `⚠️  aucun relevé lu dans « ${fichierReleves} » : la suite a-t-elle tourné, et le teardown a-t-il publié ? ` +
        'Le commentaire dira ce vide plutôt que de se taire.'
    );
  }
  const moteurs = [...new Set(releves.map(({ moteur }) => moteur))].sort();
  const lignes = calculerEcarts(releves);
  const payload = buildPayload({
    lignes,
    releves: releves.length,
    moteurs,
    meta: { ref: env.GITHUB_REF_NAME || '', sha: env.GITHUB_SHA || '' },
  });

  const issueNumber = resolvePrNumber(env);
  let previous = null;
  let previousError = '';
  if (issueNumber && env.GITHUB_TOKEN && env.GITHUB_REPOSITORY) {
    const prior = await fetchPriorPayload({
      repo: env.GITHUB_REPOSITORY,
      issueNumber,
      token: env.GITHUB_TOKEN,
      fetchImpl,
      marker: MARKER,
      payloadRe: PAYLOAD_RE,
    });
    previous = prior.payload;
    previousError = prior.error;
  } else if (env.GITHUB_TOKEN) {
    previousError = 'pas de numéro de PR (push sur main ou dispatch)';
  } else {
    previousError = 'GITHUB_TOKEN absent';
  }

  const markdown = renderMarkdown({
    current: payload,
    lignes,
    previous,
    previousError,
    tableau: args.tableau || (existsSync(FICHIER_DU_TABLEAU) ? FICHIER_DU_TABLEAU : ''),
  });

  if (args.out) {
    mkdirSync(path.dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    log(`Charge utile écrite : ${args.out}`);
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
        marker: MARKER,
      });
      log(`Commentaire : ${posted.action}${posted.id ? ` (#${posted.id})` : ''}`);
    }
  }

  return { ok: errors.length === 0, errors, payload, markdown, posted };
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = await runReport();
  if (!result.ok) {
    console.error('\n❌ Rapport des écarts par moteur en échec :');
    for (const e of result.errors) console.error(`   • ${e}`);
    process.exit(1);
  }
}
