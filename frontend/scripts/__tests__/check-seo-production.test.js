/**
 * Tests de la sonde SEO de production (scripts/check-seo-production.js).
 *
 * Ce qui est vérifié, et rien de plus : l'ANALYSE lit ce que le HTML servi
 * contient réellement (un analyseur qui répondrait toujours « présent » serait
 * pire que pas de sonde), et la sonde SE TAIT quand elle ne peut rien conclure
 * (base locale, accueil injoignable) au lieu de crier « ABSENT ».
 *
 * Aucune requête réseau : `fetch` est injecté ; le seul appel en sous-processus
 * vise une base loopback.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INTEGRATIONS, analyzeSeoServedHtml, runSeoProductionReport } from '../check-seo-production.js';
import { SITE_ORIGIN } from '../site-meta.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(FRONTEND_DIR, 'scripts', 'check-seo-production.js');

// HTML « configuré » : ce que le plugin injecte quand les variables sont posées.
const CONFIGURED_HTML = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://www.googletagmanager.com https://plausible.io">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>
<meta content="jeton-gsc-abc123" name="google-site-verification">
<script type="application/ld+json">{"@type":"LocalBusiness","sameAs":["https://www.facebook.com/kojo","http://insecure.test"]}</script>
</head><body><div id="root"></div></body></html>`;

// HTML « non configuré » : l'état de la production tant que Vercel n'a rien.
const UNCONFIGURED_HTML = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">
<script type="application/ld+json">{"@type":"LocalBusiness","sameAs":[]}</script>
</head><body><div id="root"></div></body></html>`;

// Double fidèle d'une `Response` : `ok` fait partie du contrat, la sonde s'y fie
// (`response.ok`), et un double qui l'omet testerait autre chose que la réalité.
const stubFetch = (htmlByPath = {}, { fail = false } = {}) =>
  async (url) => {
    if (fail) throw new Error('ECONNREFUSED');
    const html = htmlByPath[new URL(url).pathname];
    const status = html === undefined ? 404 : 200;
    return { ok: status < 300, status, text: async () => html ?? '' };
  };

describe('analyse du HTML servi', () => {
  it('lit la balise GA4, la meta Search Console, le sameAs https et Plausible', () => {
    const analysis = analyzeSeoServedHtml(CONFIGURED_HTML);
    expect(analysis.ga4).toEqual({ present: true, value: 'G-ABC1234567' });
    expect(analysis.gsc).toEqual({ present: true, value: 'jeton-gsc-abc123' });
    expect(analysis.plausible.present).toBe(true);
    // Le http:// du sameAs est écarté : un lien mixte n'a rien à y faire.
    expect(analysis.social).toEqual({
      present: true,
      value: 'https://www.facebook.com/kojo',
      count: 1,
    });
  });

  it('ne voit rien dans le HTML non configuré', () => {
    const analysis = analyzeSeoServedHtml(UNCONFIGURED_HTML);
    expect(analysis.ga4.present).toBe(false);
    expect(analysis.gsc.present).toBe(false);
    expect(analysis.plausible.present).toBe(false);
    expect(analysis.social.present).toBe(false);
  });

  it('ne confond pas le domaine GA de la CSP avec la balise GA4', () => {
    // La CSP relâchée mentionne googletagmanager.com : sans `gtag/js?id=`, ce
    // n'est PAS la balise, et un audit d'analytics ne la verrait pas.
    const cspOnly = CONFIGURED_HTML.replace(/<script async src="[^"]+"><\/script>/, '');
    expect(analyzeSeoServedHtml(cspOnly).ga4.present).toBe(false);
  });

  it('ne tronque pas une valeur contenant une apostrophe', () => {
    // Le piège qui a publié un faux chiffre dans CI-COVERAGE.md (F9) : la
    // description réelle contient « … en Côte d'Ivoire ».
    const value = "Besoin d'aide ? Contactez le support Kojo";
    const html = `<meta name="google-site-verification" content="${value}">`;
    expect(analyzeSeoServedHtml(html).gsc.value).toBe(value);
  });
});

describe('runSeoProductionReport — ce qu’il conclut, et ce qu’il refuse de conclure', () => {
  it('publie 4/4 quand les quatre intégrations sont présentes', async () => {
    const result = await runSeoProductionReport({
      base: SITE_ORIGIN,
      fetchImpl: stubFetch({ '/': CONFIGURED_HTML }),
    });
    expect(result.skipped).toBe(false);
    expect(result.notices.filter((n) => n.includes('PRÉSENT'))).toHaveLength(4);
    expect(result.notices.at(-1)).toContain('4/4 intégration(s) présente(s)');
  });

  it('nomme la variable à poser pour chaque intégration absente', async () => {
    const result = await runSeoProductionReport({
      base: SITE_ORIGIN,
      fetchImpl: stubFetch({ '/': UNCONFIGURED_HTML }),
    });
    const report = result.notices.join('\n');
    for (const { env } of INTEGRATIONS) expect(report).toContain(env);
    expect(report).toContain('0/4 intégration(s) présente(s)');
  });

  it('sur une base locale, n’appelle même pas la base et ne conclut rien', async () => {
    const result = await runSeoProductionReport({
      base: 'http://127.0.0.1:4174',
      fetchImpl: () => {
        throw new Error('fetch ne doit pas être appelé');
      },
    });
    expect(result.skipped).toBe(true);
    expect(result.notices.join()).toMatch(/base locale/);
  });

  it('un accueil injoignable ne fait pas conclure « absent »', async () => {
    const result = await runSeoProductionReport({
      base: SITE_ORIGIN,
      fetchImpl: stubFetch({}, { fail: true }),
    });
    expect(result.skipped).toBe(true);
    expect(result.notices.join()).toMatch(/accueil non lisible/);
  });
});

describe('ligne de commande', () => {
  it('sort en 0 sur une base locale, avec le notice qui explique pourquoi', () => {
    const run = spawnSync(process.execPath, [SCRIPT, '--base', 'http://127.0.0.1:1'], {
      encoding: 'utf8',
      cwd: FRONTEND_DIR,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('::notice title=SEO production::base locale');
  });
});
