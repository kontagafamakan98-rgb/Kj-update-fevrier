import { test, expect } from '@playwright/test';
import { createRewriteServer } from '../scripts/vercel-rewrite-server.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
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
let apiFront;
let apiOrigin;

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

  // ── LE MODÈLE CROSS-SITE : la page et l'API sur DEUX hôtes ────────────────
  // En production, le frontend est sur kojoforafrica.cc.cd et l'API sur
  // api.kojoforafrica.cc.cd : le cookie de session est alors rangé sur l'hôte de
  // l'API, INVISIBLE depuis la page. C'est la topologie où la restauration au
  // rechargement a réellement régressé (mesuré en production le 12/10/2026 :
  // session vivante, page renvoyée vers /login), et la pile locale ne la rejouait
  // pas — le proxy /api y rend tout même-origine.
  //
  // Le front est en TLS, et ce n'est pas un détail : Chromium ne rend un cookie
  // Secure à `context.cookies(url)` que pour une URL https (mesuré sur ce même
  // contexte : 0 cookie pour l'URL http de l'API, 2 pour son URL https). Juger
  // la topologie de production avec une origine API en clair ferait donc refuser
  // la sonde pour une raison d'outillage, pas de code.
  const apiKey = path.join(tlsDirectory, 'api-key.pem');
  const apiCert = path.join(tlsDirectory, 'api-cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-keyout', apiKey, '-out', apiCert,
  ], { stdio: 'pipe' });
  apiFront = createHttpsServer(
    { key: readFileSync(apiKey), cert: readFileSync(apiCert) },
    (requete, reponse) => {
      const amont = httpRequest(
        {
          host: '127.0.0.1',
          port: 8123,
          method: requete.method,
          path: requete.url,
          // L'hôte d'amont est réécrit, l'Origin est CONSERVÉ : la fixture doit
          // continuer de répondre à l'origine de la page (CORS avec credentials).
          headers: { ...requete.headers, host: '127.0.0.1:8123' },
        },
        (reponseAmont) => {
          reponse.writeHead(reponseAmont.statusCode, reponseAmont.headers);
          reponseAmont.pipe(reponse);
        }
      );
      amont.on('error', () => {
        reponse.writeHead(502);
        reponse.end();
      });
      requete.pipe(amont);
    }
  );
  await new Promise((resolve, reject) => {
    apiFront.once('error', reject);
    apiFront.listen(0, '127.0.0.1', resolve);
  });
  apiOrigin = `https://127.0.0.1:${apiFront.address().port}`;
});

test.afterAll(async () => {
  for (const instance of [server, tlsServer, apiFront]) {
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

test('session web : cookies sur le proxy et restauration au rechargement', async ({ page, context }) => {
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

  // La trace d'amorçage reste EN PLACE : c'est elle, et seulement elle, qui
  // autorise la sonde /auth/me au rechargement (le cookie de session, httpOnly
  // et rangé ici sur l'hôte de la page, ne sert qu'à AUTHENTIFIER cette sonde).
  const restored = page.waitForResponse(`${origin}/api/auth/me`);
  await page.reload();
  expect((await restored).status()).toBe(200);
  await expect(page).toHaveURL(`${origin}/dashboard`);
  await expect(page.locator('.cadre-page').first()).toBeVisible();
  // Et le rechargement n'écrit aucun jeton : la session restaurée reste
  // portée par le seul cookie.
  expect(await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]
    .filter((key) => /token|jwt/i.test(key)))).toEqual([]);
  expect(apiRequests.length).toBeGreaterThan(0);
  expect(apiRequests.every((request) => new URL(request.url()).origin === origin)).toBe(true);
  expect(apiRequests.every((request) => !request.headers().authorization)).toBe(true);
});

// ─── LE CROSS-SITE LOCAL : la vérification de rechargement, sur le modèle de ──
// ─── la production, rejouée à chaque PR ─────────────────────────────────────

/**
 * LE MODÈLE CROSS-SITE, rejoué par la SONDE LIVRÉE (même coureur, mêmes refus) :
 * la page reste sur 127.0.0.2, l'API est jugée sur un AUTRE hôte (le front TLS de
 * la fixture). Deux réglages, dont aucun n'est une tolérance :
 *
 *   • `window.__KOJO_API_URL__` (le levier d'exécution de src/utils/backendUrl.js)
 *     fait interroger à la page l'origine https de l'API. Sans lui, le bundle
 *     appellerait l'URL de build (`http://127.0.0.1:8123/api`), le cookie Secure
 *     serait posé sous un schéma que la sonde ne peut pas lire, et le verdict
 *     porterait sur l'outillage ;
 *   • la réponse de connexion de la fixture est réécrite avec le CONTRAT de
 *     production (SameSite=None ; Secure). Avec les attributs de développement
 *     (SameSite=Lax, sans Secure), Chromium ne renvoie pas le cookie en
 *     cross-site : le rouge accuserait la fixture, pas le code.
 *
 * `tuerLaSessionAuRechargement` sert la CONTRE-ÉPREUVE : il efface les cookies
 * juste AVANT le rechargement, c'est-à-dire à l'instant exact que la sonde juge.
 *
 * CE QUI EST CONTOURNÉ, ET POURQUOI (plutôt que tu) : la CSP que le build local
 * sert (`connect-src 'self' http://127.0.0.1:8123 …`, vite-plugins/
 * inject-production-csp.js) n'autorise pas une origine API fabriquée par le test —
 * la page ne peut donc pas atteindre le front TLS, et la sonde lirait HTTP 0.
 * Ce passage juge la SESSION AU RECHARGEMENT, pas la CSP : celle-ci a ses propres
 * gardes (check-prerender-shells.js, check-cors-preflight.js) et se dérive du
 * même VITE_API_URL que la CSP de production, qui autorise donc toujours la
 * vraie origine API. `bypassCSP` est donc posé ICI, pour ce modèle-là seulement.
 */
const lancerCrossSite = (browser, { tuerLaSessionAuRechargement = false } = {}) => async () => {
  const contextes = [];
  return {
    newContext: async () => {
      const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true });
      contextes.push(context);
      await context.addInitScript((origine) => {
        window.__KOJO_API_URL__ = `${origine}/api`;
      }, apiOrigin);
      await context.route('**/api/auth/login', async (route) => {
        const response = await route.fetch();
        const cookies = (await response.headersArray())
          .filter(({ name }) => name.toLowerCase() === 'set-cookie')
          .map(({ value }) => value.replace('SameSite=Lax', 'SameSite=None; Secure'));
        await route.fulfill({
          response,
          headers: { ...response.headers(), 'set-cookie': cookies.join('\n') },
        });
      });
      if (tuerLaSessionAuRechargement) {
        const ouvrirPage = context.newPage.bind(context);
        context.newPage = async (...arguments_) => {
          const page = await ouvrirPage(...arguments_);
          const recharger = page.reload.bind(page);
          page.reload = async (...argumentsRechargement) => {
            await context.clearCookies();
            return recharger(...argumentsRechargement);
          };
          return page;
        };
      }
      return context;
    },
    close: async () => {
      await Promise.all(contextes.map((context) => context.close()));
    },
  };
};

const sonderCrossSiteLocal = (browser, options = {}) =>
  runSessionReloadProbe({
    base: origin,
    api: apiOrigin,
    directApi: true,
    email: 'client@example.com',
    password: 'password',
    attempts: 1,
    quiet: true,
    launch: lancerCrossSite(browser, options),
  });

test('cross-site (pile locale) : la session survit au rechargement dans la topologie de la production', async ({ browser }) => {
  const result = await sonderCrossSiteLocal(browser);

  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
  // Le fait jugé : le justificatif vit sur l'hôte de l'API (invisible depuis la
  // page) et il survit au rechargement, que l'application restaure ensuite.
  expect(result.verdicts.anonymous).toBe(401);
  expect(result.verdicts.beforeReload).toBe(200);
  expect(result.verdicts.afterReload.cookie).toBe(200);
  expect(result.verdicts.afterReload.app).toBe(200);
  expect(result.verdicts.afterReload.url).toContain('/dashboard');
  expect(result.verdicts.sessionCookies.afterLogin).toEqual({
    httpOnly: true, secure: true, sameSite: 'None',
  });
  expect(result.verdicts.sessionCookies.afterReload).toEqual(result.verdicts.sessionCookies.afterLogin);
  // Et la session n'est PAS portée par un jeton relu en stockage : c'est le web.
  // La moitié native de la sonde d'exposition exige l'inverse — le même marqueur
  // (isNativeShell) décide des deux, donc ce fait se lit ici aussi.
  expect(result.verdicts.persisted.jetonEnStockage).toBe(false);
  expect(result.checked.join('\n')).toContain('cross-site demandé');
});

test('cross-site (pile locale) : la session restaurée ÉCRIT sans cookie CSRF lisible', async ({ browser }) => {
  // Le fait jugé : après un rechargement, dans la topologie de la production
  // (page sur un hôte, API sur un autre), une écriture de l'application aboutit
  // SANS que `document.cookie` de l'origine frontend montre un `kojo_csrf`.
  //
  // Pourquoi ce parcours existe : la lisibilité du cookie CSRF dépend de l'hôte
  // qui l'a posé. En cross-site elle n'existe pas, et la mémoire JavaScript du
  // document a disparu au rechargement. La seule façon dont l'application peut
  // alors présenter un double-submit correct est de GARDER ce que le SERVEUR lui
  // a ré-échoé (`X-Kojo-CSRFToken`, en-tête exposé en CORS) : l'écriture ne dépend
  // donc ni d'un cookie lisible, ni d'un jeton rangé en stockage.
  //
  // Ce qui rend le 200 concluant : la fixture applique le double-submit comme le
  // backend (une écriture authentifiée par cookie sans en-tête correct est
  // refusée en 403). Un 200 prouve donc que le jeton envoyé était LE BON, et pas
  // seulement présent.
  //
  // Ce qu'il ne juge pas, écrit plutôt que tu : l'écriture choisie est la
  // déconnexion — le POST le plus simple que l'application émet elle-même, sans
  // dépendre d'un écran ni d'une donnée. Les autres mutations passent par le même
  // `request()` de src/services/api.js. Et comme les autres parcours cross-site de
  // ce fichier, la CSP du build local est contournée (`bypassCSP`) pour atteindre
  // l'origine API du modèle.
  const fabrique = await lancerCrossSite(browser)();
  const context = await fabrique.newContext();
  try {
    const page = await context.newPage();
    const ecritures = [];
    page.on('request', (requete) => {
      const chemin = new URL(requete.url()).pathname;
      if (requete.method() === 'POST' && chemin === '/api/auth/logout') ecritures.push(requete);
    });

    await page.goto(`${origin}/login`);
    await page.locator('#email').fill('client@example.com');
    await page.locator('#password').fill('password');
    const connexion = page.waitForResponse((reponse) => reponse.url().includes('/api/auth/login'));
    await page.locator('button[type="submit"]').click();
    expect((await connexion).status()).toBe(200);
    await expect(page).toHaveURL(`${origin}/dashboard`);

    // Le rechargement vide la mémoire du document ; les deux cookies sont rangés
    // sur l'hôte de l'API, donc invisibles d'ici.
    const restauration = page.waitForResponse((reponse) => reponse.url().includes('/api/auth/me'));
    await page.reload();
    expect((await restauration).status()).toBe(200);
    const lisible = await page.evaluate(() => document.cookie);
    expect(lisible).not.toContain('kojo_csrf');
    expect(lisible).not.toContain('kojo_session');

    const deconnexion = page.waitForResponse((reponse) => reponse.url().includes('/api/auth/logout'));
    await page.getByRole('button', { name: /déconnexion|logout|déconnecter/i }).first().click();
    const reponse = await deconnexion;

    expect(reponse.status()).toBe(200);
    expect(ecritures).toHaveLength(1);
    // L'écriture est bien partie vers l'AUTRE hôte, avec un double-submit non
    // vide, alors qu'aucun cookie CSRF n'était lisible depuis la page.
    expect(new URL(ecritures[0].url()).origin).toBe(apiOrigin);
    expect(String(ecritures[0].headers()['x-csrftoken'] || '')).not.toBe('');
    // Et rien n'a été rangé en stockage pour y arriver : la session reste portée
    // par le cookie httpOnly, le CSRF par la mémoire du document.
    expect(
      await page.evaluate(() =>
        [...Object.keys(localStorage), ...Object.keys(sessionStorage)]
          .filter((cle) => /token|jwt/i.test(cle))
      )
    ).toEqual([]);
  } finally {
    await fabrique.close();
  }
});

test('cross-site (pile locale) : la sonde REFUSE quand la session meurt au rechargement', async ({ browser }) => {
  // Contre-épreuve du vert ci-dessus : sans elle, un rejeu incapable de rougir
  // passerait pour une preuve. La session est tuée à l'instant exact que la sonde
  // juge — c'est la classe de régression que le trajet par PR doit attraper avant
  // la fusion.
  const result = await sonderCrossSiteLocal(browser, { tuerLaSessionAuRechargement: true });

  expect(result.ok).toBe(false);
  expect(result.verdicts.beforeReload).toBe(200);
  expect(result.verdicts.afterReload.cookie).toBe(401);
  expect(result.errors.join('\n')).toContain(
    "le justificatif de session n'a pas survécu au rechargement"
  );
});
