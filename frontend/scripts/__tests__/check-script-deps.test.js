import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  findExternalSpecifiers,
  packageNameOf,
  runScriptDepsCheck,
} from '../check-script-deps';

// Tests du garde-fou « dépendances des scripts de CI »
// (scripts/check-script-deps.js) :
//   - un import externe NON DÉCLARÉ dans package.json est signalé, même s'il
//     est présent dans node_modules par hissage (le défaut qui a rendu le job
//     « Audits » rouge le 2026-08-27 sur `Cannot find module '@babel/parser'`) ;
//   - le rapport NOMME le paquet qui le tire en transitif (la cause, pas
//     seulement l'effet) ;
//   - un package.json modifié sans son lock est signalé (npm ci refuserait) ;
//   - les modules natifs Node et les chemins relatifs ne sont pas signalés ;
//   - le dépôt réel est vert, et les paquets qui avaient causé le rouge
//     (@babel/parser, @babel/traverse) y sont désormais déclarés en direct.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Fabrique un projet minimal (package.json + lock + scripts/) dans un dossier
 * temporaire : le vrai dépôt n'est jamais modifié.
 */
function makeProject({ declared = {}, lockDeps = null, scriptBody }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-deps-'));
  tempDirs.push(dir);
  const deps = declared.dependencies || {};
  const devDeps = declared.devDependencies || {};
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', dependencies: deps, devDependencies: devDeps }, null, 2)
  );
  const lock = lockDeps || { dependencies: deps, devDependencies: devDeps };
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify(
      {
        name: 'fixture',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { name: 'fixture', version: '0.0.0', ...lock },
          // Reproduit l'arbre réel : @babel/parser et @babel/traverse
          // n'arrivent que par le parent (le hissage npm qui a causé le rouge).
          'node_modules/transitive-parent': {
            version: '1.0.0',
            dependencies: {
              '@babel/parser': '^7.29.8',
              '@babel/traverse': '^7.29.8',
              'undeclared-pkg': '^1.0.0',
            },
          },
          'node_modules/@babel/parser': { version: '7.29.8', dev: true },
          'node_modules/@babel/traverse': { version: '7.29.8', dev: true },
          'node_modules/undeclared-pkg': { version: '1.0.0' },
        },
      },
      null,
      2
    )
  );
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'outil.cjs'), scriptBody);
  return dir;
}

describe('check-script-deps — extraction des spécificateurs', () => {
  it('écarte les chemins relatifs, les modules natifs et le préfixe node:', () => {
    const source = `
      const fs = require('fs');
      const path = require('node:path');
      import { helper } from './helper';
      import '../autre';
      require('@babel/parser');
      import traverse from '@babel/traverse';
    `;
    expect(findExternalSpecifiers(source).sort()).toEqual(['@babel/parser', '@babel/traverse']);
  });

  it('ramène un sous-chemin au nom du paquet déclarable', () => {
    expect(packageNameOf('@babel/parser')).toBe('@babel/parser');
    expect(packageNameOf('@babel/traverse/lib/path')).toBe('@babel/traverse');
    expect(packageNameOf('lodash/fp')).toBe('lodash');
  });

  it('attrape aussi le require multiligne, l\'import direct et l\'import dynamique', () => {
    const source = [
      "const p = require(",
      "  '@babel/parser'",
      ');',
      "import 'ajv';",
      "export { x } from 'lodash';",
      "import('@capacitor/cli');",
    ].join('\n');
    expect(findExternalSpecifiers(source)).toEqual([
      '@babel/parser',
      '@capacitor/cli',
      'ajv',
      'lodash',
    ]);
  });

  it('ignore les imports cités dans les commentaires et les chaînes', () => {
    // Cas réel : la première version de ce garde (à base d'expressions
    // régulières) se signalait ELLE-MÊME, parce que sa propre docstring cite
    // `require('x')` — lire l'AST supprime cette classe de faux positif.
    const source = [
      '/**',
      " * Exemple documenté : require('paquet-fantome') et from 'autre-fantome'.",
      ' */',
      '// import { rien } from "encore-un-fantome";',
      "const fixture = \"require('chaîne-de-test')\";",
      "const ok = require('@babel/parser');",
      'export default fixture || ok;',
    ].join('\n');
    expect(findExternalSpecifiers(source)).toEqual(['@babel/parser']);
  });

  it('n\'avale pas les imports d\'une source illisible (erreur de syntaxe remontée)', () => {
    expect(() => findExternalSpecifiers('const = broken(')).toThrow();
  });
});

describe('check-script-deps — import non déclaré (le défaut du 2026-08-27)', () => {
  it('signale un module uniquement disponible en transitif, et nomme sa cause', () => {
    const dir = makeProject({
      declared: { devDependencies: { vitest: '^3.2.7' } },
      scriptBody: "const parser = require('@babel/parser');\nmodule.exports = parser;\n",
    });
    const result = runScriptDepsCheck(dir);
    expect(result.ok).toBe(false);
    expect(result.undeclared.map((u) => u.module)).toEqual(['@babel/parser']);
    expect(result.undeclared[0].files).toEqual(['scripts/outil.cjs']);
    expect(result.undeclared[0].broughtBy).toEqual(['transitive-parent']);
    const message = result.errors.join('\n');
    expect(message).toContain('TRANSITIVE de transitive-parent');
    expect(message).toContain('npm install --save-dev @babel/parser');
  });

  it('signale un module que rien ne fournit du tout', () => {
    const dir = makeProject({
      declared: {},
      scriptBody: "const absent = require('paquet-qui-nexiste-pas');\n",
    });
    const result = runScriptDepsCheck(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('aucun paquet ne le fournit');
  });

  it('ne signale rien quand le module est déclaré en devDependencies', () => {
    const dir = makeProject({
      declared: { devDependencies: { '@babel/parser': '^7.29.8' } },
      scriptBody: "const parser = require('@babel/parser');\n",
    });
    const result = runScriptDepsCheck(dir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.undeclared).toEqual([]);
  });
});

describe('check-script-deps — lock synchronisé avec package.json', () => {
  it('signale un package.json modifié sans le lock (npm ci refuserait)', () => {
    const dir = makeProject({
      declared: { devDependencies: { '@babel/parser': '^7.29.8' } },
      // Lock resté sur l'état précédent : la nouvelle dépendance n'y figure pas.
      lockDeps: { devDependencies: {} },
      scriptBody: "const parser = require('@babel/parser');\n",
    });
    const result = runScriptDepsCheck(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('lock out of sync');
  });
});

describe('check-script-deps — le dépôt réel', () => {
  it('est vert et déclare en direct les paquets qui avaient causé le rouge', () => {
    const result = runScriptDepsCheck(REPO_ROOT);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    // Verrou du correctif : ces deux paquets ne doivent JAMAIS redevenir
    // seulement transitifs (c'était la cause du `Cannot find module`).
    expect(result.declared).toContain('@babel/parser');
    expect(result.declared).toContain('@babel/traverse');
    expect(result.undeclared).toEqual([]);
  });

  it('analyse un nombre non nul de scripts (le garde ne passe pas à vide)', () => {
    const result = runScriptDepsCheck(REPO_ROOT);
    expect(result.files).toBeGreaterThan(20);
  });
});
