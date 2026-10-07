/**
 * LA MESURE DU POINÇON EST UN GARDE, ET CE FICHIER EST SA PREUVE D'ÉCHEC.
 *
 * ── Le trou qu'il ferme ────────────────────────────────────────────────────
 * L'atelier du 28/09/2026 a mesuré trois choses — le contraste de la lettre sur
 * la matière, le débordement des cercles du disque, les pixels peints hors du
 * disque —, il a corrigé le dessin avec elles (2,67 → 3,29:1 ; l'ombre ramenée
 * de 22,6 à 22,0), puis il a été supprimé. Ce qui restait était de la PROSE :
 * trois paragraphes dans l'en-tête de `marque-kojo.js` et deux nombres dans
 * `AGENTS.md`. Une prose ne rougit pas — une géométrie retouchée aurait laissé
 * les deux nombres mentir, et le seul juge aurait été un œil humain sur une
 * icône de 36 px.
 *
 * ── Ce que ce fichier prouve, et comment ───────────────────────────────────
 * Chaque mesure a SON cas fautif, construit sur la VRAIE géométrie (recopiée
 * puis mutée d'un seul champ), et chaque cas doit rendre `ok: false` en nommant
 * la couche ou le point. Le registre `.github/scripts/guard-proofs.json` rejoue
 * la neutralisation du verdict de chacune des trois : c'est la chaîne complète
 * « la règle sait mordre → le harnais le vérifie à chaque push ».
 *
 * Deux cas méritent d'être nommés ici, parce qu'ils défendent la mesure
 * elle-même et pas seulement le dessin :
 *   * LE DISQUE VIDÉ : « aucun pixel peint hors du disque » est VRAI d'une image
 *     transparente. Sans la contrepartie (le disque doit être peint), la
 *     troisième mesure serait un garde qui verdit en ne regardant rien — la
 *     pire espèce de garde, celle qui fait croire que quelqu'un surveille.
 *   * LA RAMPE N'EST PAS UN DÉBORDEMENT : la mesure tolère la rampe
 *     d'anti-aliasing et la traîne du ré-échantillonnage (les icônes sont
 *     dessinées à 512 puis réduites par moyenne de surface). Un cas positif
 *     l'exige, sinon le garde rougirait sur un dessin sain — et un garde qui
 *     rougit à tort finit ignoré.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { decodePng, runMarqueKojoCheck } from '../check-marque-kojo.js';
import {
  cerclesDansLeDisque,
  couleurCss,
  couleurSous,
  contrasteDeLaLettre,
  lireChemin,
  MARGE_DISQUE_PAS,
  pixelsHorsDuDisque,
  segmentsDeLaLettre,
  SEUIL_CONTRASTE,
} from '../marque-kojo-mesures.js';

const FRONTEND_DIR = path.resolve(__dirname, '../..');
const GEOMETRIE = JSON.parse(
  fs.readFileSync(path.join(FRONTEND_DIR, 'src', 'config', 'marque-kojo.json'), 'utf8')
);

/** Un journal muet : les cas qui exercent le verdict du GARDE ne salissent pas
 * la sortie du harnais (le garde, lui, imprime ses raisons — celles du cas
 * « sort en 0 sur l'arbre réel » sont vérifiées). */
const journalMuet = { log() {}, error() {} };

/** Une copie de la géométrie réelle, à muter d'un seul champ par cas. */
const copieDeLaGeometrie = () => JSON.parse(JSON.stringify(GEOMETRIE));

/**
 * Un tampon RGBA synthétique : un disque plein jusqu'à `rayonPeint` (unités de
 * grille), et — si on le demande — un pixel peint BIEN plus loin. Sert aux trois
 * cas de la mesure de pixels : le disque vidé, l'encre dehors, le disque plein.
 */
const tampon = (taille, rayonPeint, pixelHors) => {
  const pixels = Buffer.alloc(taille * taille * 4);
  const pas = GEOMETRIE.grille / taille;
  for (let ligne = 0; ligne < taille; ligne += 1) {
    for (let colonne = 0; colonne < taille; colonne += 1) {
      const distance = Math.hypot((colonne + 0.5) * pas - 24, (ligne + 0.5) * pas - 24);
      if (distance > rayonPeint) continue;
      const index = (ligne * taille + colonne) * 4;
      pixels[index] = 220;
      pixels[index + 1] = 70;
      pixels[index + 2] = 30;
      pixels[index + 3] = 255;
    }
  }
  if (pixelHors) {
    const index = (pixelHors[1] * taille + pixelHors[0]) * 4;
    pixels[index] = 255;
    pixels[index + 1] = 255;
    pixels[index + 2] = 255;
    pixels[index + 3] = 255;
  }
  return pixels;
};

describe('la mesure du poinçon : le dessin reste lisible, contenu et sans débordement', () => {
  it("reproduit la mesure d'atelier du 28/09/2026 (contraste 3,29:1 au pire point)", () => {
    const contraste = contrasteDeLaLettre(GEOMETRIE);

    // Le nombre de l'atelier, retrouvé par un autre code : c'est la seule
    // vérification possible d'une mesure dont l'instrument a été supprimé.
    expect(contraste.pire.contraste).toBeGreaterThanOrEqual(3.25);
    expect(contraste.pire.contraste).toBeLessThanOrEqual(3.35);
    expect(contraste.moyenne).toBeGreaterThanOrEqual(4.2);
    expect(contraste.moyenne).toBeLessThanOrEqual(4.4);
    // Anti-faux-vert : une mesure qui n'a rien échantillonné ne prouve rien.
    expect(contraste.echantillons).toBeGreaterThan(1000);
    expect(contraste.ok).toBe(true);
    expect(contraste.seuil).toBe(SEUIL_CONTRASTE);
  });

  it('refuse une lettre dont le fond est trop clair — le seuil de contraste est 3:1', () => {
    const geometrie = copieDeLaGeometrie();
    // Le défaut d'origine, reconstruit : le cœur chaud s'étale SOUS la lettre
    // (c'était l'orange #ff8a3d de la première version du dégradé).
    geometrie.gradients.matiere.arrets = [
      [0, '#ffd9b0'],
      [1, '#e0a070'],
    ];

    const contraste = contrasteDeLaLettre(geometrie);
    expect(contraste.ok).toBe(false);
    expect(contraste.pire.contraste).toBeLessThan(SEUIL_CONTRASTE);
  });

  it('la règle des cercles nomme le bord le plus large et sa marge', () => {
    const cercles = cerclesDansLeDisque(GEOMETRIE);

    expect(cercles.ok).toBe(true);
    expect(cercles.bords).toHaveLength(5);
    expect(cercles.pire).toEqual({ nom: 'ombre', bord: 23.15, debordement: 0 });
    expect(cercles.rayonDisque).toBe(23.2);
    expect(cercles.marge).toBe(0.05);
  });

  it('refuse un cercle qui déborde du disque', () => {
    const geometrie = copieDeLaGeometrie();
    // 22,6 + 1,15 = 23,75 > 23,2 : le rayon du dessin AVANT le correctif.
    geometrie.peintures.marque.couches.find((couche) => couche.nom === 'ombre').rayon = 22.6;

    const cercles = cerclesDansLeDisque(geometrie);
    expect(cercles.ok).toBe(false);
    expect(cercles.pire).toEqual({ nom: 'ombre', bord: 23.75, debordement: 0.55 });
  });

  it('refuse un disque vidé : « rien dehors » serait vrai d’une image transparente', () => {
    const mesure = pixelsHorsDuDisque(tampon(192, -1), { taille: 192, geometrie: GEOMETRIE });

    expect(mesure.hors).toBe(0); // la première condition est satisfaite…
    expect(mesure.peints).toBe(0);
    expect(mesure.partPeinte).toBe(0);
    expect(mesure.ok).toBe(false); // …et c'est la contrepartie qui refuse.
  });

  it("refuse de l'encre peinte hors du disque, et publie son écart", () => {
    // Un pixel peint dans le COIN (2, 2), à 33,06 unités du centre — très
    // au-delà du disque et de la rampe tolérée (23,2 + 1,25 pixel ≈ 23,5).
    const mesure = pixelsHorsDuDisque(tampon(192, 23.2, [2, 2]), {
      taille: 192,
      geometrie: GEOMETRIE,
    });

    expect(mesure.ok).toBe(false);
    expect(mesure.hors).toBe(1);
    expect(mesure.excesMaxUnites).toBeGreaterThan(9);
    expect(mesure.excesMaxPixels).toBeGreaterThan(35);
    expect(mesure.pointPire).toEqual({ x: 2, y: 2, distance: expect.any(Number) });
  });

  it("accepte un disque plein, et ne compte pas la rampe d'anti-aliasing comme un débordement", () => {
    // Le disque peint EXACTEMENT jusqu'à son rayon : c'est le cas sain, et la
    // tolérance existe pour lui (le garde ne doit pas rougir sur un bon dessin).
    const mesure = pixelsHorsDuDisque(tampon(192, 23.2), { taille: 192, geometrie: GEOMETRIE });

    expect(mesure.hors).toBe(0);
    expect(mesure.partPeinte).toBeGreaterThan(0.99);
    expect(mesure.ok).toBe(true);
    expect(mesure.limite).toBeCloseTo(23.2 + MARGE_DISQUE_PAS * (GEOMETRIE.grille / 192), 4);
  });

  it('lit les commandes M, L, V et H de la lettre, et refuse une commande inconnue', () => {
    expect(lireChemin('M17.3 14.7V33.3')).toEqual([
      [
        [17.3, 14.7],
        [17.3, 33.3],
      ],
    ]);
    expect(lireChemin('M0 0L10 0')).toHaveLength(1);
    expect(() => lireChemin('C1 2 3 4 5 6')).toThrow(/commande « C »/);
    expect(() => lireChemin('10 10')).toThrow(/commande manquante/);
  });

  it('refuse currentColor : la mesure ne peint que des couleurs explicites', () => {
    expect(couleurCss('#f97c22')).toEqual([249, 124, 34]);
    expect(() => couleurCss('currentColor')).toThrow(/currentColor/);
    expect(() => couleurCss('#fff')).toThrow(/couleur/);
  });

  it("refuse une géométrie dont le dégradé n'est pas déclaré", () => {
    const geometrie = copieDeLaGeometrie();
    delete geometrie.gradients.matiere;
    const [depart] = segmentsDeLaLettre(geometrie);

    expect(() => couleurSous(geometrie, 'marque', depart[0] + 2, depart[1] + 2, 'lettre')).toThrow(
      /dégradé « matiere »/
    );
  });
});

describe('le garde lit son sujet : l’artefact servi, pas une déclaration', () => {
  it('le décodeur retrouve les pixels du manifeste — même artefact que la famille vérifie', () => {
    const manifeste = JSON.parse(
      fs.readFileSync(path.join(FRONTEND_DIR, 'public', 'icons', 'icons-assets.manifest.json'), 'utf8')
    );
    const sortie = manifeste.outputs.find((item) => item.file === 'icon-192x192.png');
    const decode = decodePng(path.join(FRONTEND_DIR, 'public', 'icons', 'icon-192x192.png'));

    expect({ width: decode.width, height: decode.height }).toEqual({
      width: sortie.width,
      height: sortie.height,
    });
    expect(createHash('sha256').update(decode.pixels).digest('hex')).toBe(sortie.pixel_sha256);
  });

  it("refuse de décoder ce qui n'est pas un PNG, en le nommant", () => {
    expect(() => decodePng('pas-un-png.png', Buffer.from('<?xml version="1.0"?>'))).toThrow(
      /pas-un-png\.png : ce n'est pas un PNG/
    );
  });

  it("sort en 1 et nomme le contraste quand la géométrie a perdu sa lisibilité — sur une arborescence fixture", () => {
    // Le verdict du garde lui-même, sur une arborescence qui n'est pas la sienne :
    // une géométrie au fond CLAIR (le défaut d'origine) et les deux PNG réels,
    // pour que la seule faute soit celle qu'on veut voir nommée.
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'poincon-'));
    try {
      const geometrie = copieDeLaGeometrie();
      geometrie.gradients.matiere.arrets = [
        [0, '#ffd9b0'],
        [1, '#e0a070'],
      ];
      fs.mkdirSync(path.join(racine, 'src', 'config'), { recursive: true });
      fs.mkdirSync(path.join(racine, 'public', 'icons'), { recursive: true });
      fs.writeFileSync(
        path.join(racine, 'src', 'config', 'marque-kojo.json'),
        JSON.stringify(geometrie),
        'utf8'
      );
      for (const reference of ['icon-192x192.png', 'icon-512x512.png']) {
        fs.copyFileSync(
          path.join(FRONTEND_DIR, 'public', 'icons', reference),
          path.join(racine, 'public', 'icons', reference)
        );
      }

      const resultat = runMarqueKojoCheck({ racine, journal: journalMuet });
      expect(resultat.ok).toBe(false);
      expect(resultat.errors.some((message) => /contraste de la lettre/.test(message))).toBe(true);
      expect(resultat.errors.some((message) => /seuil est 3:1/.test(message))).toBe(true);
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });

  it("refuse de juger quand il n'a lu AUCUNE icône : un vert sans lecture ne prouverait rien", () => {
    // Le plancher de lecture : la géométrie est saine, mais les PNG manquent.
    // « Rien hors du disque » n'aurait alors aucun sujet, et un garde muet
    // passerait pour un garde satisfait.
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'poincon-vide-'));
    try {
      fs.mkdirSync(path.join(racine, 'src', 'config'), { recursive: true });
      fs.writeFileSync(
        path.join(racine, 'src', 'config', 'marque-kojo.json'),
        JSON.stringify(GEOMETRIE),
        'utf8'
      );

      const resultat = runMarqueKojoCheck({ racine, journal: journalMuet });
      expect(resultat.ok).toBe(false);
      expect(resultat.errors.some((message) => /un vert sans lecture ne prouverait rien/.test(message))).toBe(
        true
      );
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });

  it("sort en 0 sur l'arbre réel, et sa sortie nomme ses trois mesures (pas un vert muet)", () => {
    const sortie = execFileSync('node', ['scripts/check-marque-kojo.js'], {
      cwd: FRONTEND_DIR,
      encoding: 'utf8',
    });

    expect(sortie).toMatch(/contraste de la lettre {3}3\.\d+:1 au pire point/);
    expect(sortie).toMatch(/cercles dans le disque {3}bord le plus large 23\.15/);
    expect(sortie).toMatch(/192 px {18}\d+ pixel\(s\) peint\(s\), 0 hors du disque/);
    expect(sortie).toMatch(/512 px {18}\d+ pixel\(s\) peint\(s\), 0 hors du disque/);
    expect(sortie).toMatch(/aucune icône claire ne peint hors de sa portée/);
  });
});
