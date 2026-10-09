// LES RÈGLES DE « AUCUN JETON SANS LECTEUR, AUCUN MOT ÉTRANGER » — le module que
// lit le garde `scripts/check-reliquats-css.js`, qui prononce le verdict.
//
// ── Le fait, et la mesure qui l'a imposé (08/10/2026) ────────────────────────
// `src/index.css` déclarait VINGT-TROIS jetons shadcn dans sa couche `base`.
// MESURÉ sur la feuille LIVRÉE, un par un : `--radius` était lu treize fois (le
// barème des rayons, `rounded-lg|md|sm`), `--foreground` une fois — et c'était la
// couleur de TEXTE de la page (relevé au navigateur : `rgb(10, 10, 10)` sur
// `body`) —, `--background` et `--border` une fois chacun mais BATTUS par une
// règle plus tardive du site (`background-color: #f9fafb` d'`App.css`, et le
// préflight pour la bordure), et les dix-neuf autres JAMAIS.
// Le fait général, et c'est ce que ce module tient : un jeton DÉCLARÉ n'est pas
// un jeton PEINT. Un `:root` complet peut ne rien peindre du tout, et rien dans
// le dépôt ne faisait la différence — le garde de sélecteurs, lui, juge des
// NOMS DE CLASSES, pas des variables.
//
// ── Les trois règles ────────────────────────────────────────────────────────
//   1. un jeton DÉCLARÉ par une feuille du SITE (`--x: …` dans `src/**/*.css`)
//      doit avoir au moins un LECTEUR dans l'artefact livré — les blocs
//      `<style>` des pages, le JavaScript servi (une lecture peut vivre dans un
//      style en ligne) et la configuration de Tailwind. Un jeton que personne ne
//      lit ne peut rien peindre : c'est du poids mort ET un mensonge de source,
//      exactement comme une classe sans porteur ;
//   2. un `var(--x)` LU par la configuration de Tailwind doit être DÉCLARÉ par
//      une feuille du site. C'est la même règle, retournée : une configuration
//      qui lit un jeton que personne ne pose produirait un `var()` sans valeur,
//      c'est-à-dire une déclaration invalide à l'exécution. Le périmètre est la
//      CONFIGURATION et non tout l'artefact : Tailwind y lit ses propres
//      variables internes (`--tw-*`), déclarées par sa couche de base et lues
//      par les utilitaires qu'il génère — 81 jetons déclarés dans la feuille
//      livrée du 08/10/2026, dont 26 `--tw-*` qui ne sont pas le sujet du site ;
//   3. quelques MOTS sont refusés par leur NOM, pour ce que 1 et 2 ne peuvent pas
//      voir : une police de gabarit qui ne gagne nulle part, un jeton d'un paquet
//      absent de `package.json`, une animation du composant d'une bibliothèque
//      qui n'est pas installée, un `@apply` d'une couleur du thème retiré.
//      Chacun porte SA mesure : c'est la mesure qui a tranché, pas le goût.
//
// ── CE QU'UN COMMENTAIRE DIT N'EST PAS UNE DÉCLARATION NI UNE LECTURE ─────────
// Mesuré à la PREMIÈRE exécution de ce garde (08/10/2026) : le commentaire qui
// documente le retrait du bloc `.dark` cite « `--chart-4: 280 65% 60%` » — et le
// garde y a lu une DÉCLARATION, donc un jeton « sans lecteur » de plus. Même
// chose pour les commentaires qui nomment `source-code-pro`, `@apply
// text-foreground` ou `var(--radix-accordion-content-height)` : la documentation
// du retrait était signalée comme le retrait lui-même.
// C'est le piège que `scripts/check-script-deps.js` a rencontré avant ce module
// (« un `require('x')` cité dans un commentaire ou dans une chaîne de test n'est
// PAS un import ») : les commentaires sont donc BLANCHIS avant toute lecture, en
// conservant les retours à la ligne pour que les numéros de ligne du rapport
// restent ceux du fichier.
// Les CHAÎNES, elles, ne sont PAS blanchies : un `var(--x)` écrit dans une chaîne
// est une vraie lecture (un style en ligne), et la masquer fabriquerait un faux
// « jeton sans lecteur » — c'est-à-dire l'erreur inverse.
//
// Le module est PUR (aucune E/S) : c'est ce qui rend les trois règles éprouvables
// sur des cas synthétiques, et le garde sur un arbre réel.

/** Remplace une plage par des espaces en gardant les retours à la ligne (lignes justes). */
function blanchir(texte, depuis, jusqua) {
  let sortie = '';
  for (let i = depuis; i < jusqua; i += 1) sortie += texte[i] === '\n' ? '\n' : ' ';
  return sortie;
}

/** Les commentaires CSS (de l'ouvrant `/*` à sa fermeture) blanchis, lignes conservées. */
export function sansCommentairesCss(texte) {
  const s = String(texte);
  let sortie = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '/' && s[i + 1] === '*') {
      const fin = s.indexOf('*/', i + 2);
      const arret = fin === -1 ? s.length : fin + 2;
      sortie += blanchir(s, i, arret);
      i = arret;
      continue;
    }
    sortie += s[i];
    i += 1;
  }
  return sortie;
}

/**
 * Les commentaires JavaScript blanchis — `//` et les blocs ouverts par `/*` —
 * SANS toucher aux chaînes ni aux gabarits.
 *
 * L'état est suivi caractère par caractère, et ce n'est pas un luxe : un `//`
 * dans une chaîne (`'https://…'`) n'est pas un commentaire, et le prendre pour
 * tel blanchirait la fin de la ligne — donc une lecture écrite plus loin sur
 * cette même ligne deviendrait invisible, et le rapport accuserait un jeton qui
 * a bel et bien un lecteur.
 */
export function sansCommentairesJs(texte) {
  const s = String(texte);
  let sortie = '';
  let etat = 'code';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const suivant = s[i + 1];
    if (etat === 'code') {
      if (c === '/' && suivant === '*') { etat = 'bloc'; sortie += '  '; i += 2; continue; }
      if (c === '/' && suivant === '/') { etat = 'ligne'; sortie += '  '; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') etat = c;
      sortie += c;
      i += 1;
      continue;
    }
    if (etat === 'ligne') {
      if (c === '\n') { etat = 'code'; sortie += c; } else sortie += ' ';
      i += 1;
      continue;
    }
    if (etat === 'bloc') {
      if (c === '*' && suivant === '/') { sortie += '  '; i += 2; etat = 'code'; continue; }
      sortie += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    // Dans une chaîne : on recopie le contenu tel quel, seul l'échappement est suivi.
    if (c === '\\') { sortie += c + (suivant ?? ''); i += 2; continue; }
    if (c === etat) etat = 'code';
    sortie += c;
    i += 1;
  }
  return sortie;
}

/** En dessous, on refuse de juger : un lecteur cassé produirait un faux vert. */
export const MIN_FEUILLES = 2;
/** Mesuré le 08/10/2026 sur l'arbre réel : 17 jetons déclarés (1 + 11 + 5). */
export const MIN_JETONS_DECLARES = 12;
/** Mesuré : 14 pages pré-rendues, ~60 fichiers JavaScript servis. */
export const MIN_PAGES = 10;
export const MIN_LECTEURS = 10;

/** Déclaration d'un jeton : `--x: …` (le `:` est ce qui la distingue d'une lecture). */
const MOTIF_DECLARATION = /(--[A-Za-z0-9_-]+)\s*:/g;
/** Lecture d'un jeton : `var(--x)` ou `var(--x, repli)`. */
const MOTIF_LECTURE = /var\(\s*(--[A-Za-z0-9_-]+)/g;

/** Le numéro de ligne (1-indexé) d'une position dans un texte. */
export function ligneDe(texte, index) {
  const s = String(texte);
  let ligne = 1;
  for (let i = 0; i < index && i < s.length; i += 1) if (s[i] === '\n') ligne += 1;
  return ligne;
}

/**
 * Les jetons nommés par un motif, nom → première ligne où il apparaît.
 *
 * La PREMIÈRE ligne, et pas la dernière : c'est celle qu'on veut lire dans un
 * rapport, celle où la déclaration fautive a été écrite.
 */
export function jetonsNommes(css, motif) {
  const s = String(css);
  const trouves = new Map();
  // Le motif peut venir d'ailleurs et être réutilisé : on repart d'une instance
  // neuve pour ne dépendre d'aucun `lastIndex` laissé par un appel précédent.
  const re = new RegExp(motif.source, motif.flags.includes('g') ? motif.flags : `${motif.flags}g`);
  for (const m of s.matchAll(re)) {
    if (!trouves.has(m[1])) trouves.set(m[1], ligneDe(s, m.index));
  }
  return trouves;
}

/** Les jetons DÉCLARÉS par une feuille (nom → ligne). */
export const declarations = (css) => jetonsNommes(css, MOTIF_DECLARATION);
/** Les jetons LUS par une feuille ou un script (nom → ligne). */
export const lectures = (css) => jetonsNommes(css, MOTIF_LECTURE);

/**
 * Les jetons déclarés qu'AUCUN lecteur ne nomme.
 *
 * @param {Map<string, number>} declares nom → ligne de la déclaration.
 * @param {Map<string, number>|Set<string>} lues Ce qui les lit.
 * @returns {Array<{nom: string, ligne: number}>}
 */
export function jetonsSansLecteur(declares, lues) {
  const lecteurs = lues instanceof Set ? lues : new Set(lues.keys());
  return [...declares]
    .filter(([nom]) => !lecteurs.has(nom))
    .map(([nom, ligne]) => ({ nom, ligne }));
}

/**
 * Les lectures qu'AUCUNE feuille du site ne déclare.
 *
 * @param {Map<string, number>} lues nom → ligne de la lecture.
 * @param {Map<string, number>|Set<string>} declares Ce qui les déclare.
 * @returns {Array<{nom: string, ligne: number}>}
 */
export function lecturesSansDeclaration(lues, declares) {
  const poses = declares instanceof Set ? declares : new Set(declares.keys());
  return [...lues]
    .filter(([nom]) => !poses.has(nom))
    .map(([nom, ligne]) => ({ nom, ligne }));
}

// ── LES MOTS REFUSÉS PAR LEUR NOM, ET LA MESURE DE CHACUN ────────────────────
// Un refus sans mesure est un goût : chaque entrée dit ce qui a été observé sur
// la feuille livrée (ou ce qui manque dans le manifeste du projet), et c'est cet
// argument-là qui doit être rejoué le jour où quelqu'un voudra la retirer.
export const MOTS_ETRANGERS = [
  {
    id: 'police-du-gabarit',
    motif: /\bsource-code-pro\b/g,
    quoi: 'la police du gabarit Create React App',
    mesure:
      'mesuré le 08/10/2026 : la règle qui la portait ne gagnait NULLE PART — le préflight de Tailwind ' +
      '(`code,kbd,samp,pre{font-family:ui-monospace,…}`) a la même spécificité et vient PLUS TARD dans la ' +
      'feuille livrée, et le seul `<code>` réel du site (`src/pages/Profile.js`) déclare déjà `font-mono`. ' +
      'Un `<code>` créé à la volée dans le navigateur calculait bien `ui-monospace…`.',
  },
  {
    id: 'jeton-radix',
    motif: /--radix-[A-Za-z0-9_-]+/g,
    quoi: 'un jeton du paquet `@radix-ui`',
    mesure:
      'mesuré le 08/10/2026 : aucune dépendance `radix` dans `package.json` et aucun import de `@radix-ui` ' +
      'dans `src/` — un jeton lu dans un thème est un reliquat du gabarit shadcn, pas une intention.',
  },
  {
    id: 'animation-accordion',
    motif: /\baccordion-(?:down|up)\b/g,
    quoi: 'une animation du composant `Accordion` de shadcn',
    mesure:
      'mesuré le 08/10/2026 : aucun utilitaire `animate-accordion-*` posé nulle part, et ZÉRO occurrence ' +
      'd’« accordion » dans la feuille livrée — Tailwind n’émet un `@keyframes` que si son utilitaire est ' +
      'utilisé, donc ces déclarations ne servaient rien.',
  },
  {
    id: 'couleur-du-theme-retire',
    motif:
      /@apply[^;}]*?\b(?:bg|text|border|ring|divide|from|to|via|fill|stroke|placeholder|decoration|caret|accent|shadow)-(?:background|foreground|card|card-foreground|popover|popover-foreground|primary|primary-foreground|secondary|secondary-foreground|muted|muted-foreground|accent|accent-foreground|destructive|destructive-foreground|input|ring|chart-\d)\b/g,
    quoi: 'un `@apply` d’une couleur du thème shadcn retiré',
    mesure:
      'retirées le 08/10/2026 : leurs douze entrées de thème ne généraient AUCUN utilitaire (zéro règle ' +
      '`.bg-card` ou semblable dans la feuille livrée), et les trois déclarations du bloc `@apply` étaient ' +
      'battues — la bordure par le préflight, le fond par `App.css`. Seule la couleur de texte peignait, et ' +
      'elle est passée à la palette du site (`--kojo-encre`).',
  },
];

/** Les mots étrangers trouvés dans un texte, avec leur ligne et ce qui les juge. */
export function motsEtrangersDe(texte) {
  const s = String(texte);
  const trouves = [];
  for (const mot of MOTS_ETRANGERS) {
    const re = new RegExp(mot.motif.source, mot.motif.flags.includes('g') ? mot.motif.flags : `${mot.motif.flags}g`);
    for (const m of s.matchAll(re)) {
      trouves.push({
        id: mot.id,
        quoi: mot.quoi,
        mesure: mot.mesure,
        ligne: ligneDe(s, m.index),
        extrait: m[0].replace(/\s+/g, ' ').trim().slice(0, 90),
      });
    }
  }
  return trouves.sort((a, b) => a.ligne - b.ligne);
}

/**
 * Le verdict, sur des lectures DÉJÀ faites (le module ne touche pas au disque).
 *
 * @param {object} entrees
 * @param {Map<string, number>} entrees.jetonsDeclares Jetons des feuilles du site.
 * @param {Map<string, number>|Set<string>} entrees.jetonsLus Ce qui les lit.
 * @param {Map<string, number>} entrees.lecturesConfig Lectures de la configuration.
 * @param {Array<object>} entrees.mots Mots étrangers déjà trouvés.
 */
export function reliquatsDe({ jetonsDeclares, jetonsLus, lecturesConfig, mots }) {
  return {
    sansLecteur: jetonsSansLecteur(jetonsDeclares, jetonsLus),
    sansDeclaration: lecturesSansDeclaration(lecturesConfig, jetonsDeclares),
    mots,
  };
}

/** Le verdict est-il celui d'un arbre propre ? */
export const arbrePropre = (reliquats) =>
  reliquats.sansLecteur.length === 0 && reliquats.sansDeclaration.length === 0 && reliquats.mots.length === 0;

/** La phrase du verdict, pour le rapport — nommée, jamais un simple compte. */
export function phraseDeReliquats(reliquats) {
  const morceaux = [];
  morceaux.push(
    reliquats.sansLecteur.length === 0
      ? 'aucun jeton sans lecteur'
      : `${reliquats.sansLecteur.length} jeton(s) sans lecteur : ${reliquats.sansLecteur.map((j) => j.nom).join(', ')}`
  );
  if (reliquats.sansDeclaration.length) {
    morceaux.push(
      `${reliquats.sansDeclaration.length} lecture(s) sans déclaration : ${reliquats.sansDeclaration
        .map((l) => l.nom)
        .join(', ')}`
    );
  }
  if (reliquats.mots.length) {
    morceaux.push(`${reliquats.mots.length} mot(s) étranger(s) : ${reliquats.mots.map((m) => m.extrait).join(' | ')}`);
  }
  return morceaux.join(' ; ');
}
