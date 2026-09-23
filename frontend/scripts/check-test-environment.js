#!/usr/bin/env node
import { connect } from 'node:net';
import { get as getHttp } from 'node:http';
import { get as getHttps } from 'node:https';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import playwrightConfig from '../playwright.config.js';
import { DEFAULT_PORT as REWRITE_SERVER_PORT } from './vercel-rewrite-server.js';

const playwrightServers = (playwrightConfig.webServer || []).map(({ command, url }) => ({
  port: Number(new URL(url).port),
  owner: command,
}));

export const TEST_SERVERS = [
  { port: 3000, owner: 'Vite dev server' },
  ...playwrightServers,
  { port: REWRITE_SERVER_PORT, owner: 'scripts/vercel-rewrite-server.js' },
  { port: Number(process.env.PORT) || 8123, owner: 'playtest API fixture' },
  { port: 8000, owner: 'CI local backend' },
].filter(({ port }, index, all) => all.findIndex((server) => server.port === port) === index);

export function isListening(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (listening) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export function previewUrlsFromArgs(args) {
  const urls = [];
  let explicitlyEmpty = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--no-preview-tabs') {
      explicitlyEmpty = true;
      continue;
    }
    if (args[index] !== '--preview-url' || !args[index + 1]) {
      throw new Error(`argument inconnu ou incomplet : ${args[index]}`);
    }
    urls.push(args[++index]);
  }
  if (explicitlyEmpty && urls.length) throw new Error('--no-preview-tabs ne peut pas être combiné à --preview-url');
  if (!explicitlyEmpty && urls.length === 0) {
    throw new Error('déclarer les onglets avec --preview-url URL, ou confirmer leur absence avec --no-preview-tabs');
  }
  return urls;
}

export function isPreviewReachable(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const get = url.protocol === 'https:' ? getHttps : getHttp;
    let done = false;
    const finish = (reachable) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(reachable);
    };
    const request = get(url, (response) => {
      response.destroy();
      finish(true);
    });
    const timer = setTimeout(() => request.destroy(new Error('timeout')), timeoutMs);
    request.once('error', () => finish(false));
  });
}

export async function checkTestEnvironment({
  ports = TEST_SERVERS,
  previewUrls = [],
  isListeningImpl = isListening,
  isPreviewReachableImpl = isPreviewReachable,
} = {}) {
  const occupied = await Promise.all(ports.map(async (server) => {
    const entry = typeof server === 'number' ? { port: server, owner: 'serveur de test' } : server;
    return (await isListeningImpl(entry.port))
      ? `serveur de test encore ouvert sur le port ${entry.port} (${entry.owner})`
      : null;
  }));
  const stalePreviews = await Promise.all(previewUrls.map(async (value) => {
    let url;
    try {
      url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocole invalide');
    } catch {
      return `URL de Preview invalide : ${value}`;
    }
    return await isPreviewReachableImpl(url)
      ? null
      : `onglet Preview sans serveur joignable : ${url.href}`;
  }));
  return [...occupied, ...stalePreviews].filter(Boolean);
}

async function main(args) {
  let previewUrls;
  try {
    previewUrls = previewUrlsFromArgs(args);
  } catch (error) {
    console.error(`::error::${error.message}`);
    return false;
  }
  const issues = await checkTestEnvironment({ previewUrls });
  if (issues.length) {
    for (const issue of issues) console.error(`::error::${issue}`);
    return false;
  }
  console.log(`Environnement propre : ${TEST_SERVERS.length} ports de test fermés; ${previewUrls.length} URL(s) de Preview vérifiée(s).`);
  return true;
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main(process.argv.slice(2)).then((ok) => {
    if (!ok) process.exitCode = 1;
  });
}
