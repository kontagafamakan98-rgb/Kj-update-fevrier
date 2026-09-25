/**
 * Garde TBT DESKTOP — un plafond PAR ROUTE, éprouvé contre le moteur
 * d'assertions de lhci.
 *
 * ── Ce que ce test vérifie, et pourquoi ainsi ───────────────────────────────
 * Chaque route porte SON plafond, adossé à SA mesure : 200 ms pour l'accueil
 * (le seuil de l'audit, 13× sa pire mesure), 150 ms pour /jobs (27 runs desktop
 * à 0 ms répartis en quatre conditions — cf. TBT_DESKTOP_BUDGETS). Quatre façons
 * de le poser de travers, toutes SILENCIEUSES en CI :
 *
 *   1. mesurer la mauvaise condition : sans `preset: 'desktop'`, cette passe
 *      mesurerait un TBT MOBILE (CPU ×4 + 4G) sous ce plafond, et un
 *      runner affamé la ferait rougir au hasard — 1397 ms déjà mesurés pour un
 *      arbre vert (voir lighthouserc.cjs). Le preset est donc vérifié ;
 *   2. asserter la mauvaise STATISTIQUE : sur trois runs à [250, 10, 10], la
 *      médiane (250) rougit là où le meilleur run (10) décrit l'artefact. C'est
 *      le cas « runner affamé » ET le cas « premier run à froid » (mesuré une
 *      fois à 1076 ms sur /jobs), et il est éprouvé explicitement ;
 *   3. couvrir la mauvaise URL : un motif qui ne matcherait pas la page auditée
 *      (ou deux) ferait passer la passe sans rien asserter, et un plafond que
 *      rien ne peut atteindre ne protégerait rien. Chaque route est donc
 *      vérifiée séparément, motif compris, et l'ajout de /jobs a exigé que sa
 *      route ait un plafond CLS MESURÉ — le refus est éprouvé en la retirant ;
 *   4. porter le plafond d'UNE page sur les autres : c'est ce que faisait le
 *      seuil commun, recopié de l'accueil (la page de l'audit, qui porte en plus
 *      le cadre Maps) sur /jobs qui n'a ni la même structure ni le même pire cas.
 *      Le plafond vient donc d'une table mesurée, route par route, et un
 *      littéral dans la config ferait rougir ce test.
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
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  CLS_BUDGETS,
  TBT_DESKTOP_BUDGETS,
  plafondTbtDesktop,
} = require('../lhci-cls-budgets.cjs');
const { getAllAssertionResults } = require('@lhci/utils/src/assertions.js');

// Comme la passe mobile : la config est pilotée par l'environnement. Ici la base
// ne change RIEN au contenu de la matrice (les motifs sont ancrés sur le CHEMIN),
// seulement l'URL auditée — donc la définir évite de dépendre du repli local.
process.env.KOJO_LHCI_BASE_URL = 'https://kojoforafrica.cc.cd';
const config = require('../../lighthouserc.desktop.cjs');
const ASSERT = config.ci.assert;

// Les plafonds demandés, écrits ici EN CLAIR : le jour où quelqu'un en relèvera
// un dans la table mesurée, ce test devra être modifié — donc relu. Chaque route
// porte le sien, et le test vérifie que la table est bien la source.
const PLAFONDS = { '/': 200, '/jobs': 150 };

// Pages auditées par cette passe, et le TBT réellement mesuré pour chacune (voir
// l'en-tête de TBT_DESKTOP_BUDGETS) : l'accueil 0 ms en production et 15 ms sous
// saturation CPU ; /jobs 0 ms sur 27 runs desktop répartis en quatre conditions
// (pile de la CI, 4 boucles CPU, bord de CDN froid, 7 boucles CPU) et 8 ms au
// pire sur un déploiement à chaud. Ces valeurs DOIVENT passer — un plafond né
// rouge serait un plafond qu'on relèverait à l'aveugle.
const MESURES = { '/': [0, 15], '/jobs': [0, 8] };
const ROUTES = Object.keys(MESURES);

/** Un run Lighthouse minimal, mais complet pour ce que cette passe asserte. */
const lhr = (route, tbt, cls = 0) => ({
  finalUrl: `https://kojoforafrica.cc.cd${route}`,
  audits: {
    'total-blocking-time': { score: 1, numericValue: tbt },
    'cumulative-layout-shift': { score: 1, numericValue: cls },
  },
});

/** Les 3 runs d'un job, chacun avec son TBT. */
const troisRuns = (route, ...tbts) => tbts.map((tbt) => lhr(route, tbt));

/** Assertions EN ÉCHEC (lhci ne renvoie que celles-là sans includePassedAssertions). */
const echecs = (lhrs) => getAllAssertionResults(ASSERT, lhrs);

/** Les identifiants d'audit en échec. */
const auditsEnEchec = (lhrs) => echecs(lhrs).map((verdict) => verdict.auditId);

/** L'entrée de matrice qui couvre cette route, pour la statistique demandée. */
const entreePour = (route, methode) => {
  const candidates = ASSERT.assertMatrix.filter(
    (e) => e.aggregationMethod === methode && new RegExp(e.matchingUrlPattern).test(`https://kojoforafrica.cc.cd${route}`)
  );
  // Un motif qui couvrirait deux pages ferait lever lhci (« Can only assert one
  // URL at a time! ») : la matrice est vérifiée sur ce point aussi.
  expect(candidates, `${route} : motifs ${methode}`).toHaveLength(1);
  return candidates[0];
};

describe('lighthouserc.desktop — TBT desktop (plafond 200 ms)', () => {
  it('audite l’accueil ET /jobs, en preset desktop, 3 runs', () => {
    const chemins = config.ci.collect.url.map((url) => new URL(url).pathname);
    expect(chemins).toEqual(['/', '/jobs']);
    expect(config.ci.collect.numberOfRuns).toBe(3);
    // Sans ce champ, la passe ne mesure pas un TBT de bureau : elle rejouerait le
    // bridage mobile, et le plafond ne garderait plus ce qu'il annonce.
    expect(config.ci.collect.settings.preset).toBe('desktop');
  });

  it('porte SON plafond sur chaque route, et n’ajoute pas de socle non mesuré', () => {
    // Une matrice, sans les options que lhci interdit à côté (il refuse la
    // config, mais seulement au moment du job : la structure est vérifiée ici).
    expect(Array.isArray(ASSERT.assertMatrix)).toBe(true);
    for (const interdit of ['assertions', 'aggregationMethod', 'preset', 'budgetsFile']) {
      expect(ASSERT[interdit], `${interdit} est exclusif de assertMatrix`).toBeUndefined();
    }
    // Plus d'entrée globale : elle appliquerait ce plafond à toute URL auditée.
    expect(ASSERT.assertMatrix.filter((entree) => !entree.matchingUrlPattern)).toEqual([]);

    for (const route of ROUTES) {
      const socle = entreePour(route, 'optimistic');
      expect(socle.assertions['total-blocking-time'], route).toEqual([
        'error',
        { maxNumericValue: PLAFONDS[route] },
      ]);
      // La table mesurée est la SOURCE du nombre, pas un commentaire à côté.
      expect(TBT_DESKTOP_BUDGETS[route].max, `${route} : table mesurée`).toBe(PLAFONDS[route]);
      // Le score, le FCP et le LCP restent à la passe mobile (13 pages, mesures à
      // l'appui) — et pour /jobs elle les exclut elle-même, son LCP étant le
      // moment où la réponse de son API est connue. Les réasserter ici sans
      // relevé desktop multiplierait les refus sans rien mesurer de plus.
      for (const cle of [
        'categories:performance',
        'first-contentful-paint',
        'largest-contentful-paint',
      ]) {
        expect(socle.assertions[cle], `${route} : ${cle}`).toBeUndefined();
      }
    }
  });

  it('garde le plafond CLS MESURÉ de chaque route, via la table partagée', () => {
    for (const route of ROUTES) {
      const cls = entreePour(route, 'median');
      expect(cls.assertions['cumulative-layout-shift'], route).toEqual([
        'error',
        { maxNumericValue: CLS_BUDGETS[route].max },
      ]);
    }
  });

  it('le MEILLEUR des 3 runs décide — un run affamé ne fait pas un rouge', () => {
    // Bruit unilatéral : [250, 10, 10] décrit le coût propre de l'artefact
    // (10 ms), et l'assertion optimiste le dit. La médiane, elle, aurait rendu
    // 250 → rouge, sans qu'un octet ait changé (mesuré le 20/09/2026 sur /login :
    // deux jobs, même arbre, deux verdicts). Le mode « premier run à froid »
    // observé sur /jobs (1076 ms, une fois sur 13) tombe dans ce même cas.
    expect(echecs(troisRuns('/jobs', 1076, 10, 10))).toEqual([]);
    expect(echecs(troisRuns('/jobs', 250, 10, 10))).toEqual([]);
    // Une régression, elle, monte dans les TROIS runs — et c'est là qu'elle doit
    // rougir, y compris la plus discrète.
    expect(auditsEnEchec(troisRuns('/jobs', 250, 250, 250))).toContain('total-blocking-time');
    expect(auditsEnEchec(troisRuns('/', 250, 250, 250))).toContain('total-blocking-time');
  });

  it('REFUSE un TBT desktop au-dessus du plafond de SA route', () => {
    for (const route of ROUTES) {
      // La mesure qui a ouvert le chantier : 477 ms — exactement ce qu'un retour
      // de l'audit doit casser.
      expect(auditsEnEchec(troisRuns(route, 477)), `${route} à 477 ms`).toContain(
        'total-blocking-time'
      );
      // Et juste au-dessus du plafond : la marge est d'un millimètre, à dessein.
      expect(auditsEnEchec(troisRuns(route, PLAFONDS[route] + 1)), `${route} au-dessus`).toContain(
        'total-blocking-time'
      );
      // Les valeurs réellement mesurées passent, elles.
      for (const mesure of MESURES[route]) {
        expect(echecs(troisRuns(route, mesure)), `${route} à ${mesure} ms devrait passer`).toEqual(
          []
        );
      }
    }
  });

  it('le plafond de /jobs tient au-dessus de sa BORNE HAUTE mesurée, et sous le mode froid', () => {
    // La borne haute qui justifie les 150 ms : sous famine CPU (7 boucles sur
    // 8 cœurs), la TOTALITÉ du travail de style et de mise en page de /jobs vaut
    // 149 ms — donc ~99 ms de blocage même si tout coalesçait en une seule tâche.
    // Ce cas doit PASSER : il est la raison d'être du plafond, pas un accident.
    expect(echecs(troisRuns('/jobs', 99, 99, 99)), 'borne haute').toEqual([]);
    // Et le plafond reste SOUS le mode froid mesuré avant correctif (1076 ms),
    // c'est-à-dire qu'il continue de l'attraper s'il redevenait permanent.
    expect(auditsEnEchec(troisRuns('/jobs', 1076, 1076, 1076)), 'mode froid').toContain(
      'total-blocking-time'
    );
  });

  it('refuse un plafond TBT pour une route qui n’a pas été mesurée', () => {
    expect(() => plafondTbtDesktop('/dashboard')).toThrow(/plafond TBT desktop manquant/);
    expect(plafondTbtDesktop('/jobs')).toBe(PLAFONDS['/jobs']);
  });

  it('délègue le plafond TBT à la table MESURÉE, route par route', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../lighthouserc.desktop.cjs'),
      'utf8'
    );
    // Un littéral en dur dans la config rendrait le plafond non adossé à une
    // mesure et invisible à ce test : c'est exactement ce que la route /jobs
    // portait avant (le seuil de l'accueil, recopié).
    expect(source).toMatch(/plafondTbtDesktop\(route\)/);
    expect(source).not.toMatch(/maxNumericValue:\s*\d+/);
  });

  it('refuse de se charger si une route auditée n’a PLUS de plafond TBT mesuré', () => {
    const cheminConfig = require.resolve('../../lighthouserc.desktop.cjs');
    const sauvegarde = TBT_DESKTOP_BUDGETS['/jobs'];
    delete TBT_DESKTOP_BUDGETS['/jobs'];
    delete require.cache[cheminConfig];
    try {
      expect(() => require(cheminConfig)).toThrow(/plafond TBT desktop manquant pour \/jobs/);
    } finally {
      TBT_DESKTOP_BUDGETS['/jobs'] = sauvegarde;
      delete require.cache[cheminConfig];
    }
  });

  it('refuse de se charger si une route auditée n’a PLUS de plafond CLS mesuré', () => {
    // La table partagée refuse une page sans mesure : la garde ne peut donc pas
    // devenir aveugle en silence, et l'ajout de /jobs à cette passe a exigé que
    // sa route ait un plafond CLS mesuré. Éprouvé en retirant RÉELLEMENT la route
    // de la table puis en rechargeant la config — d'où le vidage du cache de
    // `require`, sans lequel la réévaluation n'aurait pas lieu.
    const cheminConfig = require.resolve('../../lighthouserc.desktop.cjs');
    const sauvegarde = CLS_BUDGETS['/jobs'];
    delete CLS_BUDGETS['/jobs'];
    delete require.cache[cheminConfig];
    try {
      expect(() => require(cheminConfig)).toThrow(/budget CLS manquant pour \/jobs/);
    } finally {
      CLS_BUDGETS['/jobs'] = sauvegarde;
      delete require.cache[cheminConfig];
    }
  });
});
