#!/usr/bin/env node
/**
 * Contrat app ↔ pré-rendu d'une FICHE MISSION (/jobs/:id) — HORS LIGNE.
 *
 * Les routes statiques ont `check-page-meta.js` : il compare ce que
 * l'application déclare (src/config/page-meta.js + src/config/og-cards.js) à ce
 * que les coquilles pré-rendues publient dans le HTML, sur des FICHIERS — donc
 * sans serveur. Une fiche mission n'avait pas d'équivalent : son titre et sa
 * carte n'étaient vérifiés qu'en HTTP (`check-og-images.js`, qui le dit
 * lui-même : « leur carte est vérifiée en HTTP »), contre un serveur debout et
 * une mission réellement créée en base. Deux conséquences : le contrat n'était
 * jamais vérifié sur une PR dont le pré-déploiement est protégé, et surtout il
 * n'était JAMAIS comparé à ce que l'application annonce — un titre renommé d'un
 * seul côté passait (l'onglet du navigateur et la carte de partage ne disaient
 * plus la même chose).
 *
 * Ce garde exécute les DEUX implémentations sur la même mission de référence :
 *
 *   • le PRÉ-RENDU : il importe `backend/kojo_job_og.py` avec un interpréteur
 *     Python quelconque (le module n'a aucune dépendance : ni FastAPI, ni
 *     MongoDB, ni kojo_settings) et lui donne la mission en JSON. C'est du code
 *     de production exécuté, pas un motif cherché dans un source ;
 *   • l'APPLICATION : il appelle `src/utils/jobSeo.js`, la fonction que
 *     `JobDetails` utilise pour annoncer la même mission.
 *
 * Puis il exige l'égalité — titre, description, carte — et la présence des deux
 * cartes du pré-rendu (la variante carrée que les réseaux qui recadrent en 1:1
 * lisent).
 *
 * INTERPRÉTEUR : le module étant sans dépendance, n'importe quel Python convient
 * (venv du dépôt, `python3`, `python`). En CI, l'image du runner en fournit un —
 * donc l'absence d'interpréteur y est une ERREUR, pas un silence : un garde qui
 * ne s'exécute pas ne garde rien. Hors CI, c'est un ::notice (un poste sans
 * Python ne doit pas voir rouge pour cette seule raison).
 *
 * Usage : cd frontend && node scripts/check-job-og-contract.js
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { jobSeo } from '../src/utils/jobSeo.js';
import { metaContent, metaContents } from './site-meta.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');

/** Module de production du pré-rendu d'une fiche mission (stdlib uniquement). */
export const PRERENDER_MODULE = 'backend/kojo_job_og.py';

/**
 * Mission de référence — UNE définition, donnée aux deux côtés.
 *
 * Elle porte ce que le contrat doit traverser sans se perdre : une apostrophe
 * typographique et un « & » (les deux sont ÉCHAPPÉS dans le HTML, donc le garde
 * doit décoder ce qu'un crawler lit, pas comparer des entités), et une
 * description de plus de 150 caractères (la coupe et le « … » font partie du
 * contrat : les deux côtés doivent couper au même endroit).
 */
export const FIXTURE_JOB = {
  id: '11111111-1111-4111-8111-111111111111',
  title: "Réparation d'une fuite & rebouchage du plafond",
  description:
    "Fuite lente au plafond du salon, sous la salle de bain : tache qui s'agrandit " +
    "depuis une semaine, placo gonfle au-dessus de la porte-fenetre. Il faut localiser " +
    "l'origine, ouvrir proprement, reparer la canalisation et reboucher avant peinture.",
};

/** Interpréteurs candidats : explicite, puis le venv du dépôt, puis le PATH. */
export const PYTHON_CANDIDATES = [
  process.env.PYTHON,
  path.join(REPO_ROOT, 'backend', '.venv', 'Scripts', 'python.exe'),
  path.join(REPO_ROOT, 'backend', '.venv', 'bin', 'python'),
  'python3',
  'python',
].filter(Boolean);

/**
 * Programme passé à `-c` : importe le module de production et écrit son HTML.
 * Le dossier du backend et la base arrivent en argv, la mission sur stdin —
 * donc aucun échappement de coquille, et la mission n'est écrite qu'une fois
 * (dans FIXTURE_JOB).
 */
const PRERENDER_SCRIPT = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'from kojo_job_og import job_og_html',
  'sys.stdout.write(job_og_html(json.load(sys.stdin), sys.argv[2]))',
].join('\n');

/**
 * HTML pré-rendu d'une mission, produit par le code de production.
 *
 * @returns {{html: string, error: string}} `html` vide si l'exécution échoue.
 */
export const renderPrerenderedPage = ({ python, job = FIXTURE_JOB, base, root = REPO_ROOT } = {}) => {
  const result = spawnSync(python, ['-c', PRERENDER_SCRIPT, path.join(root, 'backend'), base], {
    cwd: root,
    input: JSON.stringify(job),
    encoding: 'utf8',
    // Sans cela, Python écrit sur la sortie standard avec l'encodage de la LOCALE
    // (cp1252 sous Windows) : le tiret cadratin et le « … » du pré-rendu
    // revenaient en caractères de remplacement, et le garde accusait le backend
    // d'un écart de texte qui n'existait pas. Constaté au premier essai.
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    timeout: 20000,
  });
  if (result.error) return { html: '', error: `exécution de ${python} impossible (${result.error.message})` };
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().split('\n').pop() || '';
    return { html: '', error: `${python} a échoué (code ${result.status}) ${detail}` };
  }
  return { html: String(result.stdout || ''), error: '' };
};

/** Premier interpréteur capable d'importer le module de production, ou null. */
export const findPython = ({ root = REPO_ROOT, candidates = PYTHON_CANDIDATES, base = '' } = {}) => {
  if (!existsSync(path.join(root, PRERENDER_MODULE))) return null;
  for (const candidate of candidates) {
    const { html, error } = renderPrerenderedPage({ python: candidate, base, root });
    if (!error && html) return candidate;
  }
  return null;
};

/** Les 5 entités qu'écrit escape_xml (backend/kojo_job_og.py). */
const ENTITIES = [
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&apos;', "'"],
  ['&amp;', '&'],
];

/**
 * Ce qu'un crawler LIT réellement d'une balise : la valeur décodée. Le
 * pré-rendu échappe le titre et la description (`&apos;`, `&amp;`…), donc
 * comparer les valeurs brutes ferait échouer le garde sur du texte correct —
 * ou, pire, pousserait à retirer l'échappement du HTML pour faire passer le test.
 */
export const decodeEntities = (value) =>
  ENTITIES.reduce((text, [entity, char]) => text.split(entity).join(char), String(value || ''));

/** Texte de `<title>`, décodé. */
export const htmlTitle = (html) => decodeEntities((/<title>([^<]*)<\/title>/i.exec(String(html)) || [])[1]);

/**
 * Confronte ce que l'application annonce à ce que le pré-rendu publie.
 *
 * PUR (aucune exécution, aucun accès disque) : c'est ce qui permet de prouver
 * qu'il SAIT échouer, en lui donnant deux côtés divergents sans toucher au
 * dépôt.
 *
 * @param {object} options
 * @param {{title: string, description: string, card: string}} options.app Valeur de `jobSeo`.
 * @param {string} options.html HTML pré-rendu de la MÊME mission.
 * @param {string} options.base Origine servant le pré-rendu (`https://…`).
 * @returns {string[]} Problèmes trouvés (vide = contrat tenu).
 */
export const compareJobOg = ({ app, html, base }) => {
  const errors = [];
  const title = htmlTitle(html);
  const description = decodeEntities(metaContent(html, 'description'));
  const images = metaContents(html, 'og:image');
  const expectedWide = app.card ? `${base}${app.card}` : '';
  // La variante carrée est dérivée de la carte de l'APPLICATION : c'est le
  // pré-rendu qui doit annoncer la paire, et une carte renommée d'un seul côté
  // fait donc échouer les deux assertions au lieu d'en laisser passer une.
  const expectedSquare = expectedWide ? expectedWide.replace(/\.png$/, '-square.png') : '';

  if (!app.title) errors.push("l'application n'annonce AUCUN titre pour cette mission");
  if (title !== app.title) {
    errors.push(`titre : le pré-rendu annonce « ${title} », l'application « ${app.title} »`);
  }
  if (description !== app.description) {
    errors.push(
      `description : le pré-rendu annonce ${description.length} caractères, l'application ` +
        `${app.description.length} — « ${description} » ≠ « ${app.description} »`
    );
  }
  if (images[0] !== expectedWide) {
    errors.push(`carte wide : le pré-rendu annonce « ${images[0] || '(absente)'} », l'application « ${expectedWide} »`);
  }
  if (!expectedSquare || images[1] !== expectedSquare) {
    errors.push(
      `carte carrée : le pré-rendu annonce « ${images[1] || '(absente)'} » au lieu de ` +
        `« ${expectedSquare} » — les réseaux qui recadrent en 1:1 liraient une image absente`
    );
  }
  for (const [key, expected] of [
    ['og:title', app.title],
    ['twitter:title', app.title],
    ['og:description', app.description],
    ['twitter:description', app.description],
  ]) {
    const found = decodeEntities(metaContent(html, key));
    if (found !== expected) {
      errors.push(`${key} : le pré-rendu annonce « ${found} », l'application « ${expected} »`);
    }
  }
  const twitterImage = metaContents(html, 'twitter:image')[0] || '';
  if (twitterImage !== expectedWide) {
    errors.push(`twitter:image : le pré-rendu annonce « ${twitterImage} », l'application « ${expectedWide} »`);
  }
  return errors;
};

/**
 * @param {{root?: string, base?: string, quiet?: boolean}} [opts]
 * @returns {{ok: boolean, errors: string[], notices: string[], checked: string[], python: string}}
 */
export const runJobOgContractCheck = (opts = {}) => {
  const root = opts.root || REPO_ROOT;
  const base = opts.base || 'https://kojoforafrica.cc.cd';
  const log = opts.quiet ? () => {} : console.log;
  const logError = opts.quiet ? () => {} : console.error;

  const errors = [];
  const notices = [];
  const checked = [];

  const python = findPython({ root, base, candidates: PYTHON_CANDIDATES });
  if (!python) {
    const message =
      `aucun interpréteur Python capable d'importer ${PRERENDER_MODULE} ` +
      `(essayés : ${PYTHON_CANDIDATES.join(', ')}) — le contrat app ↔ pré-rendu de /jobs/:id ` +
      `n'a donc PAS été vérifié`;
    // En CI l'image du runner fournit python3 : ne pas l'avoir là est une panne,
    // pas une excuse. Hors CI, un poste sans Python ne doit pas voir rouge.
    if (process.env.CI) errors.push(message);
    else {
      notices.push(message);
      logError(`::notice title=Contrat /jobs/:id non vérifié::${message}`);
    }
    return { ok: errors.length === 0, errors, notices, checked, python: '' };
  }

  const { html, error } = renderPrerenderedPage({ python, base, root });
  if (error) errors.push(error);

  const app = jobSeo(FIXTURE_JOB);
  if (!error) {
    for (const problem of compareJobOg({ app, html, base })) errors.push(problem);
  }

  checked.push(`  interpréteur     ${python} → ${PRERENDER_MODULE} (aucune dépendance)`);
  checked.push(`  mission          ${FIXTURE_JOB.id} (« ${FIXTURE_JOB.title} »)`);
  checked.push(`  titre            « ${app.title} »`);
  checked.push(`  description      ${app.description.length} caractères, coupe et « … » des deux côtés`);
  checked.push(`  carte            ${base}${app.card} + variante carrée -square.png`);
  checked.push('  og:/twitter:     titre et description identiques sur les quatre balises');

  if (errors.length > 0) {
    logError(`❌ Contrat app ↔ pré-rendu de /jobs/:id NON tenu (${errors.length} problème(s)) :`);
    for (const message of errors) logError(`   • ${message}`);
    logError(
      `   → le HTML pré-rendu vient de backend/${path.basename(PRERENDER_MODULE)}, ce que l'application ` +
        `annonce de src/utils/jobSeo.js (utilisé par src/pages/JobDetails.js). Corriger le côté FAUTIF : ` +
        `les deux doivent annoncer la même chose, sinon un crawler de partage lit autre chose que l'onglet.`
    );
    return { ok: false, errors, notices, checked, python };
  }

  log(checked.join('\n'));
  log(
    `✅ Contrat /jobs/:id tenu hors ligne : titre, description et carte identiques entre ` +
      `l'application et le pré-rendu (aucun serveur, aucune base de données).`
  );
  return { ok: true, errors, notices, checked, python };
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = runJobOgContractCheck();
  if (!result.ok) process.exit(1);
}
