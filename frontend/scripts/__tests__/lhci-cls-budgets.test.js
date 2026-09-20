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
const {
  CLS_BUDGETS,
  LCP_PRODUIT_PAR_UNE_REPONSE,
  REQUETES_HORS_CONTROLE,
  clsAssertionMatrix,
  patternFor,
  soclePour,
} = require('../lhci-cls-budgets.cjs');
const { getAllAssertionResults } = require('@lhci/utils/src/assertions.js');

// La config est pilotée par l'environnement : on la charge comme le fait un run
// de `main` (déploiement réel), sinon elle n'auditerait que l'accueil.
process.env.KOJO_LHCI_BASE_URL = 'https://kojoforafrica.cc.cd';
const config = require('../../lighthouserc.cjs');
const ASSERT = config.ci.assert;
// Le socle tel que la config le déclare (le budget TBT dépend de la surface).
const SOCLE_GLOBAL = ASSERT.assertMatrix.find((e) => e.aggregationMethod === 'optimistic').assertions;

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

  it('chaque page porte son socle ET son plafond CLS — sans entrée globale', () => {
    // Plus d'entrée sans motif : elle appliquait le même jeu de budgets à TOUTES
    // les pages, donc l'exception justifiée d'UNE page (le LCP de /jobs, produit
    // par la réponse de son API) aurait affaibli toutes les autres.
    expect(ASSERT.assertMatrix.filter((entree) => !entree.matchingUrlPattern)).toEqual([]);

    const motifCouvre = (motif) =>
      ROUTES.filter((route) => new RegExp(motif).test(`https://kojoforafrica.cc.cd${route}`));

    for (const route of ROUTES) {
      const entrees = ASSERT.assertMatrix.filter((e) => motifCouvre(e.matchingUrlPattern).includes(route));
      // Deux entrées par page : le socle (meilleur des 3 runs) et le CLS (médiane).
      expect(entrees, `entrées de ${route}`).toHaveLength(2);
      for (const entree of entrees) {
        // Un motif qui couvrirait deux pages ferait lever lhci (« Can only assert
        // one URL at a time! ») : la matrice est vérifiée sur ce point aussi.
        expect(motifCouvre(entree.matchingUrlPattern), `motif ${entree.matchingUrlPattern}`).toHaveLength(1);
      }

      const socle = entrees.find((e) => e.aggregationMethod === 'optimistic');
      // Le socle se compare au MEILLEUR des 3 runs : le bruit d'un runner est
      // unilatéral (il ne peut qu'ajouter du temps), donc le meilleur run décrit
      // le coût propre de l'artefact. Le 20/09/2026, sur deux jobs de `main`
      // portant le MÊME arbre, la MÉDIANE a rendu deux verdicts (0,79 sur /login
      // → main rouge, contre 0,97 de pire meilleur-run) sans qu'un octet change.
      for (const cle of ['first-contentful-paint', 'total-blocking-time']) {
        expect(socle.assertions, `${route} : ${cle}`).toHaveProperty(cle);
      }

      const cls = entrees.find((e) => e.aggregationMethod === 'median');
      expect(cls.assertions['cumulative-layout-shift']).toEqual([
        'error',
        { maxNumericValue: CLS_BUDGETS[route].max },
      ]);
    }
  });

  it('toutes les requêtes qui décidaient du verdict sont BLOQUÉES, et pas muettes', () => {
    const motifs = ASSERT.assertMatrix && config.ci.collect.settings.blockedUrlPatterns;
    expect(Array.isArray(motifs)).toBe(true);
    expect(motifs.length).toBeGreaterThan(0);

    const declares = Object.keys(REQUETES_HORS_CONTROLE);
    // Chaque motif déclaré est bien celui qui est bloqué, et il porte sa
    // justification : une liste écrite deux fois pourrait oublier l'une des
    // deux (et la requête lente resterait dans le chemin de mesure sans que
    // rien ne le dise).
    for (const motif of declares) {
      expect(motifs, motif).toContain(motif);
      expect(REQUETES_HORS_CONTROLE[motif].length, `${motif} : justification`).toBeGreaterThan(60);
      expect(motif.startsWith('*') && motif.endsWith('*'), `${motif} doit être un motif large`).toBe(true);
    }
    // Les chemins de NOTRE API doivent être sans hôte : le collect tourne sur la
    // production, sur une preview Vercel et sur le repli loopback, et un motif
    // qui nommerait l'hôte de production ne protégerait pas les deux autres.
    for (const motif of declares.filter((m) => m.includes('/api/'))) {
      expect(motif, `${motif} ne doit pas nommer un hôte`).not.toMatch(/kojoforafrica|localhost|127\.0\.0\.1/);
    }
    // Les chemins d'AUTHENTIFICATION ne sont pas bloqués : les pages protégées
    // doivent continuer d'être rendues avec le compte CI, sinon elles
    // redirigeraient vers /login — et deux URLs porteraient le même LHR.
    expect(motifs.join(' ')).not.toMatch(/auth|users\/me|session/);
  });

  it('le LCP n’est retiré que sur les routes déclarées, et jamais sans preuve', () => {
    for (const [route, justification] of Object.entries(LCP_PRODUIT_PAR_UNE_REPONSE)) {
      expect(ROUTES, `${route} déclarée hors LCP mais pas auditée`).toContain(route);
      expect(typeof justification, `${route} : justification`).toBe('string');
      expect(justification.length, `${route} : justification`).toBeGreaterThan(80);
    }
  });

  it('un LCP lent rougit sur les 12 autres pages (le plafond est resté vivant)', () => {
    // 4 256 ms : la valeur RÉELLE mesurée sur /jobs le 20/09/2026 à 13:34, sur un
    // FCP meilleur que celui du job vert — donc du temps d'API, pas de machine.
    const lent = (route) => troisRuns(route, 0).map((run, i) => ({
      ...run,
      audits: { ...run.audits, 'largest-contentful-paint': { score: 0, numericValue: 4256 + i } },
      categories: { performance: { score: 0.85 } },
    }));

    const assertes = ROUTES.filter((route) => !Object.hasOwn(LCP_PRODUIT_PAR_UNE_REPONSE, route));
    for (const route of assertes) {
      const verdicts = echecs(lent(route)).map((v) => v.auditId);
      expect(verdicts, `${route} : LCP`).toContain('largest-contentful-paint');
      expect(verdicts.some((id) => id.startsWith('categories')), `${route} : score`).toBe(true);
    }
    // Et sur la route déclarée, la MÊME mesure ne rougit pas : c'est la réponse
    // d'une API, pas l'artefact (les trois issues mesurées le sont : liste, état
    // vide, requête bloquée).
    for (const route of Object.keys(LCP_PRODUIT_PAR_UNE_REPONSE)) {
      expect(echecs(lent(route)), `${route} : exception`).toEqual([]);
    }
    expect(soclePour('/login', SOCLE_GLOBAL)['largest-contentful-paint']).toEqual(
      ['error', { maxNumericValue: 3500 }]
    );
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
