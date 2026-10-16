import { test, expect } from '@playwright/test';
import { createRewriteServer } from '../scripts/vercel-rewrite-server.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSessionReloadProbe } from '../scripts/check-session-reload-production.js';

let server;
let origin;
let tlsServer;
let tlsOrigin;
let tlsDirectory;

test.beforeAll(async () => {
  // Table Vercel réelle, backend de fixture local : aucun appel à la production.
  server = createRewriteServer({
    root: fileURLToPath(new URL('../build/', import.meta.url)),
    config: JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')),
    backendUrl: 'http://127.0.0.1:8123',
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.2', resolve);
  });
  // Un hôte web servi, distinct du localhost de développement : le bundle de
  // production choisit le proxy sans drapeau ni override injecté par le test.
  origin = `http://127.0.0.2:${server.address().port}`;

  // Certificat éphémère de TEST, jamais installé dans le magasin système.
  tlsDirectory = mkdtempSync(path.join(tmpdir(), 'kojo-cookie-tls-'));
  const key = path.join(tlsDirectory, 'key.pem');
  const cert = path.join(tlsDirectory, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.2', '-keyout', key, '-out', cert,
  ], { stdio: 'pipe' });
  tlsServer = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) },
    server.listeners('request')[0]);
  await new Promise((resolve, reject) => {
    tlsServer.once('error', reject);
    tlsServer.listen(0, '127.0.0.2', resolve);
  });
  tlsOrigin = `https://127.0.0.2:${tlsServer.address().port}`;
});

test.afterAll(async () => {
  for (const instance of [server, tlsServer]) {
    if (instance) await new Promise((resolve, reject) => {
      instance.close((error) => error ? reject(error) : resolve());
      instance.closeAllConnections();
    });
  }
  if (tlsDirectory) rmSync(tlsDirectory, { recursive: true, force: true });
});

test('la sonde accepte les attributs de production reçus et persistés par Chromium', async ({ browser }) => {
  const contexts = [];
  const result = await runSessionReloadProbe({
    base: tlsOrigin, email: 'client@example.com', password: 'password',
    attempts: 1, quiet: true,
    launch: async () => ({
      newContext: async () => {
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        contexts.push(context);
        // Réponse de fixture HTTPS avec les attributs de production. Chromium
        // traite le Set-Cookie : aucune injection par addCookies ni doublure de
        // context.cookies. L'exception TLS concerne uniquement ce certificat de test.
        await context.route('**/api/auth/login', async (route) => {
          const response = await route.fetch();
          const cookies = (await response.headersArray())
            .filter(({ name }) => name.toLowerCase() === 'set-cookie')
            .map(({ value }) => value.replace('SameSite=Lax', 'SameSite=None; Secure'));
          await route.fulfill({ response, headers: {
            ...response.headers(), 'set-cookie': cookies.join('\n'),
          } });
        });
        return context;
      },
      close: async () => { await Promise.all(contexts.map((context) => context.close())); },
    }),
  });
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
  expect(result.verdicts.sessionCookies.afterLogin).toEqual({
    httpOnly: true, secure: true, sameSite: 'None',
  });
  expect(result.verdicts.sessionCookies.afterReload).toEqual(result.verdicts.sessionCookies.afterLogin);
});

test('la sonde refuse les attributs de développement réellement reçus par Chromium', async ({ browser }) => {
  const contexts = [];
  const result = await runSessionReloadProbe({
    base: origin,
    email: 'client@example.com',
    password: 'password',
    attempts: 1,
    quiet: true,
    launch: async () => ({
      newContext: async () => {
        const context = await browser.newContext();
        contexts.push(context);
        return context;
      },
      close: async () => { await Promise.all(contexts.map((context) => context.close())); },
    }),
  });
  expect(result.verdicts.beforeReload).toBe(200);
  expect(result.verdicts.afterReload.cookie).toBe(200);
  expect(result.verdicts.sessionCookies.afterLogin).toEqual({
    httpOnly: true, secure: false, sameSite: 'Lax',
  });
  expect(result.errors.join('\n')).toContain('Secure=false (true attendu)');
  expect(result.errors.join('\n')).toContain('SameSite=Lax (None attendu)');
  expect(result.ok).toBe(false);
});

test('session web : cookies sur le proxy et restauration sans profil en cache', async ({ page, context }) => {
  const apiRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request);
  });

  await page.goto(`${origin}/login`);
  await page.locator('#email').fill('client@example.com');
  await page.locator('#password').fill('password');
  const loginResponse = page.waitForResponse(`${origin}/api/auth/login`);
  await page.locator('button[type="submit"]').click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(`${origin}/dashboard`);

  const cookies = await context.cookies(origin);
  expect(cookies.find((cookie) => cookie.name === 'kojo_session')).toMatchObject({
    httpOnly: true, domain: '127.0.0.2',
  });
  expect(cookies.find((cookie) => cookie.name === 'kojo_csrf')).toMatchObject({
    httpOnly: false, domain: '127.0.0.2',
  });
  const persistence = await page.evaluate(() => ({
    cookie: document.cookie,
    tokens: [...Object.keys(localStorage), ...Object.keys(sessionStorage)]
      .filter((key) => /token|jwt|auth/i.test(key)),
  }));
  expect(persistence.cookie).toContain('kojo_csrf=');
  expect(persistence.cookie).not.toContain('kojo_session=');
  expect(persistence.tokens).toEqual([]);

  // Le cookie suffit : ne pas laisser hasSessionArtifact masquer un proxy cassé.
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  const restored = page.waitForResponse(`${origin}/api/auth/me`);
  await page.reload();
  expect((await restored).status()).toBe(200);
  await expect(page).toHaveURL(`${origin}/dashboard`);
  await expect(page.locator('.cadre-page').first()).toBeVisible();
  expect(apiRequests.length).toBeGreaterThan(0);
  expect(apiRequests.every((request) => new URL(request.url()).origin === origin)).toBe(true);
  expect(apiRequests.every((request) => !request.headers().authorization)).toBe(true);
});
