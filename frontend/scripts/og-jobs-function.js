/**
 * Génère le code source de la fonction Vercel `api/og-jobs/[id].js` :
 * pré-rend le HTML de /jobs/:id avec les méta Open Graph du job réel
 * (crawlers sans JS) + le shell h1 statique (LCP avant le boot React).
 *
 * Appelé par le plugin Vite `generate-og-jobs-function` à la fin du build,
 * qui injecte le HTML final (CSS inliné + CSP + assets hashés) via BASE_HTML.
 *
 * Le fichier généré est écrit dans frontend/api/og-jobs/[id].js et déployé
 * par Vercel comme fonction Node. Le rewrite vercel.json
 * /jobs/(.*) → /api/og-jobs/$1 achemine les fiches vers cette fonction.
 */
export function buildOgJobsFunctionCode(baseHtml) {
  const BASE = JSON.stringify(baseHtml);
  return `// AUTO-GÉNÉRÉ par vite.config.js (plugin generate-og-jobs-function) — NE PAS ÉDITER.
// Fonction Vercel : sert le HTML pré-rendu de /jobs/:id avec les méta OG du
// job (crawlers sans JS) + le shell h1 statique (LCP avant boot React).
const BASE_HTML = ${BASE};

const ORIGIN = 'https://kj-update-fevrier.vercel.app';
const BACKEND = 'https://kojo-backend.fly.dev';

// Échappement HTML strict : les données du job sont de l'utilisateur (titre,
// description) — jamais insérées brutes dans le HTML servi.
const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Remplace content="..." d'une meta mono ou multi-lignes.
function setMeta(html, key, value) {
  const re = new RegExp(\`(<meta\\\\s+(?:property|name)=\"\${key}\"[^>]*?content=\")[^\"]*(\")\`);
  return html.replace(re, \`\$1\${esc(value)}\$2\`);
}

async function fetchJob(id) {
  try {
    const res = await fetch(\`\${BACKEND}/api/jobs/\${encodeURIComponent(id)}\`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_e) {
    return null;
  }
}

export default async function handler(req, res) {
  const id = String(req.query.id || '').trim();
  const job = await fetchJob(id);

  let html = BASE_HTML;
  if (!job) {
    // Fiche inconnue : HTML neutre, explicitement noindex (pas de meta OG job).
    res.statusCode = 404;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-robots-tag', 'noindex');
    return res.end(html);
  }

  const rawTitle = job.title || '';
  const title = rawTitle ? \`\${rawTitle} — Kojo\` : 'Mission — Kojo';
  const rawDesc = job.description || '';
  const description = rawDesc.slice(0, 150) + (rawDesc.length > 150 ? '…' : '');
  const url = \`\${ORIGIN}/jobs/\${encodeURIComponent(id)}\`;
  const imageUrl = \`\${ORIGIN}/api/og/jobs/\${encodeURIComponent(id)}.png\`;

  html = html.replace(/<title>[^<]*<\\/title>/, \`<title>\${esc(title)}<\\/title>\`);
  html = setMeta(html, 'og:title', title);
  html = setMeta(html, 'og:description', description);
  // Variante CARRÉE (réseaux qui recadrent en vignette 1:1 : WhatsApp,
  // Telegram, iMessage, LinkedIn, aperçus Twitter) : la carte carrée STATIQUE
  // de la home (og-square-1200x1200.png, présente dans index.html) est
  // remplacée par la carte carrée du job (endpoint backend -square.png).
  // Remplacement de chaîne exacte : l'URL n'apparaît que dans le content de
  // la meta og:image carrée (les width/height/type 1200 qui suivent restent
  // valides).
  const squareImageUrl = \`\${ORIGIN}/api/og/jobs/\${encodeURIComponent(id)}-square.png\`;
  html = html.split('https://kj-update-fevrier.vercel.app/og-square-1200x1200.png').join(squareImageUrl);
  html = setMeta(html, 'og:image', imageUrl);
  html = setMeta(html, 'og:url', url);
  html = setMeta(html, 'twitter:title', title);
  html = setMeta(html, 'twitter:description', description);
  html = setMeta(html, 'twitter:url', url);
  html = setMeta(html, 'twitter:image', imageUrl);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, \`\$1\${url}\$2\`);

  // Shell statique du LCP : placeholder navbar + h1 (titre réel du job),
  // effacé au montage React (mêmes classes/positions → pas de flash, pas de CLS).
  html = html.replace(
    '<div id="root"></div>',
    \`<div id="root"><div class="h-16 bg-white border-b border-gray-200"></div>\`
      + \`<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">\`
      + \`<h1 class="text-3xl font-bold text-gray-900 mb-2">\${esc(rawTitle)}</h1>\`
      + \`</div></div>\`
  );

  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  // Cache court : les fiches peuvent être clôturées, mais le CDN aide les crawlers.
  res.setHeader('cache-control', 'public, max-age=300, s-maxage=300');
  return res.end(html);
}
`;
}
