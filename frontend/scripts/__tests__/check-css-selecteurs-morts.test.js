/**
 * GARDE « AUCUN SÉLECTEUR SANS PORTEUR » — deux niveaux, comme les autres gardes
 * de ce dossier.
 *
 *   1. la RÈGLE (`scripts/css-selecteurs-morts.js`) est éprouvée DIRECTEMENT, sur
 *      des cas synthétiques : c'est elle qui décide ce qu'est un nom de classe
 *      (échappements, valeurs arbitraires, chaînes entre guillemets) et ce qu'est
 *      un porteur (bornes de nom comprises). Chaque cas porte ce qu'il prouve.
 *   2. le GARDE (`scripts/check-css-selecteurs-morts.js`) est lancé en
 *      SOUS-PROCESSUS sur des arbres de fixture — parce que ce qui compte est son
 *      CODE DE SORTIE et ses messages, pas ses fonctions. Les fixtures sont
 *      ENGENDRÉES au-dessus des planchers de lecture (20 fichiers, 2 feuilles,
 *      60 règles, 10 pages) : sans ça, le garde refuserait de juger et le test
 *      confondrait « refus » et « verdict ».
 *
 * Ce fichier ne dépend PAS de `build/` : la CI exécute `vitest` sans build.
 *
 * ── Les fixtures POSENT leurs classes, et depuis le 28/09/2026 elles le font
 * DANS UNE POSITION DE CLASSE ─────────────────────────────────────────────────
 * Elles écrivaient `const a=["classe-posee-0", …]` : le corpus LARGE y voyait
 * des porteurs, le corpus des POSEURS (verdict 1) n'y voit qu'un tableau de
 * chaînes, et l'arbre « conforme » sortait donc en 1 — le garde avait raison
 * contre sa propre fixture. `className:"…"` est la forme que React reçoit après
 * compilation, et c'est elle qu'on écrit ici.
 *
 * Le cas `prose` de `ecrireArbre` est l'inverse, et c'est une PREUVE : un nom
 * écrit ailleurs que dans une position de classe (nom de route, clé i18n, prose)
 * ne doit PAS disculper une règle morte. Les cinq `kojo-pack-*.css` supprimés le
 * 28/09/2026 ne tenaient que par là (`card` « porté » par `<meta
 * name="twitter:card">`, `dialog` par `role="dialog"`, `dashboard` par un nom de
 * route) : la mutation « corpus large pour les feuilles source » du registre rend
 * ce cas vert, et rien d'autre.
 *
 * ── Preuves d'échec (rejouées à la main, harnais de mutation) ────────────────
 *   • réécrire une règle morte dans `src/App.css` → sortie 1, nommant fichier,
 *     ligne, nom et sélecteur ;
 *   • retirer un nom POSÉ d'un sélecteur pour un nom MORT (position obligatoire)
 *     → sortie 1 par le premier verdict ;
 *   • réintroduire l'utilitaire que Tailwind générait pour la branche DEV
 *     (`src/pages/Dashboard.js`) → sortie 1 par le SECOND verdict, qui n'aurait
 *     aucun moyen de le voir côté source ;
 *   • neutraliser le verdict (`if (!divergencesSource.length && …)` → toujours
 *     vrai) → les deux cas de garde qui attendent la sortie 1 passent au vert ;
 *   • neutraliser la lecture des feuilles source (`nomsMortsDeLaFeuille` jamais
 *     parcourue) → le cas « nomme fichier, ligne, nom » passe au vert ;
 *   • neutraliser CHACUN des trois planchers (corpus, feuilles source, pages)
 *     → le refus nommé correspondant passe au vert. C'est pour rendre ces trois
 *     mutations possibles qu'un arbre de fixture peut être illisible à UN SEUL
 *     niveau.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classesDuHtml,
  classesDuJs,
  corpusPoseurs,
  feuillesDe,
  jetonsDe,
  nomPose,
  nomsDeSelecteur,
  nomsMortsDeLaFeuille,
  reglesSansPorteurDeLaFeuille,
} from '../css-selecteurs-morts.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const GARDE = path.resolve(ICI, '..', 'check-css-selecteurs-morts.js');
const BS = String.fromCharCode(92);

const corpus = (texte) => ({ jetons: jetonsDe(texte), texte, fichiers: ['fixture'] });

describe('css-selecteurs-morts — le décodeur de noms de sélecteur', () => {
  it('lit une valeur arbitraire échappée EN ENTIER (`min-h-[44px]`, `z-[9999]`)', () => {
    // Le motif hérité de l'élagage coupait ces noms, et c'est ainsi que les
    // cibles tactiles du site avaient été retirées le 25/09/2026.
    expect(nomsDeSelecteur(String.raw`.min-h-\[44px\]`)).toEqual(['min-h-[44px]']);
    expect(nomsDeSelecteur(String.raw`.z-\[9999\]`)).toEqual(['z-[9999]']);
    expect(nomsDeSelecteur(String.raw`.md\:min-h-\[10rem\]`)).toEqual(['md:min-h-[10rem]']);
  });

  it('lit un nom dont les crochets ET les deux-points sont échappés (faux positif mesuré)', () => {
    // C'est LA classe que le JavaScript livré porte en clair pour un champ de
    // recherche. Le décodeur précédent n'en retenait que `[&::`, donc le garde
    // déclarait « sans porteur » une règle pourtant portée — un faux positif.
    const selecteur = String.raw`.\[\&\:\:-webkit-search-cancel-button\]\:hidden::-webkit-search-cancel-button`;
    expect(nomsDeSelecteur(selecteur)).toEqual(['[&::-webkit-search-cancel-button]:hidden']);
  });

  it('résout les utilitaires à variante (`hover:`, `md:`) et les barres obliques', () => {
    expect(nomsDeSelecteur(String.raw`.hover\:bg-gray-50`)).toEqual(['hover:bg-gray-50']);
    expect(nomsDeSelecteur(String.raw`.w-1\/2`)).toEqual(['w-1/2']);
  });

  it('lit un id, et plusieurs noms dans une liste de sélecteurs', () => {
    expect(nomsDeSelecteur('#mon-id')).toEqual(['mon-id']);
    expect(nomsDeSelecteur('button, .btn')).toEqual(['btn']);
    expect(nomsDeSelecteur('.a .b > .c')).toEqual(['a', 'b', 'c']);
    expect(nomsDeSelecteur(':is(.hero,[data-screen="login"]) h1')).toEqual(['hero']);
  });

  it('ne prend pas un point entre guillemets pour un nom de classe', () => {
    expect(nomsDeSelecteur('input[href$=".pdf"]')).toEqual([]);
  });

  it('ne prend pas un crochet NU pour un nom (il ouvre un sélecteur d’attribut)', () => {
    expect(nomsDeSelecteur('.a[href]')).toEqual(['a']);
  });
});

describe('css-selecteurs-morts — ce qu’est un PORTEUR', () => {
  it('trouve un nom dans les jetons du corpus', () => {
    expect(nomPose('bg-orange-600', jetonsDe('className:"bg-orange-600"'), 'className:"bg-orange-600"')).toBe(true);
  });

  it('exige des BORNES de nom : `container` ne compte pas dans `containerRef`', () => {
    const jetons = jetonsDe('containerRef');
    expect(jetons.has('container')).toBe(false);
    expect(nomPose('container', jetons, 'containerRef')).toBe(false);
    expect(nomPose('containerRef', jetons, 'containerRef')).toBe(true);
  });

  it('refuse un nom absent, et un corpus vide ne fait pas vert', () => {
    expect(nomPose('job-card', jetonsDe('autre-chose'), 'autre-chose')).toBe(false);
    expect(nomPose('job-card', jetonsDe(''), '')).toBe(false);
  });
});

/**
 * Ce que le corpus STRICT retient, et ce qu'il REFUSE de retenir. C'est la
 * bascule du 28/09/2026 : le corpus comptait les jetons de TOUT le texte du
 * build, donc les cinq feuilles mortes passaient (leurs noms apparaissaient dans
 * une chaîne, un attribut ou une clé de traduction).
 */
describe('css-selecteurs-morts — ce qui POSE VRAIMENT une classe', () => {
  it('ne compte PAS une chaîne posée nulle part : `["card"]` ne porte pas `.card`', () => {
    // Le corps de ce cas est la forme qu'avaient les fixtures, et c'est ainsi
    // que le corpus large disculpait un nom qu'aucun élément ne porte.
    expect(classesDuJs('const routes=["card","panel","dashboard"];export{routes}')).toEqual([]);
    expect(classesDuJs('console.log("card");const i18n={dashboard:"Tableau"};const p={role:"dialog"};')).toEqual([]);
    expect(classesDuJs('fetch("/api/jobs", { headers: { "x-header": "toast" } })')).toEqual([]);
  });

  it('compte les positions de classe : propriété, attribut JSX, classList, affectation, clé …Class', () => {
    expect(classesDuJs('const a={className:"card panel"};')).toEqual(['card panel']);
    expect(classesDuJs('const a=<div className="hero" class="x"/>;')).toEqual(['hero', 'x']);
    expect(classesDuJs('document.body.classList.add("toast");')).toEqual(['toast']);
    expect(classesDuJs('el.setAttribute("class", "overlay");')).toEqual(['overlay']);
    expect(classesDuJs('el.className = "hero";')).toEqual(['hero']);
    // La convention du dépôt : une classe déclarée une fois et lue des deux
    // canaux (`titreEntreeClass`, `inputClassName`).
    expect(classesDuJs('const o={titreEntreeClass:"titre-entree", inputClassName:"champ"};')).toEqual([
      'titre-entree',
      'champ',
    ]);
  });

  it('descend les gabarits, les conditions et les appels d’un `className`', () => {
    // Sans ça, deux classes VIVANTES (`pastille-courante`, `panneau-filtres`) et
    // 351 utilitaires livrés étaient déclarés morts.
    expect(classesDuJs('const c="panneau-filtres";const a={className:`${c} x`};')).toContain('panneau-filtres');
    expect(classesDuJs('const a={className:cond ? "pastille-courante" : ""};')).toContain('pastille-courante');
    expect(classesDuJs('const a={className:clsx("sm:w-4", cond && "sm:h-4")};')).toEqual(
      expect.arrayContaining(['sm:w-4', 'sm:h-4'])
    );
  });

  it('lit une clé qui SE NOMME COMME UNE CLASSE, y compris la convention `classe…`', () => {
    // `classeFond="bg-green-500"` est la convention du dépôt pour un prop qui
    // porte une classe (`StepDot`, `StatCard`). Sans le motif `^classe`, ces props
    // étaient invisibles au corpus et leurs classes déclarées MORTES — c'est ce
    // qui a fait renommer les props à la source le 07/10/2026.
    expect(classesDuJs('const a=<StepDot classeFond="bg-green-500" classeTexte="text-white"/>;')).toEqual([
      'bg-green-500',
      'text-white',
    ]);
    expect(classesDuJs('const o={classeCorps:"corps-page"};')).toEqual(['corps-page']);
  });

  it('résout un REGISTRE local relu par INDEX dynamique, mais RÉSERVE à ce fichier', () => {
    // L'objet est nommé dans une position de classe et relu par index : aucune
    // propriété ne peut être choisie, donc TOUTES ses chaînes sont des classes.
    expect(classesDuJs('const colorClasses={rouge:"bg-red-500",bleu:"bg-blue-500"};const a={className:`${colorClasses[c]}`};')).toEqual(
      expect.arrayContaining(['bg-red-500', 'bg-blue-500'])
    );
    // Le membre dont l'objet est déclaré dans CE fichier est résolu (c'est la
    // ligne qui a rendu `badgeRepere` inutile côté registre partagé)…
    expect(
      classesDuJs('const X={badge:"inline h-3 w-3 align-[-0.125em]"};const a={className:`${X.badge}`};')
    ).toContain('inline h-3 w-3 align-[-0.125em]');
    // …et celui dont l'objet vient d'un AUTRE module ne l'est PAS : c'est la
    // frontière, pas un oubli. La tolérer demandait 33 noms (title, status,
    // amount…) pour faire vivre UNE classe — le corpus large que ce module refuse.
    expect(classesDuJs('const a={className:`${CLASSES_ICONE.badgeRepere}`};')).toEqual([]);
  });

  it('lit la PROPRIÉTÉ NOMMÉE, et pas l’objet entier : la prose n’est pas une classe', () => {
    // Le faux positif mesuré le 09/10/2026 : une position de classe qui nomme
    // `frameClass` faisait lire TOUTES les chaînes de l'entrée du plan — dont le
    // champ `pourquoi`, écrit en français. La phrase « le pied de page était
    // visible » déclarait alors POSÉE la classe `visible`, et le garde refusait
    // ce nom de la `blocklist` de `tailwind.config.cjs` que PERSONNE ne pose.
    const plan = [
      'const PLAN={"/":{frameClass:"max-w-7xl mx-auto cadre-page",pourquoi:"le pied de page était visible"}};',
      'const a={className:`${PLAN["/"].frameClass}`};',
    ].join('');
    const valeurs = classesDuJs(plan);
    expect(valeurs).toContain('max-w-7xl mx-auto cadre-page');
    expect(valeurs).not.toContain('le pied de page était visible');
    expect(jetonsDe(valeurs.join('\n')).has('visible')).toBe(false);
  });

  it('un index DYNAMIQUE garde la lecture large des VALEURS, mais jamais d’un CONTENEUR', () => {
    // Les valeurs d'un registre relu par index SONT les classes : on ne peut pas
    // savoir laquelle, donc toutes comptent (`colorClasses[color]`).
    expect(
      classesDuJs('const R={a:"bg-red-500",b:"bg-blue-500"};const x={className:`${R[k]}`};')
    ).toEqual(expect.arrayContaining(['bg-red-500', 'bg-blue-500']));
    // Le RELAIS par une déclaration locale suit le membre lu : `const t=R[k]`,
    // puis `t.texte` en position de classe, lit `R['*'].texte` — la propriété
    // réellement lue, pas tout `R`.
    expect(
      classesDuJs(
        'const R={a:{texte:"text-white"},b:{texte:"text-black"}};const t=R[k];const x={className:`${t.texte}`};'
      )
    ).toEqual(expect.arrayContaining(['text-white', 'text-black']));
    // …et une ENTRÉE qui est un objet n'est jamais une classe : au bout d'un
    // chemin, on ne lit que les chaînes du nœud, pas celles qu'il contient.
    expect(classesDuJs('const R={a:{pourquoi:"le pied était visible"}};const x={className:`${R[k]}`};')).toEqual([]);
    // La lecture HISTORIQUE reste, elle, pour un identifiant lu TEL QUEL :
    // l'objet y EST le registre, donc toutes ses chaînes sont des classes.
    expect(classesDuJs('const R={a:"bg-red-500",b:"bg-blue-500"};const x={className:R};')).toEqual(
      expect.arrayContaining(['bg-red-500', 'bg-blue-500'])
    );
  });

  it('ne condamne RIEN quand un fichier est illisible (un fichier non lu ne fait pas rouge)', () => {
    // Le garde lit des artefacts de build ; un parseur qui lève sur un fichier
    // exotique ne doit pas transformer une erreur de lecture en dette de CSS.
    expect(classesDuJs('const (::{')).toEqual([]);
  });

  it('lit les valeurs de classe du HTML, et rien que l’attribut `class`', () => {
    expect(classesDuHtml('<body class="a b"><p class=\'c\'></p>')).toEqual(['a b', 'c']);
    expect(classesDuHtml('<meta name="twitter:card" content="summary">')).toEqual([]);
  });
});

describe('css-selecteurs-morts — les règles d’une feuille', () => {
  it('nomme le nom mort avec sa ligne et son sélecteur (feuille source)', () => {
    const css = ['.pose { color: red }', '', '.job-card { color: blue }'].join('\n');
    const trouves = nomsMortsDeLaFeuille(css, corpus('.pose'));
    expect(trouves).toHaveLength(1);
    expect(trouves[0].ligne).toBe(3);
    expect(trouves[0].noms).toEqual(['job-card']);
    expect(trouves[0].obligatoire).toBe(true);
  });

  it('distingue la position OBLIGATOIRE de l’ALTERNATIVE de :is()', () => {
    const css = '.hero .job-card { color: red }\n:is(.hero,.job-card) p { color: blue }';
    const trouves = nomsMortsDeLaFeuille(css, corpus('.hero'));
    expect(trouves.map((t) => t.obligatoire)).toEqual([true, false]);
  });

  it('ne signale rien quand tous les noms sont posés', () => {
    expect(nomsMortsDeLaFeuille('.hero .card { color: red }', corpus('.hero .card'))).toEqual([]);
  });

  it('signale une règle LIVRÉE dont aucun sélecteur n’a de porteur', () => {
    const feuille = '.bg-purple-600{color:red}.bg-orange-600{color:blue}';
    const trouves = reglesSansPorteurDeLaFeuille(feuille, corpus('bg-orange-600'));
    expect(trouves).toHaveLength(1);
    expect(trouves[0].noms).toEqual(['bg-purple-600']);
  });

  it('garde une règle livrée dont UN sélecteur au moins est porté', () => {
    const feuille = '.mort,.vivant{color:red}';
    expect(reglesSansPorteurDeLaFeuille(feuille, corpus('vivant'))).toEqual([]);
  });

  it('extrait les feuilles `<style>` d’une page, et rien d’autre', () => {
    expect(feuillesDe('<style>a{}</style><style>b{}</style>')).toEqual(['a{}', 'b{}']);
  });
});

/**
 * Arbre de fixture au-dessus des planchers du garde (fichiers, jetons, règles,
 * pages).
 *
 * Les TROIS compteurs sont indépendants, et c'est ce qui rend chaque plancher
 * prouvable : un arbre où tout est minuscule s'arrête au PREMIER refus, donc un
 * seul plancher y était démontré. Ici, un arbre peut être illisible au seul
 * niveau du corpus (1 fichier de poseurs), ou de ses feuilles source (1 feuille),
 * ou de son livré (1 page) — le reste étant complet.
 *
 * `prose` est écrit dans le JS du build SANS être une position de classe : c'est
 * la forme sous laquelle un nom mort se faisait disculper avant le 28/09/2026.
 */
function ecrireArbre({ regleMorte = null, regleLivree = null, prose = '', classeBloquee = null, nbJs = 25, nbPages = 12, nbFeuilles = 6 } = {}) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-css-mort-'));
  const build = path.join(racine, 'build');
  const assets = path.join(build, 'assets');
  const src = path.join(racine, 'src');
  fs.mkdirSync(assets, { recursive: true });
  fs.mkdirSync(src, { recursive: true });

  // Les noms POSÉS : écrits dans le JS du build DANS UNE POSITION DE CLASSE,
  // comme React les publie (`className:"…"`). Il en faut 200 au moins (plancher
  // de jetons du garde) et chacun doit être un jeton DISTINCT — les écrire en une
  // chaîne séparée par des espaces n'en produisait que 40, et le garde refusait
  // alors de juger au lieu de rendre un verdict.
  const poses = Array.from({ length: 240 }, (_, i) => `classe-posee-${i}`);
  // Une classe POSÉE que le site a DÉCIDÉ de ne plus générer : la seule façon de
  // prouver que le verdict 3 lit la VRAIE `blocklist` de `tailwind.config.cjs`
  // (le garde la `require`, il ne la copie pas).
  const bloc = classeBloquee ? `\nconst pose={className:"${classeBloquee}"};
` : '';
  for (let i = 0; i < nbJs; i += 1) {
    fs.writeFileSync(
      path.join(assets, `chunk-${i}.js`),
      `const a=[${poses.map((p) => `{className:"${p}"}`).join(',')}];\n${prose}${bloc}\nexport{a}`,
      'utf8'
    );
  }
  for (let i = 0; i < nbPages; i += 1) {
    fs.writeFileSync(
      path.join(build, `page-${i}.html`),
      `<html><head><style>.classe-posee-${i}{color:red}${regleLivree || ''}</style></head><body>x</body></html>`,
      'utf8'
    );
  }
  for (let i = 0; i < nbFeuilles; i += 1) {
    const regles = Array.from({ length: 12 }, (_, j) => `.classe-posee-${(i * 12 + j) % 240}{color:red}`).join('\n');
    fs.writeFileSync(path.join(src, `feuille-${i}.css`), `${regles}\n${regleMorte || ''}`, 'utf8');
  }
  return { racine, build, src };
}

const lancerGarde = (arbre) => {
  try {
    const sortie = execFileSync(
      process.execPath,
      [GARDE, '--root', arbre.build, '--sources', arbre.src],
      { encoding: 'utf8', errors: 'replace', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { code: 0, sortie };
  } catch (erreur) {
    return { code: erreur.status, sortie: `${erreur.stdout || ''}${erreur.stderr || ''}` };
  }
};

describe('check-css-selecteurs-morts — le garde, sur des arbres de fixture', () => {
  it('sort 0 sur un arbre conforme, et PUBLIE ce qu’il a lu', () => {
    const arbre = ecrireArbre();
    const { code, sortie } = lancerGarde(arbre);
    expect(code).toBe(0);
    expect(sortie).toMatch(/Aucun sélecteur sans porteur/);
    expect(sortie).toMatch(/6 feuille\(s\) source et 12 page\(s\) livrée\(s\) lues/);
    // La `blocklist` est lue DANS la vraie configuration de Tailwind, et le
    // verdict la publie : un zéro qui ne dirait pas combien de noms il a
    // regardés serait un zéro qu'on ne peut pas distinguer d'une liste vide.
    expect(sortie).toMatch(/[1-9]\d* nom\(s\) volontairement NON généré\(s\), 0 posé\(s\)/);
  });

  it('sort 1 quand un nom de la `blocklist` est POSÉ (un nom bloqué mais posé ne peint rien)', () => {
    // C'est l'autre moitié du mensonge que ce garde combat : une classe que le
    // livré porte et dont la règle a été retirée de la feuille servie.
    const arbre = ecrireArbre({ classeBloquee: 'container' });
    const { code, sortie } = lancerGarde(arbre);
    expect(code).toBe(1);
    expect(sortie).toMatch(/« container » est dans la liste des noms volontairement NON générés/);
  });

  it('sort 1 et nomme fichier, ligne, nom et sélecteur quand une feuille SOURCE écrit un nom mort', () => {
    const arbre = ecrireArbre({ regleMorte: '\n.job-card-mobile{color:red}' });
    const { code, sortie } = lancerGarde(arbre);
    expect(code).toBe(1);
    expect(sortie).toMatch(/feuille-0\.css:14/);
    expect(sortie).toMatch(/job-card-mobile/);
    expect(sortie).toMatch(/posé par AUCUN élément livré/);
  });

  it('sort 1 quand la feuille LIVRÉE garde une règle sans porteur (utilitaire généré)', () => {
    const arbre = ecrireArbre({ regleLivree: '.bg-purple-600{color:red}' });
    const { code, sortie } = lancerGarde(arbre);
    expect(code).toBe(1);
    expect(sortie).toMatch(/règle servie sans porteur/);
    expect(sortie).toMatch(/bg-purple-600/);
  });

  // Trois planchers, trois arbres, trois refus NOMMÉS : chacun est prouvé par une
  // mutation d'une seule ligne du garde (cf. le registre des preuves).
  it('REFUSE de juger un corpus de poseurs illisible (plancher de fichiers)', () => {
    // 1 chunk + 12 pages = 13 fichiers, mais 240 jetons distincts : c'est bien le
    // compte de FICHIERS qui est sous le plancher, pas la matière.
    const arbre = ecrireArbre({ nbJs: 1 });
    const { code, sortie } = lancerGarde(arbre);
    expect(code).toBe(1);
    // Le refus publie les TROIS planchers (fichiers, jetons, valeurs de classe) :
    // c'est le compte de FICHIERS qui est sous le sien, la matière étant complète.
    expect(sortie).toMatch(/corpus illisible \(13 fichier\(s\), \d+ jeton\(s\), \d+ valeur\(s\) de classe\)/);
  });

  it('REFUSE de juger des feuilles source illisibles (plancher de règles)', () => {
    const arbre = ecrireArbre({ nbFeuilles: 1 }); // 1 feuille × 12 règles = 12 < 60
    const { code, sortie } = lancerGarde(arbre);
    expect(code).toBe(1);
    expect(sortie).toMatch(/lecture incomplète des feuilles source \(1 feuille\(s\), 12 règle\(s\)\)/);
  });

  it('REFUSE de juger un livré sans pages (plancher de pages)', () => {
    const arbre = ecrireArbre({ nbPages: 1 });
    const { code, sortie } = lancerGarde(arbre);
    expect(code).toBe(1);
    expect(sortie).toMatch(/seulement 1 page\(s\) livrée\(s\) — plancher 10/);
  });

  it('REFUSE de juger sans build (« un garde qui n’a rien lu n’a rien vérifié »)', () => {
    const arbre = ecrireArbre();
    const sortie = (() => {
      try {
        execFileSync(process.execPath, [GARDE, '--root', path.join(arbre.racine, 'absent'), '--sources', arbre.src], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { code: 0, sortie: '' };
      } catch (erreur) {
        return { code: erreur.status, sortie: `${erreur.stdout || ''}${erreur.stderr || ''}` };
      }
    })();
    expect(sortie.code).toBe(1);
    expect(sortie.sortie).toMatch(/dossier de build introuvable/);
  });

  it('ne se laisse PAS convaincre par un nom écrit ailleurs que dans une classe', () => {
    // `job-card-mobile` est écrit dans le JS du build — comme NOM DE ROUTE, pas
    // dans une position de classe. Le corpus large y verrait un porteur (c'est
    // ainsi que `card`, `dialog`, `overlay`, `header`, `toast`, `dashboard`,
    // `settings`, `jobs` et `profile` disculpaient les cinq `kojo-pack-*.css`
    // supprimés le 28/09/2026) ; le corpus des POSEURS ne le compte pas.
    const arbre = ecrireArbre({
      regleMorte: '\n.job-card-mobile{color:red}',
      prose: 'const ROUTES=["job-card-mobile"];export{ROUTES}',
    });
    const { code, sortie } = lancerGarde(arbre);
    expect(code).toBe(1);
    expect(sortie).toMatch(/job-card-mobile/);
    expect(sortie).toMatch(/posé par AUCUN élément livré/);
  });

  it('lit le corpus des POSEURS : les feuilles du build en sont exclues', () => {
    const arbre = ecrireArbre();
    const { jetons, texte, fichiers } = corpusPoseurs(arbre.build);
    expect(fichiers.some((f) => f.endsWith('.css'))).toBe(false);
    expect(fichiers.length).toBe(37);
    // Le contenu des blocs `<style>` ne doit PAS justifier un nom : sinon la
    // feuille se justifierait elle-même.
    expect(texte.includes('classe-posee-0{color:red}')).toBe(false);
    expect(jetons.has('classe-posee-0')).toBe(true);
    expect(texte.split('classe-posee-0'.length).length).toBeGreaterThan(1);
  });

  it('garde le séparateur d’échappement hors des noms décodés', () => {
    // Le nom décodé ne contient plus AUCUN antislash : c'est la condition pour
    // qu'il soit trouvé dans le texte du corpus.
    expect(nomsDeSelecteur(String.raw`.\[\&\]\:hidden`).join('')).not.toContain(BS);
  });
});
