import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runOgImageCheck, ROUTES, PROD_ORIGIN } from '../check-og-images';

// Tests du garde-fou « og:image par route » (scripts/check-og-images.js).
//
// Ce check tourne en CI contre le déploiement réel, mais sa branche la plus
// fragile — la validation de la carte DYNAMIQUE d'une mission (/jobs/:id,
// pré-rendue par le backend Pillow) — n'était exercée que les jours où une
// mission existait en base. Un garde jamais exécuté ne garde rien : ces tests
// pilotent donc un `fetch` injecté qui joue le frontend ET le backend, pour
// exercer DÉTERMINISTEMENT les deux branches (200 avec mission, 404 sans
// mission) et prouver que le check échoue quand une carte se casse.
//
// Aucun socket, aucun réseau, aucune écriture en prod.

const ORIGIN = 'https://stub-frontend.test';

// PNG minimal mais VALIDE pour le check : signature + IHDR (le check ne lit
// que ces 33 octets pour les dimensions).
const fakePng = (width, height) => {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

const pageHtml = ({ og, square, twitter = og }) =>
  `<!DOCTYPE html><html><head>
<meta property="og:image" content="${og}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
${square ? `<meta property="og:image" content="${square}" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="1200" />` : ''}
<meta name="twitter:image" content="${twitter}" />
</head><body><div id="root"></div></body></html>`;

const detailHtml = ({ id, title, square = true }) =>
  `<!DOCTYPE html><html><head>
<title>${title} — Kojo</title>
<meta property="og:title" content="${title} — Kojo" />
<meta property="og:image" content="${ORIGIN}/api/og/jobs/${id}.png" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
${square ? `<meta property="og:image" content="${ORIGIN}/api/og/jobs/${id}-square.png" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="1200" />` : ''}
<meta name="twitter:image" content="${ORIGIN}/api/og/jobs/${id}.png" />
</head><body><div id="root"><h1>${title} — Kojo</h1></div></body></html>`;

// Réponse minimale compatible avec ce que le check consomme (ok/status/
// headers.get/arrayBuffer/text) — pas besoin d'undici ni de sockets.
const response = ({ status = 200, headers = {}, body = '' }) => {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    text: async () => buffer.toString('utf8'),
    json: async () => JSON.parse(buffer.toString('utf8')),
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
};

const JOB = { id: 'aaaa1111-bbbb-4222-8333-cccc44445555', title: 'Reparation ordinateur portable' };
// Identifiant de SONDE : le check demande une fiche qui ne peut pas exister et
// en déduit si la base auditée sert réellement la route /jobs/:id (404 +
// noindex) — c'est cette observation, et non l'adresse, qui décide si la
// section est exécutée (un serveur local de rewrites sert la route).
const PROBE_ID = '00000000-0000-4000-8000-000000000000';
const PROBE_PATH = `/jobs/${PROBE_ID}`;

// Routes statiques conformes (cartes en file pour la passe HTTP).
// `base` = adresse AUDITÉE (elle varie : déploiement réel, serveur local) ;
// ORIGIN reste l'origin des cartes og:image déclarées dans les shells.
const staticRoutes = (base = ORIGIN) => {
  const map = {};
  for (const route of ROUTES) {
    map[`${base}${route.path}`] = {
      body: pageHtml({
        og: `${ORIGIN}${route.image || '/og-image-1200x630.png'}`,
        square: route.imageSquare ? `${ORIGIN}${route.imageSquare}` : '',
      }),
    };
  }
  return map;
};

const defaultMap = (base = ORIGIN) => ({
  ...staticRoutes(base),
  [`${ORIGIN}/og-image-1200x630.png`]: { body: fakePng(1200, 630), headers: { 'content-type': 'image/png' } },
  [`${ORIGIN}/og-square-1200x1200.png`]: { body: fakePng(1200, 1200), headers: { 'content-type': 'image/png' } },
  [`${ORIGIN}/og-jobs.png`]: { body: fakePng(1200, 630), headers: { 'content-type': 'image/png' } },
  [`${ORIGIN}/og-jobs-square.png`]: { body: fakePng(1200, 1200), headers: { 'content-type': 'image/png' } },
  [`${ORIGIN}/og-login.png`]: { body: fakePng(1200, 630), headers: { 'content-type': 'image/png' } },
  [`${ORIGIN}/og-login-square.png`]: { body: fakePng(1200, 1200), headers: { 'content-type': 'image/png' } },
  // Backend : liste des missions (découverte du job à tester).
  'https://stub-backend.test/api/jobs?limit=1': {
    body: JSON.stringify([JOB]),
    headers: { 'content-type': 'application/json' },
  },
  // Fiche mission : pré-rendu backend (chemin 200).
  [`${base}/jobs/${JOB.id}`]: { body: detailHtml({ id: JOB.id, title: JOB.title }) },
  [`${ORIGIN}/api/og/jobs/${JOB.id}.png`]: {
    body: fakePng(1200, 630),
    headers: { 'content-type': 'image/png' },
  },
  [`${ORIGIN}/api/og/jobs/${JOB.id}-square.png`]: {
    body: fakePng(1200, 1200),
    headers: { 'content-type': 'image/png' },
  },
  // Fiche inconnue : pré-rendu backend en 404 + noindex.
  [`${base}/jobs/check-nonexistent-job`]: {
    status: 404,
    body: '<html><head><meta name="robots" content="noindex, nofollow" /></head></html>',
    headers: { 'x-robots-tag': 'noindex, nofollow' },
  },
  // Sonde de capacité : cette base SERT la route /jobs/:id (pré-rendu backend
  // servi, comme le déploiement réel et comme le serveur local de la CI).
  [`${base}${PROBE_PATH}`]: {
    status: 404,
    body: '<html><head><meta name="robots" content="noindex, nofollow" /></head></html>',
    headers: { 'x-robots-tag': 'noindex, nofollow' },
  },
});

// Base statique NUE (vite preview, `serve`, un serveur de fichiers) : elle ne
// connaît AUCUNE règle de vercel.json. Elle répond à tout — y compris
// /jobs/<id> — par le repli SPA (200 + index.html), et ne doit donc jamais
// être jugée sur la fiche mission : ses 404 seraient des faux positifs.
const staticOnlyMap = (base = ORIGIN) => {
  const map = defaultMap(base);
  delete map[`${base}/jobs/${JOB.id}`];
  delete map[`${base}/jobs/check-nonexistent-job`];
  // Le repli SPA d'un serveur statique : 200 + coquille vide, et SURTOUT aucun
  // noindex — c'est ce que la sonde distingue d'un vrai aiguillage.
  map[`${base}${PROBE_PATH}`] = { status: 200, body: '<html><div id="root"></div></html>' };
  return map;
};

const makeFetch = (map, calls = []) => async (url) => {
  calls.push(String(url));
  const entry = map[String(url)];
  if (!entry) return response({ status: 404, body: 'not found' });
  return response(entry);
};

const run = async (map, overrides = {}) => {
  const calls = [];
  const result = await runOgImageCheck({
    base: ORIGIN,
    backend: 'https://stub-backend.test',
    origin: ORIGIN,
    quiet: true,
    fetchImpl: makeFetch(map, calls),
    ...overrides,
  });
  return { result, calls };
};

let consoleError;

beforeEach(() => {
  // Le check imprime ses erreurs (utile en CI) : on tait la sortie en test.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  vi.restoreAllMocks();
});

describe('check-og-images — branche 200 (mission réellement en base)', () => {
  it('valide la carte dynamique de la mission et ses deux variantes', async () => {
    const { result, calls } = await run(defaultMap());

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.job200Exercised).toBe(true);
    expect(result.notices).toEqual([]);

    // Le titre réel doit avoir été cherché dans le HTML de la fiche.
    expect(calls).toContain(`${ORIGIN}/jobs/${JOB.id}`);
    expect(result.checked.join('\n')).toContain(`job "${JOB.title}"`);
    // Les dimensions réelles des cartes Pillow sont vérifiées en HTTP.
    expect(result.checked.join('\n')).toContain(`200 1200x630 (image/png) : ${ORIGIN}/api/og/jobs/${JOB.id}.png`);
    expect(result.checked.join('\n')).toContain(`200 1200x1200 (image/png) : ${ORIGIN}/api/og/jobs/${JOB.id}-square.png`);
  });

  it('échoue si le titre de la mission est absent du HTML servi', async () => {
    const map = defaultMap();
    map[`${ORIGIN}/jobs/${JOB.id}`] = { body: detailHtml({ id: JOB.id, title: 'Autre titre' }) };
    const { result } = await run(map);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/og:title — titre de la mission "Reparation ordinateur portable" ABSENT/);
  });

  it('échoue si la carte carrée de la mission n a pas les bonnes dimensions', async () => {
    const map = defaultMap();
    map[`${ORIGIN}/api/og/jobs/${JOB.id}-square.png`] = {
      body: fakePng(1200, 630),
      headers: { 'content-type': 'image/png' },
    };
    const { result } = await run(map);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/dimensions 1200x630 \(attendu 1200x1200\)/);
  });

  it('échoue si la variante carrée de la mission disparaît de la fiche', async () => {
    const map = defaultMap();
    map[`${ORIGIN}/jobs/${JOB.id}`] = { body: detailHtml({ id: JOB.id, title: JOB.title, square: false }) };
    const { result } = await run(map);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/variante carrée mission inattendue/);
  });

  it('échoue si la fiche servie est marquée noindex alors que la mission existe', async () => {
    const map = defaultMap();
    map[`${ORIGIN}/jobs/${JOB.id}`] = {
      body: detailHtml({ id: JOB.id, title: JOB.title }),
      headers: { 'x-robots-tag': 'noindex' },
    };
    const { result } = await run(map);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/noindex présent sur un job EXISTANT/);
  });
});

describe('check-og-images — branche 404 (aucune mission en base)', () => {
  const emptyBackend = (map) => {
    map['https://stub-backend.test/api/jobs?limit=1'] = {
      body: '[]',
      headers: { 'content-type': 'application/json' },
    };
    return map;
  };

  it('vérifie le repli 404 + noindex ET signale explicitement ce qui n a pas été testé', async () => {
    const { result, calls } = await run(emptyBackend(defaultMap()));

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.job200Exercised).toBe(false);
    // Une notice doit dire que la branche 200 n'a pas été exercée : un vert ne
    // doit pas laisser croire que tout le chemin a été validé.
    expect(result.notices.join('\n')).toMatch(/aucune mission en base .*n'a PAS été exercée/);
    expect(result.checked.join('\n')).toContain('404 + noindex');
    expect(calls).toContain(`${ORIGIN}/jobs/check-nonexistent-job`);
  });

  it('échoue si le 404 ne porte pas l en-tête noindex', async () => {
    const map = emptyBackend(defaultMap());
    map[`${ORIGIN}/jobs/check-nonexistent-job`] = { status: 404, body: '<html></html>' };
    const { result } = await run(map);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/x-robots-tag noindex absent sur le 404/);
  });

  it('échoue si le catch-all SPA renvoie 200 au lieu du pré-rendu 404', async () => {
    const map = emptyBackend(defaultMap());
    map[`${ORIGIN}/jobs/check-nonexistent-job`] = {
      status: 200,
      body: '<html><div id="root"></div></html>',
    };
    const { result } = await run(map);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/HTTP 200 attendu 404/);
  });
});

describe('check-og-images — routes statiques', () => {
  it('échoue si un og:image n est pas absolu', async () => {
    const map = defaultMap();
    map[`${ORIGIN}/jobs`] = { body: pageHtml({ og: '/og-jobs.png', square: '/og-jobs-square.png' }) };
    const { result } = await run(map);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/\/jobs\] og:image NON absolue/);
  });

  it('échoue si la variante carrée attendue manque sur une route dédiée', async () => {
    const map = defaultMap();
    map[`${ORIGIN}/login`] = { body: pageHtml({ og: `${ORIGIN}/og-login.png` }) };
    const { result } = await run(map);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/variante CARRÉE og:image ABSENTE/);
  });

  it('échoue si une carte statique n est pas servie en 200', async () => {
    const map = defaultMap();
    map[`${ORIGIN}/og-jobs.png`] = { status: 500, body: 'boom' };
    const { result } = await run(map);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/og:image HTTP 500 \(attendu 200\)/);
  });
});

describe('check-og-images — capacité de la base auditée (observée, pas devinée)', () => {
  it('ignore la section /jobs/:id quand la base ne la sert PAS (serveur statique nu)', async () => {
    const { result, calls } = await run(staticOnlyMap());

    expect(result.jobRouteServed).toBe(false);
    // La sonde a bien été posée : c'est elle qui décide, pas l'adresse.
    expect(calls).toContain(`${ORIGIN}${PROBE_PATH}`);
    expect(result.checked.join('\n')).not.toContain('/jobs/:id');
    // Aucune AUTRE sonde : pas de fiche interrogée, pas de backend sollicité.
    expect(calls.filter((u) => u.includes('/jobs/'))).toEqual([`${ORIGIN}${PROBE_PATH}`]);
    expect(calls.some((u) => u.includes('stub-backend.test'))).toBe(false);
    // La fiche mission n'est pas vérifiée ici : ça doit être annoncé.
    expect(result.notices.join('\n')).toMatch(/n'a PAS été vérifiée par ce run/);
  });

  it('exécute la section /jobs/:id sur une base LOCALE qui sert la route (serveur de rewrites de la CI)', async () => {
    // Même situation que le repli de la CI depuis le 17/09/2026 : l'adresse est
    // locale, mais la table de verrous de vercel.json est rejouée devant le
    // backend de la PR — la fiche existe donc, et l'heuristique d'adresse
    // (supprimée) aurait fait sauter le seul run qui pouvait l'exercer.
    const localBase = 'http://127.0.0.1:4174';
    const { result, calls } = await run(defaultMap(localBase), { base: localBase });

    expect(result.jobRouteServed).toBe(true);
    expect(result.job200Exercised).toBe(true);
    expect(result.errors).toEqual([]);
    expect(calls).toContain(`${localBase}/jobs/${JOB.id}`);
  });
});

describe('check-og-images — constantes', () => {
  it('vérifie les routes auditées par lighthouserc (garde anti-désynchronisation)', () => {
    expect(ROUTES.map((r) => r.path)).toEqual([
      '/',
      '/jobs',
      '/login',
      '/register',
      '/dashboard',
      '/profile',
    ]);
    // Les routes à carte dédiée portent leur variante carrée (réseaux 1:1).
    for (const route of ROUTES.filter((r) => r.image)) {
      expect(route.imageSquare).toBeTruthy();
    }
  });

  it('l origin par défaut est le domaine de prod (les cartes backend y pointent)', () => {
    expect(PROD_ORIGIN).toBe('https://kj-update-fevrier.vercel.app');
  });
});
