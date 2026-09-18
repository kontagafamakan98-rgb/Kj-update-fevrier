/**
 * Budgets CLS par route de Lighthouse CI — éprouvés contre le résolveur de lhci.
 *
 * ── Ce que ce test vérifie, et pourquoi ainsi ───────────────────────────────
 * Le plafond CLS global (0,15) a été remplacé par un budget PAR ROUTE. Deux
 * façons de se tromper en le faisant, toutes deux silencieuses en CI :
 *   1. laisser un plafond global à côté de la matrice (lhci refuse la config,
 *      mais seulement au moment du job : `assertMatrix` est exclusif) — donc la
 *      structure est vérifiée ici ;
 *   2. écrire une matrice qui ne couvre pas une page auditée : elle serait
 *      mesurée SANS plafond CLS, et la régression passerait. La couverture est
 *      donc vérifiée page par page, et le refus d'une page sans budget est
 *      éprouvé.
 *
 * Les verdicts ne sont pas ré-implémentés : ils sont demandés à
 * `getAllAssertionResults` de @lhci/utils — le MÊME code que le job exécute.
 * Un test qui recopierait la règle de comparaison pourrait être vert avec une
 * config que lhci refuserait.
 *
 * Les LHR sont des fixtures (trois runs par page, comme `numberOfRuns: 3`) : le
 * contrôle des vraies mesures est l'objet du relevé d'en-tête de
 * scripts/lhci-cls-budgets.cjs, et de la course réelle du job.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CLS_BUDGETS, clsAssertionMatrix, patternFor } = require('../lhci-cls-budgets.cjs');
const { getAllAssertionResults } = require('@lhci/utils/src/assertions.js');

// La config est pilotée par l'environnement : on la charge comme le fait un run
// de `main` (déploiement réel), sinon elle n'auditerait que l'accueil.
process.env.KOJO_LHCI_BASE_URL = 'https://kojoforafrica.cc.cd';
const config = require('../../lighthouserc.cjs');
const ASSERT = config.ci.assert;

/** Page auditée → chemin ('/' pour la racine). */
const cheminDe = (url) => new URL(url).pathname;
const ROUTES = config.ci.collect.url.map(cheminDe);

/** Un run Lighthouse minimal, mais complet pour les assertions déclarées. */
const lhr = (route, { cls, score = 0.99, lcp = 1000, tbt = 10, fcp = 1000 } = {}) => ({
  finalUrl: `https://kojoforafrica.cc.cd${route}`,
  audits: {
    'cumulative-layout-shift': { score: 1, numericValue: cls },
    'largest-contentful-paint': { score: 1, numericValue: lcp },
    'total-blocking-time': { score: 1, numericValue: tbt },
    'first-contentful-paint': { score: 1, numericValue: fcp },
  },
  categories: { performance: { score } },
});

/** Les 3 runs d'un job, à la même valeur CLS. */
const troisRuns = (route, cls) => [lhr(route, { cls }), lhr(route, { cls }), lhr(route, { cls })];

/** Assertions EN ÉCHEC (lhci ne renvoie que celles-là sans includePassedAssertions). */
const echecs = (lhrs) => getAllAssertionResults(ASSERT, lhrs);

describe('lighthouserc — budgets CLS par route (assertMatrix)', () => {
  it('la config porte une MATRICE, sans les options que lhci interdit à côté', () => {
    expect(Array.isArray(ASSERT.assertMatrix)).toBe(true);
    // « Cannot use assertMatrix with other options » (@lhci/utils/src/assertions.js) :
    // les laisser ici ferait échouer le job, pas ce test — donc ils sont refusés.
    for (const interdit of ['assertions', 'aggregationMethod', 'preset', 'budgetsFile']) {
      expect(ASSERT[interdit], `${interdit} est exclusif de assertMatrix`).toBeUndefined();
    }
  });

  it('le socle global ne porte AUCUN plafond CLS, et chaque page a le sien', () => {
    const globales = ASSERT.assertMatrix.filter((entree) => !entree.matchingUrlPattern);
    expect(globales).toHaveLength(1);
    expect(globales[0].assertions).not.toHaveProperty('cumulative-layout-shift');
    // Le socle couvre bien le reste : sans cela, la matrice aurait perdu les
    // budgets de performance au passage.
    for (const cle of ['categories:performance', 'largest-contentful-paint', 'total-blocking-time']) {
      expect(globales[0].assertions).toHaveProperty(cle);
    }

    const parRoute = ASSERT.assertMatrix.filter((entree) => entree.matchingUrlPattern);
    expect(parRoute).toHaveLength(ROUTES.length);
    for (const entree of parRoute) {
      const couvertes = ROUTES.filter((route) => new RegExp(entree.matchingUrlPattern).test(
        `https://kojoforafrica.cc.cd${route}`
      ));
      // Un motif qui couvrirait deux pages ferait lever lhci (« Can only assert
      // one URL at a time! ») : la matrice est donc vérifiée sur ce point aussi.
      expect(couvertes, `motif ${entree.matchingUrlPattern}`).toHaveLength(1);
      expect(entree.assertions['cumulative-layout-shift']).toEqual([
        'error',
        { maxNumericValue: CLS_BUDGETS[couvertes[0]].max },
      ]);
      expect(entree.aggregationMethod).toBe('median');
    }
  });

  it('refuse d’auditer une page sans budget CLS mesuré', () => {
    expect(() => clsAssertionMatrix(['/produits'], {})).toThrow(/budget CLS manquant pour \/produits/);
    expect(() => clsAssertionMatrix(['/produits'], {})).toThrow(/CLS_BUDGETS/);
    // Non-vacuité : les pages réellement auditées passent, elles.
    expect(() => clsAssertionMatrix(ROUTES, {})).not.toThrow();
  });

  it('chaque budget est AU-DESSUS de la pire médiane mesurée (il n’a jamais rougi)', () => {
    for (const [route, budget] of Object.entries(CLS_BUDGETS)) {
      expect(budget.max, `${route} : ${budget.mesure}`).toBeGreaterThan(budget.pireMediane);
    }
  });

  it('les pages d’auth sont bien plus strictes que l’ancien plafond global', () => {
    // Le point de la passe : 0,15 ne pouvait pas attraper la régression fine
    // corrigée par #19 (0,0165 sur /register). Un budget qui remonterait vers
    // 0,15 rendrait l'audit décoratif — donc la propriété est verrouillée ici.
    for (const route of ['/register', '/forgot-password', '/login']) {
      expect(CLS_BUDGETS[route].max * 7).toBeLessThan(0.15);
    }
  });

  it('attrape la régression fine de /register, que le plafond 0,15 laissait passer', () => {
    // 0,05 : l'ordre de grandeur d'un décalage réintroduit sur la page.
    const lhrs = troisRuns('/register', 0.05);

    const verdicts = echecs(lhrs);
    expect(verdicts.map((v) => v.auditId)).toContain('cumulative-layout-shift');
    expect(verdicts.find((v) => v.auditId === 'cumulative-layout-shift').url).toBe(
      'https://kojoforafrica.cc.cd/register'
    );

    // Le MÊME jeu de mesures, sous l'ancien plafond global : vert. C'est la
    // régression que la passe ferme, et elle est rejouée ici plutôt que décrite.
    const ancien = getAllAssertionResults(
      {
        aggregationMethod: 'median',
        assertions: { 'cumulative-layout-shift': ['error', { maxNumericValue: 0.15 }] },
      },
      lhrs
    );
    expect(ancien).toEqual([]);
  });

  it('le budget est celui de la PAGE : la même mesure passe ici et échoue là', () => {
    const cls = 0.05; // sous le budget de /dashboard (0,06), au-dessus de /register (0,015)

    expect(echecs(troisRuns('/dashboard', cls))).toEqual([]);
    expect(echecs(troisRuns('/register', cls)).map((v) => v.auditId)).toContain(
      'cumulative-layout-shift'
    );

    // Et une valeur MESURÉE sur les deux bases ne rougit nulle part : les
    // budgets laissent passer ce qui est déjà observé.
    for (const route of ROUTES) {
      expect(echecs(troisRuns(route, CLS_BUDGETS[route].pireMediane)), route).toEqual([]);
    }
  });

  it('agrège par MÉDIANE : un run aberrant sur trois ne fait pas rougir le job', () => {
    // Un run sur trois à 0,1762 a réellement été mesuré sur /login (18 runs) ;
    // la médiane est restée 0. Avec l'agrégation pessimiste, le même run
    // condamnerait la page — c'est pourquoi l'agrégation est une propriété
    // testée, pas un détail de configuration.
    const [bon, bon2] = troisRuns('/login', 0);
    const aberrant = lhr('/login', { cls: 0.1762 });
    expect(echecs([bon, aberrant, bon2])).toEqual([]);

    const pessimiste = getAllAssertionResults(
      {
        matchingUrlPattern: patternFor('/login'),
        aggregationMethod: 'pessimistic',
        assertions: { 'cumulative-layout-shift': ['error', { maxNumericValue: CLS_BUDGETS['/login'].max }] },
      },
      [bon, aberrant, bon2]
    );
    expect(pessimiste.map((v) => v.auditId)).toEqual(['cumulative-layout-shift']);
  });
});
