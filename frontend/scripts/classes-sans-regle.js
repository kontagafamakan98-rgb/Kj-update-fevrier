// LES RÈGLES DE « AUCUNE CLASSE POSÉE SANS RÈGLE » — le module que lit le garde
// `scripts/check-classes-sans-regle.js`, qui prononce le verdict.
//
// ── Le fait, et son propriétaire ────────────────────────────────────────────
// Un élément de la page livrée porte une LISTE de classes ; chacune doit avoir
// une RÈGLE dans la feuille servie. Sinon l'élément est peint comme si la classe
// n'existait pas : ni erreur, ni avertissement, ni trace dans le HTML — c'est
// l'invisibilité ordinaire du CSS, et elle ne se voit qu'à l'œil.
//
// Le dépôt tenait DEUX des trois directions de ce fait, dans
// `scripts/css-selecteurs-morts.js` :
//   • un nom nommé par un sélecteur SOURCE doit être posé par le livré ;
//   • une RÈGLE servie doit avoir un porteur.
// La TROISIÈME — une classe POSÉE doit exister dans la feuille servie — n'était
// tenue que pour les neuf noms de la `blocklist` de `tailwind.config.cjs`, alors
// que le garde des sélecteurs l'écrit lui-même en toutes lettres dans son
// verdict final (« et une classe POSÉE doit exister dans la feuille servie ») :
// une phrase vraie d'un nom sur 1 230 jetons posés. C'est cette phrase-là que ce
// module rend vraie, et pour tous les noms.
//
// ── LES DEUX SUJETS : LES PAGES LIVRÉES, ET LE JAVASCRIPT LIVRÉ ─────────────
// Le fait a deux artefacts, et il ne se lit pas de la même façon dans les deux —
// c'est mesuré, et c'est ce qui décide de la lecture.
//
//   • Les PAGES n'ont aucune ambiguïté : un attribut `class=` est une position de
//     classe par définition. Et c'est l'artefact où le premier trou a été trouvé :
//     `vite-plugins/prerender/**` (les coquilles pré-rendues) n'est PAS dans le
//     `content` de Tailwind. Une classe écrite UNIQUEMENT là n'est donc générée
//     par personne — et c'est la peinture que le visiteur voit AVANT le
//     JavaScript (premier écran, élément LCP). Les autres gardes comparent déjà
//     la géométrie et les mots des deux canaux
//     (`e2e/geometrie-coquille-react.spec.js`, `e2e/texte-coquille-react.spec.js`) :
//     aucun ne comparait les CLASSES, et une classe manquante ne déplace rien —
//     elle fait seulement qu'un bouton n'est pas grisé.
//     Trouvé par cette sonde à son premier passage : `opacity-50` sur le bouton de
//     suivi de /support, écrit par `vite-plugins/prerender/shells-routes.js` tandis
//     que le composant React écrit `disabled:opacity-50` — Tailwind ne génère
//     aucune règle `.opacity-50` nue, donc la coquille publiait un bouton PLEIN
//     que React grise au montage.
//
//   • Le JAVASCRIPT LIVRÉ est le second sujet, et il a fallu une AUTRE lecture que
//     celle du corpus des poseurs. Celle du corpus est large par construction :
//     elle cherche tout ce qui POSE, et un jeton de trop ne lui coûte rien.
//     Mesuré sur le build du 09/10/2026 (`corpusPoseurs('build')` : 74 fichiers,
//     2 762 valeurs de classe, 979 jetons distincts), elle rend **255 jetons sans
//     règle servie** — `'App'`, `'mali'`, `'senegal'`, `'burkina_faso'`,
//     `'ivory_coast'`, `'/dashboard'`, `'/jobs'`, `'/messages'`, `'/support'`,
//     `'/how-it-works'`, `'leaflet-'`, `'En'`, `'cours'`, `'page'`, `'completed'`,
//     `'none'`, `'canvas'`, `<path`, `d="M15`, de la prose, des noms de route —
//     c'est-à-dire du bruit, et rien d'autre. Un
//     verdict rendu avec cette lecture serait du BRUIT, et un
//     garde qui rougit à tort finit ignoré. Le lecteur ci-dessous a donc l'autre
//     biais : il ne garde que ce qui ne PEUT PAS être autre chose qu'une classe.
//       – la POSITION est celle du corpus, et le prédicat est PARTAGÉ
//         (`EST_UNE_CLE_DE_CLASSE`) : propriété `className`/`class`/`classe`,
//         `classe*`, `*Class|ClassName|Classes`, affectation de `className`,
//         `classList.add/remove/toggle/contains`, `setAttribute('class', …)` ;
//       – la VALEUR doit être un LITTÉRAL ENTIER : une chaîne, un gabarit SANS
//         expression, les éléments littéraux d'un tableau, les deux branches d'un
//         ternaire. Un opérande de `+` est un FRAGMENT (`'bg-' + x`) ; dans un
//         gabarit À EXPRESSIONS, seuls les jetons de l'INTÉRIEUR sont gardés
//         (`` `w-5 h-5 ${x}` `` donne deux classes, `` `bg-${c}-500` `` n'en donne
//         aucune) — un jeton COLLÉ à `${…}` est un fragment par construction ;
//       – un JETON doit avoir la FORME d'un nom de classe (`estUnNomDeClasse`) :
//         l'alphabet d'une valeur de classe, au moins une lettre ou un chiffre, et
//         pas de tiret FINAL.
//     LE FAUX POSITIF QUI A DÉCIDÉ DE LA DERNIÈRE RÈGLE, ET IL EST MESURÉ : lire
//     les ARGUMENTS d'un appel écrit en position de classe — `className:
//     b("/dashboard")`, c'est-à-dire `className={lienDesktop('/dashboard')}` de
//     `src/components/Navbar.js` — rendait SEPT NOMS DE ROUTE pour des classes et
//     les déclarait « posées sans règle ». Ce n'est PAS le rôle de ce verdict de
//     juger le résultat d'un appel : les arguments d'un appel en position de
//     classe ne sont donc pas lus ici.
//     CE QUI EST TROUVÉ PAR CETTE LECTURE, sur l'arbre réel du 09/10/2026, et
//     c'est ce qui la justifie : `profile-photo-container`
//     (`src/components/ProfilePhoto.js`) et `profile-photo-uploader`
//     (`src/components/ProfilePhotoUploader.js`) étaient posées par le bundle et
//     peintes par AUCUNE règle — deux classes INERTES, invisibles pour la sonde
//     des pages (ces composants ne sont rendus que par React, jamais par une
//     coquille) et pour Tailwind (ce ne sont pas des utilitaires).
//
// ── Ce que ce module NE JUGE PAS, et pourquoi ───────────────────────────────
//   • les positions NON LITTÉRALES du JavaScript, comptées et PUBLIÉES par le
//     garde (mesuré sur le build du 09/10/2026 : 373 positions non littérales et
//     1 fragment d'assemblage que personne ne juge, et c'est écrit) : identifiant résolu par le corpus,
//     résultat d'appel, index dynamique. Ce sont exactement les positions où le
//     corpus lit de la prose — un nom qui n'est écrit QUE là est hors du verdict,
//     et c'est écrit plutôt que tu ;
//   • les feuilles : une règle servie sans porteur est le sujet du garde des
//     sélecteurs — deux gardes ne se répètent pas ;
//   • les noms de `NOMS_ACCEPTES_SANS_REGLE` : une classe peut être posée SANS
//     règle par DÉCISION, et une telle décision se déclare ici avec sa raison.
//     Deux refus la tiennent honnête : une exemption SANS MOTIF est refusée, et
//     une exemption qui n'est plus POSÉE nulle part est refusée AUSSI (une
//     exception qu'on n'ose plus retirer est une exception qui mente).
import postcss from 'postcss';
// L'AST, et pas une expression régulière : c'est la même raison que le corpus des
// poseurs — un motif ne distingue pas la valeur d'un `className` d'un argument de
// `console.log`.
import { parse as babelParse } from '@babel/parser';
import {
  EST_UNE_CLE_DE_CLASSE,
  classesDuHtml,
  nomsDeSelecteur,
} from './css-selecteurs-morts.js';

/** En dessous, on refuse de juger : un lecteur cassé produirait un faux vert. */
export const MIN_PAGES_LIVREES = 10;
export const MIN_FEUILLES_SERVIES = 2;
export const MIN_REGLES_SERVIES = 400;
export const MIN_NOMS_SERVIES = 300;
// Le plancher du SUJET (les classes DISTINCTES posées par les pages, un nom
// compté une fois même porté par treize pages). Mesuré sur l'arbre livré le
// 09/10/2026 : 312 noms distincts pour 1 116 occurrences. Un plancher que la
// dette du jour suffirait à satisfaire ne serait pas un plancher : celui-ci est
// à la moitié du mesuré, il refuse un lecteur qui n'a rien lu, pas un arbre
// pauvre.
export const MIN_CLASSES_POSEES = 150;
// Les planchers du SUJET JavaScript — mesurés sur le build du 09/10/2026 : **60
// fichiers** (dont les deux scripts du service worker), **2 638 valeurs entières**
// en position de classe et **679 jetons distincts**. Chacun est à la moitié du
// mesuré (comme `MIN_CLASSES_POSEES`), donc il refuse un lecteur qui n'a rien lu —
// pas un arbre pauvre.
export const MIN_FICHIERS_JS = 30;
export const MIN_VALEURS_JS = 1300;
export const MIN_JETONS_JS = 340;

/**
 * L'ALPHABET d'une valeur de classe, et le test de FORME qui sépare une classe
 * d'un fragment de chaîne.
 *
 * C'est l'alphabet de `RE_JETON` (le corpus des poseurs, et Tailwind lui-même) :
 * il accepte `w-[340px]`, `hover:bg-gray-50`, `-translate-x-1/2`,
 * `md:min-h-[10rem]`, `w-1/2`.
 *
 * CE TEST EST UN TEST DE FORME, ET PAS UN DICTIONNAIRE — la nuance compte : un MOT
 * de prose (`'summary'`, `'cours'`) le passe. Ce qui tient la prose hors du verdict
 * n'est pas la forme du jeton, c'est la POSITION (une clé `className`, un
 * `classList.add`) et le fait que la valeur soit un LITTÉRAL ÉCRIT LÀ — deux
 * clauses qui, elles, ne s'écrivent pas par accident dans une phrase.
 */
const ALPHABET_DE_CLASSE = /^[A-Za-z0-9_:$./%#!*&>~+@=,[\]()-]+$/;

/**
 * Ce jeton a-t-il la FORME d'un nom de classe ?
 *
 * Trois clauses, chacune nommée, et la troisième vient d'une mesure :
 *   • il ne contient que l'alphabet d'une valeur de classe ;
 *   • il porte au moins une lettre ou un chiffre (sinon c'est de la ponctuation
 *     isolée, `-` ou `:` — la ponctuation seule n'a pas de règle : elle n'est pas
 *     un nom) ;
 *   • il ne se TERMINE pas par `-`. Un nom qui finit par un tiret est le DÉBUT
 *     d'une classe assemblée (`'text-' + taille`), jamais une classe servie :
 *     Tailwind n'en produit aucune, et aucune feuille du site n'en écrit. Cette
 *     clause est un FILET, pas le mécanisme — le lecteur écarte déjà les jetons
 *     collés à une expression — mais un filet qui ne coûte rien et qui tient le
 *     jour où le lecteur, lui, changerait.
 */
export function estUnNomDeClasse(jeton) {
  if (!jeton || !ALPHABET_DE_CLASSE.test(jeton)) return false;
  if (!/[A-Za-z0-9]/.test(jeton)) return false;
  if (jeton.endsWith('-')) return false;
  return true;
}

/** Les jetons d'une VALEUR de classe : ce qui, dans une liste, a la forme d'un nom. */
export function jetonsDeClasse(valeur) {
  return String(valeur).split(/\s+/).filter(estUnNomDeClasse);
}

/** Les champs d'un nœud qui ne portent aucun code (et qu'il ne faut pas visiter). */
const CHAMPS_HORS_CODE = new Set([
  'loc',
  'start',
  'end',
  'range',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
]);

/** Le nom d'une clé de propriété, ou `null` quand elle est calculée (`[x]:`). */
const nomDeCle = (noeud) => {
  if (!noeud) return null;
  if (noeud.type === 'Identifier') return noeud.name;
  if (noeud.type === 'StringLiteral' || noeud.type === 'NumericLiteral') return String(noeud.value);
  return null;
};

/**
 * Les LITTÉRAUX ENTIERS d'une expression écrite en position de classe.
 *
 * « Entier » est le mot qui compte : une chaîne est une liste de classes, un
 * gabarit sans expression est une liste de classes, une branche de ternaire et un
 * élément de tableau sont des listes de classes. Tout le reste est un fragment ou
 * une valeur que la position ne promet pas — et les deux sont COMPTÉS (le garde
 * les publie) plutôt que lus en silence.
 *
 * @param {object} noeud Expression à lire.
 * @param {string[]} sortie Valeurs trouvées.
 * @param {{fragments: number, nonLitteral: number}} refus Compteurs des refus.
 */
function litterauxEntiers(noeud, sortie, refus) {
  if (!noeud || typeof noeud !== 'object') return;
  switch (noeud.type) {
    case 'StringLiteral':
      sortie.push(noeud.value);
      return;
    case 'TemplateLiteral':
      if (!noeud.expressions.length) {
        for (const quasi of noeud.quasis) sortie.push(quasi.value.cooked ?? '');
        return;
      }
      // Gabarit À EXPRESSIONS : seuls les jetons de l'INTÉRIEUR d'un quasi sont
      // entiers ; ceux qui touchent `${…}` sont des fragments. `` `bg-${c}-500` ``
      // ne donne donc rien, `` `w-5 h-5 ${x}` `` donne deux classes.
      noeud.quasis.forEach((quasi, index) => {
        const texte = quasi.value.cooked ?? '';
        const jetons = texte.split(/\s+/).filter(Boolean);
        if (!jetons.length) return;
        const expressionAvant = index === 0 ? null : noeud.expressions[index - 1];
        const expressionApres = index === noeud.quasis.length - 1 ? null : noeud.expressions[index];
        const debut = expressionAvant && !/^\s/.test(texte) ? 1 : 0;
        const fin = jetons.length - (expressionApres && !/\s$/.test(texte) ? 1 : 0);
        for (const jeton of jetons.slice(debut, Math.max(debut, fin))) sortie.push(jeton);
      });
      return;
    case 'ArrayExpression':
      for (const element of noeud.elements) litterauxEntiers(element, sortie, refus);
      return;
    case 'ConditionalExpression':
      litterauxEntiers(noeud.consequent, sortie, refus);
      litterauxEntiers(noeud.alternate, sortie, refus);
      return;
    case 'LogicalExpression':
      litterauxEntiers(noeud.left, sortie, refus);
      litterauxEntiers(noeud.right, sortie, refus);
      return;
    // Un OPÉRANDE DE `+` est un fragment : `'text-' + taille` ne dit pas quelle
    // classe est peinte, et le morceau de gauche n'en est pas une.
    case 'BinaryExpression':
      refus.fragments += 1;
      return;
    // Un APPEL est une valeur qu'on ne peut pas juger : `className:
    // b("/dashboard")` — `lienDesktop('/dashboard')` de `src/components/Navbar.js`
    // — rend un CHEMIN pour un argument, et le lire déclarait sept noms de route
    // « posés sans règle » (mesuré le 09/10/2026). Le corpus des POSEURS a le droit
    // de lire ce résultat (il cherche ce qui pose) ; un verdict, non.
    case 'CallExpression':
    case 'OptionalCallExpression':
    case 'NewExpression':
    case 'Identifier':
    case 'MemberExpression':
    case 'OptionalMemberExpression':
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      refus.nonLitteral += 1;
      return;
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSNonNullExpression':
      litterauxEntiers(noeud.expression, sortie, refus);
      return;
    default:
      refus.nonLitteral += 1;
  }
}

/**
 * Les expressions qu'un nœud DONNE à lire quand il EST une position de classe.
 *
 * Rend une liste (vide quand ce n'est pas une position) : la `classList` en reçoit
 * plusieurs, une propriété une seule. C'est le MÊME vocabulaire de positions que le
 * corpus des poseurs (`EST_UNE_CLE_DE_CLASSE`, partagé) — deux vocabulaires
divergeraient en silence.
 */
const expressionsDePosition = (noeud) => {
  if (noeud.type === 'ObjectProperty' || noeud.type === 'ObjectMethod') {
    return EST_UNE_CLE_DE_CLASSE(nomDeCle(noeud.key)) && noeud.value ? [noeud.value] : [];
  }
  if (noeud.type === 'JSXAttribute') {
    return EST_UNE_CLE_DE_CLASSE(noeud.name?.name) && noeud.value ? [noeud.value] : [];
  }
  if (noeud.type === 'AssignmentExpression') {
    const gauche = noeud.left;
    const nom = gauche?.type === 'Identifier' ? gauche.name : nomDeCle(gauche?.property);
    return EST_UNE_CLE_DE_CLASSE(nom) ? [noeud.right] : [];
  }
  if (noeud.type === 'CallExpression' || noeud.type === 'OptionalCallExpression') {
    const callee = noeud.callee;
    const methode = nomDeCle(callee?.property);
    const receveur = nomDeCle(callee?.object?.property);
    if (receveur === 'classList' && ['add', 'remove', 'toggle', 'contains'].includes(methode)) {
      return noeud.arguments;
    }
    const nom = callee?.type === 'Identifier' ? callee.name : methode;
    if (nom === 'setAttribute' && noeud.arguments[0]?.value === 'class') {
      return noeud.arguments.slice(1, 2);
    }
  }
  return [];
};

/**
 * Les classes POSÉES par un JavaScript livré, et pour chacune la VALEUR qui la
 * porte — même forme que `classesPoseesDePage`, pour que le garde traite les deux
 * sujets avec un seul verdict.
 *
 * Un fichier ILLISIBLE rend une lecture vide : un parseur qui échoue ne condamne
 * aucun nom (c'est la règle du corpus des poseurs, et l'inverse ferait rougir sur
 * un artefact que l'outil n'a pas su lire).
 *
 * @param {string} code JavaScript compilé.
 * @returns {{noms: string[], porteurDe: Map<string, string>, valeurs: number,
 *   fichiersRefuses: {fragments: number, nonLitteral: number}, lisible: boolean}}
 */
export function classesPoseesDuJs(code) {
  const valeurs = [];
  const refus = { fragments: 0, nonLitteral: 0 };
  let ast;
  try {
    ast = babelParse(String(code), {
      sourceType: 'unambiguous',
      errorRecovery: true,
      plugins: ['jsx'],
    });
  } catch {
    return { noms: [], porteurDe: new Map(), valeurs: 0, fichiersRefuses: refus, lisible: false };
  }

  const visiter = (noeud) => {
    if (!noeud || typeof noeud !== 'object') return;
    if (Array.isArray(noeud)) {
      for (const enfant of noeud) visiter(enfant);
      return;
    }
    if (typeof noeud.type !== 'string') return;
    for (const expression of expressionsDePosition(noeud)) litterauxEntiers(expression, valeurs, refus);
    for (const [champ, valeur] of Object.entries(noeud)) {
      if (CHAMPS_HORS_CODE.has(champ)) continue;
      if (valeur && typeof valeur === 'object') visiter(valeur);
    }
  };
  visiter(ast);

  const porteurDe = new Map();
  for (const valeur of valeurs) {
    for (const nom of jetonsDeClasse(valeur)) if (!porteurDe.has(nom)) porteurDe.set(nom, valeur);
  }
  return {
    noms: [...porteurDe.keys()].sort(),
    porteurDe,
    valeurs: valeurs.length,
    fichiersRefuses: refus,
    lisible: true,
  };
}

/**
 * Les noms qu'une page peut POSER sans qu'aucune règle ne les peigne.
 *
 * Chacun porte SA RAISON, et la raison n'est pas un commentaire : c'est ce qui
 * distingue une décision d'un oubli. Une entrée muette est refusée par le garde,
 * et une entrée qui n'est plus posée l'est aussi.
 *
 *   • `App` — l'enveloppe du chrome. Sa règle (`.App { text-align: center }`) a
 *     été RETIRÉE de `src/App.css` le 25/09/2026 : elle recentrait par HÉRITAGE
 *     tout le corps des coquilles, et c'était la cause du décalage d'encre
 *     mesuré entre les deux peintures. Le NOM, lui, reste publié par les DEUX
 *     canaux (`vite-plugins/prerender/app-chrome.js` et `src/App.js`) parce qu'il
 *     est le repère STRUCTUREL du chrome : `scripts/check-prerender-shells.js` le
 *     cherche dans `#root` (son refus « #root ne commence pas par le chrome de
 *     l'app »), et le même garde REFUSE qu'une règle le recentre. Autrement dit
 *     la classe doit être posée ET ne doit pas avoir de règle — c'est le seul
 *     nom de l'arbre dont l'absence de règle est exigée des deux côtés.
 */
export const NOMS_ACCEPTES_SANS_REGLE = {
  App:
    "enveloppe du chrome publiée par les DEUX canaux comme repère structurel " +
    "(check-prerender-shells.js exige ce nom dans #root et refuse une règle qui recentre) — " +
    'sa règle a été retirée de src/App.css le 25/09/2026 parce qu’elle recentrait par héritage',
};

// Le bloc `<style>` d'une page : `[^]` évite d'écrire `[\s\S]`. Même lecture que
// `css-selecteurs-morts.js` — une feuille ne POSE pas de classe, elle la peint.
const RE_FEUILLE = new RegExp('<style[^>]*>([^]*?)</style>', 'g');

/**
 * Les classes POSÉES par une page livrée, et pour chacune la VALEUR qui la porte.
 *
 * La valeur est rendue avec le nom parce que c'est elle qui rend le verdict
 * actionnable : lire « la classe « opacity-50 » n'a pas de règle » ne dit pas où
 * la chercher, alors que « portée par `… text-white opacity-50` » désigne la
 * ligne.
 *
 * Les blocs `<style>` sont RETIRÉS avant lecture : une feuille ne peut pas poser
 * une classe, et la laisser lire ferait dire à la feuille servie qu'elle est
 * portée par elle-même (c'est la règle du corpus des poseurs, côté sélecteurs).
 *  * @param {string} html Page livrée.
 * @returns {{noms: string[], porteurDe: Map<string, string>}}
 */
export function classesPoseesDePage(html) {
  const sansFeuilles = String(html).replace(RE_FEUILLE, ' ');
  const porteurDe = new Map();
  for (const valeur of classesDuHtml(sansFeuilles)) {
    for (const nom of String(valeur).split(/\s+/)) {
      if (!nom || porteurDe.has(nom)) continue;
      porteurDe.set(nom, valeur);
    }
  }
  // Trié : un verdict se lit dans un ordre stable, et deux exécutions sur le
  // même arbre doivent publier la même liste.
  return { noms: [...porteurDe.keys()].sort(), porteurDe };
}

/**
 * La feuille SERVIE : ses noms de CLASSE et son nombre de règles.
 *
 * Toutes les feuilles servies sont passées ensemble (blocs `<style>` des pages et
 * fichiers `.css` du build) : un nom a sa règle s'il l'a dans N'IMPORTE LAQUELLE,
 * puisque le navigateur les applique toutes.
 *
 * SEULES LES CLASSES SONT RETENUES, et c'est un refus explicite : `nomsDeSelecteur`
 * lit aussi les ID (`#root`), et se laisser disculper par un `#root` pendant
 * qu'on juge `class="root"` serait un faux vert — l'ID ne peint que l'élément qui
 * le PORTE, pas ceux qui portent la classe du même nom.
 *
 * @param {string[]} feuilles Contenus CSS servis.
 * @returns {{noms: Set<string>, regles: number}}
 */
export function feuilleServie(feuilles) {
  const noms = new Set();
  let regles = 0;
  for (const css of feuilles) {
    postcss.parse(css).walkRules((regle) => {
      regles += 1;
      for (const selecteur of regle.selectors) {
        for (const nom of nomsDeSelecteur(selecteur, { marques: '.' })) noms.add(nom);
      }
    });
  }
  return { noms, regles };
}

/**
 * Les classes posées qu'AUCUNE règle servie ne peint (exemptions déclarées
 * déduites).
 *
 * @param {Iterable<string>} posees Classes posées par les pages livrées.
 * @param {Set<string>} servies Noms de classe de la feuille servie.
 * @param {Record<string, string>} [exemptions] `NOMS_ACCEPTES_SANS_REGLE`.
 * @returns {string[]}
 */
export function classesSansRegle(posees, servies, exemptions = NOMS_ACCEPTES_SANS_REGLE) {
  return [...new Set(posees)]
    .filter((nom) => !servies.has(nom) && !Object.prototype.hasOwnProperty.call(exemptions, nom))
    .sort();
}

/**
 * Les exemptions qui ne tiennent plus : sans motif, ou plus posées nulle part.
 *
 * C'est la contrepartie sans laquelle la liste des exemptions serait une porte
 * ouverte : le jour où la classe n'est plus publiée, l'exemption ment sur le
 * sujet qu'elle protège.
 *
 * @param {Iterable<string>} posees Classes posées par les pages livrées.
 * @param {Record<string, string>} [exemptions] `NOMS_ACCEPTES_SANS_REGLE`.
 * @returns {{sansMotif: string[], perimees: string[]}}
 */
export function exemptionsEnDefaut(posees, exemptions = NOMS_ACCEPTES_SANS_REGLE) {
  const presence = new Set(posees);
  const entrees = Object.entries(exemptions);
  return {
    sansMotif: entrees.filter(([, motif]) => !String(motif ?? '').trim()).map(([nom]) => nom).sort(),
    perimees: entrees.filter(([nom]) => !presence.has(nom)).map(([nom]) => nom).sort(),
  };
}
