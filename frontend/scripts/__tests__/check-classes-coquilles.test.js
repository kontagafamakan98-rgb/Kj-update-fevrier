/**
 * PREUVE D'ÉCHEC REJOUÉE — « une coquille ne recopie pas une classe ».
 *
 * `scripts/check-classes-coquilles.js` refuse DEUX familles de fautes, et
 * chacune a son cas ici, avec un cas SYNTHÉTIQUE par refus (le seul qui prouve
 * que le garde sait mordre) et un cas sur l'ARBRE RÉEL (le seul qui prouve que
 * le vert n'est pas un refus de principe) :
 *
 *   LA FAMILLE DES LISTES (`scripts/classes-coquilles.js`) —
 *     • une liste publiée par une coquille qui n'a NI jumeau chez React NI
 *       déclaration : le refus central, la classe recopiée d'une ancienne
 *       version de la page ;
 *     • une exemption SANS MOTIF (un oubli avec un droit de passage) ;
 *     • une exemption PÉRIMÉE (la coquille ne publie plus la liste : l'exemption
 *       ne protège plus rien) ;
 *     • une exemption MENTEUSE (React écrit maintenant la liste : elle n'est plus
 *       propre à la coquille) ;
 *     • la MÊME exemption écrite deux fois.
 *
 *   LA FAMILLE DU DOMICILE (`src/config/classes-chrome.js`) —
 *     • un champ que ne lit AUCUNE coquille (la déclaration ne peint rien avant
 *       le JavaScript) ;
 *     • un champ que ne lit AUCUNE source React (les deux peintures ne peuvent
 *       pas porter la même valeur) ;
 *     • une coquille qui RECOPIE la valeur d'un champ au lieu de le lire — et sa
 *       FRONTIÈRE, mesurée : une liste qui CONTIENT la valeur sans être le champ
 *       (le bloc social de l'accueil) est acceptée, parce qu'une liste MODIFIÉE
 *       n'a alors plus de jumeau et c'est l'autre refus qui la renvoie.
 *
 *   LE NIVEAU DU GARDE — un refus de JUGER n'est pas un écart : le dossier de
 *     pré-rendu absent, `src/` absent, un balayage trop maigre sous les quatre
 *     planchers, un domicile introuvable.
 *
 * Les cas synthétiques passent par les fonctions PURES (`verdictListesCoquilles`,
 * `verdictDomicile`) et par le verdict injectable du garde
 * (`verifierClassesCoquilles`, avec des listes fabriquées) : c'est ce qui permet
 * d'éprouver un refus sans écrire un arbre sur disque — les planchers, eux,
 * refuseraient une fixture, et c'est leur travail. Le dernier bloc lance le VRAI
 * garde en sous-processus sur l'arbre réel.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CLASSES_PROPRES_AUX_COQUILLES,
  MIN_LISTES_AVEC_JUMELLE,
  MIN_LISTES_LUES,
  MIN_MODULES_COQUILLES,
  MIN_SOURCES_REACT,
  listesDeClasseDeCoquille,
  listesDeClasseReact,
  verdictDomicile,
  verdictListesCoquilles,
} from '../classes-coquilles.js';
import {
  DOMICILE_PAR_DEFAUT,
  FRONTEND,
  verifierClassesCoquilles,
} from '../check-classes-coquilles.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const GARDE = path.join(ICI, '..', 'check-classes-coquilles.js');

/** Un journal muet : le verdict injectable ne doit rien écrire dans le test. */
const MUET = { log: () => {}, error: () => {} };

/**
 * Un arbre SYNTHÉTIQUE qui passe les planchers : 5 modules de pré-rendu, 150
 * listes publiées (toutes jumelles) et 150 sources React. Les planchers sont
 * ceux du garde (5 / 90 / 128 / 110), donc l'arbre n'a que la marge voulue.
 */
function arbreConforme() {
  const coquilles = [];
  const react = [];
  for (let module = 0; module < 5; module += 1) {
    const listes = [];
    for (let i = 0; i < 30; i += 1) {
      const valeur = `classe-m${module}-${i}`;
      listes.push(`<div class="${valeur}"></div>`);
      react.push({ chemin: `src/Composant${module}_${i}.js`, source: `<div className="${valeur}"></div>` });
    }
    coquilles.push({ module: `vite-plugins/prerender/module${module}.js`, source: listes.join('') });
  }
  while (react.length < 150) {
    react.push({ chemin: `src/Vide${react.length}.js`, source: 'export default null;' });
  }
  return { coquilles, react };
}

/**
 * Le verdict injecté : `domicile: {}` isole la famille des listes (les 13 champs
 * du vrai domicile n'ont aucun lecteur dans un arbre fabriqué, et c'est normal).
 * `sourcesReact` — et pas `react` : c'est le nom du paramètre, et une faute de
 * frappe y ferait SCANNER le vrai `src/` en gardant les coquilles fabriquées,
 * donc juger un arbre hybride qui n'existe pas.
 */
const juger = (coquilles, sourcesReact, extra = {}) =>
  verifierClassesCoquilles({ coquilles, sourcesReact, domicile: {}, propres: [], journal: MUET, ...extra });

describe('classes-coquilles — la LECTURE des deux côtés', () => {
  it('lit les listes LITTÉRALES d’une coquille, ignore les composées et porte la ligne', () => {
    const source = [
      'const a = 1;',
      '<div class="p-4 mb-2"></div>',
      '<div class="autre ${classe} suite"></div>',
      '<span class="seul"></span>',
    ].join('\n');
    expect(listesDeClasseDeCoquille(source)).toEqual([
      { valeur: 'p-4 mb-2', ligne: 2 },
      { valeur: 'seul', ligne: 4 },
    ]);
  });

  it('lit les trois formes de `className` chez React et ignore les composées', () => {
    const source = [
      '<div className="a b"></div>',
      "<div className='c'></div>",
      "<div className={`d ${x}`}></div>",
      '<div className={`e`}></div>',
    ].join('\n');
    expect([...listesDeClasseReact(source)].sort()).toEqual(['a b', 'c', 'e']);
  });
});

describe('classes-coquilles — LA FAMILLE DES LISTES', () => {
  const coquille = (source, module = 'vite-plugins/prerender/x.js') => [{ module, source }];
  const react = (source, chemin = 'src/Page.js') => [{ chemin, source }];

  it('ne rend AUCUN défaut quand chaque liste publiée a son jumeau', () => {
    const verdict = verdictListesCoquilles(
      coquille('<div class="p-4 mb-2"></div>'),
      react('<div className="p-4 mb-2"></div>'),
      []
    );
    expect(verdict.defauts).toEqual([]);
    expect(verdict.volumes).toEqual({
      modules: 1,
      sourcesReact: 1,
      listes: 1,
      declarees: 0,
      avecJumelle: 1,
    });
  });

  it('refuse une liste sans jumeau ni déclaration', () => {
    const verdict = verdictListesCoquilles(
      coquille('<div class="p-4 mb-2"></div>'),
      react('<div className="autre-chose"></div>'),
      []
    );
    expect(verdict.defauts).toHaveLength(1);
    // Le refus NOMME la liste, son module et sa ligne : sans quoi il faudrait
    // chercher soi-même laquelle des 200 listes est en cause.
    expect(verdict.defauts[0]).toContain('p-4 mb-2');
    expect(verdict.defauts[0]).toContain('vite-plugins/prerender/x.js:1');
    expect(verdict.defauts[0]).toContain("n'est pas déclarée");
    expect(verdict.defauts[0]).toContain('CLASSES_PROPRES_AUX_COQUILLES');
  });

  it('accepte la MÊME liste dès qu’elle est déclarée avec son motif', () => {
    const declarations = [
      { publiee: 'p-4 mb-2', module: 'vite-plugins/prerender/x.js', motif: 'état sans JavaScript' },
    ];
    const verdict = verdictListesCoquilles(
      coquille('<div class="p-4 mb-2"></div>'),
      react('<div className="autre-chose"></div>'),
      declarations
    );
    expect(verdict.defauts).toEqual([]);
    expect(verdict.volumes.declarees).toBe(1);
  });

  it('refuse une exemption SANS MOTIF', () => {
    const declarations = [{ publiee: 'p-4 mb-2', module: 'vite-plugins/prerender/x.js', motif: '   ' }];
    const verdict = verdictListesCoquilles(
      coquille('<div class="p-4 mb-2"></div>'),
      react('<div className="autre-chose"></div>'),
      declarations
    );
    expect(verdict.defauts.join(' ')).toContain('déclarée SANS MOTIF');
  });

  it('refuse une exemption PÉRIMÉE (la coquille ne publie plus la liste)', () => {
    const declarations = [
      { publiee: 'liste-disparue', module: 'vite-plugins/prerender/x.js', motif: 'un motif écrit' },
    ];
    const verdict = verdictListesCoquilles(
      coquille('<div class="p-4 mb-2"></div>'),
      react('<div className="p-4 mb-2"></div>'),
      declarations
    );
    expect(verdict.defauts.join(' ')).toContain('ne la publie plus');
  });

  it('refuse une exemption MENTEUSE (React écrit maintenant la liste)', () => {
    const declarations = [
      { publiee: 'p-4 mb-2', module: 'vite-plugins/prerender/x.js', motif: 'un motif écrit' },
    ];
    const verdict = verdictListesCoquilles(
      coquille('<div class="p-4 mb-2"></div>'),
      react('<div className="p-4 mb-2"></div>'),
      declarations
    );
    expect(verdict.defauts.join(' ')).toContain('doit passer au domicile partagé');
  });

  it('refuse la MÊME exemption écrite deux fois', () => {
    const declarations = [
      { publiee: 'p-4 mb-2', module: 'vite-plugins/prerender/x.js', motif: 'un motif écrit' },
      { publiee: 'p-4 mb-2', module: 'vite-plugins/prerender/x.js', motif: 'un autre motif' },
    ];
    const verdict = verdictListesCoquilles(
      coquille('<div class="p-4 mb-2"></div>'),
      react('<div className="autre-chose"></div>'),
      declarations
    );
    expect(verdict.defauts.join(' ')).toContain('déclaration en double');
  });

  it('les déclarations LIVRÉES ont toutes un motif et sont toutes publiées', () => {
    // Le registre des exemptions est lui-même un sujet : une entrée sans motif
    // n'est pas une décision, et une entrée dont le module n'existe plus est une
    // exception qui ment. Les deux refus ont leur cas ci-dessus ; ici, le fait
    // que le registre livré soit dans l'état attendu.
    expect(CLASSES_PROPRES_AUX_COQUILLES.length).toBeGreaterThan(10);
    for (const entree of CLASSES_PROPRES_AUX_COQUILLES) {
      expect(String(entree.motif ?? '').trim(), `${entree.publiee}`).not.toBe('');
      expect(entree.module, `${entree.publiee}`).toMatch(/^vite-plugins\/prerender\//);
    }
  });
});

describe('classes-coquilles — LE DOMICILE partagé', () => {
  const APP_CLASS = 'App';

  it('ne rend AUCUN défaut quand les deux canaux LISENT chaque champ', () => {
    const verdict = verdictDomicile(
      { APP_CLASS },
      [{ module: 'vite-plugins/prerender/app-chrome.js', source: '<div class="${APP_CLASS}"></div>' }],
      [{ chemin: 'src/App.js', source: '<div className={APP_CLASS}></div>' }]
    );
    expect(verdict.defauts).toEqual([]);
    expect(verdict.champs).toEqual([{ nom: 'APP_CLASS', valeur: APP_CLASS, coquilles: 1, react: 1 }]);
  });

  it('refuse un champ du domicile lu par AUCUNE coquille', () => {
    const verdict = verdictDomicile(
      { APP_CLASS },
      [{ module: 'vite-plugins/prerender/app-chrome.js', source: '<div class="autre"></div>' }],
      [{ chemin: 'src/App.js', source: '<div className={APP_CLASS}></div>' }]
    );
    expect(verdict.defauts.join(' ')).toContain("n'est LU par AUCUNE coquille");
  });

  it('refuse un champ du domicile lu par AUCUNE source React', () => {
    const verdict = verdictDomicile(
      { APP_CLASS },
      [{ module: 'vite-plugins/prerender/app-chrome.js', source: '<div class="${APP_CLASS}"></div>' }],
      [{ chemin: 'src/App.js', source: '<div className="App"></div>' }]
    );
    expect(verdict.defauts.join(' ')).toContain("n'est LU par AUCUNE source React");
  });

  it('refuse une coquille qui RECOPIE la valeur du domicile', () => {
    const verdict = verdictDomicile(
      { APP_CLASS },
      [
        {
          module: 'vite-plugins/prerender/app-chrome.js',
          source: '<div class="${APP_CLASS}"></div><div class="App"></div>',
        },
      ],
      [{ chemin: 'src/App.js', source: '<div className={APP_CLASS}></div>' }]
    );
    expect(verdict.defauts.join(' ')).toContain('RECOPIE la valeur de « APP_CLASS »');
  });

  it('ACCEPTE une liste qui CONTIENT la valeur sans être le champ (la frontière mesurée)', () => {
    // La première rédaction cherchait la valeur N'IMPORTE OÙ dans la liste : elle
    // refusait le bloc social de l'accueil, qui publie
    // `font-medium hover:text-orange-800 underline underline-offset-2` — le
    // libellé de lien du pied de page, avec un autre élément. La frontière est
    // donc l'ÉGALITÉ, et une liste MODIFIÉE n'a plus de jumeau : c'est le
    // verdict des listes qui la renvoie (cas « sans jumeau ni déclaration »).
    const verdict = verdictDomicile(
      { PIED_NAV_LIEN_CLASS: 'hover:text-orange-800 underline underline-offset-2' },
      [
        {
          module: 'vite-plugins/prerender/shells-home.js',
          source:
            '<div class="font-medium ${PIED_NAV_LIEN_CLASS}"></div>' +
            '<div class="font-medium hover:text-orange-800 underline underline-offset-2"></div>',
        },
      ],
      [
        {
          chemin: 'src/pages/Home.js',
          source: '<a className={`font-medium ${PIED_NAV_LIEN_CLASS}`}></a>',
        },
      ]
    );
    expect(verdict.defauts).toEqual([]);
  });

  it('la liste MODIFIÉE, elle, est bien renvoyée par le verdict des listes', () => {
    // La contrepartie du cas précédent : la frontière « égalité » ne laisse pas
    // passer une divergence, parce qu'une liste modifiée perd son jumeau.
    const verdict = verdictListesCoquilles(
      [
        {
          module: 'vite-plugins/prerender/shells-home.js',
          source: '<div class="font-medium hover:text-orange-800 underline"></div>',
        },
      ],
      [{ chemin: 'src/pages/Home.js', source: '<a className="font-medium hover:text-orange-800"></a>' }],
      []
    );
    expect(verdict.defauts).toHaveLength(1);
    expect(verdict.defauts[0]).toContain('font-medium hover:text-orange-800 underline');
  });
});

describe('classes-coquilles — LE NIVEAU DU GARDE (refuser de juger n’est pas un écart)', () => {
  it('sort 0 sur un arbre SYNTHÉTIQUE conforme (le vert n’est pas un refus de principe)', () => {
    const { coquilles, react } = arbreConforme();
    const rapport = juger(coquilles, react);
    expect(rapport.ok).toBe(true);
    expect(rapport.erreurs).toEqual([]);
    expect(rapport.defauts).toEqual([]);
    expect(rapport.volumes).toMatchObject({ modules: 5, listes: 150, avecJumelle: 150 });
  });

  it('rend un verdict FAUX dès qu’une liste n’a ni jumeau ni déclaration', () => {
    const { coquilles, react } = arbreConforme();
    coquilles[0].source += '<div class="orpheline"></div>';
    const rapport = juger(coquilles, react);
    expect(rapport.ok).toBe(false);
    expect(rapport.defauts.join(' ')).toContain('orpheline');
  });

  it('refuse un balayage trop maigre (un lecteur qui n’a rien lu)', () => {
    const rapport = juger([{ module: 'm.js', source: '<div class="a"></div>' }], []);
    expect(rapport.ok).toBe(false);
    expect(rapport.erreurs.join(' ')).toContain('balayage trop maigre');
    // Et il REFUSE de juger : aucun défaut n'est rendu, parce qu'il n'a rien lu.
    expect(rapport.defauts).toEqual([]);
  });

  it('refuse un sujet trop maigre en LISTES (elles sont lues, mais trop peu)', () => {
    // Le SECOND plancher, et il se prouve SÉPARÉMENT : le sujet est lu (5
    // modules, 95 sources React), mais les listes publiées sont trop peu
    // nombreuses pour qu'un lecteur cassé se distingue d'une coquille qui n'en
    // publie presque aucune.
    const coquilles = Array.from({ length: 5 }, (_, module) => ({
      module: `vite-plugins/prerender/m${module}.js`,
      source: `<div class="classe-m${module}"></div>`,
    }));
    const sourcesReact = [
      ...Array.from({ length: 5 }, (_, module) => ({
        chemin: `src/C${module}.js`,
        source: `<div className="classe-m${module}"></div>`,
      })),
      ...Array.from({ length: 90 }, (_, i) => ({ chemin: `src/V${i}.js`, source: 'export default null;' })),
    ];
    const rapport = juger(coquilles, sourcesReact);
    expect(rapport.ok).toBe(false);
    expect(rapport.erreurs.join(' ')).toContain('trop peu de listes de classes publiées');
    // Et il refuse de juger : aucun défaut n'est rendu.
    expect(rapport.defauts).toEqual([]);
  });

  it('les planchers sont ceux du relevé, et ils sont explicites', () => {
    // Un plancher recopié d'un relevé qui a changé est une valeur morte : le
    // test les nomme pour que la prochaine passe les confronte au relevé.
    expect([MIN_MODULES_COQUILLES, MIN_SOURCES_REACT, MIN_LISTES_LUES, MIN_LISTES_AVEC_JUMELLE]).toEqual([
      5, 90, 128, 110,
    ]);
  });

  it('refuse un dossier de pré-rendu absent', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-classes-'));
    try {
      const rapport = verifierClassesCoquilles({ racine, journal: MUET });
      expect(rapport.ok).toBe(false);
      expect(rapport.defauts).toEqual([]);
      expect(rapport.erreurs.join(' ')).toContain('dossier de pré-rendu introuvable');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });

  it('refuse une racine sans `src/`', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-classes-'));
    try {
      fs.mkdirSync(path.join(racine, 'vite-plugins', 'prerender'), { recursive: true });
      const rapport = verifierClassesCoquilles({ racine, journal: MUET });
      expect(rapport.ok).toBe(false);
      expect(rapport.erreurs.join(' ')).toContain('sources React introuvables');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });

  it('refuse un domicile introuvable (les deux canaux ne liraient pas la même déclaration)', () => {
    const rapport = verifierClassesCoquilles({ cheminDomicile: 'src/config/absent.js', journal: MUET });
    expect(rapport.ok).toBe(false);
    expect(rapport.erreurs.join(' ')).toContain('domicile des classes partagées introuvable');
  });
});

describe('classes-coquilles — le garde en sous-processus, sur l’arbre réel', () => {
  const lancer = () =>
    execFileSync(process.execPath, [GARDE], {
      cwd: FRONTEND,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  it('sort 0 sur l’arbre réel et publie son relevé', () => {
    const stdout = lancer();
    expect(stdout).toMatch(/Aucune classe recopiée/);
    expect(stdout).toMatch(/liste\(s\) de classes publiées par les coquilles/);
  });

  it('nomme les 13 champs du domicile et leurs DEUX lecteurs', () => {
    const stdout = lancer();
    expect(stdout).toMatch(/domicile src\/config\/classes-chrome\.js : 13 champ\(s\), 13 lu\(s\) par les deux canaux/);
  });

  it('le domicile par défaut est bien celui de l’arbre (aucun chemin mort)', () => {
    expect(fs.existsSync(path.join(FRONTEND, DOMICILE_PAR_DEFAUT))).toBe(true);
  });
});
