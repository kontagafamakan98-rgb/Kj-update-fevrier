import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  compileSource,
  resolveDestination,
  matchRewrite,
  headersFor,
  retargetToBackend,
  mergeRequestQuery,
  shouldCompress,
  createRewriteServer,
} from '../vercel-rewrite-server';

// Tests du serveur qui rejoue la table de REWRITES de vercel.json devant un
// build statique et le backend de la PR (scripts/vercel-rewrite-server.js).
//
// POURQUOI CE FICHIER : depuis le 17/09/2026, le job `lighthouse-ci` sert le
// repli local avec CE serveur, et c'est lui qui répond 404 + noindex à la sonde
// de capacité — la réponse qui décide si le cycle /jobs/:id s'exécute. Un
// émulateur plus permissif que Vercel (un catch-all, un slash final ignoré, une
// destination non proxifiée) rendrait le repli vert sur une configuration
// cassée : le garde ne garderait rien. Ces tests fixent donc la fidélité
// revendiquée par le fichier (motifs, ordre des règles, en-têtes, 404, proxy
// des destinations absolues, compression) et surtout ses ÉCARTS ASSUMÉS.

// ── Table de rewrites minimale mais représentative de vercel.json ────────────
const CONFIG = {
  rewrites: [
    { source: '/jobs', destination: '/jobs.html' },
    { source: '/jobs/', destination: '/jobs.html' },
    { source: '/jobs/(.*)', destination: 'https://kojo-backend.fly.dev/api/og/jobs/$1' },
    { source: '/api/:path*', destination: 'https://kojo-backend.fly.dev/api/:path*' },
    { source: '/sitemap.xml', destination: 'https://kojo-backend.fly.dev/api/sitemap.xml' },
    { source: '/register', destination: '/register.html' },
    { source: '/register/', destination: '/register.html' },
    { source: '/dashboard', destination: '/app.html' },
  ],
  headers: [
    { source: '/dashboard', headers: [{ key: 'X-Robots-Tag', value: 'noindex, follow' }] },
  ],
};

const INDEX = '<!DOCTYPE html><html><body>bienvenue</body></html>';
const JOBS = '<!DOCTYPE html><html><body>shell jobs</body></html>';
const REGISTER = '<!DOCTYPE html><html><body>shell register</body></html>';
const APP = '<div id="root"></div>';
const NOT_FOUND = '<!DOCTYPE html><html><head><meta name="robots" content="noindex" /></head><body>404</body></html>';
const ASSET = 'console.log("bundle");'.repeat(60);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

const roots = [];
const servers = [];

/** Build minimal sur disque (fichiers réels : le serveur lit le disque). */
const makeRoot = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kojo-rewrite-'));
  roots.push(root);
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'index.html'), INDEX);
  writeFileSync(path.join(root, 'jobs.html'), JOBS);
  writeFileSync(path.join(root, 'register.html'), REGISTER);
  writeFileSync(path.join(root, 'app.html'), APP);
  writeFileSync(path.join(root, '404.html'), NOT_FOUND);
  writeFileSync(path.join(root, 'assets', 'app.js'), ASSET);
  writeFileSync(path.join(root, 'assets', 'pixel.png'), PNG);
  return root;
};

/**
 * Démarre le serveur sur un port éphémère et rend son URL de base.
 *
 * @param {object} [options]
 * @param {object} [options.config]  Table de rewrites (défaut : CONFIG).
 * @param {Function} [options.fetchImpl] Backend simulé (défaut : échoue).
 * @returns {Promise<{base: string, calls: string[]}>}
 */
const start = async ({ config = CONFIG, fetchImpl } = {}) => {
  const calls = [];
  const backend =
    fetchImpl ||
    (async (url) => {
      calls.push(String(url));
      throw new Error('proxy non attendu dans ce test');
    });
  const server = createRewriteServer({ root: makeRoot(), config, backendUrl: 'http://127.0.0.1:9000', fetchImpl: backend });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, calls };
};

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('vercel-rewrite-server — motifs (fidélité à Vercel)', () => {
  it('ne fait pas correspondre /jobs à /jobs/ (le slash final fait partie du motif)', () => {
    const matcher = compileSource('/jobs');

    expect(matcher('/jobs')).not.toBeNull();
    // C'est pour cela que vercel.json porte DEUX règles : un émulateur plus
    // permissif masquerait la disparition de l'une des deux.
    expect(matcher('/jobs/')).toBeNull();
  });

  it('n’absorbe pas de segment supplémentaire sans joker', () => {
    expect(compileSource('/jobs')('/jobs/42')).toBeNull();
    expect(compileSource('/api/:path*')('/api/jobs/42')).toEqual({ path: 'jobs/42' });
    expect(compileSource('/api/:path*')('/api/jobs')).toEqual({ path: 'jobs' });
  });

  it('capture le reste de l’URL sous $1 (motif (.*))', () => {
    expect(compileSource('/jobs/(.*)')('/jobs/abc-123')).toEqual({ 1: 'abc-123' });
    // `/jobs/` est servi par SA règle dédiée (déclarée avant) : le motif
    // `/jobs/(.*)` n'a pas de slash final, il ne la capture donc pas. C'est
    // exactement pourquoi vercel.json porte les deux règles, et pourquoi un
    // émulateur qui normaliserait le slash masquerait la disparition de l'une.
    expect(compileSource('/jobs/(.*)')('/jobs/')).toBeNull();
    expect(matchRewrite(CONFIG.rewrites, '/jobs/').destination).toBe('/jobs.html');
  });

  it('substitue $1 et :param* dans la destination', () => {
    expect(resolveDestination('https://x.test/api/og/jobs/$1', { 1: 'abc' })).toBe(
      'https://x.test/api/og/jobs/abc'
    );
    expect(resolveDestination('https://x.test/api/:path*', { path: 'jobs/42' })).toBe(
      'https://x.test/api/jobs/42'
    );
  });

  it('retient la PREMIÈRE règle qui matche (l’ordre de vercel.json fait foi)', () => {
    expect(matchRewrite(CONFIG.rewrites, '/jobs').destination).toBe('/jobs.html');
    expect(matchRewrite(CONFIG.rewrites, '/jobs/').destination).toBe('/jobs.html');
    expect(matchRewrite(CONFIG.rewrites, '/jobs/42').destination).toBe(
      'https://kojo-backend.fly.dev/api/og/jobs/42'
    );
    expect(matchRewrite(CONFIG.rewrites, '/inconnu')).toBeNull();
  });

  it('applique les en-têtes déclarés pour un chemin (dernière règle gagnante)', () => {
    expect(headersFor(CONFIG.headers, '/dashboard')).toEqual({ 'X-Robots-Tag': 'noindex, follow' });
    expect(headersFor(CONFIG.headers, '/jobs')).toEqual({});
  });

  it('ramène une destination absolue sur le backend local (chemin ET query conservés)', () => {
    expect(retargetToBackend('https://kojo-backend.fly.dev/api/jobs?limit=1', 'http://127.0.0.1:9000')).toBe(
      'http://127.0.0.1:9000/api/jobs?limit=1'
    );
  });

  it('conserve la query de la requête à travers le rewrite (Vercel le fait)', () => {
    // Sans cela, `/api/jobs?limit=1` atteindrait le backend sans `limit=1`, et
    // le `?kojo_cb=` de la sonde post-suppression serait perdu — la fiche
    // supprimée pourrait alors être lue dans le cache.
    expect(mergeRequestQuery('http://127.0.0.1:9000/api/jobs', '?limit=1')).toBe(
      'http://127.0.0.1:9000/api/jobs?limit=1'
    );
    expect(mergeRequestQuery('http://127.0.0.1:9000/jobs/abc', '?kojo_cb=42')).toBe(
      'http://127.0.0.1:9000/jobs/abc?kojo_cb=42'
    );
    // Aucune query en entrée : l'URL cible est rendue inchangée.
    expect(mergeRequestQuery('http://127.0.0.1:9000/api/jobs', '')).toBe('http://127.0.0.1:9000/api/jobs');
    // Les paramètres portés par la DESTINATION ne sont jamais écrasés.
    expect(mergeRequestQuery('http://127.0.0.1:9000/api/jobs?limit=1', '?limit=9')).toBe(
      'http://127.0.0.1:9000/api/jobs?limit=1'
    );
  });
});

describe('vercel-rewrite-server — compression (Vercel compresse)', () => {
  it('compresse le texte, pas les octets déjà compressés', () => {
    expect(shouldCompress('text/html; charset=utf-8', 'gzip, deflate, br')).toBe(true);
    expect(shouldCompress('text/javascript; charset=utf-8', 'gzip')).toBe(true);
    expect(shouldCompress('application/json; charset=utf-8', 'gzip')).toBe(true);
    // Une image PNG gzippée par-dessus ne gagne rien et ferait mentir `vary`.
    expect(shouldCompress('image/png', 'gzip')).toBe(false);
    expect(shouldCompress('font/woff2', 'gzip')).toBe(false);
    // Client qui n'accepte pas gzip : réponse telle quelle.
    expect(shouldCompress('text/html', 'identity')).toBe(false);
    expect(shouldCompress('text/html', '')).toBe(false);
  });
});

describe('vercel-rewrite-server — service réel (HTTP sur boucle locale)', () => {
  it('sert la racine depuis index.html', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toBe(INDEX);
  });

  it('sert un fichier du build avec son type MIME', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/assets/pixel.png`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
  });

  it('gzippe les réponses textuelles quand le client l’accepte, et pose vary', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/assets/app.js`, { headers: { 'accept-encoding': 'gzip' } });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('vary')).toBe('accept-encoding');
    // `fetch` (undici) décompresse lui-même : le corps reçu est celui du
    // fichier, ce qui prouve au passage que le flux gzip est VALIDE (un flux
    // corrompu ferait lever la lecture).
    expect(await res.text()).toBe(ASSET);
  });

  it('ne gzippe pas quand le client ne l’accepte pas (et n’annonce pas gzip)', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/assets/app.js`, { headers: { 'accept-encoding': 'identity' } });

    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('vary')).toBe('accept-encoding');
    expect(await res.text()).toBe(ASSET);
  });

  it('sert une destination RELATIVE comme fichier du build (pré-rendu), slash final compris', async () => {
    const { base } = await start();

    for (const url of ['/register', '/register/']) {
      const res = await fetch(`${base}${url}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(REGISTER);
    }

    const jobs = await fetch(`${base}/jobs`);
    expect(await jobs.text()).toBe(JOBS);
  });

  it('ÉCHOUE FORT si une destination relative n’existe pas dans le build', async () => {
    // Un 404 muet donnerait l'impression que la route n'existe pas ; ici c'est
    // la TABLE qui référence un pré-rendu absent, et ça doit se voir.
    const { base } = await start({
      config: { rewrites: [{ source: '/support', destination: '/support.html' }] },
    });
    const res = await fetch(`${base}/support`);

    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/pré-rendu qui n'est pas produit/);
  });

  it('proxifie une destination ABSOLUE vers le backend local, chemin et query compris', async () => {
    const seen = [];
    const { base } = await start({
      fetchImpl: async (url) => {
        seen.push(String(url));
        return {
          status: 404,
          headers: { forEach: (fn) => fn('noindex', 'x-robots-tag') },
          arrayBuffer: async () => Buffer.from('fiche introuvable'),
        };
      },
    });

    const fiches = await fetch(`${base}/jobs/abc-123`);
    const sonde = await fetch(`${base}/jobs/abc-123?kojo_cb=42`);
    const liste = await fetch(`${base}/api/jobs?limit=1`);
    const sitemap = await fetch(`${base}/sitemap.xml`);

    expect(seen).toEqual([
      'http://127.0.0.1:9000/api/og/jobs/abc-123',
      // Le cache-buster de la sonde post-suppression traverse le rewrite :
      // c'est ce qui empêche de lire une fiche supprimée restée en cache.
      'http://127.0.0.1:9000/api/og/jobs/abc-123?kojo_cb=42',
      'http://127.0.0.1:9000/api/jobs?limit=1',
      'http://127.0.0.1:9000/api/sitemap.xml',
    ]);
    expect(sonde.status).toBe(404);
    // Statut et en-têtes du backend traversent (le 404 + noindex de la fiche
    // inconnue est ce que la sonde de capacité observe).
    expect(fiches.status).toBe(404);
    expect(fiches.headers.get('x-robots-tag')).toBe('noindex');
    expect(await fiches.text()).toBe('fiche introuvable');
    expect(liste.status).toBe(404);
    expect(sitemap.status).toBe(404);
  });

  it('répond 404 (et sert 404.html) pour une URL inconnue : aucun catch-all SPA', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/une-url-inexistante`);

    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND);
  });

  it('applique les en-têtes de vercel.json aux réponses qu’il sert', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/dashboard`);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, follow');
    expect(await res.text()).toBe(APP);
  });

  it('répond à HEAD sans corps', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/`, { method: 'HEAD' });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});
