/**
 * Preuve de la règle d'AVANCE de la rotation du héros
 * (`frontend/e2e/helpers/rotation.js`), sur le journal d'un rouge RÉEL.
 *
 * Le 24/10/2026, la CI a refusé « la rotation a avancé PLUS VITE que l'intervalle
 * déclaré » avec les écarts [14524,3 ; 14999,2 ; 15000] ms pour un intervalle de
 * 15 000 ms. Les écarts INTERNES valaient l'intervalle exact ; seul le premier,
 * ancré au montage, était court — l'ancre étant datée par un rappel de
 * `MutationObserver`, donc en retard de la latence du runner.
 *
 * Ce fichier fait deux choses, et la seconde compte autant que la première : il
 * vérifie que CE journal ne rougit plus, et il vérifie qu'un VRAI défaut (un
 * second minuteur à 7,5 s, ou un pas qui part plus d'une seconde en avance)
 * rougit toujours. Une tolérance qui ne serait plus contredite par personne
 * serait un renoncement déguisé en marge.
 */
import { describe, it, expect } from 'vitest';

import { ecartsSousLIntervalle } from '../../e2e/helpers/rotation.js';

const DELAI = 15000;
const entreCrans = 400;
const ancre = 1000;

/** Le journal du rouge du 24/10/2026, tel que la CI l'a publié. */
const JOURNAL_CI = [14524.3, 14999.2, 15000];

const fautifs = (ecarts, options = {}) =>
  ecartsSousLIntervalle({
    ecarts,
    delai: DELAI,
    margeEntreCrans: entreCrans,
    toleranceAncre: ancre,
    ...options,
  });

describe('rotation du héros — la règle d’avance', () => {
  it('accepte le journal du 24/10/2026 : la rotation était à l’heure', () => {
    const vus = fautifs(JOURNAL_CI);

    expect(vus, 'les écarts internes valaient 15000 ms ; seul l’ancre était en retard').toEqual([]);
  });

  it('accepte un premier écart à 14 100 ms (la latence d’ancre couverte, rien de plus)', () => {
    expect(fautifs([14100, 15000, 15000])).toEqual([]);
  });

  it('REFUSE un second minuteur : tous les écarts à la moitié de l’intervalle', () => {
    const vus = fautifs([7500, 7500, 7500]);

    expect(vus.map(({ i }) => i), 'chaque cran est fautif, pas seulement le premier').toEqual([0, 1, 2]);
    expect(vus[1].marge, 'les écarts internes gardent la marge serrée').toBe(entreCrans);
  });

  it('REFUSE un premier tour plus d’une seconde en avance', () => {
    const vus = fautifs([13900, 15000, 15000]);

    expect(vus.map(({ i, marge }) => ({ i, marge }))).toEqual([{ i: 0, marge: ancre }]);
  });

  it('REFUSE un pas plus court ENTRE deux crans, même si le premier est à l’heure', () => {
    const vus = fautifs([15000, 14400, 15000]);

    expect(vus.map(({ i, marge }) => ({ i, marge }))).toEqual([{ i: 1, marge: entreCrans }]);
  });

  it('publie le rang et la marge de chaque écart fautif, pour que le rouge se lise', () => {
    const [premier] = fautifs([100, 100, 100]);

    expect(premier).toEqual({ e: 100, i: 0, marge: ancre });
  });
});
