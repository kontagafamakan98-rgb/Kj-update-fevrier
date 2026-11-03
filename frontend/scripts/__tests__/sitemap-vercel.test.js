// @vitest-environment node
// ============================================================================
// Régression : /sitemap.xml servi par le CDN Vercel (03/11/2026).
//
// Pourquoi ce garde, et pourquoi ici : le sitemap coûtait 0,33–0,55 s par crawl
// (0,41 s de backend + l'aller-retour de la réécriture EXTERNE), avec
// `X-Vercel-Cache: MISS` à chaque passage — Vercel ne cache pas une réécriture
// vers une origine externe. La fonction d'arête `api/sitemap.js` transporte le
// document et le rend avec `s-maxage=60`. Trois choses peuvent casser en
// silence, et ce fichier les nomme une par une :
//
//   • la réécriture redevient EXTERNE, ou passe APRÈS le catch-all `/api/:path*` :
//     la fonction existe alors sans jamais être servie, et rien ne rougit ;
//   • la fonction RECOMPOSE le corps au lieu de le recopier : deux déclarations
//     du sitemap, libres de diverger de celle que `/health` et les sondes lisent ;
//   • une erreur d'amont se cache : un incident de cinq secondes fige un 502
//     pendant une minute chez les crawlers.
//
// Ce que ce fichier ne dit pas : le taux de `HIT` réellement obtenu en
// production. Le CDN est mesuré par `curl`, pas par un test unitaire.
// ============================================================================
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import handler, { config } from '../../api/sitemap.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERCEL = JSON.parse(readFileSync(path.join(RACINE, 'vercel.json'), 'utf8'));

const XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset><url><loc>https://kojoforafrica.cc.cd/</loc></url></urlset>';
const VOLUMES = {
  'X-Kojo-Urls': '83',
  'X-Kojo-Urls-Declarees': '80',
  'X-Kojo-Urls-Vivantes': '3',
};
const URL_SITE = 'https://kojoforafrica.cc.cd/sitemap.xml';

function amont(reponse) {
  vi.stubGlobal('fetch', vi.fn(async () => reponse));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('La réécriture de /sitemap.xml, dans vercel.json', () => {
  it('vise la fonction interne, jamais l’origine Fly', () => {
    const regle = VERCEL.rewrites.find((r) => r.source === '/sitemap.xml');

    expect(regle, 'aucune réécriture pour /sitemap.xml').toBeTruthy();
    // Un `destination` absolu rend la main à Vercel… qui ne cache pas : c'est
    // exactement l'état d'avant, et il ne produisait aucun rouge.
    expect(regle.destination).toBe('/api/sitemap');
    expect(regle.destination.startsWith('http')).toBe(false);
  });

  it('passe AVANT le catch-all /api/:path*, sinon la fonction ne serait jamais atteinte', () => {
    const rangSitemap = VERCEL.rewrites.findIndex((r) => r.source === '/sitemap.xml');
    const rangCatchAll = VERCEL.rewrites.findIndex((r) => r.source === '/api/:path*');

    expect(rangCatchAll).toBeGreaterThanOrEqual(0);
    expect(rangSitemap).toBeLessThan(rangCatchAll);
  });

  it('la fonction existe et déclare le runtime d’arête', () => {
    expect(existsSync(path.join(RACINE, 'api', 'sitemap.js'))).toBe(true);
    expect(config).toEqual({ runtime: 'edge' });
  });
});

describe('Ce que la fonction sert', () => {
  it('recopie le corps À L’IDENTIQUE et rend les trois volumes', async () => {
    amont(new Response(XML, { status: 200, headers: { 'content-type': 'application/xml', ...VOLUMES } }));

    const reponse = await handler(new Request(URL_SITE));

    expect(reponse.status).toBe(200);
    // Octet pour octet : c'est un transport, pas une seconde déclaration.
    expect(await reponse.text()).toBe(XML);
    expect(reponse.headers.get('content-type')).toContain('application/xml');
    for (const [nom, valeur] of Object.entries(VOLUMES)) {
      expect(reponse.headers.get(nom.toLowerCase())).toBe(valeur);
    }
  });

  it('porte le cache de 60 s à l’arête, et le dit dans l’en-tête', async () => {
    amont(new Response(XML, { status: 200, headers: VOLUMES }));

    const reponse = await handler(new Request(URL_SITE));

    const cache = reponse.headers.get('cache-control');
    expect(cache).toContain('s-maxage=60');
    expect(cache).toContain('stale-while-revalidate');
    expect(cache).not.toContain('no-store');
  });

  it('un amont en échec rend un 502 NON caché, en nommant le statut', async () => {
    amont(new Response('boom', { status: 503 }));

    const reponse = await handler(new Request(URL_SITE));

    expect(reponse.status).toBe(502);
    // La règle qui empêche un incident de cinq secondes de figer le sitemap.
    expect(reponse.headers.get('cache-control')).toBe('no-store');
    expect(await reponse.text()).toContain('503');
  });

  it('un amont injoignable est un 502 nommé, jamais une exception qui remonte', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('réseau coupé');
    }));

    const reponse = await handler(new Request(URL_SITE));

    expect(reponse.status).toBe(502);
    expect(reponse.headers.get('cache-control')).toBe('no-store');
    expect(await reponse.text()).toContain('injoignable');
  });

  it('HEAD rend les mêmes en-têtes sans le corps', async () => {
    amont(new Response(XML, { status: 200, headers: VOLUMES }));

    const reponse = await handler(new Request(URL_SITE, { method: 'HEAD' }));

    expect(reponse.status).toBe(200);
    expect(await reponse.text()).toBe('');
    expect(reponse.headers.get('x-kojo-sitemap-cache')).toBeNull();
    expect(reponse.headers.get('cache-control')).toContain('s-maxage=60');
  });

  it('refuse une méthode d’écriture au lieu de la transmettre', async () => {
    const appele = vi.fn();
    vi.stubGlobal('fetch', appele);

    const reponse = await handler(new Request(URL_SITE, { method: 'POST' }));

    expect(reponse.status).toBe(405);
    expect(reponse.headers.get('allow')).toBe('GET, HEAD');
    expect(appele).not.toHaveBeenCalled();
  });
});
