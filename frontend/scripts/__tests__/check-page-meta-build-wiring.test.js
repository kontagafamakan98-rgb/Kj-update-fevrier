/**
 * @vitest-environment node
 *
 * ⚠️ Environnement NODE, pas jsdom (le défaut du projet) : ce test importe le
 * VRAI vite.config.js, donc @vitejs/plugin-react, donc esbuild — et jsdom
 * remplace `TextEncoder`/`Uint8Array` par ceux de son realm, ce qui fait échouer
 * l'invariant d'esbuild (« new TextEncoder().encode("") instanceof Uint8Array »
 * y est faux). Ne pas retirer cette ligne.
 *
 * ── Ce que ce test remplace ─────────────────────────────────────────────────
 * « Une page muette fait échouer `npm run build` » tenait à une preuve faite à
 * la main : muter une page, lancer le build, lire l'échec, restaurer le fichier.
 * Une preuve manuelle ne survit à aucun commit — retirer `requirePageMeta()` du
 * tableau `plugins` de vite.config.js, ou le passer en `apply: 'serve'`, rendrait
 * le refus inopérant sans qu'aucun test ne rougisse : la CI resterait verte, et
 * le bundle à la page muette repartirait en pré-déploiement. C'était
 * exactement le gain de F12 (CI-COVERAGE.md), perdu en silence.
 *
 * Le test lit donc la configuration RÉELLE, pas une copie : le plugin trouvé est
 * celui que le build installe, et son `buildStart` est appelé sur le dépôt réel
 * (qui est sain — un plugin monté sur une règle cassée lèverait ici).
 *
 * ── Répartition avec check-page-meta.test.js ────────────────────────────────
 * Ici : le BRANCHEMENT. Là-bas : la CAPACITÉ, exercée sur une arborescence
 * temporaire (`requirePageMeta({ root }).buildStart()` doit lever sur une page
 * qui n'annonce rien et sur une traduction manquante). Ce que ces deux fichiers
 * ne font pas : lancer un vrai `vite build` — il faudrait le graphe de
 * dépendances complet pour vérifier une ligne de configuration — ni modifier le
 * dépôt réel.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('le build refuse — le branchement dans vite.config.js', () => {
  it('installe require-page-meta, en mode build', async () => {
    const { default: config } = await import('../../vite.config.js');
    const installed = config({ mode: 'production' }).plugins.filter(
      (plugin) => plugin && plugin.name === 'require-page-meta'
    );

    expect(installed, 'vite.config.js doit installer require-page-meta').toHaveLength(1);
    // `apply: 'build'` : le plugin tourne au build (donc il refuse) et PAS au
    // dev — c'est ce qui laisse `npm run dev` utilisable pendant l'itération.
    expect(installed[0].apply).toBe('build');
    expect(typeof installed[0].buildStart).toBe('function');
    // Le plugin RÉEL, sur le dépôt RÉEL : vert — il ne refuse pas une
    // arborescence saine.
    expect(() => installed[0].buildStart()).not.toThrow();
  });

  it('ne réécrit PAS le plugin : une seule définition, dans le garde', () => {
    const source = readFileSync(path.join(FRONTEND, 'vite.config.js'), 'utf8');

    expect(source).toMatch(/requirePageMeta\(/);
    // Une copie locale du plugin (même nom, autre `buildStart`) serait une
    // seconde définition : elle pourrait cesser de refuser sans faire rougir
    // le test précédent, qui ne connaîtrait que l'objet installé.
    expect(source).not.toMatch(/name:\s*['"]require-page-meta['"]/);
  });
});
