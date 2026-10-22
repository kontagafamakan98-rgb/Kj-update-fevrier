/**
 * @vitest-environment node
 *
 * Garde-fou du MANIFESTE D'ACTIFS du build
 * (`vite-plugins/inject-asset-manifest.js`, branché par vite.config.js).
 *
 * ── Le faux-vert que ce test empêche ────────────────────────────────────────
 * `scripts/check-deployed-assets.js` ne peut comparer que ce que le build a
 * publié : si le manifeste cesse d'être écrit, s'il oublie une famille de
 * fichiers (les polices, recopiées depuis `public/`), ou si son empreinte n'est
 * plus ancrée dans le HTML, la sonde refuse TOUTE production — ou, pire, juge un
 * manifeste que rien ne rattache à l'artefact. Ce test écrit un vrai dossier de
 * build, exécute le vrai code du plugin, et vérifie les trois choses qui font
 * que la chaîne tient : le manifeste décrit les bons fichiers, il est
 * déterministe, et chaque page porte l'empreinte de SES octets.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { BUILD_ASSETS_META, ECHANTILLON_CONTENU, MANIFESTE_ACTIFS } from '../site-meta.js';
import {
  ancrerManifeste,
  ecrireManifeste,
  empreinteDe,
  injectAssetManifestPlugin,
  listerActifs,
  listerContenus,
} from '../../vite-plugins/inject-asset-manifest.js';

const dossiers = [];

function buildFactice(fichiers = {}) {
  const racine = mkdtempSync(join(tmpdir(), 'kojo-actifs-'));
  dossiers.push(racine);
  const parDéfaut = {
    'index.html': '<!doctype html><html><head><title>Kojo</title></head><body></body></html>',
    'about.html': '<!doctype html><html><head><title>À propos</title></head><body></body></html>',
    'assets/index-abc.js': 'console.log("entrée")',
    'assets/index-abc.css': 'body{margin:0}',
    'assets/vendor-def.js': 'export const v = 1',
    'assets/chunk-ghi.js': 'export const c = 1',
    'assets/image.png': 'pas un actif de code',
    'og-jobs.png': 'carte partagée des missions',
    // Milieu DIFFÉRENT des deux bords : sans cela, tête et queue d'un fichier
    // uniforme auraient la même empreinte et le test ne distinguerait rien.
    'icons/icon-192x192.png':
      'a'.repeat(ECHANTILLON_CONTENU) + 'milieu' + 'z'.repeat(ECHANTILLON_CONTENU),
    'fonts/inter.woff2': 'faux woff2',
    'fonts/inter.woff': 'faux woff',
    'nested/deep/legal/terms.html': '<html><head></head></html>',
  };
  for (const [chemin, contenu] of Object.entries({ ...parDéfaut, ...fichiers })) {
    const abs = join(racine, chemin);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contenu, 'utf8');
  }
  return racine;
}

afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true });
});

describe('inject-asset-manifest — ce que le build publie', () => {
  it('sépare le CODE (empreinte entière) des CONTENUS (images et cartes OG)', () => {
    const racine = buildFactice();
    const actifs = listerActifs(racine).map((a) => a.chemin);
    expect(actifs).toEqual([
      '/assets/chunk-ghi.js',
      '/assets/index-abc.css',
      '/assets/index-abc.js',
      '/assets/vendor-def.js',
      '/fonts/inter.woff',
      '/fonts/inter.woff2',
    ]);
    // Les images ne sont PAS des actifs (leur empreinte complète ferait
    // télécharger des mégaoctets) ; elles sont déclarées séparément.
    expect(actifs.some((chemin) => chemin.endsWith('.png'))).toBe(false);
    expect(listerContenus(racine).map((a) => a.chemin)).toEqual([
      '/assets/image.png',
      '/icons/icon-192x192.png',
      '/og-jobs.png',
    ]);
  });

  it('écrit le manifeste avec une empreinte par fichier, et n’y met pas le manifeste lui-même', () => {
    const racine = buildFactice();
    const { empreinte, nombre, contenus } = ecrireManifeste(racine);

    const corps = readFileSync(join(racine, MANIFESTE_ACTIFS.replace(/^\//, '')), 'utf8');
    const manifeste = JSON.parse(corps);
    expect(nombre).toBe(6);
    expect(contenus).toBe(3);
    expect(empreinte).toBe(empreinteDe(corps));
    expect(manifeste.fichiers['/assets/index-abc.js']).toBe(
      empreinteDe(readFileSync(join(racine, 'assets/index-abc.js')))
    );
    expect(manifeste.fichiers['/fonts/inter.woff2']).toBe(
      empreinteDe(readFileSync(join(racine, 'fonts/inter.woff2')))
    );
    expect(manifeste.fichiers).not.toHaveProperty(MANIFESTE_ACTIFS);
    expect(manifeste.contenus).not.toHaveProperty(MANIFESTE_ACTIFS);
  });

  it('borne l’échantillon des contenus : tête, milieu et queue, jamais le fichier entier', () => {
    const racine = buildFactice();
    ecrireManifeste(racine);
    const manifeste = JSON.parse(
      readFileSync(join(racine, MANIFESTE_ACTIFS.replace(/^\//, '')), 'utf8')
    );

    const grand = manifeste.contenus['/icons/icon-192x192.png'];
    const octets = readFileSync(join(racine, 'icons/icon-192x192.png'));
    // L'échantillon est le PLAFOND, pas la taille du fichier : c'est ce qui
    // évite à la sonde de télécharger les trois blocs d'une icône.
    expect(grand.taille).toBe(octets.length);
    expect(grand.echantillon).toBe(ECHANTILLON_CONTENU);
    expect(grand.debut).toBe(empreinteDe(octets.subarray(0, ECHANTILLON_CONTENU)));
    expect(grand.fin).toBe(empreinteDe(octets.subarray(octets.length - ECHANTILLON_CONTENU)));
    expect(grand.debut).not.toBe(grand.fin);
    // Le MILIEU est publié, à la même taille de bloc, et occupe une plage
    // DISTINCTE des deux bords : c'est ce qui attrape une retouche au centre.
    const milieuDebut = Math.floor((octets.length - ECHANTILLON_CONTENU) / 2);
    expect(grand.milieu).toBe(
      empreinteDe(octets.subarray(milieuDebut, milieuDebut + ECHANTILLON_CONTENU))
    );
    expect(grand.milieu).not.toBe(grand.debut);
    expect(grand.milieu).not.toBe(grand.fin);

    // Un fichier plus petit que l'échantillon publie SA taille : tête et queue
    // sont alors le même bloc, et la sonde n'a pas de cas particulier à faire.
    const petit = manifeste.contenus['/og-jobs.png'];
    expect(petit.echantillon).toBe(Buffer.byteLength('carte partagée des missions'));
    expect(petit.debut).toBe(petit.fin);
    // Pas de milieu : tête et queue couvrent déjà tout le fichier, une
    // troisième empreinte ne décrirait aucun octet de plus.
    expect(petit.milieu).toBeUndefined();
  });

  it('est DÉTERMINISTE : deux builds du même code donnent la même empreinte, un octet changé la change', () => {
    const premier = ecrireManifeste(buildFactice()).empreinte;
    const second = ecrireManifeste(buildFactice()).empreinte;
    expect(second).toBe(premier);

    const modifié = ecrireManifeste(buildFactice({ 'assets/chunk-ghi.js': 'export const c = 2' })).empreinte;
    expect(modifié).not.toBe(premier);
  });

  it('ancre l’empreinte dans CHAQUE page, une seule fois (idempotent)', () => {
    const racine = buildFactice();
    const { empreinte } = ecrireManifeste(racine);

    expect(ancrerManifeste(racine, empreinte)).toBe(3);
    for (const page of ['index.html', 'about.html', 'nested/deep/legal/terms.html']) {
      const html = readFileSync(join(racine, page), 'utf8');
      expect(html, page).toContain(`<meta name="${BUILD_ASSETS_META}" content="${empreinte}">`);
    }
    // La balise est dans la TÊTE : c'est ce qu'un client reçoit sans JavaScript.
    const index = readFileSync(join(racine, 'index.html'), 'utf8');
    expect(index.indexOf(BUILD_ASSETS_META)).toBeLessThan(index.indexOf('</head>'));

    // Second passage : rien de réécrit, jamais deux ancres pour la même page.
    expect(ancrerManifeste(racine, empreinte)).toBe(0);
    expect(readFileSync(join(racine, 'index.html'), 'utf8').split(BUILD_ASSETS_META)).toHaveLength(2);
  });

  it('le plugin est bien branché dans le VRAI vite.config.js, en dernier', async () => {
    const { default: config } = await import('../../vite.config.js');
    const résolu = typeof config === 'function' ? await config({ mode: 'production' }) : config;
    const plugin = résolu.plugins.find((candidat) => candidat?.name === 'inject-asset-manifest');
    expect(plugin, 'plugin « inject-asset-manifest » introuvable dans vite.config.js').toBeDefined();
    // `enforce: 'post'` : le manifeste doit être écrit APRÈS le bundle (les
    // polices recopiées depuis `public/` ne sont sur le disque qu'à ce moment).
    expect(plugin.enforce).toBe('post');
    expect(typeof plugin.closeBundle).toBe('function');
    expect(injectAssetManifestPlugin().name).toBe('inject-asset-manifest');
  });
});
