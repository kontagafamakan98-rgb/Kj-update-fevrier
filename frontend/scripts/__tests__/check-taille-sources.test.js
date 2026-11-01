// Tests du garde-fou « plafond des sources » (scripts/check-taille-sources.js).
//
// Ce garde existe pour une raison mesurée : le budget de bundle juge les
// ARTEFACTS, donc un fichier source de 3 463 lignes pouvait produire un chunk de
// 4 Ko sans qu'aucun budget ne bronche (audit du 31/10/2026, §5.3-11).
//
// Les cas négatifs comptent donc autant que le cas nominal : un plafond qui ne
// peut pas refuser ne plafonne rien. Chaque refus est vérifié par SA phrase,
// pas par « il y a une erreur » — un garde qui refuse pour la mauvaise raison
// passerait un test qui ne regarde que le booléen.

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  ARBRES,
  PLAFONDS_DECLARES,
  PLAFOND_PAR_DEFAUT,
  RACINE_PAR_DEFAUT,
  checkTailleSources,
} from '../check-taille-sources';

const temporaires = [];

const arbre = (fichiers) => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-taille-sources-'));
  temporaires.push(racine);
  for (const [relatif, contenu] of Object.entries(fichiers)) {
    const absolu = path.join(racine, relatif);
    fs.mkdirSync(path.dirname(absolu), { recursive: true });
    fs.writeFileSync(absolu, contenu);
  }
  return racine;
};

// Un fichier de N lignes, terminé par un saut de ligne : la borne se juge donc
// sur N, pas sur N+1 (le saut final n'est pas une ligne).
const lignes = (n) => Array.from({ length: n }, (_, i) => `// ligne ${i + 1}`).join('\n') + '\n';

const fixture = (fichiers, options = {}) =>
  checkTailleSources({
    racine: arbre(fichiers),
    arbres: [{ racine: 'src', extensions: ['.js', '.css'] }],
    plafondParDefaut: { '.js': 100, '.css': 200 },
    declarations: [],
    quiet: true,
    ...options,
  });

afterEach(() => {
  for (const racine of temporaires.splice(0)) fs.rmSync(racine, { recursive: true, force: true });
});

describe('check-taille-sources — le plafond par défaut', () => {
  it('laisse passer un arbre sain et PUBLIE ce qu’il a lu', () => {
    const resultat = fixture({ 'src/a.js': lignes(80), 'src/b.css': lignes(150) });

    expect(resultat.errors).toEqual([]);
    expect(resultat.ok).toBe(true);
    expect(resultat.stats.fichiers).toBe(2);
    expect(resultat.stats.lignes).toBe(230);
    expect(resultat.stats.pires[0].chemin).toBe('src/b.css');
  });

  it('refuse un fichier AU-DESSUS du plafond par défaut, en le nommant avec sa taille', () => {
    const resultat = fixture({ 'src/gros.js': lignes(101) });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/src\/gros\.js fait 101 lignes pour un plafond de 100/);
    // Et il DIT quoi faire : découper, ou déclarer une dérogation motivée.
    expect(resultat.errors.join('\n')).toMatch(/déclarer une dérogation AVEC sa date, son motif et sa cible/);
  });

  it('accepte EXACTEMENT le plafond : la borne est un droit, pas une tolérance', () => {
    const resultat = fixture({ 'src/pile.js': lignes(100) });

    expect(resultat.errors).toEqual([]);
    expect(resultat.ok).toBe(true);
  });

  it('ne juge pas les tests, même énormes', () => {
    const resultat = fixture({
      'src/a.js': lignes(10),
      'src/__tests__/gros.test.js': lignes(5000),
      'src/x.test.jsx': lignes(5000),
    });

    // Un seul fichier est jugé : un test de 5 000 lignes ne rend pas rouge, et
    // il n'entre pas non plus dans le compte de ce que le garde a lu.
    expect(resultat.errors).toEqual([]);
    expect(resultat.ok).toBe(true);
    expect(resultat.stats.fichiers).toBe(1);
    expect(resultat.stats.lignes).toBe(10);
  });

  it('refuse de conclure sur un corpus VIDE', () => {
    const resultat = fixture({ 'src/rien.txt': 'texte' });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/un garde qui ne mesure rien rend un vert qui ne prouve rien/);
  });
});

describe('check-taille-sources — la table des dérogations', () => {
  const derogation = (surcharge = {}) => ({
    chemin: 'src/gros.js',
    plafond: 300,
    cible: 150,
    mesure: '01/11/2026',
    motif: 'mesuré, à découper',
    ...surcharge,
  });

  it('accepte une dérogation datée dont la cible est une vraie réduction', () => {
    const resultat = fixture({ 'src/gros.js': lignes(250) }, { declarations: [derogation()] });

    expect(resultat.errors).toEqual([]);
    expect(resultat.ok).toBe(true);
    expect(resultat.stats.declarations).toBe(1);
  });

  it('refuse un fichier dérogé qui dépasse SON plafond, et nomme la cible', () => {
    const resultat = fixture({ 'src/gros.js': lignes(301) }, { declarations: [derogation()] });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(
      /src\/gros\.js fait 301 lignes pour un plafond de 300 \(dérogation datée, cible 150 : il doit DESCENDRE/
    );
  });

  it('refuse une dérogation ORPHELINE (le fichier n’existe plus)', () => {
    const resultat = fixture({ 'src/petit.js': lignes(10) }, { declarations: [derogation()] });

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(
      /src\/gros\.js est déclaré avec un plafond de 300 lignes mais ce fichier n'est pas jugé/
    );
  });

  it('refuse une dérogation qui ne plafonne rien de plus que le défaut', () => {
    const resultat = fixture(
      { 'src/gros.js': lignes(90) },
      { declarations: [derogation({ plafond: 100, cible: 50 })] }
    );

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/c'est-à-dire PAS PLUS que le plafond par défaut \(100\)/);
  });

  it('refuse une cible qui n’est pas une RÉDUCTION', () => {
    const resultat = fixture(
      { 'src/gros.js': lignes(250) },
      { declarations: [derogation({ cible: 300 })] }
    );

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/une cible de 300 lignes qui n'est pas une RÉDUCTION/);
  });

  it('refuse une cible AU-DESSUS de la mesure (un sursis qui ne réduit rien)', () => {
    const resultat = fixture(
      { 'src/gros.js': lignes(120) },
      { declarations: [derogation({ cible: 200 })] }
    );

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/mesure 120, plafond 300/);
  });

  it('refuse une dérogation NON DATÉE', () => {
    const resultat = fixture(
      { 'src/gros.js': lignes(250) },
      { declarations: [derogation({ mesure: 'hier' })] }
    );

    expect(resultat.ok).toBe(false);
    expect(resultat.errors.join('\n')).toMatch(/n'est pas DATÉ \(mesure « hier »\)/);
  });

  it('compte la dette en lignes AU-DESSUS du défaut, pas en fichiers entiers', () => {
    const resultat = fixture({ 'src/gros.js': lignes(250), 'src/petit.js': lignes(40) });

    // 250 - 100 = 150, et le fichier de 40 lignes n'ajoute rien.
    expect(resultat.stats.dette).toBe(150);
  });
});

describe('check-taille-sources — l’arbre RÉEL du dépôt', () => {
  it('l’arbre réel est conforme, et la table DÉCLARÉE ne cite que des fichiers existants', () => {
    const resultat = checkTailleSources({ quiet: true });

    expect(resultat.errors).toEqual([]);
    expect(resultat.ok).toBe(true);
    // Le corpus est jugé, il n'est pas vide : un garde qui ne lit rien rendrait
    // ce cas vert sans avoir mesuré une seule ligne.
    expect(resultat.stats.fichiers).toBeGreaterThan(200);
    expect(resultat.stats.lignes).toBeGreaterThan(50_000);
  });

  it('chaque dérogation déclarée est plus grosse que le plafond par défaut de son extension', () => {
    // Une entrée sous le défaut ne plafonnerait rien de plus que la règle
    // générale : c'est la même règle, vérifiée ici sur la table livrée (le cas
    // ci-dessus la vérifie sur une table de fixture).
    for (const declaration of PLAFONDS_DECLARES) {
      const defaut = PLAFOND_PAR_DEFAUT[path.extname(declaration.chemin)];
      expect(defaut, declaration.chemin).toBeGreaterThan(0);
      expect(declaration.plafond, declaration.chemin).toBeGreaterThan(defaut);
      expect(declaration.cible, declaration.chemin).toBeLessThan(declaration.plafond);
      expect(declaration.mesure, declaration.chemin).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(fs.existsSync(path.join(RACINE_PAR_DEFAUT, declaration.chemin)), declaration.chemin).toBe(true);
    }
  });

  it('les quatre fichiers que l’audit du 31/10 nommait ont TOUS une dérogation', () => {
    // Non-vacuité de la table : si une entrée disparaissait, ces quatre-là
    // repasseraient sous le plafond par défaut sans que rien ne le dise.
    const declares = new Set(PLAFONDS_DECLARES.map((d) => d.chemin));
    for (const chemin of [
      'frontend/src/index.css',
      'backend/kojo_scheduler.py',
      'frontend/src/config/page-sections.js',
      'frontend/src/pages/JobDetails.js',
    ]) {
      expect(declares.has(chemin), chemin).toBe(true);
    }
  });

  it('juge bien les quatre arbres déclarés', () => {
    expect(ARBRES.map((a) => a.racine)).toEqual([
      'frontend/src',
      'frontend/vite-plugins',
      'frontend/scripts',
      'backend',
    ]);
  });
});
