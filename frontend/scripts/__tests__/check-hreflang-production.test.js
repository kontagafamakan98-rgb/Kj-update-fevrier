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
  LANGUE_PAR_DEFAUT,
  alternatesHreflang,
  cheminDansLaLangue,
} from '../../src/config/langues-indexees.js';
import { PAGE_META } from '../../src/config/page-meta.js';
import { GROUPES_LIENS_SEO } from '../../src/config/liens-seo.js';
import { SITE_ORIGIN } from '../site-meta.js';
import {
  CHEMIN_HEALTH,
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
 * Le bloc `langues` que `/health` publierait pour la fixture.
 *
 * Il est DÉRIVÉ du même jeu que le sitemap servi — routes, pages monolingues —
 * donc il dit, par construction, la même chose que lui. Chaque cas en mute un
 * champ pour vérifier le refus qui le nomme : un bloc recopié à la main aurait
 * fait rentrer dans la fixture exactement ce que la sonde doit confronter.
 *
 * Les totaux (`pages.total`, `pages.monolingues`, `urls_par_langue` de la langue
 * par défaut) sont présents, comme dans la vraie réponse, mais la sonde ne les
 * confronte pas : le sitemap servi porte aussi des fiches de mission et des
 * profils travailleurs que le bloc ne décrit pas (voir
 * `mesuresDuBlocLangues`). Un cas le prouve plus bas.
 */
function blocLanguesDe({ routes = ROUTES, monolingues = [MONOLINGUE] } = {}) {
  const codes = LANGUES_INDEXEES.map((langue) => langue.code);
  return {
    indexees: codes,
    defaut: LANGUE_PAR_DEFAUT,
    documents_par_langue: Object.fromEntries(codes.map((code) => [code, routes.length])),
    urls_par_langue: {
      ...Object.fromEntries(codes.map((code) => [code, routes.length])),
      [LANGUE_PAR_DEFAUT]: routes.length + monolingues.length,
    },
    pages: {
      multilingues: routes.length,
      monolingues: monolingues.length,
      total: routes.length * codes.length + monolingues.length,
    },
    alternatives_par_page: alternatesHreflang('/', '').length,
    portee:
      'declaration du sitemap (URL par langue) ; les documents servis se lisent sur l origine du site',
  };
}

/**
 * Le jeu de réponses d'une passe, indexé par URL ABSOLUE.
 *
 * Aucun réseau : chaque cas mute une seule réponse et vérifie le refus qui la
 * nomme. Le cas HTTP réel, plus bas, prouve les URL demandées.
 */
function reponses({
  pages = {},
  sitemap = sitemapDe(),
  sante = { statut: 200, corps: JSON.stringify({ status: 'ok', langues: blocLanguesDe() }) },
} = {}) {
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
  parUrl.set(`${BASE}${CHEMIN_HEALTH}`, sante);
  return async (url) => {
    const reponse = parUrl.get(url);
    if (!reponse) throw new Error(`URL inattendue : ${url}`);
    return { status: reponse.statut, text: async () => reponse.corps };
  };
}

// `healthBase` : `/health` vit sur l'origine du backend en production (le site
// ne le proxifie pas). La fixture sert tout depuis la même origine.
const lancer = (options = {}) =>
  runHreflangProbe({ base: BASE, healthBase: BASE, fetchImpl: reponses(options), quiet: true });

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
    // Les documents, le sitemap, ET le bloc `langues` de /health : le coût dit
    // aussi ce que la passe a confronté.
    expect(resultat.cout.requetes).toBe(ROUTES.length * LANGUES_INDEXEES.length + 2);
    expect(resultat.checked.join('\n')).toContain('sitemap');
    expect(resultat.checked.join('\n')).toContain('bloc langues de /health');
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
    // Le compte attendu se DÉRIVE de la déclaration, il ne se recopie pas : il
    // valait « 3 » du temps des deux langues indexées (fr, en, x-default), et
    // une liste figée aurait rendu ce cas VERT le jour où une troisième langue
    // a rejoint la famille — sur une liste amputée, donc. Mesuré le 01/11/2026 :
    // cinq langues indexées, l'attendu vaut 6.
    const attendues = alternatesHreflang('/jobs', SITE_ORIGIN).length;
    expect(attendues).toBe(LANGUES_INDEXEES.length + 1); // la famille + x-default
    expect(messages).toMatch(new RegExp(`1 alternative\\(s\\) hreflang au lieu de ${attendues}`));
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

describe('bloc langues de /health — confronté à ce qui est servi', () => {
  const sante = (bloc) => ({ statut: 200, corps: JSON.stringify({ status: 'ok', langues: bloc }) });

  it('refuse un bloc qui n’annonce pas les langues du site', async () => {
    // Le cas mesuré qui motive la lecture : un backend déployé en retard annonce
    // deux langues pendant que le frontend en sert cinq. Les deux réponses sont
    // « vraies » prises séparément, et rien d'autre ne le dit.
    const amputees = LANGUES_INDEXEES.slice(0, 2).map((langue) => langue.code);
    const resultat = await lancer({ sante: sante({ ...blocLanguesDe(), indexees: amputees }) });

    expect(resultat.ok).toBe(false);
    const messages = resultat.errors.join('\n');
    expect(messages).toMatch(/annonce 2 langue\(s\) indexée\(s\)/);
    expect(messages).toContain(amputees.join(', '));
    expect(messages).toContain(LANGUES_INDEXEES.map((langue) => langue.code).join(', '));
    expect(messages).toContain('backend en retard sur le frontend');
  });

  it('refuse un bloc qui déclare une AUTRE langue par défaut', async () => {
    const autre = LANGUES_INDEXEES.find((langue) => langue.prefixe).code;
    const resultat = await lancer({ sante: sante({ ...blocLanguesDe(), defaut: autre }) });

    expect(resultat.ok).toBe(false);
    const messages = resultat.errors.join('\n');
    expect(messages).toMatch(new RegExp(`« ${autre} » comme langue par défaut`));
    expect(messages).toContain(LANGUE_PAR_DEFAUT);
  });

  it('refuse un nombre de documents qui ne suit pas le sitemap servi', async () => {
    const bloc = blocLanguesDe();
    const cible = LANGUES_INDEXEES.find((langue) => langue.prefixe).code;
    const resultat = await lancer({
      sante: sante({
        ...bloc,
        documents_par_langue: { ...bloc.documents_par_langue, [cible]: 3 },
      }),
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(
      new RegExp(`annonce 3 document\\(s\\) en « ${cible} », le sitemap servi en énumère ${ROUTES.length}`)
    );
  });

  it('refuse un nombre d’URL qui ne suit pas les entrées d’une langue préfixée', async () => {
    const bloc = blocLanguesDe();
    const cible = LANGUES_INDEXEES[LANGUES_INDEXEES.length - 1].code;
    const resultat = await lancer({
      sante: sante({ ...bloc, urls_par_langue: { ...bloc.urls_par_langue, [cible]: 2 } }),
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(
      new RegExp(`annonce 2 URL en « ${cible} », le sitemap servi en énumère ${ROUTES.length}`)
    );
  });

  it('refuse un nombre de pages multilingues qui ne suit pas le sitemap', async () => {
    const bloc = blocLanguesDe();
    const resultat = await lancer({
      sante: sante({ ...bloc, pages: { ...bloc.pages, multilingues: 4 } }),
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/annonce 4 page\(s\) multilingue\(s\)/);
  });

  it('refuse un nombre d’alternatives par page qui ne suit pas les documents', async () => {
    const resultat = await lancer({
      sante: sante({ ...blocLanguesDe(), alternatives_par_page: 9 }),
    });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/annonce 9 alternative\(s\) par page/);
  });

  it('refuse un /health qui répond 200 sans publier le bloc', async () => {
    // Sans bloc, il n'y a RIEN à confronter : c'est un refus nommé (la révision
    // déployée est antérieure au 01/11/2026), pas une prémisse — le /health a
    // répondu, il ne publie simplement pas le fait.
    const resultat = await lancer({ sante: { statut: 200, corps: JSON.stringify({ status: 'ok' }) } });

    expect(resultat.premisse).toBe(false);
    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toContain('ne publie pas de bloc « langues »');
  });

  it('ne rougit PAS sur les fiches de mission, que le bloc ne compte pas', async () => {
    // Le sitemap porte aussi des fiches `/jobs/:id` et des profils `/workers/:id`
    // (écrits en français, sans alternative). Le bloc ne les décrit pas : les
    // compter ferait rougir la sonde sur du contenu qu'il n'a jamais prétendu
    // décrire. C'est la raison pour laquelle les TOTAUX ne sont pas confrontés,
    // et ce cas est la preuve que la limite est tenue.
    const avecFiche = sitemapDe().replace(
      '</urlset>',
      `<url><loc>${SITE_ORIGIN}/jobs/abc123</loc><changefreq>daily</changefreq></url></urlset>`
    );

    const resultat = await lancer({ sitemap: avecFiche });

    expect(resultat.errors).toEqual([]);
    expect(resultat.ok).toBe(true);
    expect(resultat.premisse).toBe(false);
  });

  it('un /health illisible est une prémisse, jamais un vert', async () => {
    const fetchImpl = reponses();
    const resultat = await runHreflangProbe({
      base: BASE,
      healthBase: BASE,
      quiet: true,
      fetchImpl: async (url, options) => {
        if (url.endsWith(CHEMIN_HEALTH)) throw new Error('ETIMEDOUT');
        return fetchImpl(url, options);
      },
    });

    expect(resultat.premisse).toBe(true);
    expect(resultat.ok).toBe(false);
    expect(resultat.notices.join(' ')).toContain(CHEMIN_HEALTH);
  });

  it('un /health qui répond 500 est une prémisse', async () => {
    const resultat = await lancer({ sante: { statut: 500, corps: 'boom' } });

    expect(resultat.premisse).toBe(true);
    expect(resultat.ok).toBe(false);
    expect(resultat.notices.join(' ')).toContain('HTTP 500');
  });

  it('un corps qui n’est pas du JSON est une prémisse', async () => {
    const resultat = await lancer({ sante: { statut: 200, corps: '<html>proxy</html>' } });

    expect(resultat.premisse).toBe(true);
    expect(resultat.ok).toBe(false);
    expect(resultat.notices.join(' ')).toContain("n'est pas du JSON");
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

  it('rend 1 quand le bloc de /health contredit le site servi', async () => {
    // Le verdict est éprouvé sur une VRAIE passe (fetch injecté), pas sur un
    // objet fabriqué : c'est la contradiction qui doit rendre 1.
    const resultat = await lancer({
      sante: {
        statut: 200,
        corps: JSON.stringify({ status: 'ok', langues: { ...blocLanguesDe(), indexees: ['fr'] } }),
      },
    });
    expect(resultat.premisse).toBe(false);
    expect(resultat.ok).toBe(false);

    const lignes = [];
    const code = await main([], {
      run: async () => resultat,
      log: (ligne) => lignes.push(ligne),
      error: (ligne) => lignes.push(ligne),
    });

    expect(code).toBe(1);
    expect(lignes.join('\n')).toContain('langues');
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
      if (chemin === CHEMIN_HEALTH) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', langues: blocLanguesDe() }));
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
        // `/health` vit sur l'origine du backend : la fixture le sert depuis la
        // même, et le cas prouve que la passe le DEMANDE.
        healthBase: `http://127.0.0.1:${port}`,
        quiet: true,
      });

      expect(resultat.errors).toEqual([]);
      expect(resultat.ok).toBe(true);
      expect(demandes).toHaveLength(ROUTES.length * LANGUES_INDEXEES.length + 2);
      expect(demandes).toContain(CHEMIN_HEALTH);
      expect(new Set(demandes).size).toBe(demandes.length);
    } finally {
      await new Promise((resolve) => serveur.close(resolve));
    }
  });
});
