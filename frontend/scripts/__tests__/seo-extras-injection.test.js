/**
 * @vitest-environment node
 *
 * ⚠️ Environnement NODE, pas jsdom (le défaut du projet) : ce test importe le
 * VRAI vite.config.js, donc @vitejs/plugin-react, donc esbuild — et jsdom
 * remplace `TextEncoder`/`Uint8Array` par ceux de son realm, ce qui fait
 * échouer l'invariant d'esbuild (« new TextEncoder().encode("") instanceof
 * Uint8Array is incorrectly false »). Ne pas retirer cette ligne.
 *
 * Garde-fou de l'INJECTION SEO / analytics du build (plugins `inject-seo-extras`
 * et `inject-production-csp` de vite.config.js).
 *
 * ── Le faux-vert que ce test empêche ────────────────────────────────────────
 * Les intégrations réclamées par un audit SEO (balise Google Analytics 4, meta
 * de vérification Search Console, `sameAs` des réseaux sociaux, domaines GA
 * dans la CSP) n'existent QUE si la variable d'environnement correspondante est
 * définie AU MOMENT DU BUILD. Or le build de CI ne les définit JAMAIS : y
 * injecter `G-0000000000` mettrait une balise tierce dans l'artefact que
 * Lighthouse audite et fausserait les scores. Résultat : aucun test ne voyait
 * la différence entre « intégration configurée et injectée » et « intégration
 * silencieusement perdue » (plugin renommé, ordre des `transformIndexHtml`
 * changé, JSON-LD reformaté donc `replace('"sameAs": []')` sans effet, variable
 * lue sur le mauvais préfixe…). La panne se serait découverte dans un audit
 * externe, sur la production — exactement ce qui s'est produit.
 *
 * Ce test pilote le VRAI plugin du VRAI vite.config.js (importé, pas recopié)
 * avec un environnement fabriqué, et le VRAI template frontend/index.html.
 *
 * Preuve complémentaire, au niveau de l'artefact servi (à rejouer à la main,
 * elle dépend d'un identifiant inexistant en CI donc elle n'est pas testée
 * ici) :
 *
 *   cd frontend
 *   VITE_GA_MEASUREMENT_ID=G-TEST123456 VITE_GSC_VERIFICATION=citest-token \
 *   VITE_SOCIAL_FACEBOOK=https://facebook.com/kojo-test npx vite build
 *   grep -c googletagmanager build/index.html      # 2 (déclaration data-kojo-ga-src + CSP relâchée)
 *   grep -o '"sameAs": \[[^]]*\]' build/index.html # les profils déclarés
 *
 * NOTE : le plugin lit `src/config/social-networks.json` relativement au
 * cwd du build (`process.cwd()`, comme Vite) — ce test doit donc tourner avec
 * frontend/ comme cwd, ce que fait `npm test` / `vitest run` dans frontend.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_TEMPLATE = path.join(FRONTEND_DIR, 'index.html');

/** Variables qui pilotent l'injection — toutes retirées avant chaque cas :
 *  un `frontend/.env.local` de développeur ne doit pas décider du résultat. */
export const SEO_ENV_VARS = [
  'VITE_GA_MEASUREMENT_ID',
  'VITE_GSC_VERIFICATION',
  'VITE_PLAUSIBLE_DOMAIN',
  'VITE_SOCIAL_FACEBOOK',
  'VITE_SOCIAL_INSTAGRAM',
  'VITE_SOCIAL_TIKTOK',
  'VITE_SOCIAL_LINKEDIN',
  'VITE_SOCIAL_YOUTUBE',
  'VITE_SOCIAL_X',
];

export const GA_ID = 'G-ABC1234567';
export const GSC_TOKEN = 'jeton-de-verification-test';
export const FACEBOOK_URL = 'https://www.facebook.com/kojo';
export const INSTAGRAM_URL = 'https://www.instagram.com/kojo';

export function clearSeoEnv() {
  for (const name of SEO_ENV_VARS) delete process.env[name];
}

export function setSeoEnv(values = {}) {
  clearSeoEnv();
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
}

/** Plugins du VRAI vite.config.js, résolus pour un build de production. */
export async function loadBuildPlugins() {
  const { default: config } = await import('../../vite.config.js');
  const resolved = typeof config === 'function' ? await config({ mode: 'production' }) : config;
  return resolved.plugins;
}

export function findPlugin(plugins, name) {
  const plugin = plugins.find((candidate) => candidate?.name === name);
  if (!plugin) throw new Error(`plugin « ${name} » introuvable dans vite.config.js`);
  return plugin;
}

export function indexTemplate() {
  return readFileSync(INDEX_TEMPLATE, 'utf8');
}

/** Sortie brute du plugin `inject-seo-extras` sur le template réel. */
export async function runSeoExtras(html = indexTemplate()) {
  const plugins = await loadBuildPlugins();
  return findPlugin(plugins, 'inject-seo-extras').transformIndexHtml(html);
}

/** Directive d'une CSP (`script-src …`), chaîne vide si absente. */
export function cspDirective(csp, name) {
  const directive = String(csp)
    .split('; ')
    .find((part) => part === name || part.startsWith(`${name} `));
  return directive || '';
}

/** Contenu de la meta CSP produite par `inject-production-csp`. */
export async function runCsp(html = indexTemplate()) {
  const plugins = await loadBuildPlugins();
  const result = findPlugin(plugins, 'inject-production-csp').transformIndexHtml(html);
  // Non-production : le plugin renvoie le html inchangé (chaîne, pas d'objet).
  if (typeof result === 'string') return { html: result, csp: '' };
  const meta = result.tags.find((tag) => tag.attrs?.['http-equiv'] === 'Content-Security-Policy');
  return { html: result.html, csp: meta?.attrs?.content || '' };
}

const gaTag = (tags) =>
  tags.find(
    (tag) =>
      tag.tag === 'script' &&
      String(tag.attrs?.['data-kojo-ga-src'] || '').includes('googletagmanager')
  );

describe('inject-seo-extras — balise Google Analytics 4', () => {
  afterEach(clearSeoEnv);

  it('DÉCLARE l’adresse du tag dans le HTML statique, sans l’exécuter', async () => {
    setSeoEnv({ VITE_GA_MEASUREMENT_ID: GA_ID });
    const { tags } = await runSeoExtras();

    const tag = gaTag(tags);
    expect(tag, 'aucune déclaration gtag.js injectée').toBeDefined();
    expect(tag.attrs['data-kojo-ga-src']).toBe(
      `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
    );
    // `type="text/plain"` : le navigateur ne l'exécute pas, donc le tag ne
    // se charge PAS pendant le chargement de la page (c'est le point : sous
    // bridage 4G, une balise `async` décidait du LCP).
    expect(tag.attrs.type).toBe('text/plain');
    expect(tag.attrs.src).toBeUndefined();
    // `head` : l'adresse doit être dans le HTML SERVI, pas ajoutée par le
    // bundle — c'est la condition pour qu'un crawler sans JavaScript la voie
    // et pour que la sonde SEO la détecte.
    expect(tag.injectTo).toBe('head');
  });

  it('n\'injecte rien tant qu\'aucun identifiant n\'est configuré (no-op strict)', async () => {
    setSeoEnv({});
    const { tags, html } = await runSeoExtras();
    expect(gaTag(tags)).toBeUndefined();
    expect(html).not.toContain('googletagmanager');
  });

  it('refuse un identifiant qui n\'est pas un G-… (aucune balise inventée)', async () => {
    for (const invalid of ['UA-123456-1', 'G-', 'mon-identifiant', 'gtag']) {
      setSeoEnv({ VITE_GA_MEASUREMENT_ID: invalid });
      const { tags } = await runSeoExtras();
      expect(gaTag(tags), `« ${invalid} » ne doit pas produire de balise`).toBeUndefined();
    }
  });
});

describe('inject-seo-extras — vérification Search Console', () => {
  afterEach(clearSeoEnv);

  it('ajoute la meta google-site-verification quand le jeton est défini', async () => {
    setSeoEnv({ VITE_GSC_VERIFICATION: GSC_TOKEN });
    const { tags } = await runSeoExtras();

    const meta = tags.find((tag) => tag.attrs?.name === 'google-site-verification');
    expect(meta, 'meta de vérification absente').toBeDefined();
    expect(meta.tag).toBe('meta');
    expect(meta.attrs.content).toBe(GSC_TOKEN);
    expect(meta.injectTo).toBe('head');
  });

  it('n\'ajoute aucune meta vide sans jeton', async () => {
    setSeoEnv({});
    const { tags } = await runSeoExtras();
    expect(tags.some((tag) => tag.attrs?.name === 'google-site-verification')).toBe(false);
  });
});

describe('inject-seo-extras — sameAs du LocalBusiness', () => {
  afterEach(clearSeoEnv);

  it('le template contient bien l\'ancre que le plugin remplace', () => {
    // Le plugin fait un simple `replace('"sameAs": []')` : si le JSON-LD de
    // index.html est reformaté, la substitution ne s'applique plus et le
    // sameAs reste vide EN SILENCE, quelle que soit la configuration Vercel.
    expect(indexTemplate()).toContain('"sameAs": []');
  });

  it('peuple sameAs avec les profils https déclarés, et eux seuls', async () => {
    setSeoEnv({
      VITE_SOCIAL_FACEBOOK: FACEBOOK_URL,
      VITE_SOCIAL_INSTAGRAM: INSTAGRAM_URL,
    });
    const { html } = await runSeoExtras();

    expect(html).not.toContain('"sameAs": []');
    expect(html).toContain(`"sameAs": ${JSON.stringify([FACEBOOK_URL, INSTAGRAM_URL])}`);
  });

  it('ignore un profil sans schéma https (jamais de lien inventé ni cassé)', async () => {
    setSeoEnv({
      VITE_SOCIAL_FACEBOOK: FACEBOOK_URL,
      VITE_SOCIAL_TIKTOK: 'tiktok.com/@kojo',
      VITE_SOCIAL_YOUTUBE: 'http://youtube.com/@kojo',
    });
    const { html } = await runSeoExtras();

    expect(html).toContain(`"sameAs": ${JSON.stringify([FACEBOOK_URL])}`);
    expect(html).not.toContain('tiktok.com');
    expect(html).not.toContain('youtube.com');
  });

  it('laisse le HTML intact quand aucun profil n\'est déclaré', async () => {
    setSeoEnv({});
    const template = indexTemplate();
    const { html } = await runSeoExtras(template);
    expect(html).toBe(template);
  });
});

describe('inject-production-csp — les domaines tiers suivent la configuration', () => {
  afterEach(clearSeoEnv);

  it('sans configuration, aucune origine tierce d\'analytics dans la CSP', async () => {
    setSeoEnv({});
    const { csp } = await runCsp();

    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('googletagmanager');
    expect(csp).not.toContain('google-analytics');
    expect(csp).not.toContain('plausible.io');
  });

  it('avec GA4, la CSP autorise le script ET les collectes (sinon GA est bloqué en silence)', async () => {
    setSeoEnv({ VITE_GA_MEASUREMENT_ID: GA_ID });
    const { csp } = await runCsp();

    // Sans script-src, gtag.js n'est jamais chargé ; sans connect-src/img-src,
    // il se charge mais les hits sont refusés par le navigateur.
    expect(cspDirective(csp, 'script-src')).toContain('https://www.googletagmanager.com');
    expect(cspDirective(csp, 'connect-src')).toContain('https://www.google-analytics.com');
    expect(cspDirective(csp, 'connect-src')).toContain('https://region1.google-analytics.com');
    expect(cspDirective(csp, 'img-src')).toContain('https://www.google-analytics.com');
  });

  it('un identifiant invalide ne relâche PAS la CSP', async () => {
    setSeoEnv({ VITE_GA_MEASUREMENT_ID: 'UA-123456-1' });
    const { csp } = await runCsp();
    expect(csp).not.toContain('googletagmanager');
    expect(csp).not.toContain('google-analytics');
  });

  it('Plausible n\'ouvre script-src que si un domaine est déclaré', async () => {
    setSeoEnv({});
    expect(cspDirective((await runCsp()).csp, 'script-src')).not.toContain('plausible.io');

    setSeoEnv({ VITE_PLAUSIBLE_DOMAIN: 'kj-update-fevrier.vercel.app' });
    expect(cspDirective((await runCsp()).csp, 'script-src')).toContain('https://plausible.io');
  });
});
