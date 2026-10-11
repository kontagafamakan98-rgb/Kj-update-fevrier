import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Garde-fou : LHCI ne doit lire QUE des configs CommonJS (`.cjs`).
//
// ── Le piège que ce garde ferme ─────────────────────────────────────────────
// @lhci/utils lit une config YAML avec `yaml.safeLoad` (lighthouserc.js,
// parseFileContentToJSON). `safeLoad` a été retiré de js-yaml 4, et le dépôt
// épingle js-yaml 4 (override npm `@lhci/utils` → `js-yaml`, cf. package.json)
// pour lever les avis de sécurité de js-yaml 3. Conséquence : une config
// `lighthouserc.yml` ferait planter LHCI au chargement, avec une erreur
// « safeLoad is not a function » peu lisible en CI.
//
// Le garde refuse donc, en amont, toute config YAML et tout lancement sans
// `--config=<fichier>.cjs` explicite. Il ne tente pas de réparer le loader :
// ajouter un shim ou un patch maintiendrait une dépendance qui n'existe pas.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const LHCI_RC_SOURCE = path.join(FRONTEND_DIR, 'node_modules', '@lhci', 'utils', 'src', 'lighthouserc.js');

/** Noms de config que @lhci/utils reconnaît, lus dans le module installé. */
const nomsDeConfigLhci = () => {
  const source = fs.readFileSync(LHCI_RC_SOURCE, 'utf8');
  const bloc = source.match(/const RC_FILE_NAMES = \[([\s\S]*?)\];/);
  if (!bloc) throw new Error('RC_FILE_NAMES introuvable dans @lhci/utils/src/lighthouserc.js');
  return [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

/** Les lignes de CODE d'un workflow : les commentaires (« # … ») sont exclus. */
const lignesDeCode = (texte) =>
  texte.split(/\r?\n/).filter((ligne) => !ligne.trim().startsWith('#'));

describe('Lighthouse CI — aucune config YAML, --config .cjs explicite', () => {
  it('la liste des noms reconnus par LHCI contient des noms YAML (le garde a de quoi juger)', () => {
    const yaml = nomsDeConfigLhci().filter((n) => /\.(yml|yaml)$/i.test(n));
    // Plancher : si LHCI cessait de reconnaître des noms YAML, ce garde
    // deviendrait muet. On exige les quatre formes (avec et sans point).
    expect(yaml).toEqual(
      expect.arrayContaining(['.lighthouserc.yml', 'lighthouserc.yml', '.lighthouserc.yaml', 'lighthouserc.yaml']),
    );
  });

  it('aucun fichier de config Lighthouse en YAML à la racine du dépôt ni dans frontend/', () => {
    const yaml = nomsDeConfigLhci().filter((n) => /\.(yml|yaml)$/i.test(n));
    const trouves = [REPO_ROOT, FRONTEND_DIR]
      .flatMap((dir) => yaml.map((nom) => path.join(dir, nom)))
      .filter((chemin) => fs.existsSync(chemin))
      .map((chemin) => path.relative(REPO_ROOT, chemin));
    expect(
      trouves,
      `config Lighthouse CI en YAML : ${trouves.join(', ')} — LHCI la charge avec safeLoad, ` +
        'absent de js-yaml 4 (épinglé pour les avis de sécurité) : elle ferait planter le job. ' +
        'Réécrire la config en .cjs (frontend/lighthouserc.cjs), sans YAML.',
    ).toEqual([]);
  });

  it('chaque invocation `lhci` des workflows passe un --config .cjs qui existe', () => {
    const invocations = [];
    for (const fichier of fs.readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f))) {
      const texte = fs.readFileSync(path.join(WORKFLOWS_DIR, fichier), 'utf8');
      for (const ligne of lignesDeCode(texte)) {
        if (/\blhci\s+(autorun|collect|assert|upload)\b/.test(ligne)) {
          invocations.push({ fichier, ligne: ligne.trim() });
        }
      }
    }
    // Plancher : le job lighthouse-ci lance deux configs (mobile + desktop).
    expect(invocations.length).toBeGreaterThanOrEqual(2);

    const fautes = [];
    for (const { fichier, ligne } of invocations) {
      const config = ligne.match(/--config=([^\s"']+)/);
      if (!config) {
        fautes.push(`${fichier} : « ${ligne} » sans --config (LHCI chercherait une config YAML)`);
        continue;
      }
      if (!/\.cjs$/.test(config[1])) {
        fautes.push(`${fichier} : --config=${config[1]} n'est pas un .cjs`);
        continue;
      }
      if (!fs.existsSync(path.join(FRONTEND_DIR, config[1]))) {
        fautes.push(`${fichier} : --config=${config[1]} introuvable dans frontend/`);
      }
    }
    expect(fautes).toEqual([]);
  });
});
