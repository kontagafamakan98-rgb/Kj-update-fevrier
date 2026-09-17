import { describe, it, expect, afterEach } from 'vitest';

import {
  runOgJob200Cycle,
  resolveAuthHeader,
  buildTestJobPayload,
  TEST_JOB_TITLE_PREFIX,
} from '../check-og-job-200';

// Tests du cycle « chemin 200 de /jobs/:id » (scripts/check-og-job-200.js).
//
// Le cycle est la seule couverture DÉTERMINISTE de la branche 200 : il crée sa
// propre mission, vérifie la carte OG réelle, puis la supprime. Ces tests
// pilotent un `fetch` injecté (aucun socket, aucune écriture en prod) et
// couvrent surtout ce qui NE se voit pas dans un run heureux :
//   • la suppression a bien lieu même quand la vérification OG échoue,
//   • aucune suppression n'est tentée si la création a échoué,
//   • un échec de suppression fait ÉCHOUER le script (mission laissée en base),
//   • sur base locale, le script ne touche PAS à la production.

const BASE = 'https://stub-frontend.test';
const BACKEND = 'https://stub-backend.test';
const ORIGIN = 'https://stub-origin.test';
// Identifiant de sonde demandé par le script : la base qui répond 404 +
// noindex le sert ; les autres (serveur statique nu) ne sont pas jugées.
const PROBE_ID = '00000000-0000-4000-8000-000000000000';
const JOB_ID = 'aaaa1111-bbbb-4222-8333-cccc44445555';
const JOB_TITLE = `${TEST_JOB_TITLE_PREFIX} 2026-09-16T00:00:00.000Z`;

// PNG minimal mais valide (signature + IHDR) : le check ne lit que ces octets.
const fakePng = (width, height) => {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

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

// Fiche mission telle que la sert le backend (méta OG absolues vers ORIGIN).
const detailHtml = ({ id, title }) =>
  `<!DOCTYPE html><html><head>
<title>${title} — Kojo</title>
<meta property="og:title" content="${title} — Kojo" />
<meta property="og:image" content="${ORIGIN}/api/og/jobs/${id}.png" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
<meta property="og:image" content="${ORIGIN}/api/og/jobs/${id}-square.png" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="1200" />
<meta name="twitter:image" content="${ORIGIN}/api/og/jobs/${id}.png" />
</head><body><div id="root"><h1>${title} — Kojo</h1></div></body></html>`;

/**
 * Stub de bout en bout : joue le backend (création/suppression) et la fiche
 * pré-rendue. `deleted` est mémorisé pour que le contrôle post-suppression
 * voie un 404, comme en vrai.
 */
const makeStub = ({
  createStatus = 201,
  deleteStatus = 200,
  detailStatus = 200,
  detailTitle = JOB_TITLE,
  imageStatus = 200,
  jobId = JOB_ID,
  // Verrou 404 (état après suppression).
  postDeleteDetailStatus = 404,
  postDeleteNoIndex = true,
  postDeleteCardStatus = 404,
  sitemapStatus = 200,
  sitemapBeforeIncludesJob = true,
  sitemapAfterDeleteIncludesJob = false,
  // La base auditée sert-elle la route /jobs/:id ? C'est ce que la SONDE
  // observe (sonde de capacité dans check-og-images.js) : le déploiement réel
  // et le serveur local de rewrites de la CI répondent 404 + noindex, un
  // serveur statique nu répond 200 + index.html.
  servesJobRoute = true,
} = {}) => {
  const calls = [];
  const sequence = [];
  let deleted = false;
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const parsed = new URL(target);
    // Le contrôle post-suppression est reconnaissable à son cache-buster :
    // c'est lui qui distingue « fiche vivante » (200, mise en cache 1 h) de
    // « fiche supprimée » (404 no-store) sur une même URL.
    const postDeleteProbe = parsed.searchParams.has('kojo_cb');
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: target, method });

    if (method === 'POST' && target === `${BACKEND}/api/jobs`) {
      sequence.push('create');
      if (createStatus >= 300) {
        return response({ status: createStatus, body: '{"detail":"Only clients can create jobs"}' });
      }
      return response({ status: createStatus, body: JSON.stringify({ id: jobId, title: JOB_TITLE }) });
    }

    if (method === 'DELETE' && target === `${BACKEND}/api/jobs/${jobId}`) {
      sequence.push('delete');
      if (deleteStatus >= 300) {
        return response({ status: deleteStatus, body: '{"detail":"Access denied"}' });
      }
      deleted = true;
      return response({ status: deleteStatus, body: JSON.stringify({ message: 'ok', job_id: jobId }) });
    }

    // Reconnu par son CHEMIN (pas par l'adresse) : les tests font varier la
    // base auditée (déploiement réel, serveur local de rewrites, statique nu)
    // et la sonde doit rester la même.
    if (parsed.pathname === `/jobs/${PROBE_ID}`) {
      sequence.push('probe');
      return servesJobRoute
        ? response({
            status: 404,
            headers: { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' },
            body: '<html><head><meta name="robots" content="noindex, nofollow" /></head></html>',
          })
        : response({ status: 200, body: '<html><div id="root"></div></html>' });
    }

    if (parsed.pathname === `/jobs/${jobId}`) {
      sequence.push(postDeleteProbe ? 'detail-after-delete' : 'detail');
      if (postDeleteProbe) {
        // Fiche supprimée : 404 (no-store) + noindex, comme le backend réel.
        if (postDeleteDetailStatus !== 404) {
          return response({ status: postDeleteDetailStatus, body: detailHtml({ id: jobId, title: detailTitle }) });
        }
        return response({
          status: 404,
          headers: postDeleteNoIndex ? { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' } : { 'cache-control': 'no-store' },
          body: postDeleteNoIndex
            ? '<title>Mission introuvable — Kojo</title>\n<meta name="robots" content="noindex, nofollow" />'
            : '<title>Mission introuvable — Kojo</title>',
        });
      }
      return response({ status: detailStatus, body: detailHtml({ id: jobId, title: detailTitle }) });
    }

    if (parsed.pathname === '/sitemap.xml') {
      // Discriminé par l'état du « backend », pas par le cache-buster : le
      // contrôle d'AVANT suppression en porte un aussi (clé de cache froide).
      sequence.push(deleted ? 'sitemap-after-delete' : 'sitemap');
      if (sitemapStatus !== 200) return response({ status: sitemapStatus, body: 'sitemap indisponible' });
      const listed = deleted ? sitemapAfterDeleteIncludesJob : sitemapBeforeIncludesJob;
      const locs = ['https://stub-origin.test/', 'https://stub-origin.test/jobs', 'https://stub-origin.test/login'];
      if (listed) locs.push(`${ORIGIN}/jobs/${jobId}`);
      return response({
        status: 200,
        headers: { 'content-type': 'application/xml' },
        body: `<?xml version="1.0" encoding="UTF-8"?><urlset>${locs.map((u) => `<loc>${u}</loc>`).join('')}</urlset>`,
      });
    }

    if (parsed.pathname.endsWith('.png')) {
      sequence.push('image');
      if (postDeleteProbe) {
        return response({ status: postDeleteCardStatus, headers: { 'content-type': 'application/json' }, body: '{"detail":"Not Found"}' });
      }
      const square = parsed.pathname.includes('-square');
      return response({
        status: imageStatus,
        headers: { 'content-type': 'image/png' },
        body: fakePng(1200, square ? 1200 : 630),
      });
    }

    return response({ status: 404, body: 'not found' });
  };
  return { fetchImpl, calls, sequence, isDeleted: () => deleted };
};

const runCycle = (stub, overrides = {}) =>
  runOgJob200Cycle({
    base: BASE,
    backend: BACKEND,
    origin: ORIGIN,
    token: 'jeton-de-test',
    quiet: true,
    fetchImpl: stub.fetchImpl,
    // Cache-buster fixe : rend les URL post-suppression vérifiables à
    // l'identique (et prouve que le verrou n'interroge jamais l'URL mise en
    // cache 1 h de la fiche vivante).
    cacheBust: 'cb-test',
    ...overrides,
  });

const originalEnv = { ...process.env };
afterEach(() => {
  for (const key of ['KOJO_LHCI_AUTH_HEADER', 'LHCI_CI_EMAIL', 'LHCI_CI_PASSWORD', 'LHCI_TEST_EMAIL', 'LHCI_TEST_PASSWORD']) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('cycle /jobs/:id — chemin 200', () => {
  it('crée la mission, vérifie la carte OG puis la supprime', async () => {
    const stub = makeStub();
    const result = await runCycle(stub);

    expect(result.ok, result.errors.join('\n')).toBe(true);
    expect(result.created).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.deleted).toBe(true);
    expect(result.jobId).toBe(JOB_ID);
    // Ordre : sonde de capacité → création → fiche → cartes → suppression.
    expect(stub.sequence[0]).toBe('probe');
    expect(stub.sequence[1]).toBe('create');
    expect(stub.sequence).toContain('image');
    expect(stub.sequence.indexOf('delete')).toBeGreaterThan(stub.sequence.indexOf('detail'));
    // La mission est bien supprimée côté « backend ».
    expect(stub.isDeleted()).toBe(true);
    // Les deux cartes (wide + carrée) ont été téléchargées réellement.
    const images = stub.calls.filter((c) => c.url.endsWith('.png'));
    expect(images.map((c) => c.url)).toEqual([
      `${ORIGIN}/api/og/jobs/${JOB_ID}.png`,
      `${ORIGIN}/api/og/jobs/${JOB_ID}-square.png`,
    ]);
  });

  it('supprime la mission MÊME si la carte OG est cassée (nettoyage garanti)', async () => {
    // Le titre réel de la mission n'apparaît pas dans le HTML servi : c'est la
    // régression que ce cycle doit attraper (og:title/og:image perdus).
    const stub = makeStub({ detailTitle: 'Titre totalement different' });
    const result = await runCycle(stub);

    expect(result.ok).toBe(false);
    expect(result.errors.join(' | ')).toMatch(/titre de la mission/);
    expect(result.deleted).toBe(true);
    expect(stub.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('échoue si les cartes Pillow ne sont pas des PNG aux bonnes dimensions', async () => {
    const stub = makeStub({ imageStatus: 500 });
    const result = await runCycle(stub);

    expect(result.ok).toBe(false);
    expect(result.errors.join(' | ')).toMatch(/og:image HTTP 500/);
    expect(result.deleted).toBe(true); // nettoyage quand même
  });

  it('ne tente AUCUNE suppression si la création échoue', async () => {
    const stub = makeStub({ createStatus: 403 });
    const result = await runCycle(stub);

    expect(result.ok).toBe(false);
    expect(result.created).toBe(false);
    expect(result.errors.join(' | ')).toMatch(/création de la mission de test HTTP 403/);
    expect(stub.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('échoue explicitement si la suppression échoue (mission laissée en base)', async () => {
    const stub = makeStub({ deleteStatus: 500 });
    const result = await runCycle(stub);

    expect(result.ok).toBe(false);
    expect(result.deleted).toBe(false);
    expect(result.errors.join(' | ')).toMatch(/SUPPRESSION de la mission de test échouée \(HTTP 500\)/);
    expect(result.errors.join(' | ')).toContain(JOB_ID);
  });

  it('s EXÉCUTE sur une base locale qui sert la route (serveur de rewrites de la CI)', async () => {
    // Le repli de la CI n'est plus un `vite preview` nu : c'est le serveur qui
    // rejoue la table de vercel.json devant le backend de la PR, donc un
    // cycle COMPLET en vraies requêtes HTTP sur chaque PR. L'heuristique
    // d'adresse qui sautait sur `localhost` est ce qui rendait ce run
    // impossible : seule la sonde de capacité peut le distinguer d'un serveur
    // statique.
    const stub = makeStub();
    const result = await runCycle(stub, { base: 'http://127.0.0.1:4174' });

    expect(result.ok, result.errors.join('\n')).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.jobRoute.serves).toBe(true);
    expect(result.created).toBe(true);
    expect(result.deleted).toBe(true);
    expect(stub.calls.some((c) => c.method === 'POST')).toBe(true);
    expect(stub.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('ne touche à rien quand la base ne sert PAS la route (serveur statique nu)', async () => {
    const stub = makeStub({ servesJobRoute: false });
    const result = await runCycle(stub, { base: 'http://localhost:4173' });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.jobRoute.serves).toBe(false);
    expect(result.created).toBe(false);
    // Seule la sonde a été posée : aucune mission créée, aucune écriture.
    expect(stub.calls.map((c) => c.method)).toEqual(['GET']);
    expect(stub.calls[0].url).toBe(`http://localhost:4173/jobs/${PROBE_ID}`);
    expect(result.notices.join(' | ')).toMatch(/IGNORÉ/);
    expect(result.notices.join(' | ')).toMatch(/ne sert PAS la route backend/);
  });

  it('échoue si aucun jeton n’est disponible (chemin 200 non vérifiable)', async () => {
    const stub = makeStub();
    delete process.env.KOJO_LHCI_AUTH_HEADER;
    const result = await runCycle(stub, { token: '', email: '', password: '' });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' | ')).toMatch(/Aucun jeton disponible/);
    expect(stub.calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

// Le verrou 404 est la moitié du cycle qui n'était pas couverte : le contrôle
// post-suppression était CONSULTATIF (::notice), donc une fiche de mission
// supprimée restée servie en 200 — indexable, avec sa carte OG toujours en
// ligne — passait inaperçue. Ces tests fixent les quatre exigences et, surtout,
// l'anti-vacuité : un sitemap qui ne référence plus aucune mission doit faire
// ÉCHOUER le cycle, pas le rendre vert à vide.
describe('verrou 404 après suppression', () => {
  it('exige fiche 404 + noindex, carte OG 404 et mission absente du sitemap', async () => {
    const stub = makeStub();
    const result = await runCycle(stub);

    expect(result.ok, result.errors.join('\n')).toBe(true);
    expect(result.postDelete).toEqual({ detail: true, noindex: true, card: true, sitemap: true });

    // La mission est listée AVANT suppression (sinon l'absence ne prouve rien),
    // puis le sitemap est relu APRÈS.
    expect(stub.sequence.indexOf('sitemap')).toBeGreaterThan(-1);
    expect(stub.sequence.indexOf('sitemap')).toBeLessThan(stub.sequence.indexOf('delete'));
    expect(stub.sequence.indexOf('sitemap-after-delete')).toBeGreaterThan(stub.sequence.indexOf('delete'));

    // Les trois sondes post-suppression portent le cache-buster : l'URL nue de
    // la fiche est mise en cache 1 h côté CDN (s-maxage=3600), l'interroger
    // telle quelle pourrait renvoyer un 200 périmé.
    const probeUrls = stub.calls.filter((c) => c.url.includes('kojo_cb=cb-test')).map((c) => c.url);
    expect(probeUrls).toEqual([
      `${BASE}/sitemap.xml?kojo_cb=cb-test`,
      `${BASE}/jobs/${JOB_ID}?kojo_cb=cb-test`,
      `${ORIGIN}/api/og/jobs/${JOB_ID}.png?kojo_cb=cb-test`,
      `${BASE}/sitemap.xml?kojo_cb=cb-test`,
    ]);
    // La fiche vivante n'est interrogée qu'une fois (le chemin 200), jamais la
    // version mise en cache après le DELETE.
    expect(stub.calls.filter((c) => c.url === `${BASE}/jobs/${JOB_ID}`)).toHaveLength(1);
  });

  it('échoue si la fiche reste servie en 200 après suppression', async () => {
    const stub = makeStub({ postDeleteDetailStatus: 200 });
    const result = await runCycle(stub);

    expect(result.ok).toBe(false);
    expect(result.postDelete.detail).toBe(false);
    expect(result.errors.join(' | ')).toMatch(/répond HTTP 200 après suppression/);
  });

  it('échoue si la fiche supprimée perd son noindex', async () => {
    const stub = makeStub({ postDeleteNoIndex: false });
    const result = await runCycle(stub);

    expect(result.ok).toBe(false);
    expect(result.postDelete.detail).toBe(true); // bien en 404…
    expect(result.postDelete.noindex).toBe(false); // …mais indexable
    expect(result.errors.join(' | ')).toMatch(/SANS noindex/);
  });

  it('échoue si la carte OG de la mission supprimée est encore servie', async () => {
    const stub = makeStub({ postDeleteCardStatus: 200 });
    const result = await runCycle(stub);

    expect(result.ok).toBe(false);
    expect(result.postDelete.card).toBe(false);
    expect(result.errors.join(' | ')).toMatch(/carte OG .* répond HTTP 200 après suppression/);
  });

  it('échoue si la mission supprimée reste listée dans le sitemap', async () => {
    const stub = makeStub({ sitemapAfterDeleteIncludesJob: true });
    const result = await runCycle(stub);

    expect(result.ok).toBe(false);
    expect(result.postDelete.sitemap).toBe(false);
    expect(result.errors.join(' | ')).toMatch(/TOUJOURS listée dans .*sitemap\.xml/);
  });

  it('échoue si le sitemap n’est pas servi (rewrite /sitemap.xml cassé)', async () => {
    const stub = makeStub({ sitemapStatus: 500 });
    const result = await runCycle(stub);

    expect(result.ok).toBe(false);
    expect(result.postDelete.sitemap).toBe(false);
    expect(result.errors.join(' | ')).toMatch(/sitemap .* HTTP 500/);
  });

  it('échoue si la mission n’apparaît PAS dans le sitemap avant suppression (anti-vacuité)', async () => {
    // Sans cette assertion, un sitemap qui ne référence plus aucune mission
    // rendrait « absente du sitemap » vraie à vide : le verrou serait un
    // garde jamais exécuté.
    const stub = makeStub({ sitemapBeforeIncludesJob: false });
    const result = await runCycle(stub);

    expect(result.ok).toBe(false);
    expect(result.errors.join(' | ')).toMatch(/n'apparaît PAS dans/);
    expect(result.postDelete.sitemap).toBe(true); // l'absence, elle, est bien constatée
  });
});

describe('cycle /jobs/:id — jeton et charge utile', () => {
  it('utilise KOJO_LHCI_AUTH_HEADER quand aucun jeton explicite n’est fourni', async () => {
    process.env.KOJO_LHCI_AUTH_HEADER = JSON.stringify({ Authorization: 'Bearer jeton-du-job' });
    const errors = [];
    const auth = await resolveAuthHeader({ backend: BACKEND, fetchImpl: makeStub().fetchImpl, errors });
    expect(auth).toBe('Bearer jeton-du-job');
    expect(errors).toEqual([]);
  });

  it('se rabat sur le login du compte CI si KOJO_LHCI_AUTH_HEADER est absent', async () => {
    delete process.env.KOJO_LHCI_AUTH_HEADER;
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase() });
      return response({ status: 200, body: JSON.stringify({ access_token: 'jeton-login' }) });
    };
    const errors = [];
    const auth = await resolveAuthHeader({
      backend: BACKEND,
      email: 'ci@example.test',
      password: 'secret',
      fetchImpl,
      errors,
    });
    expect(auth).toBe('Bearer jeton-login');
    expect(calls).toEqual([{ url: `${BACKEND}/api/auth/login`, method: 'POST' }]);
    expect(errors).toEqual([]);
  });

  it('signale un KOJO_LHCI_AUTH_HEADER illisible sans bloquer le repli login', async () => {
    process.env.KOJO_LHCI_AUTH_HEADER = '{pas du json';
    const errors = [];
    const auth = await resolveAuthHeader({
      backend: BACKEND,
      email: 'ci@example.test',
      password: 'secret',
      fetchImpl: async () => response({ status: 200, body: JSON.stringify({ access_token: 'jeton-login' }) }),
      errors,
    });
    expect(auth).toBe('Bearer jeton-login');
    expect(errors.join(' | ')).toMatch(/KOJO_LHCI_AUTH_HEADER illisible/);
  });

  it('construit une charge utile valide au regard de JobCreate', () => {
    const payload = buildTestJobPayload('2026-09-16T00:00:00.000Z');
    expect(payload.title.startsWith(TEST_JOB_TITLE_PREFIX)).toBe(true);
    expect(payload.title.length).toBeGreaterThanOrEqual(5);
    expect(payload.title.length).toBeLessThanOrEqual(200);
    expect(payload.description.length).toBeGreaterThanOrEqual(20);
    expect(payload.category.length).toBeGreaterThanOrEqual(3);
    expect(payload.budget_min).toBeLessThanOrEqual(payload.budget_max);
    expect(payload.location.address.length).toBeGreaterThan(0);
    expect(Array.isArray(payload.required_skills)).toBe(true);
  });
});
