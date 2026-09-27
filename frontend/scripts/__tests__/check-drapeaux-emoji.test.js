/**
 * PREUVE D'ÉCHEC REJOUÉE — un drapeau est un DESSIN, jamais un caractère.
 *
 * Le garde (`scripts/check-drapeaux-emoji.js`) refuse trois choses, et chacune a
 * son cas : un EMOJI DE DRAPEAU dans le code, un CHAMP `flag` dans les modules de
 * données, et un fichier ILLISIBLE (qu'on ne peut pas déclarer propre).
 *
 * Deux frontières sont éprouvées aussi, parce qu'une règle sans borne refuserait
 * sa propre documentation : un emoji dans un COMMENTAIRE n'est PAS refusé (le
 * dépôt cite les emoji qu'il raconte — `flags.js`, `FlagIcon.js`), et un champ
 * `flag` hors des modules de données n'est pas condamné (`flags.js` est le
 * registre des dessins, `backendUrl.js` a un booléen local nommé `flag`).
 *
 * Le CLI exige un `src/` d'au moins 120 fichiers et la présence des cinq modules
 * de données : les cas du CLI écrivent donc une arborescence temporaire COMPLÈTE
 * (les cinq modules, du remplissage, puis le cas), jamais le vrai `src/`.
 *
 * Et le dernier bloc juge la VRAIE source : le sujet est là, toujours, sans
 * build.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CE_QUE_CE_GARDE_VOIT,
  MODULES_DONNEES,
  analyserSources,
  champsFlagDe,
  emojiDrapeauDe,
  masquerPlages,
  plagesDeCommentaires,
} from '../drapeaux-emoji.js';
import { fichiersSources } from '../check-drapeaux-emoji.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const GARDE = path.join(ICI, '..', 'check-drapeaux-emoji.js');
const RACINE_FRONTEND = path.join(ICI, '..', '..');
const MIN_FICHIERS = 120; // le plancher du garde, recopié pour dimensionner la fixture

const DRAPEAU_MALI = '\u{1F1F2}\u{1F1F1}'; // 🇲🇱
const DRAPEAU_BLANC = '\u{1F3F3}\u{FE0F}'; // 🏳️

const temporaires = [];
afterEach(() => {
  for (const dossier of temporaires.splice(0)) fs.rmSync(dossier, { recursive: true, force: true });
});

/** Écrit une arborescence `src/` COMPLÈTE : 5 modules de données + remplissage + cas. */
const ecrireFixture = (extra = []) => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-drapeaux-'));
  temporaires.push(racine);
  // Les chemins sont COMPTÉS dans un ensemble : un `extra` qui réécrit un module
  // déclaré ne crée pas un fichier de plus, et la fixture doit en compter 120.
  const ecrits = new Set();
  const ecrire = (relatif, texte) => {
    const complet = path.join(racine, relatif);
    fs.mkdirSync(path.dirname(complet), { recursive: true });
    fs.writeFileSync(complet, texte);
    ecrits.add(relatif);
  };
  for (const module of MODULES_DONNEES) ecrire(module.chemin, 'export const rien = 1;\n');
  for (const fichier of extra) ecrire(fichier.chemin, fichier.texte);
  for (let i = 0; ecrits.size < MIN_FICHIERS; i += 1) {
    ecrire(`src/remplissage/f-${String(i).padStart(3, '0')}.js`, `export const n = ${i};\n`);
  }
  return racine;
};

/** Lance le garde en sous-processus : code de sortie + sortie des deux flux. */
const lancerLeGarde = (racine) => {
  try {
    const stdout = execFileSync(process.execPath, [GARDE, '--racine', racine], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (erreur) {
    return { code: erreur.status, stdout: erreur.stdout || '', stderr: erreur.stderr || '' };
  }
};

describe('drapeaux — la règle, pure', () => {
  it('refuse un emoji de drapeau dans le CODE, et dit la ligne', () => {
    const code = `const a = 1;\nconst drapeau = "${DRAPEAU_MALI}";\n`;
    expect(emojiDrapeauDe(code).details).toEqual([{ ligne: 2 }]);
    // Le drapeau blanc aussi, et un indicateur régional SEUL suffit.
    expect(emojiDrapeauDe(`x = "${DRAPEAU_BLANC}";`).details).toEqual([{ ligne: 1 }]);
    expect(emojiDrapeauDe('x = "\u{1F1F2}";').details).toEqual([{ ligne: 1 }]);
  });

  it('ne refuse PAS un emoji de drapeau dans un COMMENTAIRE — le dépôt cite ce qu’il raconte', () => {
    const ligne = `// on publiait encore country.flag en emoji (${DRAPEAU_MALI} ${DRAPEAU_BLANC})\nconst a = 1;\n`;
    expect(emojiDrapeauDe(ligne).details).toEqual([]);
    const bloc = `/* le retrait de ${DRAPEAU_MALI} a coûté 58 ms */\nconst b = 2;\n`;
    expect(emojiDrapeauDe(bloc).details).toEqual([]);
    // …et le masquage ne casse pas une URL en chaîne (un `//` qui n'est pas un commentaire).
    expect(emojiDrapeauDe(`const u = "https://exemple.test/x";\nconst c = "${DRAPEAU_MALI}";\n`).details).toEqual([
      { ligne: 2 },
    ]);
    // Le masquage remplace la plage par des ESPACES : la longueur — donc la
    // ligne et la colonne — reste juste, seul le texte du commentaire disparaît.
    const avecCommentaire = 'const a = 1; /* b */ const c = 2;';
    const masque = masquerPlages(avecCommentaire, plagesDeCommentaires(avecCommentaire));
    expect(masque.length).toBe(avecCommentaire.length);
    expect(masque).not.toContain('b');
    expect(masque).toContain('const a = 1;');
    expect(masque).toContain('const c = 2;');
  });

  it('refuse un emoji de drapeau dans un DICTIONNAIRE JSON (sans masquage, il n’y a pas de commentaire)', () => {
    expect(emojiDrapeauDe(`{"pays": "${DRAPEAU_MALI}"}`, '.json').details).toEqual([{ ligne: 1 }]);
  });

  it('refuse un champ `flag` dans les modules de données, quelle que soit sa valeur', () => {
    const code = `export const COUNTRIES = [{ code: 'mali', flag: '${DRAPEAU_MALI}' }];\n`;
    expect(champsFlagDe(code).details).toEqual([{ ligne: 1 }]);
    // La valeur n'a pas d'importance : c'est le CHAMP qui est mort.
    expect(champsFlagDe("export const c = { flag: 'x' };\n").details).toEqual([{ ligne: 1 }]);
    // Un attribut JSX nommé `flag` aussi.
    expect(champsFlagDe('const e = <X flag="x" />;\n').details).toEqual([{ ligne: 1 }]);
  });

  it('ne condamne PAS un homonyme : `flags`, `flagSize`, une valeur "flag"', () => {
    expect(champsFlagDe("const o = { flags: 1, flagSize: 'text-sm' };\n").details).toEqual([]);
    expect(champsFlagDe('const s = "flag";\n').details).toEqual([]);
    expect(champsFlagDe("const t = { kind: 'flag' };\n").details).toEqual([]);
  });

  it('un fichier ILLISIBLE est compté, jamais déclaré propre', () => {
    expect(emojiDrapeauDe('const = = = "(";\n').illisible).toBe(true);
    expect(champsFlagDe('const = = = "(";\n').illisible).toBe(true);
    const rapport = analyserSources({ fichiers: [{ chemin: 'src/casse.js', texte: 'const = = = "(";\n' }] });
    expect(rapport.illisibles).toEqual(['src/casse.js']);
  });

  it('le champ `flag` n’est jugé que dans les modules DÉCLARÉS — la borne est explicite', () => {
    const fichiers = [
      { chemin: 'src/config/countries.js', texte: "export const c = { flag: 'x' };\n" },
      { chemin: 'src/components/Autre.js', texte: "export const o = { flag: 'x' };\n" },
    ];
    const rapport = analyserSources({ fichiers });
    expect(rapport.champsFlag).toEqual([{ chemin: 'src/config/countries.js', ligne: 1 }]);
  });
});

describe('drapeaux — la forme de la liste et les angles morts (portable)', () => {
  it('les modules de données déclarés existent vraiment dans le dépôt, chacun justifié', () => {
    expect(MODULES_DONNEES.length).toBeGreaterThanOrEqual(4);
    for (const module of MODULES_DONNEES) {
      expect(fs.existsSync(path.join(RACINE_FRONTEND, module.chemin)), module.chemin).toBe(true);
      expect(String(module.pourquoi || '').trim().length, module.chemin).toBeGreaterThan(20);
    }
    // …et les deux référentiels jumeaux (pays ET langue) en font partie : le
    // champ a vécu dans les deux.
    expect(MODULES_DONNEES.map((m) => m.chemin)).toEqual(
      expect.arrayContaining(['src/config/countries.js', 'src/config/languages.js'])
    );
  });

  it('les angles morts sont PUBLIÉS, pas implicites', () => {
    expect(CE_QUE_CE_GARDE_VOIT.voit.length).toBeGreaterThanOrEqual(3);
    expect(CE_QUE_CE_GARDE_VOIT.nePeutPasVoir.join(' ')).toMatch(/ASSEMBLÉ/);
    expect(CE_QUE_CE_GARDE_VOIT.nePeutPasVoir.join(' ')).toMatch(/flags-drapeaux/);
  });
});

describe('drapeaux — la VRAIE source (le sujet est toujours là, sans build)', () => {
  it('aucun emoji de drapeau, aucun champ `flag`, aucun fichier illisible dans src/', () => {
    const rapport = analyserSources({ fichiers: fichiersSources(RACINE_FRONTEND) });
    expect(rapport.lus).toBeGreaterThanOrEqual(MIN_FICHIERS);
    expect(rapport.emoji).toEqual([]);
    expect(rapport.champsFlag).toEqual([]);
    expect(rapport.illisibles).toEqual([]);
  });
});

describe('drapeaux — le garde en sous-processus', () => {
  it('sort 0 sur une fixture propre (le vert n’est pas un refus de principe)', () => {
    const rapport = lancerLeGarde(ecrireFixture());
    expect(rapport.code).toBe(0);
    expect(rapport.stdout).toMatch(/Aucun emoji de drapeau/);
  });

  it('sort 1 en NOMMANT le fichier et la ligne d’un emoji de drapeau', () => {
    const rapport = lancerLeGarde(
      ecrireFixture([{ chemin: 'src/config/donnees-pays.js', texte: `export const d = "${DRAPEAU_MALI}";\n` }])
    );
    expect(rapport.code).toBe(1);
    expect(rapport.stderr).toContain('src/config/donnees-pays.js:1');
    expect(rapport.stderr).toMatch(/EMOJI DE DRAPEAU/);
  });

  it('sort 1 en nommant un champ `flag` REVENU dans un module de données', () => {
    const rapport = lancerLeGarde(
      ecrireFixture([
        { chemin: 'src/services/geolocation-database.js', texte: "export const FALLBACK = { flag: 'x' };\n" },
      ])
    );
    expect(rapport.code).toBe(1);
    expect(rapport.stderr).toContain('src/services/geolocation-database.js:1');
    expect(rapport.stderr).toMatch(/champ\(s\) `flag`/);
  });

  it('refuse de juger quand il n’a pas lu son sujet (trop peu de fichiers)', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-drapeaux-vide-'));
    temporaires.push(racine);
    const rapport = lancerLeGarde(racine);
    expect(rapport.code).toBe(1);
    expect(rapport.stderr).toMatch(/insuffisants|introuvable|refus de juger/);
  });
});
