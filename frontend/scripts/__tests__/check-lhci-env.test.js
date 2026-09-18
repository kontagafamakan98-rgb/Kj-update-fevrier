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
// construisait un tableau d'URLs (une par page) — mais `LHCI_URL` devenait l'option `--url`
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
const envVarsReadByConfig = (source) =>
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
  // Les listes sont lues et comparées comme des LISTES de chemins (et non comme
  // une chaîne à recopier) : ajouter une page auditée est alors un changement
  // d'une ligne ici, et le message d'échec nomme le chemin qui manque.
  const pathsOf = (source, variable) => {
    const m = new RegExp(`${variable}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);
    expect(m, `liste ${variable} introuvable dans lighthouserc.cjs`).not.toBeNull();
    return m[1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean);
  };

  // Ce qu'il faut verrouiller : un déploiement réel est audité sur toutes les
  // pages dont on veut suivre le CLS — pages protégées comprises (sinon leurs
  // budgets ne mesurent rien) et les pages PUBLIQUES, dont /register et
  // /forgot-password corrigées par les PR #19/#20 — tandis que le repli build
  // local n'audite que des pages réellement servies.
  it('audite les pages d’un déploiement réel (dont /register et /forgot-password)', () => {
    const paths = pathsOf(readConfig(), 'DEPLOYMENT_PATHS');
    expect(paths).toEqual([
      '/',
      '/jobs',
      '/login',
      '/register',
      '/forgot-password',
      '/payment',
      '/how-it-works',
      '/support',
      '/dashboard',
      '/profile',
    ]);
  });

  it('limite le repli local à l’accueil (un serveur local ne sert pas les pages protégées)', () => {
    const source = readConfig();
    expect(pathsOf(source, 'LOCAL_FALLBACK_PATHS')).toEqual(['/']);
    // Le tableau d'URLs doit bien être construit depuis CES deux listes :
    // aucune constante intermédiaire (dont le nom pourrait mentir) n'est lue.
    expect(source).toMatch(/const urls = auditedPaths\.map/);
    expect(source).toMatch(/const auditedPaths = targetIsLocal \? LOCAL_FALLBACK_PATHS : DEPLOYMENT_PATHS/);
  });

  it('traite une base LOOPBACK comme le repli local (la CI y sert la table de rewrites)', () => {
    // Depuis le 17/09/2026 la CI passe une URL loopback à ce config pour y
    // exercer le cycle /jobs/:id en HTTP. Sans cette règle, Lighthouse y
    // auditerait les 10 pages prévues pour un VRAI déploiement : /dashboard,
    // /jobs et /profile y redirigent vers /login (le build est compilé avec
    // l'API de prod) — des mesures qui ne décrivent aucune page, avec le
    // plafond TBT strict d'un déploiement au lieu de celui du repli.
    const source = readConfig();
    const m = /const targetIsLocal =([\s\S]*?);\n/.exec(source);
    expect(m, 'targetIsLocal introuvable dans lighthouserc.cjs').not.toBeNull();
    expect(m[1]).toMatch(/!baseUrl/);
    // La règle est LUE et exécutée, pas recopiée : un motif qui ne
    // reconnaîtrait pas 127.0.0.1 (l'adresse réellement utilisée par la CI)
    // ferait échouer ce test, au lieu de laisser passer dix pages auditées.
    const literal = /(\/\^[\s\S]*?\/)\.test\(baseUrl\)/.exec(m[1]);
    expect(literal, 'motif loopback introuvable dans targetIsLocal').not.toBeNull();
    const matcher = new RegExp(literal[1].slice(1, -1));
    for (const base of ['http://127.0.0.1:4174', 'http://localhost:4173', 'http://[::1]:4173']) {
      expect(matcher.test(base), base).toBe(true);
    }
    for (const base of ['https://kj-update-fevrier.vercel.app', 'https://x.vercel.app']) {
      expect(matcher.test(base), base).toBe(false);
    }
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
