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
 * Ce garde exécute les DEUX implémentations sur CHACUNE des missions de référence
 * (`CONTRACT_JOBS`) :
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
 * lisent). L'URL de la page est comparée aussi (`canonical` et `og:url`) : c'est
 * celle que le crawler retient comme la bonne, donc elle divergerait du HTML
 * servi exactement de la même façon qu'un titre.
 *
 * ── Le jeu de référence, et pourquoi il existe ─────────────────────────────
 * L'UNITÉ de la coupe à 150 est ce qui a motivé le jeu : JavaScript compte des
 * unités UTF-16, Python des points de code, et les deux comptes coïncident tant
 * que le texte reste dans le plan multilingue de base — accents compris. Un
 * caractère ASTRAL les sépare. Le jeu place donc la frontière tour à tour sur un
 * accent, un emoji du plan de base, un astral, et avant un astral : le contrat
 * exige l'égalité des deux côtés, donc revenir à `slice` (unités UTF-16) le fait
 * rougir au lieu de publier un demi-caractère dans la balise.
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

import { DESCRIPTION_LIMIT, jobSeo } from '../src/utils/jobSeo.js';
import { canonicalHref, metaContent, metaContents } from './site-meta.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');

/** Module de production du pré-rendu d'une fiche mission (stdlib uniquement). */
export const PRERENDER_MODULE = 'backend/kojo_job_og.py';

/**
 * Insère `char` au (index + 1)ième POINT DE CODE de `text`.
 *
 * Sert à poser la frontière de la coupe exactement là où elle départage les deux
 * règles : au 150e point de code (`DESCRIPTION_LIMIT - 1`).
 */
const insertAtCodePoint = (text, index, char) => {
  const points = Array.from(text);
  return [...points.slice(0, index), char, ...points.slice(index)].join('');
};

/**
 * Les missions de RÉFÉRENCE du contrat — UNE définition, donnée aux deux côtés.
 *
 * Le jeu existe pour éprouver la coupe de la description LÀ OÙ LES DEUX LANGAGES
 * POURRAIENT COMPTER DIFFÉREMMENT : JavaScript compte des unités UTF-16 (`slice`,
 * `length`), Python des POINTS DE CODE (`[:150]`, `len`). Tant que le texte reste
 * dans le plan multilingue de base, les deux comptes COÏNCIDENT — les accents
 * compris, et c'est ce qui rendait la divergence invisible. Un caractère ASTRAL
 * (emoji hors BMP, deux unités UTF-16) les sépare : la coupe tombait un cran plus
 * tôt d'un côté, et au MILIEU de la paire de surrogates quand la frontière était
 * pile dessus — un demi-caractère publié dans la balise, donc deux descriptions
 * différentes selon le canal (l'onglet et la carte de partage). La frontière des
 * 150 est donc placée tour à tour sur un accent, sur un emoji du plan de base, sur
 * un astral, et avant un astral.
 *
 * Ce que chaque mission doit aussi traverser sans se perdre : une apostrophe
 * typographique et un « & » (les deux sont ÉCHAPPÉS dans le HTML, donc le garde
 * doit décoder ce qu'un crawler LIT au lieu de comparer des entités).
 */

// Description d'appui des cas de frontière : le 150e point de code y est le « è »
// de « gouttières » (mesuré, pas supposé — les tests le vérifient).
const ACCENTED_DESCRIPTION =
  "Réfection complète d'un toit en tôle ondulée à Ouagadougou : dépose des plaques " +
  'rouillées, remplacement des fixations, étanchéité à refaire et gouttières à reprendre ' +
  'avant la saison des pluies.';

/**
 * Le jeu est aussi la ENTRÉE des cas non triviaux du contrat : chaque mission a
 * un identifiant distinct, donc une carte et un canonical distincts, et le garde
 * exige l'égalité des deux côtés pour CHACUNE.
 */
export const CONTRACT_JOBS = [
  {
    label: 'apostrophe et « & »',
    covers: 'texte échappé dans le HTML, description de plus de 150 points de code',
    id: '11111111-1111-4111-8111-111111111111',
    title: "Réparation d'une fuite & rebouchage du plafond",
    description:
      "Fuite lente au plafond du salon, sous la salle de bain : tache qui s'agrandit " +
      "depuis une semaine, placo gonfle au-dessus de la porte-fenetre. Il faut localiser " +
      "l'origine, ouvrir proprement, reparer la canalisation et reboucher avant peinture.",
  },
  {
    label: 'accents à la frontière',
    covers: 'le 150e point de code est un accent, avec des accents avant et après la coupe',
    id: '22222222-2222-4222-8222-222222222222',
    title: "Réfection d'une toiture en tôle ondulée — étage",
    description: ACCENTED_DESCRIPTION,
  },
  {
    label: 'emoji BMP à la frontière',
    covers: 'emoji du plan de base (1 unité UTF-16) au 150e point de code : les comptes coïncident',
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Tri des cartons ☕ après déménagement',
    description: insertAtCodePoint(ACCENTED_DESCRIPTION, DESCRIPTION_LIMIT - 1, '☕'),
  },
  {
    label: 'astral à la frontière',
    covers: 'caractère astral (2 unités UTF-16) au 150e point de code : la paire tombe sur la coupe',
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Nettoyage de fin de chantier 😀 à Ouagadougou',
    description: insertAtCodePoint(ACCENTED_DESCRIPTION, DESCRIPTION_LIMIT - 1, '😀'),
  },
  {
    label: 'astral avant la frontière',
    covers: 'caractère astral AVANT la coupe : le décompte UTF-16 décale la frontière d’un caractère',
    id: '55555555-5555-4555-8555-555555555555',
    title: 'Évacuation des gravats 🚚 et remise en état',
    description: insertAtCodePoint(ACCENTED_DESCRIPTION, 99, '🚚'),
  },
];

/**
 * La mission de référence HISTORIQUE du contrat — la première du jeu. Gardée
 * nommée : les tests et les messages la citent depuis l'origine.
 */
export const FIXTURE_JOB = CONTRACT_JOBS[0];

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

/**
 * Vrai si `value` contient un DEMI-CARACTÈRE : une demi-paire de surrogates
 * orpheline. C'est la signature d'une coupe par UNITÉS UTF-16 au milieu d'un
 * caractère astral — ce que fait `String.prototype.slice`, et ce qui publiait la
 * moitié d'un emoji dans la balise (le navigateur l'affiche « »).
 */
export const hasLoneSurrogate = (value) => {
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1; // paire valide : on saute le bas de la paire
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
};

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
 * @param {{title: string, description: string, card: string, canonicalPath: string}} options.app Valeur de `jobSeo`.
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
    // Longueurs comptées en POINTS DE CODE — l'unité que la coupe des deux côtés
    // utilise. En unités UTF-16, un texte à caractères astraux afficherait des
    // nombres qui ne correspondent à AUCUNE des deux coupes.
    const points = (value) => Array.from(value).length;
    // Un « » dans un message ne dit pas d'où il vient : nommer la cause quand
    // elle est là — une coupe faite sur une unité UTF-16, au milieu d'un astral.
    const halfCharacter = hasLoneSurrogate(description) || hasLoneSurrogate(app.description);
    errors.push(
      `description : le pré-rendu annonce ${points(description)} points de code, l'application ` +
        `${points(app.description)} — « ${description} » ≠ « ${app.description} »` +
        (halfCharacter
          ? ' — un côté publie un DEMI-CARACTÈRE : la coupe s’est faite sur une unité UTF-16, '
              + 'au milieu d’un caractère astral'
          : '')
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
  // L'URL de la page — canonical (l'adresse sous laquelle elle demande à être
  // indexée) et og:url (celle que le réseau social affiche) : la MÊME des deux
  // côtés. Le pré-rendu la construit sur la route (kojo_job_og.py),
  // l'application sur l'identifiant affiché (src/utils/jobSeo.js) — un écart
  // ferait indexer ou partager la fiche sous une autre adresse que celle ouverte.
  const expectedUrl = app.canonicalPath ? `${base}${app.canonicalPath}` : '';
  if (!expectedUrl) {
    errors.push("l'application n'annonce AUCUNE URL canonique pour cette mission");
  } else {
    const canonical = canonicalHref(html);
    if (canonical !== expectedUrl) {
      errors.push(`canonical : le pré-rendu annonce « ${canonical || '(absent)'} », l'application « ${expectedUrl} »`);
    }
    const ogUrl = decodeEntities(metaContent(html, 'og:url'));
    if (ogUrl !== expectedUrl) {
      errors.push(`og:url : le pré-rendu annonce « ${ogUrl || '(absente)'} », l'application « ${expectedUrl} »`);
    }
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

  checked.push(`  interpréteur  ${python} → ${PRERENDER_MODULE} (aucune dépendance)`);

  // CHAQUE mission du jeu passe par les DEUX implémentations, puis est comparée :
  // une seule mission ne dirait rien d'un pré-rendu qui n'a jamais traversé de
  // caractère astral (c'est exactement le cas que personne ne couvrait).
  for (const job of CONTRACT_JOBS) {
    const { html, error } = renderPrerenderedPage({ python, job, base, root });
    if (error) {
      errors.push(`[${job.label}] ${error}`);
      continue;
    }
    const app = jobSeo(job);
    for (const problem of compareJobOg({ app, html, base })) {
      errors.push(`[${job.label}] ${problem}`);
    }
    checked.push(
      `  ✓ ${job.label} : « ${app.title} » — description ${Array.from(app.description).length} ` +
        `points de code (source ${Array.from(job.description).length}), carte wide + carrée ` +
        `-square.png, canonical/og:url (${job.covers})`
    );
  }

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
    `✅ Contrat /jobs/:id tenu hors ligne sur ${CONTRACT_JOBS.length} missions de référence : ` +
      'titre, description (coupe en points de code), carte, canonical et og:url identiques entre ' +
      "l'application et le pré-rendu (aucun serveur, aucune base de données)."
  );
  return { ok: true, errors, notices, checked, python };
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = runJobOgContractCheck();
  if (!result.ok) process.exit(1);
}
