/**
 * Tests du garde-fou du pré-rendu par route (scripts/check-prerender-shells.js).
 *
 * Ce garde était le SEUL du dépôt dont rien ne démontrait qu'il sait échouer :
 * il n'exporte rien (tout son code est de premier niveau) et n'était invoqué que
 * par `ci.yml`. Ce fichier comble ce trou comme les autres gardes : il
 * l'EXÉCUTE en sous-processus sur une arborescence de build FIXTURE, et chaque
 * cas injecte une régression en exigeant le refus nommé.
 *
 * Pourquoi un sous-processus et non un appel de fonction : le garde lit
 * `process.cwd()/build` et `process.cwd()/vercel.json` et sort en `exit 1` —
 * c'est ce contrat-là qu'on mesure (code de sortie + message du coupable), donc
 * on lance le vrai script, jamais une copie de sa logique. Ses imports
 * (`site-meta.js`, `check-og-images.js`) se résolvent depuis SON répertoire :
 * la table des cartes lue est donc la vraie, jamais une recopie.
 *
 * La fixture « propre » est construite pour satisfaire TOUTES les attentes du
 * garde — sinon les cas négatifs rougiraient pour la mauvaise raison, ce qui est
 * exactement le faux vert que ce genre de test doit éviter.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// La règle de l'apostrophe publiée : le test l'exerce sur des FIXTURES, le
// garde sur l'arbre réel — une seule logique, aucun caractère redéclaré ici.
import {
  APOSTROPHE_PUBLIEE,
  APOSTROPHE_REFUSEE,
  apostrophesDeCopie,
  apostrophesHorsConvention,
} from '../published-copy.js';
import { ROUTES } from '../check-og-images.js';
import { SITE_ORIGIN, shellFileFor } from '../site-meta.js';
// Le scope register, résolu EXACTEMENT comme le fait le garde : la fixture ne
// peut donc pas dériver des octets que la coquille doit publier.
import { makeScopedTranslator as makeRegisterTranslator } from '../../src/utils/pack2PageI18n/register.js';
import { PHONE_PREFIX_FALLBACK, phoneNumberExample } from '../../src/config/phone-format.js';
import { COUNTRY_PLACEHOLDER } from '../../src/config/country-placeholder.js';
import { photoFormatsLine } from '../../src/config/photo-formats.js';
import { CONTACT } from '../../src/config/contact.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(FRONTEND_DIR, 'scripts', 'check-prerender-shells.js');

// Les textes que le garde exige pour la section contact de l'accueil et pour la
// page 404 sont LUS dans le dictionnaire global, celui-là même que lit le build :
// la fixture les matérialise depuis cette source unique au lieu de les recopier,
// donc elle ne peut pas dériver du garde en silence. Les cas négatifs retirent
// un texte que les deux canaux lisent au même endroit.
const fr = JSON.parse(
  fs.readFileSync(path.join(FRONTEND_DIR, 'src', 'i18n', 'fr.json'), 'utf8')
);
const registerT = makeRegisterTranslator('fr', (cle) => fr[cle]);
const appMetaMutations = [
  ['titre', `<title>${fr.neutralTitle}</title>`, '<title>Autre</title>', 'app.html : titre neutre'],
  ['description', `<meta name="description" content="${fr.neutralDescription}" />`, '<meta name="description" content="Autre" />', 'app.html : description neutre'],
  ['og:title', `<meta property="og:title" content="${fr.neutralTitle}" />`, '<meta property="og:title" content="Autre" />', 'app.html : og:title neutre'],
  ['og:description', `<meta property="og:description" content="${fr.neutralDescription}" />`, '<meta property="og:description" content="Autre" />', 'app.html : og:description neutre'],
  ['twitter:title', `<meta name="twitter:title" content="${fr.neutralTitle}" />`, '<meta name="twitter:title" content="Autre" />', 'app.html : twitter:title neutre'],
  ['twitter:description', `<meta name="twitter:description" content="${fr.neutralDescription}" />`, '<meta name="twitter:description" content="Autre" />', 'app.html : twitter:description neutre'],
];

// Coquilles émises par le build réel : les routes CLIENTES (/dashboard,
// /profile) sont servies par app.html et n'ont donc pas de fichier propre —
// comme en production.
const CLIENT_PAGES = ['app.html', '404.html'];

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** La carte og:image attendue d'une coquille, LUE dans la table unique. */
const ogTagFor = (file) => {
  const route = ROUTES.find((r) => shellFileFor(r.path) === file);
  return route ? `<meta property="og:image" content="${SITE_ORIGIN}${route.image}">` : '';
};

const preload = (chunk) => `<link rel="modulepreload" crossorigin href="/assets/${chunk}-abc123.js">`;

/** HTML minimal mais CONFORME à chaque attente du garde. */
const pages = () => ({
  'index.html':
    '<!doctype html><html><head>' +
    ogTagFor('index.html') +
    `</head><body><div id="root"><h1>Kojo</h1><p>Contenu statique de l${APOSTROPHE_PUBLIEE}accueil</p>` +
    '<a href="/jobs">Emplois</a>' +
    `<h2>${fr.contactTitle}</h2><p>${fr.homeContactText}</p>` +
    `<div>${fr.homeContactCall}</div><div>${fr.contactWhatsapp}</div>` +
    `<div>${fr.contactSendEmail}</div><div>${fr.contactAddress}</div>` +
    `<h3>${fr.homeContactFollow}</h3>` +
    `<a href="/carte">${fr.footerItinerary}</a>` +
    `<a href="/legal">${fr.footerTerms}</a>` +
    `<iframe title="${fr.mapIframeTitle.replace('{address}', CONTACT.address)}"></iframe>` +
    `<a href="https://exemple.test" rel="me noreferrer">Réseau</a></div>` +
    preload('Home') +
    '<script type="module" src="/assets/index.js"></script></body></html>',
  'jobs.html':
    '<!doctype html><html><head>' +
    ogTagFor('jobs.html') +
    '</head><body><div id="root">' +
    '<div class="h-16 bg-white border-b border-gray-200"></div>' +
    '<h1 class="text-3xl font-bold text-gray-900">Emplois disponibles</h1>' +
    '</div></body></html>',
  'login.html':
    '<!doctype html><html><head>' +
    ogTagFor('login.html') +
    '</head><body><div id="root">' +
    '<h1 class="mt-6 text-center text-3xl font-extrabold text-gray-900">Connexion</h1>' +
    '<input id="email" /><div class="bg-orange-600">Connexion</div>' +
    '</div>' +
    preload('Login') +
    '</body></html>',
  'register.html':
    '<!doctype html><html><head>' +
    ogTagFor('register.html') +
    '</head><body><div id="root">' +
    '<h1 class="mt-6 text-center text-3xl font-bold text-gray-900">Créer un compte</h1>' +
    `<button>${registerT('googleSignup')}</button>` +
    '<div class="bg-orange-600">Continuer vers la vérification email</div>' +
    '<input placeholder="Prénom..." /><input placeholder="Nom..." />' +
    '<input placeholder="exemple@email.com" />' +
    `<input placeholder="${phoneNumberExample()}" />` +
    `<span>${PHONE_PREFIX_FALLBACK}</span>` +
    `<div>${photoFormatsLine(registerT('upTo'))}</div>` +
    `<select>${COUNTRY_PLACEHOLDER(fr.country)}</select>` +
    '<p>Informations légales</p><p>Politique de confidentialité</p>' +
    `<p>${registerT('clientStepNotice')}</p>` +
    `<p>${registerT('legalConsentHelp')}</p>` +
    `<label>${registerT('legalConsentLabel')}</label>` +
    '</div>' +
    preload('Register') +
    '</body></html>',
  'forgot-password.html':
    '<!doctype html><html><head>' +
    ogTagFor('forgot-password.html') +
    '</head><body><div id="root">' +
    '<h1 class="mt-6 text-3xl font-extrabold text-gray-900">Mot de passe oublié</h1>' +
    '<input id="reset-email" />' +
    '<div class="bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Envoyer le code</div>' +
    '</div>' +
    preload('ForgotPassword') +
    '</body></html>',
  'payment.html':
    '<!doctype html><html><head>' +
    ogTagFor('payment.html') +
    '</head><body><div id="root">' +
    '<h1 class="text-3xl font-bold text-gray-900 mb-2">KOJO Paiements réels</h1>' +
    '<p>Un paiement doit être rattaché à une mission</p>' +
    `<p>${fr.paymentPageNoJobText}</p>` +
    '<a href="/jobs">Voir les missions disponibles</a>' +
    '</div>' +
    preload('Payment') +
    '</body></html>',
  'how-it-works.html':
    '<!doctype html><html><head>' +
    `<link rel="canonical" href="${SITE_ORIGIN}/how-it-works" />` +
    ogTagFor('how-it-works.html') +
    '</head><body><div id="root">' +
    '<h1 class="text-3xl md:text-4xl font-bold mb-4">Comment ça marche ?</h1>' +
    '<details><summary>FAQ</summary>Réponse</details>' +
    '<a href="/jobs">Missions</a><a href="/support">Support</a>' +
    '</div>' +
    preload('HowItWorks') +
    '</body></html>',
  'contact.html':
    '<!doctype html><html><head>' +
    `<link rel="canonical" href="${SITE_ORIGIN}/contact" />` +
    ogTagFor('contact.html') +
    '</head><body><div id="root">' +
    `<iframe title="${fr.mapIframeTitle.replace('{address}', CONTACT.address)}"></iframe>` +
    '</div>' +
    preload('Contact') +
    '</body></html>',
  'support.html':
    '<!doctype html><html><head>' +
    `<link rel="canonical" href="${SITE_ORIGIN}/support" />` +
    ogTagFor('support.html') +
    '</head><body><div id="root">' +
    '<h1 class="text-3xl font-bold text-gray-900 mb-2">Support</h1>' +
    '<p>Suivre une demande existante</p>' +
    '<a href="tel:+221000000000">Appeler</a><a href="mailto:x@kojo.app">Écrire</a>' +
    '<a href="https://wa.me/221000000000">WhatsApp</a><a href="/how-it-works">Comment ça marche</a>' +
    '</div>' +
    preload('Support') +
    '</body></html>',
  'app.html':
    '<!doctype html><html><head>' +
    `<title>${fr.neutralTitle}</title>` +
    `<meta name="description" content="${fr.neutralDescription}" />` +
    `<meta property="og:title" content="${fr.neutralTitle}" />` +
    `<meta property="og:description" content="${fr.neutralDescription}" />` +
    `<meta name="twitter:title" content="${fr.neutralTitle}" />` +
    `<meta name="twitter:description" content="${fr.neutralDescription}" />` +
    '<meta name="robots" content="noindex, follow" /></head><body><div id="root"></div></body></html>',
  '404.html':
    '<!doctype html><html lang="fr"><head><meta name="robots" content="noindex">' +
    `<title>${fr.notFoundMetaTitle}</title></head><body><main>` +
    `<h1>${fr.notFoundTitle}</h1><p>${fr.notFoundText}</p><nav>` +
    `<a href="/">${fr.home}</a><a href="/jobs">${fr.notFoundJobsLink}</a>` +
    `<a href="/how-it-works">${fr.howItWorksTitle}</a>` +
    `<a href="mailto:x@kojo.app">${fr.contactTitle}</a>` +
    '</nav></main></body></html>',
});

/** Les rewrites Vercel attendus : chaque page pré-rendue est atteignable. */
const rewritesFor = (files) =>
  files
    .filter((f) => !['index.html', '404.html', 'app.html'].includes(f))
    .flatMap((file) => {
      const route = file.replace(/\.html$/, '');
      return [
        { source: `/${route}`, destination: `/${file}` },
        { source: `/${route}/`, destination: `/${file}` },
      ];
    });

// Les modules de pré-rendu qui publient une coquille : le garde exige qu'AUCUN
// ne recopie un glyphe publié. La fixture les COPIE du dépôt — la règle porte
// donc sur du vrai code, jamais sur une recopie de la liste — et un cas négatif
// peut en réécrire un pour exiger le refus nommé.
const MODULES_PRE_RENDU = [
  'prerender-route-meta.js',
  'prerender/app-template.js',
  'prerender/declared-body.js',
  'prerender/not-found.js',
  'prerender/route-meta.js',
  'prerender/shells-home.js',
  'prerender/shells-routes.js',
];

/** Copie les modules de pré-rendu réels dans la racine de la fixture. */
const copieModules = (dir) => {
  for (const rel of MODULES_PRE_RENDU) {
    const cible = path.join(dir, 'vite-plugins', rel);
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.copyFileSync(path.join(FRONTEND_DIR, 'vite-plugins', rel), cible);
  }
};

/**
 * Écrit une arborescence de build FIXTURE et retourne sa racine.
 * `mutate` reçoit les pages et la config de rewrites ÉCRITS, et peut les altérer
 * (retirer un fichier, vider un shell, réintroduire le catch-all, réécrire un
 * module de pré-rendu…).
 */
const fixture = (mutate) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-shells-'));
  tempDirs.push(dir);
  const build = path.join(dir, 'build');
  fs.mkdirSync(build, { recursive: true });
  copieModules(dir);
  // La vue PAGE du build : un chunk applicatif (les `vendor*` sont hors surface,
  // donc la fixture en pose un aussi pour prouver l'exclusion). Écrits AVANT
  // `mutate`, qui peut les réécrire pour exiger un refus nommé.
  fs.mkdirSync(path.join(build, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(build, 'assets', 'app-abc123.js'), 'export const copie = "Salut";\n');
  fs.writeFileSync(path.join(build, 'assets', 'vendor-abc123.js'), 'export const dep = 1;\n');

  const html = pages();
  const files = [...Object.keys(html), ...CLIENT_PAGES];
  let config = { rewrites: rewritesFor(files), cleanUrls: true };

  if (mutate) {
    const out = mutate({ html, files, config });
    if (out) {
      config = out.config || config;
      for (const [rel, contenu] of Object.entries(out.modules || {})) {
        fs.writeFileSync(path.join(dir, 'vite-plugins', rel), contenu);
      }
      // Fichiers supplémentaires DANS le build (chunks de la vue page, coquilles
      // écrites à la main) : le contrôle de l'apostrophe publiée lit le build.
      for (const [rel, contenu] of Object.entries(out.files || {})) {
        const cible = path.join(build, rel);
        fs.mkdirSync(path.dirname(cible), { recursive: true });
        fs.writeFileSync(cible, contenu);
      }
    }
  }

  for (const [name, contenu] of Object.entries(html)) {
    fs.writeFileSync(path.join(build, name), contenu);
  }
  fs.writeFileSync(path.join(dir, 'vercel.json'), JSON.stringify(config, null, 2));
  return dir;
};

/**
 * Exécute le VRAI garde, avec `cwd` sur la fixture, SANS bloquer la boucle
 * d'événements du worker.
 *
 * `spawnSync` rendait ce fichier muet pour la machine qui l'exécute : les 43 cas
 * lancent chacun un Node (~1,4 s) et s'enchaînaient dans un seul tour de boucle
 * — les `await` de vitest ne cèdent que des micro-tâches — mesuré à **62 000 ms
 * de famine** sur un worker. Au-delà du délai RPC de vitest (60 s), l'horloge
 * expirée de `onTaskUpdate` se déclenchait à la reprise : la suite sortait en 1
 * sur un timeout qui ne disait rien du code, et seulement sur un poste assez
 * lent pour que 43 lancements franchissent la minute. Un `spawn` asynchrone
 * rend la main entre les cas : le worker reste joignable, la mesure est la même.
 */
const runGuard = (cwd) =>
  new Promise((resolve) => {
    const enfant = spawn(process.execPath, [SCRIPT], { cwd });
    let out = '';
    enfant.stdout.setEncoding('utf8');
    enfant.stderr.setEncoding('utf8');
    enfant.stdout.on('data', (bloc) => (out += bloc));
    enfant.stderr.on('data', (bloc) => (out += bloc));
    enfant.on('close', (status) => resolve({ status, out }));
  });

describe('check-prerender-shells — la fixture conforme passe', () => {
  it('sort en 0 et nomme les pages pré-rendues routées', async () => {
    const { status, out } = await runGuard(fixture());
    expect(out).not.toContain('❌');
    expect(status).toBe(0);
    expect(out).toContain('Pré-rendu par route intact');
    // Les 7 pages pré-rendues de la fixture (hors index, 404 et app).
    expect(out).toContain('jobs.html');
    expect(out).toContain('support.html');
  });
});

describe('check-prerender-shells — chaque refus sait mordre', () => {
  const cas = [
    {
      nom: 'shell d\'accueil vide (#root)',
      mutate: ({ html }) => {
        html['index.html'] = html['index.html'].replace(
          /<div id="root">[\s\S]*?<\/div>/,
          '<div id="root"></div>'
        );
      },
      attendu: 'est VIDE',
    },
    {
      nom: 'modulepreload du chunk Home retiré',
      mutate: ({ html }) => {
        html['index.html'] = html['index.html'].replace(/<link rel="modulepreload"[^>]*>/, '');
      },
      attendu: 'modulepreload du chunk Home',
    },
    {
      nom: 'h1 du shell login retiré',
      mutate: ({ html }) => {
        html['login.html'] = html['login.html'].replace(/<h1[^>]*>Connexion<\/h1>/, '');
      },
      attendu: 'h1 « Connexion » absent',
    },
    {
      nom: 'champ de formulaire register retiré',
      mutate: ({ html }) => {
        html['register.html'] = html['register.html'].replace(
          'placeholder="exemple@email.com"',
          ''
        );
      },
      attendu: 'champ de formulaire « exemple@email.com » ABSENT',
    },
    {
      nom: 'masque téléphone du register retiré',
      mutate: ({ html }) => {
        html['register.html'] = html['register.html'].replace(`placeholder="${phoneNumberExample()}"`, '');
      },
      attendu: 'masque téléphone',
    },
    {
      nom: 'préfixe téléphone du register remplacé par celui du masque',
      mutate: ({ html }) => {
        html['register.html'] = html['register.html'].replace(
          `>${PHONE_PREFIX_FALLBACK}</span>`,
          '>---</span>'
        );
      },
      attendu: 'préfixe téléphone',
    },
    {
      nom: 'ligne des formats photo du register modifiée',
      mutate: ({ html }) => {
        html['register.html'] = html['register.html'].replace(
          photoFormatsLine(registerT('upTo')),
          'JPG 9MB'
        );
      },
      attendu: 'lignes des formats photo',
    },
    {
      nom: 'placeholder pays du register retiré',
      mutate: ({ html }) => {
        html['register.html'] = html['register.html'].replace(COUNTRY_PLACEHOLDER(fr.country), 'Pays');
      },
      attendu: 'placeholder pays',
    },
    ...appMetaMutations.map(([nom, source, mutation, attendu]) => ({
      nom: `métadonnée ${nom} d’app.html modifiée`,
      mutate: ({ html }) => {
        html['app.html'] = html['app.html'].replace(source, mutation);
      },
      attendu,
    })),
    {
      nom: 'titre d’iframe de l’accueil retiré',
      mutate: ({ html }) => {
        html['index.html'] = html['index.html'].replace(
          `title="${fr.mapIframeTitle.replace('{address}', CONTACT.address)}"`,
          ''
        );
      },
      attendu: "titre d'iframe",
    },
    {
      nom: 'ligne de contact retirée du shell d\'accueil (zone sans garde avant)',
      mutate: ({ html }) => {
        html['index.html'] = html['index.html'].replace(fr.homeContactCall, '');
      },
      attendu: 'absent de la coquille (section contact / pied de page)',
    },
    {
      // La page et la coquille lisent le MÊME dictionnaire : si la coquille
      // publie l'apostrophe droite là où sa page publie la typographique,
      // l'octet publié diverge — c'est ce que la bascule a fermé.
      nom: 'apostrophe droite dans une notice du shell (page vs coquille)',
      mutate: ({ html }) => {
        const juste = registerT('legalConsentHelp');
        html['register.html'] = html['register.html'].replace(
          juste,
          juste.replace(/\u2019/g, APOSTROPHE_REFUSEE)
        );
      },
      attendu: "absent du shell (notices et consentement de l'étape register)",
    },
    {
      nom: 'texte de la carte « mission requise » retiré',
      mutate: ({ html }) => {
        html['payment.html'] = html['payment.html'].replace(fr.paymentPageNoJobText, '');
      },
      attendu: 'texte de la carte « mission requise » absent du shell',
    },
    {
      nom: 'titre d’iframe de contact retiré',
      mutate: ({ html }) => {
        html['contact.html'] = html['contact.html'].replace(
          `title="${fr.mapIframeTitle.replace('{address}', CONTACT.address)}"`,
          ''
        );
      },
      attendu: 'contact.html : titre d\'iframe',
    },
    {
      nom: 'titre de la carte retiré (gabarit lu dans le dictionnaire)',
      mutate: ({ html }) => {
        html['index.html'] = html['index.html'].replace(
          `title="${fr.mapIframeTitle.replace('{address}', CONTACT.address)}"`,
          ''
        );
      },
      attendu: "titre d'iframe",
    },
    {
      nom: 'titre du bloc social retiré (bloc émis)',
      mutate: ({ html }) => {
        html['index.html'] = html['index.html'].replace(fr.homeContactFollow, '');
      },
      attendu: 'bloc social est publié sans son titre',
    },
    {
      nom: 'texte de la page 404 retiré',
      mutate: ({ html }) => {
        html['404.html'] = html['404.html'].replace(fr.notFoundJobsLink, '');
      },
      attendu: "absent de la page d'une URL inconnue",
    },
    {
      nom: 'og:image d\'une coquille retiré (lu dans la table unique)',
      mutate: ({ html }) => {
        html['jobs.html'] = html['jobs.html'].replace(ogTagFor('jobs.html'), '');
      },
      attendu: 'og:image /og-jobs.png manquant',
    },
    {
      nom: 'page pré-rendue absente du build',
      mutate: ({ html }) => {
        delete html['forgot-password.html'];
      },
      attendu: 'build/forgot-password.html introuvable',
    },
    {
      nom: 'page pré-rendue non routée par Vercel (un seul des deux sources)',
      mutate: ({ files }) => ({
        config: { rewrites: rewritesFor(files).filter((r) => r.source !== '/payment/') },
      }),
      attendu: 'rewrite « /payment/ » → « /payment.html » absent ou erroné',
    },
    {
      nom: 'catch-all « /(.*) » réintroduit',
      mutate: ({ files }) => ({
        config: {
          rewrites: [{ source: '/(.*)', destination: '/index.html' }, ...rewritesFor(files)],
        },
      }),
      attendu: 'catch-all « /(.*) » est revenue',
    },
    {
      nom: 'vercel.json illisible',
      mutate: () => ({ config: null }),
      attendu: 'frontend/vercel.json illisible',
    },
    {
      // Le motif de ce découpage : un fragment publié recopié au lieu d'être lu
      // depuis sa clé. Le glyphe interdit est LU dans le dictionnaire par le
      // garde (iconLegalNotice = 📜), donc ce cas ne peut pas dériver de lui.
      nom: 'glyphe publié recopié dans un module de pré-rendu',
      mutate: () => ({
        modules: {
          'prerender/shells-routes.js':
            'export const coquille = `<p class="text-sm">📜 Avis légal</p>`;\n',
        },
      }),
      attendu: 'publie « 📜 » en littéral',
    },
    {
      nom: 'module de pré-rendu renommé',
      mutate: () => ({ supprimeModule: 'prerender/shells-home.js' }),
      attendu: 'vite-plugins/prerender/shells-home.js introuvable',
    },
    {
      // Vue CRAWLER : la coquille publie l'apostrophe droite, donc sa page et
      // elle n'afficheraient pas les mêmes octets pour le même mot.
      nom: 'coquille publiant l\'apostrophe droite',
      mutate: ({ html }) => {
        html['login.html'] = html['login.html'].replace(
          '</body>',
          `<p>Une adresse${APOSTROPHE_REFUSEE}introuvable</p></body>`
        );
      },
      attendu: 'login.html',
    },
    {
      // Vue PAGE : le chunk applicatif du build publie l'autre convention.
      nom: 'chunk applicatif publiant l\'apostrophe droite',
      mutate: () => ({
        files: {
          'assets/app-abc123.js': `export const copie = "Une adresse${APOSTROPHE_REFUSEE}introuvable";\n`,
        },
      }),
      attendu: 'app-abc123.js',
    },
  ];

  for (const { nom, mutate, attendu } of cas) {
    it(`refuse : ${nom}`, async () => {
      const dir = fixture(mutate);
      if (nom === 'vercel.json illisible') {
        fs.writeFileSync(path.join(dir, 'vercel.json'), '{ ce n\'est pas du JSON');
      }
      if (nom === 'module de pré-rendu renommé') {
        fs.rmSync(path.join(dir, 'vite-plugins', 'prerender', 'shells-home.js'));
      }
      const { status, out } = await runGuard(dir);
      expect(status).toBe(1);
      expect(out).toContain(attendu);
      expect(out).toContain('Pré-rendu par route invalide');
    });
  }

  it('nomme l’apostrophe fautive quand une surface en porte une', async () => {
    const { out } = await runGuard(
      fixture(() => ({
        files: { 'assets/app-abc123.js': `export const copie = "d${APOSTROPHE_REFUSEE}un";\n` },
      }))
    );
    expect(out).toContain('apostrophe de copie');
    expect(out).toContain(`« ${APOSTROPHE_PUBLIEE} »`);
  });

  it('laisse un chunk `vendor*` hors surface (la copie publiée vient de l’app)', async () => {
    const dir = fixture(() => ({
      files: { 'assets/vendor-abc123.js': `export const dep = "d${APOSTROPHE_REFUSEE}un";\n` },
    }));
    const { status, out } = await runGuard(dir);
    expect(out).not.toContain('apostrophe de copie');
    expect(status).toBe(0);
  });
});

describe('published-copy — la règle de l’apostrophe publiée', () => {
  const ecrire = (contenu) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'published-copy-'));
    tempDirs.push(dir);
    const fichier = path.join(dir, 'extrait.js');
    fs.writeFileSync(fichier, contenu);
    return fichier;
  };

  it('nomme chaque occurrence publiée, avec sa ligne et son extrait', () => {
    const fichier = ecrire(`const titre = "d${APOSTROPHE_REFUSEE}un" ;\n`);
    const violations = apostrophesHorsConvention([fichier]);
    expect(violations).toHaveLength(1);
    expect(violations[0].ligne).toBe(1);
    expect(violations[0].extrait).toContain(`d${APOSTROPHE_REFUSEE}un`);
  });

  it('ignore les commentaires — ils ne publient rien', () => {
    const fichier = ecrire(
      `// on dit d${APOSTROPHE_REFUSEE}un texte publié\n` +
        `/* et l${APOSTROPHE_REFUSEE}accueil */\n` +
        `const a = 1;\n`
    );
    expect(apostrophesHorsConvention([fichier])).toEqual([]);
  });

  it('plafonne les occurrences relevées par fichier', () => {
    const fichier = ecrire(
      Array.from({ length: 9 }, () => `const a = "d${APOSTROPHE_REFUSEE}un";`).join('\n')
    );
    expect(apostrophesHorsConvention([fichier], { parFichier: 3 })).toHaveLength(3);
  });

  // ── Ce que le caractère refusé est PRÉCISÉMENT ──────────────────────────
  // L'apostrophe de copie joint deux lettres. Partout ailleurs, la même quote
  // est le DÉLIMITEUR d'une chaîne de code : la refuser rendrait le contrôle
  // impossible à satisfaire (mesuré sur l'arbre : 350 littéraux signalés pour
  // 296 occurrences de copie) et ne dirait rien de la copie.
  it('ne refuse pas la quote qui délimite du code, ni une citation isolée', () => {
    const fichier = ecrire(
      `const classe = \`flex \${actif ? 'text-white' : 'text-black'}\`;\n` +
        `const quote = "'";\n` +
        `const selecteur = "[data-etat='actif']";\n` +
        `const style = { flex: \`flex \${actif ? 'a' : 'b'}\` };\n`
    );
    expect(apostrophesHorsConvention([fichier])).toEqual([]);
  });

  it('refuse l’apostrophe qui joint deux lettres, d’un côté comme de l’autre', () => {
    expect(apostrophesDeCopie(`l${APOSTROPHE_REFUSEE}emploi`)).toHaveLength(1);
    expect(apostrophesDeCopie(`Kojo${APOSTROPHE_REFUSEE}s secured`)).toHaveLength(1);
    expect(apostrophesDeCopie(`t${APOSTROPHE_REFUSEE}a (bambara)`)).toHaveLength(1);
    expect(apostrophesDeCopie(`1${APOSTROPHE_REFUSEE}000`)).toEqual([]);
    expect(apostrophesDeCopie(`'`)).toEqual([]);
  });

  // La copie d'un nœud de texte JSX n'est pas un littéral dans les sources : le
  // contrôle doit la lire LÀ où elle s'écrit, sinon le seul refus tomberait sur
  // le chunk du build, dont le nom change à chaque build.
  it('lit la copie des nœuds de texte JSX, hors littéraux', () => {
    const fichier = ecrire(
      `export const Carte = () => (\n` +
        `  <p className="text-sm">\n` +
        `    Une adresse${APOSTROPHE_REFUSEE}introuvable\n` +
        `  </p>\n` +
        `);\n`
    );
    const violations = apostrophesHorsConvention([fichier]);
    expect(violations).toHaveLength(1);
    expect(violations[0].ligne).toBe(3);
    expect(violations[0].extrait).toContain(`adresse${APOSTROPHE_REFUSEE}introuvable`);
  });

  it('accepte la copie JSX qui porte l’apostrophe publiée', () => {
    const fichier = ecrire(
      `export const Carte = () => <p>Une adresse${APOSTROPHE_PUBLIEE}introuvable</p>;\n`
    );
    expect(apostrophesHorsConvention([fichier])).toEqual([]);
  });

  it('signale une surface illisible plutôt que de la sauter en silence', () => {
    const violations = apostrophesHorsConvention(['/chemin/qui/n/existe/pas.js']);
    expect(violations).toHaveLength(1);
    expect(violations[0].extrait).toContain('illisible');
  });
});

describe('check-prerender-shells — câblage', () => {
  it('le garde est bien une étape du job frontend-build', () => {
    const workflow = fs.readFileSync(
      path.join(FRONTEND_DIR, '..', '.github', 'workflows', 'ci.yml'),
      'utf8'
    );
    expect(workflow).toContain('node scripts/check-prerender-shells.js');
    expect(workflow).toContain('npm run build');
  });
});
