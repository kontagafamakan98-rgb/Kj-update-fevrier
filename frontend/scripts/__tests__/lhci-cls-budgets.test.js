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
  RETRAITS,
  SOCLE_MOBILE,
  TBT_MOBILE,
  clsAssertionMatrix,
  patternFor,
  plafondDe,
  socleMobile,
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
      // Le FCP est asserti PARTOUT : c'est la seule métrique qu'une coquille
      // pré-rendue peut dégrader sans que rien d'autre bouge (le premier pixel
      // peint), et la mesure ne le sépare pas d'un hôte à l'autre.
      expect(socle.assertions, `${route} : FCP`).toHaveProperty('first-contentful-paint');
      // Le TBT, lui, n'est asserti que là où une MESURE l'adosse (la pile locale,
      // 1397 ms relevés). Là où il manque, le retrait doit être ÉCRIT — sans quoi
      // une assertion disparaîtrait en silence, ce qui est exactement le défaut
      // que ce fichier existe pour rendre bruyant.
      if (!Object.hasOwn(socle.assertions, 'total-blocking-time')) {
        expect(
          RETRAITS,
          `${route} : TBT retiré sur cet hôte sans justification (voir RETRAITS)`
        ).toHaveProperty('total-blocking-time@deploiement');
      }
      // Et le SCORE n'est asserti nulle part : sa raison est dans RETRAITS.
      expect(
        socle.assertions,
        `${route} : le score est asserti — il n'est pas arbitré par la mesure`
      ).not.toHaveProperty('categories:performance');
      expect(RETRAITS).toHaveProperty('categories:performance');

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

  it('ne bloque PLUS le tag GA4, chargé après `load` depuis le 20/09/2026', () => {
    // Le tag a figuré dans la table quelques heures, tant qu'il était `async`
    // dans le `<head>` : il était alors la requête la plus lente du chemin
    // critique. Il est désormais DÉCLARÉ dans le HTML (`data-kojo-ga-src`) et
    // chargé APRÈS `load` par `src/utils/analytics.js` — et le LCP est finalisé
    // au `load`, donc le tag ne peut plus le décider. Rebloquer un tiers est un
    // choix : ce test exige qu'il soit rouvert explicitement (et justifié), au
    // lieu de revenir sans que rien ne le dise.
    const motifs = config.ci.collect.settings.blockedUrlPatterns.join(' ');
    for (const tiers of ['googletagmanager', 'google-analytics']) {
      expect(motifs, `${tiers} ne doit plus être bloqué`).not.toContain(tiers);
    }
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
      // Le verdict ne tient QU'au LCP : le score a été retiré (voir RETRAITS),
      // donc un LCP lent rougit par le budget qui le nomme, pas au travers d'une
      // moyenne pondérée. C'est ce qui rend le verdict lisible.
      expect(verdicts, `${route} : une seule grandeur en cause`).toEqual([
        'largest-contentful-paint',
      ]);
    }
    // Et sur la route déclarée, la MÊME mesure ne rougit pas : c'est la réponse
    // d'une API, pas l'artefact (les trois issues mesurées le sont : liste, état
    // vide, requête bloquée).
    for (const route of Object.keys(LCP_PRODUIT_PAR_UNE_REPONSE)) {
      expect(echecs(lent(route)), `${route} : exception`).toEqual([]);
    }
    // Le plafond vivant est celui de la TABLE MESURÉE, pas un littéral recopié :
    // la valeur attendue est DÉRIVÉE ici, comme la config la dérive.
    expect(soclePour('/login', SOCLE_GLOBAL)['largest-contentful-paint']).toEqual([
      'error',
      {
        maxNumericValue: plafondDe(
          SOCLE_MOBILE['largest-contentful-paint'].pire,
          SOCLE_MOBILE['largest-contentful-paint'].marge
        ),
      },
    ]);
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

describe('clsAssertionMatrix — socle commun OU socle par route', () => {
  it('accepte un OBJET (passe mobile) : même socle pour toutes les pages', () => {
    const socle = { 'total-blocking-time': ['error', { maxNumericValue: 1600 }] };
    const matrice = clsAssertionMatrix(['/', '/jobs'], socle);

    // Deux entrées par page : le socle (optimiste) et le CLS (médiane).
    expect(matrice).toHaveLength(4);
    for (const entree of matrice.filter((e) => e.aggregationMethod === 'optimistic')) {
      expect(entree.assertions['total-blocking-time']).toEqual(['error', { maxNumericValue: 1600 }]);
    }
  });

  it('accepte une FONCTION de la route (passe desktop) : un plafond par page', () => {
    // C'est la forme qui empêche un plafond de /jobs d'être celui de l'accueil par
    // simple commodité d'appel : la matrice est construite route par route.
    const matrice = clsAssertionMatrix(['/', '/jobs'], (route) => ({
      'total-blocking-time': ['error', { maxNumericValue: route === '/' ? 200 : 150 }],
    }));
    const plafondDe = (motif) =>
      matrice
        .find((e) => e.aggregationMethod === 'optimistic' && e.matchingUrlPattern === patternFor(motif))
        .assertions['total-blocking-time'][1].maxNumericValue;

    expect(plafondDe('/')).toBe(200);
    expect(plafondDe('/jobs')).toBe(150);
  });

  it('retire le LCP aussi quand le socle est une FONCTION', () => {
    // L'exception documentée (/jobs : son LCP est le moment où la réponse de son
    // API est connue) doit survivre au changement de forme du socle.
    const matrice = clsAssertionMatrix(['/jobs'], (route) => ({
      'total-blocking-time': ['error', { maxNumericValue: 150 }],
      'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
    }));
    const socle = matrice.find((e) => e.aggregationMethod === 'optimistic');

    expect(socle.assertions['total-blocking-time']).toBeDefined();
    expect(socle.assertions['largest-contentful-paint']).toBeUndefined();
  });
});

/**
 * LE SOCLE MOBILE EST DÉRIVÉ DE MESURES — angle mort 19(b), première moitié.
 *
 * Ce qui est éprouvé ici n'est pas la valeur des plafonds (elle peut changer avec
 * une re-mesure, c'est même le but) mais la PROPRIÉTÉ qui les rend portables :
 * chaque plafond vient d'une mesure NOMMÉE, le retrait d'une assertion est écrit,
 * et un hôte sans mesure n'hérite pas du plafond d'un autre.
 */
describe('socle mobile — des plafonds DÉRIVÉS de leurs mesures', () => {
  it('reproduit EXACTEMENT les plafonds littéraux qu’il remplace', () => {
    // C'est la vérification qui compte : cette passe ne change aucun verdict, elle
    // change d'où vient le nombre. Si une re-mesure déplace `pire`, ces égalités
    // tomberont — et c'est la table qu'il faudra relire, pas une phrase ailleurs.
    expect(plafondDe(SOCLE_MOBILE['largest-contentful-paint'].pire, SOCLE_MOBILE['largest-contentful-paint'].marge)).toBe(3500);
    expect(plafondDe(SOCLE_MOBILE['first-contentful-paint'].pire, SOCLE_MOBILE['first-contentful-paint'].marge)).toBe(2500);
    expect(plafondDe(TBT_MOBILE['pile-locale'].pire, TBT_MOBILE['pile-locale'].marge)).toBe(1600);
  });

  it('ne porte AUCUN plafond sans mesure nommée au-dessous de lui', () => {
    for (const [grandeur, entree] of Object.entries(SOCLE_MOBILE)) {
      expect(entree.pire, `${grandeur} : pire manquant`).toBeGreaterThan(0);
      expect(entree.marge, `${grandeur} : marge manquante`).toBeGreaterThan(1);
      expect(entree.mesure.length, `${grandeur} : la mesure doit être citée`).toBeGreaterThan(60);
      // Un plafond SOUS la pire mesure rougirait sur un fait déjà relevé.
      expect(plafondDe(entree.pire, entree.marge), grandeur).toBeGreaterThan(entree.pire);
    }
    for (const [hote, entree] of Object.entries(TBT_MOBILE)) {
      expect(entree.mesure.length, `TBT ${hote} : mesure`).toBeGreaterThan(40);
      expect(plafondDe(entree.pire, entree.marge), `TBT ${hote}`).toBeGreaterThan(entree.pire);
    }
  });

  it('REFUSE un hôte sans mesure, au lieu de lui prêter un plafond', () => {
    expect(() => socleMobile('preview-vercel')).toThrow(/hôte inconnu/);
    expect(() => socleMobile('preview-vercel')).toThrow(/TBT_MOBILE/);
    // Non-vacuité : les deux hôtes mesurés passent, eux.
    for (const hote of ['pile-locale', 'deploiement']) {
      expect(() => socleMobile(hote), hote).not.toThrow();
    }
    // Et la DIFFÉRENCE entre les deux est celle que la mesure a établie : le TBT
    // n'est asserti que là où un relevé l'adosse.
    expect(socleMobile('pile-locale')).toHaveProperty('total-blocking-time');
    expect(socleMobile('deploiement')).not.toHaveProperty('total-blocking-time');
  });

  it('écrit CHAQUE retrait avec la mesure qui le prononce', () => {
    expect(Object.keys(RETRAITS).length).toBeGreaterThanOrEqual(2);
    for (const [cle, justification] of Object.entries(RETRAITS)) {
      expect(typeof justification, `${cle} : justification`).toBe('string');
      expect(justification.length, `${cle} : justification`).toBeGreaterThan(80);
    }
  });
});
