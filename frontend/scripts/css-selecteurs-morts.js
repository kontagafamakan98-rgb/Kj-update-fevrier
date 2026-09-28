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
// ── Ce qui POSE une classe, et ce qui ne la pose pas (28/09/2026) ────────────
// Ce corpus a d'abord compté les JETONS de TOUT le texte du build. C'était trop
// large, et c'est mesuré : les cinq feuilles `kojo-pack-*.css` (292 lignes, un
// système de design étranger au site) nommaient 39 classes dont AUCUNE n'était
// posée par un élément, et le garde rendait vert — parce que leurs noms
// apparaissaient quelque part dans une chaîne, un identifiant ou une clé de
// traduction. Mesuré un par un : `card` n'était porté que par
// `<meta name="twitter:card">`, `dialog` par l'attribut `role="dialog"`,
// `overlay` par sept occurrences dans le code de Leaflet, `header` par un en-tête
// HTTP de Sentry, `toast` par une variable du contexte de notifications, et
// `dashboard`/`settings`/`jobs`/`profile` par les NOMS DE ROUTES du routeur.
// Aucune de ces occurrences ne peut peindre un `.card`.
//
// Le corpus ne retient donc plus que ce qui POSE VRAIMENT une classe :
//   • un attribut `class="…"` d'une page pré-rendue ;
//   • une position `className`/`class` — attribut JSX, propriété d'objet (la
//     forme que React reçoit après compilation), affectation `el.className = …` ;
//   • un appel `classList.add/remove/toggle/contains('…')` et
//     `setAttribute('class', '…')` ;
//   • une propriété de configuration dont le nom FINIT par `Class`
//     (`titreEntreeClass: 'titre-entree'`) : c'est la convention du dépôt pour
//     nommer une classe lue des DEUX canaux, et sans elle les noms vivants des
//     plans seraient déclarés morts.
// Tout le reste — identifiants, clés, prose, `role="dialog"`, en-têtes HTTP — ne
// peint rien et ne porte donc rien.
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
// L'AST, et pas une expression régulière : voir `classesDuJs` — un motif ne peut
// pas distinguer la valeur d'un `className` d'un argument de `console.log`.
import { parse as babelParse } from '@babel/parser';

/** En dessous, on refuse de juger : un lecteur cassé produirait un faux vert. */
export const MIN_FICHIERS_CORPUS = 20;
export const MIN_JETONS_CORPUS = 200;
// Le plancher des feuilles SOURCE était à 6, et il n'était atteint que grâce aux
// cinq `kojo-pack-*.css` : leur suppression laisse `index.css` et `App.css`. Un
// plancher qu'une dette suffit à satisfaire n'est pas un plancher — c'est un
// chiffre qui décrit l'arbre du jour. Il est ramené au sujet réel (les deux
// feuilles du site), et c'est le plancher de RÈGLES qui empêche désormais un
// lecteur cassé de rendre un vert sur du vide.
export const MIN_FEUILLES_SOURCE = 2;
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
 * Corpus LARGE : tous les jetons de tous les `.html` du build (blocs `<style>`
 * retirés) et de tous les `.js`/`.mjs`. Aucune feuille : cf. l'en-tête.
 *
 * Il est conservé pour le verdict de la feuille LIVRÉE, et c'est une asymétrie
 * assumée, mesurée le 28/09/2026 : Tailwind GÉNÈRE un utilitaire dès qu'un jeton
 * candidat apparaît quelque part dans les fichiers scannés, même là où il n'est
 * pas une classe. `index.css` ne contient pas `.container`, mais il contient
 * `containerRef` ; `ease-out` n'est écrit que dans un `animation: '… 0.3s
 * ease-out'` en style en ligne — et les deux utilitaires sont LIVRÉS, sans
 * porteur, dans les quatorze pages. Mesuré : **312 règles servies** sont dans ce
 * cas (`.container`, `.ease-out` et leurs variantes de media query). C'est une
 * dette d'un AUTRE propriétaire (la configuration de Tailwind, pas une feuille
 * source), elle n'est ni fermée ni tue ici : le verdict 2 garde donc la lecture
 * large, qui la tolérait avant et la tolère encore, et le compte est publié.
 * Les CINQ feuilles mortes, elles, ne passaient que par là : leur verdict est
 * celui du corpus STRICT ci-dessous.
 *
 * @param {string} outDir Dossier de build.
 * @returns {{jetons: Set<string>, texte: string, fichiers: string[]}}
 */
export function corpusPoseursLarge(outDir) {
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

/**
 * Corpus STRICT des POSEURS : ce qui POSE VRAIMENT une classe — cf. l'en-tête
 * (« Ce qui POSE une classe, et ce qui ne la pose pas »). C'est la lecture du
 * verdict 1, celui des feuilles SOURCE.
 *
 * @param {string} outDir Dossier de build.
 * @returns {{jetons: Set<string>, texte: string, fichiers: string[], valeurs: number}}
 */
export function corpusPoseurs(outDir) {
  const fichiers = [];
  const valeursDeClasse = [];
  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) { parcourir(chemin); continue; }
      if (!/[.](html|js|mjs)$/.test(entree.name)) continue;
      fichiers.push(chemin);
      const brut = fs.readFileSync(chemin, 'utf8');
      if (entree.name.endsWith('.html')) {
        // Le bloc `<style>` est RETIRÉ avant la lecture des attributs : sans cela
        // une feuille se justifierait elle-même, et le nom d'une classe morte
        // serait « porté » par la règle qui la décrit.
        valeursDeClasse.push(...classesDuHtml(brut.replace(RE_FEUILLE, ' ')));
      } else {
        valeursDeClasse.push(...classesDuJs(brut));
      }
    }
  };
  parcourir(outDir);
  const texte = valeursDeClasse.join('\n');
  return { jetons: jetonsDe(texte), texte, fichiers, valeurs: valeursDeClasse.length };
}

/**
 * Ce nom de clé porte-t-il une VALEUR DE CLASSE ?
 *
 *   • `className` / `class` — la position React ;
 *   • `classe` — la convention du dépôt pour un composant qui dessine une icône
 *     (`<Icone nom="croix" classe="w-5 h-5 sm:w-4 sm:h-4" />`, `IconePage`) : le
 *     prop passe ensuite au `className` du `<svg>`, et l'ignorer faisait
 *     déclarer morts 351 utilitaires LIVRÉS ;
 *   • `…Class` / `…ClassName` — la convention des plans (`titreEntreeClass`,
 *     `inputClassName`) pour une classe déclarée une fois et lue des deux canaux.
 */
const EST_UNE_CLE_DE_CLASSE = (nom) =>
  Boolean(nom) &&
  (nom === 'className' || nom === 'class' || nom === 'classe' || /Class(Name|e)?$/.test(nom));

/** Les valeurs d'un attribut `class` dans un HTML (guillemets simples ou doubles). */
export function classesDuHtml(html) {
  const valeurs = [];
  for (const m of String(html).matchAll(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (m[1] ?? m[2]) valeurs.push(m[1] ?? m[2]);
  }
  return valeurs;
}

/**
 * Les valeurs de classe d'un JavaScript COMPILÉ, lues par AST.
 *
 * L'AST est indispensable et non un confort : une expression régulière ne
 * distingue pas `className:"a b"` de `console.log("a b")`, et c'est exactement
 * la distinction que ce corpus existe pour faire. Le parseur est celui que
 * d'autres gardes du dépôt utilisent déjà (`@babel/parser`) ; en cas de fichier
 * illisible, on rend ce qu'on a — un fichier non lu ne condamne aucun nom.
 */
export function classesDuJs(code) {
  const valeurs = [];
  let ast;
  try {
    ast = babelParse(code, { sourceType: 'unambiguous', errorRecovery: true, plugins: ['jsx'] });
  } catch {
    return valeurs;
  }

  // Les IDENTIFIANTS nommés dans une position de classe (`className={`${pastille} x`}`,
  // `className={PANNEAU_FILTRES}`) : leur valeur est souvent une chaîne écrite
  // ailleurs dans le MÊME fichier, et c'est par là que deux classes VIVANTES
  // (`pastille-courante`, `panneau-filtres`) se faisaient déclarer mortes au
  // premier essai de ce corpus. Les collecter demande deux passes — d'où la
  // liste remplie pendant la visite, et relue après.
  const identifiantsDeClasse = new Set();
  const nommer = (noeud) => {
    if (noeud?.type === 'Identifier') identifiantsDeClasse.add(noeud.name);
  };

  /** Les littéraux de chaîne d'une expression, en descendant les compositions. */
  const litteraux = (noeud) => {
    if (!noeud || typeof noeud !== 'object') return;
    if (noeud.type === 'Identifier') nommer(noeud);
    switch (noeud.type) {
      case 'StringLiteral':
        valeurs.push(noeud.value);
        return;
      case 'TemplateLiteral':
        for (const quasi of noeud.quasis) if (quasi.value?.cooked) valeurs.push(quasi.value.cooked);
        // Les EXPRESSIONS d'un gabarit : c'est là que se cache la classe d'un
        // `className={`x ${cond ? 'y' : ''}`}` — ne lire que les quasis laissait
        // `pt-safe-area-inset-top` et `puce-filtre-active` sans porteur.
        for (const expression of noeud.expressions) litteraux(expression);
        return;
      case 'ArrayExpression':
        for (const element of noeud.elements) litteraux(element);
        return;
      case 'ConditionalExpression':
        litteraux(noeud.consequent);
        litteraux(noeud.alternate);
        return;
      case 'LogicalExpression':
      case 'BinaryExpression':
        litteraux(noeud.left);
        litteraux(noeud.right);
        return;
      // Un APPEL dans une position de classe (`className: clsx("a", cond && "sm:w-4")`) :
      // ses arguments sont des valeurs de classe, et l'oublier faisait déclarer
      // morts 351 utilitaires LIVRÉS lors du premier essai de ce corpus
      // (`.sm\\:w-4` et ses semblables, que Tailwind génère depuis les composants).
      case 'CallExpression':
      case 'OptionalCallExpression':
      case 'NewExpression':
        for (const argument of noeud.arguments || []) litteraux(argument);
        return;
      case 'SequenceExpression':
        for (const expression of noeud.expressions || []) litteraux(expression);
        return;
      case 'JSXExpressionContainer':
      case 'JSXElement':
      case 'ParenthesizedExpression':
        litteraux(noeud.expression || noeud);
        return;
      default:
        return;
    }
  };
  /** Les identifiants nommés par une expression, sans collecter de littéraux. */
  const identifiantsDe = (noeud, vus = new Set()) => {
    if (!noeud || typeof noeud !== 'object') return vus;
    if (Array.isArray(noeud)) {
      for (const element of noeud) identifiantsDe(element, vus);
      return vus;
    }
    if (noeud.type === 'Identifier') vus.add(noeud.name);
    for (const [cle, valeur] of Object.entries(noeud)) {
      if (cle === 'loc' || cle === 'start' || cle === 'end') continue;
      if (valeur && typeof valeur === 'object') identifiantsDe(valeur, vus);
    }
    return vus;
  };
  const nomDe = (noeud) =>
    noeud && (noeud.type === 'Identifier' || noeud.type === 'JSXIdentifier') ? noeud.name : null;
  /** Le nom d'une clé, quelle que soit la façon dont elle est écrite. */
  const nomDeCle = (noeud) =>
    noeud?.type === 'StringLiteral' || noeud?.type === 'NumericLiteral'
      ? String(noeud.value)
      : nomDe(noeud);

  const visiter = (noeud) => {
    if (!noeud || typeof noeud !== 'object') return;
    if (Array.isArray(noeud)) {
      for (const element of noeud) visiter(element);
      return;
    }
    switch (noeud.type) {
      case 'JSXAttribute': {
        const nom = nomDe(noeud.name);
        if (EST_UNE_CLE_DE_CLASSE(nom)) {
          const valeur = noeud.value;
          if (valeur?.type === 'StringLiteral') valeurs.push(valeur.value);
          else litteraux(valeur);
        }
        break;
      }
      // La variable locale qui PORTE la classe : `const panneau = 'panneau-filtres'`.
      // Elle n'est lue que si son nom a été nommé dans une position de classe —
      // sans quoi toute chaîne du fichier redeviendrait un porteur, c'est-à-dire
      // le corpus large que ce module vient de remplacer.
      case 'VariableDeclarator': {
        const nom = nomDe(noeud.id);
        if (nom && identifiantsDeClasse.has(nom)) litteraux(noeud.init);
        break;
      }
      case 'ObjectProperty':
      case 'Property': {
        const cle = nomDeCle(noeud.key);
        if (cle && EST_UNE_CLE_DE_CLASSE(cle)) {
          litteraux(noeud.value);
          // Les identifiants d'une valeur de classe (souvent un gabarit) sont
          // retenus pour la seconde passe des `VariableDeclarator`.
          for (const identifiant of identifiantsDe(noeud.value)) litteraux({ type: 'Identifier', name: identifiant });
        }
        break;
      }
      case 'AssignmentExpression': {
        const gauche = noeud.left;
        if (gauche?.type === 'MemberExpression') {
          const prop = nomDeCle(gauche.property);
          if (prop === 'className' || prop === 'class') litteraux(noeud.right);
        }
        break;
      }
      case 'CallExpression':
      case 'OptionalCallExpression': {
        const callee = noeud.callee;
        if (callee?.type === 'MemberExpression' || callee?.type === 'OptionalMemberExpression') {
          const methode = nomDeCle(callee.property);
          const objet = callee.object;
          const surListeDeClasses =
            objet?.type === 'MemberExpression' && nomDeCle(objet.property) === 'classList';
          if (surListeDeClasses && ['add', 'remove', 'toggle', 'contains'].includes(methode)) {
            for (const argument of noeud.arguments) litteraux(argument);
          }
          if (methode === 'setAttribute') {
            const [attribut, valeur] = noeud.arguments || [];
            if (attribut?.value === 'class') litteraux(valeur);
          }
        }
        break;
      }
      default:
        break;
    }
    for (const [cle, valeur] of Object.entries(noeud)) {
      if (cle === 'loc' || cle === 'start' || cle === 'end') continue;
      if (valeur && typeof valeur === 'object') visiter(valeur);
    }
  };
  visiter(ast.program || ast);
  // SECONDE PASSE : les déclarations locales des identifiants nommés dans une
  // position de classe. La première visite les a déjà rencontrées — mais elle ne
  // pouvait pas savoir, en les voyant, qu'un `className` les nommerait plus bas.
  visiter(ast.program || ast);
  // La valeur est rendue UNE fois, et c'est une correction : la seconde passe
  // relit chaque position de classe, donc un littéral y était compté DEUX fois,
  // et le compte publié par le garde (« N valeur(s) de classe ») valait le double
  // de la matière. C'est un ensemble de valeurs distinctes, pas un journal.
  return [...new Set(valeurs)];
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
