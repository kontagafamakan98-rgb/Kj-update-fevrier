/**
 * La sonde de typographie des pages servies par le backend — ce qu'elle juge,
 * et les mutations qu'elle doit refuser.
 *
 * Pourquoi ces cas existent : la sonde lit ce qu'une PRODUCTION sert, donc elle
 * ne peut pas être éprouvée par un test de bout en bout à chaque commit. Ce qui
 * se teste ici est la partie qui DÉCIDE — la lecture de la feuille, les familles
 * employées, les préchargements, et les trois issues de la ligne de commande —
 * plus une passe entière contre un serveur HTTP réel, pour que le réseau, les
 * en-têtes et la déduplication des fichiers soient exercés sans dépendre de la
 * production.
 */
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FAMILLES,
  MARQUE_PREMISSE,
  PAGE_INTROUVABLE,
  TAILLE_MINIMALE_POLICE,
  facesDeclarees,
  familleDu,
  feuillesDu,
  jugerPage,
  lireBlocs,
  main,
  pagesAJuger,
  parseArguments,
  preloadsDePolice,
  premiereFamille,
  runTypoProbe,
  variablesDe,
} from '../check-typo-pages-production.js';

// ── Deux documents de référence, réduits à ce que la sonde lit ─────────────
// Ils reproduisent la FORME des deux propriétaires réels : les pages ville /
// métier / guide (`backend/kojo_pages_metier.py`, variables `--police-texte` et
// `--police-titre`) et la 404 (`vite-plugins/prerender/not-found.js`, piles
// écrites en clair). Aucun contenu de page n'est recopié : la sonde ne juge pas
// le contenu.
const POLICES = `
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;
font-display:swap;src:url('/fonts/inter-variable-latin.woff2') format('woff2');
unicode-range:U+0000-00FF}
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;
font-display:swap;src:url('/fonts/inter-variable-latin-ext.woff2') format('woff2');
unicode-range:U+0100-02BA}
@font-face{font-family:'Cormorant Garamond';font-style:normal;font-weight:500 700;
font-display:swap;src:url('/fonts/cormorant-garamond-variable-latin.woff2') format('woff2')}
@font-face{font-family:'Cormorant Garamond';font-style:normal;font-weight:500 700;
font-display:swap;src:url('/fonts/cormorant-garamond-variable-latin-ext.woff2') format('woff2')}
`;

const VARIABLES = `
:root{--sable:#fcf8f2;--police-texte:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
--police-titre:'Cormorant Garamond',Georgia,'Times New Roman',serif}
body{margin:0;font-family:var(--police-texte);line-height:1.6}
h1,h2,h3{font-family:var(--police-titre);font-weight:700}
@media(min-width:44rem){.etapes{grid-template-columns:repeat(3,1fr)}}
`;

const PRELOADES =
  '<link rel="preload" as="font" type="font/woff2" href="/fonts/inter-variable-latin.woff2" crossorigin />' +
  '<link rel="preload" as="font" type="font/woff2" href="/fonts/cormorant-garamond-variable-latin.woff2" crossorigin />';

const PAGE_BACKEND = `<!DOCTYPE html><html lang="fr"><head>${PRELOADES}<style>${POLICES}${VARIABLES}</style></head><body><main><h1>Emplois et missions à Abidjan</h1></main></body></html>`;

const STYLE_404 = `
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url('/fonts/inter-variable-latin.woff2') format('woff2')}
@font-face{font-family:'Cormorant Garamond';font-style:normal;font-weight:500 700;font-display:swap;src:url('/fonts/cormorant-garamond-variable-latin.woff2') format('woff2')}
body{margin:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
h1{font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-weight:700}
`;

const PAGE_404 = `<!DOCTYPE html><html lang="fr"><head>${PRELOADES}<style>${STYLE_404}</style></head><body><main><h1>Cette page n'existe pas</h1></main></body></html>`;

const juger = (html, { nom = 'ville /emplois/abidjan', statut = 200, attendu = 200 } = {}) =>
  jugerPage({ nom, url: `https://exemple.test${PAGE_INTROUVABLE}`, statut, attendu, html });

describe('typo pages — la déclaration des pages à juger', () => {
  it('dérive les 45 pages de la déclaration du maillage, sans slug recopié', () => {
    const pages = pagesAJuger();
    // 13 villes + 9 métiers + 23 guides, lus depuis `src/config/liens-seo.js` :
    // une page ajoutée au référentiel arrive ici sans toucher à la sonde.
    expect(pages).toHaveLength(45);
    expect(new Set(pages.map((p) => p.famille))).toEqual(new Set(['villes', 'metiers', 'guides']));
    const prefixes = { villes: '/emplois/', metiers: '/metiers/', guides: '/guides/' };
    for (const page of pages) {
      expect(page.href.startsWith(prefixes[page.famille]), `${page.href} hors de ${prefixes[page.famille]}`).toBe(
        true
      );
      expect(page.nom.trim().length).toBeGreaterThan(2);
    }
  });
});

describe('typo pages — la lecture de la feuille servie', () => {
  it('lit les blocs, y compris ceux imbriqués dans un @media', () => {
    // L'ordre est celui des ACCOLADES FERMÉES : la règle interne sort avant son
    // @media. La sonde s'en moque (elle cherche un SÉLECTEUR), et le cas le dit
    // pour qu'un futur tri ne se croie pas libre de changer le contrat.
    const blocs = lireBlocs('body{color:red}@media(min-width:44rem){.a{b:c}}');
    expect(blocs.map((b) => b.selecteur)).toEqual(['body', '.a', '@media(min-width:44rem)']);
  });

  it('résout une famille écrite par variable, et lit la PREMIÈRE de la pile', () => {
    const blocs = lireBlocs(VARIABLES);
    const variables = variablesDe(blocs);
    expect(variables['--police-titre']).toContain('Cormorant Garamond');
    expect(premiereFamille("var(--police-texte)", variables)).toBe('Inter');
    expect(familleDu(blocs, 'body', variables)).toBe('Inter');
    expect(familleDu(blocs, 'h1', variables)).toBe('Cormorant Garamond');
    // Une pile qui COMMENCE par system-ui peint l'hôte, même si Inter suit.
    expect(premiereFamille('system-ui, "Inter", sans-serif')).toBe('system-ui');
  });

  it('rend les faces déclarées avec les fichiers qu’elles citent', () => {
    const faces = facesDeclarees(lireBlocs(POLICES));
    expect([...faces.keys()]).toEqual([FAMILLES.corps, FAMILLES.titres]);
    expect(faces.get(FAMILLES.corps)).toEqual([
      '/fonts/inter-variable-latin.woff2',
      '/fonts/inter-variable-latin-ext.woff2',
    ]);
  });

  it('lit `crossorigin` comme un attribut, présent ou non', () => {
    expect(preloadsDePolice(PRELOADES).every((p) => p.crossorigin)).toBe(true);
    const sansCors = '<link rel="preload" as="font" href="/fonts/inter-variable-latin.woff2">';
    expect(preloadsDePolice(sansCors)).toEqual([
      { href: '/fonts/inter-variable-latin.woff2', crossorigin: false },
    ]);
  });
});

describe('typo pages — le document jugé', () => {
  it('accepte les deux pages de référence', () => {
    expect(juger(PAGE_BACKEND)).toEqual([]);
    expect(juger(PAGE_404, { nom: '404', statut: 404, attendu: 404 })).toEqual([]);
  });

  it('refuse une coquille React servie à la place de la page', () => {
    // Sans ce refus, un rewrite perdu rendrait l'application React — qui DÉCLARE
    // les deux familles dans son bundle — et la sonde serait verte sur le mauvais
    // document.
    const coquille = PAGE_BACKEND.replace('<main>', '<div id="root"></div><main>');
    expect(juger(coquille).join(' ')).toContain('COQUILLE de l’application'.replace('’', "'"));
  });

  it('refuse un statut inattendu, et ne juge pas la suite', () => {
    const problemes = juger(PAGE_BACKEND, { statut: 404, attendu: 200 });
    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('HTTP 404 au lieu de 200');
  });

  it('refuse un document sans feuille', () => {
    const muet = PAGE_BACKEND.replace(/<style>[\s\S]*?<\/style>/, '');
    expect(juger(muet).join(' ')).toContain('AUCUN <style>');
  });

  it('refuse une famille déclarée mais absente', () => {
    const sansCormorant = PAGE_BACKEND.replace(/@font-face\{font-family:'Cormorant Garamond'[^}]*\}/g, '');
    expect(juger(sansCormorant).join(' ')).toContain('aucun @font-face pour « Cormorant Garamond »');
  });

  it('refuse un corps peint dans la police de l’hôte', () => {
    const muté = PAGE_BACKEND.replace("--police-texte:'Inter'", "--police-texte:'system-ui'");
    expect(juger(muté).join(' ')).toContain('peint son corps en « system-ui »');
  });

  it('refuse un titre qui n’est plus en Cormorant Garamond', () => {
    const muté = PAGE_BACKEND.replace("--police-titre:'Cormorant Garamond'", "--police-titre:'Inter'");
    expect(juger(muté).join(' ')).toContain('peint ses titres (h1) en « Inter »');
  });

  it('refuse un préchargement manquant, ou privé de crossorigin', () => {
    const sansPreload = PAGE_BACKEND.replace(/<link rel="preload"[^>]*>/g, '');
    expect(juger(sansPreload).join(' ')).toContain('ne précharge aucun fichier de « Inter »');

    const sansCors = PAGE_BACKEND.replace(
      'href="/fonts/cormorant-garamond-variable-latin.woff2" crossorigin',
      'href="/fonts/cormorant-garamond-variable-latin.woff2"'
    );
    expect(juger(sansCors).join(' ')).toContain('SANS « crossorigin »');
  });

  it('refuse une police citée hors de /fonts/', () => {
    const muté = PAGE_BACKEND.replace(
      "src:url('/fonts/inter-variable-latin.woff2')",
      "src:url('fonts/inter-variable-latin.woff2')"
    );
    expect(juger(muté).join(' ')).toContain('les polices du site vivent sous /fonts/');
  });
});

// ── Une passe ENTIÈRE contre un serveur HTTP réel ─────────────────────────
// Ce que le réseau ajoute au jugement pur : le statut, le type de contenu, la
// taille des fichiers, et le fait qu'un fichier cité une fois par 45 pages n'est
// demandé QU'UNE fois.

const serveur = ({ html = PAGE_BACKEND, police = 4096, entetes = {} } = {}) => {
  const corps = Buffer.alloc(police, 0x77);
  const requetes = [];
  const srv = http.createServer((req, res) => {
    requetes.push(req.url);
    const url = req.url.split('?')[0];
    if (url.startsWith('/fonts/')) {
      res.writeHead(200, { 'content-type': 'font/woff2', 'content-length': String(corps.length), ...entetes });
      res.end(corps);
      return;
    }
    if (url === PAGE_INTROUVABLE) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end(PAGE_404);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  return { srv, requetes };
};

const demarrer = (configuration) =>
  new Promise((resolve) => {
    const { srv, requetes } = serveur(configuration);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ base: `http://127.0.0.1:${port}`, srv, requetes });
    });
  });

let ouvert = null;
afterEach(async () => {
  if (!ouvert) return;
  await new Promise((resolve) => ouvert.srv.close(resolve));
  ouvert = null;
});

describe('typo pages — la passe entière, sur un serveur réel', () => {
  it('juge les pages, la 404 et les fichiers cités, sans redemander une police', async () => {
    ouvert = await demarrer();
    const resultat = await runTypoProbe({
      base: ouvert.base,
      pages: ['/emplois/abidjan', '/metiers/plomberie', '/guides/prix-plomberie'],
      quiet: true,
    });

    expect(resultat.errors, resultat.errors.join('\n')).toEqual([]);
    expect(resultat.ok).toBe(true);
    expect(resultat.premisse).toBe(false);
    expect(resultat.cout.pages).toBe(4); // trois pages + la 404
    expect(resultat.cout.polices).toBe(4); // les quatre fichiers cités, une fois chacun
    const demandes = ouvert.requetes.filter((u) => u.startsWith('/fonts/'));
    expect(demandes).toHaveLength(4);
    expect(new Set(demandes).size).toBe(4);
  });

  it('refuse un fichier de police qui ne répond pas', async () => {
    ouvert = await demarrer({ police: 0 });
    const resultat = await runTypoProbe({ base: ouvert.base, pages: ['/emplois/abidjan'], quiet: true });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join(' ')).toContain('font-display: swap');
    expect(resultat.errors.join(' ')).toContain('police de l’hôte'.replace('’', "'"));
  });

  it('refuse une page servie en 200 qui est en fait la coquille', async () => {
    const coquille = '<html><head><title>Kojo</title></head><body><div id="root"></div></body></html>';
    ouvert = await demarrer({ html: coquille });
    const resultat = await runTypoProbe({ base: ouvert.base, pages: ['/emplois/abidjan'], quiet: true });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join(' ')).toContain('COQUILLE');
  });

  it('ne rend ni vert ni défaut quand rien n’a pu être lu', async () => {
    const resultat = await runTypoProbe({
      base: 'http://127.0.0.1:1',
      pages: ['/emplois/abidjan'],
      quiet: true,
    });

    expect(resultat.premisse).toBe(true);
    expect(resultat.ok).toBe(false);
    expect(resultat.notices.join(' ')).toContain(MARQUE_PREMISSE);
  });

  it('traite un corpus VIDE comme une prémisse, jamais comme un vert', async () => {
    // `pages: []` ne retombe PAS sur la déclaration (c'est `undefined` qui la
    // lit) : le corpus est réellement vide, et une liste vide ne dit pas
    // « aucune page » mais « la déclaration n'a pas été lue ». Conclure serait
    // le silence que la règle du corpus vide interdit.
    const resultat = await runTypoProbe({ base: 'http://127.0.0.1:1', pages: [], quiet: true });

    expect(resultat.premisse).toBe(true);
    expect(resultat.ok).toBe(false);
    expect(resultat.notices.join(' ')).toContain('aucune page à juger');
  });
});

describe('typo pages — la ligne de commande', () => {
  it('lit --base, --page et --quiet, et ignore une valeur absente', () => {
    expect(parseArguments(['--base', 'https://x.test', '--page', '/emplois/abidjan', '--quiet'])).toEqual({
      base: 'https://x.test',
      pages: ['/emplois/abidjan'],
      quiet: true,
    });
    expect(parseArguments(['--page', ''])).toEqual({ base: '', pages: [], quiet: false });
  });

  it('rend 0, 1 et 2 pour trois issues qui ne se ressemblent pas', async () => {
    const silencieux = { run: async () => ({ ok: true, premisse: false, errors: [], notices: [], checked: [], cout: { pages: 46, polices: 4, requetes: 50, dureeMs: 1 } }), log: () => {}, error: () => {} };
    expect(await main([], silencieux)).toBe(0);

    const defaut = { ...silencieux, run: async () => ({ ok: false, premisse: false, errors: ['un défaut'], notices: [], checked: [], cout: {} }) };
    expect(await main([], defaut)).toBe(1);

    const premisse = { ...silencieux, run: async () => ({ ok: false, premisse: true, errors: ['réseau'], notices: [`${MARQUE_PREMISSE} : rien lu`], checked: [], cout: {} }) };
    expect(await main([], premisse)).toBe(2);
  });

  it('publie le coût de la passe sur un vert, pas seulement le jour du refus', async () => {
    const lignes = [];
    const resultat = { ok: true, premisse: false, errors: [], notices: [], checked: [], cout: { pages: 46, polices: 4, requetes: 50, dureeMs: 1234 } };
    const code = await main([], { run: async () => resultat, log: (l) => lignes.push(String(l)), error: () => {} });

    expect(code).toBe(0);
    const resume = lignes.join('\n');
    expect(resume).toContain('46 page(s)');
    expect(resume).toContain('4 fichier(s) de police');
    expect(resume).toContain('50 requête(s)');
    expect(resume).toContain(`${TAILLE_MINIMALE_POLICE}` === '' ? '' : '1234 ms');
  });
});
