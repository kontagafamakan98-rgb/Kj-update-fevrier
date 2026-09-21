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
import { INTEGRATIONS, analyzeSeoServedHtml, noticeFor, runSeoProductionReport } from '../check-seo-production.js';
import { SITE_ORIGIN } from '../site-meta.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(FRONTEND_DIR, 'scripts', 'check-seo-production.js');

// HTML « configuré » : ce que le plugin injecte quand les variables sont posées.
const CONFIGURED_HTML = `<!doctype html><html><head>
<link rel="canonical" href="https://kojoforafrica.cc.cd/" />
<title>Titre de l'accueil</title>
<meta name="description" content="Description de l'accueil">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://www.googletagmanager.com https://plausible.io">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>
<meta content="jeton-gsc-abc123" name="google-site-verification">
<script type="application/ld+json">{"@type":"LocalBusiness","sameAs":["https://www.facebook.com/kojo","http://insecure.test"]}</script>
</head><body><div id="root"><a href="https://www.facebook.com/kojo" rel="me noreferrer">Facebook</a></div><footer><a href="https://www.facebook.com/kojo" rel="me noreferrer">Facebook</a></footer></body></html>`;

// HTML « requis seulement » : les trois intégrations REQUISES sont là, la
// facultative non. C'est l'état attendu une fois GA4 et GSC posés — et il doit
// laisser la sonde stricte VERTE, sinon le rouge quotidien ne voudrait plus rien
// dire.
const REQUIRED_ONLY_HTML = CONFIGURED_HTML.replace(' https://plausible.io', '');

// HTML « non configuré » : l'état de la production tant que Vercel n'a rien.
const UNCONFIGURED_HTML = `<!doctype html><html><head>
<link rel="canonical" href="https://kojoforafrica.cc.cd/" />
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">
<script type="application/ld+json">{"@type":"LocalBusiness","sameAs":[]}</script>
</head><body><div id="root"></div></body></html>`;

// Sitemap servi par le backend, tel qu'il sort de `_site_base()`.
const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://kojoforafrica.cc.cd/</loc></url>
  <url><loc>https://kojoforafrica.cc.cd/jobs</loc></url>
  <url><loc>https://kojoforafrica.cc.cd/how-it-works</loc></url>
</urlset>`;

// Une page du sitemap : ses trois métadonnées, sur sa propre adresse.
const pageFor = (route) => `<!doctype html><html><head>
<link rel="canonical" href="${SITE_ORIGIN}${route}" />
<title>Titre de ${route}</title>
<meta name="description" content="Description de ${route}">
</head><body><div id="root"></div></body></html>`;

// Les pages que le SITEMAP_XML annonce, telles que la production les sert.
const SERVED_PAGES = {
  '/': CONFIGURED_HTML,
  '/jobs': pageFor('/jobs'),
  '/how-it-works': pageFor('/how-it-works'),
};

// Double qui sert des pages ET retient les chemins demandés : la section Pages
// ne doit pas relire l'accueil déjà lu pour les intégrations.
const trackingFetch = (pages, sitemapXml, seen) =>
  async (url) => {
    const pathname = new URL(url).pathname;
    if (seen) seen.push(pathname);
    const map = { ...pages, ...(sitemapXml ? { '/sitemap.xml': sitemapXml } : {}) };
    const html = map[pathname];
    return { ok: html !== undefined, status: html === undefined ? 404 : 200, text: async () => html ?? '' };
  };

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
    // `total` compte les OCCURRENCES dans le HTML servi, `body` celles d'AVANT
    // le pied de page : le même profil publié deux fois (bloc du corps + footer)
    // doit se voir — un décompte dédoublonné ne bougerait pas à l'ajout du bloc.
    expect(analysis.social).toEqual({
      present: true,
      value: 'https://www.facebook.com/kojo',
      count: 1,
      total: 2,
      body: 1,
    });
  });

  it('un sameAs déclaré sans aucun lien est dit invisible, pas présent', () => {
    // Le cas que ce décompte existe pour nommer : la configuration est là, le
    // crawler ne voit rien.
    const withoutLinks = CONFIGURED_HTML.replace(/<a href="[^"]+"[^>]*>[^<]*<\/a>/g, '');
    expect(analyzeSeoServedHtml(withoutLinks).social.total).toBe(0);
    expect(noticeFor(INTEGRATIONS[3], analyzeSeoServedHtml(withoutLinks).social)).toContain(
      'AUCUN lien social dans le HTML brut',
    );
  });

  it('ne compte que les hôtes que le sameAs déclare', () => {
    // Un lien vers un profil non déclaré (ou vers un domaine quelconque) n'est
    // pas un profil du site : le compter ferait dire « présent » à tort.
    const withStranger = CONFIGURED_HTML.replace(
      '</body>',
      '<a href="https://instagram.com/quelquun">Instagram</a></body>',
    );
    expect(analyzeSeoServedHtml(withStranger).social.total).toBe(2);
  });

  it('ne voit rien dans le HTML non configuré', () => {
    const analysis = analyzeSeoServedHtml(UNCONFIGURED_HTML);
    expect(analysis.ga4.present).toBe(false);
    expect(analysis.gsc.present).toBe(false);
    expect(analysis.plausible.present).toBe(false);
    expect(analysis.social.present).toBe(false);
  });

  it('détecte le tag GA4 DÉCLARÉ (data-kojo-ga-src) sans qu’il soit exécuté', () => {
    // Le tag est désormais chargé après `load` : la détection ne doit pas
    // dépendre d'un `<script src>` exécuté, sinon la sonde deviendrait rouge
    // pour une raison de chemin de chargement et non de configuration.
    const html =
      '<head><script type="text/plain" data-kojo-ga-src="https://www.googletagmanager.com/gtag/js?id=G-DEFER1234"></script></head>';
    expect(analyzeSeoServedHtml(html).ga4).toEqual({ present: true, value: 'G-DEFER1234' });
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
    // Le décompte ne compte QUE les intégrations : la section Domaine le suit,
    // et un `at(-1)` deviendrait faux au premier notice ajouté après lui.
    expect(result.notices.find((n) => n.includes('intégration(s) présente(s)'))).toContain(
      '4/4',
    );
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

  it('n’excuse pas 0.0.0.0 comme base locale — la décision vient du propriétaire de la règle', async () => {
    // `0.0.0.0` est l'adresse d'ÉCOUTE (celle sur laquelle un serveur se LIE),
    // pas une adresse par laquelle on joint cette machine : une base qui la porte
    // n'est pas le repli local. La règle recopiée ici auparavant l'acceptait, et
    // c'est précisément cette divergence que la règle unique a supprimée.
    // Le discriminant est l'APPEL : excusée comme locale, la base n'est jamais
    // interrogée et les deux cas finissent en `skipped` — seule la tentative
    // distingue « base locale » de « accueil non lisible ».
    const appels = [];
    const result = await runSeoProductionReport({
      base: 'http://0.0.0.0:4174',
      fetchImpl: (url) => {
        appels.push(url);
        return Promise.reject(new Error('injoignable'));
      },
    });
    expect(appels.length, 'une base 0.0.0.0 doit être interrogée, pas excusée comme locale').toBeGreaterThan(0);
    expect(result.notices.join()).not.toMatch(/base locale/);
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

describe('section Domaine — ce qui se détecte tout seul après une migration', () => {
  const report = async (html, sitemapXml) => {
    const result = await runSeoProductionReport({
      base: SITE_ORIGIN,
      fetchImpl: trackingFetch({ ...SERVED_PAGES, '/': html }, sitemapXml),
    });
    expect(result.skipped).toBe(false);
    return result.notices.join('\n');
  };

  it('dit « conforme » quand le canonical et le sitemap annoncent l’origine attendue', async () => {
    const log = await report(CONFIGURED_HTML, SITEMAP_XML);
    expect(log).toContain(`Domaine — canonical servi : ${SITE_ORIGIN}/ (conforme à l'origine attendue)`);
    expect(log).toContain(`Domaine — sitemap : 3 URL, hôte annoncé ${SITE_ORIGIN} (conforme`);
  });

  it('nomme l’écart quand le HTML annonce encore l’ancien hôte', async () => {
    const stale = CONFIGURED_HTML.replaceAll(SITE_ORIGIN, 'https://kj-update-fevrier.vercel.app');
    const log = await report(stale, SITEMAP_XML);
    expect(log).toMatch(/Domaine — canonical servi : https:\/\/kj-update-fevrier\.vercel\.app\/ — ÉCART/);
    expect(log).toContain(`l'origine attendue est ${SITE_ORIGIN}`);
  });

  it('nomme l’écart quand le sitemap seul est resté sur l’ancien hôte', async () => {
    // Le cas réel du 17/09/2026 : le frontend bascule, le sitemap est servi par
    // un backend dont le déploiement est indépendant.
    const log = await report(CONFIGURED_HTML, SITEMAP_XML.replaceAll(SITE_ORIGIN, 'https://kj-update-fevrier.vercel.app'));
    expect(log).toMatch(/Domaine — sitemap : 3 URL, hôte annoncé https:\/\/kj-update-fevrier\.vercel\.app — ÉCART/);
    expect(log).toContain(`Domaine — canonical servi : ${SITE_ORIGIN}/ (conforme`);
  });

  it('signale un canonical absent au lieu de le supposer présent', async () => {
    const log = await report(CONFIGURED_HTML.replace(/<link rel="canonical"[^>]*>/, ''), SITEMAP_XML);
    expect(log).toContain("Domaine — canonical : ABSENT de l'accueil");
  });

  it('lit le canonical quel que soit l’ordre des attributs et la citation', async () => {
    // La fragilité réelle des motifs recopiés avant `site-meta.js`.
    const html = CONFIGURED_HTML.replace(
      /<link rel="canonical"[^>]*>/,
      "<link href='https://kojoforafrica.cc.cd/' rel='canonical'>",
    );
    const log = await report(html, SITEMAP_XML);
    expect(log).toContain(`Domaine — canonical servi : ${SITE_ORIGIN}/ (conforme`);
  });

  it('un sitemap illisible est dit, et ne fait pas perdre le reste du rapport', async () => {
    const log = await report(CONFIGURED_HTML);
    expect(log).toContain('Domaine — sitemap : non lisible (HTTP 404)');
    expect(log).toContain('4/4 intégration(s) présente(s)');
  });
});

describe('section Pages — le sitemap servi, page par page', () => {
  // « au-delà de / » : la sonde lisait l'accueil puis ignorait les sept autres
  // pages que le sitemap annonce. Chaque page doit annoncer son canonical, son
  // title et sa description, et une page défaillante est NOMMÉE.
  const run = (over = {}, sitemapXml = SITEMAP_XML, seen) =>
    runSeoProductionReport({
      base: SITE_ORIGIN,
      fetchImpl: trackingFetch({ ...SERVED_PAGES, ...over }, sitemapXml, seen),
    });

  it('lit chaque page du sitemap et ne redemande pas l’accueil déjà lu', async () => {
    const seen = [];
    const result = await run({}, SITEMAP_XML, seen);
    expect(seen).toEqual(['/', '/sitemap.xml', '/jobs', '/how-it-works']);
    expect(result.pages.map(({ url }) => url)).toEqual([
      `${SITE_ORIGIN}/`,
      `${SITE_ORIGIN}/jobs`,
      `${SITE_ORIGIN}/how-it-works`,
    ]);
  });

  it('dit « conformes » quand chaque page annonce ses trois métadonnées', async () => {
    const result = await run();
    expect(result.manquantes).toEqual([]);
    expect(result.notices.join('\n')).toContain('3/3 page(s) du sitemap vérifiée(s)');
    expect(result.notices.join('\n')).toContain('conformes');
  });

  it('refuse une page sans description, en la nommant', async () => {
    const result = await run({
      '/jobs': pageFor('/jobs').replace(/<meta name="description"[^>]*>/, ''),
    });
    expect(result.manquantes.join('\n')).toContain('/jobs : description ABSENTE');
    // Le refus nomme la page fautive, pas les pages saines.
    expect(result.manquantes.join('\n')).not.toContain('/how-it-works');
  });

  it('refuse un <title> absent', async () => {
    const result = await run({ '/jobs': pageFor('/jobs').replace(/<title>[^<]*<\/title>/, '') });
    expect(result.manquantes.join('\n')).toContain('/jobs : <title> ABSENT');
  });

  it('refuse un canonical qui désigne une AUTRE page', async () => {
    // Avoir une adresse canonique ne suffit pas : celle-ci envoie les crawlers
    // ailleurs, ce qu'un contrôle limité à l'origine ne verrait pas.
    const result = await run({
      '/jobs': pageFor('/jobs').replace(`${SITE_ORIGIN}/jobs`, `${SITE_ORIGIN}/login`),
    });
    expect(result.manquantes.join('\n')).toContain('/jobs : canonical');
    expect(result.manquantes.join('\n')).toContain('désigne /login');
  });

  it('refuse un canonical hors de l’origine attendue', async () => {
    const result = await run({
      '/jobs': pageFor('/jobs').replace(SITE_ORIGIN, 'https://kj-update-fevrier.vercel.app'),
    });
    expect(result.manquantes.join('\n')).toContain("hors de l'origine attendue");
  });

  it('une page du sitemap non servie est refusée : un sitemap n’annonce pas du vide', async () => {
    const missing = await runSeoProductionReport({
      base: SITE_ORIGIN,
      strict: true,
      fetchImpl: async (url) => {
        const pathname = new URL(url).pathname;
        if (pathname === '/how-it-works') return { ok: false, status: 404, text: async () => '' };
        const html = { ...SERVED_PAGES, '/sitemap.xml': SITEMAP_XML }[pathname];
        return { ok: html !== undefined, status: html === undefined ? 404 : 200, text: async () => html ?? '' };
      },
    });
    expect(missing.manquantes.join('\n')).toContain('/how-it-works : non lisible (HTTP 404)');
  });

  // ── Échantillon des fiches /jobs/:id ──────────────────────────────
  // Elles sont lues (canonical, title, description) SANS rejouer ce que
  // check-og-job-200.js possède : la carte OG et le verrou 404.
  const withJobs = (...ids) =>
    SITEMAP_XML.replace(
      '</urlset>',
      `${ids.map((id) => `  <url><loc>${SITE_ORIGIN}/jobs/${id}</loc></url>`).join('\n')}\n</urlset>`,
    );

  it('échantillonne les fiches et juge leurs trois métadonnées, en bornant l’échantillon', async () => {
    const result = await run({ '/jobs/abc123': pageFor('/jobs/abc123') }, withJobs('abc123'));

    expect(result.jobPages.map(({ url }) => url)).toEqual([`${SITE_ORIGIN}/jobs/abc123`]);
    expect(result.manquantes).toEqual([]);
    const log = result.notices.join('\n');
    expect(log).toContain('fiches /jobs/:id : 1 sur 1 vérifiée(s)');
    expect(log).toContain('Échantillon borné à 3');
    // La notice dit ce que l'échantillon NE couvre pas.
    expect(log).toContain('check-og-job-200.js');
  });

  it('refuse une fiche dont la description manque, en la nommant', async () => {
    const result = await run(
      { '/jobs/abc123': pageFor('/jobs/abc123').replace(/<meta name="description"[^>]*>/, '') },
      withJobs('abc123'),
    );
    expect(result.manquantes.join('\n')).toContain('/jobs/abc123 : description ABSENTE');
  });

  it('refuse un canonical de fiche qui désigne une autre fiche', async () => {
    const result = await run(
      {
        '/jobs/abc123': pageFor('/jobs/abc123').replace(
          `${SITE_ORIGIN}/jobs/abc123`,
          `${SITE_ORIGIN}/jobs/xyz`,
        ),
      },
      withJobs('abc123'),
    );
    expect(result.manquantes.join('\n')).toContain('désigne /jobs/xyz');
  });

  it('n’échoue PAS sur une fiche disparue entre le sitemap et sa lecture', async () => {
    // Une mission clôturée disparaît normalement : un 404 n'est pas un défaut,
    // c'est une mesure impossible — sinon la sonde rougirait au hasard.
    const result = await run({}, withJobs('disparue'));
    expect(result.manquantes).toEqual([]);
    expect(result.notices.join('\n')).toContain('1 disparue(s) depuis la lecture du sitemap');
  });

  it('borne l’échantillon à 3 fiches même si le sitemap en annonce cinq', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const seen = [];
    await run(
      Object.fromEntries(ids.map((id) => [`/jobs/${id}`, pageFor(`/jobs/${id}`)])),
      withJobs(...ids),
      seen,
    );
    expect(seen.filter((p) => /^\/jobs\/[a-e]$/.test(p))).toEqual(['/jobs/a', '/jobs/b', '/jobs/c']);
  });

  it('dit l’échantillon vide quand le sitemap ne liste aucune fiche', async () => {
    // L'état réel de la production au 20/09/2026 : 8 URL, zéro fiche.
    const result = await run();
    expect(result.notices.join('\n')).toContain('fiches /jobs/:id : aucune dans le sitemap');
  });

  it('un sitemap illisible ne conclut rien sur les pages, sans faire tomber le reste', async () => {
    const result = await runSeoProductionReport({
      base: SITE_ORIGIN,
      fetchImpl: trackingFetch(SERVED_PAGES),
    });
    expect(result.notices.join('\n')).toContain("Pages — non vérifiées : le sitemap n'est pas lisible");
    expect(result.manquantes).toEqual([]);
  });
});

describe('le mode STRICT — celui qui met fin au silence (F9)', () => {
  // Le mode informatif est ce qui a laissé F9 ouvert des jours : quatre
  // intégrations absentes de la production, et aucun run rouge. Le mode strict
  // est celui de la sonde PÉRIODIQUE (.github/workflows/seo-production-probe.yml).
  it('refuse une intégration absente et nomme la variable à poser', async () => {
    const result = await runSeoProductionReport({
      base: SITE_ORIGIN,
      strict: true,
      fetchImpl: trackingFetch({ ...SERVED_PAGES, '/': UNCONFIGURED_HTML }, SITEMAP_XML),
    });

    expect(result.skipped).toBe(false);
    expect(result.manquantes.length).toBeGreaterThan(0);
    // Le rouge doit dire QUOI corriger : un échec muet oblige à relire le script.
    expect(result.manquantes.join('\n')).toContain('VITE_GA_MEASUREMENT_ID');
    expect(result.notices.join('\n')).toContain('BLOQUE');
  });

  it('ne trouve rien à refuser quand les quatre intégrations sont présentes', async () => {
    const result = await runSeoProductionReport({
      base: SITE_ORIGIN,
      strict: true,
      fetchImpl: trackingFetch(SERVED_PAGES, SITEMAP_XML),
    });

    expect(result.manquantes).toEqual([]);
  });

  it('reste VERTE quand seule l’intégration FACULTATIVE manque', async () => {
    // Le cas qui compte après la pose des valeurs requises : Plausible est un
    // choix d'exploitation, pas un défaut. Une sonde qui échouerait encore ici
    // resterait rouge à jamais et on apprendrait à l'ignorer.
    expect(analyzeSeoServedHtml(REQUIRED_ONLY_HTML).plausible.present).toBe(false);
    const result = await runSeoProductionReport({
      base: SITE_ORIGIN,
      strict: true,
      fetchImpl: trackingFetch({ ...SERVED_PAGES, '/': REQUIRED_ONLY_HTML }, SITEMAP_XML),
    });

    expect(result.manquantes).toEqual([]);
    // Elle est quand même PUBLIÉE — un silence total cacherait le choix.
    expect(result.notices.join('\n')).toContain('Plausible (facultatif) : ABSENT');
    expect(result.notices.join('\n')).toContain('FACULTATIF : son absence ne fait pas échouer');
  });

  it('refuse les REQUISES absentes et ne nomme la facultative que dans le refus', async () => {
    const result = await runSeoProductionReport({
      base: SITE_ORIGIN,
      strict: true,
      fetchImpl: trackingFetch({ ...SERVED_PAGES, '/': UNCONFIGURED_HTML }, SITEMAP_XML),
    });

    const refuse = result.manquantes.join('\n');
    for (const env of ['VITE_GA_MEASUREMENT_ID', 'VITE_GSC_VERIFICATION', 'VITE_SOCIAL_*']) {
      expect(refuse).toContain(env);
    }
    expect(refuse).not.toContain('VITE_PLAUSIBLE_DOMAIN');
  });

  it('une sonde SANS VERDICT échoue aussi : rien mesuré n’est pas « rien de cassé »', async () => {
    const result = await runSeoProductionReport({
      base: SITE_ORIGIN,
      strict: true,
      fetchImpl: stubFetch({}, { fail: true }),
    });

    expect(result.skipped).toBe(true);
    expect(result.manquantes).toEqual([]);
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

  it('--strict sur une base locale ÉCHOUE : aucune conclusion n’est possible', () => {
    // Une base loopback ne dit rien de la production : un mode strict qui y
    // resterait vert ferait passer « non mesuré » pour « conforme ».
    const run = spawnSync(process.execPath, [SCRIPT, '--base', 'http://127.0.0.1:1', '--strict'], {
      encoding: 'utf8',
      cwd: FRONTEND_DIR,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('::error title=SEO production::');
  });
});
