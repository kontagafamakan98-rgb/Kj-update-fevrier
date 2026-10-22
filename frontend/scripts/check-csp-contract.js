#!/usr/bin/env node
/**
 * CONTRAT DE CSP — le site et ses documents pré-rendus portent la MÊME
 * politique, et elle est déclarée UNE fois.
 *
 * ── Le fait que ce garde juge, et pourquoi il existe hors ligne ────────────
 * La CSP du site est injectée dans les pages du build par
 * `vite-plugins/inject-production-csp.js`, qui lit `src/config/csp.js`. Les
 * documents `/jobs/:id` et `/workers/:id` sont écrits par le BACKEND
 * (`backend/kojo_job_og.py`, `backend/kojo_worker_og.py`) : ils n'étaient donc
 * pas couverts, et un lien partagé — le SEUL chemin d'arrivée d'un visiteur à
 * froid — ouvrait une page qui démarre l'application SANS la politique du site.
 *
 * Recopier la politique en Python aurait fait deux déclarations à garder
 * d'accord. Ce garde est ce qui rend la copie acceptable : il exécute les DEUX
 * implémentations sur un jeu d'entrées de référence et exige des chaînes
 * IDENTIQUES — octet pour octet, sans normalisation, parce que la sonde de
 * production compare ces mêmes octets sur ce qui est SERVI.
 *
 * Trois maillons, tous nécessaires :
 *
 *   1. `src/config/csp.js` (`construireCsp`) ↔ `backend/kojo_csp.py`
 *      (`construire_csp`) : même politique pour les mêmes entrées ;
 *   2. les QUATRE documents pré-rendus (fiche, fiche 404, profil, profil 404)
 *      publient cette politique dans une balise `<meta>`, telle quelle ;
 *   3. le plugin du build ne peut PAS contourner la déclaration : sa sortie est
 *      comparée à `construireCsp` pour la même configuration.
 *
 * ── Ce qu'il ne juge pas, et c'est écrit ──────────────────────────────────
 * Les valeurs d'environnement DÉPLOYÉES. Le build lit `VITE_API_URL`,
 * `VITE_PLAUSIBLE_DOMAIN`, `VITE_GA_MEASUREMENT_ID` ; le backend lit
 * `BACKEND_PUBLIC_URL`, `PLAUSIBLE_DOMAIN`, `GA_MEASUREMENT_ID`. Deux
 * environnements peuvent diverger sans qu'aucun contrat hors ligne ne le voie :
 * c'est la sonde de production (`check-csp-documents-production.js`) qui compare
 * ce que le SITE sert et ce que les DOCUMENTS servent, et qui refuse l'écart en
 * nommant le réglage à poser. Ici on prouve seulement que les deux calculs sont
 * le même calcul.
 *
 * INTERPRÉTEUR : `backend/kojo_csp.py` est stdlib uniquement (aucun import de
 * `kojo_settings`), comme `kojo_job_og.py` : n'importe quel Python convient. En
 * CI son absence est une ERREUR — un garde qui ne s'exécute pas ne garde rien —,
 * et hors CI un `::notice` (un poste sans Python ne doit pas voir rouge).
 *
 * Usage : cd frontend && node scripts/check-csp-contract.js
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { construireCsp, GA_MOTIF } from '../src/config/csp.js';
import { injectProductionCspPlugin } from '../vite-plugins/inject-production-csp.js';
// La LECTURE d'une CSP dans un document est la MÊME règle pour ce contrat et
// pour la sonde de production : une seule définition (`csp-document.js`).
import { cspDeDocument, DIRECTIVE_ENTETE } from './csp-document.js';
import { findPython } from './check-job-og-contract.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');

/** Le seul titre d'annotation que ce garde publie. */
export const TITRE_ERREUR = 'Contrat CSP site ↔ documents pré-rendus';

/** L'origine de référence passée au pré-rendu (le canonical, non la CSP). */
export const BASE_REFERENCE = 'https://kojoforafrica.cc.cd';

/** La directive qui n'a RIEN à faire dans une balise `<meta>` (règle partagée). */
export { DIRECTIVE_ENTETE };

/**
 * Les entrées de référence — chacune couvre une branche du calcul.
 *
 * L'ordre couvre ce qui a un jour divergé ou pourrait diverger : l'absence
 * d'analytique (la politique nue), une origine seule, une origine avec barre
 * finale et espaces (la normalisation), Plausible seul, GA seul, les deux, et
 * des réglages INVALIDES (un `UA-…`, un domaine blanc) qui ne doivent RIEN
 * ouvrir — un domaine vide autorisé élargirait la politique pour rien.
 */
export const CAS_REFERENCE = [
  {
    label: 'aucun réglage',
    api_origin: '',
    plausible_domain: '',
    ga_measurement_id: '',
  },
  {
    label: 'origine de l’API seule',
    api_origin: 'https://api.kojo.test',
    plausible_domain: '',
    ga_measurement_id: '',
  },
  {
    label: 'origine à normaliser + Plausible',
    api_origin: '  https://api.kojo.test//  ',
    plausible_domain: 'site.kojo.test',
    ga_measurement_id: '',
  },
  {
    label: 'GA4 seul',
    api_origin: 'https://api.kojo.test',
    plausible_domain: '',
    ga_measurement_id: 'G-ABC123',
  },
  {
    label: 'les deux analytiques',
    api_origin: 'https://api.kojo.test',
    plausible_domain: 'site.kojo.test',
    ga_measurement_id: 'G-ABC123',
  },
  {
    label: 'réglages invalides (rien ne s’ouvre)',
    api_origin: 'https://api.kojo.test',
    plausible_domain: '   ',
    ga_measurement_id: 'UA-123456-1',
  },
  {
    label: 'GA4 en minuscules + origine espacée',
    api_origin: '  https://api.kojo.test  ',
    plausible_domain: 'site.kojo.test',
    ga_measurement_id: 'g-xyz9',
  },
];

/**
 * Confronte les deux implémentations, cas par cas. PUR.
 *
 * @param {object} options
 * @param {string[]} options.politiquesJs Sorties de `construireCsp`.
 * @param {string[]} options.politiquesPy Sorties de `construire_csp`.
 * @param {Array<{label: string}>} [options.cas] Les entrées, pour nommer.
 * @returns {string[]} Problèmes (vide = les deux calculs sont le même).
 */
export const comparerPolitiques = ({ politiquesJs, politiquesPy, cas = CAS_REFERENCE }) => {
  const erreurs = [];
  const attendu = cas.length;
  if (!Array.isArray(politiquesPy) || politiquesPy.length !== attendu) {
    erreurs.push(
      `la copie Python rend ${Array.isArray(politiquesPy) ? politiquesPy.length : 'aucune'} ` +
        `politique(s) pour ${attendu} cas — elle n'a pas exécuté les mêmes entrées`
    );
    return erreurs;
  }
  cas.forEach((entree, index) => {
    const cote = politiquesJs[index];
    const copie = politiquesPy[index];
    if (!cote) {
      erreurs.push(`[${entree.label}] la déclaration JS rend une politique VIDE`);
      return;
    }
    if (cote !== copie) {
      erreurs.push(
        `[${entree.label}] les deux copies DIVERGENT :\n` +
          `        JS  : ${cote}\n` +
          `        PY  : ${copie}`
      );
    }
    for (const [nom, politique] of [
      ['JS', cote],
      ['PY', copie],
    ]) {
      if (politique.includes(DIRECTIVE_ENTETE)) {
        erreurs.push(
          `[${entree.label}] ${nom} publie « ${DIRECTIVE_ENTETE} » dans une balise <meta> : ` +
            `la directive y est IGNORÉE par les navigateurs (et avertie en console) — elle ` +
            `appartient à l'en-tête HTTP de frontend/vercel.json`
        );
      }
    }
  });
  return erreurs;
};

/**
 * Confronte les documents pré-rendus à la politique attendue. PUR.
 *
 * @param {object} options
 * @param {Array<{nom: string, html: string}>} options.documents Documents rendus.
 * @param {string} options.attendu Politique à publier.
 * @returns {string[]} Problèmes (vide = les quatre documents la publient).
 */
export const comparerDocuments = ({ documents, attendu }) => {
  const erreurs = [];
  if (!Array.isArray(documents) || documents.length === 0) {
    return ['aucun document pré-rendu n’a été rendu — rien n’a donc été jugé'];
  }
  if (!attendu) return ['la politique attendue est VIDE : le contrat ne peut rien exiger'];
  for (const { nom, html } of documents) {
    const politique = cspDeDocument(html);
    if (!politique) {
      erreurs.push(
        `${nom} ne publie AUCUNE meta CSP : le document démarre l'application sans la ` +
          `politique du site (un lien partagé arrive dessus sans protection)`
      );
      continue;
    }
    if (politique !== attendu) {
      erreurs.push(
        `${nom} publie une politique DIFFÉRENTE de celle du site :\n` +
          `        servi  : ${politique}\n` +
          `        attendu: ${attendu}`
      );
    }
  }
  return erreurs;
};

/**
 * Programme Python passé à `-c` : rend les QUATRE documents pré-rendus et les
 * écrit en JSON sur la sortie standard.
 *
 * Le dossier du backend et la base arrivent en argv — aucun échappement de
 * coquille — et `kojo_csp.csp_du_site()` lit l'environnement du processus, que
 * l'appelant pose. Le worker de référence porte le minimum qu'un profil peut
 * avoir : ce garde ne juge pas le texte du profil, seulement sa CSP.
 */
const DOCUMENTS_SCRIPT = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'from kojo_job_og import job_og_html, job_og_html_404',
  'from kojo_worker_og import worker_og_html, worker_og_html_404',
  'base = sys.argv[2]',
  'job = {"id": "ref-csp", "title": "Mission de référence", "description": "Desc."}',
  'worker = {"id": "ref-csp", "name": "Awa", "city": "Ouagadougou"}',
  'documents = [',
  '    {"nom": "/jobs/:id", "html": job_og_html(job, base)},',
  '    {"nom": "/jobs/:id (404)", "html": job_og_html_404()},',
  '    {"nom": "/workers/:id", "html": worker_og_html(worker, base)},',
  '    {"nom": "/workers/:id (404)", "html": worker_og_html_404()},',
  ']',
  'json.dump(documents, sys.stdout, ensure_ascii=False)',
].join('\n');

/**
 * Les réglages d'ENVIRONNEMENT du cas de référence « les deux analytiques » —
 * celui que les documents rendent.
 *
 * Les noms sont ceux du backend (sans préfixe `VITE_`) : c'est le backend qui
 * écrit les documents. Le build, lui, lit ses propres variables ; le contrat
 * compare les CALCULS, la sonde de production compare les environnements.
 */
export const ENV_DOCUMENTS = {
  BACKEND_PUBLIC_URL: 'https://api.kojo.test',
  PLAUSIBLE_DOMAIN: 'site.kojo.test',
  GA_MEASUREMENT_ID: 'G-ABC123',
};

/** Le cas correspondant, pour calculer la politique attendue. */
export const CAS_DOCUMENTS = {
  api_origin: ENV_DOCUMENTS.BACKEND_PUBLIC_URL,
  plausible_domain: ENV_DOCUMENTS.PLAUSIBLE_DOMAIN,
  ga_measurement_id: ENV_DOCUMENTS.GA_MEASUREMENT_ID,
};

/**
 * Exécute la copie Python sur tous les cas, en UN processus.
 *
 * @param {object} options
 * @param {string} options.python Interpréteur retenu.
 * @param {string} [options.root] Racine du dépôt.
 * @returns {{politiques: string[], error: string}}
 */
export const politiquesPython = ({ python, root = REPO_ROOT }) => {
  const result = spawnSync(python, [path.join(root, 'backend', 'kojo_csp.py'), '--json'], {
    cwd: root,
    input: JSON.stringify(CAS_REFERENCE),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    timeout: 20000,
  });
  if (result.error) return { politiques: [], error: `exécution de ${python} impossible (${result.error.message})` };
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().split('\n').pop() || '';
    return { politiques: [], error: `${python} a échoué (code ${result.status}) ${detail}` };
  }
  try {
    const lues = JSON.parse(String(result.stdout || '[]'));
    return { politiques: Array.isArray(lues) ? lues : [], error: '' };
  } catch (erreur) {
    return { politiques: [], error: `sortie illisible de ${python} (${erreur.message})` };
  }
};

/**
 * Rend les quatre documents pré-rendus et les retourne.
 *
 * @param {object} options
 * @param {string} options.python Interpréteur retenu.
 * @param {string} [options.base] Origine passée au pré-rendu.
 * @param {string} [options.root] Racine du dépôt.
 * @returns {{documents: Array<{nom: string, html: string}>, error: string}}
 */
export const rendreDocuments = ({ python, base = BASE_REFERENCE, root = REPO_ROOT }) => {
  const result = spawnSync(
    python,
    ['-c', DOCUMENTS_SCRIPT, path.join(root, 'backend'), base],
    {
      cwd: root,
      encoding: 'utf8',
      // L'environnement du PROCESSUS : `kojo_csp.csp_du_site()` le lit.
      env: { ...process.env, ...ENV_DOCUMENTS, PYTHONIOENCODING: 'utf-8' },
      timeout: 20000,
    }
  );
  if (result.error) return { documents: [], error: `exécution de ${python} impossible (${result.error.message})` };
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().split('\n').pop() || '';
    return { documents: [], error: `${python} a échoué (code ${result.status}) ${detail}` };
  }
  try {
    const lues = JSON.parse(String(result.stdout || '[]'));
    return { documents: Array.isArray(lues) ? lues : [], error: '' };
  } catch (erreur) {
    return { documents: [], error: `sortie illisible de ${python} (${erreur.message})` };
  }
};

/**
 * Le maillon 3 : la sortie du plugin est comparée à la déclaration.
 *
 * @param {object} [options]
 * @param {Function} [options.plugin] Fabrique de plugin (injectable aux tests).
 * @returns {string[]} Problèmes.
 */
export const comparerPlugin = ({ plugin = injectProductionCspPlugin } = {}) => {
  const erreurs = [];
  const html = '<!DOCTYPE html><html><head><title>t</title></head><body></body></html>';
  const configurations = [
    { label: 'sans analytique', env: {}, apiOrigin: 'https://api.kojo.test' },
    {
      label: 'les deux analytiques',
      env: { VITE_PLAUSIBLE_DOMAIN: 'site.kojo.test', VITE_GA_MEASUREMENT_ID: 'G-ABC123' },
      apiOrigin: 'https://api.kojo.test',
    },
  ];
  for (const { label, env, apiOrigin } of configurations) {
    const resultat = plugin({ env, mode: 'production', apiOrigin }).transformIndexHtml(html);
    const meta = (resultat.tags || []).find(
      (tag) => tag.attrs?.['http-equiv'] === 'Content-Security-Policy'
    );
    const publiee = meta?.attrs?.content || '';
    const attendue = construireCsp({
      apiOrigin,
      plausibleDomain: env.VITE_PLAUSIBLE_DOMAIN,
      gaMeasurementId: env.VITE_GA_MEASUREMENT_ID,
    });
    if (!publiee) {
      erreurs.push(
        `[build, ${label}] le plugin n'injecte AUCUNE meta CSP : la politique déclarée dans ` +
          `src/config/csp.js n'atteint pas les pages du build`
      );
    } else if (publiee !== attendue) {
      erreurs.push(
        `[build, ${label}] le plugin publie une politique qui n'est PAS celle de ` +
          `src/config/csp.js :\n        plugin : ${publiee}\n        déclaré: ${attendue}`
      );
    }
  }
  // En développement, rien n'est injecté (le dev Vite a besoin de scripts
  // inline/HMR) : une politique posée là casserait le HMR en silence.
  const dev = plugin({ env: {}, mode: 'development', apiOrigin: '' }).transformIndexHtml(html);
  if (typeof dev !== 'string' || dev.includes('Content-Security-Policy')) {
    erreurs.push(
      "le plugin injecte une CSP hors production : le serveur de développement (scripts " +
        "inline, HMR) cesserait de fonctionner sans que personne ne relie la panne à la CSP"
    );
  }
  return erreurs;
};

/**
 * Le contrat complet.
 *
 * @param {object} [options]
 * @param {string} [options.root] Racine du dépôt.
 * @param {boolean} [options.quiet] Tait la progression.
 * @param {string} [options.python] Interpréteur imposé (tests).
 * @param {Function} [options.executerPolitiques] Remplace `politiquesPython`.
 * @param {Function} [options.executerDocuments] Remplace `rendreDocuments`.
 * @returns {{ok: boolean, errors: string[], notices: string[], checked: string[], python: string}}
 */
export const runCspContractCheck = (options = {}) => {
  const root = options.root || REPO_ROOT;
  const log = options.quiet ? () => {} : console.log;
  const logError = options.quiet ? () => {} : console.error;
  const executerPolitiques = options.executerPolitiques || politiquesPython;
  const executerDocuments = options.executerDocuments || rendreDocuments;

  const errors = [];
  const notices = [];
  const checked = [];

  // `python: ''` (ou `null`) dit explicitement « aucun interpréteur » : c'est ce
  // qui permet de juger la branche de l'absence sans dépendre de la machine.
  const python =
    options.python === undefined
      ? findPython({ root, base: BASE_REFERENCE })
      : options.python;

  if (!python) {
    const message =
      'aucun interpréteur Python capable d’exécuter backend/kojo_csp.py — la copie Python ' +
      'de la politique du site n’a donc PAS été confrontée à sa déclaration JS, ni les ' +
      'documents pré-rendus à la CSP du site';
    // En CI l'image du runner fournit python3 : ne pas l'avoir là est une panne.
    if (process.env.CI) errors.push(message);
    else {
      notices.push(message);
      logError(`::notice title=${TITRE_ERREUR}::${message}`);
    }
    return { ok: errors.length === 0, errors, notices, checked, python: '' };
  }
  checked.push(`  interpréteur  ${python} → backend/kojo_csp.py (stdlib uniquement)`);

  // ── 1. Les deux calculs, cas par cas ─────────────────────────────────────
  const { politiques: politiquesPy, error: erreurPolitiques } = executerPolitiques({
    python,
    root,
  });
  const politiquesJs = CAS_REFERENCE.map((entree) =>
    construireCsp({
      apiOrigin: entree.api_origin,
      plausibleDomain: entree.plausible_domain,
      gaMeasurementId: entree.ga_measurement_id,
    })
  );
  if (erreurPolitiques) {
    errors.push(`les politiques n’ont pas pu être lues : ${erreurPolitiques}`);
  } else {
    const problemes = comparerPolitiques({ politiquesJs, politiquesPy, cas: CAS_REFERENCE });
    errors.push(...problemes);
    if (!problemes.length) {
      checked.push(
        `  ✓ ${CAS_REFERENCE.length} cas : les deux copies rendent la MÊME politique ` +
          `(${politiquesJs[0].length} à ${Math.max(...politiquesJs.map((p) => p.length))} caractères)`
      );
      // La forme d'un identifiant GA4 est une règle PARTAGÉE : un `UA-…` ne doit
      // rien ouvrir, des deux côtés. Le cas 6 le mesure ; le motif est cité ici
      // pour que la garde dise CE QU'ELLE vérifie.
      checked.push(`  règle GA4    ${GA_MOTIF} — un identifiant invalide n'ouvre aucune origine`);
    }
  }

  // ── 2. Les documents pré-rendus ──────────────────────────────────────────
  const attendu = construireCsp({
    apiOrigin: CAS_DOCUMENTS.api_origin,
    plausibleDomain: CAS_DOCUMENTS.plausible_domain,
    gaMeasurementId: CAS_DOCUMENTS.ga_measurement_id,
  });
  const { documents, error: erreurDocuments } = executerDocuments({ python, root });
  if (erreurDocuments) {
    errors.push(`les documents pré-rendus n’ont pas pu être rendus : ${erreurDocuments}`);
  } else {
    const problemes = comparerDocuments({ documents, attendu });
    errors.push(...problemes);
    if (!problemes.length) {
      checked.push(
        `  ✓ ${documents.map(({ nom }) => nom).join(', ')} : la politique SERVIE est celle du ` +
          `site (${attendu.length} caractères, sans ${DIRECTIVE_ENTETE})`
      );
    }
  }

  // ── 3. Le plugin du build ne contourne pas la déclaration ────────────────
  const problemesPlugin = comparerPlugin();
  errors.push(...problemesPlugin);
  if (!problemesPlugin.length) {
    checked.push('  ✓ le plugin du build publie exactement construireCsp (et rien en développement)');
  }

  if (errors.length) {
    logError(`❌ ${TITRE_ERREUR} — ${errors.length} problème(s) :`);
    for (const message of errors) logError(`   • ${message}`);
    logError(
      `   → la politique est déclarée dans src/config/csp.js ; sa copie Python est ` +
        `backend/kojo_csp.py, et les documents pré-rendus la publient par kojo_csp.balise_csp(). ` +
        `Corriger le côté FAUTIF — les deux calculs doivent rendre la même chaîne pour les mêmes entrées.`
    );
    return { ok: false, errors, notices, checked, python };
  }

  log(checked.join('\n'));
  log(
    `✅ CSP du site tenue hors ligne : une seule déclaration (src/config/csp.js), une copie ` +
      `Python confrontée octet pour octet (${CAS_REFERENCE.length} cas), les quatre documents ` +
      `pré-rendus la publient, et le plugin du build ne peut pas la contourner.`
  );
  return { ok: true, errors, notices, checked, python };
};

/**
 * Le point d'entrée, séparé pour que le code de sortie se juge sans interpréteur.
 *
 * @param {string[]} [argv] Arguments après `node script`.
 * @param {object} [deps] `run`, `log`, `error`.
 * @returns {number} Code de sortie (0 tenu, 1 refus nommé).
 */
export const main = (argv = process.argv.slice(2), { run = runCspContractCheck, log = console.log, error = console.error } = {}) => {
  const resultat = run({ quiet: argv.includes('--quiet') });
  if (!resultat.ok) {
    error(`::error title=${TITRE_ERREUR}::${resultat.errors.length} problème(s) — voir le détail ci-dessus`);
    return 1;
  }
  log('');
  return 0;
};

export const estAppelDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estAppelDirect) {
  process.exit(main());
}
