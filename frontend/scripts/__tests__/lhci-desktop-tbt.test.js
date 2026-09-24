/**
 * Garde TBT DESKTOP de l'accueil — éprouvé contre le moteur d'assertions de lhci.
 *
 * ── Ce que ce test vérifie, et pourquoi ainsi ───────────────────────────────
 * Le plafond (200 ms) est le seuil de l'audit qui a ouvert le chantier. Trois
 * façons de le poser de travers, toutes SILENCIEUSES en CI :
 *
 *   1. mesurer la mauvaise condition : sans `preset: 'desktop'`, cette passe
 *      mesurerait un TBT MOBILE (CPU ×4 + 4G) sous un plafond de 200 ms, et un
 *      runner affamé la ferait rougir au hasard — 1397 ms déjà mesurés pour un
 *      arbre vert (voir lighthouserc.cjs). Le preset est donc vérifié ;
 *   2. asserter la mauvaise STATISTIQUE : sur trois runs à [250, 10, 10], la
 *      médiane (250) rougit là où le meilleur run (10) décrit l'artefact. C'est
 *      le cas « runner affamé », et il est éprouvé explicitement ;
 *   3. poser un plafond que rien ne peut atteindre, ou qu'une page sans budget
 *      CLS mesuré pourrait contourner. Le refus de la table partagée est éprouvé
 *      en retirant réellement la route de la table.
 *
 * Les verdicts ne sont pas ré-implémentés : ils sont demandés à
 * `getAllAssertionResults` de @lhci/utils, le MÊME code que `lhci assert`
 * exécute. Un test qui recopierait la règle de comparaison pourrait être vert
 * avec une config que lhci refuserait.
 *
 * Les LHR sont des fixtures (trois runs, comme `numberOfRuns: 3`) : le contrôle
 * des vraies mesures est le relevé d'en-tête de lighthouserc.desktop.cjs, et la
 * course réelle du job.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CLS_BUDGETS } = require('../lhci-cls-budgets.cjs');
const { getAllAssertionResults } = require('@lhci/utils/src/assertions.js');

// Comme la passe mobile : la config est pilotée par l'environnement. Ici la base
// ne change RIEN au contenu de la matrice (une seule route), seulement l'URL
// auditée — donc la définir évite de dépendre du repli local pour lire la config.
process.env.KOJO_LHCI_BASE_URL = 'https://kojoforafrica.cc.cd';
const config = require('../../lighthouserc.desktop.cjs');
const ASSERT = config.ci.assert;

// Le seuil demandé, écrit ici en clair : le jour où quelqu'un le relèvera dans la
// config, ce test devra être modifié — donc relu.
const PLAFOND_MS = 200;

/** Un run Lighthouse minimal, mais complet pour ce que cette passe asserte. */
const lhr = (tbt, cls = 0) => ({
  finalUrl: 'https://kojoforafrica.cc.cd/',
  audits: {
    'total-blocking-time': { score: 1, numericValue: tbt },
    'cumulative-layout-shift': { score: 1, numericValue: cls },
  },
});

/** Les 3 runs d'un job, chacun avec son TBT. */
const troisRuns = (...tbts) => tbts.map((tbt) => lhr(tbt));

/** Assertions EN ÉCHEC (lhci ne renvoie que celles-là sans includePassedAssertions). */
const echecs = (lhrs) => getAllAssertionResults(ASSERT, lhrs);

/** Les identifiants d'audit en échec. */
const auditsEnEchec = (lhrs) => echecs(lhrs).map((verdict) => verdict.auditId);

describe('lighthouserc.desktop — TBT desktop de l’accueil (plafond 200 ms)', () => {
  it('audite l’accueil SEUL, en preset desktop, 3 runs', () => {
    expect(config.ci.collect.url).toHaveLength(1);
    expect(config.ci.collect.url[0]).toMatch(/\/$/);
    expect(config.ci.collect.numberOfRuns).toBe(3);
    // Sans ce champ, la passe ne mesure pas un TBT de bureau : elle rejouerait le
    // bridage mobile, et le plafond ne garderait plus ce qu'il annonce.
    expect(config.ci.collect.settings.preset).toBe('desktop');
  });

  it('porte le plafond de 200 ms, et n’ajoute pas de socle non mesuré', () => {
    // Une matrice, sans les options que lhci interdit à côté (il refuse la
    // config, mais seulement au moment du job : la structure est vérifiée ici).
    expect(Array.isArray(ASSERT.assertMatrix)).toBe(true);
    for (const interdit of ['assertions', 'aggregationMethod', 'preset', 'budgetsFile']) {
      expect(ASSERT[interdit], `${interdit} est exclusif de assertMatrix`).toBeUndefined();
    }
    // Plus d'entrée globale : elle appliquerait ce plafond à toute URL auditée.
    expect(ASSERT.assertMatrix.filter((entree) => !entree.matchingUrlPattern)).toEqual([]);

    const socle = ASSERT.assertMatrix.find((e) => e.aggregationMethod === 'optimistic');
    expect(socle.matchingUrlPattern).toBe('^https?://[^/]+/$');
    expect(socle.assertions['total-blocking-time']).toEqual([
      'error',
      { maxNumericValue: PLAFOND_MS },
    ]);
    // Le score, le FCP et le LCP restent à la passe mobile (13 pages, mesures à
    // l'appui) : les réasserter ici sans relevé desktop multiplierait les refus.
    for (const cle of [
      'categories:performance',
      'first-contentful-paint',
      'largest-contentful-paint',
    ]) {
      expect(socle.assertions[cle], cle).toBeUndefined();
    }
  });

  it('garde le plafond CLS MESURÉ de la route, via la table partagée', () => {
    const cls = ASSERT.assertMatrix.find((e) => e.aggregationMethod === 'median');
    expect(cls.assertions['cumulative-layout-shift']).toEqual([
      'error',
      { maxNumericValue: CLS_BUDGETS['/'].max },
    ]);
  });

  it('le MEILLEUR des 3 runs décide — un run affamé ne fait pas un rouge', () => {
    // Bruit de runner unilatéral : [250, 10, 10] décrit le coût propre de
    // l'artefact (10 ms), et l'assertion optimiste le dit. La médiane, elle,
    // aurait rendu 250 → rouge, sans qu'un octet ait changé (mesuré le
    // 20/09/2026 sur /login : deux jobs, même arbre, deux verdicts).
    expect(echecs(troisRuns(250, 10, 10))).toEqual([]);
    // Une régression, elle, monte dans les TROIS runs — même statistique, et
    // c'est là qu'elle doit rougir.
    expect(auditsEnEchec(troisRuns(250, 250, 250))).toContain('total-blocking-time');
  });

  it('REFUSE un TBT desktop au-dessus du plafond (la garde mord vraiment)', () => {
    // La mesure qui a ouvert le chantier : 477 ms — exactement ce qu'un retour
    // de l'audit doit casser.
    expect(auditsEnEchec(troisRuns(477))).toContain('total-blocking-time');
    // Et juste au-dessus du plafond : la marge est d'un millimètre, à dessein.
    expect(auditsEnEchec(troisRuns(PLAFOND_MS + 1))).toContain('total-blocking-time');
    // Les valeurs réellement mesurées passent, elles : 0 ms (production, 3 runs),
    // 15 ms (repli local sous saturation CPU de 4 boucles sur 8 cœurs).
    for (const mesure of [0, 15]) {
      expect(echecs(troisRuns(mesure)), `${mesure} ms devrait passer`).toEqual([]);
    }
  });

  it('refuse de se charger si la route n’a PLUS de plafond CLS mesuré', () => {
    // La table partagée refuse une page sans mesure : la garde ne peut donc pas
    // devenir aveugle en silence (une page auditée sans plafond de mise en page
    // passerait). Éprouvé en retirant RÉELLEMENT la route de la table puis en
    // rechargeant la config — d'où le vidage du cache de `require`, sans lequel
    // la réévaluation n'aurait pas lieu.
    const cheminConfig = require.resolve('../../lighthouserc.desktop.cjs');
    const sauvegarde = CLS_BUDGETS['/'];
    delete CLS_BUDGETS['/'];
    delete require.cache[cheminConfig];
    try {
      expect(() => require(cheminConfig)).toThrow(/budget CLS manquant pour \//);
    } finally {
      CLS_BUDGETS['/'] = sauvegarde;
      delete require.cache[cheminConfig];
    }
  });
});
