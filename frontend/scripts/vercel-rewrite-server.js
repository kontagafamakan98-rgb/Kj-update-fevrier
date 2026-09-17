#!/usr/bin/env node
/**
 * Serveur local « forme production » : applique la table de REWRITES de
 * frontend/vercel.json devant un build statique ET devant un backend local.
 *
 * ── Le trou que ce serveur ferme ────────────────────────────────────────────
 * Le cycle /jobs/:id (création → fiche OG → suppression → 404 + noindex +
 * sitemap) n'était exercé en HTTP réel QUE contre le déploiement Vercel, donc
 * seulement sur les runs de `main` : sur une PR, la preview Vercel est protégée
 * par Deployment Protection, resolve-vercel-url.sh retombait sur le build local
 * (`vite preview`), et `vite preview` ne connaît AUCUNE des règles de
 * vercel.json. La fiche /jobs/:id n'y existe pas — elle est servie par
 * `rewrites: /jobs/(.*) → backend/api/og/jobs/$1`, puis par le pré-rendu
 * backend. Résultat : sur une PR, une régression du chemin HTTP réel
 * (rewrite cassé, route OG retirée, noindex perdu, carte Pillow en erreur) ne
 * se voyait qu'APRÈS fusion.
 *
 * Ce serveur rejoue la MÊME table que Vercel (lue dans vercel.json, pas
 * recopiée) devant le backend DE LA PR : le cycle peut donc s'exécuter en
 * vraies requêtes HTTP sur une PR, sans écrire en production et sans jeton de
 * contournement de protection.
 *
 * ── Ce qui est fidèle, et ce qui ne l'est pas ───────────────────────────────
 * FIDÈLE : la table de rewrites (première règle qui matche, `(.*)` et `:path*`,
 * destination relative servie comme fichier du build, destination absolue
 * proxifiée), les en-têtes déclarés dans `headers`, le 404 pour une URL
 * inconnue (aucun catch-all SPA), le fait que le slash final fait partie du
 * motif (d'où les règles `/jobs` ET `/jobs/`), et la compression gzip des
 * réponses textuelles — Vercel compresse, et Lighthouse module le réseau :
 * servir des bundles NON compressés ferait mesurer un LCP qui n'existe nulle
 * part, et ferait rougir l'audit du repli pour une raison d'émulateur.
 * NON FIDÈLE (et sans effet sur ce qu'on vérifie) : le CDN, la mise en cache
 * distribuée, TLS, les redirections géographiques. Ce serveur sert à exercer la
 * CONFIGURATION et le COMPORTEMENT, pas la latence — c'est pourquoi il ne
 * remplace pas l'audit du déploiement réel sur main.
 *
 * ── Ce qu'il n'est pas ─────────────────────────────────────────────────────
 * Il ne modifie NI l'application NI vercel.json : la production continue d'être
 * servie par Vercel selon ce même fichier. Toute destination absolue est
 * ramenée sur KOJO_BACKEND_URL (défaut http://127.0.0.1:8000) : le serveur est
 * un outil de CI, jamais un déploiement.
 *
 * Usage :
 *   node scripts/vercel-rewrite-server.js --port 4174 --root build \
 *        --backend http://127.0.0.1:8000
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_BACKEND = 'http://127.0.0.1:8000';
export const DEFAULT_PORT = 4174;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Compile un motif `source` de vercel.json en fonction de correspondance.
 *
 * Motifs gérés : segment littéral, `:nom` (un segment), `:nom*` (le reste) et
 * `(.*)` (le reste, capturé sous la clé `1` — donc `$1` dans la destination).
 * Le slash final fait PARTIE du motif : `/jobs` ne matche pas `/jobs/` (c'est
 * exactement pourquoi vercel.json porte les deux règles, et un émulateur plus
 * permissif que Vercel masquerait la disparition de l'une des deux).
 *
 * @param {string} source Motif de rewrite (`/jobs/(.*)`).
 * @returns {(pathname: string) => (Record<string,string>|null)} Matcher.
 */
export function compileSource(source) {
  const trailing = source.length > 1 && source.endsWith('/');
  const parts = source.split('/').filter(Boolean);

  return (pathname) => {
    const requestTrailing = pathname.length > 1 && pathname.endsWith('/');
    if (requestTrailing !== trailing) return null;

    const segments = pathname.split('/').filter(Boolean);
    const params = {};
    let i = 0;

    for (const part of parts) {
      if (part === '(.*)') {
        params['1'] = segments.slice(i).join('/');
        i = segments.length;
        continue;
      }
      if (part.startsWith(':') && part.endsWith('*')) {
        params[part.slice(1, -1)] = segments.slice(i).join('/');
        i = segments.length;
        continue;
      }
      if (part.startsWith(':')) {
        if (i >= segments.length) return null;
        params[part.slice(1)] = segments[i];
        i += 1;
        continue;
      }
      if (i >= segments.length || segments[i] !== part) return null;
      i += 1;
    }

    // Les segments restants ne sont pas absorbés : ce n'est pas la même règle.
    if (i !== segments.length) return null;
    return params;
  };
}

/**
 * Substitue les captures dans une destination : `$1` (motif `(.*)`) et
 * `:nom` / `:nom*` (motifs paramétrés).
 *
 * @param {string} destination Destination de la règle.
 * @param {Record<string,string>} params Captures du matcher.
 * @returns {string} Destination résolue.
 */
export function resolveDestination(destination, params) {
  let out = destination;
  for (const [key, value] of Object.entries(params)) {
    // `:nom*` d'abord : sans cela, remplacer `:nom` laisserait l'étoile en
    // place (`/api/:path*` → `/api/jobs/42*`), et le backend recevrait un
    // chemin littéralement suffixé d'une étoile — donc un 404 sur chaque appel
    // API proxifié. Bug observé le 17/09/2026, corrigé ici et verrouillé par
    // scripts/__tests__/vercel-rewrite-server.test.js.
    out = out.split(`:${key}*`).join(value);
    out = out.split(`$${key}`).join(value);
    out = out.split(`:${key}`).join(value);
  }
  return out;
}

/**
 * Première règle de `rewrites` qui matche, avec sa destination résolue.
 *
 * @param {Array<{source: string, destination: string}>} rewrites Table de vercel.json.
 * @param {string} pathname Chemin demandé.
 * @returns {{destination: string, params: Record<string,string>, source: string}|null}
 */
export function matchRewrite(rewrites, pathname) {
  for (const rule of rewrites || []) {
    const matcher = compileSource(rule.source);
    const params = matcher(pathname);
    if (params) {
      return { destination: resolveDestination(rule.destination, params), params, source: rule.source };
    }
  }
  return null;
}

/**
 * En-têtes déclarés dans `headers` pour un chemin (dernière règle gagnante,
 * comme Vercel : les règles plus spécifiques sont déclarées après).
 *
 * @param {Array} headerRules Table `headers` de vercel.json.
 * @param {string} pathname Chemin demandé.
 * @returns {Record<string,string>} En-têtes à appliquer.
 */
export function headersFor(headerRules, pathname) {
  const out = {};
  for (const rule of headerRules || []) {
    if (!compileSource(rule.source)(pathname)) continue;
    for (const header of rule.headers || []) out[header.key] = header.value;
  }
  return out;
}

// Types compressibles : ce que Vercel compresse (texte, JSON, JS, SVG, XML).
// Les images PNG/JPEG/WebP et les polices woff2 sont déjà compressées — les
// recompresser ne gagnerait rien et ferait mentir les en-têtes.
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg\+xml)/;

/**
 * Faut-il compresser cette réponse ?
 *
 * @param {string} contentType `content-type` qui SERA envoyé.
 * @param {string} acceptEncoding En-tête `accept-encoding` de la requête.
 * @returns {boolean}
 */
export function shouldCompress(contentType, acceptEncoding) {
  if (!/\bgzip\b/i.test(String(acceptEncoding || ''))) return false;
  return COMPRESSIBLE.test(String(contentType || '').toLowerCase());
}

/**
 * Ramène une destination absolue sur le backend local : c'est ce qui permet
 * d'exercer la table de rewrites SANS toucher à la production.
 *
 * @param {string} destination Destination absolue (`https://…/api/og/jobs/x`).
 * @param {string} backendUrl Base du backend local.
 * @returns {string} URL absolue sur le backend local (chemin + query conservés).
 */
export function retargetToBackend(destination, backendUrl) {
  const url = new URL(destination);
  const backend = new URL(backendUrl);
  url.protocol = backend.protocol;
  url.host = backend.host;
  return url.toString();
}

/**
 * Ajoute à une URL cible la query de la requête d'origine (Vercel conserve la
 * query à travers un rewrite). Les paramètres déjà présents dans la destination
 * ne sont jamais écrasés.
 *
 * @param {string} target URL cible (déjà ramenée sur le backend local).
 * @param {string} requestSearch `url.search` de la requête (`?a=1` ou `''`).
 * @param {string} [base] Base absolue (les URLs relatives n'ont pas de `?`).
 * @returns {string} URL cible avec la query fusionnée.
 */
export function mergeRequestQuery(target, requestSearch, base = 'http://localhost') {
  const incoming = new URLSearchParams(String(requestSearch || '').replace(/^\?/, ''));
  if ([...incoming.keys()].length === 0) return target;
  const out = new URL(target, base);
  const merged = new URLSearchParams(out.search);
  for (const [key, value] of incoming) {
    if (!merged.has(key)) merged.append(key, value);
  }
  out.search = merged.toString();
  return out.toString();
}

/**
 * Crée le serveur : rewrites → fichier statique → 404 (sans catch-all SPA).
 *
 * @param {object} options
 * @param {string} options.root Répertoire du build (outputDirectory).
 * @param {object} options.config Contenu de vercel.json.
 * @param {string} [options.backendUrl] Backend des destinations absolues.
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @returns {import('node:http').Server}
 */
export function createRewriteServer({ root, config, backendUrl = DEFAULT_BACKEND, fetchImpl = fetch }) {
  const rewrites = config?.rewrites || [];
  const headerRules = config?.headers || [];

  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const extraHeaders = headersFor(headerRules, pathname);
    const sendHeaders = (status, headers = {}) => {
      for (const [key, value] of Object.entries({ ...headers, ...extraHeaders })) res.setHeader(key, value);
      res.statusCode = status;
    };

    // Sert un fichier du build (statique ou destination RELATIVE d'un rewrite),
    // avec la compression que Vercel applique. `vary` est posé dans les deux
    // cas : sans lui, un cache intermédiaire pourrait resservir la variante
    // gzip à un client qui ne l'accepte pas.
    const sendFile = (status, file) => {
      const contentType =
        CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const gzip = shouldCompress(contentType, req.headers['accept-encoding']);
      sendHeaders(status, {
        'content-type': contentType,
        vary: 'accept-encoding',
        ...(gzip ? { 'content-encoding': 'gzip' } : {}),
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      if (gzip) {
        const stream = createReadStream(file).pipe(createGzip());
        // Une erreur de lecture/compression ne doit pas laisser la réponse
        // ouverte à moitié (le client attendrait jusqu'au timeout).
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        stream.pipe(res);
        return;
      }
      createReadStream(file).pipe(res);
    };

    const rule = matchRewrite(rewrites, pathname);

    // ── Destination ABSOLUE : proxy vers le backend local ──────────────────
    if (rule && /^https?:\/\//i.test(rule.destination)) {
      // La query de la REQUÊTE traverse le rewrite (Vercel la conserve) : sans
      // cela, `/api/jobs?limit=1` atteindrait le backend sans `limit=1`, et le
      // paramètre anti-cache `?kojo_cb=` de la sonde post-suppression serait
      // perdu. Les paramètres déjà présents dans la destination gagnent.
      const target = mergeRequestQuery(
        retargetToBackend(rule.destination, backendUrl),
        url.search,
        backendUrl
      );
      let upstream;
      try {
        upstream = await fetchImpl(target, {
          method: req.method,
          headers: Object.fromEntries(
            Object.entries(req.headers).filter(([name]) => !['host', 'connection', 'content-length'].includes(name))
          ),
          body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : req,
          duplex: 'half',
          redirect: 'manual',
        });
      } catch (error) {
        sendHeaders(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`backend local injoignable (${backendUrl}) : ${error.message}\n`);
        return;
      }
      const headers = {};
      upstream.headers.forEach((value, key) => {
        if (['content-encoding', 'transfer-encoding', 'connection', 'content-length'].includes(key)) return;
        headers[key] = value;
      });
      sendHeaders(upstream.status, headers);
      const body = Buffer.from(await upstream.arrayBuffer());
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }

    // ── Destination RELATIVE : fichier du build (pré-rendu) ────────────────
    if (rule && !/^https?:\/\//i.test(rule.destination)) {
      const file = path.join(root, rule.destination.split('?')[0]);
      if (existsSync(file) && statSync(file).isFile()) {
        sendFile(200, file);
        return;
      }
      sendHeaders(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        `rewrite « ${rule.source} » → « ${rule.destination} » : fichier absent du build (${root}). ` +
          `La table de rewrites référence un pré-rendu qui n'est pas produit.\n`
      );
      return;
    }

    // ── Fichier statique ───────────────────────────────────────────────────
    const candidate = pathname === '/' ? '/index.html' : pathname;
    const statik = path.join(root, candidate);
    if (existsSync(statik) && statik.startsWith(path.resolve(root)) && statSync(statik).isFile()) {
      sendFile(200, statik);
      return;
    }

    // ── 404 : aucun catch-all SPA (une URL inconnue doit répondre 404) ─────
    const notFound = path.join(root, '404.html');
    if (existsSync(notFound)) {
      sendFile(404, notFound);
      return;
    }
    sendHeaders(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404\n');
  });
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const port = Number(arg('port', process.env.KOJO_REWRITE_PORT || DEFAULT_PORT));
  const root = path.resolve(arg('root', process.env.KOJO_REWRITE_ROOT || 'build'));
  const configFile = path.resolve(arg('config', process.env.KOJO_REWRITE_CONFIG || 'vercel.json'));
  const backendUrl = arg('backend', process.env.KOJO_BACKEND_URL || DEFAULT_BACKEND);

  if (!existsSync(root)) {
    console.error(`::error::${root} absent — construire le frontend avant de lancer le serveur de rewrites`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const server = createRewriteServer({ root, config, backendUrl });
  server.listen(port, '127.0.0.1', () => {
    console.log(
      `Serveur de rewrites (vercel.json) sur http://127.0.0.1:${port} — build ${root}, ` +
        `destinations absolues → ${backendUrl}, ${(config.rewrites || []).length} rewrite(s), ` +
        `${(config.headers || []).length} règle(s) d'en-têtes.`
    );
  });
}
