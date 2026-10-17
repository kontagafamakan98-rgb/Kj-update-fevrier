#!/usr/bin/env node
/**
 * LE CORPUS « MISSIONS VIVANTES » EST-IL LISIBLE PAR DES SONDES DÉCLARÉES, ET
 * CHAQUE SURFACE AVEUGLE EST-ELLE DÉCLARÉE ?
 *
 * ── Le trou que ce garde ferme ──────────────────────────────────────────────
 * Mesuré le 12/10/2026 : la production ne servait aucune mission vivante
 * (`/api/jobs?status=open` → `[]`, sitemap de 8 URL dont zéro fiche,
 * `open_jobs: 0`), et trois sondes de production — `check-og-images.js`,
 * `check-og-job-200.js`, `check-seo-production.js` — passaient au vert en
 * annonçant chacune qu'elle n'avait rien pu mesurer, à voix basse (`::notice`).
 * Un lecteur du résumé ne pouvait pas distinguer « vérifié » de « rien mesuré » :
 * c'est la forme de silence que F9 a coûtée.
 *
 * La règle est désormais écrite dans `scripts/corpus-missions.js` : le corpus est
 * déclaré (son plancher), chaque surface aveugle est déclarée (chemin, motif,
 * remède, date), et une sonde qui atteint cet état DEMANDE son verdict — elle
 * publie un `::warning` si la surface est déclarée, elle REFUSE (sortie 1) si
 * elle ne l'est pas. Ce garde-ci porte ce que la règle pure ne peut pas voir :
 *
 *   1. PÉRIMÈTRE — tout fichier de `scripts/` qui LIT le corpus
 *      (`fetch…` sur `/api/jobs`, écrit en clair ou par un identifiant qui vaut
 *      ce chemin) doit être déclaré dans `SONDES`. Une sonde ajoutée demain est
 *      donc couverte sans être inscrite nulle part : c'est le dossier qui est
 *      balayé. Les mentions du chemin dans un COMMENTAIRE ne comptent pas — le
 *      corpus est cité en prose dans `lhci-cls-budgets.cjs`,
 *      `mesure-lighthouse-locale.mjs` et `vercel-rewrite-server.js`, et compter
 *      une phrase pour une lecture ferait crier le garde sur des fichiers qui ne
 *      lisent rien.
 *   2. DÉCLARATION PÉRIMÉE — une surface déclarée que sa sonde ne demande jamais
 *      (la clé est introuvable dans son fichier), une surface déclarée par une
 *      sonde qui ne lit plus le corpus, une sonde déclarée qui a disparu. Une
 *      exemption que plus rien ne justifie finira par justifier autre chose.
 *   3. DÉCLARATION MUETTE — une sonde déclarée qui ne consulte pas
 *      `verdictDeSurfaceVide`, ou qui ne publie aucun `::warning` : elle peut
 *      alors ne rien mesurer SANS le dire, et la déclaration ne sert à rien.
 *   4. QUALITÉ DE LA DÉCLARATION — motif < 40 caractères, remède < 20, date qui
 *      n'est pas ISO, chemin vide, corpus inconnu, clé vide ou dupliquée.
 *   5. PLANCHERS DE LECTURE — sous 30 fichiers balayés, 3 sondes, 3 surfaces et
 *      1 corpus, il refuse de conclure : un balayage cassé rendrait tous ses
 *      refus muets en rendant son périmètre vide, et c'est exactement ce qui
 *      passerait pour un vert.
 *
 * Ce qu'il ne juge pas, et qui est écrit plutôt que tu : si le corpus DEVRAIT
 * être vide (décision d'exploitation, publiée en `::warning` à chaque run par
 * les sondes elles-mêmes), et si une surface déclarée est mesurable ailleurs (ce
 * que son motif et son remède disent, et que le garde publie à chaque passage).
 *
 * Usage : node scripts/check-corpus-missions.js   (depuis frontend/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CORPUS,
  PLANCHERS_LECTURE,
  REGISTRE,
  SONDES,
  SURFACES,
  auditerInventaire,
} from './corpus-missions.js';

// Le dépôt est résolu depuis CE fichier : le garde tourne depuis `frontend/`
// (étape de CI) comme depuis la racine, sans variable d'environnement.
const ICI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ICI, '..', '..');
const SCRIPTS_REL = path.relative(REPO, ICI).split(path.sep).join('/');

/** Les fichiers balayés : tout script de `scripts/`, sauf les tests (dossier). */
export function fichiersBalayes(racine = ICI) {
  const extensions = new Set(['.js', '.cjs', '.mjs']);
  return fs
    .readdirSync(racine, { withFileTypes: true })
    .filter((entree) => entree.isFile() && extensions.has(path.extname(entree.name)))
    .map((entree) => entree.name)
    .sort();
}

/**
 * Lit chaque fichier balayé et rend la table `chemin → source` attendue par
 * `auditerInventaire` (`null` = illisible, jamais une exception : une lecture
 * impossible est un refus nommé, pas un plantage).
 */
export function lireLesSources(racine = ICI, fichiers = fichiersBalayes(racine)) {
  const sources = {};
  for (const nom of [...fichiers, path.basename(REGISTRE)]) {
    const chemin = `${SCRIPTS_REL}/${nom}`;
    try {
      sources[chemin] = fs.readFileSync(path.join(racine, nom), 'utf8');
    } catch (_erreur) {
      sources[chemin] = null;
    }
  }
  return sources;
}

/** Le verdict complet, sans E/S autres que les lectures de sources. */
export function verifierInventaire({ racine = ICI } = {}) {
  const fichiers = fichiersBalayes(racine);
  const sources = lireLesSources(racine, fichiers);
  const { refus, lues } = auditerInventaire(sources);
  return { refus, lues, fichiers };
}

const estAppelDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estAppelDirect) {
  const { refus, lues, fichiers } = verifierInventaire();

  console.log(`Corpus de production et surfaces aveugles (${fichiers.length} fichier(s) balayé(s)) :`);
  for (const [cle, corpus] of Object.entries(CORPUS)) {
    console.log(
      `  corpus « ${cle} » — plancher ${corpus.plancher} : ${corpus.label} (${corpus.lecture})`
    );
  }
  for (const surface of SURFACES) {
    const sonde = Object.prototype.hasOwnProperty.call(SONDES, surface.sonde) ? 'déclarée' : 'INCONNUE';
    console.log(
      `  surface « ${surface.cle} » (${surface.sonde}, sonde ${sonde}, ${surface.depuis}) : ` +
        `${surface.chemin}`
    );
  }
  console.log(
    `  → ${lues.fichiers} fichier(s) lu(s), ${lues.sondes} sonde(s), ${lues.surfaces} surface(s), ` +
      `${lues.corpus} corpus — planchers ${JSON.stringify(PLANCHERS_LECTURE)}`
  );

  if (refus.length) {
    console.error(`\n❌ Inventaire du corpus non tenu (${refus.length} refus) :`);
    for (const ligne of refus) console.error(`  • ${ligne}`);
    console.error(
      `\n   → corriger la déclaration dans ${REGISTRE}, ou la sonde fautive. Une sonde qui ne ` +
        `peut plus rien mesurer PUBLIE un ::warning quand sa surface est déclarée, et REFUSE ` +
        `quand elle ne l'est pas (un vert sans mesure est le silence que F9 a coûté).`
    );
    process.exit(1);
  }
  console.log(
    `\n✅ ${lues.surfaces} surface(s) aveugle(s) déclarée(s) pour ${lues.sondes} sonde(s) : ` +
      `chaque lecture du corpus est déclarée, chaque déclaration est demandée par sa sonde et ` +
      `publiée en ::warning.`
  );
}
