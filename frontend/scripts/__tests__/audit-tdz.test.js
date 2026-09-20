import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── L'audit TDZ est un GARDE : il doit sortir en erreur sur un TDZ certain.
// Trois façons de le prouver, sans réimplémenter sa détection :
//   1. le CLI réel, sur un arbre de fixture (`KOJO_TDZ_DIR`), pour le code de retour ;
//   2. sa fonction pure, pour la classification direct/nested ;
//   3. l'arbre réel du dépôt, qui est ce que la CI exécute.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'audit_tdz.cjs');
const require = createRequire(import.meta.url);
const { analyserLeCode, analyserLeDepot } = require(SCRIPT);

const tempDirs = [];

function arbreFixture(source) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-tdz-'));
  tempDirs.push(base);
  fs.mkdirSync(path.join(base, 'pages'));
  fs.writeFileSync(path.join(base, 'pages', 'Fixture.js'), source);
  return base;
}

function lancerAudit(racine) {
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, KOJO_TDZ_DIR: racine },
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

// Une table lue dans le MÊME corps de fonction que celui où elle est déclarée,
// mais plus haut : la classe de bug qui a laissé la page d'accueil blanche (un
// ReferenceError attrapé par l'ErrorBoundary).
const SOURCE_TDZ_DIRECT = `
export const Cartes = () => {
  const drapeaux = CARTES.map((c) => c.flag);
  const CARTES = [{ country: 'benin', flag: '🇧🇯' }];
  return <div>{drapeaux}</div>;
};
`;

// Même ordre, mais la lecture est dans un effet : il s'exécute après le rendu,
// donc la constante est déjà initialisée. Informative, jamais bloquante.
const SOURCE_IMBRIQUEE = `
export const Cartes = () => {
  useEffect(() => {
    charger(REPLIS.length);
  }, []);
  return null;
};

const REPLIS = [1000, 500];
`;

describe('audit TDZ — le CLI refuse la classe directe', () => {
  it('sort en erreur et nomme la constante lue avant sa déclaration', () => {
    const { code, stdout } = lancerAudit(arbreFixture(SOURCE_TDZ_DIRECT));
    expect(stdout, `sortie de l'audit : ${stdout}`).toContain('CARTES');
    expect(code, `audit TDZ direct : attendu 1, obtenu ${code}\n${stdout}`).toBe(1);
  });

  it('accepte la forme imbriquée (lecture dans un effet, après le rendu)', () => {
    const { code, stdout } = lancerAudit(arbreFixture(SOURCE_IMBRIQUEE));
    expect(stdout).toContain('NESTED');
    expect(code, `audit TDZ imbriqué : attendu 0, obtenu ${code}\n${stdout}`).toBe(0);
  });
});

describe('audit TDZ — classification', () => {
  it('classe en direct une lecture dans le même scope', () => {
    const { direct } = analyserLeCode(SOURCE_TDZ_DIRECT, 'Fixture.js');
    expect(direct.map((e) => e.binding)).toEqual(['CARTES']);
    expect(direct[0].declLine).toBeGreaterThan(direct[0].refLine);
  });

  it('ne classe pas en direct une lecture depuis une fonction imbriquée', () => {
    const { direct, nested } = analyserLeCode(SOURCE_IMBRIQUEE, 'Fixture.js');
    expect(direct).toEqual([]);
    expect(nested.map((e) => e.binding)).toEqual(['REPLIS']);
  });
});

describe('audit TDZ — arbre réel', () => {
  it("n'a aucun TDZ certain dans src/", () => {
    const { direct, erreurs } = analyserLeDepot();
    expect(erreurs, `fichiers illisibles : ${erreurs.join(' | ')}`).toEqual([]);
    const resume = direct.map((e) => `${e.file}:${e.refLine} ${e.binding}`).join(', ');
    expect(resume, `TDZ certain(s) : ${resume}`).toBe('');
  });
});
