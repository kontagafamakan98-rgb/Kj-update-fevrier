// RÈGLE : UN DRAPEAU EST UN DESSIN DU REGISTRE, JAMAIS UN CARACTÈRE — et le
// champ `flag` des données pays/langue/géolocalisation ne revient pas.
//
// ── Ce que la règle protège ─────────────────────────────────────────────────
// Les données pays et langue portaient un champ `flag` valant un EMOJI
// (`🇲🇱`, `🌍`…), et trois journaux l'interpolaient. Pendant que React peignait
// un SVG du registre (`src/config/flags.js`), la coquille pré-rendue publiait
// cet emoji : DEUX peintures pour un même drapeau, et surtout une dépendance à
// la POLICE DU VISITEUR — mesuré : −58,0 ms mobile / −13,7 ms desktop de
// « Style & Layout » en remplaçant les quatre emoji de l'accueil par les dessins
// (variantes entrelacées). Le champ a été retiré de `src/config/countries.js`,
// `src/services/geolocation-database.js`, `src/services/geolocationService.js`
// (dont `AVAILABLE_LANGUAGES` et l'objet pays neutre), `src/contexts/
// CountryContext.js`, puis des deux fixtures de test qui le portaient encore.
//
// Ce que cette règle ajoute à ce retrait : il ne peut pas REVENIR en silence. Un
// `flag: '🇲🇱'` recopié dans une donnée, une paire d'indicateurs régionaux
// glissée dans un dictionnaire ou dans le registre des langues, et le garde
// rougit en nommant le fichier et la ligne.
//
// ── Deux refus, et pourquoi les deux ────────────────────────────────────────
//   1. EMOJI DE DRAPEAU, dans TOUTE la source de l'application (`src/**`) : une
//      paire d'indicateurs régionaux (`🇲🇱`, U+1F1E6–U+1F1FF) ou le drapeau
//      blanc (`🏳️`, U+1F3F3). Un seul indicateur suffit à refuser : c'est déjà
//      un caractère de drapeau, et c'est la faute qu'on veut voir. Le drapeau
//      vient du registre (`IconeDrapeau`, `svgDuDrapeau`) — donc l'écrire en
//      emoji ailleurs est TOUJOURS une seconde peinture.
//   2. CHAMP `flag`, dans les modules de DONNÉES seulement (la liste
//      `MODULES_DONNEES`, chacune justifiée) : le champ lui-même est mort, quelle
//      que soit sa valeur. La borne est là pour ne pas condamner un `flag`
//      homonyme ailleurs — `flags.js` est le registre des DESSINS, `FlagIcon`
//      est le composant, et `backendUrl.js` a un booléen local nommé `flag`.
//
// ── Ce que la règle ne juge PAS, et ce qu'elle masque ──────────────────────
// Les COMMENTAIRES sont masqués (plages de `@babel/parser`, donc sans se tromper
// sur un `//` qui appartient à une chaîne, e.g. `https://…`) : la prose du dépôt
// CITE les emoji qu'elle raconte (`src/config/flags.js` et
// `src/components/FlagIcon.js` expliquent le remplacement en montrant `🇲🇱`), et
// une règle qui refuserait sa propre documentation ferait effacer la mémoire du
// projet pour rester verte. Ce qui est jugé, c'est le CODE.
//
// Un fichier ILLISIBLE (parse refusé) n'est pas un fichier sans faute : il est
// compté et REFUSÉ — un fichier qu'on ne sait pas lire ne peut pas être déclaré
// propre.

import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;

/**
 * LES MODULES DE DONNÉES : le champ `flag` y est mort, par décision mesurée.
 * Chaque entrée dit POURQUOI ce module est dans la liste — un module ajouté
 * sans raison serait une exemption qui ne s'explique pas.
 */
export const MODULES_DONNEES = [
  {
    chemin: 'src/config/countries.js',
    pourquoi: 'le référentiel des pays, lu par les DEUX canaux (le bundle et la coquille pré-rendue de l’accueil)',
  },
  {
    chemin: 'src/config/languages.js',
    pourquoi: 'le référentiel des langues, propriétaire unique des libellés publiés par les deux barres de navigation',
  },
  {
    chemin: 'src/services/geolocation-database.js',
    pourquoi: 'la base pays de repli (`FALLBACK_COUNTRY_DATA`), utilisée avant le chargement du backend',
  },
  {
    chemin: 'src/services/geolocationService.js',
    pourquoi: 'les objets pays et LANGUE construits (`AVAILABLE_LANGUAGES`, objet neutre, `getCountriesList`…)',
  },
  {
    chemin: 'src/contexts/CountryContext.js',
    pourquoi: 'le pays courant par défaut du contexte, un objet pays comme les autres',
  },
];

/**
 * Un caractère de DRAPEAU : une paire d'indicateurs régionaux (U+1F1E6–U+1F1FF,
 * dont UN SEUL suffit à refuser) ou le drapeau blanc (U+1F3F3, avec ou sans
 * sélecteur de variation).
 *
 * La classe est quantifiée `{1,2}` : `🇲🇱` est DEUX points de code, mais UN SEUL
 * drapeau — sans ce quantificateur, le refus nommerait la même ligne deux
 * fois, et le rapport ferait croire à deux fautes là où il n'y en a qu'une. Une
 * suite de trois indicateurs (`🇲🇱🇫🇷`) reste bien DEUX occurrences.
 */
export const MOTIF_EMOJI_DRAPEAU = /[\u{1F1E6}-\u{1F1FF}]{1,2}|[\u{1F3F3}]/gu;

/** Extensions jugées : le code de l'application et ses dictionnaires. */
export const EXTENSIONS = ['.js', '.jsx', '.json'];

/** Les plages de COMMENTAIRES d'un code JS — vides si le parse échoue. */
export function plagesDeCommentaires(code) {
  const ast = parse(code, {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'classProperties', 'dynamicImport', 'importMeta', 'optionalChaining', 'nullishCoalescingOperator'],
  });
  return (ast.comments || []).map((commentaire) => [commentaire.start, commentaire.end]);
}

/** Remplace les plages par des ESPACES : la ligne et la colonne restent justes. */
export function masquerPlages(texte, plages) {
  const caracteres = [...texte];
  for (const [debut, fin] of plages) {
    for (let i = debut; i < fin && i < caracteres.length; i += 1) caracteres[i] = ' ';
  }
  return caracteres.join('');
}

/** Le numéro de ligne (1-indexé) d'un décalage dans un texte. */
export function ligneDe(texte, decalage) {
  let ligne = 1;
  for (let i = 0; i < decalage && i < texte.length; i += 1) {
    if (texte[i] === '\n') ligne += 1;
  }
  return ligne;
}

/**
 * Les emoji de drapeau du CODE d'un fichier (commentaires masqués).
 *
 * @param {string} code Source du fichier.
 * @param {string} [extension] `.js`/`.jsx` (parse + masquage) ou `.json` (tel quel).
 * @returns {{ details: Array<{ligne: number}>, illisible: boolean }}
 */
export function emojiDrapeauDe(code, extension = '.js') {
  const estJson = extension === '.json';
  let aJuger = code;
  if (!estJson) {
    try {
      aJuger = masquerPlages(code, plagesDeCommentaires(code));
    } catch (_erreur) {
      // Un fichier illisible n'est pas propre : on le dit, on ne le juge pas.
      return { details: [], illisible: true };
    }
  }
  const details = [];
  for (const correspondance of aJuger.matchAll(MOTIF_EMOJI_DRAPEAU)) {
    details.push({ ligne: ligneDe(code, correspondance.index) });
  }
  return { details, illisible: false };
}

/**
 * Les propriétés nommées `flag` d'un fichier JS (clé d'objet ou attribut JSX),
 * avec leur ligne. Les commentaires ne sont pas visités (c'est un AST).
 *
 * @param {string} code Source JS.
 * @returns {{ details: Array<{ligne: number}>, illisible: boolean }}
 */
export function champsFlagDe(code) {
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'classProperties', 'dynamicImport', 'importMeta', 'optionalChaining', 'nullishCoalescingOperator'],
    });
  } catch (_erreur) {
    return { details: [], illisible: true };
  }

  const details = [];
  const estFlag = (noeud) => {
    if (!noeud) return false;
    if (noeud.type === 'Identifier' && noeud.name === 'flag') return true;
    // Un attribut JSX est un `JSXIdentifier`, jamais un `Identifier` : sans ce
    // cas, `<IconeDrapeau flag="x" />` glisserait — et c'est justement par un
    // attribut que le composant consommait `country.flag`.
    if (noeud.type === 'JSXIdentifier' && noeud.name === 'flag') return true;
    if (noeud.type === 'StringLiteral' && noeud.value === 'flag') return true;
    return false;
  };

  traverse(ast, {
    ObjectProperty(chemin) {
      if (estFlag(chemin.node.key)) details.push({ ligne: chemin.node.loc?.start?.line || 0 });
    },
    ObjectMethod(chemin) {
      if (estFlag(chemin.node.key)) details.push({ ligne: chemin.node.loc?.start?.line || 0 });
    },
    JSXAttribute(chemin) {
      if (estFlag(chemin.node.name)) details.push({ ligne: chemin.node.loc?.start?.line || 0 });
    },
  });

  return { details, illisible: false };
}

/**
 * L'audit complet. Aucune E/S : les fichiers sont passés en clair, ce qui rend
 * la règle éprouvable par mutation de chaîne.
 *
 * @param {{ fichiers: Array<{chemin: string, texte: string}>, modulesDonnees?: object[] }} sources
 * @returns {{
 *   emoji: Array<{chemin: string, ligne: number}>,
 *   champsFlag: Array<{chemin: string, ligne: number}>,
 *   illisibles: string[],
 *   lus: number,
 * }}
 */
export function analyserSources({ fichiers, modulesDonnees = MODULES_DONNEES }) {
  const modules = new Set(modulesDonnees.map((module) => module.chemin));
  const emoji = [];
  const champsFlag = [];
  const illisibles = [];

  for (const fichier of fichiers || []) {
    const chemin = String(fichier?.chemin || '');
    const texte = String(fichier?.texte ?? '');
    const extension = EXTENSIONS.find((suffixe) => chemin.endsWith(suffixe)) || '.js';

    const drapeau = emojiDrapeauDe(texte, extension);
    if (drapeau.illisible) illisibles.push(chemin);
    for (const detail of drapeau.details) emoji.push({ chemin, ligne: detail.ligne });

    if (modules.has(chemin) && extension !== '.json') {
      const champ = champsFlagDe(texte);
      if (champ.illisible) illisibles.push(chemin);
      for (const detail of champ.details) champsFlag.push({ chemin, ligne: detail.ligne });
    }
  }

  return { emoji, champsFlag, illisibles: [...new Set(illisibles)], lus: (fichiers || []).length };
}

/**
 * Ce que CE garde voit, et ce qu'il ne peut pas voir — publié pour être comparé
 * à `flags-drapeaux.test.js` (le registre) et au garde de coquille, pas pour
 * être cru.
 */
export const CE_QUE_CE_GARDE_VOIT = {
  voit: [
    'un emoji de drapeau écrit dans le CODE d’un fichier de `src/` (`.js`, `.jsx`, `.json`), même dans une branche jamais exécutée',
    'une propriété `flag` des modules de données, quelle que soit sa valeur',
    'le fichier ET la ligne, pour que le refus soit réparable',
  ],
  nePeutPasVoir: [
    'un emoji ASSEMBLÉ à l’exécution (`String.fromCodePoint(0x1F1F2)`), qui n’est pas un caractère du fichier',
    'un emoji de drapeau dans un fichier de `public/`, du backend ou d’un `node_modules` livré — le sujet est la source de l’application',
    'le fait qu’un DESSIN du registre soit juste : c’est `flags-drapeaux.test.js` qui éprouve les tracés, pas ce garde-ci',
  ],
};
