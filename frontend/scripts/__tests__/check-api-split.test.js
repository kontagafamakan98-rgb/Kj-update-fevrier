import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  extractNamedExports,
  extractUrlMarkers,
  parseNamedImports,
  runApiSplitCheck,
} from '../check-api-split';

// Tests du garde-fou « split services/api » (scripts/check-api-split.js) :
//   - les helpers d'extraction (groupes lazy, marqueurs URL, imports nommés) ;
//   - le contrat au niveau SOURCE : aucun fichier ne peut importer un groupe
//     lazy depuis services/api (seul services/apiEndpoints est autorisé) ;
//   - le contrat au niveau BUNDLE : aucun marqueur URL d'un groupe lazy dans
//     le chunk d'entrée index-*.js, et les groupes core toujours présents ;
//   - le check est vert sur le dépôt + build courants.

const REPO_ROOT = path.resolve(__dirname, '../..');

// Arbre source minimal pour les tests négatifs (le vrai dépôt ne doit pas
// être modifié) :
//   src/services/api.js           → core (auth/me, auth/login…)
//   src/services/apiEndpoints.js  → jobsAPI, paymentAPI…
//   src/pages/Bad.js              → import fautif d'un groupe lazy depuis api
//   build/assets/index-<h>.js     → chunk d'entrée avec marqueur lazy
const makeFixture = (overrides = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'api-split-'));
  const src = path.join(root, 'src');
  const services = path.join(src, 'services');
  const pages = path.join(src, 'pages');
  const assets = path.join(root, 'build', 'assets');
  fs.mkdirSync(services, { recursive: true });
  fs.mkdirSync(pages, { recursive: true });
  fs.mkdirSync(assets, { recursive: true });

  fs.writeFileSync(
    path.join(services, 'api.js'),
    "export const api = { get: () => {} };\n" +
      "export const authAPI = { me: () => api.get('/auth/me'), login: () => api.post('/auth/login') };\n"
  );
  fs.writeFileSync(
    path.join(services, 'apiEndpoints.js'),
    "import { api } from './api';\n" +
      "export const jobsAPI = { getMyProposals: () => api.get('/proposals/mine') };\n" +
      "export const paymentAPI = { getQuote: () => api.post('/payments/quote') };\n"
  );
  fs.writeFileSync(
    path.join(assets, 'index-abc123.js'),
    overrides.indexContent || "export {};"
  );

  return { root, services, pages, assets };
};

describe('check-api-split : helpers', () => {
  it('extrait les groupes lazy (exportations nommées)', () => {
    const src = "export const jobsAPI = {};\nexport const usersAPI = {};\nexport default api;";
    expect(extractNamedExports(src)).toEqual(['jobsAPI', 'usersAPI']);
  });

  it("extrait les marqueurs URL littéraux (≥ 8 caractères, dédupliqués, sans code)", () => {
    const src =
      "const a = '/proposals/mine';\n" +
      "const b = `/jobs/${id}`; // template literal ignoré\n" +
      "const c = '/payments/quote';\n" +
      "const dup = '/proposals/mine';\n" +
      "const frag = '/x(' + y; // fragment de code ignoré";
    const markers = extractUrlMarkers(src);
    expect(markers).toContain('/proposals/mine');
    expect(markers).toContain('/payments/quote');
    expect(markers.filter((m) => m === '/proposals/mine').length).toBe(1);
    expect(markers).not.toContain('/x(');
  });

  it('parse les imports nommés, y compris les alias', () => {
    expect(parseNamedImports("import { jobsAPI } from '../services/api';")).toEqual(['jobsAPI']);
    expect(parseNamedImports("import { usersAPI as uAPI, reviewAPI } from '../services/api';")).toEqual(['usersAPI', 'reviewAPI']);
    expect(parseNamedImports("import api from '../services/api';")).toEqual([]);
  });
});

describe('check-api-split : contrat au niveau SOURCE', () => {
  it('échoue si un fichier importe un groupe lazy depuis services/api', () => {
    const fx = makeFixture();
    fs.writeFileSync(
      path.join(fx.pages, 'Bad.js'),
      "import { jobsAPI } from '../services/api';\nexport const x = jobsAPI;\n"
    );
    const result = runApiSplitCheck({ root: fx.root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/Bad\.js.*jobsAPI/);
    expect(result.errors.join('\n')).toMatch(/services\/apiEndpoints/);
  });

  it('accepte l\'import depuis services/apiEndpoints', () => {
    const fx = makeFixture();
    fs.writeFileSync(
      path.join(fx.pages, 'Good.js'),
      "import { jobsAPI } from '../services/apiEndpoints';\nexport const x = jobsAPI;\n"
    );
    const result = runApiSplitCheck({ root: fx.root });
    // Le seul échec attendu, s'il existe, vient du bundle — pas de l'import.
    expect(result.errors.join('\n')).not.toMatch(/Good\.js/);
  });

  it('échoue si services/apiEndpoints.js a disparu (découpage annulé)', () => {
    const fx = makeFixture();
    fs.rmSync(path.join(fx.services, 'apiEndpoints.js'));
    const result = runApiSplitCheck({ root: fx.root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/apiEndpoints\.js introuvable/);
  });
});

describe('check-api-split : contrat au niveau BUNDLE', () => {
  it('échoue si un marqueur URL lazy apparaît dans le chunk index', () => {
    const fx = makeFixture({ indexContent: "export const s = '/proposals/mine';" });
    const result = runApiSplitCheck({ root: fx.root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/chunk d'entrée index-\*\.js/);
    expect(result.errors.join('\n')).toMatch(/proposals\/mine/);
  });

  it('échoue si un marqueur core a disparu du chunk index', () => {
    const fx = makeFixture({ indexContent: "export {};" });
    const result = runApiSplitCheck({ root: fx.root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/core ABSENT/);
  });
});

describe('check-api-split : vert sur le dépôt et le build courants', () => {
  it('passe sur le repo + build actuels (18 groupes, core présent)', () => {
    const result = runApiSplitCheck({ root: REPO_ROOT });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
