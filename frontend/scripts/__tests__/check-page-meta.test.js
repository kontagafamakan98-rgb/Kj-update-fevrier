/**
 * Tests du garde « l'app et la coquille pré-rendue publient-elles les mêmes
 * métadonnées ? » (scripts/check-page-meta.js).
 *
 * Ce que ces tests doivent prouver, dans l'ordre d'importance :
 *   • les règles SAVENT échouer — carte écrite en dur, clé i18n écrite en dur,
 *     page qui déclare son texte elle-même, page qui n'annonce RIEN, coquille
 *     qui annonce un autre texte que la table (build périmé) ;
 *   • elles ne se déclenchent PAS là où elles n'ont rien à faire — un
 *     commentaire a le droit de nommer une carte, les tables ont le droit
 *     d'écrire leurs clés, et la fiche /jobs/:id garde son texte de DONNÉE ;
 *   • un périmètre vide (pas de build, pas de src/) est une ERREUR, pas un vert :
 *     c'est le seul faux vert que ce garde pourrait produire.
 *
 * Les cas tournent sur une arborescence temporaire construite depuis la table
 * RÉELLE (src/config/page-meta.js + src/i18n/fr.json) : le dépôt n'est jamais
 * modifié, et une table vide ne pourrait pas faire passer ces tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertPagesAnnounceTheirMeta, runPageMetaCheck } from '../check-page-meta';
import { PAGE_META } from '../../src/config/page-meta';
import { GENERIC_CARD, dedicatedCardsFrom } from '../../src/config/og-cards';

const FRONTEND = path.resolve(__dirname, '..', '..');
const SITE_ORIGIN = 'https://kojoforafrica.cc.cd';

const FR = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'i18n', 'fr.json'), 'utf8'));
// Le manifeste du générateur : la fixture part du VRAI (les cartes réellement
// présentes dans public/) et n'y ajoute que ce que le cas veut éprouver.
const REAL_MANIFEST = JSON.parse(
  fs.readFileSync(path.join(FRONTEND, 'scripts', 'og-assets.manifest.json'), 'utf8')
);

// Page React qui sert chaque route de la table (nom de fichier → nom de
// composant, comme App.js le déclare).
const PAGE_NAMES = {
  '/': 'Home',
  '/jobs': 'Jobs',
  '/login': 'Login',
  '/register': 'Register',
  '/forgot-password': 'ForgotPassword',
  '/payment': 'Payment',
  '/how-it-works': 'HowItWorks',
  '/support': 'Support',
};

const shellFilePath = (route) => (route === '/' ? 'build/index.html' : `build/${route.slice(1)}.html`);

// Cartes déduites du manifeste de la FIXTURE (dédiées + générique).
let fixtureCards = {};

/**
 * Écrit le manifeste de la fixture (le vrai, plus les cartes du cas).
 *
 * @param {string[]} [extraFiles] Cartes ajoutées (présentes dans public/).
 * @param {Array} [baseAssets] Cartes de départ (défaut : les vraies).
 */
const writeManifest = (extraFiles = [], baseAssets = REAL_MANIFEST.assets) => {
  const manifest = {
    ...REAL_MANIFEST,
    assets: [...baseAssets, ...extraFiles.map((file) => ({ file }))],
  };
  write('scripts/og-assets.manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  fixtureCards = dedicatedCardsFrom(manifest.assets.map((asset) => asset.file)).cards;
  return fixtureCards;
};

// Coquille CONFORME, écrite depuis la table réelle et les cartes déduites :
// c'est ce que le build produit, et donc ce que le cas sain doit accepter.
const shellFor = (route) => {
  const keys = PAGE_META[route];
  const card = fixtureCards[route] || GENERIC_CARD;
  const title = FR[keys.title];
  const description = FR[keys.description];
  const image = `${SITE_ORIGIN}${card.image}`;
  const square = `${SITE_ORIGIN}${card.imageSquare}`;
  return (
    `<!DOCTYPE html><html lang="fr"><head>\n` +
    `<title>${title}</title>\n` +
    `<meta name="title" content="${title}" />\n` +
    `<meta name="description" content="${description}" />\n` +
    `<meta property="og:title" content="${title}" />\n` +
    `<meta property="og:description" content="${description}" />\n` +
    `<meta property="og:image" content="${image}" />\n` +
    `<meta property="og:image" content="${square}" />\n` +
    `<meta property="twitter:title" content="${title}" />\n` +
    `<meta property="twitter:description" content="${description}" />\n` +
    `<meta property="twitter:image" content="${image}" />\n` +
    `</head><body><div id="root"></div></body></html>\n`
  );
};

const tempDirs = [];
let root;

const write = (relative, content) => {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
};

/** Arborescence saine : table réelle, App.js, pages, dictionnaire, coquilles. */
const cleanTree = (extraCards = []) => {
  write('src/i18n/fr.json', `${JSON.stringify(FR)}\n`);
  writeManifest(extraCards);
  const lazyLines = [];
  const routeLines = [];
  for (const route of Object.keys(PAGE_META)) {
    const name = PAGE_NAMES[route];
    lazyLines.push(`const ${name} = lazy(() => import('./pages/${name}'));`);
    routeLines.push(`      <Route path="${route}" element={<${name} />} />`);
    write(`src/pages/${name}.js`, `import { usePageMeta } from '../utils/seo';\nusePageMeta();\n`);
    write(shellFilePath(route), shellFor(route));
  }
  // La fiche mission : route HORS table, dont le texte vient de la DONNÉE — la
  // page garde donc les hooks bas niveau (règle B), et sa carte est dynamique.
  lazyLines.push("const JobDetails = lazy(() => import('./pages/JobDetails'));");
  routeLines.push('      <Route path="/jobs/:id" element={<JobDetails />} />');
  write(
    'src/pages/JobDetails.js',
    'import { usePageOpenGraph } from "../utils/seo";\n' +
      'usePageOpenGraph({\n  title: job?.title,\n  image: id ? absoluteUrl(`/api/og/jobs/${id}.png`) : undefined,\n});\n'
  );
  write(
    'src/App.js',
    `import { lazy } from 'react';\n${lazyLines.join('\n')}\n\nexport default function App() {\n  return (\n    <Routes>\n${routeLines.join('\n')}\n    </Routes>\n  );\n}\n`
  );
  write(
    'src/utils/seo.js',
    'export const usePageTitle = (t) => t;\nexport const usePageOpenGraph = (o) => o;\nexport const usePageMeta = () => ({ usePageTitle, usePageOpenGraph });\n'
  );
};

const run = (options = {}) => runPageMetaCheck({ root, quiet: true, ...options });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'page-meta-'));
  tempDirs.push(root);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('check-page-meta — le BUILD refuse (règles A/B/C, aucun artefact requis)', () => {
  // Ces règles sont jouées par `buildStart` du plugin require-page-meta
  // (vite.config.js) : elles ne lisent que les sources, donc le build peut les
  // trancher avant d'écrire quoi que ce soit. Les cas ci-dessous montrent qu'elles
  // SAVENT refuser, et qu'elles n'ont besoin d'aucune coquille pour cela.
  it('accepte une arborescence saine', () => {
    cleanTree();

    expect(() => assertPagesAnnounceTheirMeta({ root })).not.toThrow();
  });

  it('refuse une page de route qui n’annonce AUCUN texte', () => {
    cleanTree();
    write('src/pages/Register.js', 'export default function Register() { return null; }\n');

    expect(() => assertPagesAnnounceTheirMeta({ root })).toThrow(
      /src\/pages\/Register\.js n’appelle pas usePageMeta\(\)/
    );
  });

  it('refuse une page qui déclare son texte elle-même', () => {
    cleanTree();
    write('src/pages/Login.js', "import { usePageTitle } from '../utils/seo';\nusePageTitle('Connexion — Kojo');\n");

    expect(() => assertPagesAnnounceTheirMeta({ root })).toThrow(/utilise usePageTitle\(\)/);
  });

  it('n’a besoin d’AUCUN artefact de build : sans build/, il tranche quand même', () => {
    // C'est là toute la différence avec la CI, qui ne voyait ces règles qu'une
    // fois le build terminé (et donc un pré-déploiement parti).
    cleanTree();
    fs.rmSync(path.join(root, 'build'), { recursive: true, force: true });

    expect(() => assertPagesAnnounceTheirMeta({ root })).not.toThrow();

    write('src/pages/Support.js', 'export default function Support() { return null; }\n');
    expect(() => assertPagesAnnounceTheirMeta({ root })).toThrow(
      /src\/pages\/Support\.js n’appelle pas usePageMeta\(\)/
    );
  });

  it('nomme TOUTES les violations en une fois', () => {
    cleanTree();
    write('src/pages/Register.js', 'export default function Register() { return null; }\n');
    write('src/pages/Payment.js', 'export default function Payment() { return null; }\n');

    let message = '';
    try {
      assertPagesAnnounceTheirMeta({ root });
    } catch (error) {
      message = error.message;
    }

    expect(message).toMatch(/métadonnées de page : 2 problème\(s\)/);
    expect(message).toMatch(/Register\.js n’appelle pas/);
    expect(message).toMatch(/Payment\.js n’appelle pas/);
  });
});

describe('check-page-meta — le cas sain', () => {
  it('accepte des coquilles et des pages qui annoncent exactement la table', () => {
    cleanTree();

    const result = run();

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    // Une coquille par route de la table, et une page qui l'annonce.
    expect(result.checked).toHaveLength(Object.keys(PAGE_META).length);
    expect(result.pages).toHaveLength(Object.keys(PAGE_META).length);
    // Ce qui n'est PAS comparable est nommé, jamais passé sous silence.
    expect(result.notices.join('\n')).toMatch(/\/dashboard|app\.html/);
  });
});

describe('check-page-meta — règle A (aucune déclaration hors table)', () => {
  it('échoue quand une page écrit une carte en dur', () => {
    cleanTree();
    write('src/pages/Jobs.js', "image: absoluteUrl('/og-login.png'),\n");

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /src\/pages\/Jobs\.js:1 écrit la carte « \/og-login\.png » en dur/
    );
  });

  it('échoue quand une page écrit une clé de la table en dur', () => {
    cleanTree();
    write('src/pages/Jobs.js', "usePageTitle(t('jobsMetaTitle'));\n");

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /src\/pages\/Jobs\.js:1 écrit la clé « jobsMetaTitle » en dur/
    );
  });

  it('laisse un COMMENTAIRE nommer une carte', () => {
    cleanTree();
    write('src/pages/Jobs.js', '// la carte /og-jobs.png est écrite par le build\nusePageMeta();\n');

    expect(run().errors).toEqual([]);
  });

  it('laisse les tables elles-mêmes déclarer clés et chemins', () => {
    cleanTree();
    write(
      'src/config/og-cards.js',
      "export const CARDS = { '/jobs': '/og-jobs.png' };\n"
    );
    write('src/config/page-meta.js', "export const PAGE_META = { '/jobs': { title: 'jobsMetaTitle' } };\n");

    expect(run().errors).toEqual([]);
  });
});

describe('check-page-meta — règle B (une seule porte vers les métadonnées)', () => {
  it('échoue quand une page appelle le hook bas niveau', () => {
    cleanTree();
    write('src/pages/Login.js', "import { usePageTitle } from '../utils/seo';\nusePageTitle('Connexion — Kojo');\n");

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/src\/pages\/Login\.js:1 utilise usePageTitle\(\)/);
  });

  it('accepte la fiche mission, dont le texte vient d’une DONNÉE', () => {
    // /jobs/:id n'est PAS dans la table : sa page appelle les hooks bas niveau
    // avec un titre de mission, et c'est légitime (le texte n'existe pas avant
    // la requête). Le cas sain embarque déjà cette page — on vérifie qu'elle ne
    // déclenche rien, et que la règle porte bien sur les autres.
    cleanTree();

    const result = run();

    expect(result.errors).toEqual([]);
    expect(result.pages).toHaveLength(Object.keys(PAGE_META).length);
    expect(result.pages.join('\n')).not.toMatch(/JobDetails/);
  });
});

describe('check-page-meta — règle C (chaque route de la table est annoncée)', () => {
  it('échoue quand une page n’annonce AUCUN texte', () => {
    // Le cas réel : /register, /forgot-password et /payment n'appelaient aucun
    // hook — après une navigation interne, l’onglet gardait le titre précédent.
    cleanTree();
    write('src/pages/Register.js', 'export default function Register() { return null; }\n');

    const result = run();

    expect(result.ok).toBe(false);
    const message = result.errors.join('\n');
    expect(message).toMatch(/la page src\/pages\/Register\.js n’appelle pas usePageMeta\(\)/);
    expect(message).toMatch(/\/register/);
  });

  it('échoue quand la table et le routage ont divergé', () => {
    cleanTree();
    const app = fs.readFileSync(path.join(root, 'src', 'App.js'), 'utf8');
    write('src/App.js', app.replace('      <Route path="/support" element={<Support />} />\n', ''));

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/la route « \/support » .*aucune Route de src\/App\.js/);
  });

  it('échoue quand la page associée à une route n’existe pas', () => {
    cleanTree();
    const app = fs.readFileSync(path.join(root, 'src', 'App.js'), 'utf8');
    write('src/App.js', app.replace("import('./pages/Support')", "import('./pages/SupportAbsent')"));

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/la page « src\/pages\/SupportAbsent\.js ».*introuvable/);
  });
});

describe('check-page-meta — règle D (la coquille annonce la table)', () => {
  it('échoue quand une coquille annonce un AUTRE titre', () => {
    cleanTree();
    const html = fs.readFileSync(path.join(root, 'build', 'login.html'), 'utf8');
    write('build/login.html', html.replace('<title>Connexion — Kojo</title>', '<title>Connexion</title>'));

    const result = run();

    expect(result.ok).toBe(false);
    const message = result.errors.join('\n');
    expect(message).toMatch(/login\.html : <title> annonce « Connexion »/);
    expect(message).toMatch(/deux textes différents/);
  });

  it('échoue quand la description de la coquille a divergé', () => {
    cleanTree();
    const html = fs.readFileSync(path.join(root, 'build', 'support.html'), 'utf8');
    write('build/support.html', html.replace(/name="description" content="[^"]*"/, 'name="description" content="Autre chose"'));

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/support\.html : description annonce « Autre chose »/);
  });

  it('échoue quand le build est PÉRIMÉ (la table a changé depuis le build)', () => {
    // La divergence la plus réaliste : le texte change côté app, la coquille
    // en ligne ne bouge pas — l’app et le HTML servi annoncent deux textes.
    cleanTree();
    const fr = JSON.parse(fs.readFileSync(path.join(root, 'src', 'i18n', 'fr.json'), 'utf8'));
    fr.jobsMetaTitle = 'Emplois — Kojo';
    write('src/i18n/fr.json', `${JSON.stringify(fr, null, 2)}\n`);

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/jobs\.html : <title> annonce « Emplois disponibles — Kojo »/);
  });

  it('échoue quand une route de la table n’a pas de coquille', () => {
    cleanTree();
    fs.rmSync(path.join(root, 'build', 'payment.html'));

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/payment\.html absent/);
  });

  it('échoue quand la clé i18n déclarée par la table n’existe pas', () => {
    cleanTree();
    const fr = JSON.parse(fs.readFileSync(path.join(root, 'src', 'i18n', 'fr.json'), 'utf8'));
    delete fr.supportMetaTitle;
    write('src/i18n/fr.json', `${JSON.stringify(fr, null, 2)}\n`);

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/la clé « supportMetaTitle »,.*absente ou vide/);
  });
});

describe('check-page-meta — non-vacuité', () => {
  it('échoue quand aucun build n’existe', () => {
    cleanTree();
    fs.rmSync(path.join(root, 'build'), { recursive: true, force: true });

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/build\/ absent/);
  });

  it('échoue quand le build ne contient aucune coquille comparable', () => {
    cleanTree();
    for (const route of Object.keys(PAGE_META)) fs.rmSync(path.join(root, shellFilePath(route)));
    write('build/assets/index.js', '// build présent mais sans coquille\n');

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/index\.html absent/);
    expect(result.checked).toEqual([]);
  });

  it('échoue quand la table est vide (aucune route à comparer)', () => {
    // La clause de non-vacuité doit pouvoir échouer : une table vide (ou une
    // dérivation cassée qui la viderait) produirait sinon un vert qui ne porte
    // sur rien. Ici le manifeste ne contient que la carte générique, donc
    // l'absence de route comparée est bien le SEUL défaut.
    cleanTree();
    writeManifest([], []);

    const result = run({ table: {} });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/aucune métadonnée comparée/);
  });

  it('échoue quand App.js ne déclare aucune route reconnue', () => {
    cleanTree();
    write('src/App.js', 'export default function App() { return null; }\n');

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/aucune route reconnue dans src\/App\.js/);
  });

  it('échoue quand src/ est absent (rien à lire)', () => {
    cleanTree();
    fs.rmSync(path.join(root, 'src'), { recursive: true, force: true });

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/src\/ absent/);
  });
});

describe('check-page-meta — le runtime suit la table, route par route', () => {
  it('annonce, pour chaque route publiée, le texte déclaré pour CETTE route', async () => {
    // Le côté « app » de la comparaison : usePageMeta() sans argument lit la route
    // courante. On la fait varier comme le ferait une navigation réelle et on
    // exige, à chaque fois, le texte de la table — jamais celui d’une autre route.
    const { pageMetaKeys } = await import('../../src/config/page-meta');

    const annonces = [];
    for (const route of Object.keys(PAGE_META)) {
      window.history.replaceState({}, '', route);
      const keys = pageMetaKeys();
      expect(keys, `route ${route}`).toEqual(PAGE_META[route]);
      annonces.push(`${route} → ${FR[keys.title]}`);
    }

    // Les routes autrefois muettes, nommées : sans elles, une table vide ferait
    // passer la boucle précédente pour une preuve.
    expect(annonces).toContain('/register → Créer un compte — Kojo');
    expect(annonces).toContain('/forgot-password → Mot de passe oublié — Kojo');
    expect(annonces).toContain('/payment → Paiements sécurisés — Kojo');
  });

  it('ne publie aucun texte pour une route absente de la table', async () => {
    const { pageMetaKeys } = await import('../../src/config/page-meta');
    window.history.replaceState({}, '', '/dashboard');
    expect(pageMetaKeys()).toBe(null);
  });
});

describe('check-page-meta — règle F (les cartes dédiées présentes sont utilisées)', () => {
  it('reprend une carte dédiée ajoutée dans public/, SANS toucher au code', () => {
    // Le but de la déduction : déposer public/og-support.png (+ sa variante
    // carrée) et relancer le build suffit à donner sa carte à /support — plus
    // aucune liste de code à mettre à jour, donc plus rien à oublier.
    cleanTree(['og-support.png', 'og-support-square.png']);

    const result = run();

    expect(result.errors).toEqual([]);
    const shell = fs.readFileSync(path.join(root, 'build', 'support.html'), 'utf8');
    expect(shell).toContain(`${SITE_ORIGIN}/og-support.png`);
    expect(shell).toContain(`${SITE_ORIGIN}/og-support-square.png`);
  });

  it('échoue quand la carte ajoutée n’est régénérée dans aucune coquille', () => {
    // La moitié de l’oubli : la carte existe, l’app la connaît, mais le build
    // (donc le HTML servi) annonce encore la carte générique.
    cleanTree();
    writeManifest(['og-support.png', 'og-support-square.png']);

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /support\.html : og:image annonce « https:\/\/[^»]*og-image-1200x630\.png », la table dit « [^»]*og-support\.png »/
    );
  });

  it('échoue quand une carte dédiée ne sert aucune page pré-rendue', () => {
    cleanTree(['og-dashboard.png', 'og-dashboard-square.png']);

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /la carte dédiée « \/og-dashboard\.png » sert la route « \/dashboard », qui n’est pas pré-rendue/
    );
  });

  it('échoue quand une carte dédiée n’a pas sa variante carrée', () => {
    // Sans la variante 1:1, la page retomberait EN SILENCE sur la carte
    // générique : c’est exactement l’oubli que la déduction doit rendre visible.
    cleanTree(['og-support.png']);

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/public\/og-support\.png n’a pas sa variante carrée/);
    // Et la coquille reste sur la carte générique : pas de og:image cassé.
    const shell = fs.readFileSync(path.join(root, 'build', 'support.html'), 'utf8');
    expect(shell).toContain(`${SITE_ORIGIN}${GENERIC_CARD.image}`);
  });

  it('échoue quand le manifeste des cartes est illisible', () => {
    cleanTree();
    fs.rmSync(path.join(root, 'scripts', 'og-assets.manifest.json'));

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/og-assets\.manifest\.json illisible/);
  });
});

describe('check-page-meta — dépôt réel', () => {
  const hasBuild = fs.existsSync(path.join(FRONTEND, 'build', 'index.html'));

  it.skipIf(!hasBuild)('est vert sur le dépôt construit, coquilles ET pages', () => {
    const result = runPageMetaCheck({ root: FRONTEND, quiet: true });
    expect(result.errors).toEqual([]);
    expect(result.checked.length).toBeGreaterThanOrEqual(Object.keys(PAGE_META).length);
    expect(result.pages.length).toBeGreaterThanOrEqual(Object.keys(PAGE_META).length);
  });
});
