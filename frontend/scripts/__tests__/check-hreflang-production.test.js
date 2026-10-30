/**
 * La preuve de la sonde `check-hreflang-production.js` : chaque refus est
 * PRONONCÉ, et le vert n'est pas un silence.
 *
 * La fixture n'écrit aucune URL à la main : elle DÉRIVE ses documents et son
 * sitemap de `src/config/langues-indexees.js` (les mêmes `cheminDansLaLangue` et
 * `alternatesHreflang` que le build), comme le fait le vrai build. Une mutation
 * par cas, et un seul refus nommé à chaque fois :
 *
 *   • un `lang` faux, un `canonical` croisé, une alternative d'un seul côté ou
 *     sans `x-default` → le DOCUMENT n'est pas une version de sa famille ;
 *   • un sitemap qui publie le français sans l'anglais, ou qui n'énumère aucune
 *     version anglaise → la déclaration n'est servie qu'à moitié ;
 *   • une alternative posée sur une page MONOLINGUE → hreflang vers une page
 *     qui n'existe pas ;
 *   • un sitemap illisible ou un corpus vide → PRÉMISSE (code 2), jamais un vert.
 *
 * Un cas sert la fixture ENTIÈRE depuis un vrai serveur HTTP : il prouve l'URL
 * demandée pour chaque document (24 requêtes + le sitemap) et le fait que
 * `--base` déplace la LECTURE sans déplacer ce que les documents déclarent — les
 * `canonical` des documents pré-rendus sont absolus, ils désignent la
 * production même quand on interroge une preview.
 */
import http from 'node:http';
import { describe, it, expect } from 'vitest';

import {
  LANGUES_INDEXEES,
  alternatesHreflang,
  cheminDansLaLangue,
} from '../../src/config/langues-indexees.js';
import { PAGE_META } from '../../src/config/page-meta.js';
import { GROUPES_LIENS_SEO } from '../../src/config/liens-seo.js';
import { SITE_ORIGIN } from '../site-meta.js';
import {
  CHEMIN_SITEMAP,
  MARQUEUR_DE_PAGE,
  blocsDuSitemap,
  jugerSitemap,
  main,
  runHreflangProbe,
} from '../check-hreflang-production.js';

const BASE = 'https://sonde-hreflang.test';
const ROUTES = Object.keys(PAGE_META);
/** Une page MONOLINGUE réelle (villes, métiers, guides) : aucune alternative. */
const MONOLINGUE = GROUPES_LIENS_SEO.flatMap((groupe) => groupe.liens)[0].href;
const FR = LANGUES_INDEXEES.find((langue) => !langue.prefixe);
const EN = LANGUES_INDEXEES.find((langue) => langue.prefixe);

/** Le document d'une page, construit depuis la déclaration (jamais recopié). */
function documentDe(route, langue, { lang, canonical, alternatives, marqueur } = {}) {
  const chemin = cheminDansLaLangue(route, langue.code);
  const liste = alternatives ?? alternatesHreflang(route, SITE_ORIGIN);
  const liens = liste
    .map(({ hreflang, href }) => `<link rel="alternate" hreflang="${hreflang}" href="${href}" />`)
    .join('');
  return (
    '<!doctype html><html lang="' +
    (lang ?? langue.htmlLang) +
    '"><head>' +
    `<link rel="canonical" href="${canonical ?? `${SITE_ORIGIN}${chemin}`}" />` +
    liens +
    '</head><body>' +
    (marqueur ?? MARQUEUR_DE_PAGE) +
    '</body></html>'
  );
}

/** Le sitemap servi, dont les entrées bilingues viennent de la déclaration. */
function sitemapDe({ routes = ROUTES, monolingues = [MONOLINGUE] } = {}) {
  const entrees = [];
  for (const route of routes) {
    for (const langue of LANGUES_INDEXEES) {
      const chemin = cheminDansLaLangue(route, langue.code);
      const alternatives = alternatesHreflang(route, SITE_ORIGIN)
        .map(
          ({ hreflang, href }) =>
            `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}"/>`
        )
        .join('');
      entrees.push(
        `<url><loc>${SITE_ORIGIN}${chemin}</loc>${alternatives}<changefreq>daily</changefreq></url>`
      );
    }
  }
  for (const chemin of monolingues) {
    entrees.push(`<url><loc>${SITE_ORIGIN}${chemin}</loc><changefreq>weekly</changefreq></url>`);
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
    'xmlns:xhtml="http://www.w3.org/1999/xhtml">' +
    entrees.join('') +
    '</urlset>'
  );
}

/**
 * Le jeu de réponses d'une passe, indexé par URL ABSOLUE.
 *
 * Aucun réseau : chaque cas mute une seule réponse et vérifie le refus qui la
 * nomme. Le cas HTTP réel, plus bas, prouve les URL demandées.
 */
function reponses({ pages = {}, sitemap = sitemapDe() } = {}) {
  const parUrl = new Map();
  for (const route of ROUTES) {
    for (const langue of LANGUES_INDEXEES) {
      const chemin = cheminDansLaLangue(route, langue.code);
      parUrl.set(`${BASE}${chemin}`, { statut: 200, corps: documentDe(route, langue) });
    }
  }
  for (const [chemin, reponse] of Object.entries(pages)) {
    parUrl.set(`${BASE}${chemin}`, { statut: 200, corps: '', ...reponse });
  }
  parUrl.set(`${BASE}${CHEMIN_SITEMAP}`, { statut: 200, corps: sitemap });
  return async (url) => {
    const reponse = parUrl.get(url);
    if (!reponse) throw new Error(`URL inattendue : ${url}`);
    return { status: reponse.statut, text: async () => reponse.corps };
  };
}

const lancer = (options = {}) =>
  runHreflangProbe({ base: BASE, fetchImpl: reponses(options), quiet: true });

describe('documents par langue — lang, canonical, alternatives réciproques', () => {
  it('la fixture entière est conforme, et la passe le DIT', async () => {
    const resultat = await lancer();

    expect(resultat.errors).toEqual([]);
    expect(resultat.premisse).toBe(false);
    expect(resultat.ok).toBe(true);
    // Chaque route est lue dans CHAQUE langue : la réciprocité ne se juge pas
    // d'un seul côté.
    expect(resultat.pages).toHaveLength(ROUTES.length * LANGUES_INDEXEES.length);
    expect(resultat.pages).toContain(`${BASE}${cheminDansLaLangue('/jobs', EN.code)}`);
    expect(resultat.cout.requetes).toBe(ROUTES.length * LANGUES_INDEXEES.length + 1);
    expect(resultat.checked.join('\n')).toContain('sitemap');
  });

  it('refuse un document dont le lang n’est pas celui de sa langue', async () => {
    const resultat = await lancer({
      pages: {
        [cheminDansLaLangue('/jobs', EN.code)]: {
          corps: documentDe('/jobs', EN, { lang: FR.htmlLang }),
        },
      },
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/lang="fr"> au lieu de « en »/);
  });

  it('refuse un canonical qui désigne l’autre langue', async () => {
    const resultat = await lancer({
      pages: {
        [cheminDansLaLangue('/jobs', EN.code)]: {
          corps: documentDe('/jobs', EN, {
            canonical: `${SITE_ORIGIN}${cheminDansLaLangue('/jobs', FR.code)}`,
          }),
        },
      },
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/canonical croisé/);
  });

  it('refuse des alternatives écrites d’un seul côté', async () => {
    const unilateral = alternatesHreflang('/jobs', SITE_ORIGIN).filter(
      ({ hreflang }) => hreflang === EN.htmlLang
    );
    const resultat = await lancer({
      pages: {
        [cheminDansLaLangue('/jobs', EN.code)]: {
          corps: documentDe('/jobs', EN, { alternatives: unilateral }),
        },
      },
    });

    expect(resultat.ok).toBe(false);
    const messages = resultat.errors.join('\n');
    expect(messages).toMatch(/1 alternative\(s\) hreflang au lieu de 3/);
    // Et le fait est dit DEUX fois : la déclaration manque, ET la famille ne
    // publie pas la même liste — deux lectures d'une seule faute.
    expect(messages).toMatch(/ne publient pas la même liste hreflang/);
  });

  it('refuse une famille sans x-default', async () => {
    const sansSecours = alternatesHreflang('/jobs', SITE_ORIGIN).filter(
      ({ hreflang }) => hreflang !== 'x-default'
    );
    const resultat = await lancer({
      pages: {
        [cheminDansLaLangue('/jobs', EN.code)]: {
          corps: documentDe('/jobs', EN, { alternatives: sansSecours }),
        },
      },
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toContain('x-default');
  });

  it('refuse la coquille de l’application servie à la place de la page', async () => {
    const resultat = await lancer({
      pages: {
        [cheminDansLaLangue('/jobs', EN.code)]: {
          corps: documentDe('/jobs', EN, { marqueur: '<div id="root"></div>' }),
        },
      },
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/coquille de l’application|coquille de l'application/);
  });

  it('refuse une page servie en erreur, en nommant le statut', async () => {
    const resultat = await lancer({
      pages: { [cheminDansLaLangue('/jobs', EN.code)]: { statut: 404, corps: '' } },
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/HTTP 404/);
    expect(resultat.errors.join('\n')).toContain('vercel.json');
  });
});

describe('sitemap — les deux versions de chaque page publiée', () => {
  it('refuse un sitemap à moitié bilingue', async () => {
    const sansAnglais = sitemapDe().replace(
      `<url><loc>${SITE_ORIGIN}${cheminDansLaLangue('/jobs', EN.code)}</loc>`,
      '<url><loc>https://exemple.test/ailleurs</loc>'
    );
    const resultat = await lancer({ sitemap: sansAnglais });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/à moitié bilingue/);
  });

  it('refuse un sitemap qui n’énumère aucune version anglaise', async () => {
    const monolingue = sitemapDe().replace(
      new RegExp(`<url><loc>${SITE_ORIGIN}/en[^<]*</loc>(?:(?!</url>).)*</url>`, 'g'),
      ''
    );
    // Les entrées françaises GARDENT leurs alternatives (elles désignent
    // l'anglais) : ce qui doit avoir disparu, ce sont les URL anglaises
    // elles-mêmes — sans quoi le sitemap cite une page qu'il n'énumère pas.
    expect(blocsDuSitemap(monolingue).map((bloc) => bloc.loc)).not.toContain(
      `${SITE_ORIGIN}${cheminDansLaLangue('/jobs', EN.code)}`
    );

    const resultat = await lancer({ sitemap: monolingue });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/à moitié bilingue/);
  });

  it('refuse un sitemap vide, qui ne jugerait que ce qu’il publie', async () => {
    const resultat = await lancer({ sitemap: '<urlset></urlset>' });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/aucune entrée <url>/);
  });

  it('refuse une alternative déclarée sur une page monolingue', async () => {
    const xml = sitemapDe().replace(
      `<url><loc>${SITE_ORIGIN}${MONOLINGUE}</loc>`,
      `<url><loc>${SITE_ORIGIN}${MONOLINGUE}</loc><xhtml:link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/en${MONOLINGUE}"/>`
    );

    const resultat = await lancer({ sitemap: xml });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/MONOLINGUE/);
  });

  it('juge les alternatives de chaque entrée, pas seulement leur présence', () => {
    const xml = sitemapDe().replace(
      `href="${SITE_ORIGIN}${cheminDansLaLangue('/jobs', EN.code)}"/>`,
      `href="${SITE_ORIGIN}/autre"/>`
    );

    const problemes = jugerSitemap({ xml });

    expect(problemes.join('\n')).toMatch(/en trop/);
    expect(blocsDuSitemap(xml).length).toBeGreaterThan(0);
  });
});

describe('prémisses — une passe qui n’a pas mesuré ne vaut pas un vert', () => {
  it('un corpus vide est une prémisse, pas un succès', async () => {
    const resultat = await runHreflangProbe({ base: BASE, routes: [], quiet: true });

    expect(resultat.premisse).toBe(true);
    expect(resultat.ok).toBe(false);
    expect(resultat.notices.join(' ')).toContain("Rien n'a été mesuré");
  });

  it('un sitemap illisible est une prémisse : l’énumération n’a pas été jugée', async () => {
    const fetchImpl = reponses();
    const resultat = await runHreflangProbe({
      base: BASE,
      quiet: true,
      fetchImpl: async (url, options) => {
        if (url.endsWith(CHEMIN_SITEMAP)) throw new Error('ETIMEDOUT');
        return fetchImpl(url, options);
      },
    });

    expect(resultat.premisse).toBe(true);
    expect(resultat.ok).toBe(false);
    expect(resultat.notices.join(' ')).toContain('sitemap');
  });

  it('aucun document lisible est une prémisse', async () => {
    const resultat = await runHreflangProbe({
      base: BASE,
      quiet: true,
      fetchImpl: async () => {
        throw new Error('ENOTFOUND');
      },
    });

    expect(resultat.premisse).toBe(true);
    expect(resultat.ok).toBe(false);
  });
});

describe('le VERDICT (0/1/2) se juge sans réseau', () => {
  const sortie = async (resultat) => {
    const lignes = [];
    const code = await main([], {
      run: async () => resultat,
      log: (ligne) => lignes.push(ligne),
      error: (ligne) => lignes.push(ligne),
    });
    return { code, texte: lignes.join('\n') };
  };

  it('rend 0 quand tout est conforme', async () => {
    const { code, texte } = await sortie({
      ok: true,
      premisse: false,
      errors: [],
      notices: [],
      checked: [],
      pages: [],
      cout: { documents: 24, langues: 2, routes: 12, requetes: 25, dureeMs: 1 },
    });

    expect(code).toBe(0);
    expect(texte).toContain('✅');
    // Le coût est publié sur le VERT : une passe qui ne s'affiche que le jour où
    // elle échoue ne sert à aucun arbitrage.
    expect(texte).toContain('25 requête(s)');
  });

  it('rend 1 sur un refus nommé, et nomme le correctif', async () => {
    const { code, texte } = await sortie({
      ok: false,
      premisse: false,
      errors: ['un document est faux'],
      notices: [],
      checked: [],
      pages: [],
      cout: { documents: 1, langues: 2, routes: 1, requetes: 2, dureeMs: 1 },
    });

    expect(code).toBe(1);
    expect(texte).toContain('::error title=Hreflang production::');
    expect(texte).toContain('langues-indexees.js');
  });

  it('rend 2 sur une prémisse, jamais 0', async () => {
    const { code, texte } = await sortie({
      ok: false,
      premisse: true,
      errors: [],
      notices: ['prémisse (aucun verdict rendu ici) : rien n’a été lu'],
      checked: [],
      pages: [],
      cout: {},
    });

    expect(code).toBe(2);
    expect(texte).toMatch(/::error title=Hreflang production::/);
  });
});

describe('la passe entière contre un serveur HTTP réel', () => {
  it('demande chaque document une fois et juge la fixture servie', async () => {
    const documents = new Map();
    for (const route of ROUTES) {
      for (const langue of LANGUES_INDEXEES) {
        documents.set(
          `${cheminDansLaLangue(route, langue.code)}`,
          documentDe(route, langue)
        );
      }
    }
    const xml = sitemapDe();
    const demandes = [];

    const serveur = http.createServer((req, res) => {
      const chemin = decodeURIComponent((req.url || '/').split('?')[0]);
      demandes.push(chemin);
      if (chemin === CHEMIN_SITEMAP) {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(xml);
        return;
      }
      const document = documents.get(chemin);
      if (!document) {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('introuvable');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(document);
    });

    await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
    const port = serveur.address().port;
    try {
      // L'origine interrogée n'est PAS celle des documents : les canonical des
      // pages pré-rendues sont absolus, ils désignent la production. Une preview
      // change où l'on LIT, jamais ce que la page doit déclarer.
      const resultat = await runHreflangProbe({
        base: `http://127.0.0.1:${port}`,
        quiet: true,
      });

      expect(resultat.errors).toEqual([]);
      expect(resultat.ok).toBe(true);
      expect(demandes).toHaveLength(ROUTES.length * LANGUES_INDEXEES.length + 1);
      expect(new Set(demandes).size).toBe(demandes.length);
    } finally {
      await new Promise((resolve) => serveur.close(resolve));
    }
  });
});
