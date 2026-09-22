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
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ROUTES } from '../check-og-images.js';
import { SITE_ORIGIN, shellFileFor } from '../site-meta.js';

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
    '</head><body><div id="root"><h1>Kojo</h1><p>Contenu statique de l\'accueil</p>' +
    '<a href="/jobs">Emplois</a>' +
    `<h2>${fr.contactTitle}</h2><p>${fr.homeContactText}</p>` +
    `<div>${fr.homeContactCall}</div><div>${fr.contactWhatsapp}</div>` +
    `<div>${fr.contactSendEmail}</div><div>${fr.contactAddress}</div>` +
    `<h3>${fr.homeContactFollow}</h3>` +
    `<a href="/carte">${fr.footerItinerary}</a>` +
    `<a href="/legal">${fr.footerTerms}</a>` +
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
    '<button>S\'inscrire avec Google</button>' +
    '<div class="bg-orange-600">Continuer vers la vérification email</div>' +
    '<input placeholder="Prénom..." /><input placeholder="Nom..." />' +
    '<input placeholder="exemple@email.com" /><input placeholder="--- XX XXX XX XX" />' +
    '<p>Informations légales</p><p>Politique de confidentialité</p>' +
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
    '<!doctype html><html><head><title>Kojo</title></head><body><div id="root"></div></body></html>',
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

/**
 * Écrit une arborescence de build FIXTURE et retourne sa racine.
 * `mutate` reçoit les pages et la config de rewrites ÉCRITS, et peut les altérer
 * (retirer un fichier, vider un shell, réintroduire le catch-all…).
 */
const fixture = (mutate) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-shells-'));
  tempDirs.push(dir);
  const build = path.join(dir, 'build');
  fs.mkdirSync(build, { recursive: true });

  const html = pages();
  const files = [...Object.keys(html), ...CLIENT_PAGES];
  let config = { rewrites: rewritesFor(files), cleanUrls: true };

  if (mutate) {
    const out = mutate({ html, files, config });
    if (out) config = out.config || config;
  }

  for (const [name, contenu] of Object.entries(html)) {
    fs.writeFileSync(path.join(build, name), contenu);
  }
  fs.writeFileSync(path.join(dir, 'vercel.json'), JSON.stringify(config, null, 2));
  return dir;
};

/** Exécute le VRAI garde, avec `cwd` sur la fixture. */
const runGuard = (cwd) => {
  const result = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
};

describe('check-prerender-shells — la fixture conforme passe', () => {
  it('sort en 0 et nomme les pages pré-rendues routées', () => {
    const { status, out } = runGuard(fixture());
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
      nom: 'ligne de contact retirée du shell d\'accueil (zone sans garde avant)',
      mutate: ({ html }) => {
        html['index.html'] = html['index.html'].replace(fr.homeContactCall, '');
      },
      attendu: 'absent de la coquille (section contact / pied de page)',
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
  ];

  for (const { nom, mutate, attendu } of cas) {
    it(`refuse : ${nom}`, () => {
      const dir = fixture(mutate);
      if (nom === 'vercel.json illisible') {
        fs.writeFileSync(path.join(dir, 'vercel.json'), '{ ce n\'est pas du JSON');
      }
      const { status, out } = runGuard(dir);
      expect(status).toBe(1);
      expect(out).toContain(attendu);
      expect(out).toContain('Pré-rendu par route invalide');
    });
  }
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
