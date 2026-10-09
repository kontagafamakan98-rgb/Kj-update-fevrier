/**
 * LE CADRE DES PAGES D'APPLICATION — la déclaration est-elle TENUE ?
 *
 * ── Le défaut que ce fichier ferme ──────────────────────────────────────────
 * Les pages d'application écrivaient leur cadre à la main, et il avait divergé :
 * cinq largeurs, deux vocabulaires de gouttière, un pas de page parfois absent.
 * Une déclaration unique (`src/config/app-cadres.js`) rend la divergence
 * IMPOSSIBLE À ÉCRIRE — encore faut-il que les pages la lisent. Une page qui
 * repartirait sur un `<div className="max-w-6xl mx-auto px-4 py-8">` ne
 * rougirait nulle part ailleurs : elle afficherait simplement un autre pas que
 * ses voisines, en silence, ce qui est exactement l'état dont on sort.
 *
 * ── Deux formes, deux plans, comme les autres balayages du dépôt ───────────
 * (1) LE COMPORTEMENT DE LA DÉCLARATION — `cadreAppDe` rend le cadre d'une route
 *     et LÈVE sur une clé inconnue ; les cas synthétiques prouvent que la
 *     fonction sait mordre.
 * (2) LA FORME DU DÉPÔT — les fichiers que la déclaration NOMME (`emplacement`)
 *     lisent leur cadre au lieu de le recopier, et les squelettes de ces routes
 *     font de même (un squelette qui diverge de sa page de 8 à 32 px de pas est
 *     le CLS qu'il existe pour empêcher). Chaque refus a son cas synthétique.
 *
 * ── Les planchers ──────────────────────────────────────────────────────────
 * Le balayage refuse de juger s'il n'a presque rien lu : un dossier renommé, un
 * `emplacement` faux, et les deux règles passeraient sur du vide en annonçant un
 * vert. Les planchers sont posés SOUS les valeurs mesurées, jamais dessus.
 *
 * Ce fichier vit avec les autres gardes de `src/` et n'est PAS un script
 * d'audit : ces derniers vivent dans `scripts/` et sortent en 1 sur un écart.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CADRES_APP, cadreAppDe, HAUTEUR_PIED_HORS_ECRAN, REGLES_DE_SQUELETTE } from '../../config/app-cadres';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(ICI, '..', '..');
const lire = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** Le fichier qui porte les squelettes des routes d'application. */
const SQUELETTES = 'components/SkeletonLoader.js';

/**
 * LA FORME D'UN CADRE ÉCRIT À LA MAIN — une largeur maximale centrée, puis un pas
 * vertical FIXE (`py-8`) dans la même chaîne de classes.
 *
 * Le motif est volontairement étroit sur ces deux traits : un `max-w-*` seul est
 * légitime dans une page (une colonne de lecture au milieu d'une grille), et un
 * `py-*` seul l'est aussi (le rembourrage d'une carte). Ce qui est refusé est
 * leur RÉUNION, qui est la signature exacte du cadre de page recopié.
 */
const CADRE_A_LA_MAIN = /max-w-(?:3|4|5|6|7)xl mx-auto[^"'`{}]*\bpy-\d+/;

/** Les entrées de la déclaration, avec leur fichier consommateur. */
const entrees = Object.entries(CADRES_APP);

describe('la déclaration de cadre — comportement', () => {
  it('rend le cadre déclaré d’une route connue', () => {
    expect(cadreAppDe('/dashboard').frameClass).toContain('cadre-page');
    expect(cadreAppDe('/dashboard').titleClass).toContain('titre-page');
  });

  it('LÈVE sur une route inconnue, en nommant la clé et les clés connues', () => {
    expect(() => cadreAppDe('/tableau-de-bord')).toThrowError(
      /aucune déclaration de cadre pour « \/tableau-de-bord »/
    );
    // La liste des clés connues est dans le message : la correction est immédiate.
    expect(() => cadreAppDe('/tableau-de-bord')).toThrowError(/\/dashboard/);
  });

  it('mord sur une clé absente comme sur une clé vide (cas synthétique)', () => {
    // Le refus ne dépend pas de la valeur de la clé : `undefined` et `''` mènent
    // au même refus, donc une faute de frappe ne peut pas passer pour une route.
    expect(() => cadreAppDe(undefined)).toThrowError(/aucune déclaration/);
    expect(() => cadreAppDe('')).toThrowError(/aucune déclaration/);
  });

  it('DÉCLARE les six routes de l’application, et pas une de moins', () => {
    // Le compte est un PLANCHER (une route ajoutée est légitime et ne doit pas
    // rougir) doublé d'une liste NORMATIVE : ces six-là sont celles que la passe
    // d'unification a couvertes, et en retirer une sans raison serait une
    // régression silencieuse de périmètre.
    expect(entrees.length).toBeGreaterThanOrEqual(5);
    for (const attendu of ['/dashboard', '/profile', '/messages', '/create-job', '/jobs/:id']) {
      expect(Object.keys(CADRES_APP)).toContain(attendu);
    }
  });

  it('donne à chaque entrée un cadre, un titre et un EMPLACEMENT', () => {
    for (const [route, cadre] of entrees) {
      expect(cadre.frameClass, `${route} : frameClass manquant`).toMatch(/cadre-page/);
      expect(cadre.titleClass, `${route} : titleClass manquant`).toMatch(/titre-page/);
      expect(cadre.emplacement, `${route} : emplacement manquant`).toBeTruthy();
    }
  });

  it('porte la MÊME gouttière sur toutes les routes', () => {
    // C'est la divergence mesurée avant cette passe : deux pages ne s'écartaient
    // pas du bord de la même façon au-delà de 640 px.
    for (const [route, cadre] of entrees) {
      expect(cadre.frameClass, `${route} : gouttière non unifiée`).toContain(
        'px-4 sm:px-6 lg:px-8'
      );
    }
  });
});

describe('la forme du dépôt — les pages lisent, elles ne recopient pas', () => {
  it('CHAQUE emplacement existe et délègue à CadrePage avec SA clé', () => {
    // Le plancher : sans lui, un `emplacement` pointant vers un fichier renommé
    // ferait échouer la lecture sur une exception, donc rouge — mais un
    // emplacement VIDE ferait passer la boucle sans rien lire.
    expect(entrees.length).toBeGreaterThanOrEqual(5);
    for (const [route, cadre] of entrees) {
      const source = lire(cadre.emplacement);
      expect(source, `${cadre.emplacement} ne délègue pas à CadrePage`).toContain('<CadrePage');
      expect(
        source,
        `${cadre.emplacement} ne lit pas la clé « ${route} » de sa déclaration`
      ).toContain(`chemin="${route}"`);
    }
  });

  it('REFUSE un cadre de page écrit à la main dans un fichier déclaré', () => {
    for (const [route, cadre] of entrees) {
      const source = lire(cadre.emplacement);
      const trouve = source.match(CADRE_A_LA_MAIN);
      expect(
        trouve,
        `${cadre.emplacement} (route ${route}) ré-écrit son cadre à la main : ` +
          `« ${trouve ? trouve[0] : ''} » — le cadre a UN propriétaire ` +
          '(src/config/app-cadres.js), et une page qui le recopie divergera au premier correctif.'
      ).toBe(null);
    }
  });

  it('REFUSE un cadre écrit à la main dans les squelettes des mêmes routes', () => {
    // Un squelette réserve la géométrie que la page peindra : s'il garde l'ancien
    // pas, il diverge de la page qu'il protège — et c'est le CLS qu'il existe pour
    // empêcher. Les quatre routes à squelette dédié doivent lire la déclaration.
    const source = lire(SQUELETTES);
    for (const route of ['/dashboard', '/profile', '/messages', '/jobs/:id']) {
      expect(source, `${SQUELETTES} : aucun squelette ne lit le cadre de ${route}`).toContain(
        `chemin="${route}"`
      );
    }
    // Et les cadres à la main ont disparu de ce fichier pour ces routes. Les
    // squelettes des routes PUBLIQUES (/jobs) gardent le leur : leur cadre est
    // déclaré dans src/config/page-sections.js, hors du périmètre de ce fichier.
    const restants = source.match(/max-w-(?:4|6|7)xl mx-auto px-4 sm:px-6 lg:px-8 py-8/g) || [];
    expect(
      restants.length,
      `${SQUELETTES} : ${restants.length} cadre(s) à la main encore présents — ` +
        'les squelettes des routes déclarées doivent lire la déclaration.'
    ).toBeLessThanOrEqual(1);
  });

  it('le balayage SAIT MORDRE — cas synthétiques', () => {
    // Sans ces cas, une régression du motif (une classe ajoutée, une largeur de
    // plus) ferait passer le balayage sur du vide sans que rien ne rougisse.
    const cadreRecopie = 'const X = () => <div className="max-w-6xl mx-auto px-4 py-8" />;';
    expect(cadreRecopie.match(CADRE_A_LA_MAIN)).not.toBe(null);
    expect('const Y = () => <div className="max-w-4xl mx-auto" />;'.match(CADRE_A_LA_MAIN)).toBe(null);
    expect('const Z = () => <div className="py-8" />;'.match(CADRE_A_LA_MAIN)).toBe(null);
    // Et la forme que les pages ont adoptée N'EST PAS refusée.
    expect('const W = () => <CadrePage chemin="/messages" />;'.match(CADRE_A_LA_MAIN)).toBe(null);
  });

  it('compte ce qu’il a lu (refus de juger un balayage vide)', () => {
    let lus = 0;
    for (const [, cadre] of entrees) {
      lus += lire(cadre.emplacement).length;
    }
    expect(lus, 'balayage vide : les emplacements ne portent aucun texte').toBeGreaterThan(5000);
  });
});

describe('la règle du pied de page pendant le chargement', () => {
  /**
   * LES SQUELETTES QUI PORTENT LA RÈGLE, nommés un par un.
   *
   * Le critère est un FAIT, pas une humeur : la page grandit avec ses DONNÉES,
   * donc le squelette ne peut pas répliquer sa hauteur (`/dashboard` : 5 lignes
   * réelles contre 3 réservées ; `/profile` : 2 914,8 px de page pour 838,5 de
   * squelette en mobile ; `/jobs/:id` : une description sans longueur maximale).
   * `/messages`, lui, tient la règle INVERSE et c'est mesuré : sa hauteur ne
   * dépend pas des données (la carte des conversations fait `75vh`), donc il
   * réplique sa page à 13,8 px près — une réserve d’écran y ferait ENTRER le
   * pied de page au lieu de le laisser tranquille.
   */
  const ROUTES_A_PIED_HORS_ECRAN = ['/dashboard', '/profile', '/jobs/:id'];

  /**
   * Les manquements d’une déclaration de squelettes — PUR, pour que les cas
   * synthétiques puissent prouver que le contrôle SAIT mordre.
   *
   * @param {Record<string, {squelette?: object}>} cadres Les cadres à juger.
   * @returns {string[]} Un message par manquement, vide si la déclaration tient.
   */
  function manquementsDeLaRegle(cadres) {
    const manquements = [];
    for (const [route, cadre] of Object.entries(cadres)) {
      const squelette = cadre.squelette;
      if (!squelette) {
        manquements.push(`${route} : aucune règle déclarée pour son état de chargement`);
        continue;
      }
      if (!Object.values(REGLES_DE_SQUELETTE).includes(squelette.regle)) {
        manquements.push(`${route} : règle « ${squelette.regle} » inconnue`);
      }
      if (!String(squelette.pourquoi || '').trim()) {
        manquements.push(`${route} : aucune mesure écrite (pourquoi)`);
      }
      if (
        squelette.regle === REGLES_DE_SQUELETTE.PIED_HORS_ECRAN &&
        squelette.hauteurClass !== HAUTEUR_PIED_HORS_ECRAN
      ) {
        manquements.push(
          `${route} : règle pied-hors-ecran sans la réserve déclarée (hauteurClass « ` +
            `${squelette.hauteurClass} » au lieu de « ${HAUTEUR_PIED_HORS_ECRAN} »)`
        );
      }
      if (squelette.hauteurClass && squelette.regle !== REGLES_DE_SQUELETTE.PIED_HORS_ECRAN) {
        manquements.push(`${route} : une réserve déclarée pour la règle « ${squelette.regle} »`);
      }
    }
    return manquements;
  }

  it('CHAQUE squelette de route déclare sa règle ET la mesure qui l’a décidée', () => {
    // Le plancher : juger une déclaration vide annoncerait un vert sur rien.
    expect(entrees.length).toBeGreaterThanOrEqual(5);
    expect(manquementsDeLaRegle(CADRES_APP)).toEqual([]);
  });

  it('les routes dont la PAGE GRANDIT avec ses données portent la réserve d’écran', () => {
    for (const route of ROUTES_A_PIED_HORS_ECRAN) {
      const squelette = CADRES_APP[route]?.squelette;
      expect(squelette, `${route} : aucune règle de squelette déclarée`).toBeTruthy();
      expect(
        squelette.regle,
        `${route} : règle « ${squelette.regle} » — sa page est plus haute que lui, donc c’est ` +
          '« pied-hors-ecran » que sa déclaration doit dire.'
      ).toBe(REGLES_DE_SQUELETTE.PIED_HORS_ECRAN);
      expect(squelette.hauteurClass).toBe(HAUTEUR_PIED_HORS_ECRAN);
      // Et la raison est une MESURE, pas une intention : elle cite des pixels.
      expect(squelette.pourquoi, `${route} : la raison ne porte aucune mesure`).toMatch(/px/);
    }
  });

  it('les squelettes de ces routes DÉCLARENT qu’ils en sont un (sinon la réserve ne s’applique pas)', () => {
    // `CadrePage` n’applique la réserve qu’à un état de chargement QUI SE DÉCLARE
    // (`squelette`) : la classe peut être parfaitement déclarée et n’avoir aucun
    // effet si la prop manque. C’est le seul maillon que la déclaration ne peut
    // pas tenir toute seule, donc il est vérifié ici, sur le fichier.
    const source = lire(SQUELETTES);
    for (const route of ROUTES_A_PIED_HORS_ECRAN) {
      const ouverture = source.match(new RegExp(`<CadrePage chemin="${route}"[^>]*>`));
      expect(ouverture, `${SQUELETTES} : aucun \u00ab <CadrePage chemin="${route}"> \u00bb`).not.toBe(null);
      expect(
        ouverture[0],
        `${SQUELETTES} : le squelette de ${route} n’est pas déclaré \u00ab squelette \u00bb — la réserve de sa ` +
          'route ne lui sera donc pas appliquée.'
      ).toContain('squelette');
    }
  });

  it('le contrôle SAIT MORDRE — cas synthétiques', () => {
    const PIED = REGLES_DE_SQUELETTE.PIED_HORS_ECRAN;
    const raison = 'mesuré : page de 1 200 px contre un squelette de 500 px';
    // Une règle juste mais SANS réserve : c’est le défaut d’origine, refusé.
    expect(
      manquementsDeLaRegle({ '/x': { squelette: { regle: PIED, pourquoi: raison } } })[0]
    ).toMatch(/sans la réserve déclarée/);
    // Une réserve recopiée au lieu d’être lue du propriétaire. La valeur
    // étrangère est une classe RÉELLE (`min-h-screen`, portée par PageSkeleton) :
    // une valeur arbitraire écrite ici serait un jeton de plus pour Tailwind, qui
    // génère un utilitaire que personne ne porte.
    expect(
      manquementsDeLaRegle({
        '/x': { squelette: { regle: PIED, hauteurClass: 'min-h-screen', pourquoi: raison } },
      })[0]
    ).toMatch(/au lieu de/);
    // Une règle sans raison écrite, et une règle inconnue.
    expect(
      manquementsDeLaRegle({ '/x': { squelette: { regle: PIED, hauteurClass: HAUTEUR_PIED_HORS_ECRAN } } })[0]
    ).toMatch(/aucune mesure écrite/);
    expect(
      manquementsDeLaRegle({ '/x': { squelette: { regle: 'on-verra-bien', pourquoi: raison } } })[0]
    ).toMatch(/inconnue/);
    // Une réserve posée sous la règle inverse (elle ferait entrer le pied de page).
    expect(
      manquementsDeLaRegle({
        '/x': {
          squelette: { regle: REGLES_DE_SQUELETTE.REPLIQUE, hauteurClass: HAUTEUR_PIED_HORS_ECRAN, pourquoi: raison },
        },
      })[0]
    ).toMatch(/une réserve déclarée pour la règle/);
    // Et la déclaration RÉELLE ne rougit sur aucun de ces motifs.
    expect(manquementsDeLaRegle(CADRES_APP)).toEqual([]);
  });
});

describe('/payment — le cadre à DEUX canaux reste chez son propriétaire', () => {
  it('est déclaré dans page-sections.js, pas dans app-cadres.js', () => {
    // /payment a une COQUILLE : ses deux peintures doivent lire la même chaîne,
    // donc son propriétaire est le fichier que les deux canaux lisent déjà.
    const plan = lire('config/page-sections.js');
    expect(plan).toContain("frameClass: 'min-h-full bg-gray-50 py-8'");
    expect(plan).toContain("corpsClass: 'max-w-6xl mx-auto px-4 space-y-6'");
    expect(Object.keys(CADRES_APP)).not.toContain('/payment');
  });

  it('est lu par la PAGE et par la COQUILLE — aucune des deux ne recopie', () => {
    const page = lire('pages/Payment.js');
    expect(page).toContain('pagePlan.frameClass');
    expect(page).toContain('pagePlan.corpsClass');
    expect(page, 'Payment.js ré-écrit sa largeur à la main').not.toContain(
      'max-w-6xl mx-auto px-4 space-y-6'
    );
    const coquille = fs.readFileSync(
      path.resolve(SRC, '..', 'vite-plugins', 'prerender', 'shells-routes.js'),
      'utf8'
    );
    expect(coquille).toContain('${paymentPlan.frameClass}');
    expect(coquille).toContain('${paymentPlan.corpsClass}');
    expect(coquille, 'la coquille ré-écrit la largeur de /payment à la main').not.toContain(
      'max-w-6xl mx-auto px-4 space-y-6'
    );
  });
});
