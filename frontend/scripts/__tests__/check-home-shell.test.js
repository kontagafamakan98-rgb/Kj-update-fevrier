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
  CLASSES_SANS_STYLE,
  cssEscapedClass,
  exemptionsPerimees,
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

// La clé du dictionnaire (avec son gabarit) et le libellé du CONTRÔLE de carte :
// la fixture les publie comme le fait la vraie coquille, et le garde les lit
// dans fr.json — c'est ce qui rend le contrôle rejouable sur une fixture.
const CARTE_TITRE_MODELE = 'Carte — {address}';
const CARTE_TITRE = CARTE_TITRE_MODELE.replace('{address}', CONTACT.address);
const CARTE_LIBELLE = 'Afficher la carte';

// Le rembourrage DÉRIVE du plancher du garde : quand le seuil est passé de 300
// à 500 mots (audit SEO), la fixture recopiée à 320 mots a fait rougir trois
// tests qui n'avaient rien à voir avec la question. Une marge de 100 mots garde
// la fixture conforme sans la recoller au chiffre à chaque fois.
const FILLER = Array.from({ length: MIN_WORDS + 100 }, (_, index) => `mot${index}`).join(' ');

const SHELL_CSS =
  '.min-h-screen{min-height:100vh}.text-3xl{font-size:1.875rem}.mt-8{margin-top:2rem}' +
  '.md\\:text-5xl{font-size:3rem}.bg-white\\/95{background-color:rgba(255,255,255,.95)}' +
  // Classes des cartes pays de la fixture (le garde exige que chaque classe du
  // shell existe dans le CSS du build).
  '.font-semibold{font-weight:600}.text-gray-900{color:#111827}.text-sm{font-size:.875rem}' +
  '.md\\:text-base{font-size:1rem}' +
  // Classes de la FAÇADE DE CARTE de la fixture — les mêmes que publie la
  // coquille de /contact : le garde refuse toute classe du shell absente du CSS
  // (Tailwind ne scanne pas le module qui écrit la coquille).
  '.mt-6{margin-top:1.5rem}.w-full{width:100%}.rounded-xl{border-radius:.75rem}' +
  '.border{border-width:1px}.border-gray-200{border-color:#e5e7eb}.bg-white{background-color:#fff}' +
  '.flex{display:flex}.h-80{height:20rem}.flex-col{flex-direction:column}' +
  '.items-center{align-items:center}.justify-center{justify-content:center}.gap-3{gap:.75rem}' +
  '.px-4{padding-left:1rem;padding-right:1rem}.text-center{text-align:center}' +
  '.text-2xl{font-size:1.5rem}.inline-flex{display:inline-flex}' +
  '.px-5{padding-left:1.25rem;padding-right:1.25rem}.py-2\\.5{padding:.625rem 1.25rem}' +
  '.text-white{color:#fff}.bg-orange-600{background-color:#ea580c}' +
  '.hover\\:bg-orange-700:hover{background-color:#c2410c}';

function shellBody({ heroTitle = HERO_TITLE, words = FILLER, extra = '', countries = ['Mali'] } = {}) {
  return (
    '<div class="min-h-screen">' +
    `<h1 class="text-3xl md:text-5xl">${heroTitle}</h1>` +
    '<h2>Services populaires</h2>' +
    // Chaque pays du référentiel est publié comme TITRE DE CARTE : le garde
    // exige cette forme-là (une simple mention dans la prose ne prouve pas que
    // la carte est là).
    countries
      .map((name) => `<h3 class="font-semibold text-gray-900 text-sm md:text-base">${name}</h3>`)
      .join('') +
    `<p>${words}</p>` +
    '<a href="/jobs">Voir les emplois</a>' +
    `<a href="tel:${CONTACT.phone}">${CONTACT.phoneDisplay}</a>` +
    `<a href="mailto:${CONTACT.email}">${CONTACT.email}</a>` +
    '<a href="https://wa.me/18193003507">WhatsApp</a>' +
    `<span>${CONTACT.address}</span>` +
    // La carte est un CONTRÔLE (un lien vers la fiche Google), pas une iframe :
    // c'est la forme que le garde exige depuis que l'embed du premier écran a
    // été mesuré comme un coût sur le LCP de l'accueil (loading="lazy" n'empêche
    // pas le navigateur de le charger dès qu'il approche du viewport).
    '<div class="mt-6 w-full rounded-xl border border-gray-200 bg-white flex h-80 flex-col items-center justify-center gap-3 px-4 text-center">' +
    '<span class="text-2xl" aria-hidden="true">📍</span>' +
    // Le href est échappé comme le fait le build (`&` → `&amp;`) : le garde
    // compare la forme publiée, et la fixture doit donc publier la même.
    `<a href="${CONTACT.mapsUrl.replace(/&/g, '&amp;')}" target="_blank" rel="noreferrer" title="${CARTE_TITRE}" class="inline-flex items-center rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700">${CARTE_LIBELLE}</a>` +
    '</div>' +
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
    // La fixture publie le CHROME de la coquille, comme le build réel : le
    // conteneur `.App` (hook de structure, sans règle CSS, exempté de la règle 8
    // avec son motif). Sans lui, une fixture « conforme » ferait rougir le refus
    // des exemptions périmées — et ce refus doit viser le build, pas un manque
    // dans la fixture.
    // (Le chrome n'est publié que si le corps existe : la fixture dont le corps
    // est VIDE doit laisser `#root` vide, pour que ce refus-là reste éprouvable.)
    `</head><body><div id="root">${body ? `<div class="App">${body}</div>` : ''}</div><script type="module" src="/assets/index.js"></script></body></html>`
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
  // Un pays de la fixture par défaut, publié en carte par `shellBody` : c'est
  // la forme que le garde cherche (un h3), pas une mention dans la prose.
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
    JSON.stringify({
      heroTitle: HERO_TITLE,
      // Les clés du contrôle de carte : le garde les lit pour exiger le titre et
      // le libellé que la coquille doit publier (c'est le dictionnaire qui les
      // détient, ici comme en vrai).
      mapIframeTitle: CARTE_TITRE_MODELE,
      mapShowMap: CARTE_LIBELLE,
    })
  );
  fs.writeFileSync(path.join(frontendDir, CONTACT_JSON), JSON.stringify(contact, null, 2));
  // Le référentiel partagé que lit le garde (et que le build lit aussi pour
  // écrire la coquille) : src/config/countries.js.
  fs.writeFileSync(
    path.join(frontendDir, 'src', 'config', 'countries.js'),
    `export const COUNTRIES = [\n${countries
      .map(
        (name, index) =>
          `  {\n    code: 'c${index}',\n    name: '${name.replace(/'/g, "\\'")}',\n  },`
      )
      .join('\n')}\n];\n`
  );
  fs.writeFileSync(
    path.join(buildDir, 'index.html'),
    indexHtml !== undefined
      ? indexHtml
      : htmlPage({
          title,
          description,
          body: body === undefined ? shellBody({ countries }) : body,
          localBusiness,
          css,
        })
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
    // Le référentiel en porte quatre, la coquille n'en publie qu'un : chacune
    // des trois absentes est nommée.
    const project = makeProject({
      countries: ['Mali', 'Sénégal', 'Côte d\'Ivoire', 'Burkina Faso'],
      body: shellBody({ countries: ['Mali'] }),
    });
    expect(run(project).errors.join('\n')).toContain('Burkina Faso');
  });

  it('échoue si le pays n\'est plus publié en CARTE (une mention dans la prose ne suffit pas)', () => {
    // Régression réelle : le sous-titre du hero cite les quatre pays, donc une
    // simple recherche du nom dans le HTML était satisfaite même section des
    // pays supprimée du shell. Le garde exige donc un TITRE DE CARTE (un h3).
    const project = makeProject({
      countries: ['Mali'],
      body: shellBody({ countries: [] }),
    });
    const result = run(project);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('carte');
  });

  it('gère les apostrophes échappées des noms de pays', () => {
    // Sans gestion de l'échappement, le nom serait tronqué en « Côte d\ » et
    // le garde signalerait un pays absent alors qu'il est bien là.
    const project = makeProject({
      countries: ['Mali', "Côte d'Ivoire"],
      body: shellBody({
        extra: '<h3 class="font-semibold text-gray-900 text-sm md:text-base">Côte d\'Ivoire</h3>',
      }),
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

  it('exige le CONTRÔLE de la carte, et refuse l’iframe `output=embed` au premier écran', () => {
    // Façade disparue : plus aucun chemin vers la fiche Google (le lien du
    // contrôle était le seul `href` vers mapsUrl du shell).
    const sansControle = run(
      makeProject({ body: shellBody().replace(/<div class="mt-6[\s\S]*?<\/div>/, '') })
    );
    expect(sansControle.errors.join('\n')).toContain('contrôle de la carte');

    // Libellé recopié en littéral : le dictionnaire n'est plus la source.
    const sansLibelle = run(makeProject({ body: shellBody().replace(CARTE_LIBELLE, 'Ouvrir') }));
    expect(sansLibelle.errors.join('\n')).toContain('mapShowMap');

    // Régression fermée : la coquille republie l'iframe `output=embed` (elle
    // tirait ~300 Ko de tiers dans le premier écran et repoussait le LCP).
    const embed = run(
      makeProject({
        body: shellBody({
          extra: '<iframe src="https://www.google.com/maps?q=Bamako&output=embed" loading="lazy"></iframe>',
        }),
      })
    );
    expect(embed.errors.join('\n')).toContain('output=embed');
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

  // ── Les exemptions de la règle 8 (classes sans style par DESSEIN) ────────
  // `App` est un hook de structure : le shell le publie, aucune règle ne le
  // style, et c'est voulu. Sans exemption, la règle 8 le signalait à chaque
  // build depuis que `.App { text-align: center }` a été retirée (25/09/2026) —
  // et poussait donc à réintroduire une déclaration d'alignement qu'on venait de
  // retirer pour de bonnes raisons.
  const EXEMPTIONS = { App: 'hook de structure (cas de test)' };

  it('accepte une classe publiée, sans règle, et exemptée avec son motif', () => {
    expect(exemptionsPerimees('<div class="App min-h-screen"></div>', '.min-h-screen{height:100vh}')).toEqual(
      []
    );
    expect(missingClasses('<div class="App"></div>', '.x{}', { ignore: ['App'] })).toEqual([]);
  });

  it('refuse une exemption dont la classe n’est plus publiée', () => {
    const refus = exemptionsPerimees('<div class="autre"></div>', '.autre{}', EXEMPTIONS);
    expect(refus.join('\n')).toContain('exemption PÉRIMÉE pour la classe « App »');
  });

  it('refuse une exemption que le CSS rend fausse (la classe est désormais stylée)', () => {
    const refus = exemptionsPerimees('<div class="App"></div>', '.App{text-align:center}', EXEMPTIONS);
    expect(refus.join('\n')).toContain("l'exemption de la classe « App » n'est plus justifiée");
  });

  it('l’exemption réelle du dépôt porte un motif, et elle est encore valable', () => {
    // Sans motif, l'entrée serait une liste d'ignorés déguisée ; la règle du
    // dépôt veut qu'une exemption dise POURQUOI.
    for (const [classe, motif] of Object.entries(CLASSES_SANS_STYLE)) {
      expect(`${classe} : ${motif}`.length).toBeGreaterThan(40);
    }
    expect(Object.keys(CLASSES_SANS_STYLE)).toContain('App');
  });
});
