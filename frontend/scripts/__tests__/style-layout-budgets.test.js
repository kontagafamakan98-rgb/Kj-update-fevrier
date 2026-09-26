/**
 * La TABLE de la STRUCTURE du document pré-rendu, et le COÛT qu'elle publie —
 * éprouvés sur leur FORME et sur ce qui les rend VRAIS.
 *
 * ── Ce que ce fichier tient, et ce qu'il ne tient pas ───────────────────────
 * Le verdict est prononcé par la sonde `e2e/style-layout-document.spec.js` (le
 * document pré-rendu, route par route, lu au CDP) ; ce fichier-ci tient la TABLE
 * que la sonde lit (`scripts/style-layout-budgets.cjs`), parce que quatre façons
 * de se tromper y sont silencieuses en navigateur :
 *   1. une borne recopiée au lieu d'être DÉRIVÉE de la mesure — la même valeur
 *      des deux côtés ferait passer n'importe quoi ;
 *   2. une borne au-dessus de la structure de référence : la sonde refuserait
 *      alors tout document, y compris le bon, et le premier réflexe serait
 *      d'élargir la borne plutôt que de lire la table ;
 *   3. une condition oubliée (une case sans `desktop`) : la route ne serait
 *      mesurée que dans une condition, et la moitié du verdict n'existerait pas ;
 *   4. un axe de verdict NON PORTABLE — c'est l'erreur que ce fichier a
 *      réellement commise, et c'est pourquoi elle a son cas : le premier verdict
 *      portait sur le TEMPS, et le runner de la CI a rendu 18 cases rouges sur le
 *      même artefact, de 1,85 à 8,2 fois moins cher selon la machine. Le cas « le temps
 *      n'est pas portable » verrouille cette leçon sur les deux relevés.
 *
 * ── Les valeurs, elles, ne sont PAS re-dérivées ici ─────────────────────────
 * Les nombres sont des MINIMA MESURÉS (5 runs sur le poste partagé, 3 runs sur le
 * runner de la CI, le 25/09/2026 ; table et récit dans
 * `scripts/style-layout-budgets.cjs`) : un test qui les recalculerait prouverait
 * qu'il sait refaire une mesure qu'il n'a pas faite. Ce qui est vérifié, c'est
 * que le plancher est bien DÉRIVÉ de la structure, qu'il est ordonné sous elle,
 * que la mutation le franchit vraiment, et que la table reste complète.
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
const {
  CONDITIONS,
  MESURE,
  MESURE_CI,
  NOEUDS,
  HAUTEUR,
  BORNE_STRUCTURE,
  plancherNoeudsDe,
  plancherHauteurDe,
} = require('../style-layout-budgets.cjs');

/** Les routes pré-rendues, dérivées de la table unique (jamais recopiées). */
const ROUTES = Object.keys(PAGE_META).sort();
const CONDITIONS_NOMS = CONDITIONS.map((c) => c.nom);

/** Le plancher sous lequel un relevé de temps n'est plus une mesure (ms). */
const PLANCHER_MESURE = 20;
/** Le plus petit document de la table (ne doit pas devenir un cas dégénéré). */
const PLANCHER_NOEUDS = 20;
const PLANCHER_HAUTEUR = 200;

/**
 * La mutation qui doit franchir la borne, MESURÉE le 25/09/2026 : l'accueil
 * amputé de ses neuf dernières sections (shell bâti 94 329 o → 75 601 o,
 * SHA-1 997b3d3c… → dbb86205…, restauré à l'identique).
 */
const MUTATION_ACCUEIL_AMPUTE = { noeuds: 105, hauteur: { mobile: 1125, desktop: 1086 } };

describe('la table de structure du document pré-rendu, et le coût qu’elle publie', () => {
  it('couvre EXACTEMENT les routes pré-rendues, avec les deux conditions par case', () => {
    expect(Object.keys(NOEUDS).sort()).toEqual(ROUTES);
    expect(Object.keys(HAUTEUR).sort()).toEqual(ROUTES);
    expect(Object.keys(MESURE).sort()).toEqual(ROUTES);
    expect(Object.keys(MESURE_CI).sort()).toEqual(ROUTES);
    for (const route of ROUTES) {
      expect(Object.keys(HAUTEUR[route]).sort(), route).toEqual([...CONDITIONS_NOMS].sort());
      expect(Object.keys(MESURE[route]).sort(), route).toEqual([...CONDITIONS_NOMS].sort());
      expect(Object.keys(MESURE_CI[route]).sort(), route).toEqual([...CONDITIONS_NOMS].sort());
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

  it('chaque référence est un relevé positif, jamais un zéro de repli', () => {
    for (const route of ROUTES) {
      expect(Number.isInteger(NOEUDS[route]), `${route} : nœuds`).toBe(true);
      expect(NOEUDS[route], `${route} : nœuds`).toBeGreaterThan(PLANCHER_NOEUDS);
      for (const condition of CONDITIONS_NOMS) {
        expect(Number.isInteger(HAUTEUR[route][condition]), `${route}/${condition} : hauteur`).toBe(true);
        expect(HAUTEUR[route][condition], `${route}/${condition} : hauteur`).toBeGreaterThan(PLANCHER_HAUTEUR);
        expect(MESURE[route][condition], `${route}/${condition} : coût`).toBeGreaterThan(PLANCHER_MESURE);
        // Le coût du second hôte : mesuré partout, sauf les 4 cases restées
        // au-dessus de l'ancienne borne basse, que la sonde n'imprime pas.
        const coutCI = MESURE_CI[route][condition];
        expect(coutCI === null || coutCI > 0, `${route}/${condition} : coût CI`).toBe(true);
      }
    }
  });

  it('le plancher est DÉRIVÉ de la structure — jamais la structure elle-même', () => {
    // C'est LA propriété qui fait qu'un plancher n'est pas un chiffre choisi : il
    // se recalcule, y compris pour une valeur qui n'est pas dans la table.
    expect(BORNE_STRUCTURE).toBeGreaterThan(0);
    expect(BORNE_STRUCTURE).toBeLessThan(1);
    for (const noeuds of [20, 98, 279, 1000]) {
      expect(plancherNoeudsDe(noeuds), `${noeuds} nœuds`).toBe(Math.floor(noeuds * BORNE_STRUCTURE));
    }
    for (const hauteur of [200, 823, 7075, 13848]) {
      expect(plancherHauteurDe(hauteur), `${hauteur} px`).toBe(Math.floor(hauteur * BORNE_STRUCTURE));
    }
    // Deux ancres absolues, pour qu'un changement de marge se voie ici : les
    // valeurs de l'accueil, mobile et desktop.
    expect(plancherNoeudsDe(279)).toBe(223);
    expect(plancherHauteurDe(7075)).toBe(5660);
    expect(plancherHauteurDe(4782)).toBe(3825);
  });

  it('la borne est STRICTEMENT sous la structure de référence, route par route', () => {
    // Au-dessus du relevé, elle condamnerait le document mesuré lui-même : le
    // premier réflexe serait d'élargir la marge, pas de lire la table.
    for (const route of ROUTES) {
      expect(plancherNoeudsDe(NOEUDS[route]), route).toBeLessThan(NOEUDS[route]);
      for (const condition of CONDITIONS_NOMS) {
        expect(plancherHauteurDe(HAUTEUR[route][condition]), `${route}/${condition}`).toBeLessThan(
          HAUTEUR[route][condition]
        );
      }
    }
  });

  it('la mutation qui doit franchir la borne la franchit VRAIMENT (mesurée)', () => {
    // Un plancher que rien ne peut franchir ne prouve rien : la seule direction
    // que les mutations savent faire rougir est la perte de matière, et elle est
    // mesurée — accueil amputé de ses neuf dernières sections (105 nœuds,
    // 1 125 px mobile, 1 086 px desktop), deux fois et demie sous la borne.
    expect(MUTATION_ACCUEIL_AMPUTE.noeuds).toBeLessThan(plancherNoeudsDe(NOEUDS['/']));
    for (const condition of CONDITIONS_NOMS) {
      expect(MUTATION_ACCUEIL_AMPUTE.hauteur[condition], condition).toBeLessThan(
        plancherHauteurDe(HAUTEUR['/'][condition])
      );
    }
    // Et la structure MESURÉE passe : le plancher attrape la perte de matière,
    // pas le document intact.
    expect(NOEUDS['/']).toBeGreaterThanOrEqual(plancherNoeudsDe(NOEUDS['/']));
    expect(HAUTEUR['/'].mobile).toBeGreaterThanOrEqual(plancherHauteurDe(HAUTEUR['/'].mobile));
  });

  it('le temps n’est pas portable — les deux hôtes mesurés le prouvent, donc il ne juge plus rien', () => {
    // C'est la leçon qui a refondé ce garde : le premier verdict portait sur le
    // temps (0,6 × à 1,5 × le relevé du poste) et le runner de la CI a rendu
    // 18 des 22 cases rouges sur le même artefact — / mobile 662 ms ici contre
    // 80,4 ms là-bas, soit ×8,2. Aucune marge ne couvre les deux hôtes.
    // Certaines routes ont CHANGÉ d'artefact depuis la mesure de la CI : leur
    // rapport poste/CI compare alors les temps de DEUX documents différents et ne
    // dit plus rien de la portabilité. Sont exclues les routes dont le document a
    // été re-mesuré après le remplacement emoji→SVG — l'accueil, puis /about,
    // /contact, /how-it-works et /support (26/09/2026), puis les quatre écrans de
    // compte /login, /register, /forgot-password et /payment (dernière vague,
    // même jour) : leur relevé CI porte sur l'artefact d'AVANT.
    const ARTEFACT_CHANGE = new Set([
      '/',
      '/about',
      '/contact',
      '/how-it-works',
      '/support',
      '/login',
      '/register',
      '/forgot-password',
      '/payment',
    ]);
    const routesComparables = ROUTES.filter((route) => !ARTEFACT_CHANGE.has(route));
    const ecarts = [];
    for (const route of routesComparables) {
      for (const condition of CONDITIONS_NOMS) {
        const coutCI = MESURE_CI[route][condition];
        if (coutCI === null) continue;
        expect(coutCI, `${route}/${condition} : le second hôte devrait être moins cher`).toBeLessThan(
          MESURE[route][condition]
        );
        ecarts.push(MESURE[route][condition] / coutCI);
      }
    }
    // Le fait mesuré, nommé une fois : sur ces routes à artefact inchangé, le
    // runner de la CI est TOUJOURS moins cher, de 3,4 × (/jobs mobile : 155 →
    // 45,9 ms) à 4,1 × (/privacy mobile : 169 → 41,2 ms). Le rapport le plus
    // spectaculaire des premiers relevés venait de /register (452 → 74,6 ms,
    // 6,1 ×), dont le document a changé depuis — il est donc exclu comme les
    // autres routes re-mesurées, et l'ancrage haut de la non-portabilité suit les
    // routes restantes.
    expect(Math.min(...ecarts)).toBeGreaterThan(1.8);
    expect(Math.max(...ecarts)).toBeGreaterThan(4);
    // Et l'ancrage du verdict — la structure — n'a, lui, rien de commun avec la
    // machine : les nœuds sont identiques sur les deux hôtes, mesuré sur les 11
    // routes, et c'est ce que la sonde compare.
    for (const route of ROUTES) {
      expect(Number.isInteger(NOEUDS[route]), route).toBe(true);
    }
  });

  it('une case qui manque est nommée, jamais silencieuse', () => {
    // La sonde lit `NOEUDS[route]` et `HAUTEUR[route]?.[condition]` : une case
    // absente doit produire une référence LISIBLE comme absente (undefined), et
    // non un repli qui ferait mesurer la route contre une structure inventée.
    expect(NOEUDS['/route-qui-n-existe-pas']).toBeUndefined();
    expect(HAUTEUR['/route-qui-n-existe-pas']).toBeUndefined();
    for (const route of ROUTES) {
      expect(HAUTEUR[route].tablette, route).toBeUndefined();
      expect(MESURE[route].tablette, route).toBeUndefined();
    }
  });
});
