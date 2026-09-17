import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';

import {
  MARKER,
  NEGLIGIBLE_BYTES,
  NOTABLE_PERCENT,
  buildPayload,
  extractPayload,
  fetchPriorPayload,
  formatDelta,
  parseArgs,
  postOrUpdateComment,
  readPayload,
  renderMarkdown,
  resolvePrNumber,
  runReport,
} from '../bundle-size-report';

// Tests du rapporteur de taille (scripts/bundle-size-report.js).
//
// Ce script publie un commentaire de PR : ses deux risques propres ne sont pas
// de mal mesurer (la mesure est déléguée à check-bundle-size.js, déjà testé)
// mais (1) d'afficher un ÉCART calculé contre une mauvaise référence — pire
// qu'aucun écart — et (2) d'empiler un commentaire par push au lieu de mettre à
// jour le même. Ces deux cas sont donc couverts explicitement.

const tempDirs = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-report-'));
  tempDirs.push(dir);
  return dir;
};

/** Build minimal : un chunk initial + un gros chunk lazy. */
const makeBuild = ({ initial = 40 * 1024, lazy = 150 * 1024 } = {}) => {
  const root = tempDir();
  const assets = path.join(root, 'build', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, 'index-entry.js'), randomBytes(initial));
  fs.writeFileSync(path.join(assets, 'vendor-lazy.js'), randomBytes(lazy));
  fs.writeFileSync(
    path.join(root, 'build', 'index.html'),
    '<!DOCTYPE html><html><head>' +
      '<link rel="modulepreload" crossorigin href="/assets/index-entry.js">' +
      '<script type="module" crossorigin src="/assets/index-entry.js"></script>' +
      '</head><body><div id="root"></div></body></html>'
  );
  return root;
};

const writeJson = (name, value) => {
  const file = path.join(tempDir(), name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
};

/** Écrit un fichier TEXTE brut (un corps de commentaire n'est pas du JSON). */
const writeText = (name, text) => {
  const file = path.join(tempDir(), name);
  fs.writeFileSync(file, text);
  return file;
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('formatDelta', () => {
  it('signe et qualifie une augmentation modérée', () => {
    const delta = formatDelta(102 * 1024, 100 * 1024); // +2 Ko, +2 %
    expect(delta.bytes).toBe(2 * 1024);
    expect(delta.verdict).toBe('faible');
    expect(delta.text).toBe('+2,0 Ko');
    expect(delta.percentText).toBe('+2,0 %');
  });

  it('une augmentation de 10 % est notable, et le signe est explicite', () => {
    const delta = formatDelta(110 * 1024, 100 * 1024);
    expect(delta.bytes).toBe(10 * 1024);
    expect(delta.verdict).toBe('notable');
    expect(delta.text).toBe('+10,0 Ko');
  });

  it('un écart sous 1 Ko est négligeable, même en pourcentage élevé', () => {
    const delta = formatDelta(1000, 500); // +100 % mais seulement 500 octets
    expect(Math.abs(delta.bytes)).toBeLessThan(NEGLIGIBLE_BYTES);
    expect(delta.verdict).toBe('négligeable');
  });

  it('une augmentation ≥ 5 % est notable', () => {
    expect(formatDelta((100 * 1024) + (NOTABLE_PERCENT / 100) * 100 * 1024, 100 * 1024).verdict).toBe('notable');
  });

  it('une diminution est un gain (jamais signalée comme régression)', () => {
    const delta = formatDelta(80 * 1024, 100 * 1024);
    expect(delta.verdict).toBe('gain');
    expect(delta.bytes).toBeLessThan(0);
  });

  it('sans référence, retourne null (aucun écart inventé)', () => {
    expect(formatDelta(1234, undefined)).toBeNull();
    expect(formatDelta(1234, null)).toBeNull();
  });

  it('une référence nulle ne produit pas de division par zéro', () => {
    const delta = formatDelta(1024, 0);
    expect(delta.percent).toBeNull();
    expect(delta.percentText).toBe('—');
  });
});

describe('renderMarkdown', () => {
  const current = buildPayload(
    {
      initialGzip: 100 * 1024,
      largest: { file: 'vendor-lazy.js', gzip: 150 * 1024, raw: 400 * 1024 },
      totalRaw: 3 * 1024 * 1024,
      initialChunks: [{ file: 'index-entry.js', gzip: 40 * 1024, raw: 100 * 1024 }],
    },
    { ref: 'fix/x', sha: 'abcdef1234567890' }
  );

  it('porte le marqueur d\'unicité et la charge utile relisible', () => {
    const body = renderMarkdown({ current });
    expect(body).toContain(MARKER);
    expect(extractPayload(body)).toEqual(current);
  });

  it('avec référence : affiche les valeurs de référence et les écarts', () => {
    const baseline = { ...current, initialGzip: 90 * 1024, totalRaw: 2 * 1024 * 1024, ref: 'main', sha: '3673bac0000' };
    const body = renderMarkdown({ current, baseline });
    expect(body).toContain('Référence : **');
    expect(body).toContain('main');
    expect(body).toContain('90,0 Ko');
    expect(body).toContain('+10,0 Ko');
  });

  it('sans référence : dit POURQUOI et n\'affiche aucun écart', () => {
    const body = renderMarkdown({ current, baseline: null, baselineReason: 'aucune mesure de `main` en cache' });
    expect(body).toContain('Référence indisponible');
    expect(body).toContain('aucune mesure de `main` en cache');
    expect(body).toContain('première mesure');
    // Aucun signe d'écart ne doit apparaître dans le tableau.
    const table = body.split('\n').filter((l) => l.startsWith('| **'));
    expect(table.length).toBe(3);
    for (const row of table) expect(row).not.toMatch(/[+−] ?\d/);
  });

  it('ajoute la colonne « précédente » seulement quand la mesure existe', () => {
    const withoutPrev = renderMarkdown({ current });
    expect(withoutPrev).not.toContain('Écart vs précédente');

    const body = renderMarkdown({ current, previous: { ...current, initialGzip: 95 * 1024 } });
    expect(body).toContain('Écart vs précédente');
    expect(body).toContain('Mesure précédente de cette PR');
  });

  it('signale une mesure précédente illisible au lieu de la taire', () => {
    const body = renderMarkdown({ current, previousError: 'liste des commentaires HTTP 403' });
    expect(body).toContain('non relue');
    expect(body).toContain('HTTP 403');
    expect(body).not.toContain('Écart vs précédente');
  });

  it('rappelle les budgets et le détail du chemin critique', () => {
    const body = renderMarkdown({ current });
    expect(body).toContain('Budgets');
    expect(body).toContain('index-entry.js');
    expect(body).toContain('<details>');
  });
});

describe('extractPayload / readPayload', () => {
  it('extrait la charge utile d\'un commentaire complet', () => {
    const payload = { version: 1, initialGzip: 42, sha: 'abc' };
    const body = `${MARKER}\n### titre\n\n<!-- bundle-size-payload ${JSON.stringify(payload)} -->\n`;
    expect(extractPayload(body)).toEqual(payload);
  });

  it('retourne null sur un corps sans charge utile ou illisible', () => {
    expect(extractPayload('')).toBeNull();
    expect(extractPayload('texte sans marqueur')).toBeNull();
    expect(extractPayload('<!-- bundle-size-payload {pas du json} -->')).toBeNull();
  });

  it('lit un fichier JSON, un fichier de commentaire, un objet', () => {
    const payload = { version: 1, initialGzip: 7 };
    expect(readPayload(writeJson('a.json', payload))).toEqual(payload);
    expect(
      readPayload(writeText('b.md', `${MARKER}\n<!-- bundle-size-payload ${JSON.stringify(payload)} -->`))
    ).toEqual(payload);
    expect(readPayload(payload)).toEqual(payload);
    expect(readPayload(path.join(tempDir(), 'absent.json'))).toBeNull();
    expect(readPayload(null)).toBeNull();
  });
});

describe('postOrUpdateComment', () => {
  const okJson = (value) => ({ ok: true, status: 200, json: async () => value });
  const notOk = (status) => ({ ok: false, status, json: async () => ({}) });

  it('crée le commentaire quand aucun marqueur n\'existe', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if (calls.length === 1) return okJson([]);
      return okJson({ id: 99 });
    };
    const result = await postOrUpdateComment({ body: `${MARKER} hello`, repo: 'o/r', issueNumber: 3, token: 't', fetchImpl });
    expect(result).toEqual({ action: 'créé', id: 99 });
    expect(calls[0].method).toBe('GET');
    expect(calls[1].url).toContain('/repos/o/r/issues/3/comments');
    expect(calls[1].method).toBe('POST');
  });

  it('met à jour le commentaire existant au lieu d\'en empiler un second', async () => {
    const calls = [];
    const existing = { id: 42, body: `${MARKER} ancienne version` };
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if (calls.length === 1) return okJson([{ id: 1, body: 'bruit' }, existing]);
      return okJson(existing);
    };
    const result = await postOrUpdateComment({ body: `${MARKER} nouvelle version`, repo: 'o/r', issueNumber: 3, token: 't', fetchImpl });
    expect(result).toEqual({ action: 'mis à jour', id: 42 });
    expect(calls[1].method).toBe('PATCH');
    expect(calls[1].url).toContain('/repos/o/r/issues/comments/42');
    expect(calls.length).toBe(2);
  });

  it('ne touche à rien si le corps est identique', async () => {
    const body = `${MARKER} identique`;
    let writes = 0;
    const fetchImpl = async (url, init = {}) => {
      if ((init.method || 'GET') !== 'GET') writes += 1;
      return okJson([{ id: 42, body }]);
    };
    const result = await postOrUpdateComment({ body, repo: 'o/r', issueNumber: 3, token: 't', fetchImpl });
    expect(result).toEqual({ action: 'inchangé', id: 42 });
    expect(writes).toBe(0);
  });

  it('échoue explicitement si l\'API refuse la liste', async () => {
    const fetchImpl = async () => notOk(403);
    await expect(
      postOrUpdateComment({ body: 'x', repo: 'o/r', issueNumber: 3, token: 't', fetchImpl })
    ).rejects.toThrow(/HTTP 403/);
  });

  it('en dry-run, calcule l\'action sans rien écrire', async () => {
    let writes = 0;
    const fetchImpl = async (url, init = {}) => {
      if ((init.method || 'GET') !== 'GET') writes += 1;
      return okJson([]);
    };
    const result = await postOrUpdateComment({ body: 'x', repo: 'o/r', issueNumber: 3, token: 't', fetchImpl, dryRun: true });
    expect(result.action).toBe('aurait été créé');
    expect(writes).toBe(0);
  });
});

describe('fetchPriorPayload', () => {
  const okJson = (value) => ({ ok: true, status: 200, json: async () => value });

  it('relit la charge utile du commentaire marqué', async () => {
    const payload = { version: 1, initialGzip: 12 };
    const fetchImpl = async () =>
      okJson([{ id: 1, body: 'sans marqueur' }, { id: 2, body: `${MARKER}\n<!-- bundle-size-payload ${JSON.stringify(payload)} -->` }]);
    expect(await fetchPriorPayload({ repo: 'o/r', issueNumber: 1, token: 't', fetchImpl })).toEqual({ payload, error: '' });
  });

  it('accepte l\'absence de commentaire précédent (premier push de la PR)', async () => {
    const fetchImpl = async () => okJson([]);
    expect(await fetchPriorPayload({ repo: 'o/r', issueNumber: 1, token: 't', fetchImpl })).toEqual({ payload: null, error: '' });
  });

  it('remonte l\'échec d\'API au lieu de l\'avaler', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const result = await fetchPriorPayload({ repo: 'o/r', issueNumber: 1, token: 't', fetchImpl });
    expect(result.payload).toBeNull();
    expect(result.error).toMatch(/HTTP 403/);
  });

  it('signale un commentaire trouvé mais illisible', async () => {
    const fetchImpl = async () => okJson([{ id: 2, body: `${MARKER}\n<!-- bundle-size-payload {cassé} -->` }]);
    const result = await fetchPriorPayload({ repo: 'o/r', issueNumber: 1, token: 't', fetchImpl });
    expect(result.payload).toBeNull();
    expect(result.error).toMatch(/illisible/);
  });
});

describe('runReport', () => {
  const emptyList = { ok: true, status: 200, json: async () => [] };

  it('écrit mesures, commentaire et résumé, et publie sur une PR', async () => {
    const root = makeBuild();
    const dir = tempDir();
    const out = path.join(dir, 'nested', 'current.json');
    const markdown = path.join(dir, 'comment.md');
    const summary = path.join(dir, 'summary.md');
    const baseline = writeJson('baseline.json', { version: 1, initialGzip: 30 * 1024, ref: 'main', sha: '3673bac0000' });

    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      const method = init.method || 'GET';
      calls.push({ url, method });
      // Tous les GET (commentaire précédent, puis liste avant publication)
      // renvoient une liste vide ; seul le POST final crée le commentaire.
      return method === 'GET' ? emptyList : { ok: true, status: 201, json: async () => ({ id: 7 }) };
    };

    const result = await runReport({
      root,
      args: { out, markdown, summary, baseline, post: true },
      env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', PR_NUMBER: '12' },
      fetchImpl,
      quiet: true,
    });

    expect(result.ok).toBe(true);
    expect(result.posted).toEqual({ action: 'créé', id: 7 });
    expect(fs.existsSync(out)).toBe(true);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).initialGzip).toBeGreaterThan(0);
    expect(fs.readFileSync(summary, 'utf8')).toContain(MARKER);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).ref).toBe('');
    // 2 GET (commentaire précédent + liste pour publication) puis 1 POST.
    expect(calls.filter((c) => c.method === 'POST').length).toBe(1);
  });

  it('sans référence : n\'invente aucun écart', async () => {
    const root = makeBuild();
    const markdown = path.join(tempDir(), 'comment.md');
    const result = await runReport({
      root,
      args: { markdown, baseline: path.join(tempDir(), 'inexistant.json') },
      env: {},
      quiet: true,
    });
    expect(result.markdown).toContain('Référence indisponible');
    expect(result.markdown).toContain('aucune mesure de `main` en cache');
  });

  it('sans build : échoue au lieu de rapporter des zéros', async () => {
    const root = tempDir();
    const result = await runReport({ root, args: {}, env: {}, quiet: true });
    expect(result.ok).toBe(false);
    expect(result.payload).toBeNull();
    expect(result.errors.join(' ')).toMatch(/index\.html introuvable/);
  });

  it('sur main (pas de PR) : ne publie rien et ne s\'en plaint pas', async () => {
    const root = makeBuild();
    const result = await runReport({
      root,
      args: { post: true, markdown: path.join(tempDir(), 'c.md') },
      env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' },
      quiet: true,
    });
    expect(result.ok).toBe(true);
    expect(result.posted).toBeNull();
  });

  it('sans jeton : remonte l\'échec au lieu de simuler une publication', async () => {
    const root = makeBuild();
    const result = await runReport({
      root,
      args: { post: true, markdown: path.join(tempDir(), 'c.md') },
      env: { GITHUB_REPOSITORY: 'o/r', PR_NUMBER: '12' },
      quiet: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/GITHUB_TOKEN/);
  });
});

describe('resolvePrNumber / parseArgs', () => {
  it('lit PR_NUMBER, puis l\'événement GitHub', () => {
    expect(resolvePrNumber({ PR_NUMBER: '12' })).toBe(12);
    const event = writeJson('event.json', { pull_request: { number: 34 } });
    expect(resolvePrNumber({ GITHUB_EVENT_PATH: event })).toBe(34);
    expect(resolvePrNumber({})).toBeNull();
    expect(resolvePrNumber({ GITHUB_EVENT_PATH: path.join(tempDir(), 'absent.json') })).toBeNull();
  });

  it('parse les arguments du CLI', () => {
    const args = parseArgs(['--out', 'a.json', '--baseline', 'b.json', '--post', '--dry-run']);
    expect(args).toEqual({
      out: 'a.json',
      baseline: 'b.json',
      previous: '',
      markdown: '',
      summary: '',
      post: true,
      dryRun: true,
    });
  });
});
