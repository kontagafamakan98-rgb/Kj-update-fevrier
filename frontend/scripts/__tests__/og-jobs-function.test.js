/**
 * Tests NON-RÉGRESSION de la fonction Vercel `api/og-jobs/[id].js` (le
 * pré-rendu des fiches /jobs/:id pour les crawlers sans JS).
 *
 * La fonction est GÉNÉRÉE au build par le plugin Vite
 * `generate-og-jobs-function` (vite.config.js) à partir de
 * `scripts/og-jobs-function.js`. Pour la tester en unitaire sans build, on
 * génère le même code à la volée (`buildOgJobsFunctionCode`) avec un HTML
 * minimal, puis on l'importe en ESM via data-URL (pas de fichier temporaire).
 *
 * Couverture :
 *   • job EXISTANT → 200, HTML pré-rendu avec les méta OG du job (titre réel
 *     échappé, og:image dynamique /api/og/jobs/:id.png), canonical, shell h1
 *     statique (LCP) et cache court.
 *   • job INCONNU → 404, HTML neutre noindex + no-store (pas de carte
 *     générique pour un job inexistant).
 *
 * Le rewrite Vercel /jobs/(.*) → /api/og-jobs/$1 qui ACHEmine les fiches vers
 * cette fonction est vérifié séparément (validate-vercel-json.test.js).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildOgJobsFunctionCode } from '../og-jobs-function.js';

// HTML minimal reproduisant les balises que la fonction modifie (title,
// canonical, méta OG/twitter, og:image carrée statique, #root).
const MINIMAL_HTML = `<!DOCTYPE html>
<html>
<head>
<title>Kojo</title>
<link rel="canonical" href="https://kj-update-fevrier.vercel.app/" />
<meta property="og:title" content="Kojo" />
<meta property="og:description" content="desc" />
<meta property="og:image" content="https://kj-update-fevrier.vercel.app/og-image-1200x630.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image" content="https://kj-update-fevrier.vercel.app/og-square-1200x1200.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="1200" />
<meta property="og:image:type" content="image/png" />
<meta property="og:url" content="https://kj-update-fevrier.vercel.app/" />
<meta property="twitter:title" content="Kojo" />
<meta property="twitter:description" content="desc" />
<meta property="twitter:url" content="https://kj-update-fevrier.vercel.app/" />
<meta property="twitter:image" content="https://kj-update-fevrier.vercel.app/og-image-1200x630.png" />
</head>
<body><div id="root"></div></body>
</html>`;

// Génère le code de la fonction (même source qu'au build) et l'importe en ESM.
async function importGeneratedHandler(html = MINIMAL_HTML) {
  const code = buildOgJobsFunctionCode(html);
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}#t=${Date.now()}`;
  const mod = await import(url);
  return mod.default;
}

// Mock minimal de res (style Node/Vercel) : capture statusCode + headers + body.
function mockRes() {
  const headers = {};
  let body = '';
  return {
    setHeader(key, value) { headers[key.toLowerCase()] = value; },
    end(data) { body = String(data); },
    getHeaders: () => headers,
    statusCode: undefined,
    get status() { return this.statusCode; },
    get body() { return body; },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fonction api/og-jobs/[id].js (générée au build)', () => {
  it('job EXISTANT : 200 + méta OG du job (titre réel échappé) + og:image dynamique + shell h1', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'job-abc',
        title: "Réparer la fuite d'eau <urgent>",
        description: 'Une fuite dans la salle de bain.',
        budget_min: 10000,
        budget_max: 30000,
        category: 'plumbing',
        location_text: 'Dakar, Sénégal',
      }),
    })));
    const handler = await importGeneratedHandler();
    const res = mockRes();

    await handler({ query: { id: 'job-abc' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.getHeaders()['content-type']).toBe('text/html; charset=utf-8');
    expect(res.getHeaders()['cache-control']).toBe('public, max-age=300, s-maxage=300');
    // Titre réel du job, ÉCHAPPÉ (apostrophe → &#39;) dans <title> et og:title.
    expect(res.body).toContain('<title>Réparer la fuite d&#39;eau &lt;urgent&gt; — Kojo</title>');
    expect(res.body).toContain('og:title" content="Réparer la fuite d&#39;eau &lt;urgent&gt; — Kojo"');
    // og:image DYNAMIQUE par job (URL absolue vers le backend OG).
    expect(res.body).toContain('https://kj-update-fevrier.vercel.app/api/og/jobs/job-abc.png');
    // Variante carrée remplacée (réseaux qui recadrent 1:1).
    expect(res.body).toContain('https://kj-update-fevrier.vercel.app/api/og/jobs/job-abc-square.png');
    // canonical → la fiche réelle.
    expect(res.body).toContain('rel="canonical" href="https://kj-update-fevrier.vercel.app/jobs/job-abc"');
    // Shell h1 statique (LCP avant boot React) avec le titre du job.
    expect(res.body).toContain('text-3xl font-bold text-gray-900 mb-2">Réparer la fuite d&#39;eau &lt;urgent&gt;</h1>');
  });

  it('job INCONNU : 404 + HTML neutre noindex + no-store (pas de carte générique)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const handler = await importGeneratedHandler();
    const res = mockRes();

    await handler({ query: { id: 'job-inexistant' } }, res);

    expect(res.statusCode).toBe(404);
    expect(res.getHeaders()['content-type']).toBe('text/html; charset=utf-8');
    expect(res.getHeaders()['cache-control']).toBe('no-store');
    expect(res.getHeaders()['x-robots-tag']).toBe('noindex');
    // Aucune méta OG de job injectée (le HTML reste le base neutre).
    expect(res.body).toContain('<title>Kojo</title>');
    expect(res.body).not.toContain('og:title" content="Réparer');
  });

  it('erreur réseau du backend : repli sur 404 noindex (jamais de crash)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const handler = await importGeneratedHandler();
    const res = mockRes();

    await handler({ query: { id: 'job-x' } }, res);

    expect(res.statusCode).toBe(404);
    expect(res.getHeaders()['x-robots-tag']).toBe('noindex');
  });
});
