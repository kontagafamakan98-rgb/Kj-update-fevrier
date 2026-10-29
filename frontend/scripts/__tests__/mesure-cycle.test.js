/**
 * Le cycle d'une mesure : état sur disque, pids arrêtables, dispersion.
 *
 * Ce que ces cas verrouillent, et qui a coûté une journée de recherche le
 * 28/10/2026 : une mesure tuée en pleine passe laissait sa pile derrière elle
 * (10 Chrome et deux serveurs, mesuré), la passe suivante mesurait à côté, et le
 * chiffre publié décrivait l'hôte — 2 528 à 4 295 ms de Style & Layout sur un
 * document qui en coûte 400 à 800 en pile unique. Le refus, l'arrêt sur signal
 * et la publication de l'étendue sont donc testés ici, sans lancer ni Chrome ni
 * un serveur.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  arreterPids,
  brancherArret,
  dispersionDe,
  ecrireEtat,
  effacerEtat,
  etatAnterieur,
  pidVivant,
} from '../mesure-cycle.mjs';

const dossierNeuf = () => path.join(mkdtempSync(path.join(tmpdir(), 'kojo-cycle-')), 'etat.json');
const ICI = path.dirname(fileURLToPath(import.meta.url));

describe('pidVivant', () => {
  it('reconnaît le processus courant', () => {
    expect(pidVivant(process.pid)).toBe(true);
  });

  it('refuse un pid qui n’en est pas un', () => {
    for (const mauvais of [0, -1, null, undefined, 1.5, NaN, '4174']) {
      expect(pidVivant(mauvais)).toBe(false);
    }
  });

  it('tient un pid hors portée pour mort', () => {
    expect(pidVivant(2 ** 31)).toBe(false);
  });
});

describe('l’état de la passe', () => {
  it('s’écrit, se relit et s’efface', () => {
    const chemin = dossierNeuf();
    expect(etatAnterieur(chemin)).toBeNull();

    ecrireEtat({ pid: process.pid, chrome: null, serveurs: [4174] }, chemin);
    const lu = etatAnterieur(chemin, { vivant: () => false });
    expect(lu).not.toBeNull();
    expect(lu.pids).toEqual([process.pid, 4174]);
    expect(lu.illisible).toBe(false);
    expect(lu.chemin).toBe(chemin);

    expect(effacerEtat(chemin)).toBe(true);
    expect(etatAnterieur(chemin)).toBeNull();
  });

  it('effacer un état absent ne jette pas', () => {
    expect(effacerEtat(dossierNeuf())).toBe(true);
  });

  it('nomme les pid(s) encore VIVANTS et refuse', () => {
    const chemin = dossierNeuf();
    ecrireEtat({ pid: 4242, chrome: 5252, serveurs: [6262], debut: '2026-10-28T10:00:00.000Z' }, chemin);

    const lu = etatAnterieur(chemin, { vivant: (pid) => pid === 5252 });
    expect(lu.vivants).toEqual([5252]);
    expect(lu.refus).toContain('TOURNE ENCORE');
    expect(lu.refus).toContain('5252');
    // Le refus dit POURQUOI, pas seulement que : le chiffre faux est nommé.
    expect(lu.refus).toContain('2 528');
    expect(lu.refus).toContain('--nettoyer');
  });

  it('refuse aussi une passe sans pid vivant : elle n’a pas fini', () => {
    const chemin = dossierNeuf();
    ecrireEtat({ pid: 4242, chrome: null, serveurs: [6262] }, chemin);

    const lu = etatAnterieur(chemin, { vivant: () => false });
    expect(lu.vivants).toEqual([]);
    expect(lu.refus).toContain('PAS TERMINÉE');
    expect(lu.refus).toContain('--nettoyer');
  });

  it('refuse un état ILLISIBLE au lieu de conclure que la place est libre', () => {
    const chemin = dossierNeuf();
    ecrireEtat({ pid: process.pid }, chemin);
    // Fichier tronqué : c'est ce que laisse un arrêt brutal en pleine écriture.
    writeFileSync(chemin, '{ "pid": 42');

    const lu = etatAnterieur(chemin, { vivant: () => false });
    expect(lu.illisible).toBe(true);
    expect(lu.pids).toEqual([]);
    expect(lu.refus).toContain('ILLISIBLE');
    expect(lu.refus).toContain('--nettoyer');
  });
});

describe('arreterPids', () => {
  it('arrête chaque pid valide, jamais le sien, et rapporte ce qu’il a arrêté', () => {
    const tues = [];
    const arretes = arreterPids([111, 222, 0, -3, null, process.pid], (pid) => tues.push(pid), process.pid);
    expect(tues).toEqual([111, 222]);
    expect(arretes).toEqual([111, 222]);
  });

  it('ne compte pas un pid déjà mort comme arrêté', () => {
    const tuer = vi.fn(() => {
      const erreur = new Error('ESRCH');
      erreur.code = 'ESRCH';
      throw erreur;
    });
    expect(arreterPids([999], tuer)).toEqual([]);
    expect(tuer).toHaveBeenCalledTimes(1);
  });

  it('ignore une liste vide', () => {
    expect(arreterPids([])).toEqual([]);
    expect(arreterPids(undefined)).toEqual([]);
  });
});

describe('brancherArret', () => {
  it('appelle l’arrêt UNE fois, sur le signal reçu, puis se débranche', () => {
    const processus = new EventEmitter();
    const surArret = vi.fn();
    const debrancher = brancherArret(surArret, { signaux: ['SIGINT', 'SIGTERM'], processus });

    processus.emit('SIGTERM');
    processus.emit('SIGINT');
    expect(surArret).toHaveBeenCalledTimes(1);
    expect(surArret).toHaveBeenCalledWith('SIGTERM');

    debrancher();
    expect(processus.listenerCount('SIGINT')).toBe(0);
    expect(processus.listenerCount('SIGTERM')).toBe(0);
  });

  it('un signal inconnu de la plateforme ne fait pas perdre les autres', () => {
    const processus = new EventEmitter();
    processus.on = (signal, gestionnaire) => {
      if (signal === 'SIGHUP') throw new Error('signal inconnu');
      return EventEmitter.prototype.on.call(processus, signal, gestionnaire);
    };
    const surArret = vi.fn();
    brancherArret(surArret, { signaux: ['SIGHUP', 'SIGTERM'], processus });

    processus.emit('SIGTERM');
    expect(surArret).toHaveBeenCalledWith('SIGTERM');
  });

  it('un arrêt qui jette ne relance pas la séquence', () => {
    const processus = new EventEmitter();
    const surArret = vi.fn(() => {
      throw new Error('nettoyage cassé');
    });
    brancherArret(surArret, { signaux: ['SIGTERM'], processus });

    expect(() => processus.emit('SIGTERM')).not.toThrow();
    processus.emit('SIGTERM');
    expect(surArret).toHaveBeenCalledTimes(1);
  });
});

describe('dispersionDe', () => {
  it('rend n, min, médiane, max et étendue', () => {
    expect(dispersionDe([279, 696, 277])).toEqual({ n: 3, min: 277, mediane: 279, max: 696, etendue: 419 });
  });

  it('interpole la médiane d’un nombre pair de valeurs', () => {
    expect(dispersionDe([4, 1, 3, 2]).mediane).toBe(2.5);
  });

  it('ignore ce qui n’est pas un nombre et ne rend rien d’une liste vide', () => {
    expect(dispersionDe([NaN, undefined, 500]).n).toBe(1);
    expect(dispersionDe([])).toBeNull();
    expect(dispersionDe(undefined)).toBeNull();
  });
});

describe('le câblage dans l’outil de mesure', () => {
  const source = readFileSync(path.join(ICI, '..', 'mesure-lighthouse-locale.mjs'), 'utf8');

  it('importe le module au lieu de réécrire le cycle', () => {
    expect(source).toContain("from './mesure-cycle.mjs'");
    for (const nom of ['etatAnterieur', 'brancherArret', 'arreterPids', 'ecrireEtat', 'effacerEtat', 'dispersionDe']) {
      expect(source).toContain(nom);
    }
  });

  it('refuse de mesurer sur la pile d’une passe précédente, en nommant les pid(s)', () => {
    expect(source).toContain('const anterieur = etatAnterieur();');
    expect(source).toContain('console.error(`::error::${anterieur.refus}`)');
    expect(source).toContain("present('nettoyer')");
  });

  it('écrit son état avant la première brique et l’efface dans son finally', () => {
    const ecriture = source.indexOf('persisterEtat();');
    const premierServeur = source.indexOf('serveurs.push(');
    expect(ecriture).toBeGreaterThan(-1);
    expect(ecriture).toBeLessThan(premierServeur);
    // Le `finally` EXTÉRIEUR (le dernier) : celui du cycle de la passe entière.
    expect(source.slice(source.lastIndexOf('} finally {'))).toContain('effacerEtat();');
    expect(source.slice(source.lastIndexOf('} finally {'))).toContain('debrancherSignaux();');
  });

  it('démonte sur signal, et le dit sans publier de chiffre', () => {
    expect(source).toContain('brancherArret((signal) => {');
    expect(source).toContain('::warning::${signal} reçu');
    expect(source).toContain("process.exit(signal === 'SIGINT' ? 130 : 143)");
  });

  it('note le pid de Chrome pour pouvoir l’arrêter', () => {
    expect(source).toContain('pid: chrome.pid,');
    expect(source).toContain('etat.chrome = chrome.pid;');
  });

  it('publie l’étendue du Style & Layout à côté de sa moyenne', () => {
    expect(source).toContain('Étendue du Style & Layout');
    expect(source).toContain("ne s'attribue pas à l'artefact");
  });
});
