/**
 * LA PREUVE QUE LE CORRECTIF DES SEPT FAUX ROUGES DISCRIMINE.
 *
 * Le 03/11/2026, sept cas de la suite rendaient un verdict FAUX parce qu'ils
 * jugeaient un `build/` d'une révision précédente. Le remède vit dans
 * `scripts/vitest-build-frais.js` : il compare la date de `build/index.html` à
 * celle de la plus récente source publiée, reconstruit si l'artefact est
 * PÉRIMÉ, ne construit rien s'il est ABSENT (l'ordre de la CI), et laisse la
 * suite tourner s'il est À JOUR.
 *
 * Ces cas fixent les trois états et la FRONTIÈRE. Sans eux, une régression
 * silencieuse est facile : inverser la comparaison (`retard < 0`) rendrait
 * l'artefact périmé « à jour », et les sept verdicts faux reviendraient sans
 * qu'un seul test du dépôt ne rougisse — c'est exactement ce que ce fichier
 * empêche.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { etatDuBuild } from '../vitest-build-frais.js';

const TABLES = [];

function arbre() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-build-frais-'));
  TABLES.push(racine);
  fs.mkdirSync(path.join(racine, 'src'), { recursive: true });
  fs.mkdirSync(path.join(racine, 'build'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'index.html'), '<div id="root"></div>');
  fs.writeFileSync(path.join(racine, 'src', 'App.js'), 'export default 1;\n');
  fs.writeFileSync(path.join(racine, 'build', 'index.html'), '<div id="root"></div>');
  return racine;
}

/** Pose une date (en secondes depuis l'époque) sur un fichier. */
function dater(fichier, secondes) {
  const quand = new Date(Date.now() - secondes * 1000);
  fs.utimesSync(fichier, quand, quand);
}

afterEach(() => {
  for (const racine of TABLES.splice(0)) {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

describe('etatDuBuild — ce que la suite a le droit de juger', () => {
  it('dit ABSENT quand build/index.html n’existe pas, et ne devine rien', () => {
    const racine = arbre();
    fs.rmSync(path.join(racine, 'build', 'index.html'));

    const etat = etatDuBuild(racine);

    expect(etat.etat).toBe('absent');
    // Rien à dater : l'état absent n'a ni date de build ni écart, et un écart
    // inventé ferait reconstruire la CI, où `npm test` précède le build.
    expect(etat.build).toBeUndefined();
    expect(etat.retard).toBe(0);
  });

  it('dit FRAIS quand le build est plus récent que toutes les sources', () => {
    const racine = arbre();
    dater(path.join(racine, 'src', 'App.js'), 600);
    dater(path.join(racine, 'index.html'), 600);
    dater(path.join(racine, 'build', 'index.html'), 60);

    expect(etatDuBuild(racine).etat).toBe('frais');
  });

  it('dit PÉRIMÉ quand une source est plus récente que le build — et donne l’écart', () => {
    const racine = arbre();
    dater(path.join(racine, 'build', 'index.html'), 600);
    dater(path.join(racine, 'src', 'App.js'), 120);

    const etat = etatDuBuild(racine);

    // C'est CE cas qui vaut le correctif : un `build/` plus vieux que ses
    // sources est l'état exact où sept gardes rendaient un verdict faux.
    expect(etat.etat).toBe('perime');
    expect(etat.retard).toBeGreaterThanOrEqual(470);
  });

  it('regarde AUSSI les sources d’un sous-dossier, pas seulement la racine', () => {
    const racine = arbre();
    fs.mkdirSync(path.join(racine, 'vite-plugins', 'prerender'), { recursive: true });
    fs.writeFileSync(path.join(racine, 'vite-plugins', 'prerender', 'x.js'), '1;\n');
    dater(path.join(racine, 'src', 'App.js'), 900);
    dater(path.join(racine, 'index.html'), 900);
    dater(path.join(racine, 'build', 'index.html'), 800);
    dater(path.join(racine, 'vite-plugins', 'prerender', 'x.js'), 30);

    // Une coquille changée dans `vite-plugins/` périmise l'artefact autant
    // qu'un composant : c'est ce que sept des verdicts faux jugeaient.
    expect(etatDuBuild(racine).etat).toBe('perime');
  });

  it('ne se laisse pas déplacer par un fichier de `scripts/` (les gardes ne sont pas publiés)', () => {
    const racine = arbre();
    fs.mkdirSync(path.join(racine, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(racine, 'scripts', 'garde.js'), '1;\n');
    dater(path.join(racine, 'src', 'App.js'), 900);
    dater(path.join(racine, 'index.html'), 900);
    dater(path.join(racine, 'build', 'index.html'), 300);
    dater(path.join(racine, 'scripts', 'garde.js'), 10);

    // Un garde édité ne rend pas le document servi périmé : la frontière est
    // la LISTE des sources publiées, pas tout le dépôt.
    expect(etatDuBuild(racine).etat).toBe('frais');
  });
});
