/**
 * Tests du plugin `vite-plugins/inline-critical-css.js`.
 *
 * ── Le défaut vécu que ce fichier empêche de revenir ────────────────────────
 * Le plugin remplace le `<link rel="stylesheet">` de l'index par une balise
 * `<style>` (le CSS render-blocking ne bloque plus le premier rendu) — puis il
 * SUPPRIMAIT la feuille du disque. C'était vrai tant que cette feuille n'était
 * référencée que par l'index.
 *
 * Depuis que la carte (`JobsMap`) est chargée par `import()` depuis
 * `src/pages/Jobs.js`, Vite inscrit le CSS de l'entrée dans la TABLE DE
 * DÉPENDANCES (`__vite__mapDeps`) du chunk qui déclare l'import dynamique :
 * `__vitePreload` la télécharge avant d'évaluer le module. Le fichier supprimé
 * rendait donc un 404 → le préchargement rejetait → `React.lazy` jetait →
 * l'`ErrorBoundary` remplaçait la page. Symptôme mesuré en production le
 * 26/09/2026 : au clic sur « Carte », « Oups ! Quelque chose s'est mal passé »
 * (`Unable to preload CSS for /assets/index-BYK0oy-w.css`), page blanche.
 *
 * Ce que ce fichier verrouille, dans l'ordre d'importance :
 *   1. la feuille EST toujours sur disque après l'inlining (le 404 ci-dessus) ;
 *   2. la balise `<link>` de l'index, elle, a bien DISPARU (sinon l'inlining ne
 *      sert plus à rien et la requête render-blocking revient) ;
 *   3. une feuille DISTANTE n'est ni inlinée ni supprimée (on ne touche pas à
 *      ce qu'on n'a pas écrit) ;
 *   4. un `<link>` dont le fichier est absent ne fait pas échouer le build.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inlineCriticalCssPlugin } from '../../vite-plugins/inline-critical-css.js';

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
});

/** Un build minimal : un index.html avec ses liens, et les fichiers demandés. */
function creerBuild({ liens = [], fichiers = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-inline-css-'));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });

  const liensHtml = liens.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n');
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    `<!doctype html><html><head>${liensHtml}</head><body></body></html>`,
    'utf8'
  );

  for (const [rel, contenu] of Object.entries(fichiers)) {
    const cible = path.join(dir, rel.replace(/^\//, ''));
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.writeFileSync(cible, contenu, 'utf8');
  }

  return dir;
}

function lancerPlugin(dir) {
  inlineCriticalCssPlugin().writeBundle({ dir }, { 'index.html': {} });
  return {
    html: fs.readFileSync(path.join(dir, 'index.html'), 'utf8'),
    existe: (rel) => fs.existsSync(path.join(dir, rel.replace(/^\//, ''))),
  };
}

describe('inline-critical-css — la feuille inlinée RESTE sur disque', () => {
  it('retire la balise <link> de l’index et publie son CSS dans un <style>', () => {
    const dir = creerBuild({
      liens: ['/assets/index-abc.css'],
      fichiers: { 'assets/index-abc.css': '.kojo { color: red }' },
    });

    const { html } = lancerPlugin(dir);

    expect(html).toContain('<style>.kojo { color: red }</style>');
    expect(html).not.toContain('<link rel="stylesheet" href="/assets/index-abc.css">');
    expect((html.match(/<style>/g) || []).length).toBe(1);
  });

  it('LAISSE la feuille sur disque — un import dynamique la référence encore', () => {
    const dir = creerBuild({
      liens: ['/assets/index-abc.css'],
      fichiers: { 'assets/index-abc.css': '.kojo { color: red }' },
    });

    const { existe } = lancerPlugin(dir);

    // Le cas exact de la régression : la supprimer rend un 404 au préchargement
    // du chunk qui déclare l'import dynamique (`__vite__mapDeps`), et la page
    // bascule sur l'ErrorBoundary.
    expect(existe('/assets/index-abc.css'), 'la feuille inlinée doit rester sur disque').toBe(true);
  });

  it('ne touche ni n’inline une feuille DISTANTE', () => {
    const dir = creerBuild({ liens: ['https://cdn.example/tiers.css'] });

    const { html } = lancerPlugin(dir);

    expect(html).toContain('<link rel="stylesheet" href="https://cdn.example/tiers.css">');
    expect(html).not.toContain('<style>');
  });

  it('laisse en place un <link> dont le fichier est ABSENT, sans échouer', () => {
    const dir = creerBuild({ liens: ['/assets/absent.css'] });

    const { html } = lancerPlugin(dir);

    expect(html).toContain('<link rel="stylesheet" href="/assets/absent.css">');
    expect(html).not.toContain('<style>');
  });

  it('ne fait rien quand l’index n’a aucune feuille', () => {
    const dir = creerBuild({ fichiers: { 'assets/index-abc.css': '.kojo {}' } });

    const { html, existe } = lancerPlugin(dir);

    expect(html).not.toContain('<style>');
    // Rien n'a été inliné, mais rien n'a été supprimé non plus.
    expect(existe('/assets/index-abc.css')).toBe(true);
  });
});
