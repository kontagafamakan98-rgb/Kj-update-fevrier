import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Garde-fou : les variables d'environnement lues par lighthouserc.cjs (et
// exportées par le workflow) ne doivent PAS commencer par « LHCI_ ».
//
// ── Le bug que ce garde empêche de reproduire ───────────────────────────────
// @lhci/cli configure yargs avec `.env('LHCI')` (voir
// node_modules/@lhci/cli/src/cli.js) : toute variable `LHCI_<x>` de
// l'environnement est relue par le CLI comme l'option `--<x>`. Le job CI
// exportait `LHCI_URL` pour indiquer la base à auditer, et lighthouserc.cjs
// construisait un tableau de 4 URLs — mais `LHCI_URL` devenait l'option `--url`
// du collecteur, qui ÉCRASE ce tableau. Résultat mesuré dans les logs du
// 16/09/2026 : « Checking assertions against 1 URL(s) », soit l'accueil
// seulement — les pages /dashboard, /jobs et /profile n'ont jamais été
// auditées, et leurs budgets ne mesuraient rien.
//
// Le nom `KOJO_LHCI_*` ne correspond à aucun motif capturé par yargs.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');
const CONFIG = path.join(FRONTEND_DIR, 'lighthouserc.cjs');
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const RESOLVER = path.join(REPO_ROOT, '.github', 'scripts', 'resolve-vercel-url.sh');

const readConfig = () => fs.readFileSync(CONFIG, 'utf8');

/** Noms des variables lues par la config (`process.env.X`). */
export const envVarsReadByConfig = (source) =>
  [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);

describe('lighthouserc — variables d’environnement hors du motif capturé par yargs', () => {
  it('la config ne lit AUCUNE variable LHCI_*', () => {
    const vars = envVarsReadByConfig(readConfig());
    expect(vars.length).toBeGreaterThan(0);
    expect(vars.filter((v) => v.startsWith('LHCI_'))).toEqual([]);
  });

  it('la config lit bien les deux variables attendues', () => {
    const vars = envVarsReadByConfig(readConfig());
    expect(vars).toContain('KOJO_LHCI_BASE_URL');
    expect(vars).toContain('KOJO_LHCI_AUTH_HEADER');
  });

  it('le workflow n’exporte plus LHCI_URL (l’alias yargs de --url)', () => {
    const workflow = fs.readFileSync(WORKFLOW, 'utf8');
    const exports = [...workflow.matchAll(/^\s*echo\s+"(LHCI_URL)=/gm)].map((m) => m[1]);
    expect(exports).toEqual([]);
    // Et la variable qui porte réellement la base est exportée.
    expect(workflow).toContain('echo "KOJO_LHCI_BASE_URL=');
  });

  it('le résolveur d’URL écrit KOJO_LHCI_BASE_URL dans $GITHUB_ENV', () => {
    const script = fs.readFileSync(RESOLVER, 'utf8');
    expect(script).toContain('KOJO_LHCI_BASE_URL=$KOJO_LHCI_BASE_URL');
    expect(script).not.toMatch(/^\s*echo "LHCI_URL=/m);
  });

  it('aucun script du dépôt ne lit encore LHCI_URL', () => {
    const offenders = [];
    for (const name of fs.readdirSync(path.join(FRONTEND_DIR, 'scripts'))) {
      if (!name.endsWith('.js')) continue;
      const full = path.join(FRONTEND_DIR, 'scripts', name);
      if (fs.readFileSync(full, 'utf8').includes('process.env.LHCI_URL')) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});

describe('lighthouserc — sélection des pages auditées', () => {
  // Ce qu'il faut verrouiller : un déploiement réel est audité sur les pages
  // protégées (sinon leurs budgets ne mesurent rien), et le repli build local
  // n'audite que des pages réellement servies.
  it('déclare les pages protégées pour un déploiement réel', () => {
    const source = readConfig();
    expect(source).toContain("PROTECTED_PATHS = ['/', '/dashboard', '/jobs', '/profile']");
  });

  it('limite le repli local à l’accueil (vite preview ne sert pas les .html par route)', () => {
    const source = readConfig();
    expect(source).toContain("PUBLIC_PATHS = ['/']");
  });

  it('applique au repli local un plafond TBT PLUS LARGE qu’au déploiement réel', () => {
    const source = readConfig();
    const m = /maxNumericValue:\s*targetIsLocal \? (\d+) : (\d+)/.exec(source);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThan(Number(m[2]));
  });

  it('documente le plafond CLS relevé et la raison (défaut /jobs)', () => {
    const source = readConfig();
    expect(source).toMatch(/cumulative-layout-shift': \['error', \{ maxNumericValue: 0\.15 \}\]/);
    expect(source).toContain('0.1353');
  });

  it('collecte 3 runs et agrège par médiane', () => {
    const source = readConfig();
    expect(source).toMatch(/numberOfRuns:\s*3/);
    expect(source).toMatch(/aggregationMethod:\s*'median'/);
  });
});
