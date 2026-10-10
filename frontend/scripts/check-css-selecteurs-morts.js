#!/usr/bin/env node
/**
 * GARDE : AUCUN SÉLECTEUR SANS PORTEUR — dans les feuilles SOURCE comme dans la
 * feuille LIVRÉE.
 *
 * ── Ce qu'il remplace, et pourquoi le remplacement est plus strict ───────────
 * Il prend la place de `vite-plugins/purge-css-mort.js`, un ÉLAGAGE AU BUILD qui
 * retirait silencieusement les règles mortes de la feuille inlinée (420 règles,
 * 67 932 o = 7,5 % sur les 13 pages du 25/09/2026, avec deux refus — corpus
 * illisible, élagage > 35 % d'une page — comme seuls garde-fous). Trois raisons
 * mesurées ont fait préférer un verdict à une suppression :
 *   • l'élagage MASQUAIT la dette : la feuille servie différait des sources ;
 *   • il ne jugeait qu'à la RÈGLE ENTIÈRE, donc un nom mort écrit à côté d'un
 *     sélecteur vivant lui échappait — mesuré : 105 noms, 4 769 o = 6,85 % de la
 *     feuille servie ;
 *   • une suppression silencieuse ne laisse aucune trace dans une revue.
 *
 * ── Les deux verdicts, et pourquoi il en faut deux ──────────────────────────
 *   1. FEUILLES SOURCE (`src/**\/*.css`) — le verdict ACTIONNABLE : il nomme le
 *      fichier, la ligne, le nom mort et le sélecteur qui l'écrit.
 *
 *      SA LECTURE A ÉTÉ RESSERRÉE le 28/09/2026, et c'est la mesure qui l'a
 *      imposée : cinq feuilles importées (`src/styles/kojo-pack-*.css`, 292
 *      lignes d'un système de design étranger) nommaient 39 classes dont AUCUNE
 *      n'était portée par un élément, et ce verdict était VERT — le corpus
 *      comptait alors les noms n'importe où dans l'artefact.
 *   2. FEUILLE LIVRÉE (les blocs `<style>` des pages du build) — le verdict qui
 *      préserve la garantie de l'élagage : AUCUNE règle servie ne doit rester
 *      sans porteur. Il attrape ce que le premier ne peut pas voir, puisqu'aucune
 *      feuille source ne l'écrit : un utilitaire que Tailwind GÉNÈRE depuis un
 *      composant que le bundle de production élimine (une branche
 *      `import.meta.env.DEV`) — mesuré le 25/09/2026 : 2 utilitaires, 199 o par
 *      page, invisibles autrement.
 *
 *      LES DEUX VERDICTS LISENT LE MÊME CORPUS depuis le 07/10/2026, ET C'EST LA
 *      CLÔTURE D'UNE DETTE. Le verdict 2 tolérait auparavant une lecture LARGE
 *      (tous les jetons du build), parce que Tailwind génère un utilitaire depuis
 *      n'importe quel jeton : mesuré ce jour-là, **325 règles servies (20 noms,
 *      13 pages)** étaient livrées SANS porteur — `.container` (un identifiant),
 *      `.ease-out` (une valeur d'`animation`), `.resize` (un nom d'événement),
 *      `.filter` (une méthode de tableau), `.table`, `.static`, `.visible`… La
 *      dette est fermée, nom par nom : (1) ceux qui SONT des classes ont reçu un
 *      porteur que le corpus peut lire (props renommées, registres de classes
 *      nommés comme tels) ; (2) ceux qui n'en sont pas ont CESSÉ D'ÊTRE GÉNÉRÉS
 *      (`blocklist` de `tailwind.config.cjs`), et le garde REFUSE qu'un nom de
 *      cette liste soit posé quelque part — un nom bloqué mais posé serait une
 *      classe dont la règle n'existe plus, l'autre moitié du même mensonge.
 * Les verdicts ne se répètent pas : un nom déjà nommé par le 1 est retiré des
 * règles signalées par le 2.
 *
 * ── Les refus (un vert sans lecture est un faux vert) ───────────────────────
 * Le garde REFUSE de rendre un verdict si le build est absent, si le corpus est
 * trop petit (moins de 20 fichiers, 200 jetons ou 500 valeurs de classe), s'il lit
 * moins de 2 feuilles source, moins de 60 règles ou moins de 10 pages. Un lecteur
 * cassé doit échouer, pas rassurer — c'est le mode d'échec de ce genre de
 * contrôle.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   cd frontend && npm run build && node scripts/check-css-selecteurs-morts.js
 *   node scripts/check-css-selecteurs-morts.js --root <build> --sources <src>
 */
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import {
  MIN_FICHIERS_CORPUS,
  MIN_JETONS_CORPUS,
  MIN_VALEURS_CORPUS,
  MIN_FEUILLES_SOURCE,
  MIN_REGLES_LUES,
  MIN_PAGES_LIVREES,
  corpusPoseurs,
  feuillesDe,
  nomPose,
  nomsMortsDeLaFeuille,
  reglesSansPorteurDeLaFeuille,
} from './css-selecteurs-morts.js';

// Les noms que le site a DÉCIDÉ de ne plus générer vivent dans le propriétaire de
// la configuration de Tailwind v4 — pas dans une copie tenue ici, qui divergerait :
// la directive `@source not inline("{…}")` de `src/index.css`. Elle remplace la
// `blocklist` de v3, que v4 ne lit plus.
const FEUILLE_TAILWIND = new URL('../src/index.css', import.meta.url);

/** Les noms de `@source not inline("{…}")`. Refuse de conclure si la directive manque. */
function lireNomsNonGeneres() {
  const css = fs.readFileSync(FEUILLE_TAILWIND, 'utf8');
  const trouve = css.match(/@source not inline\("\{([^}"]*)\}"\);/);
  if (!trouve) {
    throw new Error('@source not inline("{…}") introuvable dans src/index.css : la liste des noms non générés n\'est plus lisible');
  }
  return trouve[1].split(',').map((nom) => nom.trim()).filter(Boolean);
}

const valeur = (nom, defaut) => {
  const index = process.argv.indexOf(`--${nom}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : defaut;
};
const RACINE = valeur('root', 'build');
const SOURCES = valeur('sources', 'src');

/** Toutes les feuilles `.css` d'un dossier source (récursif), triées. */
function feuillesSource(dossier) {
  const trouvees = [];
  const parcourir = (courant) => {
    for (const entree of fs.readdirSync(courant, { withFileTypes: true })) {
      const chemin = path.join(courant, entree.name);
      if (entree.isDirectory()) { parcourir(chemin); continue; }
      if (entree.name.endsWith('.css')) trouvees.push(chemin);
    }
  };
  parcourir(dossier);
  return trouvees.sort();
}

/**
 * Nombre de RÈGLES d'une feuille, règle imbriquée comprise.
 *
 * Mesuré : compter les seuls nœuds de premier niveau en trouvait 44 là où
 * `walkRules` en voit 82 (les blocs `@media`/`@layer` en cachent la moitié) — un
 * plancher de lecture adossé à ce chiffre-là refusait un arbre parfaitement sain.
 */
function compterRegles(css) {
  let n = 0;
  postcss.parse(css).walkRules(() => { n += 1; });
  return n;
}

function main() {
  if (!fs.existsSync(RACINE)) {
    throw new Error(
      `dossier de build introuvable (« ${RACINE} ») : lancer \`npm run build\` — un garde qui n'a rien lu n'a rien vérifié`
    );
  }
  // UNE SEULE lecture pour les DEUX verdicts (07/10/2026) : ce qui POSE VRAIMENT
  // une classe. L'asymétrie qui faisait lire la feuille livrée au LARGE est
  // fermée — cf. l'en-tête et `corpusPoseurs`.
  const corpus = corpusPoseurs(RACINE);
  if (
    corpus.fichiers.length < MIN_FICHIERS_CORPUS ||
    corpus.jetons.size < MIN_JETONS_CORPUS ||
    corpus.valeurs < MIN_VALEURS_CORPUS
  ) {
    throw new Error(
      `corpus illisible (${corpus.fichiers.length} fichier(s), ${corpus.jetons.size} jeton(s), ${corpus.valeurs} valeur(s) de classe) — ` +
        `planchers ${MIN_FICHIERS_CORPUS}, ${MIN_JETONS_CORPUS} et ${MIN_VALEURS_CORPUS} : juger avec un corpus vide ` +
        'déclarerait mortes des règles qui vivent ; vérifier la racine de build'
    );
  }

  // ── Verdict 1 : les feuilles SOURCE ────────────────────────────────────────
  const feuilles = feuillesSource(SOURCES);
  const divergencesSource = [];
  let reglesLues = 0;
  for (const feuille of feuilles) {
    const css = fs.readFileSync(feuille, 'utf8');
    reglesLues += compterRegles(css);
    for (const divergence of nomsMortsDeLaFeuille(css, corpus)) {
      divergencesSource.push({ feuille, ...divergence });
    }
  }
  if (feuilles.length < MIN_FEUILLES_SOURCE || reglesLues < MIN_REGLES_LUES) {
    throw new Error(
      `lecture incomplète des feuilles source (${feuilles.length} feuille(s), ${reglesLues} règle(s)) — ` +
        `planchers ${MIN_FEUILLES_SOURCE} et ${MIN_REGLES_LUES} : le lecteur n'a pas lu son sujet`
    );
  }

  // ── Verdict 2 : la feuille LIVRÉE ──────────────────────────────────────────
  const pages = fs
    .readdirSync(RACINE)
    .filter((nom) => nom.endsWith('.html'))
    .sort();
  if (pages.length < MIN_PAGES_LIVREES) {
    throw new Error(`seulement ${pages.length} page(s) livrée(s) — plancher ${MIN_PAGES_LIVREES}`);
  }
  const nomsSourceMorts = new Set(divergencesSource.flatMap((d) => d.noms));
  const divergencesLivrees = [];
  let reglesLivrees = 0;
  for (const page of pages) {
    const html = fs.readFileSync(path.join(RACINE, page), 'utf8');
    for (const feuille of feuillesDe(html)) {
      reglesLivrees += compterRegles(feuille);
      for (const divergence of reglesSansPorteurDeLaFeuille(feuille, corpus)) {
        // Déjà nommé par le verdict 1 (« alias mort écrit dans une feuille ») :
        // on ne le répète pas, la source est l'endroit où l'on répare.
        if (divergence.noms.length && divergence.noms.every((nom) => nomsSourceMorts.has(nom))) continue;
        divergencesLivrees.push({ page, ...divergence });
      }
    }
  }

  // ── Verdict 3 : les noms volontairement NON générés ─────────────────────────
  // `blocklist` retire un nom de la feuille servie. Le revers de cette décision
  // est mesuré ici : un nom bloqué mais POSÉ par le livré est une classe dont la
  // règle n'existe plus — l'autre moitié du même mensonge que ce garde combat.
  const nomsNonGeneres = lireNomsNonGeneres();
  const nomsNonGeneresPoses = nomsNonGeneres.filter((nom) => nomPose(nom, corpus.jetons, corpus.texte));

  console.log(
    `::notice::aucun sélecteur sans porteur — corpus des POSEURS ${corpus.fichiers.length} fichier(s)/${corpus.jetons.size} jetons ` +
      `issus de ${corpus.valeurs} valeur(s) de classe ; ${feuilles.length} feuille(s) source, ${reglesLues} règle(s) ; ` +
      `${pages.length} page(s), ${reglesLivrees} règle(s) livrée(s) ; ` +
      `${nomsNonGeneres.length} nom(s) volontairement NON généré(s), ${nomsNonGeneresPoses.length} posé(s)`
  );

  if (!divergencesSource.length && !divergencesLivrees.length && !nomsNonGeneresPoses.length) {
    console.log(
      `✅ Aucun sélecteur sans porteur : ${feuilles.length} feuille(s) source et ${pages.length} page(s) livrée(s) lues, ` +
        `${reglesLues + reglesLivrees} règles confrontées au corpus des poseurs (les feuilles du build en sont EXCLUES : ` +
        'une feuille ne peut que se justifier elle-même).'
    );
    return;
  }

  if (divergencesSource.length) {
    for (const d of divergencesSource) {
      console.error(
        `::error::${d.feuille}:${d.ligne} : ${d.noms.join(', ')} — nommé par « ${d.selecteur} » et posé par AUCUN élément livré ` +
          `(${d.obligatoire ? 'position obligatoire : ce sélecteur ne peut rien peindre' : 'alternative de :is()/:where() : argument à retirer'})`
      );
    }
  }
  if (divergencesLivrees.length) {
    for (const d of divergencesLivrees) {
      console.error(
        `::error::${d.page} : règle servie sans porteur « ${d.selecteur} » (${d.noms.join(', ')}) — ` +
          'GÉNÉRÉE depuis un jeton qui n\'est pas une classe (prose, identifiant, valeur CSS) ou depuis un composant ' +
          'que le build élimine : la poser, la nommer dans un registre de classes, ou CESSER DE LA GÉNÉRER ' +
          '(`blocklist` de `tailwind.config.cjs`)'
      );
    }
  }
  if (nomsNonGeneresPoses.length) {
    for (const nom of nomsNonGeneresPoses) {
      console.error(
        `::error::« ${nom} » est dans la liste des noms volontairement NON générés (\`tailwind.config.cjs\`) et il est POSÉ ` +
          'par le livré : sa règle n\'existe donc plus, et la classe ne peint rien. Le retirer du livré, ou le sortir de la liste.'
      );
    }
  }
  console.error(
    `\n❌ ${divergencesSource.length} nom(s) mort(s) dans les feuilles SOURCE, ${divergencesLivrees.length} règle(s) livrée(s) ` +
      `sans porteur et ${nomsNonGeneresPoses.length} nom(s) bloqué(s) pourtant posé(s). Une classe nommée par un sélecteur doit être ` +
      'POSÉE par le livré — la retirer de la source, ou la poser ; et une classe POSÉE doit exister dans la feuille servie.'
  );
  process.exitCode = 1;
}

try {
  main();
} catch (erreur) {
  console.error(`::error::${erreur.message}`);
  process.exitCode = 1;
}
