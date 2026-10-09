/**
 * Preuve d'échec du garde `scripts/check-juges-de-temps.js`.
 *
 * Ce que ce fichier doit établir, dans l'ordre où le garde juge :
 *   • le RELEVÉ lit une valeur LITTÉRALE et rien d'autre — pas une valeur
 *     calculée, pas une clé voisine, pas une prose ;
 *   • la DÉCLARATION est ce qui rend le vert : retirer une entrée fait rougir le
 *     constat d'une borne NON DÉCLARÉE (sans quoi le garde serait une
 *     tautologie) ;
 *   • une déclaration PÉRIMÉE rougit — une borne disparue, ou dont le nombre
 *     d'occurrences a changé ;
 *   • une borne qui DÉCIDE sans angle accepté rougit — c'est le défaut d'origine
 *     (un verdict qui porte sur l'hôte) rendu bruyant ;
 *   • une classe hors du vocabulaire fermé, et une justification trop courte
 *     pour porter une mesure, rougissent aussi ;
 *   • les PLANCHERS refusent de juger plutôt que de rendre un vert vide ;
 *   • et l'arbre RÉEL est vert avec la déclaration RÉELLE.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLASSES,
  JUGES,
  SURFACES,
  ANGLES_ACCEPTES,
  relever,
  inventorier,
  confronterInventaire,
  delitsDeDeclaration,
  angleAccepte,
  decideParElleMeme,
  toutesLesDeclarations,
  MIN_JUSTIFICATION,
} from '../juges-de-temps.js';
import { executerVerification, lireSurfaces } from '../check-juges-de-temps.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(ICI, '..', '..');

/** Un texte minimal qui reproduit EXACTEMENT la déclaration réelle. */
const FICHIERS_DECLARES = {
  // AUCUN littéral : les plafonds de la passe mobile sont DÉRIVÉS de la table
  // mesurée (`socleMobile(hote)`, angle mort 19(b) fermé le 07/10/2026), donc la
  // déclaration réelle de cette surface est VIDE. La racine témoin doit décrire
  // la MÊME déclaration — un `3500`/`2500` littéral y serait une borne NON
  // DÉCLARÉE, c'est-à-dire qu'elle décrirait un autre dépôt que le nôtre.
  'frontend/lighthouserc.cjs': 'maxNumericValue: plafondDe(entree.pire, entree.marge)\n',
  'frontend/lighthouserc.desktop.cjs': 'maxNumericValue: plafondTbtDesktop(route)\n',
  'frontend/vite.config.js': 'testTimeout: 20000\n',
  'frontend/playwright.config.js': 'timeout: 30000\ntimeout: 30000\ntimeout: 30000\n',
  'frontend/scripts/check-job-og-contract.js': 'timeout: 20000\n',
  // Le dossier e2e est une surface : la racine temporaire doit en contenir un
  // fichier, sinon le garde refuse une surface INTROUVABLE (ce qu'il doit faire).
  // Son contenu ne porte AUCUNE attente fixe — c'est la déclaration VIDE du
  // registre, et le cas « une attente fixe dans e2e est refusée » plus bas la met
  // à l'épreuve sur un fichier inventé.
  'frontend/e2e/exemple.spec.js': 'await page.waitForSelector("nav a");\nawait attendreLaStabilite(page);\n',
};

/** Écrit une racine temporaire DANS le projet, et la retire ensuite. */
const avecRacineTemporaire = (fichiers, travail) => {
  const dir = fs.mkdtempSync(path.join(FRONTEND, '.juges-de-temps-'));
  try {
    for (const [chemin, texte] of Object.entries(fichiers)) {
      const complet = path.join(dir, chemin);
      fs.mkdirSync(path.dirname(complet), { recursive: true });
      fs.writeFileSync(complet, texte, 'utf8');
    }
    return travail(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('relevé des bornes de temps absolu', () => {
  it('relève une valeur littérale, avec son numéro de ligne', () => {
    const texte = 'const x = 1;\n  timeout: 20000,\nconst y = 2;\n';
    expect(relever(texte, 'timeout')).toEqual([{ valeur: 20000, ligne: 2 }]);
  });

  it('relève TOUTES les occurrences, et séparateurs de milliers compris', () => {
    const texte = 'timeout: 30_000\ntimeout: 30000\n';
    expect(relever(texte, 'timeout')).toEqual([
      { valeur: 30000, ligne: 1 },
      { valeur: 30000, ligne: 2 },
    ]);
  });

  it('N’invente pas une borne calculée : seule une valeur littérale est relevée', () => {
    // C'est le cas réel du TBT de la coquille (`targetIsLocal ? 1600 : 1200`) :
    // un budget qui SUIT l'hôte, donc deux littéraux dans une expression — la
    // forme portable. Le relevé ne doit pas en fabriquer une borne unique.
    expect(relever('maxNumericValue: targetIsLocal ? 1600 : 1200', 'maxNumericValue')).toEqual([]);
  });

  it('ne confond pas une clé VOISINE avec un délai', () => {
    // `minScore` et `maxNumericValue` vivent côte à côte dans Lighthouse : un
    // motif trop large lirait le score comme un temps.
    const texte = "categories:performance': ['error', { minScore: 0.9 }],";
    expect(relever(texte, 'maxNumericValue')).toEqual([]);
    expect(relever(texte, 'timeout')).toEqual([]);
  });

  it('le relevé est TEXTUEL : une borne citée en prose est comptée aussi', () => {
    // Conséquence assumée, et publiée : ce relevé ne distingue pas une borne
    // JOUÉE d'une borne CITÉE dans un commentaire. Le garde surestime donc — il
    // demande une déclaration de trop, jamais une de moins. C'est le sens de
    // l'erreur : bruyant, pas silencieux.
    expect(relever('// timeout: 99999 — un exemple, pas une borne\n', 'timeout')).toEqual([
      { valeur: 99999, ligne: 1 },
    ]);
  });

  it('un motif inconnu lève, il ne rend pas un relevé vide', () => {
    expect(() => relever('timeout: 1', 'delaiImaginaire')).toThrow(/motif inconnu/);
  });
});

describe('inventaire et déclaration', () => {
  const inventaireDes = (fichiers) => inventorier({ fichiers });

  it('ne lit que les motifs DÉCLARÉS sur chaque surface', () => {
    // `lighthouserc.cjs` est déclaré sur `maxNumericValue` seulement : un
    // `timeout:` qui y apparaîtrait n'est pas, par cette surface, une borne
    // jugée — et le registre dit lequel est surveillé.
    const rapport = inventaireDes([
      { chemin: 'frontend/lighthouserc.cjs', texte: 'maxNumericValue: 3500\ntimeout: 9999\n' },
    ]);
    expect(Object.keys(rapport.parSurface['frontend/lighthouserc.cjs'])).toEqual(['maxNumericValue']);
    expect(rapport.parSurface['frontend/lighthouserc.cjs'].maxNumericValue).toHaveLength(1);
  });

  it('ignore un fichier qui n’est pas une surface déclarée', () => {
    const rapport = inventaireDes([{ chemin: 'frontend/src/autre.js', texte: 'timeout: 1\n' }]);
    expect(rapport.lues).toEqual([]);
    expect(rapport.parSurface).toEqual({});
  });

  it('une borne NOUVELLE est refusée tant qu’elle n’est pas déclarée', () => {
    const inventaire = inventaireDes([
      { chemin: 'frontend/vite.config.js', texte: 'testTimeout: 20000\n' },
      { chemin: 'frontend/playwright.config.js', texte: 'timeout: 45000\n' },
    ]);
    const { nonDeclarees } = confronterInventaire(inventaire, JUGES);
    expect(nonDeclarees).toContainEqual({
      chemin: 'frontend/playwright.config.js',
      motif: 'timeout',
      valeur: 45000,
      occurrences: 1,
    });
  });

  it('la DÉCLARATION est ce qui rend le vert — l’en retirer fait rougir', () => {
    // Non-vacuité : sans ce cas, le garde pourrait être vert parce qu'il ne
    // confronte rien.
    const inventaire = inventaireDes([
      { chemin: 'frontend/vite.config.js', texte: 'testTimeout: 20000\n' },
    ]);
    expect(confronterInventaire(inventaire, JUGES).nonDeclarees).toEqual([]);
    const sansDeclaration = { ...JUGES, 'frontend/vite.config.js': { testTimeout: [] } };
    expect(confronterInventaire(inventaire, sansDeclaration).nonDeclarees).toHaveLength(1);
  });

  it('une borne DISPARUE rend la déclaration périmée', () => {
    const inventaire = inventaireDes([
      { chemin: 'frontend/scripts/check-job-og-contract.js', texte: 'const x = 1;\n' },
    ]);
    const { perimees } = confronterInventaire(inventaire, JUGES);
    expect(perimees).toContainEqual({
      chemin: 'frontend/scripts/check-job-og-contract.js',
      motif: 'timeout',
      valeur: 20000,
      attendues: 1,
      reelles: 0,
    });
  });

  it('un nombre d’OCCURRENCES qui change rend la déclaration périmée', () => {
    // Trois `timeout: 30000` dans `playwright.config.js` sont un fait : en
    // supprimer un doit se voir, sinon la déclaration décrit un autre fichier.
    const inventaire = inventaireDes([
      { chemin: 'frontend/playwright.config.js', texte: 'timeout: 30000\n' },
    ]);
    const { perimees } = confronterInventaire(inventaire, JUGES);
    expect(perimees).toContainEqual({
      chemin: 'frontend/playwright.config.js',
      motif: 'timeout',
      valeur: 30000,
      attendues: 3,
      reelles: 1,
    });
  });
});

describe('classes et angles acceptés', () => {
  it('le vocabulaire est FERMÉ, et dit quelles classes décident', () => {
    expect(Object.keys(CLASSES)).toEqual(['PROPRIETE', 'VIVACITE', 'HOTE', 'MESURE']);
    expect(decideParElleMeme('PROPRIETE')).toBe(false);
    expect(decideParElleMeme('VIVACITE')).toBe(false);
    expect(decideParElleMeme('HOTE')).toBe(true);
    expect(decideParElleMeme('MESURE')).toBe(true);
    expect(decideParElleMeme('CLASSE_INVENTEE')).toBe(false);
  });

  it('une classe INCONNUE est un refus, jamais une tolérance', () => {
    const delits = delitsDeDeclaration({
      'frontend/vite.config.js': { testTimeout: [{ valeur: 20000, occurrences: 1, classe: 'VITE' }] },
    });
    expect(delits.map((d) => d.type)).toContain('CLASSE_INCONNUE');
  });

  it('une borne qui DÉCIDE sans angle accepté est le défaut d’origine, nommé', () => {
    // C'est LE cas que ce garde existe pour attraper : un budget de classe HOTE
    // ou MESURE qui décide d'un verdict sans que rien ne soit déclaré comme
    // compensé — le verdict porte alors sur la machine.
    const delits = delitsDeDeclaration({
      'frontend/scripts/check-job-og-contract.js': {
        timeout: [
          {
            valeur: 20000,
            occurrences: 1,
            classe: 'MESURE',
            pourquoi: 'Un budget en millisecondes qui déciderait du contrat OG, ce qui n’est pas le cas.',
          },
        ],
      },
    });
    expect(delits.map((d) => d.type)).toContain('DECIDE_SANS_ANGLE');
    expect(delits.find((d) => d.type === 'DECIDE_SANS_ANGLE').valeur).toBe(20000);
  });

  it('une vivacité ou une attente de condition passe SANS angle accepté', () => {
    const sansDelit = delitsDeDeclaration({
      'frontend/scripts/fantome.js': {
        timeout: [
          {
            valeur: 5000,
            occurrences: 1,
            classe: 'PROPRIETE',
            pourquoi: 'Plafond d’attente d’un sélecteur : ce qui décide est le marqueur de montage, pas le délai.',
          },
        ],
      },
    });
    expect(sansDelit).toEqual([]);
  });

  it('une justification courte n’est pas une justification', () => {
    expect(MIN_JUSTIFICATION).toBeGreaterThanOrEqual(40);
    const delits = delitsDeDeclaration({
      'frontend/vite.config.js': {
        testTimeout: [{ valeur: 20000, occurrences: 1, classe: 'VIVACITE', pourquoi: 'ok' }],
      },
    });
    expect(delits.map((d) => d.type)).toEqual(['SANS_JUSTIFICATION']);
  });

  it('la déclaration RÉELLE ne porte aucun délit, et plus AUCUNE mesure littérale', () => {
    expect(delitsDeDeclaration(JUGES, ANGLES_ACCEPTES)).toEqual([]);
    const mesures = toutesLesDeclarations(JUGES).filter((d) => d.classe === 'MESURE');
    // C'est le RÉSULTAT de l'angle mort 19(b), pas un oubli : plus aucun budget
    // en millisecondes n'est écrit ici. Il est DÉRIVÉ de sa mesure par
    // `plafondDe(pire, marge)`, dans `scripts/lhci-cls-budgets.cjs`, et re-mesurer
    // la table DÉPLACE le plafond. Un littéral qui reviendrait serait vu
    // (`nonDeclarees`) : la seule façon d'en avoir un est donc de l'écrire ICI,
    // classe MESURE, avec son angle — c'est-à-dire jamais en silence.
    expect(mesures).toEqual([]);
    // Le mécanisme n'est pas mort pour autant : une mesure DÉCLARÉE reste
    // couverte par son angle (et le cas synthétique ci-dessus prouve qu'une
    // mesure qui déciderait SANS angle rougirait).
    const uneMesure = {
      chemin: 'frontend/lighthouserc.cjs',
      motif: 'maxNumericValue',
      valeur: 3500,
      classe: 'MESURE',
    };
    expect(angleAccepte(uneMesure, ANGLES_ACCEPTES)).toBeTruthy();
  });
});

describe('aucune attente FIXE dans le harnais e2e (angle mort 19a, fermé le 28/09/2026)', () => {
  const inventaireDes = (fichiers) => inventorier({ fichiers });

  it('la surface `frontend/e2e` est un DOSSIER : chaque fichier est lu À SON NOM', () => {
    // Sans ce développement, la surface ne lirait rien (aucun fichier ne porte ce
    // chemin) et le garde serait vert sur un sujet qu'il ne regarde pas — le faux
    // vert que l'angle mort 19 recensait : les attentes fixes vivaient dans des
    // specs, hors de toute surface déclarée.
    const inventaire = inventaireDes([
      { chemin: 'frontend/e2e/un.spec.js', texte: 'await attendreLaStabilite(page);\n' },
      { chemin: 'frontend/e2e/helpers/deux.js', texte: 'export const rien = 1;\n' },
      { chemin: 'frontend/src/pas-une-surface.js', texte: 'waitForTimeout(999);\n' },
    ]);
    expect(Object.keys(inventaire.parSurface).sort()).toEqual([
      'frontend/e2e/helpers/deux.js',
      'frontend/e2e/un.spec.js',
    ]);
    expect(inventaire.parSurface['frontend/e2e/un.spec.js']).toEqual({ attenteFixe: [] });
  });

  it('une attente fixe, MÊME dans un parcours qui n’est listé nulle part, est REFUSÉE et NOMMÉE', () => {
    // Le fichier n'existe pas dans `SURFACES` en tant que tel : il est couvert
    // parce qu'il est SOUS la surface. Un parcours ajouté demain est donc jugé
    // sans que personne y pense, et le refus dit lequel.
    const inventaire = inventaireDes([
      { chemin: 'frontend/e2e/tresor.spec.js', texte: 'await page.waitForTimeout(120);\n' },
    ]);
    expect(inventaire.parSurface['frontend/e2e/tresor.spec.js'].attenteFixe).toEqual([
      { valeur: 120, ligne: 1 },
    ]);
    expect(confronterInventaire(inventaire, JUGES).nonDeclarees).toEqual([
      { chemin: 'frontend/e2e/tresor.spec.js', motif: 'attenteFixe', valeur: 120, occurrences: 1 },
    ]);
  });

  it('l’arbre RÉEL n’en porte AUCUNE — et le dossier est bien lu (plancher)', () => {
    const inventaire = inventorier(lireSurfaces());
    const e2e = Object.entries(inventaire.parSurface).filter(([chemin]) =>
      chemin.startsWith('frontend/e2e/')
    );
    // Plancher de lecture : un dossier vide, un nom d’extension changé ou un
    // développement cassé rendraient « aucune attente fixe » VRAI pour la
    // mauvaise raison — le mode d’échec exact de ce garde.
    expect(e2e.length).toBeGreaterThan(10);
    const attentes = e2e.flatMap(([chemin, parMotif]) =>
      parMotif.attenteFixe.map((occurrence) => `${chemin}:${occurrence.ligne} → ${occurrence.valeur} ms`)
    );
    expect(attentes).toEqual([]);
  });
});

describe('bras de la CI', () => {
  it('juge l’arbre RÉEL : aucune borne non déclarée, aucune déclaration périmée', () => {
    const rapport = executerVerification();
    expect(rapport.confrontation.nonDeclarees).toEqual([]);
    expect(rapport.confrontation.perimees).toEqual([]);
    expect(rapport.delits).toEqual([]);
    expect(rapport.confrontation.occurrencesReelles).toBe(rapport.confrontation.occurrencesAttendues);
    // Les surfaces sont lues UNE PAR FICHIER : la surface `frontend/e2e` est un
    // DOSSIER, développé en ses fichiers JavaScript. Comparer à `SURFACES.length`
    // ne dirait plus rien ; ce qui doit être vrai est que le verdict a lu TOUT ce
    // que la lecture sait lire, et rien de moins.
    expect(rapport.surfacesLues).toBe(lireSurfaces().fichiers.length);
    expect(rapport.surfacesLues).toBeGreaterThanOrEqual(SURFACES.length);
  });

  it('rend le même verdict sur une racine qui reproduit la déclaration', () => {
    avecRacineTemporaire(FICHIERS_DECLARES, (dir) => {
      const rapport = executerVerification(dir);
      expect(rapport.confrontation.nonDeclarees).toEqual([]);
      expect(rapport.confrontation.perimees).toEqual([]);
    });
  });

  it('refuse une surface déclarée INTROUVABLE — un registre périmé ment', () => {
    const sansUne = { ...FICHIERS_DECLARES };
    delete sansUne['frontend/playwright.config.js'];
    avecRacineTemporaire(sansUne, (dir) => {
      expect(() => executerVerification(dir)).toThrow(/INTROUVABLE/);
    });
  });

  it('refuse de juger quand le relevé ne lit plus assez de bornes', () => {
    // Un motif cassé rendrait « aucun écart » : c'est le faux vert que les
    // planchers interdisent.
    const presqueVide = Object.fromEntries(
      Object.entries(FICHIERS_DECLARES).map(([chemin, texte]) => [
        chemin,
        texte.replace(/timeout: 30000\n/g, ''),
      ])
    );
    avecRacineTemporaire(presqueVide, (dir) => {
      expect(() => executerVerification(dir)).toThrow(/Bornes relevées insuffisantes/);
    });
  });
});
