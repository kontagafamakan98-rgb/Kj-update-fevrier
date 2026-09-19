import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEV_ONLY_ROUTES,
  JOB_REWRITE_SOURCE,
  JOB_REWRITE_SUFFIX,
  SPA_CATCH_ALL,
  SPA_INDEX,
  findShadowedRules,
  matchesPattern,
  parseAppRoutes,
  patternToRegex,
  privateRoutesOf,
  runSpaRoutesCheck,
} from '../check-spa-routes';

// Tests du garde-fou « routage de la SPA » :
//   • le rewrite « /jobs/(.*) » doit mener à « /api/og/jobs/$1 » (la route que
//     le backend déclare) et viser le MÊME backend que le proxy /api ;
//   • AUCUN catch-all « /(.*) » : c'est lui qui faisait répondre 200 à toute
//     URL inconnue (soft 404) ;
//   • chaque route de production de App.js est routée, les deux formes
//     (/route et /route/) — une route non routée répond 404 en production ;
//   • une règle exacte placée après une règle à motif qui la capture est
//     inatteignable (le bug réel : /jobs/ après /jobs/(.*) → 404 JSON) ;
//   • une page ni déclarée publique (ses textes dans src/config/page-meta.js)
//     ni déclarée privée (X-Robots-Tag) fait ÉCHOUER le garde, qui demande
//     explicitement laquelle des deux elle est ;
//   • les routes gardées par import.meta.env.DEV ne sont pas routées ;
//   • un vercel.json absent/illisible, un 404.html manquant ou indexable, une
//     route backend disparue : tout cela ÉCHOUE.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const APP_SOURCE = `import { Route } from 'react-router-dom';
function R() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/how-it-works" element={<HowItWorks />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/payment" element={<Payment />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/jobs" element={<Jobs />} />
      <Route path="/jobs/:id" element={<JobDetails />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/support" element={<Support />} />
      {import.meta.env.DEV && (
        <>
          <Route path="/mobile-test" element={
            <MobileTest />
          } />
          <Route path="/photo-test" element={
            <PhotoTest />
          } />
        </>
      )}
      <Route path="/photo-debug" element={<PhotoTest />} />
    </Routes>
  );
}
`;

/** Routage conforme de référence : celui du dépôt, réduit au nécessaire. */
const CONFORMING_REWRITES = [
  { source: '/jobs', destination: '/jobs.html' },
  { source: '/jobs/', destination: '/jobs.html' },
  { source: JOB_REWRITE_SOURCE, destination: `https://api.kojoforafrica.cc.cd${JOB_REWRITE_SUFFIX}` },
  { source: '/api/:path*', destination: 'https://api.kojoforafrica.cc.cd/api/:path*' },
  { source: '/sitemap.xml', destination: 'https://api.kojoforafrica.cc.cd/api/sitemap.xml' },
  { source: '/robots.txt', destination: 'https://api.kojoforafrica.cc.cd/api/robots.txt' },
  { source: '/login', destination: '/login.html' },
  { source: '/login/', destination: '/login.html' },
  { source: '/register', destination: '/register.html' },
  { source: '/register/', destination: '/register.html' },
  { source: '/forgot-password', destination: '/forgot-password.html' },
  { source: '/forgot-password/', destination: '/forgot-password.html' },
  { source: '/payment', destination: '/payment.html' },
  { source: '/payment/', destination: '/payment.html' },
  { source: '/how-it-works', destination: '/how-it-works.html' },
  { source: '/how-it-works/', destination: '/how-it-works.html' },
  { source: '/dashboard', destination: '/app.html' },
  { source: '/dashboard/', destination: '/app.html' },
  { source: '/profile', destination: '/app.html' },
  { source: '/profile/', destination: '/app.html' },
  { source: '/photo-debug', destination: '/app.html' },
  { source: '/photo-debug/', destination: '/app.html' },
  { source: '/support', destination: '/support.html' },
  { source: '/support/', destination: '/support.html' },
];

/** En-têtes de référence : les routes privées ne sont pas indexables. */
const CONFORMING_HEADERS = [
  { source: '/dashboard', headers: [{ key: 'X-Robots-Tag', value: 'noindex, follow' }] },
  { source: '/profile', headers: [{ key: 'X-Robots-Tag', value: 'noindex, follow' }] },
  { source: '/photo-debug', headers: [{ key: 'X-Robots-Tag', value: 'noindex, follow' }] },
];

/** Gabarit nu de référence (ce que produit le plugin de pré-rendu). */
const APP_HTML_BODY =
  '<!DOCTYPE html><html lang="fr"><head><title>Kojo</title>' +
  '<meta name="description" content="Kojo met en relation clients et travailleurs." /></head>' +
  '<body><div id="root"></div></body></html>';

const NOT_FOUND_HTML =
  '<!DOCTYPE html><html lang="fr"><head><meta name="robots" content="noindex, follow" />' +
  '<title>Page introuvable — Kojo</title></head><body><h1>Page introuvable</h1></body></html>';

/** Fabrique un projet minimal (frontend/vercel.json + App.js + routeur backend). */
function makeProject({
  rewrites = CONFORMING_REWRITES,
  headers = CONFORMING_HEADERS,
  appSource = APP_SOURCE,
  router = true,
  notFound = NOT_FOUND_HTML,
  raw,
  index = true,
  appHtml = APP_HTML_BODY,
  extraBuildHtml = [],
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-routes-'));
  tempDirs.push(root);
  const frontendDir = path.join(root, 'frontend');
  const buildDir = path.join(frontendDir, 'build');
  fs.mkdirSync(path.join(frontendDir, 'src'), { recursive: true });
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(
    path.join(frontendDir, 'vercel.json'),
    raw !== undefined ? raw : JSON.stringify({ framework: 'vite', rewrites, headers }, null, 2)
  );
  fs.writeFileSync(path.join(frontendDir, 'src', 'App.js'), appSource);
  if (index) fs.writeFileSync(path.join(buildDir, 'index.html'), '<div id="root"></div>');
  if (notFound !== null) fs.writeFileSync(path.join(buildDir, '404.html'), notFound);
  if (appHtml !== null) fs.writeFileSync(path.join(buildDir, 'app.html'), appHtml);
  // Pages pré-rendues attendues par le routage de référence.
  for (const route of [
    'jobs',
    'login',
    'register',
    'forgot-password',
    'payment',
    'how-it-works',
    'support',
  ]) {
    fs.writeFileSync(path.join(buildDir, `${route}.html`), '<div id="root"></div>');
  }
  for (const name of extraBuildHtml) {
    fs.writeFileSync(path.join(buildDir, `${name}.html`), '<div id="root"></div>');
  }
  const backendDir = path.join(root, 'backend');
  fs.mkdirSync(backendDir, { recursive: true });
  if (router) {
    fs.writeFileSync(
      path.join(backendDir, 'kojo_routers_public.py'),
      'api_router.add_api_route("/og/jobs/{job_id}", og_job_html)\n'
    );
  }
  return { root, frontendDir, buildDir, repoRoot: root };
}

const run = (project) =>
  runSpaRoutesCheck({
    frontendDir: project.frontendDir,
    repoRoot: project.repoRoot,
    buildDir: project.buildDir,
  });

// La mutation peut se faire sur place (push) OU en retournant un nouveau
// tableau (filter/map) : ignorer la valeur de retour rendait silencieusement
// certaines fixtures conformes, et les tests correspondants passaient pour de
// mauvaises raisons.
const withRewrites = (mutate) => {
  const rewrites = JSON.parse(JSON.stringify(CONFORMING_REWRITES));
  const result = mutate(rewrites);
  return Array.isArray(result) ? result : rewrites;
};

describe('check-spa-routes — routage conforme', () => {
  it('accepte le routage de référence', () => {
    const project = makeProject();
    const result = run(project);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  // Le dépôt réel n'est pas rejoué ici : l'étape « Check SPA routing » de la CI
  // l'examine sur le runner, réécritures de vercel.json et route inconnue comprises.
});

describe('check-spa-routes — sémantique 404 (pas de catch-all)', () => {
  it('échoue si le catch-all SPA revient', () => {
    const project = makeProject({
      rewrites: withRewrites((rewrites) =>
        rewrites.push({ source: SPA_CATCH_ALL, destination: SPA_INDEX })
      ),
    });
    const result = run(project);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('soft 404');
  });

  it('exige build/404.html en noindex et sans script', () => {
    const noNoindex = run(
      makeProject({ notFound: '<html><head><title>404</title></head><body>x</body></html>' })
    );
    expect(noNoindex.errors.join('\n')).toContain('noindex');

    const withScript = run(
      makeProject({
        notFound: NOT_FOUND_HTML.replace('</body>', '<script src="/app.js"></script></body>'),
      })
    );
    expect(withScript.errors.join('\n')).toContain('AUCUN script');

    const missing = run(makeProject({ notFound: null }));
    expect(missing.errors.join('\n')).toContain('404.html absent');
  });

  it('exige build/index.html (racine servie sans rewrite)', () => {
    const result = run(makeProject({ index: false }));
    expect(result.errors.join('\n')).toContain('index.html absent');
  });
});

describe('check-spa-routes — chaque route de production est servie', () => {
  it('échoue si une route React n\'est routée dans aucune des deux formes', () => {
    const project = makeProject({
      rewrites: withRewrites((rewrites) => rewrites.filter((rule) => rule.source !== '/support')),
    });
    const result = run(project);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('/support');
  });

  it('échoue si la forme sans slash manque', () => {
    const project = makeProject({
      rewrites: withRewrites((rewrites) =>
        rewrites.map((rule) =>
          rule.source === '/dashboard' ? { ...rule, source: '/dashboard-x' } : rule
        )
      ),
    });
    const result = run(project);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('/dashboard');
  });

  it('échoue si une route de développement est routée', () => {
    const project = makeProject({
      rewrites: withRewrites((rewrites) =>
        rewrites.push({ source: '/mobile-test', destination: '/index.html' })
      ),
    });
    const result = run(project);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('DÉVELOPPEMENT');
  });

  it('signale une route qui n\'est plus gardée par import.meta.env.DEV', () => {
    const project = makeProject({
      appSource: APP_SOURCE.replace('{import.meta.env.DEV && (', '{true && ('),
    });
    const result = run(project);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain(DEV_ONLY_ROUTES[0]);
  });
});

describe('check-spa-routes — règles inatteignables', () => {
  it('détecte une règle exacte placée après un motif qui la capture', () => {
    const project = makeProject({
      rewrites: withRewrites((rewrites) => {
        const slash = rewrites.find((rule) => rule.source === '/jobs/');
        const rest = rewrites.filter((rule) => rule.source !== '/jobs/');
        const patternIndex = rest.findIndex((rule) => rule.source === JOB_REWRITE_SOURCE);
        rest.splice(patternIndex + 1, 0, slash);
        rewrites.length = 0;
        rewrites.push(...rest);
      }),
    });
    const result = run(project);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('inatteignable');
  });

  it('findShadowedRules : seules les règles exactes masquées sont listées', () => {
    expect(
      findShadowedRules([
        { source: '/jobs/(.*)', destination: 'https://x/y' },
        { source: '/jobs/', destination: '/jobs.html' },
        { source: '/login', destination: '/login.html' },
      ])
    ).toEqual([{ source: '/jobs/', shadowedBy: '/jobs/(.*)' }]);
  });
});

describe('matching des motifs Vercel', () => {
  it('patternToRegex : (.*) et :param', () => {
    expect(patternToRegex('/jobs/(.*)').test('/jobs/')).toBe(true);
    expect(patternToRegex('/jobs/(.*)').test('/jobs/abc')).toBe(true);
    expect(patternToRegex('/api/:path*').test('/api/jobs')).toBe(true);
    expect(patternToRegex('/api/:path*').test('/autre')).toBe(false);
    expect(patternToRegex('/dashboard').test('/dashboard/')).toBe(false);
  });

  it('matchesPattern ignore la règle elle-même et les motifs sans joker', () => {
    expect(matchesPattern('/jobs/', '/jobs/(.*)')).toBe(true);
    expect(matchesPattern('/jobs/', '/jobs/')).toBe(false);
    expect(matchesPattern('/login', '/dashboard')).toBe(false);
  });

  it('parseAppRoutes sépare production et développement', () => {
    const { routes, devOnly } = parseAppRoutes(APP_SOURCE);
    expect(routes).toContain('/support');
    expect(routes).toContain('/jobs/:id');
    expect(routes).not.toContain('/mobile-test');
    expect(devOnly).toEqual(['/mobile-test', '/photo-test']);
  });
});

describe('check-spa-routes — la fiche /jobs/:id', () => {
  it('exige un rewrite vers la route OG du backend', () => {
    const project = makeProject({
      rewrites: withRewrites((rewrites) =>
        rewrites.filter((rule) => rule.source !== JOB_REWRITE_SOURCE)
      ),
    });
    const result = run(project);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain(JOB_REWRITE_SOURCE);
  });

  it('échoue si la destination n\'est plus la route OG', () => {
    const project = makeProject({
      rewrites: withRewrites((rewrites) => {
        for (const rule of rewrites) {
          if (rule.source === JOB_REWRITE_SOURCE) {
            rule.destination = 'https://api.kojoforafrica.cc.cd/api/jobs/$1';
          }
        }
      }),
    });
    const result = run(project);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain(JOB_REWRITE_SUFFIX);
  });

  it('échoue sur une destination relative', () => {
    const project = makeProject({
      rewrites: withRewrites((rewrites) => {
        for (const rule of rewrites) {
          if (rule.source === JOB_REWRITE_SOURCE) rule.destination = '/api/og/jobs/$1';
        }
      }),
    });
    expect(run(project).errors.join('\n')).toContain('absolue');
  });

  it('échoue si la fiche et l\'API ne visent pas le même backend', () => {
    const project = makeProject({
      rewrites: withRewrites((rewrites) => {
        for (const rule of rewrites) {
          if (rule.source === JOB_REWRITE_SOURCE) {
            rule.destination = 'https://autre-backend.example/api/og/jobs/$1';
          }
        }
      }),
    });
    expect(run(project).errors.join('\n')).toContain('même backend');
  });

  it('échoue si la route backend disparaît', () => {
    const project = makeProject({ router: false });
    expect(run(project).errors.join('\n')).toContain('kojo_routers_public.py');
  });
});

describe('check-spa-routes — découverte et cas dégradés', () => {
  it('exige sitemap et robots proxifiés', () => {
    const project = makeProject({
      rewrites: withRewrites((rewrites) =>
        rewrites.filter((rule) => !['/sitemap.xml', '/robots.txt'].includes(rule.source))
      ),
    });
    const errors = run(project).errors.join('\n');
    expect(errors).toContain('/sitemap.xml');
    expect(errors).toContain('/robots.txt');
  });

  it('échoue si vercel.json est absent, illisible ou vide', () => {
    const missing = makeProject();
    fs.rmSync(path.join(missing.frontendDir, 'vercel.json'));
    expect(run(missing).errors.join('\n')).toContain('introuvable');

    expect(run(makeProject({ raw: '{ pas du json' })).errors.join('\n')).toContain('illisible');
    expect(
      run(makeProject({ raw: JSON.stringify({ framework: 'vite' }) })).errors.join('\n')
    ).toContain('aucun rewrite');
  });
});

// Le gabarit des routes clientes : c'est le point qui a réellement cassé en
// production. index.html porte désormais le shell de l'ACCUEIL ; le servir à
// /dashboard ou /support publiait le h1, les 300+ mots et les liens de la home
// sous une dizaine d'adresses (contenu dupliqué), avec en plus un canonical
// statique « / » sur toutes.
describe('check-spa-routes — séparation des gabarits', () => {
  it('accepte app.html comme gabarit des routes clientes', () => {
    const result = run(makeProject());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('échoue si une route cliente est servie par index.html', () => {
    const project = makeProject({
      rewrites: withRewrites((rewrites) => {
        for (const rule of rewrites) {
          if (rule.source === '/dashboard') rule.destination = SPA_INDEX;
        }
      }),
    });
    const errors = run(project).errors.join('\n');
    expect(errors).toContain('/app.html');
    expect(errors).toContain('contenu dupliqu\u00e9');
  });

  it('échoue si une route cliente renvoie vers un .html inexistant', () => {
    // /dashboard n'a pas de pré-rendu : la servir par /dashboard.html (fichier
    // jamais émis) doit être refusé — c'est le gabarit app.html qui est attendu.
    const project = makeProject({
      rewrites: withRewrites((rewrites) => {
        for (const rule of rewrites) {
          if (rule.source === '/dashboard') rule.destination = '/dashboard.html';
        }
      }),
    });
    expect(run(project).errors.join('\n')).toContain('/app.html');
  });

  it('échoue si une page pré-rendue PUBLIQUE est renvoyée vers le gabarit nu', () => {
    // Régression réelle : /support et /how-it-works servaient app.html (titre
    // « Kojo », aucun h1, 1 mot). Le garde exige leur propre fichier.
    const project = makeProject({
      rewrites: withRewrites((rewrites) => {
        for (const rule of rewrites) {
          if (rule.source === '/support') rule.destination = '/app.html';
        }
      }),
    });
    expect(run(project).errors.join('\n')).toContain('/support.html');
  });

  it('échoue si build/app.html est absent ou n\'est plus un gabarit nu', () => {
    expect(run(makeProject({ appHtml: null })).errors.join('\n')).toContain('app.html absent');

    const withH1 = makeProject({
      appHtml: APP_HTML_BODY.replace('<div id="root"></div>', '<div id="root"><h1>Titre</h1></div>'),
    });
    expect(run(withH1).errors.join('\n')).toContain('<h1>');

    const withCanonical = makeProject({
      appHtml: APP_HTML_BODY.replace(
        '</head>',
        '<link rel="canonical" href="https://kj-update-fevrier.vercel.app/" /></head>'
      ),
    });
    expect(run(withCanonical).errors.join('\n')).toContain('canonical');

    const withLdJson = makeProject({
      appHtml: APP_HTML_BODY.replace(
        '</head>',
        '<script type="application/ld+json">{"@type":"LocalBusiness"}</script></head>'
      ),
    });
    expect(run(withLdJson).errors.join('\n')).toContain('JSON-LD');

    const filledRoot = makeProject({
      appHtml: APP_HTML_BODY.replace('<div id="root"></div>', '<div id="root"><p>x</p></div>'),
    });
    expect(run(filledRoot).errors.join('\n')).toContain('VIDE');
  });

  it('échoue si une page pré-rendue est émise sans être déclarée', () => {
    const project = makeProject({ extraBuildHtml: ['produits'] });
    const errors = run(project).errors.join('\n');
    expect(errors).toContain('produits');
    // Le message doit nommer L'ENDROIT où une page se déclare : la table des
    // textes de route. Avant, il renvoyait vers la liste recopiée du garde —
    // c'est-à-dire vers la seconde déclaration qu'on vient de supprimer.
    expect(errors).toContain('src/config/page-meta.js');
  });
});

describe('check-spa-routes — routes privées non indexables', () => {
  it('dérive le privé du routage : textes déclarés = publique, backend = publique', () => {
    // « /login » publie ses textes, « /jobs/:id » est pré-rendue par le backend
    // (rewrite hors build) : publiques toutes les deux. Le reste est privé, et
    // c'est cette dérivation qui remplace la liste écrite à la main.
    expect(privateRoutesOf(['/login', '/jobs/:id', '/dashboard'], CONFORMING_REWRITES)).toEqual([
      '/dashboard',
    ]);
  });

  it('échoue sur une page ni publique ni privée, en nommant les deux choix', () => {
    // La page ajoutée est routée (donc servie) et pourtant rien ne dit si elle
    // est indexable : c'est EXACTEMENT l'état qui passait en silence avant.
    const project = makeProject({
      appSource: APP_SOURCE.replace(
        '      <Route path="/photo-debug"',
        '      <Route path="/nouvelle-page" element={<Support />} />\n      <Route path="/photo-debug"'
      ),
      rewrites: withRewrites((rewrites) => [
        ...rewrites,
        { source: '/nouvelle-page', destination: '/app.html' },
        { source: '/nouvelle-page/', destination: '/app.html' },
      ]),
    });
    const errors = run(project).errors.join('\n');
    expect(errors).toContain('/nouvelle-page');
    expect(errors).toContain('src/config/page-meta.js');
    expect(errors).toContain('X-Robots-Tag');
  });

  it('n’accepte un noindex que s’il VISE la route, pas « /(.*) »', () => {
    const appSource = APP_SOURCE.replace(
      '      <Route path="/dashboard"',
      '      <Route path="/dashboard/:onglet" element={<Dashboard />} />\n      <Route path="/dashboard"'
    );
    const withTag = (source) =>
      makeProject({
        appSource,
        headers: [
          ...CONFORMING_HEADERS,
          { source, headers: [{ key: 'X-Robots-Tag', value: 'noindex, follow' }] },
        ],
      });
    // Un motif qui capture la route à paramètre suffit (« dashboard/:onglet »
    // ne peut pas être nommée exactement dans vercel.json).
    expect(run(withTag('/dashboard/(.*)')).errors.join('\n')).not.toContain(
      'X-Robots-Tag'
    );
    // Mais un noindex qui couvre la racine — donc tout le site — ne compte pas :
    // il désindexerait les pages publiques au lieu de protéger celle-ci.
    expect(run(withTag('/(.*)')).errors.join('\n')).toContain('/dashboard/:onglet');
  });

  it('exige X-Robots-Tag noindex sur chaque route privée', () => {
    const project = makeProject({
      headers: CONFORMING_HEADERS.filter((entry) => entry.source !== '/profile'),
    });
    const errors = run(project).errors.join('\n');
    expect(errors).toContain('/profile');
    expect(errors).toContain('X-Robots-Tag');
  });

  it('refuse un noindex détourné en index', () => {
    const project = makeProject({
      headers: CONFORMING_HEADERS.map((entry) =>
        entry.source === '/dashboard'
          ? { source: '/dashboard', headers: [{ key: 'X-Robots-Tag', value: 'index, follow' }] }
          : entry
      ),
    });
    expect(run(project).errors.join('\n')).toContain('noindex');
  });

  // Les routes privées du dépôt réel sont tenues par la même étape de CI.
});
