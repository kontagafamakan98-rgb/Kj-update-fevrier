import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  discoverScopes,
  parseDict,
  analyzeScope,
  analyzeAllScopes,
  runPack2I18nHygieneCheck,
} from '../check-pack2-i18n-hygiene';

// Tests du garde « hygiène i18n pack2PageI18n » (scripts/check-pack2-i18n-hygiene.js).
//
// Ce garde promeut un audit lancé à la main (audit-all-scopes.tmp.cjs) en check
// CI permanent : les cas d'ÉCHEC comptent donc autant que le cas nominal — un
// garde qui ne rejoue pas une régression ne protège rien.
//
// Les fixtures sont des projets temporaires (src/utils/pack2PageI18n/<scope>.js
// + src/pages/<Page>.js) : aucun build ni dépôt réel n'est requis.

const tempDirs = [];
const SCRIPT = path.resolve(__dirname, '..', 'check-pack2-i18n-hygiene.js');

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// ── Fixtures : reproduit la mise en forme RÉELLE des fichiers de scope ──────

const entries = (dict, indent = '  ') =>
  Object.entries(dict)
    .map(([k, v]) => `${indent}${k}: '${v}'`)
    .join(',\n');

const scopeSource = ({ fr = {}, en = {}, wo = {}, bm = {}, mos = {} } = {}) =>
  [
    '// fixture de scope pack2PageI18n',
    'const withBase = (base, overrides) => ({ ...base, ...overrides });',
    'const dict = {',
    'fr: {',
    entries(fr),
    '},',
    'en: {',
    entries(en),
    '}',
    '};',
    'dict.wo = withBase(dict.fr, {',
    entries(wo),
    '});',
    'dict.bm = withBase(dict.fr, {',
    entries(bm),
    '});',
    'dict.mos = withBase(dict.fr, {',
    entries(mos),
    '});',
    '',
  ].join('\n');

const pageUsing = (scope, { statiques = [], dynamiques = [], erreurs = [] } = {}) =>
  [
    `import { makeScopedTranslator } from '../utils/pack2PageI18n/${scope}';`,
    ...statiques.map((k) => `const a = pageT('${k}');`),
    ...dynamiques.map((p) => 'const b = pageT(`' + p + '${x}`);'),
    ...erreurs.map((k) => `setError('${k}');`),
  ].join('\n');

const makeProject = ({ scopes = {}, pages = {} } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pack2-hygiene-'));
  tempDirs.push(root);
  const src = path.join(root, 'src');
  const pack2 = path.join(src, 'utils', 'pack2PageI18n');
  fs.mkdirSync(pack2, { recursive: true });
  fs.mkdirSync(path.join(src, 'pages'), { recursive: true });
  for (const [name, content] of Object.entries(scopes)) {
    fs.writeFileSync(path.join(pack2, `${name}.js`), content);
  }
  for (const [name, content] of Object.entries(pages)) {
    fs.writeFileSync(path.join(src, 'pages', name), content);
  }
  return { root, src, pack2 };
};

// ── Extraction des dictionnaires ───────────────────────────────────────────

describe('parseDict', () => {
  it('extrait les entrées quel que soit le niveau d indentation', () => {
    // Les fichiers réels mélangent indentation 0 et 2 espaces : exiger 2
    // espaces faisait échapper 33 entrées wo/bm/mos au contrôle de redondance.
    const dict = parseDict("otherUser: 'A',\n  placeholder: 'B'");
    expect(dict).toEqual({ otherUser: 'A', placeholder: 'B' });
  });

  it('ne confond pas une déclaration de langue avec une entrée', () => {
    expect(parseDict("en: {\n  titre: 'Titre'")).toEqual({ titre: 'Titre' });
  });
});

describe('discoverScopes', () => {
  it('liste les scopes et exclut core.js', () => {
    const { pack2 } = makeProject({
      scopes: { alpha: scopeSource({ fr: { a: 'A' } }), core: 'export const x = 1;' },
    });
    expect(discoverScopes(pack2)).toEqual(['alpha']);
  });
});

// ── Analyse d'un scope ─────────────────────────────────────────────────────

describe('analyzeScope', () => {
  const analyze = (project, scope = 'alpha') =>
    analyzeScope({ scope, pack2Dir: project.pack2, srcRoot: project.src });

  it('scope propre : aucune clé inutilisée, aucun override redondant', () => {
    const project = makeProject({
      scopes: { alpha: scopeSource({ fr: { titre: 'Titre' }, en: { titre: 'Title' }, wo: { titre: 'Titre ci' } }) },
      pages: { 'Alpha.js': pageUsing('alpha', { statiques: ['titre'] }) },
    });
    const res = analyze(project);
    expect(res.unused).toEqual([]);
    expect(res.redundant).toEqual([]);
    expect(res.keyCount).toBe(1);
  });

  it('détecte une clé que personne n appelle', () => {
    const project = makeProject({
      scopes: { alpha: scopeSource({ fr: { titre: 'Titre', ghost: 'Fantôme' } }) },
      pages: { 'Alpha.js': pageUsing('alpha', { statiques: ['titre'] }) },
    });
    expect(analyze(project).unused).toEqual(['ghost']);
  });

  it('détecte un override wo identique à fr', () => {
    const project = makeProject({
      scopes: { alpha: scopeSource({ fr: { titre: 'Titre' }, wo: { titre: 'Titre' } }) },
      pages: { 'Alpha.js': pageUsing('alpha', { statiques: ['titre'] }) },
    });
    expect(analyze(project).redundant).toEqual(['wo.titre']);
  });

  it('détecte aussi un override redondant écrit SANS indentation', () => {
    // Régression historique du parseur : une entrée à 0 espace était invisible,
    // donc un override identique à fr y échappait au contrôle.
    const source = scopeSource({ fr: { titre: 'Titre' } }).replace(
      'dict.wo = withBase(dict.fr, {',
      'dict.wo = withBase(dict.fr, {\ntitre: \'Titre\''
    );
    const project = makeProject({
      scopes: { alpha: source },
      pages: { 'Alpha.js': pageUsing('alpha', { statiques: ['titre'] }) },
    });
    expect(analyze(project).redundant).toContain('wo.titre');
  });

  it('ne signale pas une clé utilisée via un préfixe dynamique', () => {
    const project = makeProject({
      scopes: { alpha: scopeSource({ fr: { status_open: 'Ouvert', status_closed: 'Fermé' } }) },
      pages: { 'Alpha.js': 'import { makeScopedTranslator } from \'../utils/pack2PageI18n/alpha\';\nconst b = pageT(`status_${x}`);' },
    });
    expect(analyze(project).unused).toEqual([]);
  });

  it('ne signale pas une clé utilisée via un littéral d erreur', () => {
    const project = makeProject({
      scopes: { alpha: scopeSource({ fr: { loadFailed: 'Échec' } }) },
      pages: { 'Alpha.js': pageUsing('alpha', { erreurs: ['loadFailed'] }) },
    });
    expect(analyze(project).unused).toEqual([]);
  });

  it('ne signale pas une clé qu une page NON consommatrice appelle', () => {
    // La clé n'est appelée par aucune page important CE scope : elle reste
    // inutilisée pour ce scope (c'est exactement le cas à détecter).
    const project = makeProject({
      scopes: {
        alpha: scopeSource({ fr: { titre: 'Titre' } }),
        beta: scopeSource({ fr: { autres: 'Autres' } }),
      },
      pages: { 'Beta.js': pageUsing('beta', { statiques: ['titre'] }) },
    });
    expect(analyze(project, 'alpha').unused).toEqual(['titre']);
  });
});

// ── Câblage et issue réelle du check ───────────────────────────────────────

describe('runPack2I18nHygieneCheck', () => {
  it('renvoie ok:true sur un projet propre et ok:false avec annotation sinon', () => {
    const clean = makeProject({
      scopes: { alpha: scopeSource({ fr: { titre: 'Titre' } }) },
      pages: { 'Alpha.js': pageUsing('alpha', { statiques: ['titre'] }) },
    });
    const ok = runPack2I18nHygieneCheck({
      srcRoot: clean.src,
      pack2Dir: clean.pack2,
      log: () => {},
      error: () => {},
    });
    expect(ok.ok).toBe(true);

    const dirty = makeProject({
      scopes: { alpha: scopeSource({ fr: { titre: 'Titre', ghost: 'Fantôme' } }) },
      pages: { 'Alpha.js': pageUsing('alpha', { statiques: ['titre'] }) },
    });
    const annotations = [];
    const res = runPack2I18nHygieneCheck({
      srcRoot: dirty.src,
      pack2Dir: dirty.pack2,
      log: () => {},
      error: (line) => annotations.push(line),
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('ghost');
    expect(annotations.some((l) => l.startsWith('::error::'))).toBe(true);
  });

  it('sort en code 1 en CLI quand une régression est présente (donc job ROUGE)', () => {
    const dirty = makeProject({
      scopes: { alpha: scopeSource({ fr: { titre: 'Titre', ghost: 'Fantôme' }, wo: { titre: 'Titre' } }) },
      pages: { 'Alpha.js': pageUsing('alpha', { statiques: ['titre'] }) },
    });
    const run = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, PACK2_HYGIENE_SRC: dirty.src },
    });
    expect(run.status).toBe(1);
    expect(run.stderr + run.stdout).toContain('ghost');
    expect(run.stderr + run.stdout).toContain('wo.titre');
  });

  it('sort en code 0 en CLI sur un projet propre', () => {
    const clean = makeProject({
      scopes: { alpha: scopeSource({ fr: { titre: 'Titre' } }) },
      pages: { 'Alpha.js': pageUsing('alpha', { statiques: ['titre'] }) },
    });
    const run = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, PACK2_HYGIENE_SRC: clean.src },
    });
    expect(run.stdout).toContain('aucune clé inutilisée');
    expect(run.status).toBe(0);
  });

  it('le garde est branché comme étape CI permanente', () => {
    const workflow = fs.readFileSync(
      path.resolve(__dirname, '..', '..', '..', '.github', 'workflows', 'ci.yml'),
      'utf8'
    );
    expect(workflow).toContain('node scripts/check-pack2-i18n-hygiene.js');
  });
});
