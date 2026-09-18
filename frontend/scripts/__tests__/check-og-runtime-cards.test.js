/**
 * Tests du garde « l'app et la coquille pré-rendue annoncent-elles la même carte
 * OG ? » (scripts/check-og-runtime-cards.js).
 *
 * Ce que ces tests doivent prouver, dans l'ordre d'importance :
 *   • les trois règles SAVENT échouer (carte en dur dans une page, page qui
 *     passe une autre route, coquille qui annonce une autre carte) ;
 *   • elles ne se déclenchent PAS là où elles n'ont rien à faire — un
 *     commentaire a le droit de nommer une carte, la table a le droit de la
 *     définir, et `ogCardUrl()` sans argument est la bonne forme ;
 *   • un périmètre vide (pas de build, aucune coquille) est une ERREUR, pas un
 *     vert : c'est le seul faux vert que ce garde pourrait produire.
 *
 * Les cas tournent sur une arborescence temporaire ; le dépôt n'est jamais
 * modifié. Le cas « dépôt réel » ne s'exécute que si un build est présent
 * (`npm test` tourne AVANT `npm run build` en CI).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runOgRuntimeCardsCheck } from '../check-og-runtime-cards';

const FRONTEND = path.resolve(__dirname, '..', '..');
const SITE_ORIGIN = 'https://kojoforafrica.cc.cd';

const SHELL = (wide, square = null) =>
  `<!DOCTYPE html><html><head>\n` +
  `<meta property="og:image" content="${wide}" />\n` +
  `<meta property="og:image:width" content="1200" />\n` +
  (square
    ? `<meta property="og:image" content="${square}" />\n<meta property="og:image:width" content="1200" />\n`
    : '') +
  `</head><body><div id="root"></div></body></html>\n`;

const tempDirs = [];
let root;

const write = (relative, content) => {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
};

// Build MINIMAL mais suffisant : les deux coquilles qui ont une carte dédiée,
// et l'accueil (carte générique). Les autres routes deviennent des notices —
// ce qui est aussi le comportement à vérifier.
const cleanBuild = () => {
  write('build/index.html', SHELL(`${SITE_ORIGIN}/og-image-1200x630.png`, `${SITE_ORIGIN}/og-square-1200x1200.png`));
  write('build/login.html', SHELL(`${SITE_ORIGIN}/og-login.png`, `${SITE_ORIGIN}/og-login-square.png`));
  write('build/jobs.html', SHELL(`${SITE_ORIGIN}/og-jobs.png`, `${SITE_ORIGIN}/og-jobs-square.png`));
};

const run = (options = {}) => runOgRuntimeCardsCheck({ root, quiet: true, ...options });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-runtime-'));
  tempDirs.push(root);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('check-og-runtime-cards — le cas sain', () => {
  it('accepte des coquilles qui annoncent exactement les cartes de la table', () => {
    cleanBuild();
    write('src/pages/Login.js', "import { ogCardUrl } from '../utils/seo';\nimage: ogCardUrl(),\n");
    write('src/utils/seo.js', 'export const ogCardUrl = (route) => route;\n');

    const result = run();

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.checked).toHaveLength(3);
    // Les routes sans coquille sont NOMMÉES, pas passées sous silence.
    expect(result.notices.join('\n')).toMatch(/\/dashboard|app\.html/);
  });
});

describe('check-og-runtime-cards — règle A (aucune carte en dur dans src/)', () => {
  it('échoue quand une page écrit une carte en dur', () => {
    cleanBuild();
    write('src/pages/Jobs.js', "image: ogImageUrl('/og-login.png'),\n");

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /src\/pages\/Jobs\.js:1 écrit la carte « \/og-login\.png » en dur/
    );
  });

  it("laisse un COMMENTAIRE nommer une carte (le contexte chaîne compte)", () => {
    cleanBuild();
    write('src/pages/Jobs.js', '// la carte /og-jobs.png est écrite par le build\nimage: ogCardUrl(),\n');

    expect(run().errors).toEqual([]);
  });

  it('laisse la table elle-même définir les chemins', () => {
    cleanBuild();
    write(
      'src/config/og-cards.js',
      "export const DEDICATED_CARDS = { '/jobs': { image: '/og-jobs.png', imageSquare: '/og-jobs-square.png' } };\n"
    );

    expect(run().errors).toEqual([]);
  });
});

describe('check-og-runtime-cards — règle B (la carte suit l’URL courante)', () => {
  it('échoue quand une page passe explicitement une route', () => {
    cleanBuild();
    write('src/pages/Login.js', "image: ogCardUrl('/jobs'),\n");

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/appelle ogCardUrl\('\/jobs'\)/);
  });

  it('ne dit rien hors des pages (utilitaires, composants)', () => {
    cleanBuild();
    write('src/utils/seo.js', "export const x = ogCardUrl('/jobs');\n");

    expect(run().errors).toEqual([]);
  });

  it('échoue quand une page annonce des méta OG SANS carte', () => {
    // Le cas réel : quelqu’un retire la ligne `image:` — le hook retombe alors
    // sur le favicon et le runtime n’annonce plus ce que la coquille annonce.
    cleanBuild();
    write(
      'src/pages/Login.js',
      "usePageOpenGraph({ title: t('loginMetaTitle'), description: t('loginMetaDescription') });\n"
    );

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/annonce des méta OG sans carte dérivée de la table/);
  });

  it('accepte la carte DYNAMIQUE d’une mission (hors table des routes statiques)', () => {
    cleanBuild();
    write(
      'src/pages/JobDetails.js',
      'usePageOpenGraph({\n  title: t("jobMetaTitle"),\n  image: id ? ogImageUrl(`/api/og/jobs/${id}.png`) : undefined,\n});\n'
    );

    expect(run().errors).toEqual([]);
  });
});

describe('check-og-runtime-cards — règle C (la coquille porte la carte de la table)', () => {
  it('échoue quand la coquille annonce une AUTRE carte que la table', () => {
    cleanBuild();
    // Cas réel : l'app change de carte, la coquille n'est pas régénérée.
    write('build/login.html', SHELL(`${SITE_ORIGIN}/og-image-1200x630.png`, `${SITE_ORIGIN}/og-square-1200x1200.png`));

    const result = run();

    expect(result.ok).toBe(false);
    const message = result.errors.join('\n');
    expect(message).toMatch(/login\.html/);
    expect(message).toMatch(/publieraient deux cartes différentes/);
    expect(message).toContain(`${SITE_ORIGIN}/og-login.png`);
  });

  it('échoue quand la variante carrée manque', () => {
    cleanBuild();
    write('build/jobs.html', SHELL(`${SITE_ORIGIN}/og-jobs.png`));

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/variante carrée « \(absente\) »/);
  });
});

describe('check-og-runtime-cards — non-vacuité', () => {
  it('échoue quand aucun build n’existe', () => {
    write('src/pages/Login.js', 'image: ogCardUrl(),\n');

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/build\/ absent/);
  });

  it('échoue quand le build ne contient aucune coquille comparable', () => {
    write('build/assets/index.js', '// build présent mais sans coquille\n');
    write('src/pages/Login.js', 'image: ogCardUrl(),\n');

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/aucune coquille comparée/);
  });

  it('échoue quand src/ est absent (rien à lire)', () => {
    cleanBuild();

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/src\/ absent/);
  });
});

describe('check-og-runtime-cards — le runtime suit la table, route par route', () => {
  it('annonce, pour chaque page du projet, la carte déclarée pour CETTE route', async () => {
    // Le côté "app" de la comparaison : `ogCardUrl()` sans argument lit la route
    // courante. On la fait varier comme le ferait une navigation réelle et on
    // exige, à chaque fois, la carte de la table — jamais celle d'une autre
    // route, jamais une URL cassée.
    const { ROUTES } = await import('../check-og-images');
    const { ogCardFor } = await import('../../src/config/og-cards');
    const { ogCardUrl } = await import('../../src/utils/seo');

    const annonces = [];
    for (const route of ROUTES) {
      window.history.replaceState({}, '', route.path);
      const annonce = new URL(ogCardUrl()).pathname;
      expect(annonce, `route ${route.path}`).toBe(ogCardFor(route.path).image);
      annonces.push(`${route.path} → ${annonce}`);
    }

    // Les deux routes qui annoncent une carte DÉDIÉE, nommées : sans elles, une
    // table vide ferait passer la boucle précédente pour une preuve.
    expect(annonces).toContain('/jobs → /og-jobs.png');
    expect(annonces).toContain('/login → /og-login.png');
    expect(annonces).toContain('/ → /og-image-1200x630.png');
  });

  it('retombe sur la carte générique pour une route inconnue du projet', async () => {
    const { GENERIC_CARD } = await import('../../src/config/og-cards');
    const { ogCardUrl } = await import('../../src/utils/seo');
    window.history.replaceState({}, '', '/jobs/aaaa1111-bbbb-4222-8333-cccc44445555');
    expect(new URL(ogCardUrl()).pathname).toBe(GENERIC_CARD.image);
  });
});

describe('check-og-runtime-cards — dépôt réel', () => {
  const hasBuild = fs.existsSync(path.join(FRONTEND, 'build', 'index.html'));

  it.skipIf(!hasBuild)('est vert sur le dépôt construit', () => {
    const result = runOgRuntimeCardsCheck({ root: FRONTEND, quiet: true });
    expect(result.errors).toEqual([]);
    expect(result.checked.length).toBeGreaterThanOrEqual(7);
  });
});
