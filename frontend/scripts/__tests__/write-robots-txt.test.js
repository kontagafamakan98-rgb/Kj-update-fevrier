/**
 * @vitest-environment node
 *
 * ⚠️ Environnement NODE, pas jsdom (le défaut du projet) : le troisième cas
 * importe le VRAI vite.config.js, donc @vitejs/plugin-react, donc esbuild — et
 * jsdom remplace `TextEncoder`/`Uint8Array` par ceux de son realm, ce qui fait
 * échouer l'invariant d'esbuild. Ne pas retirer cette ligne.
 *
 * ── Ce que ce fichier remplace ───────────────────────────────────────────────
 * « robots.txt dérive des routes privées » se prouvait à la main : construire le
 * frontend, ouvrir build/robots.txt, comparer à la liste. Une preuve manuelle ne
 * survit à aucun commit — passer `privateRoutes: []` au plugin, ou déplacer
 * l'écriture du fichier avant la copie de `public/`, republierait une liste
 * fausse sans qu'aucun test ne rougisse (le garde, lui, relit le résidu d'un
 * build précédent si le plugin ne tourne plus).
 *
 * ── Répartition avec check-spa-routes.test.js ────────────────────────────────
 * Là-bas : le VERDICT, sur une arborescence temporaire — le garde refuse un
 * robots.txt figé, un app.html indexable, une seconde déclaration.
 * Ici : la PRODUCTION du fichier — le plugin réel écrit exactement ce que la
 * dérivation dit, refuse une seconde déclaration, et celui que le build installe
 * est bien celui-là.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeRobotsTxtPlugin } from '../../vite-plugins/write-robots-txt.js';
import { parseAppRoutes, privateRoutesOf, robotsTxtFor } from '../check-spa-routes.js';
import { SITE_ORIGIN } from '../site-meta.js';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const makeOut = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robots-txt-'));
  tempDirs.push(dir);
  return dir;
};

describe('write-robots-txt — le fichier publié', () => {
  it('écrit exactement ce que la liste dérivée dit, et rien de plus', () => {
    const out = makeOut();
    const plugin = writeRobotsTxtPlugin({
      privateRoutes: ['/z-route', '/a-route'],
      siteOrigin: 'https://exemple.test',
    });
    plugin.configResolved({ publicDir: path.join(out, 'public') });
    plugin.writeBundle({ dir: out });

    expect(fs.readFileSync(path.join(out, 'robots.txt'), 'utf8')).toBe(
      [
        'User-agent: *',
        'Allow: /',
        // Tri ASCII : « - » (0x2D) précède « p », donc /a-route avant /api/.
        'Disallow: /a-route',
        'Disallow: /api/',
        'Disallow: /z-route',
        '',
        'Sitemap: https://exemple.test/sitemap.xml',
        '',
      ].join('\n')
    );
  });

  it('refuse une SECONDE déclaration public/robots.txt au lieu d’en publier deux', () => {
    const out = makeOut();
    const publicDir = path.join(out, 'public');
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'robots.txt'), 'User-agent: *\nDisallow: /dashboard\n');

    const plugin = writeRobotsTxtPlugin({ privateRoutes: ['/dashboard'], siteOrigin: SITE_ORIGIN });
    plugin.configResolved({ publicDir });

    expect(() => plugin.writeBundle({ dir: out })).toThrow(/SECONDE déclaration/);
  });
});

describe('write-robots-txt — le plugin installé par le build', () => {
  it('publie la liste DÉRIVÉE du routage, pas une copie', async () => {
    // Le plugin RÉEL, tel que vite.config.js l'installe : c'est lui qui écrit le
    // robots.txt du pré-déploiement, donc c'est lui qu'on exerce ici.
    const { default: config } = await import('../../vite.config.js');
    const installed = config({ mode: 'production' }).plugins.filter(
      (plugin) => plugin && plugin.name === 'write-robots-txt'
    );
    expect(installed, 'vite.config.js doit installer write-robots-txt').toHaveLength(1);
    expect(installed[0].apply).toBe('build');

    const out = makeOut();
    installed[0].configResolved({ publicDir: path.join(out, 'public') });
    installed[0].writeBundle({ dir: out });

    // La même dérivation que celle dont le garde exige le noindex dans
    // vercel.json pour chaque route privée : si elle change, ce fichier change.
    const routes = parseAppRoutes(fs.readFileSync(path.join(FRONTEND, 'src', 'App.js'), 'utf8')).routes;
    const rewrites = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'vercel.json'), 'utf8')).rewrites;
    const attendu = robotsTxtFor(privateRoutesOf(routes, rewrites), SITE_ORIGIN);

    expect(fs.readFileSync(path.join(out, 'robots.txt'), 'utf8')).toBe(attendu);
    // Les routes privées du dépôt sont bien celles qu'on croit (la fixture ne
    // doit pas se contenter d'un fichier vide qui « égale » une liste vide).
    expect(attendu).toContain('Disallow: /dashboard');
    expect(attendu).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  });
});
