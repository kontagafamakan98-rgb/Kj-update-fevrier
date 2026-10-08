#!/usr/bin/env node
/**
 * Contrôle de FIN DE PASSE : ce qui reste ouvert, joignable ou traînant quand
 * la passe est finie.
 *
 *   1. un serveur de test encore en écoute — la liste des ports vient de
 *      playwright.config.js et du serveur de rewrites, jamais recopiée ;
 *   2. une URL de Preview qui pointe sur un port mort ;
 *   3. une hygiène git propre : branches locales fusionnées et réfs distantes
 *      orphelines, déléguée au module scripts/check-git-branches.js ;
 *   4. du travail qui n'existe QUE sur ce disque : une branche locale dont la
 *      tête n'est contenue dans aucune réf distante. Ce dernier verdict ne
 *      bloque JAMAIS — voir `verdictDeLaPasse` — mais il est nommé dans les
 *      deux modes, parce que c'est la fin de passe qui l'a demandé.
 *   5. le NETTOYAGE d'une réf distante orpheline n'est plus seulement nommé :
 *      il est PROPOSÉ, et exécuté après accord (`proposerLeNettoyage`).
 *      L'accord se demande SUR LE TERMINAL — la question sur `process.stderr`,
 *      la réponse sur `/dev/tty` —, parce que le pré-vol tourne dans un hook,
 *      où l'entrée standard est le tuyau qui porte les réfs. Sans terminal (CI,
 *      test, sortie redirigée) il n'y a personne à qui demander : rien n'est
 *      supprimé, et le remède reste nommé. Un résidu nettoyé est RE-MESURÉ
 *      avant le verdict, sinon le pré-vol refuserait le push qu'il vient de
 *      nettoyer.
 *
 * DEUX MODES, un seul propriétaire du partage (`verdictDeLaPasse`) :
 *   * fin de passe — tout compte, on remet tout à zéro ;
 *   * pré-vol de push (`--avant-push`) — les résidus de passe bloquent, le reste
 *     est rappelé. `.githooks/pre-push` l'appelle avant chaque push ; son coût
 *     et ses limites sont mesurés, pas supposés.
 */
import { connect } from 'node:net';
import { closeSync, openSync, readSync } from 'node:fs';
import { get as getHttp } from 'node:http';
import { get as getHttps } from 'node:https';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  CHAMPS_REF_DISTANTE,
  lireGit,
  mesurerBranches,
  nettoyerResidus,
  planDeNettoyage,
} from './check-git-branches.js';

// Ré-exporté pour que les consommateurs et fixtures existants continuent de fonctionner
export { CHAMPS_REF_DISTANTE, lireGit, mesurerBranches, nettoyerResidus, planDeNettoyage };

// ── Le nettoyage d'un résidu, PROPOSÉ puis exécuté après accord ─────────────

// Ce qui vaut accord, et rien d'autre : le silence, une ligne vide, un « n » ou
// une réponse qu'on n'a pas demandée ne suppriment jamais rien. Un défaut
// d'interface qui EXÉCUTE par défaut n'est pas un confort, c'est une perte.
export const MOTS_D_ACCORD = ['o', 'oui', 'y', 'yes'];

// Refuser la question elle-même, pour qui veut le pré-vol sans cette étape.
export const ENV_SANS_NETTOYAGE = 'KOJO_SANS_NETTOYAGE_RESIDUS';

// Posée par `.githooks/pre-push` quand le push vient d'un terminal (voir là-bas
// pourquoi c'est le SHELL qui le mesure).
export const ENV_TERMINAL = 'KOJO_PRE_VOL_TERMINAL';

/**
 * Y a-t-il quelqu'un pour répondre ?
 *
 * Deux mesures, et une exclusion. Le hook sait qu'il a un terminal (le shell
 * teste `[ -t 2 ]` à l'instant où l'humain a lancé son push) et le dit par
 * `KOJO_PRE_VOL_TERMINAL` ; une invocation DIRECTE depuis un terminal se
 * reconnaît à `stderr` en TTY. L'exclusion, elle, n'est pas un confort : une
 * suite de tests lancée dans un terminal a bien un TTY, mais aucun humain en
 * face — sans elle, elle resterait en attente d'une réponse qui ne viendra
 * jamais, et poser une question qu'on ne peut pas entendre est exactement ce
 * que ce module existe pour éviter.
 */
export function estUnHumainAuBout({ env = process.env } = {}) {
  if (env.VITEST) return false;
  return Boolean(env[ENV_TERMINAL]) || Boolean(process.stderr.isTTY);
}

/**
 * Une ligne lue sur le TERMINAL — et `null` quand il n'y en a pas.
 *
 * `/dev/tty` est le seul canal utilisable ici : dans un hook, git a déjà
 * consommé l'entrée standard pour passer ses réfs, donc lire `stdin` ne
 * demanderait rien à personne et lirait des octets qui n'ont pas été tapés. Un
 * environnement sans terminal (CI, `execFile`) fait échouer l'ouverture : c'est
 * le cas le plus important, et il doit être SILENCIEUX plutôt qu'attendre.
 */
export function lireUneLigneDuTerminal({ ouvrir = openSync, fermer = closeSync, lire = readSync } = {}) {
  let fd;
  try {
    fd = ouvrir('/dev/tty', 'r');
  } catch {
    return null;
  }
  try {
    const octet = Buffer.alloc(1);
    let reponse = '';
    for (let index = 0; index < 512; index += 1) {
      if (lire(fd, octet, 0, 1, null) === 0) break;
      const caractere = octet.toString('utf8');
      if (caractere === '\n' || caractere === '\r') break;
      reponse += caractere;
    }
    return reponse;
  } catch {
    return null;
  } finally {
    try {
      fermer(fd);
    } catch {
      // Un descripteur qu'on n'arrive pas à fermer ne change pas la réponse.
    }
  }
}

/**
 * Poser la question et rendre la réponse brute (jamais interprétée ici : c'est
 * `proposerLeNettoyage` qui décide ce qui vaut accord). La question part sur
 * `stderr` — le flux que le push lancé par un humain a hérité du terminal — et
 * la réponse est lue sur `/dev/tty`.
 */
export function demanderAccordAuTerminal(question, {
  ecrire = (texte) => process.stderr.write(texte),
  lireLeTerminal = lireUneLigneDuTerminal,
} = {}) {
  ecrire(question);
  const reponse = lireLeTerminal();
  if (reponse === null) return null;
  ecrire('\n');
  return reponse.trim().toLowerCase();
}

/**
 * PROPOSER le nettoyage des réfs distantes orphelines, et l'exécuter APRÈS
 * accord — jamais avant, jamais sans.
 *
 * Ce que chaque refus fait, et pourquoi :
 *   * rien à nettoyer → aucun plan, aucune question ;
 *   * `KOJO_SANS_NETTOYAGE_RESIDUS` posée → l'utilisateur a demandé qu'on ne lui
 *     pose pas la question, mais les commandes restent ÉCRITES (un refus qui
 *     cacherait le remède obligerait à le rechercher) ;
 *   * pas de terminal → personne à qui demander ; le verdict qui suit nomme le
 *     remède, donc rien n'est perdu non plus ;
 *   * réponse qui n'est pas un accord → RIEN n'est exécuté, et c'est dit.
 *
 * L'exécution rend des résultats PAR RÉFIDU (« réf encore là ? »), parce que
 * c'est ce que l'appelant doit relire avant de conclure.
 */
export function proposerLeNettoyage(branches, {
  cwd = process.cwd(),
  nettoyer = nettoyerResidus,
  demander = demanderAccordAuTerminal,
  journal = (texte) => console.log(`::notice::${texte}`),
  estDemandable = () => estUnHumainAuBout({ env }),
  env = process.env,
} = {}) {
  const plan = planDeNettoyage(branches?.residusDistants ?? []);
  if (!plan.length) return { plan, accord: null, resultats: [] };
  if (env[ENV_SANS_NETTOYAGE]) {
    journal(
      `nettoyage non proposé (${ENV_SANS_NETTOYAGE} posée) : ${plan.length} réf(s) distante(s) orpheline(s) — ` +
        plan.map((etape) => etape.commande).join(' ; '),
    );
    return { plan, accord: null, resultats: [] };
  }
  if (!estDemandable()) return { plan, accord: null, resultats: [] };
  const question = [
    `pré-vol : ${plan.length} résidu(s) de passe — nettoyage proposé`,
    ...plan.map((etape) => `  · réf distante « ${etape.ref} » (${etape.raison})\n    ${etape.commande}`),
    'Nettoyer maintenant ? [o/N] ',
  ].join('\n');
  const accord = demander(question);
  if (!MOTS_D_ACCORD.includes(accord)) {
    journal('nettoyage refusé — rien n\'a été touché ; le résidu reste nommé ci-dessous');
    return { plan, accord: false, resultats: [] };
  }
  const resultats = nettoyer(plan, { cwd });
  for (const resultat of resultats) {
    journal(
      resultat.ok
        ? `résidu nettoyé — ${resultat.ref} (${resultat.par})`
        : `nettoyage impossible — ${resultat.ref} : ${resultat.erreur || 'la réf est encore là après élagage'}`,
    );
  }
  return { plan, accord: true, resultats };
}

/**
 * Charge la liste des serveurs de test de manière DYNAMIQUE.
 *
 * `playwright.config.js` importe `@playwright/test` (~390 ms d'import mesuré).
 * En mode pré-vol de push (`--avant-push`), seuls les résidus git comptent :
 * charger Playwright à chaque push pour ne rien en faire coûtait la moitié du
 * temps du hook. Cette fonction n'est donc appelée qu'en fin de passe, quand
 * les ports doivent réellement être sondés.
 */
export async function chargerServeursTest() {
  const { default: playwrightConfig } = await import('../playwright.config.js');
  const { DEFAULT_PORT: REWRITE_SERVER_PORT } = await import('./vercel-rewrite-server.js');
  const playwrightServers = (playwrightConfig.webServer || []).map(({ command, url }) => ({
    port: Number(new URL(url).port),
    owner: command,
  }));
  return [
    { port: 3000, owner: 'Vite dev server' },
    ...playwrightServers,
    { port: REWRITE_SERVER_PORT, owner: 'scripts/vercel-rewrite-server.js' },
    { port: Number(process.env.PORT) || 8123, owner: 'playtest API fixture' },
    { port: 8000, owner: 'CI local backend' },
  ].filter(({ port }, index, all) => all.findIndex((server) => server.port === port) === index);
}

export function isListening(port) {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/**
 * Les arguments d'une invocation : le MODE et les onglets de Preview déclarés.
 *
 * Deux modes, deux contrats. Le contrôle de FIN DE PASSE exige une déclaration
 * explicite des onglets : un vert dit ce qui a été regardé. Le PRÉ-VOL DE PUSH
 * (`.githooks/pre-push`) ne regarde pas l'environnement de travail — il le
 * rappelle (voir `verdictDeLaPasse`) —, donc il n'a rien à déclarer.
 */
export function actionsDesArguments(args) {
  const previewUrls = [];
  let avantPush = false;
  let ongletsDeclares = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--avant-push') {
      avantPush = true;
      continue;
    }
    if (args[index] === '--no-preview-tabs') {
      ongletsDeclares = true;
      continue;
    }
    if (args[index] !== '--preview-url' || !args[index + 1]) {
      throw new Error(`argument inconnu ou incomplet : ${args[index]}`);
    }
    previewUrls.push(args[++index]);
  }
  if (avantPush && (ongletsDeclares || previewUrls.length)) {
    throw new Error('--avant-push ne se combine pas à une déclaration d’onglets de Preview');
  }
  if (ongletsDeclares && previewUrls.length) throw new Error('--no-preview-tabs ne peut pas être combiné à --preview-url');
  if (!avantPush && !ongletsDeclares && previewUrls.length === 0) {
    throw new Error('déclarer les onglets avec --preview-url URL, ou confirmer leur absence avec --no-preview-tabs, ou demander le pré-vol avec --avant-push');
  }
  return { avantPush, previewUrls };
}

/**
 * Ce qui BLOQUE une invocation, et ce qui est seulement RAPPELÉ.
 *
 * En fin de passe, tout compte : c'est le moment de tout remettre à zéro. En
 * pré-vol de push, seuls les RÉSIDUS DE PASSE bloquent — l'état git que le push
 * s'apprête à publier. Un serveur de dev encore ouvert est légitime pendant
 * qu'on travaille : un garde qui bloque là-dessus n'apprend rien, il apprend à
 * passer outre (`--no-verify`), c'est-à-dire à ignorer le garde.
 *
 * C'est le SEUL endroit où ce partage est décidé — le hook ne fait que propager
 * le code de sortie.
 */
export const verdictDeLaPasse = ({ avantPush, branches, environnement }) => ({
  bloquants: avantPush ? branches.issues : [...branches.issues, ...environnement],
  // Le travail non publié est toujours RAPPELÉ et jamais bloquant : à l'instant
  // où le pré-vol tourne, la branche qu'on pousse EST du travail non publié —
  // refuser là-dessus reviendrait à refuser le geste qui le publie, et il ne
  // resterait que `--no-verify`, c'est-à-dire l'habitude d'ignorer le garde. Le
  // pré-vol retire même de cette liste les branches que CE push publie (voir
  // KOJO_BRANCHES_POUSEES) : un rappel qui nomme à chaque push ce que le push
  // publie ne serait plus lu.
  rappels: [...(branches.publication?.lignes ?? []), ...(avantPush ? environnement : [])],
});

/**
 * Les rappels sont AFFICHÉS dans les deux modes, avant le verdict : c'est tout
 * leur intérêt — ils doivent être lus à la fin de chaque passe, y compris
 * quand tout le reste est vert.
 */
export function afficherLesRappels(rappels) {
  for (const rappel of rappels) console.log(`::notice::${rappel}`);
}

export function isPreviewReachable(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const get = url.protocol === 'https:' ? getHttps : getHttp;
    const request = get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(true);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

export async function checkTestEnvironment({
  ports = null,
  previewUrls = [],
  branches = { issues: [], examinees: 0, distantes: 0 },
  isListeningImpl = isListening,
  isPreviewReachableImpl = isPreviewReachable,
} = {}) {
  const listePorts = ports ?? (await chargerServeursTest());
  const occupied = await Promise.all(listePorts.map(async (server) => {
    const entry = typeof server === 'number' ? { port: server, owner: 'serveur de test' } : server;
    return (await isListeningImpl(entry.port))
      ? `serveur de test encore ouvert sur le port ${entry.port} (${entry.owner})`
      : null;
  }));
  const stalePreviews = await Promise.all(previewUrls.map(async (urlString) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      return `URL de Preview invalide : ${urlString}`;
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      return `URL de Preview invalide : ${urlString}`;
    }
    return (await isPreviewReachableImpl(url))
      ? null
      : `onglet Preview sans serveur joignable : ${url.href}`;
  }));
  return [...occupied, ...stalePreviews, ...branches.issues].filter(Boolean);
}

export async function main(
  args = process.argv.slice(2),
  { mesurer = mesurerBranches, cwd = process.cwd(), nettoyage = {} } = {},
) {
  let avantPush;
  let previewUrls;
  try {
    ({ avantPush, previewUrls } = actionsDesArguments(args));
  } catch (error) {
    console.error(`::error::${error.message}`);
    return false;
  }
  let branches;
  try {
    branches = mesurer({ cwd });
  } catch (error) {
    branches = { issues: [`branches : lecture impossible (${error.message})`], examinees: 0, distantes: 0, publication: { jugees: 0, lignes: [] } };
  }
  if (avantPush) {
    // Le résidu est proposé au nettoyage AVANT le verdict, et les réfs sont
    // relues s'il a été nettoyé : sans cette relecture, le pré-vol refuserait le
    // push au nom d'un résidu qu'il vient lui-même de faire disparaître.
    const { resultats } = proposerLeNettoyage(branches, { cwd, ...nettoyage });
    if (resultats.some((resultat) => resultat.ok)) {
      try {
        branches = mesurer({ cwd });
      } catch {
        // La relecture impossible laisse les résidus nommés : refuser reste la
        // seule réponse honnête quand on ne peut plus lire son sujet.
      }
    }
    const { bloquants, rappels } = verdictDeLaPasse({ avantPush: true, branches, environnement: [] });
    afficherLesRappels(rappels);
    if (bloquants.length) {
      for (const issue of bloquants) console.error(`::error::${issue}`);
      return false;
    }
    console.log(
      `Pré-vol de push : ${branches.examinees} branche(s) locale(s) suivie(s) et ${branches.distantes} réf(s) distante(s) sans branche locale, ` +
        `${branches.publication?.jugees ?? 0} branche(s) locale(s) jugée(s) pour la publication — aucun résidu.`,
    );
    return true;
  }
  const ports = await chargerServeursTest();
  const environnement = await checkTestEnvironment({ ports, previewUrls });
  const { bloquants, rappels } = verdictDeLaPasse({ avantPush: false, branches, environnement });
  afficherLesRappels(rappels);
  if (bloquants.length) {
    for (const issue of bloquants) console.error(`::error::${issue}`);
    return false;
  }
  console.log(
    `Environnement propre : ${ports.length} ports de test fermés; ${branches.examinees} branche(s) locale(s) suivie(s); ${branches.distantes} réf(s) distante(s) sans branche locale; ${branches.publication?.jugees ?? 0} branche(s) locale(s) jugée(s) pour la publication; ${previewUrls.length} URL(s) de Preview vérifiée(s).`,
  );
  return true;
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main(process.argv.slice(2)).then((ok) => {
    if (!ok) process.exitCode = 1;
  });
}
