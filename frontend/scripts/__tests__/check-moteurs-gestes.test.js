import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MIN_SPECS,
  PARCOURS_DE_GESTE,
  projetMoteur,
  parcoursDetectes,
  refusDuPerimetreMoteurs,
} from '../moteurs-gestes.js';
import {
  calculerEcarts,
  enregistrer,
  viderLesReleves,
  releves,
  lireLesReleves,
  publierLesEcarts,
  ligneDEcart,
} from '../../e2e/helpers/moteurs.js';
import { placerLeResume } from '../../e2e/reporters/ecarts-moteurs.js';

/**
 * LES PREUVES DU GARDE DU PÉRIMÈTRE MULTI-MOTEURS.
 *
 * Trois niveaux, comme les autres gardes du dépôt :
 *   1. la RÈGLE, éprouvée sur des sources fabriquées — chaque refus a son cas, et
 *      deux cas de TOLÉRANCE vérifient que la règle ne refuse pas ce qu'elle doit
 *      laisser passer (un parcours déclaré au registre qui n'utilise aucune API
 *      rare n'est pas une dette : c'est le cas d'`appuis-exterieurs`) ;
 *   2. le GARDE en sous-processus sur des ARBRES FIXTURES : sortie 0 quand le
 *      contrat est tenu, sortie 1 en NOMMANT le parcours fautif, et refus quand
 *      l'arbre est trop petit pour que le garde ait lu son sujet ;
 *   3. le TABLEAU DES ÉCARTS (`e2e/helpers/moteurs.js`), éprouvé sans navigateur
 *      puisque les relevés traversent un FICHIER — les trois projets Playwright
 *      ne partagent pas la mémoire, et un harnais dont la comparaison ne survit
 *      pas au changement de processus publierait « aucune mesure » en silence.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(ICI, '..', '..');
const RACINE = path.resolve(FRONTEND, '..');
const GARDE = path.join(FRONTEND, 'scripts', 'check-moteurs-gestes.js');

/**
 * Un fichier de relevés JETABLE : ces preuves appellent `enregistrer`, qui ÉCRIT
 * (c'est le geste même qu'on éprouve), et elles ne doivent pas laisser de lignes
 * dans `test-results/` — un relevé oublié là fausserait le tableau des écarts de
 * la prochaine exécution Playwright.
 */
const FICHIER_JETABLE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'moteurs-jetable-')), 'mesures.jsonl');
afterAll(() => fs.rmSync(path.dirname(FICHIER_JETABLE), { recursive: true, force: true }));

/** L'arbre réel, lu une fois : c'est lui que la règle juge en vrai. */
function lireLArbreReel() {
  const dossierSpecs = path.join(FRONTEND, 'e2e');
  const fichiers = fs
    .readdirSync(dossierSpecs)
    .filter((nom) => nom.endsWith('.spec.js'))
    .sort();
  return {
    config: fs.readFileSync(path.join(FRONTEND, 'playwright.config.js'), 'utf8'),
    ci: fs.readFileSync(path.join(RACINE, '.github', 'workflows', 'ci.yml'), 'utf8'),
    specs: fichiers.map((fichier) => ({
      fichier,
      source: fs.readFileSync(path.join(dossierSpecs, fichier), 'utf8'),
    })),
  };
}

const ARBRE = lireLArbreReel();

describe('la règle du périmètre, sur l’arbre réel', () => {
  it('tout est tenu : trois moteurs, un seul périmètre, des gestes couverts et publiés', () => {
    expect(ARBRE.specs.length).toBeGreaterThanOrEqual(MIN_SPECS);
    expect(refusDuPerimetreMoteurs(ARBRE)).toEqual([]);
  });

  it('les gestes DÉTECTÉS sont nommés, geste par geste — un vert sans sujet n’est pas un vert', () => {
    expect(parcoursDetectes(ARBRE.specs).map(({ fichier, gestes }) => `${fichier} : ${gestes.join(' + ')}`).sort()).toEqual([
      'barres-rupture.spec.js : molette + bascule de taille',
      'carte-facade.spec.js : appui au doigt',
      'notifications.spec.js : appui au doigt + bascule de taille',
      'tiers-apres-interaction.spec.js : appui au doigt',
    ]);
  });

  it('le registre porte les REJOUÉS et les EXCLUS, chacun avec sa raison vérifiable', () => {
    expect(PARCOURS_DE_GESTE.filter(({ horsPerimetre }) => !horsPerimetre).map(({ fichier }) => fichier)).toEqual([
      'appuis-exterieurs.spec.js',
      'notifications.spec.js',
      'barres-rupture.spec.js',
    ]);
    const exclus = PARCOURS_DE_GESTE.filter(({ horsPerimetre }) => horsPerimetre);
    expect(exclus.map(({ fichier }) => fichier).sort()).toEqual([
      'carte-facade.spec.js',
      'tiers-apres-interaction.spec.js',
    ]);
    // Une exclusion sans RAISON, ou sans PREUVE, serait un silence : les deux sont
    // écrites ici pour être lues, pas pour être crues.
    for (const { horsPerimetre, preuve } of exclus) {
      expect(horsPerimetre.length).toBeGreaterThan(60);
      expect(preuve).toBeInstanceOf(RegExp);
    }
  });

  it('refuse une exclusion SANS raison vérifiable (hors périmètre, sans preuve)', () => {
    const registre = PARCOURS_DE_GESTE.map((entree) =>
      entree.fichier === 'carte-facade.spec.js' ? { ...entree, preuve: undefined } : entree
    );
    expect(refusDuPerimetreMoteurs({ ...ARBRE, registre }).join('\n')).toContain('est exclu du périmètre');
  });

  it('refuse une exclusion dont la PREUVE a disparu de la source (raison périmée)', () => {
    const registre = PARCOURS_DE_GESTE.map((entree) =>
      entree.fichier === 'carte-facade.spec.js'
        ? { ...entree, preuve: /geste-qui-n-existe-plus-\d+/ }
        : entree
    );
    expect(refusDuPerimetreMoteurs({ ...ARBRE, registre }).join('\n')).toContain('la raison est périmée');
  });

  it('refuse un parcours EXCLU que le testMatch rejoue quand même (exclusion contredite)', () => {
    const config = ARBRE.config.replace('|barres-rupture', '|barres-rupture|carte-facade');
    expect(refusDuPerimetreMoteurs({ ...ARBRE, config }).join('\n')).toContain(
      "l'exclusion et le périmètre se contredisent"
    );
  });

  it('les deux projets moteurs portent le même périmètre et le bon appareil', () => {
    const firefox = projetMoteur(ARBRE.config, 'firefox');
    const webkit = projetMoteur(ARBRE.config, 'webkit');
    expect(firefox.motif).toBe(webkit.motif);
    expect(firefox.appareil).toBe('Desktop Firefox');
    expect(webkit.appareil).toBe('Desktop Safari');
  });

  it('la ligne de CI qui installe les BINAIRES nomme les trois moteurs', () => {
    for (const moteur of ['chromium', 'firefox', 'webkit']) {
      expect(ARBRE.ci).toMatch(new RegExp(`playwright install --with-deps[^\\n]*\\b${moteur}\\b`));
    }
  });
});

describe('la règle du périmètre, refus par refus', () => {
  it('refuse un geste de bas niveau absent du registre (l’ajout oublié)', () => {
    const refus = refusDuPerimetreMoteurs({
      ...ARBRE,
      specs: [...ARBRE.specs, { fichier: 'nouveau-geste.spec.js', source: 'await page.mouse.wheel(0, 400);' }],
    });
    expect(refus.join('\n')).toContain('`nouveau-geste.spec.js` porte un geste de bas niveau (molette)');
  });

  it('refuse un parcours du périmètre qui ne publie rien', () => {
    const specs = ARBRE.specs.map((s) =>
      s.fichier === 'barres-rupture.spec.js' ? { ...s, source: s.source.replace(/publier\(/g, 'mesurer(') } : s
    );
    expect(refusDuPerimetreMoteurs({ ...ARBRE, specs }).join('\n')).toContain(
      'barres-rupture.spec.js` est rejoué sur trois moteurs sans PUBLIER'
    );
  });

  it('refuse une déclaration que la source démentit (geste annoncé, absent du fichier)', () => {
    const specs = ARBRE.specs.map((s) =>
      s.fichier === 'barres-rupture.spec.js' ? { ...s, source: 'const x = 1;\npublier(test, "a", 1);\n' } : s
    );
    expect(refusDuPerimetreMoteurs({ ...ARBRE, specs }).join('\n')).toContain('la source ne porte AUCUN geste de ce genre');
  });

  it('refuse un fichier du registre qui n’existe pas', () => {
    const registre = [...PARCOURS_DE_GESTE, { fichier: 'fantome.spec.js', geste: 'rien', motif: /./ }];
    expect(refusDuPerimetreMoteurs({ ...ARBRE, registre }).join('\n')).toContain(
      "le registre déclare `fantome.spec.js`, mais ce fichier n'existe pas"
    );
  });

  it("refuse un fichier REJOUÉ du registre que le testMatch a lâché", () => {
    const config = ARBRE.config.replace(/\|barres-rupture/g, '');
    expect(refusDuPerimetreMoteurs({ ...ARBRE, config }).join('\n')).toContain(
      '`barres-rupture.spec.js` est au registre des gestes sans être rejoué par les projets moteurs'
    );
  });

  it("refuse un fichier rejoué par les moteurs mais absent du registre", () => {
    // On ajoute au `testMatch` LUI-MÊME (le commentaire du périmètre nomme aussi
    // `notifications`, et un `replace` de chaîne l'aurait attrapé lui).
    const config = ARBRE.config.replace(/testMatch: \/([^/]*)\//g, 'testMatch: /($1|sinueux)/');
    const specs = [...ARBRE.specs, { fichier: 'sinueux.spec.js', source: 'publier(test, "x", 1);' }];
    expect(refusDuPerimetreMoteurs({ ...ARBRE, config, specs }).join('\n')).toContain(
      '`sinueux.spec.js` est rejoué par les projets moteurs sans figurer au registre des gestes'
    );
  });

  it('refuse deux périmètres différents entre moteurs', () => {
    const config = ARBRE.config.replace(
      /testMatch: \/\(appuis-exterieurs[^\n]*\n(\s*)use: \{ \.\.\.devices\['Desktop Safari'\] \}/,
      "testMatch: /appuis-exterieurs\\.spec\\.js/,\n$1use: { ...devices['Desktop Safari'] }"
    );
    expect(refusDuPerimetreMoteurs({ ...ARBRE, config }).join('\n')).toContain('ne couvrent pas le MÊME périmètre');
  });

  it('refuse un projet moteur qui perd son appareil', () => {
    const config = ARBRE.config.replace("devices['Desktop Firefox']", "devices['Desktop Chrome']");
    expect(refusDuPerimetreMoteurs({ ...ARBRE, config }).join('\n')).toContain(
      "n'utilise plus l'appareil `Desktop Firefox`"
    );
  });

  it('refuse une CI qui n’installe plus les trois moteurs', () => {
    const ci = ARBRE.ci.replace(
      'npx playwright install --with-deps chromium firefox webkit',
      'npx playwright install --with-deps chromium'
    );
    expect(refusDuPerimetreMoteurs({ ...ARBRE, ci }).join('\n')).toContain("n'installe plus le moteur `firefox`");
  });

  it('refuse un périmètre vide (un vert sans sujet)', () => {
    expect(refusDuPerimetreMoteurs({ ...ARBRE, specs: [] }).join('\n')).toContain(
      'aucun parcours `.spec.js` lu dans frontend/e2e/'
    );
  });

  it('TOLÉRANCE : un parcours déclaré qui n’utilise aucune API rare n’est pas une dette', () => {
    // `appuis-exterieurs` appuie avec le clic Playwright : le geste est réel, mais
    // `.click()` est partout dans la suite — c'est bien pour ça qu'il est DÉCLARÉ
    // plutôt que détecté, et la règle ne doit pas le refuser pour autant.
    const appuis = ARBRE.specs.find(({ fichier }) => fichier === 'appuis-exterieurs.spec.js');
    expect(parcoursDetectes([appuis])).toEqual([]);
    expect(refusDuPerimetreMoteurs(ARBRE)).toEqual([]);
  });

  it('TOLÉRANCE : un parcours sans geste, hors périmètre, n’est pas refusé', () => {
    const geoms = ARBRE.specs.filter(({ fichier }) => /geometrie|lcp/.test(fichier));
    expect(geoms.length).toBeGreaterThan(0);
    expect(refusDuPerimetreMoteurs(ARBRE).join('\n')).not.toContain('geometrie');
  });
});

describe('le garde, en sous-processus, sur les arbres fixtures', () => {
  const dossierFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'perimetre-moteurs-'));
  afterAll(() => fs.rmSync(dossierFixture, { recursive: true, force: true }));

  /** Écrit un arbre minimal : `playwright.config.js`, `e2e/*.spec.js`, un fichier de CI. */
  function ecrireArbre({ nom, config, specs, ci }) {
    const frontend = path.join(dossierFixture, nom);
    fs.mkdirSync(path.join(frontend, 'e2e'), { recursive: true });
    fs.writeFileSync(path.join(frontend, 'playwright.config.js'), config);
    for (const [fichier, source] of Object.entries(specs)) fs.writeFileSync(path.join(frontend, 'e2e', fichier), source);
    const fichierCi = path.join(dossierFixture, `${nom}-ci.yml`);
    fs.writeFileSync(fichierCi, ci);
    return { frontend, fichierCi };
  }

  /** La config de référence : celle du dépôt, réduite à son `projects`. */
  const CONFIG = [
    'export default {',
    '  projects: [',
    "    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },",
    '    {',
    "      name: 'firefox',",
    '      testMatch: /(appuis-exterieurs|notifications|barres-rupture)\\.spec\\.js/,',
    "      use: { ...devices['Desktop Firefox'] },",
    '    },',
    '    {',
    "      name: 'webkit',",
    '      testMatch: /(appuis-exterieurs|notifications|barres-rupture)\\.spec\\.js/,',
    "      use: { ...devices['Desktop Safari'] },",
    '    },',
    '  ],',
    '};',
    '',
  ].join('\n');

  const CI = 'run: npx playwright install --with-deps chromium firefox webkit\n';

  /**
   * Les CINQ parcours du registre (trois rejoués, deux exclus), plus des parcours
   * sans geste. Les exclus existent ici SANS être dans le `testMatch` : c'est
   * exactement la forme que le garde doit accepter, et les refus neufs (exclusion
   * sans raison, preuve périmée) mordent dedans.
   */
  const SPECS_PROPRES = {
    'appuis-exterieurs.spec.js': "await page.locator('a').click();\npublier(test, 'appuis nécessaires', 1);\n",
    'notifications.spec.js': 'await page.setViewportSize({ width: 500, height: 900 });\npublier(test, "n", 1);\n',
    'barres-rupture.spec.js': 'await page.mouse.wheel(0, 900);\npublier(test, "w", 1);\n',
    // Les deux parcours EXCLUS : ils portent un geste ET ce que leur `preuve`
    // exige — c'est elle qui rend leur exclusion vérifiable.
    'carte-facade.spec.js':
      'await bouton.tap();\n// harnais : e2e/helpers/parcours-carte.js\npublier(test, "c", 1);\n',
    'tiers-apres-interaction.spec.js':
      'await bouton.tap();\nimport { ecouterLesRequetes } from "./helpers/requetes.js";\npublier(test, "t", 1);\n',
    ...Object.fromEntries(
      Array.from({ length: MIN_SPECS - 5 }, (_, i) => [`hors-perimetre-${i}.spec.js`, 'const x = 1;\n'])
    ),
  };

  function lancerGarde({ frontend, fichierCi }) {
    try {
      const sortie = execFileSync('node', [GARDE, '--frontend', frontend, '--ci', fichierCi], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, sortie };
    } catch (erreur) {
      return { code: erreur.status ?? 1, sortie: `${erreur.stdout ?? ''}${erreur.stderr ?? ''}` };
    }
  }

  it('sort 0 sur un arbre propre, et PUBLIE ce qu’il a lu', () => {
    const { frontend, fichierCi } = ecrireArbre({ nom: 'propre', config: CONFIG, specs: SPECS_PROPRES, ci: CI });
    const { code, sortie } = lancerGarde({ frontend, fichierCi });
    expect(sortie).toContain('✅ Les trois moteurs couvrent le même périmètre (3 parcours)');
    expect(code).toBe(0);
    // Le sujet est chiffré : sans ces comptes, un vert ne dirait pas ce qu'il a lu.
    expect(sortie).toContain('3 parcours rejoués sur chromium, firefox et webkit');
    // Ce qui n'est PAS mesuré est publié aussi : un silence sur un parcours écarté
    // serait la dette que ce garde refuse.
    expect(sortie).toContain('Hors périmètre, avec leur raison (2)');
    expect(sortie).toContain('barres-rupture.spec.js (molette)');
  });

  it('sort 1 en NOMMANT le parcours de geste resté hors du testMatch', () => {
    const specs = {
      ...SPECS_PROPRES,
      'barres-rupture.spec.js': 'const x = 1;\n',
      'molette-oubliee.spec.js': 'await page.mouse.wheel(0, 400);\npublier(test, "w", 1);\n',
    };
    const { frontend, fichierCi } = ecrireArbre({ nom: 'oublie', config: CONFIG, specs, ci: CI });
    const { code, sortie } = lancerGarde({ frontend, fichierCi });
    expect(code).toBe(1);
    expect(sortie).toContain('❌ Le périmètre multi-moteurs est rompu');
    expect(sortie).toContain('`molette-oubliee.spec.js` porte un geste de bas niveau (molette)');
  });

  it('sort 1 quand un parcours rejoué ne publie plus rien', () => {
    const specs = { ...SPECS_PROPRES, 'barres-rupture.spec.js': 'await page.mouse.wheel(0, 900);\n' };
    const { frontend, fichierCi } = ecrireArbre({ nom: 'muet', config: CONFIG, specs, ci: CI });
    const { code, sortie } = lancerGarde({ frontend, fichierCi });
    expect(code).toBe(1);
    expect(sortie).toContain('sans PUBLIER ses mesures');
  });

  it('REFUSE de se taire quand l’arbre est trop petit pour qu’il ait lu son sujet', () => {
    const { frontend, fichierCi } = ecrireArbre({
      nom: 'vide',
      config: CONFIG,
      specs: { 'un-seul.spec.js': 'const x = 1;\n' },
      ci: CI,
    });
    const { code, sortie } = lancerGarde({ frontend, fichierCi });
    expect(code).toBe(1);
    expect(sortie).toContain('Nombre de parcours lus insuffisant');
  });
});

describe('le tableau des écarts entre moteurs', () => {
  it('compare chaque mesure sur les moteurs qui l’ont relevée', () => {
    const ecarts = calculerEcarts([
      { mesure: 'appui → carte montée', moteur: 'chromium', valeur: 120 },
      { mesure: 'appui → carte montée', moteur: 'firefox', valeur: 150 },
      { mesure: 'appui → carte montée', moteur: 'webkit', valeur: 90 },
    ]);
    expect(ecarts).toHaveLength(1);
    expect(ecarts[0]).toMatchObject({ min: 90, max: 150, etendue: 60, accord: false });
    expect(ecarts[0].ecartRelatif).toBeCloseTo(60 / 90, 5);
  });

  it('n’imprime pas d’écart pour une mesure relevée sur un seul moteur', () => {
    // Un écart calculé sur un point vaudrait zéro, et ce zéro dirait « les moteurs
    // s'accordent » là où il ne dit que « on n'a mesuré qu'un moteur ».
    expect(calculerEcarts([{ mesure: 'une seule mesure', moteur: 'chromium', valeur: 10 }])).toEqual([]);
  });

  it('la même mesure sur deux moteurs, avec le même relevé, s’ACCORDE sans division par zéro', () => {
    const ecarts = calculerEcarts([
      { mesure: 'requêtes de carte avant l’appui', moteur: 'chromium', valeur: 0 },
      { mesure: 'requêtes de carte avant l’appui', moteur: 'webkit', valeur: 0 },
    ]);
    expect(ecarts[0]).toMatchObject({ etendue: 0, ecartRelatif: null, accord: true });
  });

  it('une mesure non numérique est publiée sans écart chiffré, et son IDENTITÉ est jugée', () => {
    const sequence = 'pointerdown → touchstart → pointerup → touchend → mousedown → mouseup → click';
    const ecarts = calculerEcarts([
      { mesure: 'séquence d’un appui', moteur: 'chromium', valeur: sequence },
      { mesure: 'séquence d’un appui', moteur: 'firefox', valeur: sequence },
      { mesure: 'séquence d’un appui', moteur: 'webkit', valeur: 'pointerdown → touchend' },
    ]);
    expect(ecarts[0]).toMatchObject({ numerique: false, accord: false, etendue: null });
  });

  it('le registre est indexé par mesure ET par moteur : une mesure remesurée écrase son relevé', () => {
    viderLesReleves();
    enregistrer('une mesure', 'chromium', 1, FICHIER_JETABLE);
    enregistrer('une mesure', 'chromium', 2, FICHIER_JETABLE);
    expect(releves()).toEqual([{ mesure: 'une mesure', moteur: 'chromium', valeur: 2 }]);
    viderLesReleves();
    expect(releves()).toEqual([]);
  });
});

describe('les relevés partagés entre processus', () => {
  // Les trois projets Playwright ne partagent PAS la mémoire (un processus de
  // travail chacun) : le tableau des écarts ne peut donc se reconstituer qu'en
  // relisant un FICHIER. Ces cas éprouvent ce passage-là.
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'ecarts-moteurs-'));
  const fichier = path.join(dossier, 'mesures.jsonl');
  const rapport = path.join(dossier, 'ecarts.md');

  afterAll(() => fs.rmSync(dossier, { recursive: true, force: true }));

  it('relit les relevés écrits par plusieurs processus, et publie le rapport', () => {
    fs.writeFileSync(fichier, '');
    enregistrer('appui → carte montée', 'chromium', 120, fichier);
    enregistrer('appui → carte montée', 'firefox', 150, fichier);
    enregistrer('appui → carte montée', 'webkit', 90, fichier);
    expect(lireLesReleves(fichier)).toHaveLength(3);

    const lignes = [];
    const publie = publierLesEcarts({ fichier, rapport, journaliser: (l) => lignes.push(l) });
    expect(publie.moteurs).toEqual(['chromium', 'firefox', 'webkit']);
    expect(publie.lignes).toHaveLength(1);
    expect(publie.lignes[0]).toMatchObject({ min: 90, max: 150, accord: false });
    expect(lignes.join('\n')).toContain('appui → carte montée');
    expect(fs.readFileSync(rapport, 'utf8')).toContain('étendue 60');
  });

  it('une ligne tronquée (deux écritures entrelacées) est ignorée, pas fatale', () => {
    fs.writeFileSync(fichier, '{"mesure":"a","moteur":"chromium","valeur":1}\n{"mesure":"b","mot\n');
    expect(lireLesReleves(fichier)).toEqual([{ mesure: 'a', moteur: 'chromium', valeur: 1 }]);
  });

  it('un fichier absent donne un tableau VIDE, et le DIT au lieu de faire croire à un accord', () => {
    const lignes = [];
    const publie = publierLesEcarts({
      fichier: path.join(dossier, 'jamais-ecrit.jsonl'),
      rapport,
      journaliser: (l) => lignes.push(l),
    });
    expect(publie.lignes).toEqual([]);
    expect(lignes.join('\n')).toContain('aucune mesure sur deux moteurs');
    expect(fs.readFileSync(rapport, 'utf8')).toContain('Aucune mesure relevée sur deux moteurs.');
  });

  it('la mise en forme d’une ligne est UNE seule fonction (le journal et le rapport ne divergent pas)', () => {
    const numerique = ligneDEcart({
      mesure: 'm',
      valeurs: [
        { moteur: 'a', valeur: 1 },
        { moteur: 'b', valeur: 3 },
      ],
      etendue: 2,
      ecartRelatif: 2,
      numerique: true,
      accord: false,
    });
    expect(numerique).toBe('m — a=1 · b=3 — étendue 2 (200.0 %)');
    const texte = ligneDEcart({
      mesure: 'm',
      valeurs: [
        { moteur: 'a', valeur: 'x' },
        { moteur: 'b', valeur: 'y' },
      ],
      etendue: null,
      ecartRelatif: null,
      numerique: false,
      accord: false,
    });
    expect(texte).toBe('m — a=x · b=y — DIVERGENT');
  });
});

describe('écarts par moteur — le résumé PLACÉ dans le report Playwright', () => {
  // Ce que ces cas éprouvent, et pourquoi ils sont ici : le tableau est publié
  // par le teardown, mais le rapport HTML n'existe qu'APRÈS lui (le rapporteur
  // HTML efface puis régénère son dossier dans son propre `onEnd`) — c'est donc
  // un RAPPORTEUR, déclaré après `html`, qui dépose le résumé dans le report.
  // Ses trois comportements sont ceux qui décident d'un faux vert : placer,
  // dire qu'il ne peut pas placer, et NOMMER une source absente au lieu de
  // réussir en ne faisant rien.
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'report-ecarts-'));
  const source = path.join(dossier, 'ecarts-moteurs.md');
  const resumeRun = path.join(dossier, 'resume-run.md');
  afterAll(() => fs.rmSync(dossier, { recursive: true, force: true }));

  it('dépose le résumé dans le report ET l’ajoute au résumé du run', () => {
    // Sans saut de ligne final : c'est le cas où un `append` brut collerait le
    // tableau au mot précédent du résumé du run.
    fs.writeFileSync(source, '# Écarts par moteur\n\n- appui : étendue 60', 'utf8');
    fs.writeFileSync(resumeRun, '## titre du run\n', 'utf8');
    const dossierReport = fs.mkdtempSync(path.join(dossier, 'report-'));
    const destination = path.join(dossierReport, 'ecarts-moteurs.md');
    const lignes = [];

    const resultat = placerLeResume({
      source,
      destination,
      resume: resumeRun,
      journaliser: (l) => lignes.push(l),
    });

    expect(resultat.manquant).toBeNull();
    expect(fs.readFileSync(destination, 'utf8')).toBe(fs.readFileSync(source, 'utf8'));
    const resume = fs.readFileSync(resumeRun, 'utf8');
    expect(resume).toContain('## titre du run');
    expect(resume).toContain('étendue 60');
    // Le résumé du run n'est pas collé au mot précédent.
    expect(resume).toContain('titre du run\n# Écarts par moteur');
    expect(resume.endsWith('étendue 60\n')).toBe(true);
    expect(resultat.place).toEqual([destination, resumeRun]);
  });

  it('NOMME la source absente au lieu de réussir en ne plaçant rien', () => {
    const dossierReport = fs.mkdtempSync(path.join(dossier, 'report-vide-'));
    const destination = path.join(dossierReport, 'ecarts-moteurs.md');
    const lignes = [];

    const resultat = placerLeResume({
      source: path.join(dossier, 'jamais-publie.md'),
      destination,
      resume: '',
      journaliser: (l) => lignes.push(l),
    });

    expect(resultat.manquant).toBe(path.join(dossier, 'jamais-publie.md'));
    expect(resultat.place).toEqual([]);
    expect(fs.existsSync(destination)).toBe(false);
    expect(lignes.join('\n')).toContain('résumé des écarts non placé');
    expect(lignes.join('\n')).toContain('globalTeardown');
  });

  it('ne fabrique pas un dossier de report absent, et le DIT', () => {
    fs.writeFileSync(source, '# Écarts par moteur\n', 'utf8');
    const resume = path.join(dossier, 'resume-sans-report.md');
    const lignes = [];

    const resultat = placerLeResume({
      source,
      destination: path.join(dossier, 'playwright-report-absent', 'ecarts-moteurs.md'),
      resume,
      journaliser: (l) => lignes.push(l),
    });

    expect(fs.existsSync(path.join(dossier, 'playwright-report-absent'))).toBe(false);
    expect(resultat.place).toEqual([resume]);
    expect(lignes.join('\n')).toContain("n'existe pas");
    expect(lignes.join('\n')).toContain('produit pas de report HTML');
  });
});
