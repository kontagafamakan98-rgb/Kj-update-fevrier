// RÈGLE : UNE `@keyframes` DOIT ÊTRE JOUÉE, ET UNE ANIMATION JOUÉE DOIT ÊTRE
// DÉCLARÉE — le module que lit le garde `scripts/check-keyframes-animations.js`,
// qui prononce le verdict.
//
// ── Les deux faits, et pourquoi il en faut deux ─────────────────────────────
// Le nettoyage du 25/09/2026 a retiré trois `@keyframes` ORPHELINES des feuilles
// source (`fadeIn`, `slideUp`, `loading`) : déclarées, jamais jouées, du poids
// mort — la feuille décrivait un site qui n'existe pas. Et l'autre sens est pire,
// parce qu'il est SILENCIEUX : un `animation: nom` dont la `@keyframes` a disparu
// ne fait pas d'erreur dans un navigateur — l'animation ne tourne simplement
// plus, et aucun test n'échoue. Le garde « aucun sélecteur sans porteur » juge
// des SÉLECTEURS, jamais un nom d'ANIMATION : personne ne voyait ni l'un ni
// l'autre. C'est cet angle mort-ci que ce module ferme, et il rend les deux
// verdicts :
//   1. DÉCLARÉE ET JAMAIS JOUÉE — un `@keyframes N` qu'aucune déclaration
//      `animation`/`animation-name` ne nomme. Réparation : retirer la
//      déclaration.
//   2. RÉFÉRENCÉE ET DÉCLARÉE NULLE PART — une déclaration `animation`/
//      `animation-name` qui nomme N sans qu'aucun `@keyframes N` n'existe.
//      Réparation : écrire la déclaration, ou retirer l'usage.
// Les deux verdicts ne se confondent pas : le premier est du poids mort, le
// second une animation qui ne tourne plus.
//
// ── Pourquoi le décodeur doit être CONSCIENT DU JAVASCRIPT ──────────────────
// Sur cet arbre (relevé du 27/09/2026), AUCUNE des deux `@keyframes` n'est écrite
// dans une feuille `.css` : toutes deux vivent dans un littéral de gabarit d'un
// composant — `ToastContainer.js` injecte un `<style>{`@keyframes slideInRight
// {...}`}</style>`, `serviceWorkerRegistration.js` remplit le `cssText` d'un
// `<style>` par ``@keyframes slideUp {...}`` — et les usages sont des objets de
// style JSX (`style={{ animation: 'slideInRight 0.3s ease-out' }}`) et un
// `cssText`. Un lecteur qui ne lirait que le CSS ne trouverait donc NI déclaration
// NI référence : il rendrait un vert d'autant plus trompeur qu'il serait VIDE.
// C'est la raison pour laquelle la règle n'existait pas avant : une sonde naïve
// sur le JavaScript rendait **3 faux positifs sur 7 noms**, en lisant
// `animationFillMode`, `animationDelay` et un identifiant de variable comme des
// noms d'animation. D'où les trois disciplines ci-dessous.
//
// ── Ce qui rend ce décodeur honnête (et qu'il ne faut pas défaire) ──────────
//   • LES CLÉS SONT EXACTES, jamais préfixées : seules `animation` et
//     `animation-name` (CSS) / `animation` et `animationName` (JS) sont lues.
//     `animationFillMode`, `animationDelay`, `animationDuration`, `animation-
//     iteration-count`, `requestAnimationFrame`… ne sont PAS des usages — un
//     test le verrouille, parce que c'est exactement la faute historique.
//   • LA VALEUR EST DÉCODÉE, pas recopiée : un raccourci `animation` porte des
//     durées, des courbes, des mots-clés et UN nom au milieu (`slideInRight
//     0.3s ease-out`) ; prendre le premier jeton nommerait « 0.3s ». Le nom est
//     le seul jeton qui ne soit ni un temps, ni un nombre, ni un mot-clé connu,
//     ni un appel de fonction (`steps()`, `cubic-bezier()`, `var()`).
//   • UN AST, PAS UNE EXPRESSION RÉGULIÈRE : `@babel/parser` donne des nœuds de
//     chaîne et de gabarit, donc la prose d'un COMMENTAIRE n'est jamais jugée
//     (le dépôt CITE `animation:` et `@keyframes` dans 300 lignes de doc — une
//     règle qui refuserait sa propre documentation ferait effacer la mémoire du
//     projet pour rester verte). Et le nom d'un raccourci ne peut pas être
//     confondu avec une clé voisine.
//   • UN FRAGMENT DE CHAÎNE N'EST CSS QUE S'IL EN A LA FORME : un littéral n'est
//     confié à `postcss` que s'il contient `@keyframes` ou une déclaration
//     d'animation TERMINÉE (`animation: …;` / `…}`). Sans cette porte, la prose
//     française `'animation : un effet'` serait confiée au lecteur CSS ; avec
//     elle, seule une vraie déclaration passe.
//
// ── Ce que le module NE juge PAS (angles morts publiés) ─────────────────────
//   • Le `keyframes`/`animation` de `tailwind.config.cjs` : hors de `src/`, il
//     DÉCLARE et JOUE dans le même objet, et c'est Tailwind qui l'émet — le
//     juger obligerait à comprendre la génération d'utilitaires (`animate-*`),
//     qui n'est pas le sujet.
//   • Un nom ASSEMBLÉ à l'exécution (`animation: nom + suffixe`) : le module ne
//     lit que des littéraux ; ce cas est déclaré, pas deviné.
//   • Une valeur qui n'est pas un littéral de chaîne (`animation: nom`, une
//     variable) : non décodable, donc non jugée — cf. `CE_QUE_CE_GARDE_VOIT`.
//   • Le DESSIN d'une animation (les étapes `from`/`to`) : le sujet est le nom,
//     pas les images-clés.
//
// Un fichier ILLISIBLE (parse refusé) n'est pas un fichier sans faute : il est
// compté et REFUSÉ — un fichier qu'on ne sait pas lire ne peut pas être déclaré
// propre.

import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import postcss from 'postcss';

const traverse = traverseModule.default || traverseModule;

/** Extensions jugées : les feuilles et le code de l'application. */
export const EXTENSIONS = ['.css', '.js', '.jsx'];

/** Les clés EXACTES qui DÉCLARENT un usage, en CSS puis en JS (camelCase). */
export const CLES_CSS = ['animation', 'animation-name'];
export const CLES_JS = ['animation', 'animationName'];

/**
 * Les mots-clés et valeurs d'un raccourci `animation` qui ne sont JAMAIS un nom.
 * Un nom inconnu de cet ensemble, qui n'est ni un temps ni un nombre ni un appel
 * de fonction, EST le nom — c'est la règle de la spécification, appliquée à la
 * lettre plutôt que devinée.
 */
export const MOTS_NON_NOMS = new Set([
  'none', 'initial', 'inherit', 'unset', 'revert', 'revert-layer',
  'normal', 'reverse', 'alternate', 'alternate-reverse',
  'forwards', 'backwards', 'both', 'running', 'paused',
  'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear',
  'step-start', 'step-end', 'infinite',
]);

/** Un jeton est-il un NOM d'animation (et non un temps, un nombre, un mot-clé) ? */
export function estNomDanimation(jeton) {
  const nu = String(jeton).trim().replace(/^['"]|['"]$/g, '');
  if (!nu) return false;
  const bas = nu.toLowerCase();
  if (MOTS_NON_NOMS.has(bas)) return false;
  if (/^\d*\.?\d+(ms|s)$/i.test(nu)) return false; // un temps
  if (/^\d+(\.\d+)?$/.test(nu)) return false; // un nombre (une itération)
  if (nu.includes('(')) return false; // steps(), cubic-bezier(), var(), linear()
  if (nu.startsWith('--')) return false; // une variable CSS
  return /^-?[A-Za-z_][\w-]*$/.test(nu);
}

/**
 * Les NOMS d'animation d'une valeur CSS : un raccourci `animation` ou la liste de
 * `animation-name`. Les deux se découpent de la même façon — virgules en
 * séparateurs de niveau supérieur, espaces à l'intérieur d'un raccourci — et
 * c'est `estNomDanimation` qui écarte les durées, les courbes et les mots-clés.
 */
export function nomsDeValeurAnimation(valeur) {
  const noms = [];
  for (const morceau of String(valeur).split(',')) {
    for (const jeton of morceau.trim().split(/\s+/)) {
      if (estNomDanimation(jeton)) noms.push(jeton.replace(/^['"]|['"]$/g, ''));
    }
  }
  return noms;
}

/**
 * Ce littéral a-t-il la FORME d'un fragment CSS qui nous concerne ?
 *
 * La porte est étroite à dessein : `@keyframes`, ou une déclaration d'animation
 * TERMINÉE (`animation: …;` ou `…}`). La prose française `'animation : un
 * effet'` est ainsi écartée AVANT d'atteindre le lecteur CSS, tandis que le
 * `cssText` d'un composant (`animation: slideUp 0.3s ease-out;`) entre.
 */
export function ressembleACss(texte) {
  const t = String(texte);
  if (/@(-webkit-)?keyframes\b/.test(t)) return true;
  return /animation(-name)?\s*:[^;{}]*[;}]/.test(t);
}

/**
 * Le texte CSS d'un littéral JS, ou `null` s'il n'y en a pas. Un gabarit AVEC
 * expressions est refusé : concaténer ses morceaux inventerait un CSS que
 * personne n'écrit.
 */
export function texteCssDeLitteral(noeud) {
  if (noeud.type === 'StringLiteral') return noeud.value;
  if (noeud.type === 'TemplateLiteral' && noeud.expressions.length === 0) {
    return noeud.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('');
  }
  return null;
}

/** Le nom d'une at-rule de déclaration : `keyframes` ou son préfixe vendeur. */
const RE_AT_RULE_KEYFRAMES = /^(?:-webkit-)?keyframes$/i;

/** Un nom de `@keyframes`, guillemets éventuels retirés. */
export function nomDeDeclarationDe(atRule) {
  return String(atRule.params || '').trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Lecteur CSS : les DÉCLARATIONS (`@keyframes N`) et les RÉFÉRENCES
 * (`animation`/`animation-name`) d'un texte CSS.
 *
 * `ligneDeBase` dit à quelle ligne du FICHIER correspond la ligne 1 du fragment —
 * un `cssText` commence après le backtick, sur la même ligne que lui. Les nœuds
 * `Comment` sont ignorés par construction (on ne visite que les at-rules et les
 * déclarations), donc un commentaire CSS qui cite `@keyframes fadeIn` ne
 * ressuscite pas `fadeIn`.
 *
 * @param {string} texte Contenu CSS (fichier entier ou fragment).
 * @param {{ligneDeBase?: number}} [options]
 * @returns {{declarations: Array<{nom: string, ligne: number}>, references: Array<{nom: string, ligne: number}>}}
 */
export function lireCss(texte, { ligneDeBase = 1 } = {}) {
  const declarations = [];
  const references = [];
  const racine = postcss.parse(texte);
  const ligne = (noeud) => ligneDeBase + (noeud.source?.start?.line ?? 1) - 1;

  racine.walkAtRules((atRule) => {
    if (!RE_AT_RULE_KEYFRAMES.test(atRule.name)) return;
    const nom = nomDeDeclarationDe(atRule);
    if (nom) declarations.push({ nom, ligne: ligne(atRule) });
  });
  racine.walkDecls((decl) => {
    if (!CLES_CSS.includes(decl.prop.toLowerCase())) return;
    for (const nom of nomsDeValeurAnimation(decl.value)) {
      references.push({ nom, ligne: ligne(decl) });
    }
  });
  return { declarations, references };
}

/**
 * Lecteur JavaScript : ce que le code DÉCLARE (un `@keyframes` dans un littéral
 * de gabarit, e.g. `<style>{`@keyframes x {…}`}</style>`) et ce qu'il JOUE
 * (objet de style JSX `{ animation: 'x 0.3s' }`, affectation `el.style.animation
 * = 'x'`, `setProperty('animation', 'x')`, `cssText` portant une déclaration).
 *
 * @param {string} code Source JS/JSX.
 * @param {string} fichier Étiquette des occurrences.
 * @returns {{declarations: Array<{nom,ligne}>, references: Array<{nom,ligne}>, illisible: boolean}}
 */
export function lireJs(code, fichier = '') {
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'classProperties', 'dynamicImport', 'importMeta', 'optionalChaining', 'nullishCoalescingOperator'],
      errorRecovery: false,
    });
  } catch (_erreur) {
    return { declarations: [], references: [], illisible: true };
  }

  const declarations = [];
  const references = [];
  const pousserReferences = (nom, ligne) => references.push({ nom, ligne: ligne || 1 });

  // Un fragment CSS porté par un littéral : confié à `lireCss`, décalé de la
  // ligne du littéral. Les déclarations ET les références en sortent.
  const lireFragment = (noeud, texte) => {
    if (!texte || !ressembleACss(texte)) return;
    let lu;
    try {
      lu = lireCss(texte, { ligneDeBase: noeud.loc?.start?.line || 1 });
    } catch (_erreur) {
      // Un littéral qui a la forme d'un CSS mais que `postcss` refuse n'est pas
      // un fichier : il est écarté, pas déclaré illisible (cf. l'en-tête).
      return;
    }
    for (const d of lu.declarations) declarations.push(d);
    for (const r of lu.references) references.push(r);
  };

  // Un usage porté par une VALEUR de propriété de style. On n'y décode que si la
  // valeur n'est PAS un fragment CSS — sinon `lireFragment` le ferait deux fois.
  const lireValeur = (noeud, ligne) => {
    const texte = texteCssDeLitteral(noeud);
    if (texte === null || ressembleACss(texte)) return;
    for (const nom of nomsDeValeurAnimation(texte)) pousserReferences(nom, ligne);
  };

  traverse(ast, {
    ObjectProperty(chemin) {
      const cle = chemin.node.key;
      const nomCle =
        cle?.type === 'Identifier' ? cle.name :
        cle?.type === 'StringLiteral' ? cle.value : null;
      if (!nomCle || !CLES_JS.includes(nomCle)) return;
      lireValeur(chemin.node.value, chemin.node.loc?.start?.line);
    },
    AssignmentExpression(chemin) {
      const gauche = chemin.node.left;
      if (gauche?.type !== 'MemberExpression' || gauche.computed) return;
      const prop = gauche.property;
      const nomProp = prop?.type === 'Identifier' ? prop.name : null;
      if (!nomProp || !CLES_JS.includes(nomProp)) return;
      lireValeur(chemin.node.right, chemin.node.loc?.start?.line);
    },
    CallExpression(chemin) {
      const callee = chemin.node.callee;
      if (callee?.type !== 'MemberExpression' || callee.computed) return;
      const prop = callee.property;
      if (prop?.type !== 'Identifier' || prop.name !== 'setProperty') return;
      const cle = chemin.node.arguments?.[0];
      const nomCle = cle?.type === 'StringLiteral' ? cle.value : null;
      if (!nomCle || !CLES_CSS.includes(nomCle.toLowerCase())) return;
      lireValeur(chemin.node.arguments?.[1], chemin.node.loc?.start?.line);
    },
    StringLiteral(chemin) {
      lireFragment(chemin.node, chemin.node.value);
    },
    TemplateLiteral(chemin) {
      const texte = texteCssDeLitteral(chemin.node);
      if (texte !== null) lireFragment(chemin.node, texte);
    },
  });

  return { declarations, references, illisible: false };
}

/**
 * L'audit complet, sans aucune E/S : les fichiers sont passés en clair, ce qui
 * rend la règle éprouvable par mutation de chaîne.
 *
 * @param {{fichiers: Array<{chemin: string, texte: string}>}} sources
 * @returns {{
 *   declarations: Array<{chemin, ligne, nom}>,
 *   references: Array<{chemin, ligne, nom}>,
 *   jamaisJouees: Array<{chemin, ligne, nom}>,
 *   jamaisDeclarees: Array<{chemin, ligne, nom}>,
 *   illisibles: string[],
 *   lus: number,
 * }}
 */
export function analyserSources({ fichiers }) {
  const declarations = [];
  const references = [];
  const illisibles = [];

  for (const fichier of fichiers || []) {
    const chemin = String(fichier?.chemin || '');
    const texte = String(fichier?.texte ?? '');
    const extension = EXTENSIONS.find((suffixe) => chemin.endsWith(suffixe)) || '.js';

    let lu;
    if (extension === '.css') {
      try {
        const resultat = lireCss(texte, { ligneDeBase: 1 });
        lu = { ...resultat, illisible: false };
      } catch (_erreur) {
        lu = { declarations: [], references: [], illisible: true };
      }
    } else {
      lu = lireJs(texte, chemin);
    }

    if (lu.illisible) illisibles.push(chemin);
    for (const d of lu.declarations) declarations.push({ chemin, ...d });
    for (const r of lu.references) references.push({ chemin, ...r });
  }

  // Le verdict se rend par NOM, pas par occurrence : une `@keyframes` jouée une
  // seule fois est vivante, même si elle est déclarée deux fois ; et une
  // animation nommée par trois composants est vivante si la déclaration existe.
  const declarees = new Set(declarations.map((d) => d.nom));
  const jouees = new Set(references.map((r) => r.nom));

  return {
    declarations,
    references,
    jamaisJouees: declarations.filter((d) => !jouees.has(d.nom)),
    jamaisDeclarees: references.filter((r) => !declarees.has(r.nom)),
    illisibles: [...new Set(illisibles)],
    lus: (fichiers || []).length,
  };
}

/**
 * Ce que CE garde voit, et ce qu'il ne peut pas voir — publié pour être comparé
 * au relevé de CI-COVERAGE.md, pas pour être cru.
 */
export const CE_QUE_CE_GARDE_VOIT = {
  voit: [
    'une `@keyframes` déclarée dans une feuille `.css` OU dans un littéral de gabarit JavaScript (`<style>{`@keyframes x {…}`}</style>`), jamais jouée par une déclaration `animation`/`animation-name`',
    'une déclaration `animation`/`animation-name` (raccourci ou liste de `animation-name`) qui nomme une animation dont AUCUN `@keyframes` n’existe — en CSS comme dans un objet de style JSX, une affectation `el.style.animation`, un `setProperty(…, …)` ou un `cssText`',
    'le fichier ET la ligne, pour que le refus soit réparable',
  ],
  nePeutPasVoir: [
    'un nom ASSEMBLÉ à l’exécution (`animation: nom + suffixe`, une valeur qui n’est pas un littéral) : le module ne lit que des littéraux',
    'le `keyframes`/`animation` de `tailwind.config.cjs`, hors de `src/`, qui déclare et joue dans le même objet et dont la feuille est GÉNÉRÉE par Tailwind',
    'un nom cité par une feuille LIVRÉE mais absent de `src/` : le sujet est la source de l’application, pas le fragment qu’un plugin injecte',
  ],
};
