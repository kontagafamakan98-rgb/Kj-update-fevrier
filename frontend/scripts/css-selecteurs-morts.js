// LES RÈGLES DE « AUCUN SÉLECTEUR SANS PORTEUR » — le module que lit le garde
// `scripts/check-css-selecteurs-morts.js`, qui prononce le verdict.
//
// ── Le fait, et son propriétaire ─────────────────────────────────────────────
// Une classe (ou un id) nommée par un sélecteur doit être POSÉE par l'artefact
// livré : le JavaScript contient les littéraux de `className` que React rend, le
// HTML des pages contient ce qu'un visiteur sans JavaScript voit (les coquilles
// pré-rendues). Si aucun des deux ne porte le nom, le sélecteur ne peut rien
// peindre — il est du poids mort, et c'est un MENSONGE de source : la feuille
// décrit un site qui n'existe pas.
//
// Ce fait appartenait à `vite-plugins/purge-css-mort.js`, un ÉLAGAGE AU BUILD qui
// retirait silencieusement les règles mortes de la feuille inlinée. Il a été
// remplacé le 25/09/2026 par ce garde, pour trois raisons mesurées :
//   • l'élagage MASQUAIT la dette : la feuille servie différait des sources, et
//     personne ne pouvait lire dans `src/` ce que le site servait vraiment ;
//   • il se REFAISAIT à chaque build, avec ses deux refus (corpus illisible,
//     élagage > 35 % d'une page) comme seuls garde-fous ;
//   • il ne pouvait pas RETIRER les noms morts à l'intérieur d'un sélecteur
//     conservé (il ne jugeait qu'à la règle entière) : mesuré le 25/09/2026,
//     105 noms de classes nommés par un sélecteur et posés nulle part, 4 769 o
//     = 6,85 % de la feuille servie, que l'élagage laissait passer.
//
// Les feuilles source ont donc été élaguées UNE FOIS (36 règles mortes, 131
// sélecteurs que rien ne pouvait satisfaire, 148 arguments morts de
// `:is()`/`:where()`), et ce module interdit d'en réécrire.
//
// ── Le corpus, et pourquoi il ne contient AUCUNE feuille ─────────────────────
// Le corpus est ce qui POSE des classes : les `.html` du build — blocs `<style>`
// RETIRÉS, sinon la feuille se justifierait elle-même — et tous les `.js`/`.mjs`
// du build. Un `.css` du build est délibérément EXCLU : une feuille ne peut que
// se justifier elle-même (`purge-css-mort.js` incluait les `.css` du build, ce
// qui laissait une porte ouverte ; mesuré sur l'arbre du 25/09/2026 : la seule
// feuille du build est celle de leaflet, et l'exclure ne change AUCUN verdict).
//
// ── Ce que les décodeurs ci-dessous ont coûté, et qu'il ne faut pas défaire ──
// `RE_JETON` accepte les caractères d'une VALEUR ARBITRAIRE (`[`, `]`, `%`, `#`…)
// parce qu'ils font partie du nom (`w-[340px]`, `z-[9999]`) ; un découpage plus
// étroit coupait `w-[340px]` en `w-` et `340px`, et l'élagage retirait alors TOUS
// les utilitaires à valeur arbitraire — les cibles tactiles `min-h-[44px]` et le
// plafond `max-h-[520px]` du centre de notifications compris. `nomUtilise`
// revérifie en OUTRE le nom dans le TEXTE, bornes de nom comprises
// (`container` ne doit pas compter dans `containerRef`) : l'ensemble de jetons
// n'est qu'une optimisation, il ne doit JAMAIS suffire à condamner un nom.
// `nomsDeSelecteur` est un décodage par EXPRESSION RÉGULIÈRE construite depuis une
// CHAÎNE : écrite en littéral, elle exigeait deux antislashs et ne voyait donc
// aucun nom dans un sélecteur ÉCHAPPÉ (`.hover\:bg-gray-50`) — c'est-à-dire
// qu'elle déclarait « sans nom » des règles qui en avaient un.
import fs from 'node:fs';
import path from 'node:path';
// `postcss` au sommet, et c'est vérifié : le test de santé d'import charge TOUS
// les modules de `scripts/` — celui-ci compris — donc un import paresseux ne
// protégerait de rien et rendrait le garde dépendant d'un appel d'amorçage.
import postcss from 'postcss';

/** En dessous, on refuse de juger : un lecteur cassé produirait un faux vert. */
export const MIN_FICHIERS_CORPUS = 20;
export const MIN_JETONS_CORPUS = 200;
export const MIN_FEUILLES_SOURCE = 6;
export const MIN_REGLES_LUES = 60;
export const MIN_PAGES_LIVREES = 10;

const BS = String.fromCharCode(92);
// Jetons : identifiants tels qu'ils sont ÉCRITS dans l'artefact (`hover:bg-gray-50`,
// `-translate-x-1/2`, `md:min-h-[10rem]`…). Pas d'antislash dans le motif.
const RE_JETON = new RegExp('[A-Za-z0-9_:$./%#!*&>~+@=,' + BS + '[' + BS + ']()-]+', 'g');
// Le bloc <style> d'une page : `[^]` évite d'écrire `[\s\S]` (aucun antislash ici).
const RE_FEUILLE = new RegExp('<style[^>]*>([^]*?)</style>', 'g');
// Ce qui TERMINE un nom de classe écrit SANS antislash. `[` et `]` en font
// partie : non échappés, ils ouvrent un sélecteur d'attribut, pas un nom de
// classe (échappés, ils font partie du nom — cf. `nomsDeSelecteur`).
const DELIMITEURS = new Set([...' \t\n\r>+~,.:#()[]*=|"\'/^$!']);

/** Jetons d'un texte : l'ensemble des identifiants qui peuvent nommer une classe. */
export function jetonsDe(texte) {
  return new Set(String(texte).match(RE_JETON) || []);
}

/**
 * Ce nom apparaît-il VRAIMENT dans le corpus ? (vérification en TEXTE, bornes de
 * nom comprises : `container` ne compte pas dans `containerRef`.)
 */
export function nomPose(nom, jetons, texteCorpus) {
  if (jetons.has(nom)) return true;
  if (!texteCorpus) return false;
  const prolonge = (caractere) => caractere !== '' && /[A-Za-z0-9_-]/.test(caractere);
  for (let depuis = 0; depuis <= texteCorpus.length;) {
    const position = texteCorpus.indexOf(nom, depuis);
    if (position === -1) return false;
    const avant = position === 0 ? '' : texteCorpus[position - 1];
    const apres = texteCorpus[position + nom.length] ?? '';
    if (!prolonge(avant) && !prolonge(apres)) return true;
    depuis = position + 1;
  }
  return false;
}

/**
 * Classes et ids nommés par un sélecteur, échappements CSS RÉSOLUS.
 *
 * Un SCANNER, pas une expression régulière, et c'est un correctif mesuré : le
 * motif hérité de l'élagage retenait le nom `[&::` d'un utilitaire à valeur
 * arbitraire échappée (`.\[\&\:\:-webkit-search-cancel-button\]\:hidden`), donc
 * il déclarait « sans porteur » la classe que le JavaScript LIVRÉ porte pourtant
 * en clair, et la règle restait dans la feuille INDEMNE — un faux positif qui
 * rendait ce garde inutilisable. Ici, une PAIRE ÉCHAPPÉE (`\X`) vaut toujours un
 * caractère du nom (c'est ainsi qu'on écrit `[`, `]`, `:`, `&`, `/` dans une
 * valeur arbitraire), et seuls les caractères NUS peuvent terminer le nom.
 * Les chaînes entre guillemets sont sautées : un `.` dans `[href$=".pdf"]` n'est
 * pas un nom de classe.
 */
export function nomsDeSelecteur(selecteur) {
  const s = String(selecteur);
  const noms = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) { if (s[j] === BS) j += 1; j += 1; }
      i = j;
      continue;
    }
    if (c !== '.' && c !== '#') continue;
    if (s[i - 1] === BS) continue; // `.`/`#` échappé : il appartient à un nom
    let nom = '';
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === BS) { nom += s[j + 1] ?? ''; j += 2; continue; }
      if (DELIMITEURS.has(s[j])) break;
      nom += s[j];
      j += 1;
    }
    if (nom) noms.push(nom);
    i = j - 1;
  }
  return [...new Set(noms)];
}

/** Blocs `<style>` d'un document HTML (un tableau de leur contenu CSS). */
export function feuillesDe(html) {
  return [...String(html).matchAll(RE_FEUILLE)].map((m) => m[1]);
}

/**
 * Corpus des POSEURS : tous les `.html` du build (blocs `<style>` retirés) et
 * tous les `.js`/`.mjs`. Aucune feuille : cf. l'en-tête.
 *
 * @param {string} outDir Dossier de build.
 * @returns {{jetons: Set<string>, texte: string, fichiers: string[]}}
 */
export function corpusPoseurs(outDir) {
  const fichiers = [];
  const morceaux = [];
  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) { parcourir(chemin); continue; }
      if (/[.](html|js|mjs)$/.test(entree.name)) {
        fichiers.push(chemin);
        const contenu = fs.readFileSync(chemin, 'utf8');
        morceaux.push(entree.name.endsWith('.html') ? contenu.replace(RE_FEUILLE, ' ') : contenu);
      }
    }
  };
  parcourir(outDir);
  const texte = morceaux.join('\n');
  return { jetons: jetonsDe(texte), texte, fichiers };
}

/** Les noms de classes/ids d'un sélecteur qu'AUCUN élément du corpus ne porte. */
export function nomsMortsDe(selecteur, corpus) {
  return nomsDeSelecteur(selecteur).filter((nom) => !nomPose(nom, corpus.jetons, corpus.texte));
}

/**
 * Les règles d'une feuille SOURCE qui écrivent un nom mort.
 *
 * Le verdict est rendu NOM PAR NOM, et c'est volontaire : une règle peut garder
 * un sélecteur vivant tout en nommant un alias mort à côté (c'était le cas de
 * 105 noms dans les packs, que l'élagage au build ne pouvait pas voir), et c'est
 * ce nom-là qu'il faut retirer.
 *
 * @param {string} css Contenu d'une feuille source.
 * @param {object} corpus Corpus des poseurs (`corpusPoseurs`).
 * @param {(noeud: object) => string} [nomDeFichier] Étiquette des messages.
 * @returns {Array<{ligne: number, selecteur: string, noms: string[]}>}
 */
export function nomsMortsDeLaFeuille(css, corpus) {
  const divergences = [];
  const racine = postcss.parse(css);
  racine.walkRules((regle) => {
    for (const selecteur of regle.selectors) {
      const morts = nomsMortsDe(selecteur, corpus);
      if (!morts.length) continue;
      divergences.push({
        ligne: regle.source?.start?.line ?? 0,
        selecteur: selecteur.replace(/\s+/g, ' ').trim(),
        noms: morts,
        // Une position OBLIGATOIRE (hors :is()/:where()) rend le sélecteur
        // inapplicable ; dans un :is()/:where(), c'est une alternative à retirer.
        obligatoire: !estDansAlternative(selecteur, morts),
      });
    }
  });
  return divergences;
}

/**
 * Les règles de la feuille LIVRÉE dont AUCUN sélecteur n'est posé.
 *
 * C'est ce que l'élagage au build garantissait, et ce que ce garde reprend :
 * sans lui, un utilitaire généré par Tailwind depuis un composant ÉLIMINÉ du
 * bundle (une branche `import.meta.env.DEV`) partirait en production sans que
 * rien ne le dise.
 */
export function reglesSansPorteurDeLaFeuille(feuille, corpus) {
  const divergences = [];
  const racine = postcss.parse(feuille);
  racine.walkRules((regle) => {
    const vivants = regle.selectors.filter((selecteur) => {
      const noms = nomsDeSelecteur(selecteur);
      return noms.length === 0 || noms.some((nom) => nomPose(nom, corpus.jetons, corpus.texte));
    });
    if (vivants.length) return;
    divergences.push({
      selecteur: regle.selector.replace(/\s+/g, ' ').trim(),
      noms: [...new Set(regle.selectors.flatMap(nomsDeSelecteur))],
    });
  });
  return divergences;
}

/** Occurrences des noms d'un sélecteur avec leur position (mêmes règles que le scanner). */
function occurrencesDeNoms(selecteur) {
  const s = String(selecteur);
  const out = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) { if (s[j] === BS) j += 1; j += 1; }
      i = j;
      continue;
    }
    if ((c !== '.' && c !== '#') || s[i - 1] === BS) continue;
    let nom = '';
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === BS) { nom += s[j + 1] ?? ''; j += 2; continue; }
      if (DELIMITEURS.has(s[j])) break;
      nom += s[j];
      j += 1;
    }
    if (nom) out.push({ nom, index: i });
    i = j - 1;
  }
  return out;
}

/**
 * Un nom mort est-il dans une ALTERNATIVE (`:is()`/`:where()`) plutôt qu'en
 * position obligatoire ? Seul un scan des positions peut le dire : un nom mort en
 * position obligatoire rend le sélecteur inapplicable (l'élément devrait porter
 * une classe que personne ne pose), un nom mort dans un `:is()` se retire de la
 * liste d'arguments.
 */
function estDansAlternative(selecteur, morts) {
  const groupes = [];
  const re = /:(is|where)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  let m;
  while ((m = re.exec(selecteur))) groupes.push({ corps: m[2], debut: m.index, fin: m.index + m[0].length });
  const occurrences = occurrencesDeNoms(selecteur);
  return occurrences
    .filter((o) => morts.includes(o.nom))
    .every((o) => groupes.some((g) => o.index > g.debut && o.index < g.fin));
}
