/**
 * PREUVE D'ÉCHEC REJOUÉE — les origines tierces des fichiers LIVRÉS.
 *
 * `scripts/check-origines-bundles.js` refuse trois choses, et chacune a son cas :
 *   • une origine TIERCE absente du classement (le refus principal) ;
 *   • une entrée PÉRIMÉE — un classement qu'aucun fichier livré ne porte plus ;
 *   • un MOTIF VIDE — une entrée sans raison écrite n'est pas un classement.
 *
 * Le garde lit un ARBRE DE BUILD (`build/assets/`) : les cas du CLI écrivent donc
 * une arborescence temporaire, jamais le vrai `build/` — le job Vitest tourne
 * AVANT le build dans la CI, donc un test qui lirait `build/` serait vert ici et
 * rouge là-bas pour la mauvaise raison. Ce qui se vérifie sans build est vérifié
 * à part : la FORME de la table (portable) et la règle, pure.
 *
 * Et le dernier bloc prouve que ce garde voit ce que le garde de coquille ne peut
 * PAS voir : une URL assemblée en clair dans le code n'existe dans aucun HTML.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CE_QUE_CE_GARDE_VOIT,
  CLASSEMENT_ORIGINES,
  SORTES,
  analyserOriginesLivrees,
  origineDeUrl,
  originesDesFichiers,
} from '../origines-bundles.js';
import { ceQueLeGardeStatiqueVoit, estTiers } from '../tiers-avant-interaction.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const GARDE = path.join(ICI, '..', 'check-origines-bundles.js');

const temporaires = [];
afterEach(() => {
  for (const dossier of temporaires.splice(0)) {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

/**
 * Écrit une arborescence de build temporaire.
 * @param {string[]} contenus Un fichier livré par entrée, dans `build/assets/`.
 * @returns {string} La racine (à passer `--racine` au garde).
 */
const ecrireBuild = (contenus) => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-origines-'));
  temporaires.push(racine);
  const assets = path.join(racine, 'build', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  contenus.forEach((texte, index) => {
    fs.writeFileSync(path.join(assets, `chunk-${index}.js`), texte);
  });
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

/**
 * Une arborescence CONFORME : TOUTES les origines de la vraie table (sinon les
 * entrées absentes seraient « périmées », et le cas positif ne prouverait rien),
 * un fichier par origine, deux occurrences chacune — de quoi franchir les trois
 * planchers. Le cas positif prouve donc le VERT, pas un refus de principe.
 */
const buildConforme = () =>
  CLASSEMENT_ORIGINES.map((entree) => `const u = "${entree.origine}/chemin";\nconst v = "${entree.origine}";\n`);

describe('origines de bundle — la règle, pure', () => {
  it('retient l’ORIGINE (schéma + hôte + port) et jette chemin, requête et fragment', () => {
    expect(origineDeUrl('https://tile.openstreetmap.org/9/1/2.png?v=3#x')).toBe('https://tile.openstreetmap.org');
    expect(origineDeUrl('http://127.0.0.1:8123/api/health')).toBe('http://127.0.0.1:8123');
    expect(origineDeUrl('https://wa.me/18193003507')).toBe('https://wa.me');
  });

  it('ne juge PAS ce qui ne sort pas du document ni ce qui n’est pas absolu', () => {
    for (const valeur of ['/assets/index-abc.js', 'data:image/png;base64,AAAA', 'mailto:a@b.test', 'tel:+229000', 'sans-protocole.test/x', '']) {
      expect(origineDeUrl(valeur), `« ${valeur} » ne doit pas être une origine`).toBe(null);
    }
  });

  it('sépare nos origines (contrat `estTiers`), les classées et les non classées', () => {
    const fichiers = [
      { chemin: 'assets/index.js', texte: 'const a="https://api.kojoforafrica.cc.cd";const b="http://127.0.0.1:8123/api";' },
      { chemin: 'assets/v.js', texte: 'const c="https://schema.org";const d="https://cdn.etranger.test/lib.js";' },
    ];
    // Classement EXPLICITE : avec la table entière, les quatorze entrées absentes
    // de ce corpus synthétique seraient (à juste titre) « périmées ».
    const classement = [
      { origine: 'https://schema.org', sorte: SORTES.IDENTIFIANT, motif: 'vocabulaire JSON-LD', preuve: 'JSON-LD' },
    ];
    const rapport = analyserOriginesLivrees({ fichiers, classement });

    expect(rapport.notres.map((e) => e.origine)).toEqual([
      'http://127.0.0.1:8123',
      'https://api.kojoforafrica.cc.cd',
    ]);
    expect(rapport.classees.map((e) => e.origine)).toEqual(['https://schema.org']);
    expect(rapport.classees[0].motif).toMatch(/JSON-LD/);
    expect(rapport.nonClassees.map((e) => e.origine)).toEqual(['https://cdn.etranger.test']);
    expect(rapport.perimees).toEqual([]);
    expect(rapport.occurrences).toBe(4);
  });

  it('refuse une entrée PÉRIMÉE : un classement que plus aucun fichier ne porte', () => {
    const fichiers = [{ chemin: 'assets/index.js', texte: 'const a="https://schema.org";' }];
    const classement = [
      { origine: 'https://schema.org', sorte: SORTES.IDENTIFIANT, motif: 'vocabulaire JSON-LD', preuve: 'x' },
      { origine: 'https://parti.ailleurs.test', sorte: SORTES.MESSAGE, motif: 'message d’une biblio retirée', preuve: 'y' },
    ];
    const rapport = analyserOriginesLivrees({ fichiers, classement });
    expect(rapport.classees.map((e) => e.origine)).toEqual(['https://schema.org']);
    expect(rapport.perimees.map((e) => e.origine)).toEqual(['https://parti.ailleurs.test']);
  });

  it('refuse un MOTIF vide : une entrée sans raison n’est pas un classement', () => {
    const fichiers = [{ chemin: 'assets/index.js', texte: 'const a="https://sans.motif.test";' }];
    const rapport = analyserOriginesLivrees({
      fichiers,
      classement: [{ origine: 'https://sans.motif.test', sorte: SORTES.LIEN, motif: '   ', preuve: 'z' }],
    });
    expect(rapport.perimees.map((e) => e.origine)).toEqual(['https://sans.motif.test']);
    expect(rapport.nonClassees).toEqual([]); // l'entrée existe : ce n'est PAS « non classée », c'est « pas un motif ».
  });

  it('compte les occurrences et les fichiers par origine, avec des exemples', () => {
    const fichiers = [
      { chemin: 'assets/a.js', texte: 'x="https://wa.me/1"' },
      { chemin: 'assets/b.js', texte: 'y="https://wa.me/2";z="https://wa.me/3"' },
    ];
    const origines = originesDesFichiers(fichiers);
    expect(origines.get('https://wa.me').occurrences).toBe(3);
    expect([...origines.get('https://wa.me').fichiers].sort()).toEqual(['assets/a.js', 'assets/b.js']);
    expect(origines.get('https://wa.me').exemples.length).toBeLessThanOrEqual(3);
  });
});

describe('origines de bundle — la forme de la table (portable, sans build)', () => {
  it('chaque entrée a une origine TIERCE, une sorte du vocabulaire, un motif et une preuve', () => {
    expect(CLASSEMENT_ORIGINES.length).toBeGreaterThanOrEqual(12);
    for (const entree of CLASSEMENT_ORIGINES) {
      expect(origineDeUrl(entree.origine), entree.origine).toBe(entree.origine);
      // Une entrée « nôtre » n'aurait rien à justifier : `estTiers` décide, la table classe le reste.
      expect(estTiers(entree.origine), `${entree.origine} est nôtre : la table ne doit pas le classer`).toBe(true);
      expect(Object.values(SORTES), entree.origine).toContain(entree.sorte);
      expect(String(entree.motif || '').trim().length, entree.origine).toBeGreaterThan(20);
      expect(String(entree.preuve || '').trim().length, entree.origine).toBeGreaterThan(3);
    }
  });

  it('aucune origine classée deux fois, aucun motif recopié d’une entrée à l’autre', () => {
    const origines = CLASSEMENT_ORIGINES.map((e) => e.origine);
    expect(new Set(origines).size).toBe(origines.length);
    const motifs = CLASSEMENT_ORIGINES.map((e) => e.motif);
    expect(new Set(motifs).size).toBe(motifs.length);
  });

  it('les angles morts sont PUBLIÉS, pas implicites', () => {
    expect(CE_QUE_CE_GARDE_VOIT.voit.length).toBeGreaterThanOrEqual(3);
    expect(CE_QUE_CE_GARDE_VOIT.nePeutPasVoir.join(' ')).toMatch(/ASSEMBLÉE à l’exécution/);
    // …et le HTML n'est PAS son sujet : il appartient au garde de coquille.
    expect(CE_QUE_CE_GARDE_VOIT.nePeutPasVoir.join(' ')).toMatch(/coquilles/);
  });
});

describe('origines de bundle — le garde en sous-processus', () => {
  it('sort 0 sur une arborescence conforme (le vert n’est pas un refus de principe)', () => {
    const rapport = lancerLeGarde(ecrireBuild(buildConforme()));
    expect(rapport.code).toBe(0);
    expect(rapport.stdout).toContain('CLASSÉE');
    expect(rapport.stdout).toMatch(/Aucune origine tierce non classée/);
  });

  it('sort 1 en NOMMANT l’origine tierce non classée, ses occurrences et ses fichiers', () => {
    const contenus = buildConforme();
    contenus[0] += 'const tierce = "https://cdn.etranger.test/lib.js";\n';
    const rapport = lancerLeGarde(ecrireBuild(contenus));
    expect(rapport.code).toBe(1);
    expect(rapport.stderr).toContain('https://cdn.etranger.test');
    expect(rapport.stderr).toMatch(/NON classée|non classée/);
    expect(rapport.stderr).toContain('chunk-0.js');
  });

  it('refuse de juger quand il n’a pas lu son sujet (build absent ou trop peu de fichiers)', () => {
    const vide = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-origines-vide-'));
    temporaires.push(vide);
    const rapport = lancerLeGarde(vide);
    expect(rapport.code).toBe(1);
    expect(rapport.stderr).toMatch(/insuffisants|refus de juger/);
  });

  it('refuse de juger quand le balayage ne trouve presque rien (lecteur cassé)', () => {
    const contenus = Array.from({ length: 8 }, (_, i) => `// fichier ${i}, aucune URL\n`);
    const rapport = lancerLeGarde(ecrireBuild(contenus));
    expect(rapport.code).toBe(1);
    expect(rapport.stderr).toMatch(/Occurrences d’URL absolue insuffisantes|refus de juger/);
  });
});

describe('origines de bundle — le trou que ce garde ferme', () => {
  it('une URL écrite dans le CODE n’existe dans aucun HTML : le garde de coquille est aveugle', () => {
    // La coquille, elle, n'en porte aucune trace.
    expect(ceQueLeGardeStatiqueVoit('<div id="root"></div>')).toEqual([]);
    // Le bundle, lui, la porte en clair — et c'est le seul endroit où elle vit.
    const bundle = 'script.src = "https://cdn.etranger.test/collect.js";';
    const rapport = analyserOriginesLivrees({ fichiers: [{ chemin: 'assets/index.js', texte: bundle }] });
    expect(rapport.nonClassees.map((e) => e.origine)).toEqual(['https://cdn.etranger.test']);
  });
});
