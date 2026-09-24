#!/usr/bin/env node
/**
 * Contrôle de FIN DE PASSE : ce qui reste ouvert, joignable ou traînant quand
 * la passe est finie.
 *
 *   1. un serveur de test encore en écoute — la liste des ports vient de
 *      playwright.config.js et du serveur de rewrites, jamais recopiée ;
 *   2. une URL de Preview qui pointe sur un port mort ;
 *   3. une hygiène git propre : branches locales fusionnées et réfs distantes
 *      orphelines, déléguée au module scripts/check-git-branches.js.
 *
 * DEUX MODES, un seul propriétaire du partage (`verdictDeLaPasse`) :
 *   * fin de passe — tout compte, on remet tout à zéro ;
 *   * pré-vol de push (`--avant-push`) — les résidus de passe bloquent, le reste
 *     est rappelé. `.githooks/pre-push` l'appelle avant chaque push ; son coût
 *     et ses limites sont mesurés, pas supposés.
 */
import { connect } from 'node:net';
import { get as getHttp } from 'node:http';
import { get as getHttps } from 'node:https';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  CHAMPS_REF_DISTANTE,
  lireGit,
  mesurerBranches,
} from './check-git-branches.js';

// Ré-exporté pour que les consommateurs et fixtures existants continuent de fonctionner
export { CHAMPS_REF_DISTANTE, lireGit, mesurerBranches };

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
  rappels: avantPush ? environnement : [],
});

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

export async function main(args = process.argv.slice(2), { mesurer = mesurerBranches, cwd = process.cwd() } = {}) {
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
    branches = { issues: [`branches : lecture impossible (${error.message})`], examinees: 0, distantes: 0 };
  }
  if (avantPush) {
    const { bloquants } = verdictDeLaPasse({ avantPush: true, branches, environnement: [] });
    if (bloquants.length) {
      for (const issue of bloquants) console.error(`::error::${issue}`);
      return false;
    }
    console.log(`Pré-vol de push : ${branches.examinees} branche(s) locale(s) suivie(s) et ${branches.distantes} réf(s) distante(s) sans branche locale — aucun résidu.`);
    return true;
  }
  const ports = await chargerServeursTest();
  const environnement = await checkTestEnvironment({ ports, previewUrls });
  const { bloquants } = verdictDeLaPasse({ avantPush: false, branches, environnement });
  if (bloquants.length) {
    for (const issue of bloquants) console.error(`::error::${issue}`);
    return false;
  }
  console.log(
    `Environnement propre : ${ports.length} ports de test fermés; ${branches.examinees} branche(s) locale(s) suivie(s); ${branches.distantes} réf(s) distante(s) sans branche locale; ${previewUrls.length} URL(s) de Preview vérifiée(s).`,
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
