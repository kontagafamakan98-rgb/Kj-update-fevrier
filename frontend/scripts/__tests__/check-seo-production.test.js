/**
 * Tests de la sonde SEO de production (scripts/check-seo-production.js).
 *
 * Deux choses sont vérifiées ici, et la seconde compte autant que la première :
 *   1. l'ANALYSE lit ce que le HTML servi contient réellement (balise GA4, meta
 *      Search Console, `sameAs`, CSP Plausible) — un analyseur qui répond
 *      toujours « présent » serait pire que pas de sonde ;
 *   2. la sonde SAIT échouer (`--fail-if-missing`) et SAIT se taire quand elle
 *      ne peut rien conclure (base locale, accueil injoignable) : un rapport
 *      incapable d'échouer ne prouve rien, et un rapport qui crie « absent »
 *      sur un build local ferait perdre du temps à chaque PR.
 *
 * Aucune requête réseau : `fetch` est injecté (stub) dans les tests de
 * comportement, et les deux appels en sous-processus visent une base loopback ou
 * un domaine `.invalid` (RFC 2606), qui échoue sans sortir de la machine.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  INTEGRATIONS,
  PROD_ORIGIN,
  analyzeSeoServedHtml,
  isLoopbackBase,
  metaContent,
  runSeoProductionReport,
  socialProfiles,
} from '../check-seo-production.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(FRONTEND_DIR, 'scripts', 'check-seo-production.js');

// HTML « configuré » : exactement ce que le plugin injecte quand les variables
// sont posées (balise GA4 externe, meta GSC, sameAs peuplé, CSP ouverte).
const CONFIGURED_HTML = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://www.googletagmanager.com https://plausible.io; connect-src 'self' https://www.google-analytics.com">
<meta name="google-site-verification" content="jeton-gsc-abc123">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>
<script type="application/ld+json">{"@type":"LocalBusiness","sameAs":["https://www.facebook.com/kojo","https://www.instagram.com/kojo"]}</script>
</head><body><div id="root"></div></body></html>`;

// HTML « non configuré » : l'état actuel de la production (les mêmes pages, sans
// aucune variable SEO posée dans Vercel).
const UNCONFIGURED_HTML = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">
<script type="application/ld+json">{"@type":"LocalBusiness","sameAs":[]}</script>
</head><body><div id="root"></div></body></html>`;

const stubFetch = (htmlByPath, { fail = false } = {}) =>
  async (url) => {
    if (fail) throw new Error('ECONNREFUSED');
    const pathname = new URL(url).pathname;
    const html = htmlByPath[pathname] ?? htmlByPath.default;
    return { status: html === undefined ? 404 : 200, text: async () => html ?? '' };
  };

describe('analyse du HTML servi', () => {
  it('lit la balise GA4, la meta Search Console, le sameAs et l’ouverture Plausible', () => {
    const analysis = analyzeSeoServedHtml(CONFIGURED_HTML);
    expect(analysis.ga4).toEqual({ present: true, value: 'G-ABC1234567' });
    expect(analysis.gsc).toEqual({ present: true, value: 'jeton-gsc-abc123' });
    expect(analysis.plausible.present).toBe(true);
    expect(analysis.social.present).toBe(true);
    expect(analysis.social.count).toBe(2);
  });

  it('ne voit rien dans le HTML non configuré (métat actuel de la production)', () => {
    const analysis = analyzeSeoServedHtml(UNCONFIGURED_HTML);
    expect(analysis.ga4.present).toBe(false);
    expect(analysis.gsc.present).toBe(false);
    expect(analysis.plausible.present).toBe(false);
    expect(analysis.social).toEqual({ present: false, value: '', count: 0 });
  });

  it('ne confond pas le domaine GA de la CSP avec la balise GA4', () => {
    // La CSP relâchée mentionne googletagmanager.com : sans `gtag/js?id=`, ce
    // n'est PAS la balise, et un audit d'analytics ne la verrait pas.
    const cspOnly = CONFIGURED_HTML.replace(
      /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[^"]+"><\/script>/,
      ''
    );
    const analysis = analyzeSeoServedHtml(cspOnly);
    expect(analysis.ga4.present).toBe(false);
  });

  it('lit une meta quel que soit l’ordre des attributs', () => {
    expect(metaContent('<meta content="abc" name="google-site-verification">', 'google-site-verification')).toBe('abc');
    expect(metaContent('<meta name="google-site-verification" content="def">', 'google-site-verification')).toBe('def');
    expect(metaContent('<meta name="description" content="x">', 'google-site-verification')).toBe('');
  });

  // Le piège qui a fait publier un faux chiffre dans CI-COVERAGE.md : une valeur
  // contenant une apostrophe. Si la citation fermante pouvait être différente de
  // l'ouvrante, la description de l'accueil se lirait « Besoin d » — et une meta
  // Search Console tronquée passerait pour un jeton valide.
  it('ne tronque pas une valeur contenant une apostrophe', () => {
    // Cas réel (description de l'accueil) : valeur entre GUILLEMETS doubles.
    const value = "Besoin d'aide ? Contactez le support Kojo";
    expect(metaContent(`<meta name="description" content="${value}">`, 'description')).toBe(value);
    // Et l'attribut en apostrophes, avec une valeur SANS apostrophe (une valeur
    // entre apostrophes qui contient une apostrophe est du HTML ambigu : le
    // parseur s'arrête là, et c'est correct).
    expect(metaContent('<meta content="jeton-gsc" name="google-site-verification">', 'google-site-verification')).toBe('jeton-gsc');
    expect(metaContent("<meta content='jeton-gsc' name='google-site-verification'>", 'google-site-verification')).toBe('jeton-gsc');
  });

  it('ne retient que les profils https du sameAs, et supporte un JSON illisible', () => {
    expect(socialProfiles('{"sameAs":["https://facebook.com/x","http://insecure.test"]}')).toEqual([
      'https://facebook.com/x',
    ]);
    expect(socialProfiles('{"sameAs":[]}')).toEqual([]);
    expect(socialProfiles('{"sameAs": [oops')).toEqual([]);
    expect(socialProfiles('<html></html>')).toEqual([]);
  });
});

describe('runSeoProductionReport — ce qu’il conclut, et ce qu’il refuse de conclure', () => {
  it('sur une base locale, ne publie aucun verdict (les variables viennent de Vercel)', async () => {
    const result = await runSeoProductionReport({
      base: 'http://127.0.0.1:4174',
      fetchImpl: async () => {
        throw new Error('fetch ne doit même pas être appelé');
      },
      quiet: true,
    });
    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatch(/base locale/);
  });

  it('quand les quatre intégrations sont configurées, le rapport est vert', async () => {
    const result = await runSeoProductionReport({
      base: PROD_ORIGIN,
      fetchImpl: stubFetch({ default: CONFIGURED_HTML }),
      routes: ['/', '/jobs'],
      quiet: true,
    });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.notices.join('\n')).toContain('4/4 intégration(s) présente(s)');
    expect(result.notices.filter((notice) => notice.includes('PRÉSENT'))).toHaveLength(4);
  });

  it('nomme chaque variable à poser quand rien n’est configuré', async () => {
    const result = await runSeoProductionReport({
      base: PROD_ORIGIN,
      fetchImpl: stubFetch({ default: UNCONFIGURED_HTML }),
      routes: ['/'],
      quiet: true,
    });
    expect(result.ok).toBe(false);
    // Plausible est une ALTERNATIVE à GA4 : son absence ne compte pas comme un
    // manque, sinon un site correctement configuré échouerait sous
    // --fail-if-missing (le rapport la nomme quand même, cf. notices).
    expect(result.missing).toHaveLength(3);
    expect(result.notices.some((notice) => notice.includes('Plausible (facultatif) : ABSENT'))).toBe(true);
    const report = result.notices.join('\n');
    expect(report).toContain('VITE_GA_MEASUREMENT_ID');
    expect(report).toContain('VITE_GSC_VERIFICATION');
    expect(report).toContain('VITE_SOCIAL_*');
    expect(report).toContain('No analytics tracking detected');
    expect(report).toContain('0/4 intégration(s) présente(s)');
  });

  it('signale une injection inégale entre deux pages pré-rendues', async () => {
    const result = await runSeoProductionReport({
      base: PROD_ORIGIN,
      fetchImpl: stubFetch({ '/': CONFIGURED_HTML, '/jobs': UNCONFIGURED_HTML }),
      routes: ['/', '/jobs'],
      quiet: true,
    });
    expect(result.notices.join('\n')).toContain('injection inégale');
  });

  it('un accueil injoignable ne fait pas conclure « absent » (mais n’est pas un silence)', async () => {
    const result = await runSeoProductionReport({
      base: PROD_ORIGIN,
      fetchImpl: stubFetch({}, { fail: true }),
      routes: ['/'],
      quiet: true,
    });
    // Aucun verdict sur les intégrations : on ne peut pas lire le HTML…
    expect(result.missing).toEqual([]);
    expect(result.notices.join('\n')).toMatch(/accueil non lisible/);
    // … mais l'état est dit injoignable (distinct du cas « base locale »),
    // sinon `--fail-if-missing` ne pourrait pas mordre sur une prod cassée.
    expect(result.skipped).toBe(false);
    expect(result.reachable).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('les intégrations déclarées portent chacune la variable qui les active', () => {
    expect(INTEGRATIONS.map(({ env }) => env)).toEqual([
      'VITE_GA_MEASUREMENT_ID',
      'VITE_GSC_VERIFICATION',
      'VITE_PLAUSIBLE_DOMAIN',
      'VITE_SOCIAL_*',
    ]);
  });

  it('reconnaît les bases locales comme locales', () => {
    for (const local of ['http://localhost:4174', 'http://127.0.0.1:3000/', 'http://0.0.0.0:8000']) {
      expect(isLoopbackBase(local)).toBe(true);
    }
    expect(isLoopbackBase(PROD_ORIGIN)).toBe(false);
  });
});

describe('ligne de commande', () => {
  it('sort en 0 sur une base locale, avec le notice qui explique pourquoi', () => {
    const run = spawnSync(process.execPath, [SCRIPT, '--base', 'http://127.0.0.1:1'], {
      encoding: 'utf8',
      cwd: FRONTEND_DIR,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('sonde SEO ignorée');
  });

  // La sonde NE DOIT PAS échouer par défaut (la configuration Vercel n'est pas
  // encore faite), mais elle DOIT pouvoir échouer : sans ce test, rien ne
  // prouverait que `--fail-if-missing` n'est pas un drapeau décoratif.
  //
  // La base visée est une adresse LITTÉRALE de TEST-NET-1 (RFC 5737 : réservée
  // à la documentation, aucun hôte ne répond). Un domaine `.invalid` ferait la
  // MÊME chose mais en passant par le résolveur DNS, qui n'obéit pas à
  // `AbortSignal` sur toutes les plateformes : ce test a dépassé le délai de
  // 20 s avec un nom de domaine, et un test qui dépend de la vitesse du DNS
  // n'est pas un test. Une IP littérale échoue sur la connexion, bornée par
  // `--timeout`.
  it('--fail-if-missing sort en 1 quand la cible manque ou est injoignable', () => {
    const without = spawnSync(
      process.execPath,
      [SCRIPT, '--base', 'http://192.0.2.1:9', '--timeout', '1500'],
      { encoding: 'utf8', cwd: FRONTEND_DIR }
    );
    expect(without.status).toBe(0);

    const withFlag = spawnSync(
      process.execPath,
      [SCRIPT, '--base', 'http://192.0.2.1:9', '--timeout', '1500', '--fail-if-missing'],
      { encoding: 'utf8', cwd: FRONTEND_DIR }
    );
    expect(withFlag.status).toBe(1);
  });
});
