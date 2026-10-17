/**
 * PREUVE D'ÉCHEC de `check-job-form-canari.js` : la FORME d'une fiche
 * `/jobs/:id` est jugée sur le document SERVI, la mission de contrôle est
 * toujours supprimée, et l'écriture n'a lieu que sous mandat.
 *
 * Ce que ces cas mesurent, et pourquoi chacun existe :
 *   • la RÈGLE de forme, cas par cas, sans serveur (`defautsDeForme` est pure) :
 *     un titre générique, une description absente ou générique, un noindex, un
 *     canonical absent / d'une autre page / d'une autre origine, un og:url ou un
 *     twitter:url qui désigne ailleurs, un og:title en désaccord avec le
 *     <title>, un <h1> absent — chaque défaut nommé, aucun avalé ;
 *   • le CYCLE : création → jugement → suppression, sur un `fetch` injecté
 *     (aucun socket, aucune écriture réelle) ;
 *   • le MANDAT : hors loopback sans `KOJO_CANARI_ALLOW_WRITE=1`, RIEN n'est
 *     écrit et la surface est DÉCLARÉE (avertissement), jamais tue ;
 *   • le NETTOYAGE : la suppression a lieu même quand la forme est défectueuse,
 *     elle n'est jamais tentée si la création a échoué, et elle ne vise que
 *     l'identifiant créé ;
 *   • le VERROU : une mission absente du sitemap avant suppression rend le
 *     contrôle d'absence vide de sens, et c'est un ÉCHEC (pas une note).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { TEST_JOB_TITLE_PREFIX, buildTestJobPayload } from '../check-og-job-200';
import {
  DESCRIPTION_EXCERPT,
  MANDAT_ECRITURE_ENV,
  decoderEntites,
  defautsDeForme,
  ecritureAutorisee,
  extraitDeDescription,
  runJobFormCanari,
} from '../check-job-form-canari';
import { SURFACE_JOB_FORM_CANARI_FORME } from '../corpus-missions';

const BASE = 'http://127.0.0.1:4173';
// Le cycle ÉCRIT : ces cas exercent la seule adresse qu'il a le droit d'écrire
// sans mandat — un backend contrôlé par le job (loopback).
const BACKEND = 'http://127.0.0.1:8000';
const PROD_BACKEND = 'https://api.kojoforafrica.cc.cd';
const ORIGIN = 'https://stub-origin.test';
// Identifiant de sonde demandé par la capacité observée de la base (404 +
// noindex = la route backend est servie ; 200 + index.html = statique nu).
const PROBE_ID = '00000000-0000-4000-8000-000000000000';
const JOB_ID = 'aaaa1111-bbbb-4222-8333-cccc44445555';
const STAMP = '2026-10-16T00:00:00.000Z';
const PAYLOAD = buildTestJobPayload(STAMP);
const JOB_TITLE = PAYLOAD.title;
const TITRE_SERVI = `${JOB_TITLE} — Kojo`;

const PNG = (width, height) => {
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

/**
 * Le document que sert le backend pour une mission — CONFORME par défaut, champ
 * par champ surchargeable : chaque cas de défaut n'écrit QUE ce qu'il met en
 * cause, donc un défaut qui ne se déclare pas tout seul ne peut pas se cacher
 * derrière un autre.
 */
const ficheHtml = ({
  id = JOB_ID,
  titre = TITRE_SERVI,
  description = extraitDeDescription(PAYLOAD.description),
  robots = 'index, follow',
  canonical = `${ORIGIN}/jobs/${id}`,
  ogTitre = TITRE_SERVI,
  ogUrl = `${ORIGIN}/jobs/${id}`,
  twitterUrl = `${ORIGIN}/jobs/${id}`,
  h1 = TITRE_SERVI,
} = {}) =>
  `<!DOCTYPE html><html lang="fr"><head>
<title>${titre}</title>
<meta name="description" content="${description}" />
<meta name="robots" content="${robots}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="article" />
<meta property="og:url" content="${ogUrl}" />
<meta property="og:title" content="${ogTitre}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${ORIGIN}/api/og/jobs/${id}.png" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
<meta property="og:image" content="${ORIGIN}/api/og/jobs/${id}-square.png" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="1200" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:url" content="${twitterUrl}" />
<meta name="twitter:title" content="${ogTitre}" />
<meta name="twitter:image" content="${ORIGIN}/api/og/jobs/${id}.png" />
</head><body><div id="root">
<h1 class="text-3xl font-bold text-gray-900 mb-2">${h1}</h1>
</div></body></html>`;

/**
 * Stub de bout en bout : joue le backend (création/suppression), la fiche
 * pré-rendue, les deux cartes Pillow et le sitemap. `deleted` est mémorisé pour
 * que le verrou post-suppression voie un 404, comme en vrai.
 */
const makeStub = ({
  createStatus = 201,
  deleteStatus = 200,
  detailStatus = 200,
  detailHeaders = {},
  forme = {},
  imageStatus = 200,
  servesJobRoute = true,
  sitemapBeforeIncludesJob = true,
  sitemapAfterDeleteIncludesJob = false,
  postDeleteDetailStatus = 404,
  postDeleteNoIndex = true,
  postDeleteCardStatus = 404,
} = {}) => {
  const calls = [];
  const sequence = [];
  let deleted = false;
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const parsed = new URL(target);
    // Le verrou post-suppression est reconnaissable à son cache-buster : la
    // fiche d'une mission vivante est servie avec s-maxage=3600, donc l'URL nue
    // pourrait renvoyer un 200 sorti du cache CDN.
    const postDeleteProbe = parsed.searchParams.has('kojo_cb');
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: target, method });

    // Reconnu par son CHEMIN : les cas font varier le backend ciblé (loopback,
    // production sous mandat) et le stub doit rester le même.
    if (method === 'POST' && parsed.pathname === '/api/jobs') {
      sequence.push('create');
      if (createStatus >= 300) {
        return response({ status: createStatus, body: '{"detail":"Only clients can create jobs"}' });
      }
      return response({ status: createStatus, body: JSON.stringify({ id: JOB_ID, title: JOB_TITLE }) });
    }

    if (method === 'DELETE' && parsed.pathname === `/api/jobs/${JOB_ID}`) {
      sequence.push('delete');
      if (deleteStatus >= 300) {
        return response({ status: deleteStatus, body: '{"detail":"Access denied"}' });
      }
      deleted = true;
      return response({ status: deleteStatus, body: JSON.stringify({ message: 'ok', job_id: JOB_ID }) });
    }

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

    if (parsed.pathname === `/jobs/${JOB_ID}`) {
      sequence.push('fiche');
      if (postDeleteProbe || deleted) {
        return response({
          status: postDeleteDetailStatus,
          headers: postDeleteNoIndex
            ? { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' }
            : { 'cache-control': 'no-store' },
          body: '<html><head><meta name="robots" content="noindex, nofollow" /></head></html>',
        });
      }
      return response({ status: detailStatus, headers: detailHeaders, body: ficheHtml(forme) });
    }

    if (parsed.pathname.startsWith(`/api/og/jobs/${JOB_ID}`)) {
      sequence.push('carte');
      if (deleted) return response({ status: postDeleteCardStatus, body: '' });
      if (imageStatus >= 300) return response({ status: imageStatus, body: 'nope' });
      const carree = parsed.pathname.includes('-square');
      return response({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: PNG(carree ? 1200 : 1200, carree ? 1200 : 630),
      });
    }

    if (parsed.pathname === '/sitemap.xml') {
      sequence.push('sitemap');
      // Les DEUX lectures du sitemap portent le cache-buster (le verrou anti-CDN
      // s'applique aux deux) : c'est la SUPPRESSION qui les distingue, pas la
      // requête.
      const includes = deleted ? sitemapAfterDeleteIncludesJob : sitemapBeforeIncludesJob;
      const locs = [`${ORIGIN}/`, `${ORIGIN}/jobs`, ...(includes ? [`${ORIGIN}/jobs/${JOB_ID}`] : [])];
      return response({
        status: 200,
        headers: { 'content-type': 'application/xml' },
        body: `<?xml version="1.0" encoding="UTF-8"?><urlset>${locs
          .map((loc) => `<url><loc>${loc}</loc></url>`)
          .join('')}</urlset>`,
      });
    }

    throw new Error(`requête non prévue par le stub : ${method} ${target}`);
  };
  return { fetchImpl, calls, sequence, wasDeleted: () => deleted };
};

const token = 'stub-token';
const run = (stub, options = {}) =>
  runJobFormCanari({
    base: BASE,
    backend: BACKEND,
    origin: ORIGIN,
    token,
    email: '',
    password: '',
    mandat: false,
    quiet: true,
    stamp: STAMP,
    cacheBust: 'test',
    fetchImpl: stub.fetchImpl,
    ...options,
  });

describe('check-job-form-canari — le cycle, sur un fetch injecté', () => {
  it('crée une mission de contrôle, juge la forme de SA fiche, puis la supprime', async () => {
    const stub = makeStub();
    const result = await run(stub);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.deleted).toBe(true);
    expect(result.forme.defauts).toEqual([]);
    expect(result.postDelete).toEqual({ detail: true, noindex: true, card: true, sitemap: true });
    // L'ordre compte : juger une fiche supprimée ne mesurerait rien.
    expect(stub.sequence.indexOf('create')).toBeLessThan(stub.sequence.indexOf('carte'));
    expect(stub.sequence.indexOf('carte')).toBeLessThan(stub.sequence.indexOf('delete'));
    expect(stub.wasDeleted()).toBe(true);
  });

  it('ne supprime JAMAIS une mission qu’il n’a pas créée', async () => {
    const stub = makeStub();
    await run(stub);
    const suppressions = stub.calls.filter((appel) => appel.method === 'DELETE');
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0].url).toBe(`${BACKEND}/api/jobs/${JOB_ID}`);
  });

  it('la suppression a lieu MÊME quand la forme est défectueuse', async () => {
    const stub = makeStub({ forme: { titre: 'Kojo — trouvez un artisan' } });
    const result = await run(stub);

    expect(result.ok).toBe(false);
    expect(result.created).toBe(true);
    expect(result.deleted).toBe(true);
    expect(result.verified).toBe(false);
    expect(stub.calls.some((appel) => appel.method === 'DELETE')).toBe(true);
  });

  it('nomme le défaut de titre dans l’échec du cycle', async () => {
    const stub = makeStub({ forme: { titre: 'Kojo — trouvez un artisan' } });
    const result = await run(stub);
    expect(result.errors.join('\n')).toMatch(/<title> « Kojo — trouvez un artisan » ne NOMME PAS la mission/);
  });

  it('échoue si la fiche d’une mission VIVANTE ne répond pas 200', async () => {
    const stub = makeStub({ detailStatus: 500 });
    const result = await run(stub);
    expect(result.ok).toBe(false);
    expect(result.forme.status).toBe(500);
    expect(result.errors.join('\n')).toMatch(/la fiche d'une mission VIVANTE répond HTTP 500/);
  });

  it('aucune suppression n’est tentée si la création a échoué', async () => {
    const stub = makeStub({ createStatus: 422 });
    const result = await run(stub);

    expect(result.ok).toBe(false);
    expect(result.created).toBe(false);
    expect(stub.calls.map((appel) => appel.method)).not.toContain('DELETE');
    expect(result.errors.join('\n')).toMatch(/création de la mission de contrôle HTTP 422/);
  });

  it('un échec de suppression fait ÉCHOUER la sonde et nomme la mission laissée en base', async () => {
    const stub = makeStub({ deleteStatus: 500 });
    const result = await run(stub);

    expect(result.ok).toBe(false);
    expect(result.deleted).toBe(false);
    expect(result.postDelete).toEqual({ detail: false, noindex: false, card: false, sitemap: false });
    expect(result.errors.join('\n')).toMatch(/SUPPRESSION de la mission de contrôle échouée \(HTTP 500\)/);
    expect(result.errors.join('\n')).toContain(JOB_ID);
    expect(result.errors.join('\n')).toContain(JOB_TITLE);
  });

  it('exige que la mission soit listée dans le sitemap AVANT sa suppression (verrou non vide)', async () => {
    const stub = makeStub({ sitemapBeforeIncludesJob: false });
    const result = await run(stub);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/n'apparaît PAS dans .*sitemap.*juste après sa création/s);
  });

  it('une carte OG en échec fait échouer le jugement (les cartes appartiennent à leur propriétaire)', async () => {
    const stub = makeStub({ imageStatus: 500 });
    const result = await run(stub);

    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.forme.defauts).toEqual([]);
    expect(result.errors.join('\n')).toMatch(/og:image HTTP 500/);
  });

  it('échoue si aucun jeton n’est disponible (nettoyage impossible)', async () => {
    const ancien = process.env.KOJO_LHCI_AUTH_HEADER;
    delete process.env.KOJO_LHCI_AUTH_HEADER;
    try {
      const stub = makeStub();
      const result = await run(stub, { token: '', email: '', password: '' });
      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toMatch(/Aucun jeton disponible/);
      // Sans jeton, seule la sonde de CAPACITÉ a été posée : rien n'a été créé,
      // rien n'a été supprimé.
      expect(stub.calls.map((appel) => appel.method)).toEqual(['GET']);
    } finally {
      if (ancien !== undefined) process.env.KOJO_LHCI_AUTH_HEADER = ancien;
    }
  });
});

describe('check-job-form-canari — le mandat d’écriture', () => {
  it('hors loopback sans mandat, RIEN n’est écrit et la surface est DÉCLARÉE', async () => {
    const stub = makeStub();
    const result = await run(stub, { backend: PROD_BACKEND, base: 'https://kojoforafrica.cc.cd' });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('pas-de-mandat');
    expect(result.skipped === true && stub.calls.some((appel) => appel.method === 'POST')).toBe(false);
    // Déclarée = bruyante : un avertissement qui nomme la surface, son motif, son
    // remède et sa date — jamais un vert muet.
    expect(result.avertissements).toHaveLength(1);
    expect(result.avertissements[0]).toContain(SURFACE_JOB_FORM_CANARI_FORME);
    expect(result.avertissements[0]).toContain(MANDAT_ECRITURE_ENV);
    expect(result.notices.join('\n')).toMatch(/Canari de forme \/jobs\/:id IGNORÉ/);
  });

  it('le mandat explicite autorise le cycle sur un backend non loopback', async () => {
    const stub = makeStub();
    const result = await run(stub, { backend: PROD_BACKEND, mandat: true });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.created).toBe(true);
    expect(result.deleted).toBe(true);
    expect(stub.calls.some((appel) => appel.method === 'POST')).toBe(true);
    expect(stub.calls.some((appel) => appel.method === 'DELETE')).toBe(true);
  });

  it('une base qui ne sert pas la route /jobs/:id est ignorée ET déclarée', async () => {
    const stub = makeStub({ servesJobRoute: false });
    const result = await run(stub);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('route-non-servie');
    expect(result.avertissements).toHaveLength(1);
    expect(result.avertissements[0]).toContain(SURFACE_JOB_FORM_CANARI_FORME);
    // Aucune écriture : créer une mission pour une URL que la base ne sert pas
    // serait une écriture inutile.
    expect(stub.calls.some((appel) => appel.method === 'POST')).toBe(false);
  });

  it('l’écriture est autorisée sur loopback, refusée ailleurs sans mandat, autorisée ailleurs avec', () => {
    expect(ecritureAutorisee({ backend: 'http://127.0.0.1:8000' }).autorisee).toBe(true);
    expect(ecritureAutorisee({ backend: 'http://localhost:8000' }).autorisee).toBe(true);
    // L'adresse NON SPÉCIFIÉE n'est pas une adresse locale (site-meta.js).
    expect(ecritureAutorisee({ backend: 'http://0.0.0.0:8000' }).autorisee).toBe(false);

    const refus = ecritureAutorisee({ backend: PROD_BACKEND });
    expect(refus.autorisee).toBe(false);
    expect(refus.raison).toContain(MANDAT_ECRITURE_ENV);

    const mandat = ecritureAutorisee({ backend: PROD_BACKEND, mandat: true });
    expect(mandat.autorisee).toBe(true);
    expect(mandat.raison).toMatch(/MANDAT D'ÉCRITURE posé/);
  });
});

describe('check-job-form-canari — la règle de forme, cas par cas', () => {
  const conforme = () => ficheHtml();
  const defautsDe = (forme, options = {}) =>
    defautsDeForme({
      html: ficheHtml(forme),
      origin: ORIGIN,
      jobId: JOB_ID,
      missionTitle: JOB_TITLE,
      missionDescription: PAYLOAD.description,
      ...options,
    }).join('\n');

  it('ne trouve RIEN à redire sur une fiche conforme (sans quoi les cas suivants ne prouvent rien)', () => {
    expect(defautsDe({})).toBe('');
  });

  it('refuse un <title> absent', () => {
    expect(defautsDe({ titre: '' })).toMatch(/<title> ABSENT/);
  });

  it('refuse un <title> qui ne nomme pas la mission', () => {
    expect(defautsDe({ titre: 'Kojo — trouvez un artisan' })).toMatch(/ne NOMME PAS la mission/);
  });

  it('refuse une description absente', () => {
    expect(defautsDe({ description: '' })).toMatch(/meta description ABSENTE/);
  });

  it('refuse la description GÉNÉRIQUE du site (la fiche doit dire la mission)', () => {
    expect(defautsDe({ description: 'Kojo met en relation clients et artisans.' })).toMatch(
      /ne dit PAS la mission/
    );
  });

  it('refuse un noindex porté par l’EN-TÊTE d’une fiche vivante', () => {
    expect(defautsDe({}, { robotsTag: 'noindex, nofollow' })).toMatch(/mission VIVANTE en NOINDEX/);
  });

  it('refuse un noindex porté par la BALISE d’une fiche vivante', () => {
    expect(defautsDe({ robots: 'noindex, nofollow' })).toMatch(/mission VIVANTE en NOINDEX/);
  });

  it('refuse une meta robots qui ne déclare pas l’indexation', () => {
    expect(defautsDe({ robots: '' })).toMatch(/ne déclare pas l'indexation/);
  });

  it('refuse un canonical absent', () => {
    expect(defautsDe({ canonical: '' })).toMatch(/canonical ABSENT/);
  });

  it('refuse un canonical RELATIF (un crawler l’ignore)', () => {
    expect(defautsDe({ canonical: `/jobs/${JOB_ID}` })).toMatch(/n'est pas une URL absolue/);
  });

  it('refuse un canonical qui désigne une AUTRE page du même site', () => {
    expect(defautsDe({ canonical: `${ORIGIN}/jobs` })).toMatch(/désigne \/jobs au lieu de cette fiche/);
  });

  it('refuse un canonical hors de l’origine annoncée par le déploiement', () => {
    expect(defautsDe({ canonical: `https://preview.exemple.test/jobs/${JOB_ID}` })).toMatch(
      /hors de l'origine attendue/
    );
  });

  it('refuse un og:url qui désigne ailleurs', () => {
    expect(defautsDe({ ogUrl: `${ORIGIN}/jobs` })).toMatch(/og:url « .* » ne désigne PAS la fiche servie/);
  });

  it('refuse un og:url absent', () => {
    expect(defautsDe({ ogUrl: '' })).toMatch(/og:url ABSENTE/);
  });

  it('refuse un twitter:url qui désigne ailleurs', () => {
    expect(defautsDe({ twitterUrl: `${ORIGIN}/jobs/${PROBE_ID}` })).toMatch(
      /twitter:url « .* » ne désigne PAS la fiche servie/
    );
  });

  it('refuse un og:title en désaccord avec le <title> (deux surfaces, une phrase)', () => {
    expect(defautsDe({ ogTitre: 'Kojo' })).toMatch(/ne disent PAS la même chose/);
  });

  it('refuse un <h1> statique absent (rien à lire sans JavaScript)', () => {
    expect(defautsDe({ h1: '' })).toMatch(/aucun <h1> statique/);
  });

  it('refuse un <h1> qui ne nomme pas la mission', () => {
    expect(defautsDe({ h1: 'Mission' })).toMatch(/<h1> « Mission » ne NOMME PAS la mission/);
  });

  it('nomme l’extrait attendu de la description (150 caractères, comme le rendu)', () => {
    expect(DESCRIPTION_EXCERPT).toBe(150);
    expect(extraitDeDescription('court')).toBe('court');
    const longue = 'x'.repeat(400);
    expect(extraitDeDescription(longue)).toBe(`${'x'.repeat(150)}…`);
    expect(defautsDe({ description: 'x'.repeat(60) })).toMatch(/attendu l'extrait de 150 caractères/);
  });

  it('décode les entités du HTML servi avant de comparer au texte de la mission', () => {
    // L'ordre compte : `&amp;lt;` est le TEXTE « &lt; », pas le caractère « < ».
    expect(decoderEntites('&amp;lt;')).toBe('&lt;');
    expect(decoderEntites('&lt;script&gt;')).toBe('<script>');
    expect(decoderEntites('&quot;Kojo&quot;')).toBe('"Kojo"');
    expect(decoderEntites(`l&#39;artisan &amp; l'ouvrier`)).toBe("l'artisan & l'ouvrier");
  });

  it('juge la fiche servie avec les entités échappées, comme le backend les écrit', () => {
    // Le vrai rendu échappe `&`, `'`, `<` : un titre contenant une apostrophe
    // échappée doit rester conforme (sinon tous les titres réels échoueraient).
    const titre = `${TEST_JOB_TITLE_PREFIX} d'essai`;
    const defauts = defautsDeForme({
      html: ficheHtml({
        titre: `l&#39;artisan &amp; le client — Kojo`,
        ogTitre: `l&#39;artisan &amp; le client — Kojo`,
        h1: `l&#39;artisan &amp; le client — Kojo`,
      }),
      origin: ORIGIN,
      jobId: JOB_ID,
      missionTitle: "l'artisan & le client",
      missionDescription: PAYLOAD.description,
    });
    expect(defauts).toEqual([]);
    expect(titre).toContain(TEST_JOB_TITLE_PREFIX);
  });
});

afterEach(() => {
  delete process.env[MANDAT_ECRITURE_ENV];
});
