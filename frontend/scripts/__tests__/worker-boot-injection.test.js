/**
 * LE DOCUMENT /workers/:id A DES CIBLES QUI EXISTENT.
 *
 * Le document d'un profil est écrit par le backend, donc il ne peut pas citer
 * les noms HACHÉS du build : il cite `/boot/worker-boot.js` et
 * `/boot/worker-app.css`, et le build doit écrire CES deux chemins. Ce fichier
 * juge la moitié build du contrat :
 *
 *   • le fichier de boot importe l'entrée que le HTML charge — l'application
 *     n'est donc pas dupliquée sous un nom stable (ce qui l'aurait fait
 *     revalider à chaque visite, ou figer sous `immutable`) ;
 *   • la feuille copiée est celle du HTML, et elle est refusée si elle ne
 *     contient pas la règle témoin (un bloc vide publierait une page nue) ;
 *   • les deux refus du plugin sont des ÉCHECS de build, pas des avis : un
 *     document qui pointe vers un 404 laisserait la page statique et muette ;
 *   • le plugin est bien branché dans vite.config.js.
 *
 * Le contrat du DOCUMENT (les balises du HTML pré-rendu) est jugé par
 * `check-worker-og-contract.test.js`, sur le module Python de production.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SELECTEUR_TEMOIN,
  contenuBoot,
  entreeDuHtml,
  extraireCss,
  workerBootPlugin,
} from '../../vite-plugins/worker-boot.js';
import { APERCU_TRAVAILLEUR } from '../../src/config/apercu-travailleur.js';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const HTML = `<!DOCTYPE html><html><head>
<style>${SELECTEUR_TEMOIN}{font-weight:700}</style>
<script type="module" crossorigin src="/assets/index-Ab12Cd.js"></script>
</head><body><div id="root"></div></body></html>`;

let racine;

const ecrire = (relatif, contenu) => {
  const abs = path.join(racine, relatif);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contenu, 'utf8');
  return abs;
};

const lancerPlugin = () => {
  const plugin = workerBootPlugin();
  plugin.configResolved({ root: racine, build: { outDir: 'build' } });
  return plugin;
};

beforeEach(() => {
  racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-worker-boot-'));
});

afterEach(() => {
  fs.rmSync(racine, { recursive: true, force: true });
});

describe('worker-boot — ce que le build publie', () => {
  it('écrit le boot et la feuille aux chemins STABLES du document', () => {
    ecrire('build/index.html', HTML);
    ecrire('build/assets/index-Ab12Cd.js', 'console.log("application")');

    lancerPlugin().writeBundle();

    const boot = fs.readFileSync(
      path.join(racine, 'build', APERCU_TRAVAILLEUR.BOOT_SCRIPT.replace(/^\//, '')),
      'utf8'
    );
    expect(boot).toContain('import"/assets/index-Ab12Cd.js"');
    // Le commentaire est là pour qu'un humain qui ouvre le fichier servi
    // comprenne pourquoi il existe — il n'est pas exécuté.
    expect(boot).toMatch(/STABLE/);

    const css = fs.readFileSync(
      path.join(racine, 'build', APERCU_TRAVAILLEUR.BOOT_STYLE.replace(/^\//, '')),
      'utf8'
    );
    expect(css).toBe(`${SELECTEUR_TEMOIN}{font-weight:700}`);
  });

  it('n’écrit AUCUNE copie de l’application — juste l’import de l’entrée', () => {
    ecrire('build/index.html', HTML);
    ecrire('build/assets/index-Ab12Cd.js', 'console.log("application")');

    lancerPlugin().writeBundle();

    const boot = fs.readFileSync(
      path.join(racine, 'build', APERCU_TRAVAILLEUR.BOOT_SCRIPT.replace(/^\//, '')),
      'utf8'
    );
    // Une seconde entrée Rollup posait 188 Ko d'application sous un nom stable :
    // `must-revalidate` le revalide à chaque visite, `immutable` le figerait.
    expect(boot.length).toBeLessThan(400);
    expect(boot).not.toContain('createRoot');
  });

  it('refuse un HTML sans entrée module (le document ne démarrerait rien)', () => {
    ecrire('build/index.html', '<html><head><style>.titre-page{}</style></head></html>');

    expect(() => lancerPlugin().writeBundle()).toThrow(/aucune entrée `type="module"`/);
  });

  it('refuse un HTML sans feuille (le profil démarrerait sans style)', () => {
    ecrire(
      'build/index.html',
      '<html><head><script type="module" src="/assets/index-x.js"></script></head></html>'
    );

    expect(() => lancerPlugin().writeBundle()).toThrow(/SANS CSS/);
  });

  it('refuse une feuille qui n’est pas celle de l’application', () => {
    ecrire(
      'build/index.html',
      '<html><head><style>body{margin:0}</style>' +
        '<script type="module" src="/assets/index-x.js"></script></head></html>'
    );

    expect(() => lancerPlugin().writeBundle()).toThrow(/ne contient pas/);
  });

  it('suit le <link> si la feuille n’est plus inlinée', () => {
    ecrire(
      'build/index.html',
      '<html><head><link rel="stylesheet" crossorigin href="/assets/index-Zz9.css">' +
        '<script type="module" src="/assets/index-x.js"></script></head></html>'
    );
    ecrire('build/assets/index-Zz9.css', `${SELECTEUR_TEMOIN}{color:red}`);

    lancerPlugin().writeBundle();

    const css = fs.readFileSync(
      path.join(racine, 'build', APERCU_TRAVAILLEUR.BOOT_STYLE.replace(/^\//, '')),
      'utf8'
    );
    expect(css).toContain(`${SELECTEUR_TEMOIN}{color:red}`);
  });

  it('lit l’entrée même quand l’attribut précède `type`', () => {
    expect(entreeDuHtml('<script src="/assets/index-x.js" type="module"></script>')).toBe(
      '/assets/index-x.js'
    );
    expect(entreeDuHtml('<script src="/assets/index-x.js"></script>')).toBe('');
  });

  it('le contenu du boot est UNE importation de l’entrée', () => {
    expect(contenuBoot('/assets/index-x.js')).toContain('import"/assets/index-x.js";');
  });

  it('extraireCss préfère les blocs en ligne et rend « » sans feuille', () => {
    expect(extraireCss('<style>a{}</style>', racine)).toBe('a{}');
    expect(extraireCss('<p>rien</p>', racine)).toBe('');
  });

  it('est branché dans vite.config.js, AVANT le manifeste d’empreintes', () => {
    const config = fs.readFileSync(path.join(FRONTEND, 'vite.config.js'), 'utf8');
    // Les deux chemins viennent de la déclaration partagée : une valeur écrite
    // en dur dans vite.config.js pourrait diverger du document.
    expect(config).toContain('workerBootPlugin()');
    expect(config.indexOf('workerBootPlugin()')).toBeLessThan(
      config.indexOf('injectAssetManifestPlugin()')
    );
    const pluginSource = fs.readFileSync(
      path.join(FRONTEND, 'vite-plugins', 'worker-boot.js'),
      'utf8'
    );
    // Les chemins viennent de la déclaration partagée, pas d'un littéral : le
    // plugin ne doit pas décider d'un nom que le document et le contrat ne
    // connaissent pas.
    expect(pluginSource).toContain('POINT_ENTREE_TRAVAILLEUR');
    expect(pluginSource).toContain('POINT_ENTREE_TRAVAILLEUR.script');
    expect(pluginSource).toContain('POINT_ENTREE_TRAVAILLEUR.style');
  });
});
