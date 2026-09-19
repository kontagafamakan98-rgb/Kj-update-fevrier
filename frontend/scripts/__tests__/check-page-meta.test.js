/**
 * Tests du garde « l'app et la coquille pré-rendue publient-elles les mêmes
 * métadonnées ? » (scripts/check-page-meta.js).
 *
 * Ce que ces tests doivent prouver, dans l'ordre d'importance :
 *   • les règles SAVENT échouer — carte écrite en dur, clé i18n écrite en dur,
 *     page qui déclare son texte elle-même, page qui n'annonce RIEN, coquille
 *     qui annonce un autre texte que la table (build périmé) ou une autre carte,
 *     clé de page absente d'une des langues publiées, route déclarée à la fois
 *     par une carte OG et par la table écrite à la main ;
 *   • elles ne se déclenchent PAS là où elles n'ont rien à faire — un
 *     commentaire a le droit de nommer une carte, les tables ont le droit
 *     d'écrire leurs clés, et la fiche /jobs/:id garde son texte de DONNÉE ;
 *   • un périmètre vide (pas de build, pas de src/) est une ERREUR, pas un vert :
 *     c'est le seul faux vert que ce garde pourrait produire.
 *
 * Les cas tournent sur une arborescence temporaire construite depuis la table
 * RÉELLE (src/config/page-meta.js) et les dictionnaires RÉELS des langues que
 * src/contexts/LanguageContext.js publie : le dépôt n'est jamais modifié, et une
 * table vide ne pourrait pas faire passer ces tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  assertPagesAnnounceTheirMeta,
  readPublishedLanguages,
  requirePageMeta,
  runPageMetaCheck,
} from '../check-page-meta';
import { DECLARED_PAGE_META, PAGE_META } from '../../src/config/page-meta';
import { CARDS_BY_ROUTE, CARD_PAGE_META, GENERIC_CARD } from '../../src/config/og-cards';
import { shellFileFor } from '../site-meta';

const FRONTEND = path.resolve(__dirname, '..', '..');
const SITE_ORIGIN = 'https://kojoforafrica.cc.cd';

// Les langues publiées sont LISES dans src/contexts/LanguageContext.js : la
// fixture n'en recopie pas la liste, elle écrit les dictionnaires des mêmes
// langues. Une liste recopiée ici pourrait passer au vert en testant des langues
// que l'application ne charge pas.
const LANGUAGE_NAMES = readPublishedLanguages(FRONTEND);
const REAL_DICTS = Object.fromEntries(
  LANGUAGE_NAMES.map((language) => [
    language,
    JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'i18n', `${language}.json`), 'utf8')),
  ])
);
const FR = REAL_DICTS.fr;

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

// La correspondance route → fichier est celle du build et des gardes
// (scripts/site-meta.js) : la fixture ne la redéclare pas, elle l'importe.
const shellFilePath = (route) => `build/${shellFileFor(route)}`;

// La fixture n'écrit AUCUN manifeste : les cartes ne se déduisent plus des
// fichiers déduits dans public/, elles sont déclarées par les fichiers de données
// et servies par src/config/og-cards.js — le même module pour le build, le runtime
// et ce garde (check-og-assets.js, lui, lit le manifeste : c'est son sujet).

// Coquille CONFORME, écrite depuis la table réelle et les cartes déclarées :
// c'est ce que le build produit, et donc ce que le cas sain doit accepter.
const shellFor = (route) => {
  const keys = PAGE_META[route];
  const card = CARDS_BY_ROUTE[route] || GENERIC_CARD;
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

const writeDict = (language, dictionary) =>
  write(`src/i18n/${language}.json`, `${JSON.stringify(dictionary)}\n`);

/**
 * Arborescence saine : table réelle, App.js, pages, dictionnaires des langues
 * publiées, coquilles.
 */
const cleanTree = () => {
  write(
    'src/contexts/LanguageContext.js',
    `const LANGUAGES = [${LANGUAGE_NAMES.map((language) => `'${language}'`).join(', ')}];\n`
  );
  for (const [language, dictionary] of Object.entries(REAL_DICTS)) writeDict(language, dictionary);
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

describe('check-page-meta — la CAPACITÉ du plugin de build (le branchement est testé à part)', () => {
  // Le plugin que vite.config.js installe, monté sur une arborescence où la
  // violation existe : le refus du build est exercé à chaque `npx vitest run`,
  // au lieu de la mutation faite à la main (muter une page, `npm run build`,
  // restaurer). Le BRANCHEMENT lui-même — vite.config.js installe bien ce plugin
  // en mode build — appartient à scripts/__tests__/check-page-meta-build-wiring.test.js,
  // qui doit tourner en environnement Node (il importe la config, donc esbuild).

  it('monté sur une page qui n’annonce RIEN, il refuse', () => {
    cleanTree();
    const plugin = requirePageMeta({ root });

    expect(() => plugin.buildStart()).not.toThrow();

    write('src/pages/Register.js', 'export default function Register() { return null; }\n');

    expect(() => plugin.buildStart()).toThrow(/Register\.js n’appelle pas usePageMeta\(\)/);
  });

  it('monté sur une traduction de page absente, il refuse', () => {
    cleanTree();
    const plugin = requirePageMeta({ root });
    const wo = { ...REAL_DICTS.wo };
    delete wo.supportMetaDescription;
    writeDict('wo', wo);

    expect(() => plugin.buildStart()).toThrow(
      /src\/i18n\/wo\.json : la clé « supportMetaDescription »/
    );
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

});

describe('check-page-meta — règle G (chaque texte de page existe dans chaque langue publiée)', () => {
  it('le BUILD refuse une clé de page absente du dictionnaire FRANÇAIS', () => {
    // Le cas que portait la règle D, qui ne lisait que fr : c'est la règle G qui
    // le porte désormais, pour le français comme pour les autres langues.
    cleanTree();
    const fr = { ...FR };
    delete fr.supportMetaTitle;
    writeDict('fr', fr);

    expect(() => assertPagesAnnounceTheirMeta({ root })).toThrow(
      /src\/i18n\/fr\.json : la clé « supportMetaTitle » \(titre de la route « \/support »\) est absente/
    );
  });

  it('le BUILD refuse une clé de page absente d’une SEULE des langues', () => {
    cleanTree();
    const wo = { ...REAL_DICTS.wo };
    delete wo.supportMetaDescription;
    writeDict('wo', wo);

    expect(() => assertPagesAnnounceTheirMeta({ root })).toThrow(
      /src\/i18n\/wo\.json : la clé « supportMetaDescription » \(description de la route « \/support »\) est absente/
    );
  });

  it('le BUILD refuse une traduction VIDE (clé présente, texte absent)', () => {
    cleanTree();
    writeDict('mos', { ...REAL_DICTS.mos, jobsMetaTitle: '   ' });

    expect(() => assertPagesAnnounceTheirMeta({ root })).toThrow(
      /src\/i18n\/mos\.json : la clé « jobsMetaTitle » \(titre de la route « \/jobs »\) est vide/
    );
  });

  it('suit la liste de LanguageContext.js : une langue ajoutée LÀ est vérifiée', () => {
    cleanTree();
    write(
      'src/contexts/LanguageContext.js',
      `const LANGUAGES = [${LANGUAGE_NAMES.map((l) => `'${l}'`).join(', ')}, 'xx'];\n`
    );
    const xx = { ...FR };
    delete xx.homeMetaTitle;
    writeDict('xx', xx);

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/src\/i18n\/xx\.json : la clé « homeMetaTitle »/);
  });

  it('échoue quand une langue publiée n’a pas de dictionnaire', () => {
    cleanTree();
    fs.rmSync(path.join(root, 'src', 'i18n', 'en.json'));

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/src\/i18n\/en\.json illisible .*« en » est publiée/);
  });

  it('échoue quand un dictionnaire n’est chargé par aucune langue publiée', () => {
    cleanTree();
    writeDict('de', FR);

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /src\/i18n\/de\.json existe mais aucune langue publiée ne le charge/
    );
  });

  it('échoue quand la liste des langues est illisible — jamais un vert par vacuité', () => {
    cleanTree();
    write('src/contexts/LanguageContext.js', "export const OTHER = ['fr'];\n");

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/LanguageContext\.js ne déclare aucune « const LANGUAGES/);
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
    // sur rien. Aucune route comparée n'est alors le SEUL défaut.
    cleanTree();

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

// L'ancienne règle F (« les cartes dédiées présentes sont complètes ET
// utilisées ») a disparu avec la convention de nom qu'elle surveillait : un
// fichier de carte déclare sa route et ses DEUX sorties (le générateur et
// check-og-assets.js refusent un champ manquant), et sa route entre dans la table
// des textes par construction — donc la règle C la tient à une page réelle. Ce qui
// restait à prouver côté carte, c'est le contrat avec le BUILD
// (og:image annoncée par la coquille) et la règle H, ci-dessous.
describe('check-page-meta — la carte annoncée, et une seule déclaration par route', () => {
  it('échoue quand une coquille annonce une autre carte que la table', () => {
    // Le cas « build périmé », côté image : la coquille a été écrite avant que la
    // route change de carte, donc elle en annonce une que la table ne dit plus.
    cleanTree();
    const shellPath = path.join(root, shellFilePath('/support'));
    const stale = fs
      .readFileSync(shellPath, 'utf8')
      .replaceAll(`${SITE_ORIGIN}/og-image-1200x630.png`, `${SITE_ORIGIN}/og-support.png`);
    fs.writeFileSync(shellPath, stale, 'utf8');

    const result = run();

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(
      /support\.html : og:image annonce « https:\/\/[^»]*og-support\.png », la table dit « [^»]*og-image-1200x630\.png »/
    );
  });

  it('refuse une route déclarée À LA FOIS par une carte et par la table écrite à la main', () => {
    // La carte DESSINE le titre et la description de sa page : les déclarer aussi
    // dans src/config/page-meta.js ferait gagner la carte EN SILENCE, donc
    // corriger la ligne manuelle ne changerait rien. Le cas est injecté — la table
    // écrite à la main est un paramètre, comme `table` l'est pour une table vide :
    // le dépôt réel n'a pas ce défaut, et c'est ce que le cas suivant vérifie.
    cleanTree();

    const result = run({ declaredMeta: { '/jobs': { title: 'x', description: 'y' } } });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/la route « \/jobs » déclare ses textes DEUX fois/);
  });

  it('n’a rien à redire sur les deux tables du DÉPÔT (aucune route à carte déclarée deux fois)', () => {
    const overlap = Object.keys(DECLARED_PAGE_META).filter((route) =>
      Object.hasOwn(CARD_PAGE_META, route)
    );
    expect(overlap).toEqual([]);
  });
});

// Le dépôt construit n'est pas rejoué ici : l'étape « Check page meta agrees » de
// la CI le fait juste après le build, sur les mêmes artefacts.
