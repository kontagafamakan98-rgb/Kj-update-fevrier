/**
 * @vitest-environment node
 *
 * ⚠️ Environnement NODE, pas jsdom (le défaut du projet) : ce test importe le
 * VRAI vite.config.js, donc @vitejs/plugin-react, donc esbuild — et jsdom
 * remplace `TextEncoder`/`Uint8Array` par ceux de son realm, ce qui fait échouer
 * l'invariant d'esbuild (« new TextEncoder().encode("") instanceof Uint8Array is
 * incorrectly false »). Ne pas retirer cette ligne.
 *
 * Garde-fou de la publication de la RÉVISION du build
 * (`vite-plugins/inject-build-revision.js`, branché par vite.config.js).
 *
 * ── Le faux-vert que ce test empêche ────────────────────────────────────────
 * `scripts/check-deployed-revision.js` compare la révision annoncée par la
 * production à ce que `main` aurait dû déployer. Si le build cessait de publier
 * cette balise (plugin retiré de l'ordre des `transformIndexHtml`, variable lue
 * sur le mauvais nom, balise injectée dans le corps au lieu de la tête…), le
 * garde refuserait TOUTE production — y compris une production correcte. Un
 * garde qui rougit toujours est un garde qu'on désactive : c'est cette panne-ci
 * que ce test rend impossible, en pilotant le vrai plugin du vrai vite.config.js.
 *
 * Preuve complémentaire, au niveau de l'artefact servi (à rejouer à la main) :
 *
 *   cd frontend
 *   VERCEL_GIT_COMMIT_SHA=1234567890abcdef npx vite build
 *   grep -o 'kojo-build-revision[^>]*' build/index.html
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { BUILD_REVISION_META } from '../site-meta.js';
import { revisionDuDepot, revisionFrom } from '../../vite-plugins/inject-build-revision.js';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_TEMPLATE = path.join(FRONTEND_DIR, 'index.html');

/** Variables qui pilotent la révision — retirées avant et après chaque cas : un
 *  `.env` de développeur ne doit pas décider du résultat. */
export const REVISION_ENV_VARS = ['KOJO_GIT_SHA', 'VERCEL_GIT_COMMIT_SHA', 'GITHUB_SHA'];

const SHA = '3f1c9a7b2d4e5f60718293a4b5c6d7e8f9012345';

function clearRevisionEnv() {
  for (const name of REVISION_ENV_VARS) delete process.env[name];
}

function setRevisionEnv(values = {}) {
  clearRevisionEnv();
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
}

/** Plugins du VRAI vite.config.js, résolus pour un build de production. */
async function loadBuildPlugins() {
  const { default: config } = await import('../../vite.config.js');
  const resolved = typeof config === 'function' ? await config({ mode: 'production' }) : config;
  return resolved.plugins;
}

async function runRevisionPlugin(html = readFileSync(INDEX_TEMPLATE, 'utf8')) {
  const plugins = await loadBuildPlugins();
  const plugin = plugins.find((candidate) => candidate?.name === 'inject-build-revision');
  if (!plugin) throw new Error('plugin « inject-build-revision » introuvable dans vite.config.js');
  return plugin.transformIndexHtml(html);
}

/**
 * Le VRAI plugin, mais avec une source « dépôt » remplacée : c'est le seul moyen
 * d'exercer le cas « aucune révision disponible » sans sortir du dépôt (où git
 * en donne toujours une).
 */
async function runRevisionPluginWith(options) {
  const { injectBuildRevisionPlugin } = await import('../../vite-plugins/inject-build-revision.js');
  return injectBuildRevisionPlugin({ env: {}, ...options }).transformIndexHtml(
    readFileSync(INDEX_TEMPLATE, 'utf8')
  );
}

const metaOf = (tags) => (tags || []).find((tag) => tag.attrs?.name === BUILD_REVISION_META);

afterEach(clearRevisionEnv);

describe('inject-build-revision — la révision publiée par le build', () => {
  it('publie le commit de Vercel dans la TÊTE du HTML statique', async () => {
    setRevisionEnv({ VERCEL_GIT_COMMIT_SHA: SHA });
    const { tags } = await runRevisionPlugin();

    const meta = metaOf(tags);
    expect(meta, 'aucune meta de révision injectée').toBeDefined();
    expect(meta.tag).toBe('meta');
    expect(meta.attrs.content).toBe(SHA);
    // `head` : la balise doit être dans le HTML SERVI, pas ajoutée par le bundle.
    expect(meta.injectTo).toBe('head');
  });

  it('préfère KOJO_GIT_SHA — le même nom de fait que côté backend', () => {
    const dépôt = () => 'd'.repeat(40);
    expect(revisionFrom({ KOJO_GIT_SHA: 'a'.repeat(40), VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40) }, { depot: dépôt }))
      .toBe('a'.repeat(40));
    expect(revisionFrom({ VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40), GITHUB_SHA: 'c'.repeat(40) }, { depot: dépôt }))
      .toBe('b'.repeat(40));
    expect(revisionFrom({ GITHUB_SHA: ' c '.repeat(1) }, { depot: dépôt })).toBe('c');
    // Sans variable, c'est le DÉPÔT — la source qu'aucun réglage ne peut éteindre.
    expect(revisionFrom({}, { depot: dépôt })).toBe('d'.repeat(40));
  });

  it('lit le HEAD du dépôt quand le build tourne dans un clone (cas Vercel)', () => {
    // Les variables système de Vercel dépendent d'un réglage du projet ; le
    // clone, lui, est toujours là. Cette source est donc celle qui rend la
    // publication fiable en production, et elle est lue dans CE dépôt-ci.
    const head = revisionDuDepot();
    expect(head, 'ce dépôt doit être un clone git').toMatch(/^[0-9a-f]{7,40}$/);
    expect(revisionFrom({}, { depot: () => head })).toBe(head);
  });

  it('publie le HEAD du dépôt quand aucune variable n’est posée', async () => {
    clearRevisionEnv();
    const { tags } = await runRevisionPlugin();
    // Un build de poste annonce donc une révision — la sienne, ce qui est vrai.
    expect(metaOf(tags)?.attrs?.content).toBe(revisionDuDepot());
  });

  it('n’invente RIEN hors dépôt git ET sans variable (build depuis une archive)', async () => {
    // Le seul cas où le build se tait : ni variable, ni `.git` — et alors le
    // garde de production refusera en nommant l'absence, jamais en comparant à
    // une valeur fabriquée.
    expect(revisionFrom({}, { depot: () => '' })).toBe('');
    expect(
      revisionFrom({ VERCEL_GIT_COMMIT_SHA: '   ' }, { depot: () => '' }),
      'une variable vide ne doit pas devenir une révision'
    ).toBe('');
    const résultat = await runRevisionPluginWith({ depot: () => '' });
    expect(typeof résultat === 'string' ? [] : résultat.tags || []).toEqual([]);
  });
});
