#!/usr/bin/env node
/**
 * Vérification OG des pages auditées par Lighthouse CI (job lighthouse-ci).
 *
 * Pour chaque route auditée (mêmes URLs que frontend/lighthouserc.cjs), fetch
 * le HTML SERVI (ce que reçoit un crawler sans JS) et vérifie :
 *   1. la meta og:image est présente ;
 *   2. elle est en URL ABSOLUE (https://…) — une URL relative est ignorée
 *      par les crawlers de partage ;
 *   3. pour les pages à carte dédiée (/, /jobs, /login), elle pointe vers
 *      l'image spécifique attendue ;
 *   4. twitter:image est aussi absolue.
 *
 * Échoue (exit 1) dès qu'une route ne respecte pas ces règles → la PR est
 * bloquée si un og:image casse (régression du pré-rendu OG).
 *
 * Usage : LHCI_URL=https://x.vercel.app node scripts/check-og-images.js
 * (LHCI_URL par défaut : build local servi par `vite preview`, port 4173).
 */

// Routes auditées par lighthouserc.cjs + /login (pré-rendue, carte dédiée).
// `image` = fichier wide attendu (URL absolue qui doit se terminer par ce
// chemin) ; `imageSquare` = variante CARRÉE 1200x1200 attendue (réseaux qui
// recadrent en 1:1) ; `null` = seule l'URL absolue est exigée (pages sans
// carte dédiée).
const ROUTES = [
  { path: '/', image: '/og-image-1200x630.png', imageSquare: '/og-square-1200x1200.png' },
  { path: '/jobs', image: '/og-jobs.png', imageSquare: '/og-jobs-square.png' },
  { path: '/login', image: '/og-login.png', imageSquare: '/og-login-square.png' },
  { path: '/register', image: null, imageSquare: null },
  { path: '/dashboard', image: null, imageSquare: null },
  { path: '/profile', image: null, imageSquare: null },
];

const BASE = (process.env.LHCI_URL || 'http://localhost:4173').trim().replace(/\/+$/, '');
// Backend interrogé pour trouver un vrai job (l'API publique /api/jobs) ;
// KOJO_BACKEND_URL permet de pointer un stub en test local.
const BACKEND = (process.env.KOJO_BACKEND_URL || 'https://kojo-backend.fly.dev').trim().replace(/\/+$/, '');
// Origin hardcodée dans la fonction Vercel api/og-jobs/[id].js (og:image des
// fiches pointe toujours vers le domaine de prod).
const ORIGIN = 'https://kj-update-fevrier.vercel.app';

const grab = (html, attr) => {
  const re = new RegExp(`<meta[^>]*${attr}[^>]*content="([^"]*)"`);
  const m = html.match(re);
  return m ? m[1] : '';
};

// Toutes les occurrences d'un attribut meta (og:image apparaît en wide + carré).
const grabAll = (html, attr) => {
  const re = new RegExp(`<meta[^>]*${attr}[^>]*content="([^"]*)"`, 'g');
  return [...html.matchAll(re)].map((m) => m[1]);
};

const isAbsolute = (value) => /^https?:\/\//.test(value || '');

// ── Vérification HTTP des cartes OG (GET réel sur chaque og:image) ────────
// Les dimensions sont décodées depuis l'en-tête IHDR du PNG (octets 16-24) :
// width/height big-endian. Format attendu : 1200x630 (wide) / 1200x1200
// (carré) — cohérent avec les cartes statiques (public/) et les cartes
// dynamiques backend (Pillow, /api/og/jobs/:id[.png|-square.png]).
const checkedUrls = new Set();
const imageUrlsToCheck = [];
const queueImageUrl = (url, label) => {
  if (!url || checkedUrls.has(url)) return;
  checkedUrls.add(url);
  imageUrlsToCheck.push({ url, label });
};

// GET réel + assertions : 200, content-type image/png, dimensions IHDR.
async function checkOgImageHttp(url, label) {
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'kojo-og-image-check/1.0' },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    errors.push(`[${label}] og:image fetch ${url} échoué : ${err.message}`);
    return;
  }
  if (!res.ok) {
    errors.push(`[${label}] og:image HTTP ${res.status} (attendu 200) : ${url}`);
    return;
  }
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('image/png')) {
    errors.push(`[${label}] og:image content-type "${contentType}" (attendu image/png) : ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) {
    errors.push(`[${label}] og:image n'est pas un PNG valide : ${url}`);
    return;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const [ew, eh] = url.includes('square') ? [1200, 1200] : [1200, 630];
  if (width !== ew || height !== eh) {
    errors.push(`[${label}] og:image dimensions ${width}x${height} (attendu ${ew}x${eh}) : ${url}`);
    return;
  }
  checked.push(`  ✓ og:image HTTP 200 ${width}x${height} (${contentType}) : ${url}`);
}

const errors = [];
const checked = [];

for (const route of ROUTES) {
  const url = `${BASE}${route.path}`;
  let html = '';
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'kojo-og-image-check/1.0' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      errors.push(`[${route.path}] HTTP ${res.status} sur ${url}`);
      continue;
    }
    html = await res.text();
  } catch (err) {
    errors.push(`[${route.path}] fetch ${url} échoué : ${err.message}`);
    continue;
  }

  const ogImages = grabAll(html, 'property="og:image"');
  const ogImage = ogImages[0] || '';
  const twitterImage = grab(html, 'name="twitter:image"');

  if (!ogImage) {
    errors.push(`[${route.path}] og:image ABSENT du HTML servi`);
  } else if (!isAbsolute(ogImage)) {
    errors.push(`[${route.path}] og:image NON absolue : "${ogImage}" (URL relative ignorée par les crawlers)`);
  } else if (route.image && !ogImage.endsWith(route.image)) {
    errors.push(`[${route.path}] og:image inattendu : "${ogImage}" (attendu se terminant par "${route.image}")`);
  }

  // Variante carrée : doit être présente ET pointer vers le fichier attendu
  // pour les pages à carte dédiée (les réseaux qui recadrent en 1:1).
  const squareImage = ogImages.find((u) => u.includes('square'));
  if (route.imageSquare) {
    if (!squareImage) {
      errors.push(`[${route.path}] variante CARRÉE og:image ABSENTE du HTML servi (attendu "${route.imageSquare}")`);
    } else if (!isAbsolute(squareImage)) {
      errors.push(`[${route.path}] variante carrée og:image NON absolue : "${squareImage}"`);
    } else if (!squareImage.endsWith(route.imageSquare)) {
      errors.push(`[${route.path}] variante carrée inattendue : "${squareImage}" (attendu se terminant par "${route.imageSquare}")`);
    }
  }

  if (!twitterImage) {
    errors.push(`[${route.path}] twitter:image ABSENT`);
  } else if (!isAbsolute(twitterImage)) {
    errors.push(`[${route.path}] twitter:image NON absolue : "${twitterImage}"`);
  }

  // Chaque og:image servi (wide + carré) sera vérifié en HTTP (200 + PNG +
  // dimensions) dans la passe dédiée en fin de script. Seules les URL
  // ABSOLUES sont mises en file : une URL relative a déjà échoué à la
  // vérification d'absoluité ci-dessus (et fetch() la rejetterait).
  for (const u of ogImages) if (isAbsolute(u)) queueImageUrl(u, route.path);

  checked.push(`  ✓ ${route.path} → ${ogImage || '(absent)'}` + (squareImage ? ` (+ carré ${squareImage})` : ''));
}

// ── /jobs/:id — fiche mission (pré-rendu par le BACKEND) ─────────────────
// Le backend (GET /api/og/jobs/{id}, kojo_routers_public.py) sert le HTML de
// chaque fiche avec les méta OG de la mission : og:image → carte backend
// (.png) + variante carrée (-square.png) + og:title réel — aiguillé par le
// rewrite Vercel /jobs/(.*). On récupère un VRAI job sur l'API publique du
// backend pour tester le chemin 200. Sans job en base, le chemin 200 est
// impossible à vérifier (état des données, pas une régression) : on le
// signale et on teste le chemin 404 (pré-rendu backend + aiguillage + noindex).
//
// Exception : sur le REPLI build local (preview Vercel indisponible ou
// protégée — LHCI_URL = http://localhost:4173), le chemin /jobs/:id n'existe
// pas : c'est le rewrite Vercel + le pré-rendu backend qui le servent, pas le
// build statique (SPA fallback → index.html en 200, sans noindex). Les
// assertions 404/noindex seraient donc des faux positifs → section ignorée.
const isLocalBase = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(BASE);

let jobId = '';
let jobTitle = '';
try {
  const jres = await fetch(`${BACKEND}/api/jobs?limit=1`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (jres.ok) {
    const data = await jres.json();
    const list = Array.isArray(data) ? data : (data.jobs || data.items || []);
    const first = list[0] || {};
    jobId = String(first.id || first._id || '');
    jobTitle = String(first.title || '');
  }
} catch (err) {
  console.warn(`  ⚠️ backend ${BACKEND} injoignable (${err.message}) — vérification /jobs/:id incomplète`);
}

const jobDetailLabel = '/jobs/:id';
if (isLocalBase) {
  console.log(`  ⚠️ ${jobDetailLabel} : repli build local (${BASE}) — rewrite Vercel + pré-rendu backend absents du build statique, section ignorée (le chemin 200/404 est vérifié contre le déploiement Vercel réel)`);
}
if (!jobId && !isLocalBase) {
  console.warn(`  ⚠️ ${jobDetailLabel} : aucun job sur ${BACKEND} — chemin 200 non vérifiable (état des données). Chemin 404 (pré-rendu backend + rewrite + noindex) testé à la place.`);
}

if (!isLocalBase) {
  const detailId = encodeURIComponent(jobId || 'check-nonexistent-job');
  const detailUrl = `${BASE}/jobs/${detailId}`;
  let detailStatus = 0;
  let detailHtml = '';
  let detailNoIndex = false;
  try {
    const res = await fetch(detailUrl, {
      redirect: 'follow',
      headers: { 'user-agent': 'kojo-og-image-check/1.0' },
      signal: AbortSignal.timeout(20000),
    });
    detailStatus = res.status;
    detailNoIndex = (res.headers.get('x-robots-tag') || '').includes('noindex');
    detailHtml = await res.text();
  } catch (err) {
    errors.push(`[${jobDetailLabel}] fetch ${detailUrl} échoué : ${err.message}`);
  }

  if (jobId) {
    // Chemin 200 : la fonction doit injecter les méta OG de la mission.
    if (detailStatus !== 200) {
      errors.push(`[${jobDetailLabel}] HTTP ${detailStatus} attendu 200 pour un job EXISTANT (fonction Vercel ou aiguillage cassé ?)`);
    }
    const ogImages = grabAll(detailHtml, 'property="og:image"');
    const wide = ogImages[0] || '';
    const square = ogImages.find((u) => u.includes('square')) || '';
    const expectedWide = `${ORIGIN}/api/og/jobs/${detailId}.png`;
    const expectedSquare = `${ORIGIN}/api/og/jobs/${detailId}-square.png`;
    if (!wide.endsWith(expectedWide)) {
      errors.push(`[${jobDetailLabel}] og:image mission inattendu : "${wide}" (attendu se terminant par "${expectedWide}")`);
    }
    if (!square.endsWith(expectedSquare)) {
      errors.push(`[${jobDetailLabel}] variante carrée mission inattendue : "${square}" (attendu se terminant par "${expectedSquare}")`);
    }
    if (jobTitle && !detailHtml.includes(jobTitle)) {
      errors.push(`[${jobDetailLabel}] og:title — titre de la mission "${jobTitle}" ABSENT du HTML servi`);
    }
    if (detailNoIndex) {
      errors.push(`[${jobDetailLabel}] x-robots-tag noindex présent sur un job EXISTANT`);
    }
    // Cartes dynamiques du job (backend Pillow) : GET réel + dimensions.
    if (isAbsolute(wide)) queueImageUrl(wide, jobDetailLabel);
    if (isAbsolute(square)) queueImageUrl(square, jobDetailLabel);
    checked.push(`  ✓ ${jobDetailLabel} → ${wide || '(absent)'}` + (square ? ` (+ carré ${square})` : '') + ` (job "${jobTitle || detailId}")`);
  } else {
    // Chemin 404 : prouve que la fonction est déployée et le rewrite aiguille
    // /jobs/:id vers elle (sinon le catch-all SPA renverrait 200 + index.html).
    if (detailStatus !== 404) {
      errors.push(`[${jobDetailLabel}] HTTP ${detailStatus} attendu 404 pour un job inconnu (pré-rendu backend non déployé ou rewrite cassé ?)`);
    }
    if (!detailNoIndex) {
      errors.push(`[${jobDetailLabel}] x-robots-tag noindex absent sur le 404`);
    }
    checked.push(`  ✓ ${jobDetailLabel} (404 + noindex — pré-rendu backend servi, chemin 200 non testé faute de job)`);
  }
}

// ── Passe HTTP : dimensions réelles de chaque carte OG servie ─────────────
// GET sur chaque og:image (statique Vercel ou carte dynamique backend),
// avec les assertions : 200, content-type image/png, width/height IHDR.
for (const { url, label } of imageUrlsToCheck) {
  await checkOgImageHttp(url, label);
}

console.log('Vérification og:image par route (base : ' + BASE + ') :');
console.log(checked.join('\n'));

if (errors.length) {
  console.error('\n❌ og:image invalide — ' + errors.length + ' problème(s) :');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('\n✅ Toutes les pages auditées servent un og:image absolu, valide en HTTP (200, image/png, dimensions attendues).');
