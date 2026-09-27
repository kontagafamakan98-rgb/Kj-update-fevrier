/**
 * PREUVE D'ÉCHEC REJOUÉE — le levier différé du formulaire de /register.
 *
 * Le garde (`scripts/check-formulaire-differe.js`) lit trois fichiers et refuse :
 *   • une classe `bloc-differe-*` posée par UN SEUL des deux canaux — React
 *     (src/pages/Register.js) ou la coquille (shells-routes.js). La parité
 *     coquille↔React n'est mesurée QUE sur les routes déclarées, donc une
 *     divergence introduite ici ne serait vue nulle part avant la sonde e2e ;
 *   • une classe déclarée dans la feuille sans constante de hauteur de contenu :
 *     le bloc retomberait sur la taille de repli (0) et le document
 *     s'effondrerait — la sonde du document le mesure, ce garde le refuse à la
 *     source ;
 *   • une constante qui n'est plus une taille de contenu (« auto <nombre>px ») :
 *     une virgule décimale française (`539,8`) ferait ignorer la déclaration en
 *     silence ;
 *   • une classe ajoutée à la feuille sans entrer dans la LISTE — le garde ne
 *     saurait pas ce qui doit rester en parité.
 *
 * Les refus sont rejoués par MUTATION DE CHAÎNE (jamais par réécriture de
 * fichier) : la règle est une fonction pure, on lui passe le texte cassé. Le
 * dernier cas prouve que les VRAIES sources ne rougissent pas — sans lui, un
 * garde rouge au départ ferait passer toutes les mutations pour des succès.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BLOCS_DIFFERES,
  CANAUX,
  FEUILLE,
  analyserFormulaireDiffere,
  classesCitees,
  constantesDeLaFeuille,
} from '../formulaire-differe.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(ICI, '..', '..');
const lire = (chemin) => fs.readFileSync(path.join(FRONTEND_DIR, chemin), 'utf8');

const FEUILLE_REELLE = lire(FEUILLE);
const CANAUX_REELS = CANAUX.map((canal) => ({ nom: canal.nom, texte: lire(canal.chemin) }));

/** Analyse les vraies sources, avec une seule d'elles remplacée. */
const avecFeuille = (feuille) => analyserFormulaireDiffere({ feuille, canaux: CANAUX_REELS });
const avecCanal = (index, texte) =>
  analyserFormulaireDiffere({
    feuille: FEUILLE_REELLE,
    canaux: CANAUX_REELS.map((canal, i) => (i === index ? { ...canal, texte } : canal)),
  });

describe('levier différé de /register — la règle au repos', () => {
  it('les VRAIES sources ne rougissent pas (contrôle positif du garde)', () => {
    expect(analyserFormulaireDiffere({ feuille: FEUILLE_REELLE, canaux: CANAUX_REELS })).toEqual([]);
  });

  it('les deux canaux posent EXACTEMENT les quatre blocs listés, écrits en clair', () => {
    // Ce cas verrouille l'angle mort de la règle : elle lit des chaînes, donc
    // une classe composée dynamiquement lui échapperait. Les quatre blocs sont
    // écrits en clair dans les deux canaux, et cette assertion le fige.
    for (const canal of CANAUX_REELS) {
      const citees = classesCitees(canal.texte).sort();
      expect(citees, canal.nom).toEqual([...BLOCS_DIFFERES].sort());
    }
  });

  it('chaque bloc a une constante de contenu, et le photo en a deux (mobile + desktop)', () => {
    const constantes = constantesDeLaFeuille(FEUILLE_REELLE);
    for (const classe of BLOCS_DIFFERES) {
      expect(constantes.get(classe), classe).toBeTruthy();
      expect(constantes.get(classe).length, classe).toBeGreaterThanOrEqual(1);
    }
    // Le bloc photo est le seul dont la hauteur de contenu change au-delà de
    // 768 px : c'est le SEUL à porter deux déclarations. Le vérifier ici évite
    // qu'une constante desktop recopiée par erreur sur un autre bloc passe.
    const avecDeux = [...constantes].filter(([, valeurs]) => valeurs.length === 2).map(([classe]) => classe);
    expect(avecDeux).toEqual(['bloc-differe-photo']);
  });
});

describe('levier différé de /register — preuve d’échec rejouée', () => {
  it('retirer la classe d’UN SEUL canal est refusé, en nommant le canal et la classe', () => {
    for (const [index, canal] of CANAUX_REELS.entries()) {
      const casse = canal.texte.replace(/bloc-differe-legal/g, 'bloc-differe-legal-renomme');
      const problemes = avecCanal(index, casse);
      expect(problemes.join('\n')).toContain('bloc-differe-legal');
      expect(problemes.join('\n')).toContain(canal.nom);
      expect(problemes.join('\n')).toMatch(/les DEUX canaux/);
    }
  });

  it('une constante retirée de la feuille est refusée, en nommant le bloc', () => {
    const casse = FEUILLE_REELLE.replace(
      '.bloc-differe-legal { contain-intrinsic-size: auto 221px; }',
      '.bloc-differe-legal { color: red; }'
    );
    expect(casse).not.toBe(FEUILLE_REELLE); // la mutation a bien mordu
    const problemes = avecFeuille(casse);
    expect(problemes.join('\n')).toMatch(/bloc-differe-legal/);
    expect(problemes.join('\n')).toMatch(/contain-intrinsic-size/);
    expect(problemes.join('\n')).toMatch(/s'effondrerait/);
  });

  it('une constante qui n’est plus « auto <nombre>px » est refusée (virgule décimale)', () => {
    // Le piège mesuré : une virgule au lieu du point rend la déclaration
    // invalide, la constante disparaît et le bloc s'effondre SANS message.
    const casse = FEUILLE_REELLE.replace('auto 539.8px', 'auto 539,8px');
    expect(casse).not.toBe(FEUILLE_REELLE);
    const problemes = avecFeuille(casse);
    expect(problemes.join('\n')).toMatch(/bloc-differe-photo/);
    expect(problemes.join('\n')).toMatch(/n'est pas une taille de contenu/);
  });

  it('une classe ajoutée à la feuille sans entrer dans la LISTE est refusée', () => {
    const casse = FEUILLE_REELLE.replace(
      '.bloc-differe-lien { contain-intrinsic-size: auto 24px; }',
      '.bloc-differe-lien { contain-intrinsic-size: auto 24px; }\n.bloc-differe-extra { contain-intrinsic-size: auto 12px; }'
    );
    const problemes = avecFeuille(casse);
    expect(problemes.join('\n')).toMatch(/bloc-differe-extra/);
    expect(problemes.join('\n')).toMatch(/BLOCS_DIFFERES/);
  });

  it('un canal qui pose une classe inconnue de la feuille est refusé', () => {
    const casse = CANAUX_REELS[0].texte + '\n<div className="bloc-differe-inconnu" />';
    const problemes = avecCanal(0, casse);
    expect(problemes.join('\n')).toMatch(/bloc-differe-inconnu/);
    expect(problemes.join('\n')).toMatch(/ne le connaît pas/);
  });

  it('une feuille sans « content-visibility: auto » est refusée', () => {
    const casse = FEUILLE_REELLE.replace(/content-visibility:\s*auto;/g, 'content-visibility: visible;');
    expect(casse).not.toBe(FEUILLE_REELLE);
    const problemes = avecFeuille(casse);
    expect(problemes.join('\n')).toMatch(/content-visibility: auto/);
  });

  it('le nom nu « bloc-differe » (motif de la sonde de mesure) n’est pas une classe', () => {
    // Le commentaire de la feuille et le harnais de mesure citent
    // `class*="bloc-differe"` : ce motif ne doit pas être pris pour un bloc
    // différé, sinon le garde exigerait une constante pour un fantôme.
    expect(classesCitees('[class*="bloc-differe"] { color: red; }')).toEqual([]);
    expect(classesCitees('.bloc-differe-legal { color: red; }')).toEqual(['bloc-differe-legal']);
  });
});
