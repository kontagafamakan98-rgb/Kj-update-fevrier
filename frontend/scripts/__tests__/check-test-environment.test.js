import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { checkTestEnvironment, previewUrlsFromArgs } from '../check-test-environment.js';

describe('check-test-environment', () => {
  it('détecte réellement un serveur local resté ouvert', async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const issues = await checkTestEnvironment({
        ports: [{ port, owner: 'fixture de test' }],
        previewUrls: [],
      });
      expect(issues).toEqual([`serveur de test encore ouvert sur le port ${port} (fixture de test)`]);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('refuse une Preview qui vient réellement de fermer', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

    const url = `http://127.0.0.1:${port}/`;
    const issues = await checkTestEnvironment({ ports: [], previewUrls: [url] });
    expect(issues).toEqual([`onglet Preview sans serveur joignable : ${url}`]);
  });

  it('considère une réponse HTTP réelle, même 404, comme un serveur vivant', async () => {
    const server = createServer((_req, res) => { res.statusCode = 404; res.end('not found'); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const issues = await checkTestEnvironment({
        ports: [],
        previewUrls: [`http://127.0.0.1:${port}/unknown`],
      });
      expect(issues).toEqual([]);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('exige une déclaration explicite des onglets de Preview', async () => {
    expect(previewUrlsFromArgs(['--no-preview-tabs'])).toEqual([]);
    expect(previewUrlsFromArgs(['--preview-url', 'http://127.0.0.1:4174/'])).toEqual([
      'http://127.0.0.1:4174/',
    ]);
    expect(() => previewUrlsFromArgs([])).toThrow('--preview-url URL');
    expect(await checkTestEnvironment({ ports: [], previewUrls: ['ftp://invalid'] })).toEqual([
      'URL de Preview invalide : ftp://invalid',
    ]);
  });
});
