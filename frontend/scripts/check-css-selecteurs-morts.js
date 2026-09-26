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
 *   2. FEUILLE LIVRÉE (les blocs `<style>` des pages du build) — le verdict qui
 *      préserve la garantie de l'élagage : AUCUNE règle servie ne doit rester
 *      sans porteur. Il attrape ce que le premier ne peut pas voir, puisqu'aucune
 *      feuille source ne l'écrit : un utilitaire que Tailwind GÉNÈRE depuis un
 *      composant que le bundle de production élimine (une branche
 *      `import.meta.env.DEV`) — mesuré le 25/09/2026 : 2 utilitaires, 199 o par
 *      page, invisibles autrement.
 * Les verdicts ne se répètent pas : un nom déjà nommé par le 1 est retiré des
 * règles signalées par le 2.
 *
 * ── Les refus (un vert sans lecture est un faux vert) ───────────────────────
 * Le garde REFUSE de rendre un verdict si le build est absent, si le corpus est
 * trop petit (moins de 20 fichiers ou 200 jetons), s'il lit moins de 6 feuilles
 * source, moins de 60 règles ou moins de 10 pages. Un lecteur cassé doit échouer,
 * pas rassurer — c'est le mode d'échec de ce genre de contrôle.
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
  MIN_FEUILLES_SOURCE,
  MIN_REGLES_LUES,
  MIN_PAGES_LIVREES,
  corpusPoseurs,
  feuillesDe,
  nomsMortsDeLaFeuille,
  reglesSansPorteurDeLaFeuille,
} from './css-selecteurs-morts.js';

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
  const corpus = corpusPoseurs(RACINE);
  if (corpus.fichiers.length < MIN_FICHIERS_CORPUS || corpus.jetons.size < MIN_JETONS_CORPUS) {
    throw new Error(
      `corpus illisible (${corpus.fichiers.length} fichier(s), ${corpus.jetons.size} jeton(s)) — ` +
        'juger avec un corpus vide déclarerait mortes des règles qui vivent ; vérifier la racine de build'
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

  console.log(
    `::notice::aucun sélecteur sans porteur — corpus ${corpus.fichiers.length} fichier(s)/${corpus.jetons.size} jetons ; ` +
      `${feuilles.length} feuille(s) source, ${reglesLues} règle(s) ; ${pages.length} page(s), ${reglesLivrees} règle(s) livrée(s)`
  );

  if (!divergencesSource.length && !divergencesLivrees.length) {
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
          'probablement GÉNÉRÉE par Tailwind depuis un composant que le build élimine : poser ces classes, ou cesser de les écrire'
      );
    }
  }
  console.error(
    `\n❌ ${divergencesSource.length} nom(s) mort(s) dans les feuilles SOURCE et ${divergencesLivrees.length} règle(s) livrée(s) ` +
      'sans porteur. Une classe nommée par un sélecteur doit être POSÉE par le livré — la retirer de la source, ou la poser.'
  );
  process.exitCode = 1;
}

try {
  main();
} catch (erreur) {
  console.error(`::error::${erreur.message}`);
  process.exitCode = 1;
}
