/**
 * LE CONTRASTE PAR JETONS MORD — la feuille livrée, et des feuilles mutées.
 *
 * Un garde qu'on n'a jamais vu rougir peut être aveugle (motif F17 du registre).
 * Chaque refus de `scripts/contraste-jetons.js` est donc rejoué ici sur une
 * feuille MUTÉE : valeur de jeton dérivée, jeton retiré, jeton déclaré mais
 * jamais peint, couple sous son seuil. Le cas sain, lui, passe — sans quoi une
 * règle qui refuse tout ne prouverait rien.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JETONS,
  PAIRES,
  PLANCHER_JETONS,
  PLANCHER_PAIRES,
  SEUIL_GRAPHIQUE,
  SEUIL_TEXTE,
  contrasteEntre,
  mesurerContrasteJetons,
} from '../contraste-jetons.js';

// La FEUILLE RÉELLE, pas une fixture : un contraste se casse dans le CSS du
// site, pas dans une fonction de calcul.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FEUILLE = readFileSync(path.join(RACINE, 'src', 'index.css'), 'utf8');

const messages = (mesure) => mesure.erreurs.join('\n');

describe('contraste par jetons — la feuille livrée', () => {
  it('passe tous ses couples, et refuse de conclure sur une table trop courte', () => {
    const mesure = mesurerContrasteJetons(FEUILLE);

    expect(mesure.erreurs, messages(mesure)).toEqual([]);
    expect(mesure.ok).toBe(true);
    expect(mesure.verdicts.length).toBeGreaterThanOrEqual(PLANCHER_PAIRES);
    expect(Object.keys(JETONS).length).toBeGreaterThanOrEqual(PLANCHER_JETONS);
    expect(PAIRES.length).toBeGreaterThanOrEqual(PLANCHER_PAIRES);
  });

  it('mesure chaque couple au seuil de son usage, jamais à un seuil unique', () => {
    const mesure = mesurerContrasteJetons(FEUILLE);
    for (const verdict of mesure.verdicts) {
      expect([SEUIL_TEXTE, SEUIL_GRAPHIQUE], verdict.nom).toContain(verdict.seuil);
      expect(verdict.ratio, verdict.nom).toBeGreaterThanOrEqual(verdict.seuil);
    }
  });

  it('le calcul de contraste suit la formule WCAG (noir/blanc = 21:1)', () => {
    expect(contrasteEntre('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrasteEntre('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Symétrique : l'ordre des deux couleurs ne change pas le ratio.
    expect(contrasteEntre('#15803d', '#f0fdf4')).toBeCloseTo(
      contrasteEntre('#f0fdf4', '#15803d'),
      10
    );
  });
});

describe('contraste par jetons — les refus', () => {
  it('nomme un jeton dont la feuille a dérivé de la valeur mesurée', () => {
    const mutee = FEUILLE.replace('--kojo-encre: #1c1917;', '--kojo-encre: #44403c;');
    expect(mutee).not.toBe(FEUILLE);

    const mesure = mesurerContrasteJetons(mutee);

    expect(messages(mesure)).toMatch(/--kojo-encre : la feuille déclare #44403c/);
    expect(mesure.ok).toBe(false);
  });

  it('refuse un jeton mesuré qui a disparu de la feuille', () => {
    const mutee = FEUILLE.replace('--kojo-bleu: #1d4ed8;', '');
    const mesure = mesurerContrasteJetons(mutee);

    expect(messages(mesure)).toMatch(/--kojo-bleu : absent de la feuille/);
  });

  it('refuse un jeton déclaré que plus aucune règle ne peint', () => {
    // Le jeton existe, sa valeur est juste — mais la pastille est revenue au
    // littéral : c'est exactement l'angle mort que « par jetons » ferme.
    const mutee = FEUILLE.replace(
      'background-color: var(--kojo-neutre-fond);',
      'background-color: #fafaf9;'
    );
    expect(mutee).not.toBe(FEUILLE);

    const mesure = mesurerContrasteJetons(mutee);

    expect(messages(mesure)).toMatch(/--kojo-neutre-fond : déclaré mais jamais employé/);
  });

  it('refuse un couple sous son seuil en nommant le ratio et le remède', () => {
    // Vert clair « pastille terminée » : le texte perd sa lisibilité.
    const mutee = FEUILLE.replace('--kojo-succes: #15803d;', '--kojo-succes: #86efac;');
    const mesure = mesurerContrasteJetons(mutee);
    const erreur = mesure.erreurs.find((message) => message.includes('pastille terminée'));

    expect(erreur, messages(mesure)).toBeTruthy();
    expect(erreur).toMatch(/\d+\.\d+:1, sous le seuil 4\.5:1/);
    expect(erreur).toMatch(/assombrir l’encre ou éclaircir le fond/);
  });

  it('refuse de conclure sur une feuille qu’il lit à peine', () => {
    const mesure = mesurerContrasteJetons('body { color: red; }');

    expect(messages(mesure)).toMatch(/refuse de conclure/);
    expect(mesure.ok).toBe(false);
  });

  it('un seuil hors norme est une erreur, pas une exception silencieuse', () => {
    // La règle lit les seuils des paires : un 2:1 « parce que c’est du petit
    // texte » ne doit pas passer par une paire ajoutée à la main.
    const mesure = mesurerContrasteJetons(FEUILLE, {
      paires: [{ ...PAIRES[0], nom: 'paire trop tolérante', seuil: 2 }],
    });

    expect(messages(mesure)).toMatch(/paire trop tolérante : seuil 2 hors norme/);
  });
});
