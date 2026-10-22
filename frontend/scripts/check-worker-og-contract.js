#!/usr/bin/env node
/**
 * Contrat app ↔ pré-rendu d'un PROFIL TRAVAILLEUR (/workers/:id) — HORS LIGNE.
 *
 * Le même contrat que la fiche mission (`check-job-og-contract.js`), sur la
 * seconde page que le backend pré-rend : `/workers/:id` a quitté le gabarit nu
 * et le `X-Robots-Tag: noindex` le 20/10/2026, et son document est désormais ce
 * qu'un moteur indexe et qu'un crawler de partage affiche.
 *
 * Ce garde exécute les DEUX implémentations sur CHACUN des profils de référence
 * (`CONTRACT_WORKERS`) :
 *
 *   • le PRÉ-RENDU : il importe `backend/kojo_worker_og.py` (module sans
 *     dépendance : ni FastAPI, ni MongoDB, ni kojo_settings) et lui donne la vue
 *     publique du travailleur en JSON — du code de production exécuté, pas un
 *     motif cherché dans un source ;
 *   • l'APPLICATION : il appelle `src/utils/workerSeo.js`, la fonction que
 *     `WorkerProfile` utilise pour annoncer le même profil.
 *
 * Puis il exige l'égalité : titre, description, les DEUX cartes (wide + carrée),
 * canonical et og:url. Un titre retouché d'un seul côté fait donc rougir la PR
 * au lieu de publier deux vérités — l'onglet et la carte de partage.
 *
 * ── Le jeu de référence, et pourquoi il existe ─────────────────────────────
 * La coupe de la description à 150 est comptée en POINTS DE CODE des deux côtés
 * (JavaScript via `Array.from`, Python via `[:150]`) : un émoji hors BMP
 * (caractère astral) sépare les deux comptes si l'un retombe sur `slice` —
 * demi-caractère publié, deux descriptions selon le canal. Le jeu place donc la
 * frontière sur un accent, un emoji du plan de base et un astral, et y ajoute
 * les cas que la vue publique rend VRAIMENT : un profil neuf (aucun avis, aucune
 * mission) et un profil complet (bio, compétences, note, missions, ville).
 *
 * Usage : cd frontend && node scripts/check-worker-og-contract.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  PRERENDER_MODULE as JOB_MODULE,
  PYTHON_CANDIDATES,
  decodeEntities,
  findPython,
  hasLoneSurrogate,
  htmlTitle,
  renderPrerenderedPage,
} from './check-job-og-contract.js';
import { DESCRIPTION_LIMIT } from '../src/utils/jobSeo.js';
import { workerSeo } from '../src/utils/workerSeo.js';
// La règle témoin de la feuille de l'application : elle est DÉCLARÉE par le
// plugin qui la copie (`SELECTEUR_TEMOIN`), et non recopiée ici — deux
// littéraux divergeraient, et le contrôle porterait sur un sélecteur qui
// n'existe plus (donc sur rien).
import { SELECTEUR_TEMOIN } from '../vite-plugins/worker-boot.js';
import {
  POINT_ENTREE_TRAVAILLEUR,
  canonicalHref,
  metaContent,
  metaContents,
} from './site-meta.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');

/** Module de production du pré-rendu d'un profil (stdlib uniquement). */
export const PRERENDER_MODULE = 'backend/kojo_worker_og.py';

/**
 * Insère `char` au (index + 1)ième POINT DE CODE de `text` — la frontière de la
 * coupe se pose donc exactement là où les deux langages pourraient diverger.
 */
const insertAtCodePoint = (text, index, char) => {
  const points = Array.from(text);
  return [...points.slice(0, index), char, ...points.slice(index)].join('');
};

// Bio d'appui : assez longue pour dépasser la coupe et être tronquée.
const LONG_BIO =
  "Réfection complète d'un toit en tôle ondulée à Ouagadougou : dépose des plaques " +
  'rouillées, remplacement des fixations, étanchéité à refaire et gouttières à reprendre ' +
  'avant la saison des pluies.';

/**
 * Les profils de RÉFÉRENCE du contrat — une seule définition, donnée aux deux
 * côtés. Ce sont des VUES PUBLIQUES (la forme que rend `profil_public`), pas des
 * documents utilisateur : le pré-rendu ne reçoit jamais autre chose.
 */
export const CONTRACT_WORKERS = [
  {
    label: 'profil complet',
    covers: 'bio, compétences, note, missions, ville — et une apostrophe dans le nom',
    worker: {
      id: '11111111-1111-4111-8111-111111111111',
      first_name: "Awa",
      last_name: "d'Ouaga",
      city: 'Ouagadougou',
      skills: ['plomberie', 'soudure', 'toiture'],
      bio: LONG_BIO,
      stats: { missions_completed: 12, rating_average: 4.8, rating_count: 9 },
    },
  },
  {
    label: 'profil neuf',
    covers: 'aucun avis, aucune mission : les replis de la description et du titre',
    worker: {
      id: '22222222-2222-4222-8222-222222222222',
      first_name: 'Moussa',
      last_name: '',
      city: '',
      skills: [],
      bio: '',
      stats: { missions_completed: 0, rating_average: null, rating_count: 0 },
    },
  },
  {
    label: 'accent et « & » à la frontière',
    covers: 'caractères échappés dans le HTML, coupe sur un accent',
    worker: {
      id: '33333333-3333-4333-8333-333333333333',
      first_name: 'Fatou & Sow',
      last_name: 'Traoré',
      city: 'Bamako',
      skills: ['électricité', 'froid'],
      bio: LONG_BIO,
      stats: { missions_completed: 3, rating_average: 5, rating_count: 3 },
    },
  },
  {
    label: 'astral à la frontière',
    covers: 'caractère astral (2 unités UTF-16) au 150e point de code : une coupe par unités publierait un demi-caractère',
    worker: {
      id: '44444444-4444-4444-8444-444444444444',
      first_name: 'Ibrahim 😀',
      last_name: 'Cissé',
      city: 'Abidjan',
      skills: ['menuiserie'],
      bio: insertAtCodePoint(LONG_BIO, DESCRIPTION_LIMIT - 1, '😀'),
      stats: { missions_completed: 1, rating_average: 4, rating_count: 1 },
    },
  },
  {
    label: 'astral avant la frontière',
    covers: 'un astral PLUS TÔT dans la bio : un décompte UTF-16 décale la coupe d’un caractère',
    worker: {
      id: '55555555-5555-4555-8555-555555555555',
      first_name: 'Aminata',
      last_name: 'Kone',
      city: '',
      skills: ['couture'],
      bio: insertAtCodePoint(LONG_BIO, 99, '🚚'),
      stats: { missions_completed: 2, rating_average: null, rating_count: 0 },
    },
  },
];

/** Le profil de référence HISTORIQUE : le premier du jeu. */
export const FIXTURE_WORKER = CONTRACT_WORKERS[0].worker;

/** Programme passé à `-c` : importe le module de production et écrit son HTML. */
export const PRERENDER_SCRIPT = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'from kojo_worker_og import worker_og_html',
  'sys.stdout.write(worker_og_html(json.load(sys.stdin), sys.argv[2]))',
].join('\n');

/**
 * Confronte ce que l'application annonce à ce que le pré-rendu publie.
 *
 * PUR (aucune exécution, aucun accès disque) : c'est ce qui permet de prouver
 * qu'il SAIT échouer, avec deux côtés divergents fabriqués par un test.
 *
 * @param {object} options
 * @param {{title: string, description: string, card: string, cardSquare: string, canonicalPath: string}} options.app Valeur de `workerSeo`.
 * @param {string} options.html HTML pré-rendu du MÊME profil.
 * @param {string} options.base Origine servant le pré-rendu (`https://…`).
 * @returns {string[]} Problèmes trouvés (vide = contrat tenu).
 */
export const compareWorkerOg = ({ app, html, base }) => {
  const errors = [];
  const title = htmlTitle(html);
  const description = decodeEntities(metaContent(html, 'description'));
  const images = metaContents(html, 'og:image');
  const expectedWide = app.card ? `${base}${app.card}` : '';
  const expectedSquare = app.cardSquare ? `${base}${app.cardSquare}` : '';

  if (!app.title) errors.push("l'application n'annonce AUCUN titre pour ce profil");
  if (title !== app.title) {
    errors.push(`titre : le pré-rendu annonce « ${title} », l'application « ${app.title} »`);
  }
  if (description !== app.description) {
    const points = (value) => Array.from(value).length;
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
  const expectedUrl = app.canonicalPath ? `${base}${app.canonicalPath}` : '';
  if (!expectedUrl) {
    errors.push("l'application n'annonce AUCUNE URL canonique pour ce profil");
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
 * Égalité PROFONDE de deux valeurs JSON — l'ordre des clés ne décide rien.
 *
 * Un `JSON.stringify` des deux côtés aurait fait rougir un bloc identique dont
 * les clés auraient été rendues dans un autre ordre (un `sort_keys` ajouté au
 * backend, par exemple) : ce serait un faux refus, et on apprendrait à passer
 * outre.
 */
export const egalProfond = (a, b) => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((valeur, rang) => egalProfond(valeur, b[rang]));
  }
  if (typeof a !== 'object') return false;
  const clesA = Object.keys(a).sort();
  const clesB = Object.keys(b).sort();
  if (clesA.length !== clesB.length || clesA.some((cle, rang) => cle !== clesB[rang])) {
    return false;
  }
  return clesA.every((cle) => egalProfond(a[cle], b[cle]));
};

/**
 * Le bloc de données du profil, tel que le document le porte — ou null.
 *
 * @param {string} html HTML pré-rendu.
 * @param {string} [seedId] Identifiant de la balise (défaut : site-meta).
 * @returns {string|null} Contenu brut du bloc.
 */
export const extraireSeed = (html, seedId = POINT_ENTREE_TRAVAILLEUR.seedId) => {
  const motif = new RegExp(
    `<script\\b[^>]*\\bid="${seedId}"[^>]*>([\\s\\S]*?)<\\/script>`,
    'i'
  );
  const trouve = motif.exec(String(html));
  return trouve ? trouve[1] : null;
};

/**
 * Le document DÉMARRE-T-IL l'application, et avec QUELLES données ?
 *
 * Trois faits, dont chacun a son propre refus (le nom du fichier fautif est
 * cité) :
 *   1. la feuille de l'application est liée au chemin STABLE déclaré — sans
 *      elle, le profil et l'application qu'il démarre sont peints sans style ;
 *   2. le point d'entrée est déclaré en `type="module"` au chemin STABLE — sans
 *      lui, le visiteur à froid n'a que le document statique (le compromis que
 *      cette passe retire) ;
 *   3. le bloc de données porte EXACTEMENT la vue publique rendue — un bloc
 *      absent ramènerait le squelette, un bloc d'un AUTRE profil afficherait la
 *      mauvaise personne, et un bloc qui refermerait sa balise serait du
 *      balisage injecté (la vue est écrite par des utilisateurs).
 *
 * GÉNÉRIQUE aux deux documents pré-rendus (profil ET fiche mission) : les deux
 * citent le MÊME point d'entrée et la MÊME feuille, seul le bloc de données
 * change. La fiche mission l'appelle avec `POINT_ENTREE_MISSION` — une seconde
 * copie de ces trois refus divergerait au premier renommage.
 *
 * @param {object} options
 * @param {string} options.html HTML pré-rendu (profil ou fiche).
 * @param {object} options.vue Vue publique passée au pré-rendu.
 * @param {{script: string, style: string, seedId: string}} [options.attendu]
 * @returns {string[]} Problèmes trouvés (vide = document conforme).
 */
export const comparePointEntree = ({
  html,
  vue,
  attendu = POINT_ENTREE_TRAVAILLEUR,
}) => {
  const errors = [];
  const source = String(html);

  const feuille = new RegExp(
    `<link\\b[^>]*\\brel="stylesheet"[^>]*\\bhref="${attendu.style.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
    'i'
  );
  const feuilleInversee = new RegExp(
    `<link\\b[^>]*\\bhref="${attendu.style.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*\\brel="stylesheet"`,
    'i'
  );
  if (!feuille.test(source) && !feuilleInversee.test(source)) {
    errors.push(
      `feuille : le document ne lie pas « ${attendu.style} » — l’application démarrerait ` +
        'SANS style (une page nue se lit comme une page cassée)'
    );
  }

  const module = new RegExp(
    `<script\\b[^>]*\\btype="module"[^>]*\\bsrc="${attendu.script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
    'i'
  );
  const moduleInverse = new RegExp(
    `<script\\b[^>]*\\bsrc="${attendu.script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*\\btype="module"`,
    'i'
  );
  if (!module.test(source) && !moduleInverse.test(source)) {
    errors.push(
      `point d’entrée : le document ne charge pas « ${attendu.script} » en module — ` +
        'un visiteur à froid n’aurait que le document statique (ni châssis, ni avis, ni navigation)'
    );
  }

  // L'identifiant du bloc vient de la déclaration JUGÉE, jamais du défaut : le
  // document de la fiche mission porte `kojo-job-data`, et chercher celui du
  // profil ferait dire « bloc absent » à un document pourtant complet.
  const brut = extraireSeed(source, attendu.seedId);
  if (brut === null) {
    errors.push(
      `données : le bloc « ${attendu.seedId} » est absent — la page repasserait par un ` +
        'squelette alors que le serveur vient de rendre la vue'
    );
  } else {
    if (/<\/(script|style)|<script/i.test(brut)) {
      errors.push(
        'données : le bloc contient une balise (`<script`/`</script`) NON échappée — ' +
          'une bio, une description ou un commentaire refermerait la balise et le reste ' +
          'du document deviendrait du balisage'
      );
    }
    let donnees = null;
    try {
      donnees = JSON.parse(brut);
    } catch (_erreur) {
      errors.push('données : le bloc n’est pas du JSON lisible');
    }
    if (donnees !== null && !egalProfond(donnees, vue)) {
      errors.push(
        'données : le bloc ne porte pas la vue publique rendue — un bloc d’une autre ' +
          'page, ou amputé, afficherait autre chose que ce que le document annonce'
      );
    }
  }
  return errors;
};

/**
 * Les DEUX fichiers que le document cite existent-ils vraiment dans l'artefact ?
 *
 * Le contrat ci-dessus juge le DOCUMENT ; ceci juge ce qu'il pointe. Les deux
 * doivent tenir ensemble : un document conforme qui pointerait vers un 404
 * rendrait la page statique et muette — exactement le défaut que cette passe
 * corrige — et rien dans le HTML ne le dirait.
 *
 * Trois faits, chacun refusé en le nommant :
 *   1. le fichier de boot existe et importe une entrée sous `/assets/` qui
 *      existe elle aussi (c'est le lien vers l'application réelle) ;
 *   2. la feuille copiée existe et contient `.titre-page` — le CSS du site, pas
 *      un bloc vide ;
 *   3. les deux sont dans `asset-manifest.json`, donc leurs octets sont
 *      vérifiés en production par `check-deployed-assets.js`.
 *
 * @param {string} dossierArtefact Dossier `build/` du frontend.
 * @returns {string[]} Problèmes trouvés (vide = les cibles du document existent).
 */
export const verifierArtefacts = (dossierArtefact) => {
  const errors = [];
  const relatif = (chemin) => chemin.replace(/^\/+/, '');
  const bootAbs = path.join(dossierArtefact, relatif(POINT_ENTREE_TRAVAILLEUR.script));
  const cssAbs = path.join(dossierArtefact, relatif(POINT_ENTREE_TRAVAILLEUR.style));

  if (!fs.existsSync(bootAbs)) {
    errors.push(
      `artefact : « ${POINT_ENTREE_TRAVAILLEUR.script} » est absent du build — le ` +
        'document /workers/:id pointerait vers un 404 et l’application ne démarrerait jamais'
    );
  } else {
    const contenu = fs.readFileSync(bootAbs, 'utf8');
    const entree = /import\s*["'](\/[^"']+\.js)["']/.exec(contenu);
    if (!entree) {
      errors.push(
        `artefact : « ${POINT_ENTREE_TRAVAILLEUR.script} » n’importe aucune entrée — ` +
          'il ne démarrerait rien'
      );
    } else if (!entree[1].startsWith('/assets/')) {
      errors.push(
        `artefact : le boot importe « ${entree[1]} », hors de /assets/ — une entrée ` +
          'stable sous un autre chemin échapperait au cache immuable du build'
      );
    } else if (!fs.existsSync(path.join(dossierArtefact, relatif(entree[1])))) {
      errors.push(
        `artefact : le boot importe « ${entree[1]} », ABSENT du build — le document ` +
          'chargerait un module en 404'
      );
    }
  }

  if (!fs.existsSync(cssAbs)) {
    errors.push(
      `artefact : « ${POINT_ENTREE_TRAVAILLEUR.style} » est absent du build — ` +
        'l’application du profil démarrerait SANS style'
    );
  } else if (!fs.readFileSync(cssAbs, 'utf8').includes(SELECTEUR_TEMOIN)) {
    errors.push(
      `artefact : « ${POINT_ENTREE_TRAVAILLEUR.style} » ne contient pas ` +
        `« ${SELECTEUR_TEMOIN} » — ce n’est pas la feuille de l’application`
    );
  }

  const manifesteAbs = path.join(dossierArtefact, 'asset-manifest.json');
  if (!fs.existsSync(manifesteAbs)) {
    errors.push('artefact : asset-manifest.json absent — les deux fichiers ci-dessus ne sont pas ancrés');
  } else {
    let fichiers = {};
    try {
      fichiers = JSON.parse(fs.readFileSync(manifesteAbs, 'utf8')).fichiers || {};
    } catch (_erreur) {
      errors.push('artefact : asset-manifest.json illisible');
    }
    for (const chemin of [POINT_ENTREE_TRAVAILLEUR.script, POINT_ENTREE_TRAVAILLEUR.style]) {
      if (!fichiers[chemin]) {
        errors.push(`artefact : « ${chemin} » n’est pas dans asset-manifest.json — ses octets ne seraient vérifiés nulle part`);
      }
    }
  }
  return errors;
};

/**
 * @param {{root?: string, base?: string, quiet?: boolean, artefact?: string}} [opts]
 * @returns {{ok: boolean, errors: string[], notices: string[], checked: string[], python: string}}
 */
export const runWorkerOgContractCheck = (opts = {}) => {
  const root = opts.root || REPO_ROOT;
  const base = opts.base || 'https://kojoforafrica.cc.cd';
  const log = opts.quiet ? () => {} : console.log;
  const logError = opts.quiet ? () => {} : console.error;

  const errors = [];
  const notices = [];
  const checked = [];

  const python = findPython({
    root,
    base,
    candidates: PYTHON_CANDIDATES,
    module: PRERENDER_MODULE,
    job: FIXTURE_WORKER,
    script: PRERENDER_SCRIPT,
  });
  if (!python) {
    const message =
      `aucun interpréteur Python capable d'importer ${PRERENDER_MODULE} ` +
      `(essayés : ${PYTHON_CANDIDATES.join(', ')}) — le contrat app ↔ pré-rendu de /workers/:id ` +
      `n'a donc PAS été vérifié`;
    // En CI l'image du runner fournit python3 : ne pas l'avoir là est une panne,
    // pas une excuse. Hors CI, un poste sans Python ne doit pas voir rouge.
    if (process.env.CI) errors.push(message);
    else {
      notices.push(message);
      logError(`::notice title=Contrat /workers/:id non vérifié::${message}`);
    }
    return { ok: errors.length === 0, errors, notices, checked, python: '' };
  }

  checked.push(`  interpréteur  ${python} → ${PRERENDER_MODULE} (aucune dépendance)`);

  for (const { label, worker } of CONTRACT_WORKERS) {
    const { html, error } = renderPrerenderedPage({
      python,
      job: worker,
      base,
      root,
      script: PRERENDER_SCRIPT,
    });
    if (error) {
      errors.push(`[${label}] ${error}`);
      continue;
    }
    const app = workerSeo(worker);
    for (const problem of compareWorkerOg({ app, html, base })) {
      errors.push(`[${label}] ${problem}`);
    }
    for (const problem of comparePointEntree({ html, vue: worker })) {
      errors.push(`[${label}] ${problem}`);
    }
    checked.push(
      `  ✓ ${label} : « ${app.title} » — description ${Array.from(app.description).length} ` +
        'points de code, carte wide + carrée, canonical/og:url, point d’entrée + feuille + données'
    );
  }

  // Les cibles du document, dans l'artefact QUE la CI vient de bâtir. Un poste
  // sans build garde un avis (le contrat ci-dessus, lui, ne demande rien) ; en
  // CI, l'étape tourne après `npm run build`, donc l'absence est une panne.
  const artefact = opts.artefact || path.join(FRONTEND_DIR, 'build');
  if (fs.existsSync(path.join(artefact, 'index.html'))) {
    for (const problem of verifierArtefacts(artefact)) errors.push(problem);
    checked.push(
      `  ✓ artefact    ${POINT_ENTREE_TRAVAILLEUR.script} → entrée hachée, ` +
        `${POINT_ENTREE_TRAVAILLEUR.style}, les deux ancrés dans asset-manifest.json`
    );
  } else {
    const message =
      `aucun build dans ${artefact} — les fichiers que le document cite ne sont ` +
      'donc PAS vérifiés (lancer npm run build ; en CI cette absence est une panne)';
    if (process.env.CI) {
      errors.push(message);
    } else {
      notices.push(message);
      logError(`::notice title=Artefacts /workers/:id non vérifiés::${message}`);
    }
  }

  if (errors.length > 0) {
    logError(`❌ Contrat app ↔ pré-rendu de /workers/:id NON tenu (${errors.length} problème(s)) :`);
    for (const message of errors) logError(`   • ${message}`);
    logError(
      `   → le HTML pré-rendu vient de backend/${path.basename(PRERENDER_MODULE)}, ce que l'application ` +
        `annonce de src/utils/workerSeo.js (utilisé par src/pages/WorkerProfile.js). Corriger le côté ` +
        `FAUTIF : les deux doivent annoncer la même chose, sinon un crawler lit autre chose que l'onglet.`
    );
    return { ok: false, errors, notices, checked, python };
  }

  log(checked.join('\n'));
  log(
    `✅ Contrat /workers/:id tenu hors ligne sur ${CONTRACT_WORKERS.length} profils de référence : ` +
      'titre, description (coupe en points de code), cartes wide + carrée, canonical et og:url ' +
      "identiques entre l'application et le pré-rendu, et le document DÉMARRE l'application " +
      '(point d’entrée, feuille, données déjà rendues) — aucun serveur, aucune base de données.'
  );
  return { ok: true, errors, notices, checked, python };
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const result = runWorkerOgContractCheck();
  if (!result.ok) process.exit(1);
}

// Le module de la fiche mission est réexporté pour que la CI (et un test) puissent
// vérifier que les DEUX pages sont jugées — un garde qui ne juge qu'une moitié
// des surfaces pré-rendues laisse l'autre dériver.
export { JOB_MODULE };

// La machinerie d'exécution est RÉEXPORTÉE (et non recopiée) pour que le test du
// contrat lance le module de production exactement comme ce garde : une seconde
// copie du code d'appel finirait par différer, et le test ne prouverait plus le
// garde.
export { findPython, renderPrerenderedPage, hasLoneSurrogate };
