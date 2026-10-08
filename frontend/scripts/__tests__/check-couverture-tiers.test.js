/**
 * PREUVE D'ÉCHEC REJOUÉE — la couverture des classes de tiers.
 *
 * `scripts/check-couverture-tiers.js` refuse SEPT formes fausses de la matrice,
 * PLUS ce que la règle pure ne peut pas voir (une sonde ou un module supprimé,
 * une déclaration de limites renommée ou vidée). Chacune a son cas ici :
 *   • une classe ORPHELINE — le refus central : aucun canal ne l'observe ;
 *   • une classe SANS LIGNE, une ligne dont la classe n'existe plus ;
 *   • un canal CITÉ mais inexistant, une raison d'ABSENCE muette ;
 *   • une raison d'absence donnée à un canal qui OBSERVE la classe ;
 *   • un canal listé DEUX FOIS dans `vusPar` ;
 *   • un module ou une sonde ABSENT sur disque, une déclaration `CE_QUE_*`
 *     vidée ou renommée ;
 *   • les planchers de lecture (un balayage qui n'a rien lu) et un vocabulaire
 *     `SORTES` ambigu.
 *
 * Les cas synthétiques passent par `lacunesDeCouverture` (pure) et par
 * `runCouvertureTiersCheck` avec un `chargerDeclaration` de test : c'est ce qui
 * permet d'éprouver « export renommé » / « liste vidée » sans écrire un module
 * sur disque. Le dernier bloc lance le VRAI garde en sous-processus sur l'arbre
 * réel : le vert n'est pas un refus de principe.
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  CANAUX,
  CE_QUE_CE_GARDE_VOIT,
  IDS_DES_CANAUX,
  IDS_DES_CLASSES,
  MATRICE,
  classesDuVocabulaire,
  lacunesDeCouverture,
} from '../couverture-tiers.js';
import { CE_QUE_CE_GARDE_VOIT as DECLARATION_LIVRE, SORTES } from '../origines-bundles.js';
import { CE_QUE_LE_GARDE_STATIQUE_VOIT } from '../tiers-avant-interaction.js';
import { CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR } from '../tiers-apres-interaction.js';
import { runCouvertureTiersCheck } from '../check-couverture-tiers.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.join(ICI, '..', '..');
const GARDE = path.join(ICI, '..', 'check-couverture-tiers.js');

/** Les VRAIES déclarations, pour que le stub ne mente que là où on le veut. */
const VRAIES_DECLARATIONS = {
  CE_QUE_LE_GARDE_STATIQUE_VOIT,
  CE_QUE_CE_GARDE_VOIT: DECLARATION_LIVRE,
  CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR,
};

/** Un chargeur de déclarations de test : les vraies, sauf les surcharges. */
const chargeur = (surcharges = {}) => async (_chemin, nomExport) =>
  nomExport in surcharges ? surcharges[nomExport] : VRAIES_DECLARATIONS[nomExport];

/** Un journal muet, pour ne pas polluer la sortie du test. */
const journal = () => ({ log: () => {}, error: () => {} });

/**
 * Un mini-vocabulaire de classes, avec ses deux canaux : les cas de la règle
 * pure sont isolés, donc chacune des sept listes se prouve seule.
 */
const SORTES_FICTIVES = { A: 'classe A', B: 'classe B', C: 'classe C' };
const CANAUX_FICTIFS = {
  x: { nom: 'canal x', nature: 'statique', module: 'm', sonde: 's', declaration: null, motif: 'motif x' },
  y: { nom: 'canal y', nature: 'dynamique', module: 'm', sonde: 's', declaration: null, motif: 'motif y' },
};

/** La matrice conforme des deux canaux : A vu par x, B par y, C par les deux. */
const MATRICE_FICTIVE = () => ({
  'classe A': { vusPar: ['x'], absence: 'raison générale pour y' },
  'classe B': { vusPar: ['y'], absence: 'raison générale pour x' },
  'classe C': { vusPar: ['x', 'y'], absence: '' },
});

const lacunesFictives = (matrice) =>
  lacunesDeCouverture({ sortes: SORTES_FICTIVES, canaux: CANAUX_FICTIFS, matrice });

describe('couverture des tiers — la règle, pure', () => {
  it('la matrice conforme ne rend AUCUNE lacune (le vert n’est pas un refus de principe)', () => {
    const lacunes = lacunesFictives(MATRICE_FICTIVE());
    expect(lacunes).toEqual({
      nonCouvertes: [],
      orphelines: [],
      classesInconnues: [],
      canauxInconnus: [],
      raisonsManquantes: [],
      absencesIncoherentes: [],
      observationsIncoherentes: [],
    });
  });

  it('refuse une classe SANS LIGNE : personne n’a décidé qui l’observe', () => {
    const matrice = MATRICE_FICTIVE();
    delete matrice['classe B'];
    expect(lacunesFictives(matrice).nonCouvertes).toEqual(['classe B']);
  });

  it('refuse une ligne PÉRIMÉE : la matrice a survécu à ce qu’elle décrivait', () => {
    const matrice = MATRICE_FICTIVE();
    matrice['classe disparue'] = { vusPar: ['x'], absence: '' };
    expect(lacunesFictives(matrice).classesInconnues).toEqual(['classe disparue']);
  });

  it('refuse une classe ORPHELINE : aucune vue ne l’observe, son classement est invérifiable', () => {
    const matrice = MATRICE_FICTIVE();
    // Une liste VIDE, puis une liste qui ne nomme qu’un canal inconnu : les deux
    // formes d’orpheline, et c’est le refus central de ce garde.
    matrice['classe A'].vusPar = [];
    matrice['classe C'].vusPar = ['canal-fantome'];
    const lacunes = lacunesFictives(matrice);
    expect(lacunes.orphelines).toEqual(['classe A', 'classe C']);
    expect(lacunes.canauxInconnus).toEqual([{ classe: 'classe C', canal: 'canal-fantome' }]);
  });

  it('refuse un canal CITÉ qui n’existe pas : la matrice mentirait en le nommant', () => {
    const matrice = MATRICE_FICTIVE();
    matrice['classe A'].vusPar = ['x', 'z'];
    expect(lacunesFictives(matrice).canauxInconnus).toEqual([{ classe: 'classe A', canal: 'z' }]);
  });

  it('refuse un canal listé DEUX FOIS : la ligne se contredit', () => {
    const matrice = MATRICE_FICTIVE();
    matrice['classe A'].vusPar = ['x', 'x'];
    expect(lacunesFictives(matrice).observationsIncoherentes).toEqual([{ classe: 'classe A', canal: 'x' }]);
  });

  it('refuse une raison d’ABSENCE donnée à un canal qui OBSERVE la classe', () => {
    const matrice = MATRICE_FICTIVE();
    matrice['classe A'].absencesParticulieres = { x: 'raison pour un canal qui observe' };
    expect(lacunesFictives(matrice).absencesIncoherentes).toEqual([{ classe: 'classe A', canal: 'x' }]);
  });

  it('refuse une absence MUETTE : ni raison générale, ni raison particulière', () => {
    const matrice = MATRICE_FICTIVE();
    matrice['classe A'].absence = '   ';
    expect(lacunesFictives(matrice).raisonsManquantes).toEqual([{ classe: 'classe A', canal: 'y' }]);
  });

  it('une raison PARTICULIÈRE suffit là où la générale manque (le refus ne se déclenche pas)', () => {
    const matrice = MATRICE_FICTIVE();
    matrice['classe A'].absence = '';
    matrice['classe A'].absencesParticulieres = { y: 'raison propre à y' };
    expect(lacunesFictives(matrice).raisonsManquantes).toEqual([]);
  });

  it('refuse un vocabulaire `SORTES` AMBIGU : deux classes de même valeur en cachent une', () => {
    expect(() => classesDuVocabulaire({ A: 'même valeur', B: 'même valeur' })).toThrow(/MÊME valeur/);
    // …et le vocabulaire réel du dépôt ne l’est pas.
    expect(() => classesDuVocabulaire(SORTES)).not.toThrow();
  });
});

describe('couverture des tiers — la forme des tables (portable, sans disque)', () => {
  it('les cinq canaux portent module, sonde et une déclaration OU un motif écrit', () => {
    expect(IDS_DES_CANAUX.length).toBeGreaterThanOrEqual(5);
    for (const id of IDS_DES_CANAUX) {
      const canal = CANAUX[id];
      expect(canal.nature, id).toMatch(/^(statique|dynamique)$/);
      expect(String(canal.module || '').trim().length, id).toBeGreaterThan(3);
      expect(String(canal.sonde || '').trim().length, id).toBeGreaterThan(3);
      if (canal.declaration) {
        expect(String(canal.declaration.export || '').trim().length, id).toBeGreaterThan(3);
        expect(String(canal.declaration.cle || '').trim().length, id).toBeGreaterThan(1);
      } else {
        expect(String(canal.motif || '').trim().length, `${id} sans déclaration`).toBeGreaterThan(40);
      }
    }
  });

  it('chaque ligne de matrice nomme au moins un canal RÉEL et une raison d’absence', () => {
    expect(IDS_DES_CLASSES.length).toBeGreaterThanOrEqual(6);
    for (const classe of IDS_DES_CLASSES) {
      const ligne = MATRICE[classe];
      expect(ligne, classe).toBeTruthy();
      expect(ligne.vusPar.length, classe).toBeGreaterThan(0);
      for (const canal of ligne.vusPar) {
        expect(IDS_DES_CANAUX, `${classe} → ${canal}`).toContain(canal);
      }
      const absents = IDS_DES_CANAUX.filter((canal) => !ligne.vusPar.includes(canal));
      if (absents.length > 0) {
        expect(String(ligne.absence || '').trim().length, classe).toBeGreaterThan(20);
      }
    }
  });

  it('la matrice réelle ne rend AUCUNE lacune (la règle est tenue sur le dépôt)', () => {
    const lacunes = lacunesDeCouverture();
    expect(lacunes.orphelines).toEqual([]);
    expect(lacunes.nonCouvertes).toEqual([]);
    expect(lacunes.classesInconnues).toEqual([]);
    expect(lacunes.canauxInconnus).toEqual([]);
    expect(lacunes.raisonsManquantes).toEqual([]);
    expect(lacunes.absencesIncoherentes).toEqual([]);
    expect(lacunes.observationsIncoherentes).toEqual([]);
  });

  it('les angles morts sont PUBLIÉS, pas implicites', () => {
    expect(CE_QUE_CE_GARDE_VOIT.voit.length).toBeGreaterThanOrEqual(3);
    expect(CE_QUE_CE_GARDE_VOIT.nePeutPasVoir.join(' ')).toMatch(/BIEN-FONDÉ/);
    expect(CE_QUE_CE_GARDE_VOIT.nePeutPasVoir.join(' ')).toMatch(/VÉRACITÉ/);
  });
});

describe('couverture des tiers — les faits que la règle pure ne peut pas voir', () => {
  it('refuse un canal dont le module ou la sonde est ABSENT sur disque', async () => {
    const canaux = {
      ...CANAUX,
      livre: { ...CANAUX.livre, module: 'scripts/ce-module-nexiste-pas.js' },
    };
    const rapport = await runCouvertureTiersCheck({
      canaux,
      chargerDeclaration: chargeur(),
      journal: journal(),
    });
    expect(rapport.ok).toBe(false);
    const message = rapport.errors.find((e) => e.includes('livre'));
    expect(message).toMatch(/module/);
    expect(message).toMatch(/ABSENT/);
    expect(message).toContain('scripts/ce-module-nexiste-pas.js');
  });

  it('refuse un canal sans sonde déclarée (le canal n’a plus d’exécutant)', async () => {
    const canaux = { ...CANAUX, coquille: { ...CANAUX.coquille, sonde: '   ' } };
    const rapport = await runCouvertureTiersCheck({
      canaux,
      chargerDeclaration: chargeur(),
      journal: journal(),
    });
    expect(rapport.ok).toBe(false);
    expect(rapport.errors.some((e) => /coquille/.test(e) && /sonde/.test(e) && /vide/.test(e))).toBe(true);
  });

  it('refuse un export de déclaration RENOMMÉ', async () => {
    const canaux = {
      ...CANAUX,
      livre: { ...CANAUX.livre, declaration: { ...CANAUX.livre.declaration, export: 'CE_QUI_NEXISTE_PAS' } },
    };
    const rapport = await runCouvertureTiersCheck({
      canaux,
      chargerDeclaration: chargeur(),
      journal: journal(),
    });
    expect(rapport.ok).toBe(false);
    expect(
      rapport.errors.some((e) => e.includes('CE_QUI_NEXISTE_PAS') && /n’existe pas/.test(e))
    ).toBe(true);
  });

  it('refuse une déclaration de limites VIDÉE (le canal perd ses limites sans que la prose change)', async () => {
    const rapport = await runCouvertureTiersCheck({
      chargerDeclaration: chargeur({ CE_QUE_CE_GARDE_VOIT: { voit: [], nePeutPasVoir: ['x'] } }),
      journal: journal(),
    });
    expect(rapport.ok).toBe(false);
    expect(rapport.errors.some((e) => /livre/.test(e) && /vide|tableau/.test(e))).toBe(true);
  });

  it('refuse un canal SANS déclaration ET sans motif écrit', async () => {
    const canaux = {
      ...CANAUX,
      'mise-en-ecran': { ...CANAUX['mise-en-ecran'], motif: '' },
    };
    const rapport = await runCouvertureTiersCheck({
      canaux,
      chargerDeclaration: chargeur(),
      journal: journal(),
    });
    expect(rapport.ok).toBe(false);
    expect(rapport.errors.some((e) => /mise-en-ecran/.test(e) && /motif/.test(e))).toBe(true);
  });
});

describe('couverture des tiers — les planchers de lecture', () => {
  it('refuse de juger sous le plancher de CANAUX', async () => {
    const canaux = { coquille: CANAUX.coquille, livre: CANAUX.livre, 'avant-interaction': CANAUX['avant-interaction'] };
    const rapport = await runCouvertureTiersCheck({
      canaux,
      chargerDeclaration: chargeur(),
      journal: journal(),
    });
    expect(rapport.ok).toBe(false);
    expect(rapport.errors.some((e) => /canaux insuffisants \(3 < 5\)/.test(e))).toBe(true);
  });

  it('refuse de juger quand les déclarations de limites n’ont pas pu être lues', async () => {
    // Le chargeur ne rend RIEN : aucun canal n’a de limites lues.
    const rapport = await runCouvertureTiersCheck({
      chargerDeclaration: async () => undefined,
      journal: journal(),
    });
    expect(rapport.ok).toBe(false);
    expect(rapport.errors.some((e) => /déclarations de limites lues insuffisantes/.test(e))).toBe(true);
  });

  it('refuse de juger un vocabulaire de classes illisible (ambigu)', async () => {
    const rapport = await runCouvertureTiersCheck({
      sortes: { A: 'classe A', B: 'classe A' },
      chargerDeclaration: chargeur(),
      journal: journal(),
    });
    expect(rapport.ok).toBe(false);
    expect(rapport.errors.join(' ')).toMatch(/MÊME valeur/);
  });

  it('n’avertit jamais pour un motif écrit : un canal sans déclaration passe', async () => {
    const rapport = await runCouvertureTiersCheck({ chargerDeclaration: chargeur(), journal: journal() });
    expect(rapport.ok).toBe(true);
    expect(rapport.declarationsLues).toHaveLength(3);
  });
});

describe('couverture des tiers — le garde en sous-processus', () => {
  it('sort 0 sur l’arbre réel (le vert n’est pas un refus de principe)', () => {
    const stdout = execFileSync(process.execPath, [GARDE], {
      cwd: RACINE,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(stdout).toMatch(/Couverture tenue/);
    expect(stdout).toMatch(/6 classes/);
  });

  it('nomme les cinq canaux et les trois limites publiées qu’il a lues', () => {
    const stdout = execFileSync(process.execPath, [GARDE], {
      cwd: RACINE,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const id of IDS_DES_CANAUX) {
      expect(stdout, id).toContain(id);
    }
    expect(stdout).toMatch(/CE_QUE_CE_GARDE_VOIT\.voit — 3 entrée\(s\)/);
  });

  it('le journal de test est bien celui qui reçoit le rouge (aucune sortie parallèle)', async () => {
    const log = vi.fn();
    const rapport = await runCouvertureTiersCheck({
      canaux: { ...CANAUX, livre: { ...CANAUX.livre, module: 'pas-la.js' } },
      chargerDeclaration: chargeur(),
      journal: { log, error: log },
    });
    expect(rapport.ok).toBe(false);
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.flat().join(' ')).toMatch(/couverture des classes de tiers est en écart/);
  });
});
