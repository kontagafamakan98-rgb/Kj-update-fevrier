/**
 * LE PLAFOND D'AIRE LCP DES ROUTES D'APPLICATION — éprouvé sur sa RÈGLE, jamais
 * sur ses chiffres.
 *
 * ── Ce que ce fichier vérifie, et pourquoi ces deux fautes-là ──────────────
 * La table (`scripts/lcp-app-budgets.cjs`) fournit une BANDE par route et par
 * taille ; c'est `e2e/lcp-app.spec.js` qui prononce le verdict, en navigateur.
 * Deux fautes resteraient silencieuses sans ce fichier :
 *
 *   1. une cellule mesurée par UN SEUL run, ou sans élément élu — « plusieurs
 *      runs » est la condition qui fait d'un chiffre une MESURE, et c'est la
 *      demande explicite de la passe (« un plafond mesuré sur plusieurs runs ») ;
 *   2. un plafond DÉTACHÉ de sa mesure : assez haut pour ne jamais rougir, donc
 *      un budget décoratif. Le garde confronte donc chaque plafond à la règle de
 *      dérivation de la table du CLS (`plafondDe`), qui est LUE et non réécrite
 *      — deux tables, une seule formule — et il exige que le rapport plafond /
 *      mesure reste celui de la marge publiée.
 *
 * ── LE PLANCHER COMPTE AUTANT QUE LE PLAFOND, et c'est PROUVÉ ici ───────────
 * Une aire LCP d'1 px² passe sous n'importe quel plafond : une bande réduite au
 * plafond serait un faux vert permanent, et c'est exactement ce que le dépôt
 * refuse ailleurs (`PLANCHERS_NOEUDS`, `PLANCHERS_PREMIER_ECRAN` : un plancher de
 * zéro est toujours satisfait). Les trois verdicts de `verdictDaire` sont donc
 * épuisés, bornes INCLUSES, et la contrepartie est rejouée : la même page
 * réduite à rien passe le plafond ET est refusée par le plancher.
 *
 * AUCUNE VALEUR N'EST RECOPIÉE ICI : re-mesurer la table doit déplacer ses bornes
 * sans qu'une ligne de ce fichier ne bouge. C'est la raison pour laquelle les
 * assertions portent sur les RELATIONS dérivées, pas sur les dix nombres.
 *
 * ── CE QUE CE FICHIER NE PEUT PAS VOIR, ET QUI A ÉTÉ MESURÉ ───────────────
 * Il juge la FORME de la table et sa DÉRIVATION, jamais son accord avec la PAGE.
 * C'est un fait vérifié, pas une précaution de rédaction : les runs de
 * `/dashboard` remplacés par 100 000 px² (une page qui en peint 8 626) laissent
 * les cinq cas ci-dessous VERTS — la table reste bien formée et correctement
 * dérivée, elle décrit simplement une autre page. Cette moitié-là appartient à
 * `e2e/lcp-app.spec.js`, et elle y a été prouvée : la MÊME table mutée rougit en
 * navigateur, « sous la bande mesurée 60000–125000 px² » d'un côté (le plancher)
 * et « au-dessus la bande mesurée 600–1300 px² » de l'autre (le plafond, mutation
 * séparée : le describe de la sonde est en mode SÉRIEL, donc le premier rouge
 * court-circuite les cas suivants et les deux côtés ne peuvent pas être rejoués
 * dans le même passage). Deux moitiés, deux preuves, et aucune des deux ne se fait
 * passer pour l'autre.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  LCP_APP_BUDGETS,
  TAILLES_APP,
  MARGE,
  PART_PLANCHER,
  arrondiAire,
  pireDesRuns,
  plafondAire,
  plancherAire,
  verdictDaire,
  bandeDaireApp,
} = require('../lcp-app-budgets.cjs');
// LA RÈGLE DE DÉRIVATION A UN PROPRIÉTAIRE — celle de la table du CLS, lue ici :
// réécrire `Math.round((pire * marge) / 100) * 100` aurait fait deux formules à
// tenir d'accord, et leur divergence d'un cran serait invisible.
const { plafondDe } = require('../lhci-cls-budgets.cjs');

/** Les cellules de la table, à plat : route + taille + relevé. */
const CELLULES = Object.entries(LCP_APP_BUDGETS).flatMap(([route, parTaille]) =>
  Object.entries(parTaille).map(([taille, cellule]) => ({ route, taille, cellule }))
);

describe('lcp-app-budgets — la bande d’aire LCP des cinq routes d’application', () => {
  it('chaque cellule est mesurée par PLUSIEURS runs et nomme son élément élu', () => {
    // Les planchers de lecture : sous eux, le fichier refuserait de juger un
    // balayage qui n'a rien lu.
    expect(Object.keys(LCP_APP_BUDGETS).length).toBeGreaterThanOrEqual(5);
    expect(TAILLES_APP.length).toBeGreaterThanOrEqual(2);
    expect(CELLULES.length).toBeGreaterThanOrEqual(10);

    for (const { route, taille, cellule } of CELLULES) {
      expect(cellule.runs.length, `${route} (${taille}) : runs`).toBeGreaterThanOrEqual(3);
      for (const run of cellule.runs) {
        expect(run, `${route} (${taille}) : un run non mesuré`).toBeGreaterThan(0);
      }
      // L'élément élu est déclaré parce que la borne porte sur l'aire de CETTE
      // élection : sans lui, un rouge dirait « plus grand » sans dire que la page
      // a changé de plus grand peintre.
      expect(cellule.element.length, `${route} (${taille}) : élément élu`).toBeGreaterThan(4);
    }

    // Le vocabulaire des tailles est CLOS, et il est celui de la sonde : une
    // cellule rangée sous une taille que la sonde ne visite pas ne serait jamais
    // confrontée à la page — un plafond qui ne juge rien.
    for (const { route, taille } of CELLULES) {
      expect(TAILLES_APP, `${route} (${taille})`).toContain(taille);
    }
  });

  it('le plafond est DÉRIVÉ de la mesure par la règle de la table du CLS', () => {
    expect(MARGE).toBeGreaterThan(1);
    for (const { route, taille, cellule } of CELLULES) {
      const pire = pireDesRuns(cellule);
      // L'égalité avec la formule PARTAGÉE : c'est la vérification qui compte.
      expect(plafondAire(cellule), `${route} (${taille}) : dérivation`).toBe(plafondDe(pire, MARGE));
      // Un plafond SOUS la mesure déjà relevée aurait rougi au premier passage :
      // c'est le relevé qu'il faut relire, jamais le plafond qu'il faut élargir.
      expect(plafondAire(cellule), `${route} (${taille}) : plafond vs mesure`).toBeGreaterThan(pire);
      // Et le rapport reste celui de la marge publiée : ×10 serait un budget
      // décoratif, ×1,0 un rouge à chaque run (l'arrondi au centième voisin
      // explique le petit écart sous 1,25, jamais un facteur).
      const rapport = plafondAire(cellule) / pire;
      expect(rapport, `${route} (${taille}) : marge mesurée ${rapport.toFixed(3)}`).toBeGreaterThan(1.1);
      expect(rapport, `${route} (${taille}) : marge mesurée ${rapport.toFixed(3)}`).toBeLessThan(1.4);
    }
  });

  it('le PLANCHER est la contrepartie du plafond, et il ne peut pas être nul', () => {
    expect(PART_PLANCHER).toBeGreaterThan(0.1);
    expect(PART_PLANCHER).toBeLessThan(1);
    for (const { route, taille, cellule } of CELLULES) {
      const pire = pireDesRuns(cellule);
      expect(plancherAire(cellule), `${route} (${taille}) : plancher`).toBe(
        arrondiAire(pire * PART_PLANCHER)
      );
      expect(plancherAire(cellule), `${route} (${taille}) : plancher nul`).toBeGreaterThan(0);
      expect(plancherAire(cellule), `${route} (${taille}) : plancher vs mesure`).toBeLessThan(pire);
      // NOTE : ces trois relations sont INTERNES à la table. Elles tiennent quelle
      // que soit la page — voir l'en-tête, « CE QUE CE FICHIER NE PEUT PAS VOIR ».
      // L'arrondi des deux bornes vient de la même fonction : un plancher arrondi
      // autrement décrirait une autre mesure que le plafond de la même cellule.
      expect(plancherAire(cellule), `${route} (${taille}) : arrondi du plancher`).toBe(
        Math.round(plancherAire(cellule) / 100) * 100
      );
    }
  });

  it('la bande MORDE dans les trois sens, et refuse ce qu’un plafond seul accepterait', () => {
    // La cellule la plus grande : c'est là qu'une régression d'aire coûte le plus.
    const bande = bandeDaireApp('/jobs/:id', 'desktop');

    expect(verdictDaire(bande, bande.pire)).toBe('dans');
    // Les bornes sont INCLUSES : une aire exactement au plafond doit passer, sinon
    // la table refuserait sa propre mesure.
    expect(verdictDaire(bande, bande.plafond)).toBe('dans');
    expect(verdictDaire(bande, bande.plancher)).toBe('dans');
    expect(verdictDaire(bande, bande.plafond + 1)).toBe('au-dessus');
    expect(verdictDaire(bande, bande.plancher - 1)).toBe('sous');

    // Une régression d'ÉLÉMENT — une section entière qui se met à peindre au lieu
    // d'une ligne — est refusée : c'est la classe de défaut que le plafond existe
    // pour attraper, nommée dans l'en-tête de la table.
    expect(verdictDaire(bande, Math.round(bande.pire * 1.5))).toBe('au-dessus');

    // CONTREPARTIE ANTI-FAUX-VERT : la même page réduite à presque rien passe le
    // plafond. Sans le plancher, cette bande ne lirait donc rien du tout.
    expect(1).toBeLessThanOrEqual(bande.plafond);
    expect(verdictDaire(bande, 1)).toBe('sous');
  });

  it('REFUSE une cellule non mesurée, en nommant ce qu’il faut mesurer', () => {
    expect(() => bandeDaireApp('/produits', 'mobile')).toThrow(
      /aire LCP non mesurée pour « \/produits » \(mobile\)/
    );
    expect(() => bandeDaireApp('/produits', 'mobile')).toThrow(/LCP_APP_BUDGETS/);
    expect(() => bandeDaireApp('/dashboard', 'tablette')).toThrow(
      /aire LCP non mesurée pour « \/dashboard » \(tablette\)/
    );
    // Non-vacuité : les cellules réellement mesurées passent, elles.
    for (const { route, taille } of CELLULES) {
      expect(() => bandeDaireApp(route, taille), `${route} (${taille})`).not.toThrow();
    }
  });
});
