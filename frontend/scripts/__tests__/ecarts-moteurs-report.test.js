import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  MARKER,
  MIN_RELEVES,
  PAYLOAD_RE,
  buildPayload,
  lignesDuChangement,
  parseArgs,
  renderMarkdown,
  runReport,
} from '../ecarts-moteurs-report';
import { MARKER as BUNDLE_MARKER, fetchPriorPayload, extractPayloadAvec } from '../bundle-size-report';
import { calculerEcarts } from '../../e2e/helpers/moteurs.js';

// Tests du rapporteur des écarts par moteur
// (scripts/ecarts-moteurs-report.js).
//
// Ses trois risques propres ne sont pas de mal calculer (le calcul est délégué
// à e2e/helpers/moteurs.js, déjà testé) mais :
//   1. de faire CROIRE à un accord sur une table VIDE — un zéro sur rien ;
//   2. de calculer une « différence depuis le dernier push » contre une
//      référence absente ou illisible, ou de la taire ;
//   3. d'empiler un commentaire par push (ou de collisionner avec celui du
//      rapport de taille, qui utilise la même mécanique de marqueur).

const tempDirs = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecarts-moteurs-'));
  tempDirs.push(dir);
  return dir;
};

/** Écrit un fichier de relevés (une ligne JSON par relevé, comme la suite). */
const ecrireReleves = (releves) => {
  const fichier = path.join(tempDir(), 'mesures-moteurs.jsonl');
  fs.writeFileSync(fichier, releves.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return fichier;
};

const ACCORD = [
  { mesure: 'appui → carte montée', moteur: 'chromium', valeur: 'oui' },
  { mesure: 'appui → carte montée', moteur: 'firefox', valeur: 'oui' },
  { mesure: 'appui → carte montée', moteur: 'webkit', valeur: 'oui' },
  { mesure: 'molette → défilement', moteur: 'chromium', valeur: 900 },
  { mesure: 'molette → défilement', moteur: 'firefox', valeur: 900 },
  { mesure: 'molette → défilement', moteur: 'webkit', valeur: 900 },
];

const DIVERGENT = [
  { mesure: 'molette → défilement', moteur: 'chromium', valeur: 900 },
  { mesure: 'molette → défilement', moteur: 'firefox', valeur: 880 },
  { mesure: 'molette → défilement', moteur: 'webkit', valeur: 897 },
];

/** La charge utile d'un run, construite comme le script la construit. */
const charge = (releves, meta = {}) => {
  const moteurs = [...new Set(releves.map((r) => r.moteur))].sort();
  return buildPayload({ lignes: calculerEcarts(releves), releves: releves.length, moteurs, meta });
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('buildPayload', () => {
  it('porte les valeurs PAR MOTEUR et l’accord de chaque mesure', () => {
    const payload = charge(ACCORD, { ref: 'feat/x', sha: 'abcdef1234567890' });
    expect(payload.version).toBe(1);
    expect(payload.releves).toBe(6);
    expect(payload.moteurs).toEqual(['chromium', 'firefox', 'webkit']);
    expect(payload.mesures.length).toBe(2);
    expect(payload.mesures[0].valeurs).toEqual({ chromium: 'oui', firefox: 'oui', webkit: 'oui' });
    expect(payload.mesures[0].accord).toBe(true);
  });

  it('ne retient pas une mesure relevée sur un seul moteur (un écart sur un point vaut zéro)', () => {
    const payload = charge([
      { mesure: 'appui → carte montée', moteur: 'chromium', valeur: 1 },
      { mesure: 'molette → défilement', moteur: 'chromium', valeur: 2 },
      { mesure: 'molette → défilement', moteur: 'firefox', valeur: 3 },
    ]);
    expect(payload.mesures.map((m) => m.mesure)).toEqual(['molette → défilement']);
  });
});

describe('renderMarkdown', () => {
  it('porte le marqueur d’unicité et une charge utile relisible', () => {
    const current = charge(ACCORD);
    const body = renderMarkdown({ current, lignes: calculerEcarts(ACCORD) });
    expect(body).toContain(MARKER);
    expect(extractPayloadAvec(body, PAYLOAD_RE)).toEqual(current);
  });

  it('affiche une ligne par mesure avec les trois moteurs et le verdict', () => {
    const body = renderMarkdown({ current: charge(ACCORD), lignes: calculerEcarts(ACCORD) });
    expect(body).toContain('| Mesure | `chromium` | `firefox` | `webkit` | Écart |');
    expect(body).toContain('| `molette → défilement` | 900 | 900 | 900 | ✅ identique |');
    expect(body).toContain('**2/2** mesure(s) identique(s)');
  });

  it('nomme une étendue divergente au lieu de la taire', () => {
    const lignes = calculerEcarts(DIVERGENT);
    const body = renderMarkdown({ current: charge(DIVERGENT), lignes });
    expect(body).toContain('900 | 880 | 897');
    expect(body).toMatch(/⚠️ étendue 20 \(2,3 %\)/);
    expect(body).toContain('1 divergente(s)');
  });

  it('une table VIDE le dit, avec son compte de relevés (jamais un accord muet)', () => {
    const vide = [{ mesure: 'appui → carte montée', moteur: 'chromium', valeur: 'oui' }];
    const body = renderMarkdown({ current: charge(vide), lignes: calculerEcarts(vide) });
    expect(body).toContain('Aucune mesure relevée sur **deux moteurs**');
    expect(body).toContain('Relevés : **1**');
  });

  it('signale un moteur ABSENT au lieu de le laisser hors du tableau sans le dire', () => {
    const deux = [
      { mesure: 'molette → défilement', moteur: 'chromium', valeur: 900 },
      { mesure: 'molette → défilement', moteur: 'firefox', valeur: 900 },
    ];
    const body = renderMarkdown({ current: charge(deux), lignes: calculerEcarts(deux) });
    expect(body).toContain('Aucun relevé pour `webkit`');
  });

  it('avertit sous le plancher de lecture (un accord lu sur une table vide ne dit rien)', () => {
    const deux = [
      { mesure: 'molette → défilement', moteur: 'chromium', valeur: 900 },
      { mesure: 'molette → défilement', moteur: 'firefox', valeur: 900 },
    ];
    const body = renderMarkdown({ current: charge(deux), lignes: calculerEcarts(deux) });
    expect(body).toContain(`plancher ${MIN_RELEVES}`);
  });

  it('rappelle que le tableau complet vit dans l’artefact', () => {
    const body = renderMarkdown({
      current: charge(ACCORD),
      lignes: calculerEcarts(ACCORD),
      tableau: 'test-results/ecarts-moteurs.md',
    });
    expect(body).toContain('tableau complet : `test-results/ecarts-moteurs.md`');
  });
});

describe('lignesDuChangement', () => {
  it('sans commentaire précédent : dit que c’est le premier, sans inventer d’écart', () => {
    const lignes = lignesDuChangement({ current: charge(ACCORD), previous: null });
    expect(lignes.join(' ')).toContain('Premier commentaire');
  });

  it('remonte la raison d’une comparaison indisponible', () => {
    const lignes = lignesDuChangement({
      current: charge(ACCORD),
      previous: null,
      previousError: 'liste des commentaires HTTP 403',
    });
    expect(lignes.join(' ')).toContain('HTTP 403');
  });

  it('nomme une valeur qui a changé, moteur par moteur', () => {
    const avant = charge(ACCORD);
    const apres = charge(ACCORD.map((r) => (r.moteur === 'webkit' && r.valeur === 900 ? { ...r, valeur: 897 } : r)));
    const lignes = lignesDuChangement({ current: apres, previous: avant });
    expect(lignes.join(' ')).toContain('webkit : 900 → 897');
  });

  it('dit explicitement qu’aucune mesure n’a changé', () => {
    const courant = charge(ACCORD);
    expect(lignesDuChangement({ current: courant, previous: courant }).join(' ')).toContain(
      'Aucune mesure n’a changé'
    );
  });

  it('signale une mesure apparue et une mesure disparue', () => {
    const avant = charge(ACCORD);
    const apres = charge([...ACCORD, { mesure: 'taille 768 → barre basse', moteur: 'chromium', valeur: 1 }, { mesure: 'taille 768 → barre basse', moteur: 'firefox', valeur: 1 }]);
    const lignes = lignesDuChangement({ current: apres, previous: avant }).join('\n');
    expect(lignes).toContain('➕ `taille 768 → barre basse`');
    expect(lignesDuChangement({ current: avant, previous: apres }).join('\n')).toContain(
      '➖ `taille 768 → barre basse`'
    );
  });
});

describe('marqueurs : deux rapports, deux commentaires', () => {
  it('le marqueur des écarts ne collide pas avec celui du rapport de taille', () => {
    expect(MARKER).not.toBe(BUNDLE_MARKER);
    // Un commentaire du rapport de taille n’est PAS relu comme charge utile des
    // écarts (et réciproquement) : sans cette séparation, chaque rapport
    // écraserait le commentaire de l’autre.
    const corps = `${BUNDLE_MARKER}\n<!-- bundle-size-payload {"version":1} -->`;
    expect(extractPayloadAvec(corps, PAYLOAD_RE)).toBeNull();
  });

  it('fetchPriorPayload avec notre marqueur ignore le commentaire du bundle', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => [{ id: 1, body: `${BUNDLE_MARKER}\n<!-- bundle-size-payload {"version":1} -->` }],
    });
    const result = await fetchPriorPayload({
      repo: 'o/r',
      issueNumber: 1,
      token: 't',
      fetchImpl,
      marker: MARKER,
      payloadRe: PAYLOAD_RE,
    });
    expect(result).toEqual({ payload: null, error: '' });
  });
});

describe('runReport', () => {
  const emptyList = { ok: true, status: 200, json: async () => [] };

  it('lit les relevés, écrit le commentaire et le résumé, puis publie', async () => {
    const releves = ecrireReleves(ACCORD);
    const dir = tempDir();
    const markdown = path.join(dir, 'nested', 'comment.md');
    const out = path.join(dir, 'payload.json');
    const summary = path.join(dir, 'summary.md');

    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      const method = init.method || 'GET';
      calls.push({ url, method });
      return method === 'GET' ? emptyList : { ok: true, status: 201, json: async () => ({ id: 7 }) };
    };

    const result = await runReport({
      args: { releves, markdown, out, summary, post: true },
      env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', PR_NUMBER: '12' },
      fetchImpl,
      quiet: true,
    });

    expect(result.ok).toBe(true);
    expect(result.posted).toEqual({ action: 'créé', id: 7 });
    expect(fs.existsSync(markdown)).toBe(true);
    expect(fs.readFileSync(markdown, 'utf8')).toContain('molette → défilement');
    expect(fs.readFileSync(summary, 'utf8')).toContain(MARKER);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).releves).toBe(6);
    expect(calls.filter((c) => c.method === 'POST').length).toBe(1);
  });

  it('sans fichier de relevés : publie le VIDE au lieu de se taire, et ne rougit pas', async () => {
    const markdown = path.join(tempDir(), 'c.md');
    const result = await runReport({
      args: { releves: path.join(tempDir(), 'absent.jsonl'), markdown },
      env: {},
      quiet: true,
    });
    expect(result.ok).toBe(true);
    expect(result.markdown).toContain('Relevés : **0**');
    expect(result.markdown).toContain('Aucune mesure relevée sur **deux moteurs**');
  });

  it('sur main (pas de PR) : ne publie rien et le dit', async () => {
    const releves = ecrireReleves(ACCORD);
    const result = await runReport({
      args: { releves, post: true, markdown: path.join(tempDir(), 'c.md') },
      env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' },
      quiet: true,
    });
    expect(result.ok).toBe(true);
    expect(result.posted).toBeNull();
    expect(result.markdown).toContain('pas de numéro de PR');
  });

  it('sans jeton : remonte l’échec au lieu de simuler une publication', async () => {
    const releves = ecrireReleves(ACCORD);
    const result = await runReport({
      args: { releves, post: true, markdown: path.join(tempDir(), 'c.md') },
      env: { GITHUB_REPOSITORY: 'o/r', PR_NUMBER: '12' },
      quiet: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/GITHUB_TOKEN/);
  });
});

describe('parseArgs', () => {
  it('lit les options du CLI', () => {
    expect(parseArgs(['--releves', 'a.jsonl', '--table', 'b.md', '--post', '--dry-run'])).toEqual({
      releves: 'a.jsonl',
      tableau: 'b.md',
      markdown: '',
      out: '',
      summary: '',
      post: true,
      dryRun: true,
    });
  });
});
