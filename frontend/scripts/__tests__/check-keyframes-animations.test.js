/**
 * PREUVE D'ÉCHEC REJOUÉE — une `@keyframes` doit être jouée, et une animation
 * jouée doit être déclarée.
 *
 * Le garde (`scripts/check-keyframes-animations.js`) refuse trois choses, et
 * chacune a son cas : une `@keyframes` DÉCLARÉE ET JAMAIS JOUÉE (poids mort),
 * une animation JOUÉE ET DÉCLARÉE NULLE PART (le cas silencieux : aucun
 * navigateur ne rougit), et un fichier ILLISIBLE (qu'on ne peut pas déclarer
 * propre).
 *
 * Le cœur de cette preuve est le DÉCODEUR, parce que c'est lui qui a empêché la
 * règle d'exister : la sonde naïve rendait 3 faux positifs sur 7 noms. Les cas
 * ci-dessous les nomment un par un — `animationFillMode`, `animationDelay`,
 * `animation-duration`/`animation-iteration-count`, un identifiant de variable —
 * et un cas vérifie que la PROSE d'un commentaire n'est jamais jugée.
 *
 * Le CLI exige un `src/` d'au moins 120 fichiers, au moins 1 déclaration et au
 * moins 1 usage : les cas du CLI écrivent donc une arborescence temporaire
 * COMPLÈTE (un couple déclaré/joué, du remplissage, puis le cas), jamais le vrai
 * `src/`.
 *
 * Et le dernier bloc juge la VRAIE source : le sujet est là, toujours, sans
 * build — deux déclarations et deux usages, tous deux dans du JavaScript.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CE_QUE_CE_GARDE_VOIT,
  analyserSources,
  estNomDanimation,
  lireCss,
  lireJs,
  nomsDeValeurAnimation,
  ressembleACss,
} from '../keyframes-animations.js';
import { fichiersSources } from '../check-keyframes-animations.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const GARDE = path.join(ICI, '..', 'check-keyframes-animations.js');
const RACINE_FRONTEND = path.join(ICI, '..', '..');
const MIN_FICHIERS = 120; // le plancher du garde, recopié pour dimensionner la fixture

/** Le couple qui satisfait les planchers de LECTURE : une déclaration jouée. */
const COUPLE = { chemin: 'src/styles/couple.css', texte: '@keyframes coucou { from { opacity: 0 } }\n.x { animation: coucou 1s linear; }\n' };

const temporaires = [];
afterEach(() => {
  for (const dossier of temporaires.splice(0)) fs.rmSync(dossier, { recursive: true, force: true });
});

/** Écrit une arborescence `src/` COMPLÈTE : le couple, remplissage + cas. */
const ecrireFixture = (extra = []) => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-keyframes-'));
  temporaires.push(racine);
  const ecrits = new Set();
  const ecrire = (relatif, texte) => {
    const complet = path.join(racine, relatif);
    fs.mkdirSync(path.dirname(complet), { recursive: true });
    fs.writeFileSync(complet, texte);
    ecrits.add(relatif);
  };
  ecrire(COUPLE.chemin, COUPLE.texte);
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

describe('@keyframes — le décodeur de valeurs, pur', () => {
  it('extrait le NOM du raccourci, jamais la durée ni la courbe', () => {
    expect(nomsDeValeurAnimation('slideInRight 0.3s ease-out')).toEqual(['slideInRight']);
    expect(nomsDeValeurAnimation('0.3s ease-out slideUp')).toEqual(['slideUp']);
    expect(nomsDeValeurAnimation('pulse 2s cubic-bezier(0.4,0,0.6,1) infinite')).toEqual(['pulse']);
    // Une liste de `animation-name`, plusieurs animations séparées par des virgules.
    expect(nomsDeValeurAnimation('a 1s, b 2s')).toEqual(['a', 'b']);
  });

  it('ne nomme RIEN quand le raccourci n’a que des mots-clés, des temps et des nombres', () => {
    expect(nomsDeValeurAnimation('1s linear 2 alternate both running infinite')).toEqual([]);
    expect(nomsDeValeurAnimation('none')).toEqual([]);
    expect(nomsDeValeurAnimation('var(--x) 1s')).toEqual([]);
    expect(estNomDanimation('ease-in-out')).toBe(false);
    expect(estNomDanimation('0.3s')).toBe(false);
    expect(estNomDanimation('3')).toBe(false);
    expect(estNomDanimation('slideUp')).toBe(true);
  });
});

describe('@keyframes — le lecteur CSS, pur', () => {
  it('lit une déclaration, une référence, avec leur ligne', () => {
    const css = '@keyframes fadeIn { from { opacity: 0 } }\ndiv { animation: fadeIn 1s ease-in; }\n';
    const lu = lireCss(css);
    expect(lu.declarations).toEqual([{ nom: 'fadeIn', ligne: 1 }]);
    expect(lu.references).toEqual([{ nom: 'fadeIn', ligne: 2 }]);
  });

  it('n’est PAS trompé par `animation-duration` ni `animation-iteration-count`', () => {
    // La requête de mouvement réduit des packs : deux propriétés qui COMMENCENT
    // par `animation` sans être un usage. Une sonde par préfixe les prendrait
    // pour des noms.
    const css = '@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; } }\n';
    expect(lireCss(css).references).toEqual([]);
  });

  it('ne juge pas un `@keyframes` cité dans un COMMENTAIRE', () => {
    const css = '/* on a retiré @keyframes fadeIn, qui n’était jouée nulle part */\ndiv { color: red; }\n';
    expect(lireCss(css).declarations).toEqual([]);
  });
});

describe('@keyframes — le décodeur CONSCIENT DU JAVASCRIPT', () => {
  it('lit un `@keyframes` écrit dans un littéral de gabarit, et l’usage d’un objet de style', () => {
    const code = [
      'const feuille = <style>{`',
      '@keyframes slideInRight { from { opacity: 0 } }',
      '`}</style>;',
      "const a = <div style={{ animation: 'slideInRight 0.3s ease-out' }} />;",
    ].join('\n');
    const lu = lireJs(code);
    expect(lu.declarations).toEqual([{ nom: 'slideInRight', ligne: 2 }]);
    expect(lu.references).toEqual([{ nom: 'slideInRight', ligne: 4 }]);
  });

  it('lit un usage dans un `cssText` (fragment SANS accolades) et une déclaration dans un `textContent`', () => {
    const code = [
      'notification.style.cssText = `',
      '  position: fixed;',
      '  animation: slideUp 0.3s ease-out;',
      '`;',
      'const style = document.createElement("style");',
      'style.textContent = `',
      '@keyframes slideUp { from { opacity: 0 } }',
      '`;',
    ].join('\n');
    const lu = lireJs(code);
    expect(lu.references).toEqual([{ nom: 'slideUp', ligne: 3 }]);
    expect(lu.declarations).toEqual([{ nom: 'slideUp', ligne: 7 }]);
  });

  it('N’EST PAS trompé par `animationFillMode`, `animationDelay`, ni un identifiant de variable', () => {
    // Les trois faux positifs historiques, ensemble : une valeur de `animation`
    // voisine de ses compagnons, et une chaîne qui n’est pas un style.
    const code = [
      "const toast = <div style={{ animation: 'slideInRight 0.3s ease-out', animationFillMode: 'both', animationDelay: '0.2s' }} />;",
      "const nom = 'slideInRight';",
      "const el = document.createElement('div'); el.style.animationDuration = '1s';",
    ].join('\n');
    const lu = lireJs(code);
    expect(lu.references).toEqual([{ nom: 'slideInRight', ligne: 1 }]);
  });

  it('la porte de forme écarte la prose : seul un vrai fragment CSS est confié à postcss', () => {
    expect(ressembleACss('@keyframes x { from { opacity: 0 } }')).toBe(true);
    expect(ressembleACss('animation: slideUp 0.3s ease-out;')).toBe(true);
    expect(ressembleACss('animation: un effet')).toBe(false); // prose, sans terminateur
    expect(ressembleACss('slideInRight 0.3s ease-out')).toBe(false);
    const lu = lireJs("const phrase = 'animation : un effet, sans point-virgule';\n");
    expect(lu.references).toEqual([]);
  });

  it('un fichier JavaScript illisible est compté, jamais déclaré propre', () => {
    expect(lireJs('const = = = "(";').illisible).toBe(true);
    const rapport = analyserSources({ fichiers: [{ chemin: 'src/casse.js', texte: 'const = = = "(";\n' }] });
    expect(rapport.illisibles).toEqual(['src/casse.js']);
  });
});

describe('@keyframes — les deux verdicts, à la règle pure', () => {
  it('refuse une @keyframes déclarée et jamais jouée', () => {
    const rapport = analyserSources({ fichiers: [{ chemin: 'src/a.css', texte: '@keyframes fadeIn { from { opacity: 0 } }\n' }] });
    expect(rapport.jamaisJouees).toEqual([{ chemin: 'src/a.css', ligne: 1, nom: 'fadeIn' }]);
    expect(rapport.jamaisDeclarees).toEqual([]);
  });

  it('refuse une animation jouée et déclarée nulle part', () => {
    const rapport = analyserSources({ fichiers: [{ chemin: 'src/a.css', texte: 'div { animation: fantome 1s linear; }\n' }] });
    expect(rapport.jamaisDeclarees).toEqual([{ chemin: 'src/a.css', ligne: 1, nom: 'fantome' }]);
    expect(rapport.jamaisJouees).toEqual([]);
  });

  it('ne refuse NI l’un NI l’autre quand la déclaration et l’usage se répondent', () => {
    const rapport = analyserSources({ fichiers: [{ chemin: 'src/a.css', texte: COUPLE.texte }] });
    expect([...rapport.jamaisJouees, ...rapport.jamaisDeclarees]).toEqual([]);
  });
});

describe('@keyframes — la forme de la liste et les angles morts', () => {
  it('les angles morts sont PUBLIÉS, pas implicites', () => {
    expect(CE_QUE_CE_GARDE_VOIT.voit.length).toBeGreaterThanOrEqual(3);
    expect(CE_QUE_CE_GARDE_VOIT.nePeutPasVoir.join(' ')).toMatch(/tailwind\.config/);
    expect(CE_QUE_CE_GARDE_VOIT.nePeutPasVoir.join(' ')).toMatch(/littéraux/);
  });
});

describe('@keyframes — la VRAIE source (le sujet est toujours là, sans build)', () => {
  it('aucune @keyframes orpheline, aucune animation pendante, aucun fichier illisible dans src/', () => {
    const rapport = analyserSources({ fichiers: fichiersSources(RACINE_FRONTEND) });
    expect(rapport.lus).toBeGreaterThanOrEqual(MIN_FICHIERS);
    // Le sujet EXISTE et est LU : deux déclarations et deux usages, tous deux
    // dans du JavaScript — sans le décodeur conscient du JS, ce vert serait vide.
    expect(rapport.declarations.length).toBeGreaterThanOrEqual(1);
    expect(rapport.references.length).toBeGreaterThanOrEqual(1);
    expect(rapport.jamaisJouees).toEqual([]);
    expect(rapport.jamaisDeclarees).toEqual([]);
    expect(rapport.illisibles).toEqual([]);
  });
});

describe('@keyframes — le garde en sous-processus', () => {
  it('sort 0 sur une fixture propre (le vert n’est pas un refus de principe)', () => {
    const rapport = lancerLeGarde(ecrireFixture());
    expect(rapport.code).toBe(0);
    expect(rapport.stdout).toMatch(/@keyframes jouées et animations déclarées/);
  });

  it('sort 1 en nommant une @keyframes déclarée et jamais jouée', () => {
    const rapport = lancerLeGarde(
      ecrireFixture([{ chemin: 'src/styles/orpheline.css', texte: '@keyframes fantomeDuCiel { from { opacity: 0 } }\n' }])
    );
    expect(rapport.code).toBe(1);
    expect(rapport.stderr).toContain('src/styles/orpheline.css:1');
    expect(rapport.stderr).toMatch(/JAMAIS JOUÉE/);
  });

  it('sort 1 en nommant une animation jouée et déclarée nulle part', () => {
    const rapport = lancerLeGarde(
      ecrireFixture([{ chemin: 'src/styles/pendante.css', texte: '.x { animation: introuvable 1s linear; }\n' }])
    );
    expect(rapport.code).toBe(1);
    expect(rapport.stderr).toContain('src/styles/pendante.css:1');
    expect(rapport.stderr).toMatch(/NULLE PART/);
  });

  it('sort 1 en nommant un fichier ILLISIBLE', () => {
    const rapport = lancerLeGarde(
      ecrireFixture([{ chemin: 'src/styles/casse.js', texte: 'const = = = "(";\n' }])
    );
    expect(rapport.code).toBe(1);
    expect(rapport.stderr).toContain('src/styles/casse.js');
    expect(rapport.stderr).toMatch(/ILLISIBLE/);
  });

  it('refuse de juger quand il n’a pas lu son sujet (trop peu de fichiers)', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-keyframes-vide-'));
    temporaires.push(racine);
    fs.mkdirSync(path.join(racine, 'src'));
    const rapport = lancerLeGarde(racine);
    expect(rapport.code).toBe(1);
    expect(rapport.stderr).toMatch(/insuffisants|introuvable|refus de juger/);
  });

  it('refuse de juger quand le décodeur n’a rien lu (plancher de lecture)', () => {
    // 120 fichiers de remplissage, aucune animation : le balayage a lu son
    // corpus mais le DÉCODEUR n'a rien trouvé — un vert serait un faux vert.
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-keyframes-muet-'));
    temporaires.push(racine);
    for (let i = 0; i < MIN_FICHIERS; i += 1) {
      const complet = path.join(racine, 'src', 'remplissage', `f-${String(i).padStart(3, '0')}.js`);
      fs.mkdirSync(path.dirname(complet), { recursive: true });
      fs.writeFileSync(complet, `export const n = ${i};\n`);
    }
    const rapport = lancerLeGarde(racine);
    expect(rapport.code).toBe(1);
    expect(rapport.stderr).toMatch(/Lecture vide|faux vert/);
  });
});
