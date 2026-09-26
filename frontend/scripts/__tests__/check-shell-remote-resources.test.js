/**
 * Tests des ressources distantes des coquilles.
 *
 * Deux niveaux, comme les autres gardes du dépôt :
 *
 *   1. la RÈGLE (`scripts/shell-remote-resources.js`) — ce qui déclenche un
 *      téléchargement (et ce qui n'en déclenche pas), ce qui est distant, et le
 *      sort des `rel` ;
 *   2. le GARDE (`scripts/check-shell-remote-resources.js`) exécuté en
 *      sous-processus sur une arborescence `build/` FIXTURE : les refus prouvés
 *      portent donc sur le garde réellement exécuté par la CI, pas sur une
 *      paraphrase de sa règle.
 *
 * Une précision sur les fixtures du second niveau : le garde refuse un build
 * dont le nombre de ressources lues tombe sous son PLANCHER (100). Les cas qui
 * éprouvent la RÈGLE doivent donc satisfaire ce plancher — sinon tous
 * rougiraient pour la même raison, et le refus attendu serait masqué. D'où
 * `rembourrage()` : des icônes mêmes-origine, sans effet sur la règle, qui
 * portent le compte au-dessus du plancher. Le plancher lui-même a son cas.
 *
 * Le dernier bloc lit l'ARBRE RÉEL : les sources qui écrivent les coquilles
 * (`src/`, `vite-plugins/`, `index.html`) ne déclarent aucune ressource tierce.
 * C'est le contrôle le plus en amont possible — il rougit avant le build, là où
 * le garde, lui, juge ce qui est publié.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { API_ORIGIN, SITE_ORIGIN } from '../site-meta.js';
import {
  candidatsDeSrcset,
  divergencesDeRessources,
  estDistante,
  origineDe,
  relsDe,
  ressourcesCss,
  ressourcesDeclarees,
  sorteDeRel,
} from '../shell-remote-resources.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(FRONTEND_DIR, 'scripts', 'check-shell-remote-resources.js');
const ORIGINES = [SITE_ORIGIN, API_ORIGIN];

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-ressources-'));
  tempDirs.push(dir);
  return dir;
};

const coquille = (dir, nom, html) => {
  const build = path.join(dir, 'build');
  fs.mkdirSync(build, { recursive: true });
  const fichier = path.join(build, nom);
  fs.writeFileSync(fichier, html);
  return fichier;
};

/** Des ressources mêmes-origine, pour franchir le plancher de lecture du garde. */
const rembourrage = (nombre = 105) =>
  Array.from({ length: nombre }, (un, i) => `<link rel="icon" href="/icons/icon-${i}.png" />`).join('');

/**
 * Exécute le VRAI garde, avec `cwd` sur la fixture, SANS bloquer la boucle
 * d'événements du worker (le fichier voisin `check-prerender-shells.test.js` a
 * été mesuré à 62 000 ms de famine avec `spawnSync`, au-delà du délai RPC de
 * vitest).
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

describe('shell-remote-resources — ce qui déclenche un téléchargement', () => {
  it('lit chaque attribut de ressource d’une balise, srcset candidat par candidat', () => {
    const html =
      '<div id="root"><iframe src="/carte.html"></iframe>' +
      '<img src="/a.png" srcset="/b.png 1x, /c.png 2x" alt="x" />' +
      '<script src="/assets/entree.js"></script><video src="/v.mp4" poster="/p.jpg"></video></div>';
    const lues = ressourcesDeclarees(html).map((r) => `${r.balise}:${r.attribut}:${r.url}`);
    expect(lues).toEqual([
      'iframe:src:/carte.html',
      'img:src:/a.png',
      'img:srcset:/b.png',
      'img:srcset:/c.png',
      'script:src:/assets/entree.js',
      'video:src:/v.mp4',
      'video:poster:/p.jpg',
    ]);
    expect(candidatsDeSrcset('/b.png 1x, /c.png 2x')).toEqual(['/b.png', '/c.png']);
  });

  it('lit une ressource déclarée par un attribut style, entités résolues', () => {
    // Le navigateur résout `&quot;` : `url(&quot;/fond.png&quot;)` EST un url()
    // avec une URL entre guillemets. Sans cette résolution, une déclaration
    // distante écrite en références serait lue comme un chemin relatif.
    const html = '<div style="background-image: url(&quot;https://cdn.test/f.png&quot;)"></div>';
    expect(ressourcesDeclarees(html)).toEqual([
      {
        balise: 'div',
        attribut: 'style',
        url: 'https://cdn.test/f.png',
        sorte: 'ressource',
        motif: 'url()',
      },
    ]);
    expect(ressourcesDeclarees('<div style="background: url(/fond.png)"></div>')[0].url).toBe('/fond.png');
  });

  it('ignore la NAVIGATION et les DONNÉES : ni a[href], ni le JSON-LD', () => {
    // Un lien ne part qu'à l'appui (c'est le contrat de la carte différée), et
    // les URL absolues du JSON-LD sont une donnée pour les moteurs, pas un
    // téléchargement : les compter serait le premier faux positif du garde.
    const html =
      '<a href="https://wa.me/22300000000" rel="noreferrer">WhatsApp</a>' +
      '<script type="application/ld+json">{"url":"https://kojoforafrica.cc.cd/","image":"https://x.test/a.png"}</script>';
    expect(ressourcesDeclarees(html)).toEqual([]);
  });

  it('classe un rel : ressource, sans téléchargement, ou NON CLASSÉ', () => {
    expect(sorteDeRel('icon')).toBe('ressource');
    expect(sorteDeRel('preconnect')).toBe('ressource');
    expect(sorteDeRel('shortcut icon')).toBe('ressource');
    expect(sorteDeRel('canonical')).toBe('sans-telechargement');
    expect(sorteDeRel('alternate')).toBe('sans-telechargement');
    expect(sorteDeRel('preload stylesheet')).toBe('ressource');
    expect(sorteDeRel('quelque-chose-de-neuf')).toBe('non-classe');
    expect(sorteDeRel('')).toBe('non-classe');
    expect(relsDe('preload stylesheet')).toEqual(['preload', 'stylesheet']);
  });

  it('refuse un <link> de rel inconnu plutôt que de le supposer inoffensif', () => {
    const lues = ressourcesDeclarees('<link rel="moduleprefetch" href="/assets/a.js" />');
    expect(lues).toHaveLength(1);
    expect(lues[0]).toMatchObject({ sorte: 'rel-non-classe', rel: 'moduleprefetch' });
  });

  it('ne lit pas l’URL d’un rel sans téléchargement', () => {
    expect(ressourcesDeclarees(`<link rel="canonical" href="${SITE_ORIGIN}/about" />`)).toEqual([]);
  });
});

describe('shell-remote-resources — ce qui est distant', () => {
  it('accepte le relatif, les schémas locaux et nos deux origines', () => {
    for (const url of [
      '/assets/index.js',
      'assets/index.js',
      './x.png',
      '#ancre',
      'data:image/png;base64,AAAA',
      'blob:https://kojoforafrica.cc.cd/1',
      `${SITE_ORIGIN}/icons/icon-512x512.png`,
      `${API_ORIGIN}/api/og/jobs/1`,
    ]) {
      expect(`${url} → ${estDistante(url, ORIGINES)}`).toBe(`${url} → false`);
    }
  });

  it('refuse toute autre origine, y compris en relatif au protocole', () => {
    for (const url of [
      'https://fonts.gstatic.com/s/inter.woff2',
      'https://www.google.com/maps?q=x&output=embed',
      'http://kojoforafrica.cc.cd/x.js',
      '//cdn.test/a.png',
      'https://x.test//kojoforafrica.cc.cd/a.png',
      'https://kojoforafrica.cc.cd.attaquant.test/a.png',
    ]) {
      expect(`${url} → ${estDistante(url, ORIGINES)}`).toBe(`${url} → true`);
    }
  });

  it('lit l’origine d’une URL, et ne présume pas du protocole d’un //hôte', () => {
    expect(origineDe('/local.png')).toBeNull();
    expect(origineDe(`${SITE_ORIGIN}/a`)).toBe(SITE_ORIGIN);
    expect(origineDe('//CDN.test/a')).toBe('//cdn.test');
    expect(estDistante('//kojoforafrica.cc.cd/a.png', ORIGINES)).toBe(false);
  });
});

describe('shell-remote-resources — le CSS publié par la coquille', () => {
  it('lit url(), @import et CHAQUE candidat d’image-set(), une seule fois par déclaration', () => {
    const css =
      '@import url("/pack.css");' +
      '@import "https://cdn.test/base.css";' +
      '@font-face { src: url("https://cdn.test/inter.woff2") format("woff2"); }' +
      '.a { background: url(/fond.png) }' +
      '.b { background-image: image-set("https://cdn.test/a.avif" 1x, "/b.png" 2x) }' +
      '.c { background: url(data:image/png;base64,AAAA) }';
    const lues = ressourcesCss(css);
    // Les @import d'abord, puis url()/image-set() dans l'ORDRE du document —
    // et `/pack.css` une seule fois : un `@import url(…)` est UNE déclaration,
    // pas un import suivi d'une url() orpheline.
    expect(lues).toEqual([
      { motif: '@import', url: '/pack.css' },
      { motif: '@import', url: 'https://cdn.test/base.css' },
      { motif: 'url()', url: 'https://cdn.test/inter.woff2' },
      { motif: 'url()', url: '/fond.png' },
      { motif: 'image-set()', url: 'https://cdn.test/a.avif' },
      { motif: 'image-set()', url: '/b.png' },
      { motif: 'url()', url: 'data:image/png;base64,AAAA' },
    ]);
    expect(lues.filter((r) => estDistante(r.url, ORIGINES)).map((r) => r.url)).toEqual([
      'https://cdn.test/base.css',
      'https://cdn.test/inter.woff2',
      'https://cdn.test/a.avif',
    ]);
  });
});

describe('shell-remote-resources — le verdict', () => {
  const coquillePropre = [
    '<link rel="modulepreload" href="/assets/entree.js" />',
    '<link rel="icon" href="/favicon.ico" />',
    `<link rel="canonical" href="${SITE_ORIGIN}/about" />`,
    '<link rel="apple-touch-startup-image" href="/icons/icon-512x512.png" />',
    '<style>.a{background:url(/fond.png)}</style>',
    '<div id="root"><a href="https://wa.me/223">WhatsApp</a></div>',
    '<script type="application/ld+json">{"image":"https://x.test/a.png"}</script>',
  ].join('');

  const verdict = (html, options = {}) => {
    const fichier = coquille(tmp(), 'page.html', html);
    return {
      fichier,
      trouvees: divergencesDeRessources({
        coquilles: [fichier],
        origines: ORIGINES,
        lire: (f) => fs.readFileSync(f, 'utf8'),
        ...options,
      }),
    };
  };

  it('accepte une coquille qui ne déclare que des ressources mêmes-origine', () => {
    expect(verdict(coquillePropre).trouvees).toEqual([]);
  });

  it('refuse une iframe, un script ou une image tierce, en nommant la balise et l’URL', () => {
    const fichier = coquille(
      tmp(),
      'page.html',
      '<iframe src="https://www.google.com/maps?q=Mali&output=embed"></iframe>' +
        '<script src="https://cdn.test/a.js"></script>' +
        '<img src="/local.png" srcset="https://cdn.test/a.png 1x" />'
    );
    const trouvees = divergencesDeRessources({
      coquilles: [fichier],
      origines: ORIGINES,
      lire: (f) => fs.readFileSync(f, 'utf8'),
    });
    expect(trouvees.map((d) => `${d.balise}:${d.url}`)).toEqual([
      'iframe:https://www.google.com/maps?q=Mali&output=embed',
      'script:https://cdn.test/a.js',
      'img:https://cdn.test/a.png',
    ]);
    expect(trouvees.every((d) => d.sorte === 'ressource-distante')).toBe(true);
    expect(trouvees.every((d) => d.coquille === fichier)).toBe(true);
  });

  it('refuse un @font-face tiers publié dans le CSS EN LIGNE', () => {
    const { fichier, trouvees } = verdict('<style>@font-face{src:url(https://cdn.test/i.woff2)}</style>');
    expect(trouvees).toEqual([
      {
        sorte: 'css-distante',
        coquille: fichier,
        balise: 'style',
        attribut: 'url()',
        url: 'https://cdn.test/i.woff2',
      },
    ]);
  });

  it('suit une FEUILLE LIÉE mêmes-origine, et un @import en relais', () => {
    const dir = tmp();
    const build = path.join(dir, 'build');
    fs.mkdirSync(path.join(build, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(build, 'assets', 'app.css'), '@import "/assets/relais.css";\n.a{color:red}\n');
    fs.writeFileSync(
      path.join(build, 'assets', 'relais.css'),
      '@font-face{src:url("https://cdn.test/f.woff2")}\n'
    );
    const html = '<link rel="stylesheet" href="/assets/app.css" />';
    const fichier = coquille(dir, 'page.html', html);
    const trouvees = divergencesDeRessources({
      coquilles: [fichier],
      origines: ORIGINES,
      buildDir: build,
      lire: (f) => {
        try {
          return fs.readFileSync(f, 'utf8');
        } catch {
          return null;
        }
      },
    });
    expect(trouvees).toEqual([
      {
        sorte: 'css-distante',
        coquille: fichier,
        // La feuille NOMMÉE est celle où la déclaration s'écrit (le relais),
        // pas celle qui l'a relayée : c'est là qu'un lecteur doit ouvrir.
        balise: '/assets/relais.css',
        attribut: 'url()',
        url: 'https://cdn.test/f.woff2',
      },
    ]);
  });

  it('refuse une feuille liée que le build ne contient pas (contrôle impossible)', () => {
    const dir = tmp();
    const build = path.join(dir, 'build');
    const fichier = coquille(dir, 'page.html', '<link rel="stylesheet" href="/assets/absent.css" />');
    const trouvees = divergencesDeRessources({
      coquilles: [fichier],
      origines: ORIGINES,
      buildDir: build,
      // La coquille est lisible, la FEUILLE ne l'est pas : c'est le cas éprouvé.
      lire: (f) => (f === fichier ? fs.readFileSync(f, 'utf8') : null),
    });
    expect(trouvees).toEqual([
      { sorte: 'css-illisible', coquille: fichier, url: '/assets/absent.css' },
    ]);
  });

  it('refuse un rel non classé, et une coquille illisible', () => {
    const trouvees = divergencesDeRessources({
      coquilles: ['/inexistant.html'],
      origines: ORIGINES,
      lire: () => null,
    });
    expect(trouvees.map((d) => d.sorte)).toEqual(['coquille-illisible']);
    expect(verdict('<link rel="moduleprefetch" href="/a.js" />').trouvees[0]).toMatchObject({
      sorte: 'rel-non-classe',
      rel: 'moduleprefetch',
    });
  });
});

describe('check-shell-remote-resources — le garde exécuté', () => {
  it('sort en 0 sur une coquille qui ne déclare que des ressources mêmes-origine', async () => {
    const dir = tmp();
    coquille(
      dir,
      'index.html',
      `${rembourrage()}<link rel="modulepreload" href="/assets/entree.js" />` +
        `<link rel="canonical" href="${SITE_ORIGIN}/" /><style>.a{background:url(/fond.png)}</style>`
    );
    const { status, out } = await runGuard(dir);
    expect(out).toContain('Ressources des coquilles');
    expect(status).toBe(0);
  });

  it('refuse : une iframe tierce, en nommant l’URL et la coquille', async () => {
    const dir = tmp();
    coquille(
      dir,
      'index.html',
      `${rembourrage()}<iframe src="https://www.google.com/maps?q=Mali&output=embed"></iframe>`
    );
    const { status, out } = await runGuard(dir);
    // La première assertion nomme la RÈGLE : c'est elle qui doit apparaître dans
    // la sortie si la ligne du verdict est neutralisée (preuve de mutation).
    expect(out).toContain('déclaration(s) refusée(s) dans le premier écran');
    expect(out).toContain(
      'index.html déclare <iframe src> sur une origine tierce : https://www.google.com/maps?q=Mali&output=embed'
    );
    expect(out).toContain('MapEmbed.js');
    expect(status).toBe(1);
  });

  it('refuse : un @font-face tiers dans le CSS publié', async () => {
    const dir = tmp();
    coquille(dir, 'index.html', `${rembourrage()}<style>@font-face{src:url(https://cdn.test/i.woff2)}</style>`);
    const { status, out } = await runGuard(dir);
    expect(out).toContain('publie du CSS qui télécharge une ressource tierce (url())');
    expect(out).toContain('https://cdn.test/i.woff2');
    expect(status).toBe(1);
  });

  it('refuse : un rel non classé, en disant où le classer', async () => {
    const dir = tmp();
    coquille(dir, 'index.html', `${rembourrage()}<link rel="moduleprefetch" href="/a.js" />`);
    const { status, out } = await runGuard(dir);
    expect(out).toContain('personne n\'a classé');
    expect(out).toContain('shell-remote-resources.js');
    expect(status).toBe(1);
  });

  it('refuse : un build sans coquille (vert sans lecture)', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
    const { status, out } = await runGuard(dir);
    expect(status).toBe(1);
    expect(out).toContain('aucune coquille dans build/');
  });

  it('refuse : un plancher de lecture non atteint, plutôt qu’un vert silencieux', async () => {
    // Un lecteur cassé rendrait 0 ressource et passerait pour un vert : la
    // coquille de ce cas est propre, seule la LECTURE est en cause.
    const dir = tmp();
    coquille(dir, 'index.html', '<link rel="icon" href="/favicon.ico" />');
    const { status, out } = await runGuard(dir);
    expect(out).toContain('sous le plancher de 100');
    expect(out).toContain('un vert sans lecture est un faux vert');
    expect(status).toBe(1);
  });
});

describe('check-shell-remote-resources — l’arbre réel', () => {
  it('les sources qui écrivent les coquilles ne déclarent aucune ressource distante', () => {
    const fichiers = [];
    const marcher = (dossier) => {
      for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
        if (entree.name === 'node_modules') continue;
        const chemin = path.join(dossier, entree.name);
        if (entree.isDirectory()) marcher(chemin);
        else if (/\.(js|jsx|html|css)$/.test(entree.name)) fichiers.push(chemin);
      }
    };
    marcher(path.join(FRONTEND_DIR, 'src'));
    marcher(path.join(FRONTEND_DIR, 'vite-plugins'));
    fichiers.push(path.join(FRONTEND_DIR, 'index.html'));

    // Le contrôle le plus en amont : il rougit AVANT le build, là où le garde
    // juge ce qui est publié. Mesuré sur l'arbre réel : 189 fichiers, 0 distante.
    expect(fichiers.length).toBeGreaterThan(100);
    const distantes = fichiers.flatMap((fichier) => {
      const source = fs.readFileSync(fichier, 'utf8');
      return [...ressourcesDeclarees(source), ...ressourcesCss(source)]
        .filter((r) => estDistante(r.url, ORIGINES))
        .map((r) => `${path.relative(FRONTEND_DIR, fichier)} → ${r.url}`);
    });
    expect(distantes).toEqual([]);
  });
});
