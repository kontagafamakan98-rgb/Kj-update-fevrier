/**
 * La TABLE des budgets « Style & Layout » du document — éprouvée sur sa FORME.
 *
 * ── Ce que ce fichier tient, et ce qu'il ne tient pas ───────────────────────
 * Le verdict est prononcé par la sonde `e2e/style-layout-document.spec.js` (le
 * document pré-rendu, route par route, lu au CDP) ; ce fichier-ci tient la TABLE
 * que la sonde lit (`scripts/style-layout-budgets.cjs`), parce que trois façons
 * de se tromper y sont silencieuses en navigateur :
 *   1. une mesure de référence RECOPIÉE depuis un budget au lieu d'un relevé —
 *      la même valeur des deux côtés fait passer n'importe quoi ;
 *   2. une borne basse au-dessus de la borne haute : la sonde refuserait alors
 *      tout document, y compris le bon, et le premier réflexe serait d'élargir
 *      le budget plutôt que de lire la table ;
 *   3. une condition oubliée (une case sans `desktop`) : la route ne serait
 *      mesurée que dans une condition, et la moitié du verdict n'existerait pas.
 *
 * ── Les valeurs, elles, ne sont PAS re-dérivées ici ─────────────────────────
 * Les nombres sont des MINIMA MESURÉS (5 runs par case, le 25/09/2026, table et
 * récit dans `scripts/style-layout-budgets.cjs`) : un test qui les recalculerait
 * prouverait qu'il sait refaire une mesure qu'il n'a pas faite. Ce qui est
 * vérifié, c'est que le budget est bien DÉRIVÉ de la mesure (marge relative ou
 * absolue, la plus grande des deux) et que la table reste complète et ordonnée.
 *
 * L'appartenance des ROUTES est tenue par la sonde (elle compare la table à
 * `src/config/page-meta.js` et à ce que le build publie) ; ici, la couverture est
 * vérifiée contre la même source pour que la table ne puisse pas oublier une
 * route sans qu'aucun test rapide ne le dise.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { PAGE_META } from '../../src/config/page-meta.js';

const require = createRequire(import.meta.url);
const { CONDITIONS, MESURE, MARGES, BORNE_BASSE_RATIO, BUDGETS_STYLE_LAYOUT, budgetDe } =
  require('../style-layout-budgets.cjs');

/** Les routes pré-rendues, dérivées de la table unique (jamais recopiées). */
const ROUTES = Object.keys(PAGE_META).sort();
const CONDITIONS_NOMS = CONDITIONS.map((c) => c.nom);

/** Le plancher sous lequel un relevé n'est plus une mesure (ms). */
const PLANCHER_MESURE = 20;

describe('la table des budgets « Style & Layout » du document', () => {
  it('couvre EXACTEMENT les routes pré-rendues, avec les deux conditions par case', () => {
    expect(Object.keys(BUDGETS_STYLE_LAYOUT).sort()).toEqual(ROUTES);
    expect(Object.keys(MESURE).sort()).toEqual(ROUTES);
    for (const route of ROUTES) {
      expect(Object.keys(BUDGETS_STYLE_LAYOUT[route]).sort(), route).toEqual([...CONDITIONS_NOMS].sort());
      expect(Object.keys(MESURE[route]).sort(), route).toEqual([...CONDITIONS_NOMS].sort());
    }
  });

  it('les deux conditions sont celles des relevés : mobile bridé ×4, desktop intact', () => {
    expect(CONDITIONS).toEqual([
      { nom: 'mobile', viewport: { width: 412, height: 823 }, cpu: 4 },
      { nom: 'desktop', viewport: { width: 1350, height: 940 }, cpu: 1 },
    ]);
    // Les deux tailles du harnais de géométrie (`e2e/helpers/geometrie.js`) : deux
    // jeux de conditions divergents mesureraient deux sites différents.
    expect(CONDITIONS[0].viewport).toEqual({ width: 412, height: 823 });
    expect(CONDITIONS[1].viewport).toEqual({ width: 1350, height: 940 });
  });

  it('chaque mesure de référence est un relevé positif, jamais un zéro de repli', () => {
    for (const route of ROUTES) {
      for (const condition of CONDITIONS_NOMS) {
        expect(MESURE[route][condition], `${route}/${condition}`).toBeGreaterThan(PLANCHER_MESURE);
        expect(Number.isInteger(MESURE[route][condition]), `${route}/${condition}`).toBe(true);
      }
    }
  });

  it('la marge absolue et le ratio décident du budget, jamais la mesure seule', () => {
    // C'est LA propriété qui fait qu'un budget n'est pas un chiffre choisi : le
    // même calcul, éprouvé dans les deux régimes (le ratio domine en haut, la
    // marge absolue domine en bas) et dans les deux conditions.
    expect(budgetDe(1000, 'mobile')).toBe(1500);
    expect(budgetDe(1000, 'desktop')).toBe(1500);
    expect(budgetDe(20, 'desktop')).toBe(60); // 20 + 40 > 20 × 1,5
    expect(budgetDe(20, 'mobile')).toBe(100); // 20 + 80 > 20 × 1,5

    const { ratio, absolue } = MARGES.mobile;
    for (const mesure of [30, 100, 250, 662, 1000, 4000]) {
      const attendu = Math.ceil(Math.max(mesure * ratio, mesure + absolue) / 5) * 5;
      expect(budgetDe(mesure, 'mobile'), `${mesure} ms`).toBe(attendu);
    }
  });

  it('le budget est un multiple de 5 STRICTEMENT au-dessus de sa mesure de référence', () => {
    for (const route of ROUTES) {
      for (const condition of CONDITIONS_NOMS) {
        const mesure = MESURE[route][condition];
        const budget = BUDGETS_STYLE_LAYOUT[route][condition];
        expect(budget, `${route}/${condition}`).toBeGreaterThan(mesure);
        expect(budget % 5, `${route}/${condition}`).toBe(0);
        // Le budget est DÉRIVÉ : le recopier à la main (ou oublier la marge) se
        // verrait ici, et pas dans un navigateur.
        expect(budget, `${route}/${condition}`).toBe(budgetDe(mesure, condition));
      }
    }
  });

  it('la borne basse est strictement sous la mesure de référence ET sous le budget', () => {
    // Au-dessus du relevé, elle condamnerait le document mesuré lui-même ; au
    // niveau du budget, les deux bornes se contrediraient (un document ne peut
    // pas être à la fois trop cher et pas assez cher).
    expect(BORNE_BASSE_RATIO).toBeGreaterThan(0);
    expect(BORNE_BASSE_RATIO).toBeLessThan(1);
    for (const route of ROUTES) {
      for (const condition of CONDITIONS_NOMS) {
        const mesure = MESURE[route][condition];
        const budget = BUDGETS_STYLE_LAYOUT[route][condition];
        expect(mesure * BORNE_BASSE_RATIO, `${route}/${condition}`).toBeLessThan(mesure);
        expect(mesure * BORNE_BASSE_RATIO, `${route}/${condition}`).toBeLessThan(budget);
      }
    }
    // Et la borne doit laisser passer le document MESURÉ : c'est elle qui
    // attrape une perte de matière (mesuré : accueil amputé de ses neuf dernières
    // sections, 650 → 339 ms, soit 0,52 du relevé), pas une mesure rapide.
    expect(339, 'accueil amputé de ses 9 dernières sections (339 ms)').toBeLessThan(
      650 * BORNE_BASSE_RATIO
    );
  });

  it('la marge couvre le bruit mesuré de l’hôte, sans quoi le budget accuserait le poste', () => {
    // Le bruit de CET hôte est mesuré : la médiane monte jusqu'à +44 % au-dessus
    // du minimum sur l'accueil mobile (le minimum est ce que la sonde retient).
    // Une marge relative plus serrée que ce bruit condamnerait un artefact intact
    // selon le voisinage — c'est pourquoi le ratio dépasse cette valeur.
    const BRUIT_MESURE = 1.44;
    for (const condition of CONDITIONS_NOMS) {
      expect(MARGES[condition].ratio, condition).toBeGreaterThan(BRUIT_MESURE);
      expect(MARGES[condition].absolue, condition).toBeGreaterThan(0);
    }
    // Et elle n'est pas si large qu'elle ne distinguerait plus rien : le budget
    // de la route la plus légère reste plus serré que le double de son relevé.
    expect(BUDGETS_STYLE_LAYOUT['/jobs'].desktop).toBeLessThan(MESURE['/jobs'].desktop * 4);
  });

  it('une case qui manque est nommée, jamais silencieuse', () => {
    // La sonde lit `BUDGETS_STYLE_LAYOUT[route]?.[condition]` : une case absente
    // doit produire un budget LISIBLE comme absent (undefined), et non un repli
    // qui ferait mesurer la route contre un budget inventé.
    expect(BUDGETS_STYLE_LAYOUT['/route-qui-n-existe-pas']).toBeUndefined();
    expect(MESURE['/route-qui-n-existe-pas']).toBeUndefined();
    for (const route of ROUTES) {
      expect(BUDGETS_STYLE_LAYOUT[route].tablette, route).toBeUndefined();
    }
  });
});
