/**
 * GARDE « AUCUN JETON SANS LECTEUR, AUCUN MOT ÉTRANGER » — deux niveaux, comme
 * les autres gardes de ce dossier.
 *
 *   1. la RÈGLE (`scripts/reliquats-css.js`) est éprouvée DIRECTEMENT, sur des
 *      cas synthétiques : blanchiment des commentaires (lignes conservées), une
 *      `//` qui appartient à une chaîne n'est pas un commentaire, un jeton
 *      déclaré sans lecteur, une lecture sans déclaration, les quatre mots
 *      refusés. Chaque cas porte ce qu'il prouve.
 *   2. le GARDE (`scripts/check-reliquats-css.js`) est lancé en SOUS-PROCESSUS
 *      sur des arbres de fixture — parce que ce qui compte est son CODE DE
 *      SORTIE et ses messages, pas ses fonctions. Les fixtures sont ENGENDRÉES
 *      au-dessus des planchers de lecture (2 feuilles, 12 jetons déclarés,
 *      10 pages, 10 fichiers servis) : sans ça, le garde refuserait de juger et
 *      le test confondrait « refus » et « verdict ».
 *
 * Ce fichier ne dépend PAS de `build/` : la CI exécute `vitest` sans build.
 *
 * ── Ce que la première exécution du garde a appris (08/10/2026) ───────────────
 * Le `:root` shadcn a été réduit à son seul jeton peint, et le garde a
 * immédiatement signalé `--chart-4` — un jeton que PERSONNE ne déclarait plus.
 * Il sortait du commentaire qui documente le retrait du bloc `.dark` (« un
 * `--chart-4: 280 65% 60%`, c'est-à-dire un VIOLET ») : la prose du retrait était
 * lue comme le retrait lui-même. Les commentaires sont donc BLANCHIS avant toute
 * lecture, et le cas « ne prend pas un commentaire pour une déclaration ni un mot
 * étranger » est la preuve que la correction tient — c'est aussi lui que la
 * mutation « blanchiment des commentaires neutralisé » fait rougir.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MOTS_ETRANGERS,
  declarations,
  jetonsSansLecteur,
  lectures,
  lecturesSansDeclaration,
  ligneDe,
  motsEtrangersDe,
  sansCommentairesCss,
  sansCommentairesJs,
} from '../reliquats-css.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const GARDE = path.join(ICI, '..', 'check-reliquats-css.js');

/** Les douze jetons de la fixture : le plancher de lecture en demande douze. */
const JETONS = Array.from({ length: 12 }, (_, i) => `--jeton-${i}`);

/**
 * Un arbre de fixture COMPLET — sources, artefact livré et configuration — et
 * au-dessus des quatre planchers : 2 feuilles, 12 jetons déclarés, 10 pages,
 * 10 fichiers servis.
 *
 * @param {object} [options]
 * @param {string} [options.feuilleEnPlus] Écrit à la fin de `src/index.css`.
 * @param {string} [options.config] Remplace la configuration de Tailwind.
 * @param {number} [options.feuilles] Nombre de feuilles source (plancher 2).
 * @param {number} [options.jetons] Nombre de jetons déclarés (plancher 12).
 * @param {number} [options.pages] Nombre de pages livrées (plancher 10).
 * @param {number} [options.lecteurs] Nombre de fichiers servis (plancher 10).
 */
function ecrireArbre({ feuilleEnPlus = '', config = null, feuilles = 2, jetons = JETONS.length, pages = 10, lecteurs = 10 } = {}) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'reliquats-css-'));
  const src = path.join(racine, 'src');
  const build = path.join(racine, 'build');
  const noms = JETONS.slice(0, jetons);
  fs.mkdirSync(src);
  fs.mkdirSync(path.join(build, 'assets'), { recursive: true });

  fs.writeFileSync(
    path.join(src, 'index.css'),
    `:root{\n${noms.map((j, i) => `  ${j}: ${i + 1}px;`).join('\n')}\n}\n${feuilleEnPlus}\n`
  );
  if (feuilles >= 2) fs.writeFileSync(path.join(src, 'App.css'), '.b{color: var(--jeton-0)}\n');

  for (let i = 0; i < pages; i += 1) {
    // La première page lit TOUS les jetons : c'est elle qui rend l'arbre
    // conforme, et c'est elle qui manque quand on veut un jeton orphelin.
    const lecture = i === 0
      ? noms.map((j) => `var(${j})`).join('')
      : `var(${noms[i % noms.length]})`;
    fs.writeFileSync(
      path.join(build, `page-${i}.html`),
      `<html><head><style>.a{color:${lecture}}</style></head><body></body></html>`
    );
  }
  for (let i = 0; i < lecteurs; i += 1) {
    fs.writeFileSync(path.join(build, 'assets', `app-${i}.js`), `const a${i} = ${i};\n`);
  }

  const cheminConfig = path.join(racine, 'tailwind.config.cjs');
  fs.writeFileSync(
    cheminConfig,
    config ?? "module.exports = { theme: { extend: { colors: { x: 'hsl(var(--jeton-1))' } } } };\n"
  );
  return { racine, src, build, config: cheminConfig };
}

/** Lance le garde sur un arbre et rend son code de sortie AVEC sa sortie. */
function lancer(arbre, { root = null, config = null } = {}) {
  const args = [
    GARDE,
    '--root', root ?? arbre.build,
    '--sources', arbre.src,
    '--config', config ?? arbre.config,
  ];
  try {
    return { code: 0, sortie: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (erreur) {
    return { code: erreur.status, sortie: `${erreur.stdout || ''}${erreur.stderr || ''}` };
  }
}

describe('la règle, cas par cas', () => {
  it('blanchit les commentaires CSS en gardant les numéros de ligne', () => {
    const css = ':root{\n  /* --faux: 1px */\n  --vrai: 2px;\n}\n';
    const propre = sansCommentairesCss(css);
    expect(propre).not.toContain('--faux');
    expect(declarations(propre).has('--vrai')).toBe(true);
    // Le blanchiment garde les retours à la ligne : la ligne d'une déclaration
    // réelle ne se décale pas parce qu'un commentaire a été retiré.
    expect([...declarations(propre).values()][0]).toBe(3);
    expect(propre.split('\n').length).toBe(css.split('\n').length);
  });

  it('blanchit un commentaire JavaScript sans toucher à une chaîne qui contient //', () => {
    const js = "const u = 'https://exemple.test';\nconst x = 1; // var(--faux)\n";
    const propre = sansCommentairesJs(js);
    expect(propre).toContain('https://exemple.test');
    expect(propre).not.toContain('--faux');
    // La lecture d'une chaîne SURVIT : c'est une vraie lecture (un style en ligne).
    expect(lectures("const s = 'var(--radius)';").has('--radius')).toBe(true);
  });

  it('nomme le jeton déclaré que rien ne lit, et pas les autres', () => {
    const declares = declarations(':root{--lu: 1px;--orphelin: 2px;}');
    expect(declares.size).toBe(2);
    expect(jetonsSansLecteur(declares, new Set(['--lu']))).toEqual([{ nom: '--orphelin', ligne: 1 }]);
    expect(jetonsSansLecteur(declares, new Set(['--lu', '--orphelin']))).toEqual([]);
  });

  it('nomme la lecture qu’aucune déclaration ne pose', () => {
    const lues = lectures('.a{color: var(--pose);}.b{color: var(--jamais-pose, red);}');
    expect(lecturesSansDeclaration(lues, new Set(['--pose']))).toEqual([{ nom: '--jamais-pose', ligne: 1 }]);
    expect(lecturesSansDeclaration(lues, new Set(['--pose', '--jamais-pose']))).toEqual([]);
  });

  it('refuse les quatre mots étrangers, avec leur ligne', () => {
    const css = 'a{font-family: source-code-pro;}\nb{height: var(--radix-x);}\n';
    const ids = motsEtrangersDe(css).map((m) => m.id);
    expect(ids).toContain('police-du-gabarit');
    expect(ids).toContain('jeton-radix');
    expect(motsEtrangersDe(css)[0].ligne).toBe(1);
    const config = "animation: { 'accordion-down': 'x' },\ncolors: { a: 'hsl(var(--muted))' },\n";
    expect(motsEtrangersDe(config).map((m) => m.id)).toEqual(['animation-accordion']);
    expect(motsEtrangersDe('@apply bg-background text-foreground;').map((m) => m.id)).toEqual(['couleur-du-theme-retire']);
    // Chaque refus porte SA mesure : un refus sans mesure serait un goût.
    for (const mot of MOTS_ETRANGERS) expect(mot.mesure.length).toBeGreaterThan(80);
  });

  it('compte les lignes depuis 1', () => {
    expect(ligneDe('a\nb\nc', 0)).toBe(1);
    expect(ligneDe('a\nb\nc', 2)).toBe(2);
    expect(ligneDe('a\nb\nc', 4)).toBe(3);
  });
});

describe('le garde, sur des arbres de fixture', () => {
  it('ne signale rien sur un arbre conforme et lit son sujet', () => {
    const { code, sortie } = lancer(ecrireArbre());
    expect(code).toBe(0);
    expect(sortie).toMatch(/12 jeton\(s\) déclaré\(s\)/);
    // 10 pages + 10 fichiers d'assets : le garde compte ce qu'il a lu, pas ce
    // qu'il espérait lire.
    expect(sortie).toMatch(/10 page\(s\) et 20 fichier\(s\) servi\(s\)/);
    expect(sortie).toMatch(/Aucun reliquat/);
  });

  it('sort 1 et nomme le jeton déclaré que rien ne lit', () => {
    const { code, sortie } = lancer(ecrireArbre({ feuilleEnPlus: '.z{color: var(--kojo-encre);}\n.orphelin{--jeton-orphelin: 3px;}' }));
    expect(code).toBe(1);
    expect(sortie).toMatch(/--jeton-orphelin/);
    expect(sortie).toMatch(/est DÉCLARÉ et lu par AUCUN artefact livré/);
    expect(sortie).toMatch(/index\.css:1[0-9]/);
  });

  it('sort 1 quand la configuration lit un jeton qu’aucune feuille ne déclare', () => {
    const arbre = ecrireArbre({
      config: "module.exports = { theme: { extend: { colors: { x: 'hsl(var(--jeton-1))', y: 'hsl(var(--jamais-pose))' } } } };\n",
    });
    const { code, sortie } = lancer(arbre);
    expect(code).toBe(1);
    expect(sortie).toMatch(/--jamais-pose/);
    expect(sortie).toMatch(/est LU par la configuration et DÉCLARÉ par aucune feuille du site/);
  });

  it('sort 1 et nomme la police du gabarit (source-code-pro)', () => {
    const { code, sortie } = lancer(ecrireArbre({ feuilleEnPlus: 'code{font-family: source-code-pro, Menlo;}' }));
    expect(code).toBe(1);
    expect(sortie).toMatch(/source-code-pro/);
    expect(sortie).toMatch(/police du gabarit Create React App/);
  });

  it('sort 1 et nomme un jeton d’un paquet absent (--radix-…)', () => {
    const { code, sortie } = lancer(ecrireArbre({ feuilleEnPlus: '.k{height: var(--radix-accordion-content-height);}' }));
    expect(code).toBe(1);
    expect(sortie).toMatch(/--radix-accordion-content-height/);
    expect(sortie).toMatch(/paquet `@radix-ui`/);
  });

  it('sort 1 et nomme une animation de composant absent (accordion-down)', () => {
    const arbre = ecrireArbre({ config: "module.exports = { theme: { extend: { animation: { 'accordion-down': 'accordion-down .2s' } } } };\n" });
    const { code, sortie } = lancer(arbre);
    expect(code).toBe(1);
    expect(sortie).toMatch(/accordion-down/);
    expect(sortie).toMatch(/composant `Accordion` de shadcn/);
  });

  it('sort 1 et nomme un @apply d’une couleur du thème retiré', () => {
    const { code, sortie } = lancer(ecrireArbre({ feuilleEnPlus: '@layer base{body{@apply bg-background text-foreground;}}' }));
    expect(code).toBe(1);
    expect(sortie).toMatch(/@apply bg-background/);
    expect(sortie).toMatch(/couleur du thème shadcn retiré/);
  });

  it('ne signale PAS un @apply des couleurs du site', () => {
    const { code, sortie } = lancer(
      ecrireArbre({ feuilleEnPlus: '.carte{@apply rounded-lg border-stone-200 bg-stone-900 px-5 text-white ring-2 ring-orange-500 border-b;}' })
    );
    expect(code).toBe(0);
    expect(sortie).toMatch(/0 mot\(s\) étranger\(s\)/);
  });

  it('ne prend pas un commentaire pour une déclaration ni un mot étranger', () => {
    // Le cas RÉEL du 08/10/2026 : le commentaire qui documente le retrait du bloc
    // `.dark` cite `--chart-4: 280 65% 60%`, et les commentaires qui expliquent
    // les retraits nomment `source-code-pro`, `--radix-…` et `@apply
    // text-foreground`. Lu comme du code, il faisait rougir le garde sur sa
    // propre documentation.
    const { code, sortie } = lancer(
      ecrireArbre({
        feuilleEnPlus:
          '/* --chart-4: 280 65% 60% — un VIOLET, retiré le 28/09/2026 ; ' +
          'le `code{}` portait source-code-pro et le thème lisait var(--radix-x) */\n.legitime{color: #1c1917;}',
        config:
          '// was: { animation: { "accordion-down": "x" }, colors: { c: "hsl(var(--muted))" } }\n' +
          "module.exports = { theme: { extend: { colors: { x: 'hsl(var(--jeton-1))' } } } };\n",
      })
    );
    expect(code).toBe(0);
    expect(sortie).toMatch(/Aucun reliquat/);
  });

  it('REFUSE de juger sans dossier de build', () => {
    const arbre = ecrireArbre();
    const { code, sortie } = lancer(arbre, { root: path.join(arbre.racine, 'absent') });
    expect(code).toBe(1);
    expect(sortie).toMatch(/dossier de build introuvable/);
  });

  it('REFUSE de juger sans configuration de Tailwind', () => {
    const arbre = ecrireArbre();
    const { code, sortie } = lancer(arbre, { config: path.join(arbre.racine, 'tailwind-absent.cjs') });
    expect(code).toBe(1);
    expect(sortie).toMatch(/configuration de Tailwind introuvable/);
  });

  it('REFUSE de juger sous les planchers de lecture', () => {
    // Une seule feuille source : le garde refuse, il ne prononce pas un verdict.
    const uneFeuille = lancer(ecrireArbre({ feuilles: 1 }));
    expect(uneFeuille.code).toBe(1);
    expect(uneFeuille.sortie).toMatch(/lecture incomplète des feuilles source/);

    // Huit jetons déclarés pour un plancher de douze : un balayage qui a lu
    // presque rien déclarerait propres des feuilles qu'il n'a pas vues.
    const peuDeJetons = lancer(ecrireArbre({ jetons: 8 }));
    expect(peuDeJetons.code).toBe(1);
    expect(peuDeJetons.sortie).toMatch(/seulement 8 jeton\(s\) déclaré\(s\)/);

    // Trois pages et trois fichiers servis : « sans lecteur » n'a plus de sens.
    const peuLivre = lancer(ecrireArbre({ pages: 3, lecteurs: 3 }));
    expect(peuLivre.code).toBe(1);
    expect(peuLivre.sortie).toMatch(/lecture incomplète de l’artefact livré/);
  });
});
