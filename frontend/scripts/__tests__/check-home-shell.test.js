import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  CONTACT_JSON,
  DESCRIPTION_MAX,
  MIN_WORDS,
  TITLE_MAX,
  countWords,
  cssEscapedClass,
  extractRootHtml,
  missingClasses,
  runHomeShellCheck,
  visibleText,
} from '../check-home-shell';

// Tests du garde-fou du shell statique de l'accueil.
//
// Le shell est la seule barrière entre un crawler sans JavaScript et une page
// perçue comme vide (19 mots, aucun h1, aucun lien). Il peut disparaître
// SILENCIEUSEMENT (clé i18n renommée, plugin désactivé) sans casser un seul
// test fonctionnel : ces tests vérifient donc une rupture à la fois, sur une
// fixture conforme.

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const HERO_TITLE = 'Connecter les travailleurs et les clients';
const CONTACT = {
  phone: '+18193003507',
  phoneDisplay: '+1 819 300 3507',
  email: 'Kojoapp98@gmail.com',
  address: 'Hamdallaye ACI 2000, Bamako, Mali',
  streetAddress: 'Hamdallaye ACI 2000',
  locality: 'Bamako',
  country: 'Mali',
  countryCode: 'ML',
  whatsappUrl: 'https://wa.me/18193003507',
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Bamako',
  mapsEmbedUrl: 'https://www.google.com/maps?q=Bamako&output=embed',
};

// Le rembourrage DÉRIVE du plancher du garde : quand le seuil est passé de 300
// à 500 mots (audit SEO), la fixture recopiée à 320 mots a fait rougir trois
// tests qui n'avaient rien à voir avec la question. Une marge de 100 mots garde
// la fixture conforme sans la recoller au chiffre à chaque fois.
const FILLER = Array.from({ length: MIN_WORDS + 100 }, (_, index) => `mot${index}`).join(' ');

const SHELL_CSS =
  '.min-h-screen{min-height:100vh}.text-3xl{font-size:1.875rem}.mt-8{margin-top:2rem}' +
  '.md\\:text-5xl{font-size:3rem}.bg-white\\/95{background-color:rgba(255,255,255,.95)}';

function shellBody({ heroTitle = HERO_TITLE, words = FILLER, extra = '' } = {}) {
  return (
    '<div class="min-h-screen">' +
    `<h1 class="text-3xl md:text-5xl">${heroTitle}</h1>` +
    '<h2>Services populaires</h2>' +
    `<p>${words}</p>` +
    '<a href="/jobs">Voir les emplois</a>' +
    `<a href="tel:${CONTACT.phone}">${CONTACT.phoneDisplay}</a>` +
    `<a href="mailto:${CONTACT.email}">${CONTACT.email}</a>` +
    '<a href="https://wa.me/18193003507">WhatsApp</a>' +
    `<span>${CONTACT.address}</span>` +
    '<iframe class="mt-8" src="https://www.google.com/maps?q=Bamako&output=embed" loading="lazy"></iframe>' +
    extra +
    '</div>'
  );
}

function htmlPage({ title, description, body, localBusiness = true, css = SHELL_CSS } = {}) {
  const structured = localBusiness
    ? '<script type="application/ld+json">' +
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        telephone: CONTACT.phone,
        email: CONTACT.email,
        address: { '@type': 'PostalAddress', streetAddress: CONTACT.streetAddress },
        areaServed: ['Mali'],
        sameAs: [],
      }) +
      '</script>'
    : '';
  return (
    '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8" />' +
    `<title>${title}</title>` +
    `<meta name="description" content="${description}" />` +
    '<meta property="og:title" content="Kojo" /><meta property="og:description" content="Kojo" />' +
    '<meta name="twitter:title" content="Kojo" />' +
    structured +
    `<style>${css}</style>` +
    `</head><body><div id="root">${body}</div><script type="module" src="/assets/index.js"></script></body></html>`
  );
}

/** Projet minimal conforme : c'est la référence des tests. */
function makeProject({
  title = 'Kojo — Services et travailleurs en Afrique de l\'Ouest',
  description = 'Trouvez un plombier, électricien ou mécanicien vérifié au Mali, au Sénégal ou en Côte d\'Ivoire.',
  body,
  indexHtml,
  // Page pré-rendue de référence : un document COMPLET avec SA description
  // (le garde refuse désormais une page qui publie celle de l'accueil).
  jobsHtml = htmlPage({
    title: 'Emplois disponibles — Kojo',
    description: "Emplois et missions disponibles dans toute l'Afrique de l'Ouest.",
    body: '<h1>Emplois disponibles</h1>',
  }),
  contact = CONTACT,
  // « Mali » est présent dans l'adresse du N.A.P. de la fixture : le shell y
  // fait donc référence sans avoir à répéter chaque pays.
  countries = ['Mali'],
  localBusiness,
  css,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-shell-'));
  tempDirs.push(root);
  const frontendDir = path.join(root, 'frontend');
  const buildDir = path.join(frontendDir, 'build');
  fs.mkdirSync(path.join(frontendDir, 'src', 'i18n'), { recursive: true });
  fs.mkdirSync(path.join(frontendDir, 'src', 'config'), { recursive: true });
  fs.mkdirSync(path.join(frontendDir, 'src', 'components'), { recursive: true });
  fs.mkdirSync(buildDir, { recursive: true });

  fs.writeFileSync(
    path.join(frontendDir, 'src', 'i18n', 'fr.json'),
    JSON.stringify({ heroTitle: HERO_TITLE })
  );
  fs.writeFileSync(path.join(frontendDir, CONTACT_JSON), JSON.stringify(contact, null, 2));
  fs.writeFileSync(
    path.join(frontendDir, 'src', 'components', 'CountryDisplay.js'),
    `export const COUNTRIES = {\n${countries
      .map((name, index) => `  c${index}: {\n    name: '${name.replace(/'/g, "\\'")}',\n  },`)
      .join('\n')}\n};\n`
  );
  fs.writeFileSync(
    path.join(buildDir, 'index.html'),
    indexHtml !== undefined
      ? indexHtml
      : htmlPage({ title, description, body: body === undefined ? shellBody() : body, localBusiness, css })
  );
  fs.writeFileSync(path.join(buildDir, 'jobs.html'), jobsHtml);
  return { root, frontendDir, buildDir, repoRoot: root };
}

const run = (project) =>
  runHomeShellCheck({
    frontendDir: project.frontendDir,
    repoRoot: project.repoRoot,
    buildDir: project.buildDir,
  });

describe('check-home-shell — shell conforme', () => {
  it('accepte un shell complet', () => {
    const result = run(makeProject());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.words).toBeGreaterThanOrEqual(300);
  });
});

describe('check-home-shell — le shell ne doit pas disparaître', () => {
  it('échoue si #root est vide', () => {
    const project = makeProject({ body: '' });
    const result = run(project);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('est VIDE');
  });

  it('échoue si index.html est absent', () => {
    const project = makeProject();
    fs.rmSync(path.join(project.buildDir, 'index.html'));
    expect(run(project).errors.join('\n')).toContain('introuvable');
  });

  it('échoue si le contenu statique est trop court (page « vide »)', () => {
    const project = makeProject({ body: shellBody({ words: 'trop court' }) });
    expect(run(project).errors.join('\n')).toContain('mots');
  });
});

describe('check-home-shell — titres et méta', () => {
  it('exige exactement un h1, reprenant heroTitle', () => {
    const none = run(makeProject({ body: shellBody().replace(/<h1[^>]*>.*?<\/h1>/, '') }));
    expect(none.errors.join('\n')).toContain('EXACTEMENT un h1');

    const two = run(makeProject({ body: shellBody({ extra: '<h1>Second titre</h1>' }) }));
    expect(two.errors.join('\n')).toContain('EXACTEMENT un h1');

    const wrong = run(makeProject({ body: shellBody({ heroTitle: 'Titre inventé' }) }));
    expect(wrong.errors.join('\n')).toContain('heroTitle');
  });

  it('exige un h2 (hiérarchie de titres)', () => {
    const project = makeProject({ body: shellBody().replace('<h2>Services populaires</h2>', '') });
    expect(run(project).errors.join('\n')).toContain('aucun h2');
  });

  it('refuse un title > 60 et une description > 160', () => {
    const longTitle = run(makeProject({ title: 'x'.repeat(TITLE_MAX + 1) }));
    expect(longTitle.errors.join('\n')).toContain('tronquent');

    const longDescription = run(makeProject({ description: 'y'.repeat(DESCRIPTION_MAX + 1) }));
    expect(longDescription.errors.join('\n')).toContain('moteurs la tronquent');
  });
});

describe('check-home-shell — liens et contact', () => {
  it('exige un lien interne', () => {
    const project = makeProject({ body: shellBody().replace('<a href="/jobs">Voir les emplois</a>', '') });
    expect(run(project).errors.join('\n')).toContain('AUCUN lien interne');
  });

  it('exige tel:, mailto: et WhatsApp', () => {
    expect(
      run(makeProject({ body: shellBody().replace(/<a href="tel:[^"]*">[^<]*<\/a>/, '') })).errors.join('\n')
    ).toContain('tel:');
    expect(
      run(makeProject({ body: shellBody().replace(/<a href="mailto:[^"]*">[^<]*<\/a>/, '') })).errors.join('\n')
    ).toContain('mailto:');
    expect(
      run(makeProject({ body: shellBody().replace(/<a href="https:\/\/wa\.me[^"]*">WhatsApp<\/a>/, '') })).errors.join('\n')
    ).toContain('WhatsApp');
  });

  it('échoue si le N.A.P. du HTML diverge de contact.json', () => {
    const project = makeProject({
      contact: { ...CONTACT, address: 'Autre adresse, Bamako, Mali' },
    });
    expect(run(project).errors.join('\n')).toContain('diverge du footer');
  });
});

describe('check-home-shell — référentiels partagés', () => {
  it('échoue si un pays du référentiel manque dans le shell', () => {
    const project = makeProject({ countries: ['Mali', 'Sénégal', 'Côte d\'Ivoire', 'Burkina Faso'] });
    expect(run(project).errors.join('\n')).toContain('Burkina Faso');
  });

  it('gère les apostrophes échappées des noms de pays', () => {
    // Sans gestion de l'échappement, le nom serait tronqué en « Côte d\ » et
    // le garde signalerait un pays absent alors qu'il est bien là.
    const project = makeProject({
      countries: ['Mali', "Côte d'Ivoire"],
      body: shellBody({ extra: "<span>Côte d'Ivoire</span>" }),
    });
    const result = run(project);
    expect(result.errors.join('\n')).not.toContain('Côte d\\');
    expect(result.ok).toBe(true);
  });
});

describe('check-home-shell — SEO local', () => {
  it('exige un LocalBusiness complet et cohérent', () => {
    const missing = run(makeProject({ localBusiness: false }));
    expect(missing.errors.join('\n')).toContain('LocalBusiness');

    const project = makeProject();
    const html = fs.readFileSync(path.join(project.buildDir, 'index.html'), 'utf8');
    fs.writeFileSync(
      path.join(project.buildDir, 'index.html'),
      html.replace(/"telephone":\s*"\+18193003507"/, '"telephone":"+33000000000"')
    );
    expect(run(project).errors.join('\n')).toContain('contact.json');
  });

  it('exige une carte intégrée en lazy', () => {
    const noMap = run(makeProject({ body: shellBody().replace(/<iframe[\s\S]*?<\/iframe>/, '') }));
    expect(noMap.errors.join('\n')).toContain('Google Maps');

    const eager = run(makeProject({ body: shellBody().replace(' loading="lazy"', '') }));
    expect(eager.errors.join('\n')).toContain('loading="lazy"');
  });
});

describe('check-home-shell — styles et fuite du shell', () => {
  it('échoue si une classe du shell n\'est pas dans le CSS (Tailwind ne scanne pas vite.config.js)', () => {
    const project = makeProject({
      body: shellBody({ extra: '<div class="classe-inventee-xyz"></div>' }),
    });
    expect(run(project).errors.join('\n')).toContain('ABSENTES du CSS');
  });

  it('échoue si le shell de l\'accueil fuit dans une page pré-rendue', () => {
    const project = makeProject({
      jobsHtml: htmlPage({
        title: 'Emplois disponibles — Kojo',
        description: 'Emplois et missions disponibles.',
        body: `<h1>${HERO_TITLE}</h1>`,
      }),
    });
    expect(run(project).errors.join('\n')).toContain("shell de l'ACCUEIL");
  });

  it('refuse une description recopiée de l\'accueil dans une page pré-rendue', () => {
    // Régression réelle : le plugin n'écrivait pas la description par route —
    // /jobs, /login, /register… publiaient celle de l'accueil.
    const shared = 'Description recopiée partout.';
    const project = makeProject({
      description: shared,
      jobsHtml: htmlPage({ title: 'Emplois', description: shared, body: '<h1>Emplois</h1>' }),
    });
    expect(run(project).errors.join('\n')).toContain('DUPLIQUÉE');
  });

  it('exige une description sur chaque page pré-rendue', () => {
    const project = makeProject({
      jobsHtml: htmlPage({
        title: 'Emplois',
        description: '',
        body: '<h1>Emplois disponibles</h1>',
      }),
    });
    expect(run(project).errors.join('\n')).toContain('description absente');
  });

  it('missingClasses ignore group/peer et les classes échappées', () => {
    const missing = missingClasses(
      '<div class="group bg-white/95 mt-8 ok"></div>',
      '.bg-white\\/95{}.mt-8{}'
    );
    expect(missing).toEqual(['ok']);
  });
});

describe('helpers du shell', () => {
  it('extractRootHtml isole le contenu de #root', () => {
    const html = '<body><div id="root"><p>salut</p></div><script></script></body>';
    expect(extractRootHtml(html)).toBe('<p>salut</p>');
    expect(extractRootHtml('<body></body>')).toBe('');
  });

  it('visibleText retire balises, scripts et styles', () => {
    expect(visibleText('<p>a</p><script>var x=1</script><style>p{}</style>')).toBe('a');
  });

  it('countWords compte les mots réels, pas la ponctuation seule', () => {
    expect(countWords('un deux trois')).toBe(3);
    expect(countWords('— … ·')).toBe(0);
  });

  it('cssEscapedClass échappe ce que Tailwind échappe', () => {
    expect(cssEscapedClass('bg-white/95')).toBe('bg-white\\/95');
    expect(cssEscapedClass('md:text-5xl')).toBe('md\\:text-5xl');
  });
});
