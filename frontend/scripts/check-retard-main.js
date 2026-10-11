#!/usr/bin/env node
/**
 * COMBIEN la base est-elle en retard sur cette branche de travail, et DEPUIS
 * QUAND la production n'a-t-elle pas été reconstruite ?
 *
 * ── Le trou que ce garde ferme ─────────────────────────────────────────────
 * Le dépôt savait répondre à deux questions voisines, et à aucune des deux
 * mesures qui décident d'une livraison :
 *   • « le frontend servi est-il celui de ce commit ? » (`check-deployed-revision.js`)
 *     — un booléen, sur `main` seulement, qui ne dit ni de COMBIEN la production
 *     est en retard ni depuis QUAND ;
 *   • « ce travail existe-t-il ailleurs que sur ce disque ? » (`check-git-branches.js`)
 *     — une liste de branches, jamais un compte de commits.
 * MESURÉ le 07/10/2026 : dix commits ont attendu d'être livrés, et aucun run ne
 * l'a rappelé — l'arbitrage « on fusionne maintenant » s'est fait sur une
 * mémoire. Ce garde publie les deux nombres qui manquaient, à CHAQUE run :
 *   ‣ le retard en COMMITS : `main` est en retard de N commits sur cette branche
 *     (du contenu qui attend d'être livré), et cette branche est en retard de M
 *     commits sur `main` (ce qu'un rebasage apporterait) ;
 *   ‣ le retard en TEMPS : l'ancienneté du dernier déploiement de production,
 *     lue dans l'en-tête `Last-Modified` de la réponse servie — l'instant où
 *     l'artefact EN LIGNE a été construit (mesuré : 51 s après un commit de
 *     fusion, le temps du build Vercel).
 *
 * ── Ce que le compte brut aurait dit, et pourquoi il est corrigé ───────────
 * Le 08/10/2026, sur ce dépôt, `git rev-list --count origin/main..HEAD` valait
 * **14** et l'attente réelle **0** : la base avait reçu le contenu de la branche
 * par une fusion par SQUASH, donc 14 commits « absents » dont l'arbre est
 * pourtant celui de la base. Un garde qui aurait annoncé 14 ferait chercher un
 * retard inexistant — le rouge qu'on apprend à ignorer. La correction (arbre
 * identique ⇒ 0, sinon attente après le plus ancien commit portant l'arbre de la
 * base) vit dans `scripts/retard-main.js` avec sa mesure.
 *
 * ── Pourquoi ce garde ne rougit PAS tout seul ─────────────────────────────
 * Une branche de travail PORTE par définition des commits non livrés, et un dépôt
 * calme a légitimement un déploiement ancien : un défaut par défaut serait rouge
 * tous les jours, donc lu jamais. Les deux mesures sont donc publiées en
 * `::notice` (et dans le résumé du run), et le refus ne vient que des bornes que
 * l'appelant déclare :
 *   --max-commits N   refuse au-delà de N commits en attente de livraison ;
 *   --max-heures H    refuse au-delà de H heures depuis le dernier déploiement
 *                     — et refuse AUSSI si l'ancienneté n'a pas pu être établie,
 *                     parce qu'une borne ne se vérifie pas sur une inconnue.
 *
 * ── Les trois refus, et ce qu'ils nomment ─────────────────────────────────
 *   1. INVOCATION IMPOSSIBLE (code 2) : une borne qui n'est pas un nombre ≥ 0, ou
 *      une `--base-url` locale — ce garde mesure la PRODUCTION ; un site de poste
 *      ne dit rien du déploiement. Le mode hors ligne est DÉCLARÉ
 *      (`--sans-production`, l'ancienneté est alors « inconnue », jamais 0).
 *   2. LECTURE IMPOSSIBLE (code 1) : aucune base à comparer (ni `origin/HEAD`, ni
 *      `origin/main`, ni `main`), ou git illisible. « Pas de base » n'est pas un
 *      zéro : un garde qui ne peut pas lire son sujet échoue au lieu de se taire.
 *   3. BORNE DÉPASSÉE (code 1) : une ligne par borne, jamais un « échec » global.
 *
 * Usage :
 *   cd frontend && node scripts/check-retard-main.js
 *   … --base origin/main --max-commits 5 --max-heures 48
 *   … --sans-production                 (hors ligne : la production n'est pas interrogée)
 *   … --summary "$GITHUB_STEP_SUMMARY"  (défaut : la variable d'environnement)
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// La lecture de git a UN propriétaire (`check-git-branches.js`) : réécrire ici un
// `spawnSync('git', …)` donnerait deux façons de lire le dépôt, donc deux
// occasions de diverger sur ce qu'est une lecture ratée.
import { lireGit, lireObligatoire } from './check-git-branches.js';
// La sonde de production a UN propriétaire, elle aussi : elle nomme le défi de
// sécurité de l'edge Vercel (mesuré le 20/09/2026) et rend avec le corps les
// en-têtes qui datent le déploiement.
import { interroger, revisionServie } from './check-deployed-revision.js';
import { SITE_ORIGIN, isLoopbackUrl } from './site-meta.js';
import {
  ageDeploiement,
  attenteDeLivraison,
  phraseDeRetard,
  phraseDeploiement,
  verdictDeRetard,
} from './retard-main.js';

/** Candidats de base, dans l'ordre, quand `origin/HEAD` ne dit rien. */
export const BASES_CANDIDATES = ['origin/main', 'origin/master', 'main', 'master'];

/**
 * Les options de la ligne de commande, sans jamais conclure sur du vide.
 *
 * Une borne qui n'est pas un nombre ≥ 0 ÉCHOUE (code 2) : elle serait ignorée en
 * silence, et le garde aurait l'air de tenir une borne qu'il ne peut pas lire.
 *
 * @param {string[]} argv Arguments (sans `node` ni le script).
 * @returns {{base: string, maxCommits: number|null, maxHeures: number|null, sansProduction: boolean, baseUrl: string, resume: string, tete: string, markdown: string}}
 */
export function lireOptions(argv = []) {
  const valeurDe = (nom) => {
    const index = argv.indexOf(nom);
    return index === -1 ? '' : String(argv[index + 1] ?? '');
  };
  const bornes = [];
  const invalides = [];
  for (const nom of ['--max-commits', '--max-heures']) {
    const brut = valeurDe(nom);
    if (!brut) {
      bornes.push(null);
      continue;
    }
    const nombre = Number(brut);
    if (!Number.isFinite(nombre) || nombre < 0) invalides.push(`${nom} « ${brut} »`);
    else bornes.push(nombre);
  }
  if (invalides.length) {
    throw new Error(
      `borne(s) illisible(s) (${invalides.join(', ')}) : une borne qui n'est pas un nombre ≥ 0 ` +
        'ne peut pas être tenue — elle serait ignorée en silence, donc le garde aurait l\'air de ' +
        'vérifier ce qu\'il ne lit pas.'
    );
  }
  return {
    base: valeurDe('--base'),
    maxCommits: bornes[0],
    maxHeures: bornes[1],
    sansProduction: argv.includes('--sans-production'),
    baseUrl: valeurDe('--base-url') || SITE_ORIGIN,
    resume: valeurDe('--summary'),
    tete: valeurDe('--tete'),
    markdown: valeurDe('--markdown'),
  };
}

/**
 * La base à comparer : celle qu'on demande, sinon `origin/HEAD`, sinon un candidat.
 *
 * @param {string} cwd Répertoire du dépôt.
 * @param {string} demandee `--base` (peut être vide).
 * @param {Function} lire Lecteur git injectable.
 * @returns {string|null} La réf de base, ou null si aucune n'existe.
 */
export function resoudreBase(cwd, demandee, lire = lireGit) {
  if (demandee) return demandee;
  const tete = lire(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
  if (tete.ok && tete.lignes[0]) return tete.lignes[0];
  return BASES_CANDIDATES.find((candidat) => lire(['rev-parse', '--verify', '--quiet', `${candidat}^{commit}`], cwd).ok) || null;
}

/**
 * Nommer la branche de travail, détachée comprise.
 *
 * @param {string} cwd Répertoire du dépôt.
 * @param {Function} lire Lecteur git injectable.
 * @returns {string} Le nom de branche, ou « HEAD détaché (abc1234) ».
 */
export function nomDeLaBranche(cwd, lire = lireGit) {
  const nom = lire(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const valeur = nom.ok ? (nom.lignes[0] || '') : '';
  if (valeur && valeur !== 'HEAD') return valeur;
  const sha = lire(['rev-parse', '--short', 'HEAD'], cwd);
  return `HEAD détaché (${sha.ok ? sha.lignes[0] : '?'})`;
}

/**
 * Les faits de git nécessaires au retard — aucune conclusion n'est rendue ici.
 *
 * @param {object} [options]
 * @param {string} [options.cwd] Répertoire du dépôt.
 * @param {string} [options.base] Réf de base demandée.
 * @param {number} [options.maintenant] Horloge, en ms.
 * @param {Function} [options.lire] Lecteur git injectable.
 * @returns {object} Branche, base, comptes, et l'attente corrigée du squash.
 */
export function mesurer({ cwd = process.cwd(), base: baseDemandee = '', maintenant = Date.now(), lire = lireGit, tete = 'HEAD' } = {}) {
  const base = resoudreBase(cwd, baseDemandee, lire);
  if (!base) {
    throw new Error(
      `aucune base à comparer (ni ${baseDemandee ? `« ${baseDemandee} »` : BASES_CANDIDATES.join(', ')}) : ` +
        'le retard ne peut pas être mesuré, et « pas de base » n\'est pas un zéro — un dépôt sans réf ' +
        'distante ne prouve pas que tout est livré.'
    );
  }
  // Une révision donnée (`--tete`, typiquement la tête de la PR) remplace HEAD :
  // sur un événement `pull_request`, HEAD est le commit de FUSION simulé, qui
  // contient déjà `main` et donnerait toujours 0 de retard.
  const branche = tete === 'HEAD'
    ? nomDeLaBranche(cwd, lire)
    : `révision ${lireObligatoire(['rev-parse', '--short', tete], cwd, lire)[0]}`;
  const arbreBase = lireObligatoire(['rev-parse', `${base}^{tree}`], cwd, lire)[0];
  const arbreTete = lireObligatoire(['rev-parse', `${tete}^{tree}`], cwd, lire)[0];
  const [retardBranche, absents] = lireObligatoire(
    ['rev-list', '--left-right', '--count', `${base}...${tete}`], cwd, lire
  )[0].split(/\s+/).map(Number);
  // `--reverse` : du plus ANCIEN au plus récent — la correction du squash lit le
  // PREMIER commit dont l'arbre est celui de la base, donc l'ordre est le sujet.
  const commits = lireObligatoire(
    ['log', '--reverse', '--format=%H%x09%T%x09%ct', `${base}..${tete}`], cwd, lire
  ).map((ligne) => {
    const [sha, arbre, quand] = ligne.split('\t');
    return { sha, arbre, quandMs: Number(quand) * 1000 };
  });
  const attente = attenteDeLivraison({ commits, arbreBase, arbreTete, maintenant });
  return { branche, base, arbreBase, arbreTete, retardBranche, absents, commits, attente };
}

/**
 * Interroge la production : la révision servie, et l'âge du dernier déploiement.
 *
 * @param {object} options `baseUrl`, `fetchImpl`, `maintenant`.
 * @returns {Promise<{revision: string, ageMs: number|null, construit: Date|null, source: string, erreur: string|null}>}
 */
async function interrogerProduction({ baseUrl, fetchImpl = fetch, maintenant = Date.now() }) {
  const { html, erreur, entetes = {} } = await interroger(baseUrl, { fetchImpl });
  if (html === null) {
    return { revision: '', ageMs: null, construit: null, source: '', erreur };
  }
  const age = ageDeploiement(entetes, { maintenant });
  return {
    revision: revisionServie(html),
    ageMs: age.ms,
    construit: age.construit,
    source: age.source,
    erreur: age.erreur,
  };
}

/**
 * Le résumé Markdown de la passe, écrit dans le fichier que GitHub agrège.
 *
 * @param {Array<string>} lignes Lignes du rapport.
 * @param {string} cheminFichier Chemin du résumé (`$GITHUB_STEP_SUMMARY`).
 */
export function ecrireResume(lignes, cheminFichier) {
  if (!cheminFichier) return;
  try {
    appendFileSync(
      cheminFichier,
      ['### Retard de livraison et âge de la production', '', ...lignes.map((ligne) => `- ${ligne}`), ''].join('\n'),
      'utf8'
    );
  } catch {
    // Un résumé illisible n'invalide pas la mesure : le verdict est dans les
    // annotations du run, pas dans ce fichier.
  }
}

/**
 * @param {string[]} [argv]
 * @param {object} [options] `cwd`, `fetchImpl`, `maintenant`, `resumePath`, `lire`.
 * @returns {Promise<number>} Code de sortie.
 */
export async function main(argv = process.argv.slice(2), options = {}) {
  const {
    cwd = process.cwd(),
    fetchImpl = fetch,
    maintenant = () => Date.now(),
    resumePath = process.env.GITHUB_STEP_SUMMARY,
    lire = lireGit,
  } = options;

  let reglages;
  try {
    reglages = lireOptions(argv);
  } catch (error) {
    console.error(`::error title=Retard de livraison — invocation impossible::${error.message}`);
    return 2;
  }

  if (!reglages.sansProduction && isLoopbackUrl(reglages.baseUrl)) {
    console.error(
      `::error title=Retard de livraison — invocation impossible::base locale (${reglages.baseUrl}) : ce ` +
        'garde mesure la PRODUCTION (l\'artefact que l\'hébergeur sert) ; un site de poste ne dit rien du ' +
        'déploiement. Pour un contrôle hors ligne, dire --sans-production (l\'ancienneté est alors ' +
        '« inconnue », jamais 0).'
    );
    return 2;
  }

  let faits;
  try {
    faits = mesurer({ cwd, base: reglages.base, maintenant: maintenant(), lire, tete: reglages.tete || 'HEAD' });
  } catch (error) {
    console.error(`::error title=Retard de livraison — lecture impossible::${error.message}`);
    return 1;
  }

  const production = reglages.sansProduction
    ? {
      revision: '',
      ageMs: null,
      construit: null,
      source: '',
      erreur:
        'production non interrogée (--sans-production) : l\'ancienneté du déploiement n\'est pas mesurée ' +
        'sur un poste hors ligne, et elle n\'est pas supposée nulle pour autant.',
    }
    : await interrogerProduction({ baseUrl: reglages.baseUrl, fetchImpl, maintenant: maintenant() });

  // LES DEUX MESURES SONT PUBLIÉES MÊME QUAND LE VERDICT PASSE : c'est tout
  // l'objet de ce garde — un chiffre qui n'apparaît que le jour où il rougit ne
  // sert à aucun arbitrage.
  const phraseRetard = phraseDeRetard({
    branche: faits.branche,
    base: faits.base,
    enAttente: faits.attente.enAttente,
    absents: faits.absents,
    retardBranche: faits.retardBranche,
    motif: faits.attente.motif,
    depuisMs: faits.attente.depuisMs,
  });
  const phraseProd = phraseDeploiement({
    revision: production.revision,
    ageMs: production.ageMs,
    construit: production.construit,
    source: production.source,
    erreur: production.erreur,
  });
  for (const mesure of [phraseRetard, phraseProd]) {
    console.log(`::notice title=Retard de livraison::${mesure}`);
  }
  // Les deux phrases, en liste Markdown : le rapport de taille les reprend dans
  // le commentaire de PR. Écrit AVANT le verdict, pour qu'une borne dépassée ne
  // prive pas le commentaire de la mesure qu'il vient afficher.
  if (reglages.markdown) {
    mkdirSync(path.dirname(reglages.markdown), { recursive: true });
    writeFileSync(reglages.markdown, `${[phraseRetard, phraseProd].map((p) => `- ${p}`).join('\n')}\n`, 'utf8');
  }

  const verdict = verdictDeRetard({
    enAttente: faits.attente.enAttente,
    ageMs: production.ageMs,
    maxCommits: reglages.maxCommits,
    maxHeures: reglages.maxHeures,
  });
  ecrireResume([
    `${phraseRetard}`,
    `${phraseProd}`,
    verdict.ok
      ? 'Aucune borne déclarée n\'est dépassée.'
      : `**Borne(s) dépassée(s)** : ${verdict.raisons.join(' ; ')}`,
  ], reglages.resume || resumePath);

  if (!verdict.ok) {
    for (const raison of verdict.raisons) console.error(`::error title=Retard de livraison::${raison}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
