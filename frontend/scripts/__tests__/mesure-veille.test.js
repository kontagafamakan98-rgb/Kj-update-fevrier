/**
 * La veille détachée : ce que rien d'autre ne couvre.
 *
 * Mesuré le 28/10/2026 : sur Windows, `kill -TERM` sur la mesure passe par
 * `TerminateProcess` — aucun signal n'est livré, donc ni le `finally` ni le
 * gestionnaire de `SIGTERM` ne s'exécutent : 11 Chrome et deux serveurs
 * survivaient, ports à l'écoute. La veille est le seul chemin qui reste, et ces
 * cas le vérifient sans lancer aucune horloge (elle est injectée).
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { ecrireEtat, effacerEtat, etatAnterieur } from '../mesure-cycle.mjs';
import { veiller } from '../mesure-veille.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const dossierNeuf = () => path.join(mkdtempSync(path.join(tmpdir(), 'kojo-veille-')), 'etat.json');
const sansAttente = async () => {};

describe('veiller', () => {
  it('démonte la pile d’une passe disparue, puis retire l’état', async () => {
    const chemin = dossierNeuf();
    ecrireEtat({ pid: 4242, chrome: 5252, serveurs: [6262] }, chemin);
    const arretes = [];

    const resultat = await veiller({
      pid: 4242,
      chemin,
      vivant: () => false,
      attendre: sansAttente,
      arreter: (pids) => {
        arretes.push(...pids);
        return pids;
      },
    });

    // L'ORDRE est celui de l'état (Chrome, puis la passe, puis les serveurs),
    // comparé trié pour que le cas ne dépende pas de cet ordre.
    expect(resultat.motif).toBe('passe-disparue');
    expect(resultat.nettoye).toBe(true);
    expect(arretes.slice().sort((a, b) => a - b)).toEqual([4242, 5252, 6262]);
    expect(etatAnterieur(chemin)).toBeNull();
  });

  it('ne touche à rien tant que la passe vit, et patiente', async () => {
    const chemin = dossierNeuf();
    ecrireEtat({ pid: 4242, chrome: 5252, serveurs: [] }, chemin);
    let tours = 0;
    const arreter = vi.fn(() => []);

    const resultat = await veiller({
      pid: 4242,
      chemin,
      essaisMax: 3,
      // Vivante aux deux premiers tours, morte ensuite : la veille patiente
      // puis démonte — jamais l'inverse.
      vivant: () => {
        tours += 1;
        return tours <= 2;
      },
      attendre: sansAttente,
      arreter,
    });

    expect(resultat.motif).toBe('passe-disparue');
    expect(arreter).toHaveBeenCalledTimes(1);
  });

  it('sort sans rien arrêter quand l’état a disparu (fin normale)', async () => {
    const chemin = dossierNeuf();
    const arreter = vi.fn(() => []);

    const resultat = await veiller({ pid: 4242, chemin, vivant: () => false, attendre: sansAttente, arreter });

    expect(resultat).toEqual({ nettoye: false, motif: 'terminee' });
    expect(arreter).not.toHaveBeenCalled();
  });

  it('ne détruit pas un état ILLISIBLE : il le laisse au refus suivant', async () => {
    const chemin = dossierNeuf();
    writeFileSync(chemin, '{"pid": 42');
    const arreter = vi.fn(() => []);

    const resultat = await veiller({
      pid: 4242,
      chemin,
      essaisMax: 2,
      vivant: () => false,
      attendre: sansAttente,
      arreter,
    });

    expect(resultat).toEqual({ nettoye: false, motif: 'etat-illisible' });
    expect(arreter).not.toHaveBeenCalled();
    expect(readFileSync(chemin, 'utf8')).toContain('42');
  });

  it('s’arrête au bout de ses essais au lieu de veiller sans fin', async () => {
    const chemin = dossierNeuf();
    ecrireEtat({ pid: 4242 }, chemin);
    const resultat = await veiller({
      pid: 4242,
      chemin,
      essaisMax: 2,
      vivant: () => true,
      attendre: sansAttente,
    });
    expect(resultat).toEqual({ nettoye: false, motif: 'veille-expiree' });
    effacerEtat(chemin);
  });
});

describe('le câblage dans l’outil de mesure', () => {
  const source = readFileSync(path.join(ICI, '..', 'mesure-lighthouse-locale.mjs'), 'utf8');

  it('lance la veille après avoir écrit son état, et avant la première brique', () => {
    const ecriture = source.indexOf('persisterEtat();\n\n// ── LA VEILLE DÉTACHÉE');
    const veille = source.indexOf('lancerVeille(process.pid');
    const premierServeur = source.indexOf('serveurs.push(');
    expect(ecriture).toBeGreaterThan(-1);
    expect(veille).toBeGreaterThan(ecriture);
    expect(veille).toBeLessThan(premierServeur);
  });

  it('libère la veille dans le finally, avec l’état', () => {
    const fin = source.slice(source.lastIndexOf('} finally {'));
    expect(fin).toContain('veille.kill()');
    expect(fin).toContain('effacerEtat();');
  });
});
