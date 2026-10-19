// ── LE CONTRASTE DU VERRE — la règle, sans E/S ──────────────────────────────
//
// Ce module rend UN verdict : les surfaces de verre du site gardent-elles leurs
// encres lisibles, y compris quand ce qui passe DERRIÈRE elles est sombre ?
// Il ne lit pas de fichier et n'imprime rien : il reçoit le texte de la feuille
// (`src/index.css`), y cherche les règles DÉCLARÉES, et calcule. C'est ce qui
// permet de le faire mordre sur des feuilles mutées, dans son test.
//
// ── POURQUOI CETTE MESURE EXISTE ──────────────────────────────────────────
// Le verre chaud est translucide (`backdrop-filter` + un fond à 82 %), et c'est
// exactement ce qui rend un contraste INCALCULABLE à l'œil : le ratio d'un texte
// dépend de ce qui défile derrière lui. Les surfaces d'ÉTAT (les quatre toasts,
// le bandeau d'échec du panneau) portent de plus une teinte, donc un texte de
// couleur — et c'est le couple le plus fragile du site : une teinte claire sur
// une teinte claire, à 12 px.
//
// Le 19/10/2026, ce module a mesuré ce que personne n'avait mesuré : l'encre
// secondaire du panneau (`stone-500`, #78716c) tenait 4,56:1 sur le papier mais
// 3,17:1 sur le verre composé au-dessus d'un contenu sombre — sous le seuil de
// 4,5:1 d'un petit texte. C'est ce chiffre qui a décidé `--kojo-encre-douce`
// (#5c554d), et non un goût.
//
// ── COMMENT LE PIRE CAS EST CALCULÉ ───────────────────────────────────────
// Chaque exigence déclare une PILE de couches (la plus basse d'abord) et une
// encre. La pile est composée par-dessus DEUX fonds de référence : le sable du
// site (ce qui est derrière, au repos) et l'ENCRE du site (#1c1917, le contenu
// sombre qui peut passer sous une surface flottante). Le verdict retient le
// pire des deux — un fond clair n'est pas le pire cas d'une vitre.
//
// Les couches sont composées dans l'ordre et avec leur alpha RÉEL : une surface
// à 0,94 laisse 6 % du fond décider, une à 0,72 en laisse 28 %. C'est pour ça
// qu'une ligne « non lue » posée SUR le panneau garde son contraste alors qu'un
// toast isolé, lui, a besoin d'être presque opaque.
//
// ── CE QUE LA MESURE NE JUGE PAS ──────────────────────────────────────────
// Ni le `backdrop-filter` lui-même (un navigateur qui l'ignore n'est pas mesuré
// ici : le repli `@supports not` reçoit le papier PLEIN, donc il ne peut pas
// être pire), ni la taille réelle des glyphes, ni les ombres. Elle ne juge pas
// non plus les utilitaires Tailwind d'un composant : elle lit UNIQUEMENT les
// règles de la feuille. Une encre écrite en utilitaire (`text-stone-500`) lui
// échappe donc par construction — c'est pour ça que les surfaces d'état et
// l'encre neutre du panneau ont été DÉPLACÉES dans la feuille au même moment.
//
// ── LES SEUILS VIENNENT DE LA NORME, PAS DU RELEVÉ ────────────────────────
// 4,5:1 est le seuil WCAG 1.4.3 du texte courant ; 3:1 celui de 1.4.11 pour un
// objet graphique (le filet d'état, une icône). Le relevé du jour (5,0:1 au pire
// pour le texte, 4,2:1 pour un filet) laisse une marge, et c'est une marge : le
// jour où une retouche rend 4,6:1, la mesure reste juste.

/** Le seuil WCAG 1.4.3 : texte courant, en dessous de 18 pt / 14 pt gras. */
export const SEUIL_TEXTE = 4.5;

/** Le seuil WCAG 1.4.11 : objet graphique porteur d'information. */
export const SEUIL_GRAPHIQUE = 3;

/**
 * Les fonds de référence d'une surface flottante.
 *
 * `sable` est le fond de l'application ; `encre` est le PIRE cas plausible — du
 * contenu sombre sous une vitre. Les deux sont des jetons du site, recopiés ici
 * comme VALEURS DE MESURE (un fond ne peut pas être lu dans la feuille : il
 * n'est pas déclaré comme une règle, il est le sujet de la mesure).
 */
export const FONDS_DE_REFERENCE = [
  { nom: 'sable', couleur: '#f7f3ec' },
  { nom: 'encre', couleur: '#1c1917' },
];

/** En dessous, la lecture est réputée incomplète et la mesure refuse de conclure. */
export const PLANCHER_DE_MESURES = 12;

const texte = (selecteur) => ({ selecteur, propriete: 'color', categorie: 'texte' });
const filet = (selecteur) => ({ selecteur, propriete: 'border-left-color', categorie: 'graphique' });

const toast = (nom, classes) => [
  {
    nom: `toast ${nom} — texte`,
    couches: [[classes, 'background-color']],
    encre: texte(classes),
    seuil: SEUIL_TEXTE,
  },
  {
    nom: `toast ${nom} — filet d'état`,
    couches: [[classes, 'background-color']],
    encre: filet(classes),
    seuil: SEUIL_GRAPHIQUE,
  },
];

/**
 * LES EXIGENCES, une par couple (surface, encre) que le site peint.
 *
 * Une exigence dont la règle DISPARAÎT n'est pas ignorée : elle devient une
 * erreur nommée (voir `mesurerVerre`), sans quoi supprimer une surface d'état
 * rendrait la mesure plus verte en la rendant plus courte.
 */
export const EXIGENCES = [
  ...toast('succès', '.verre-toast-succes'),
  ...toast('erreur', '.verre-toast-erreur'),
  ...toast('avertissement', '.verre-toast-avertissement'),
  ...toast('information', '.verre-toast-information'),
  {
    nom: 'panneau — encre neutre',
    couches: [['.verre-panneau', 'background-color']],
    encre: texte('.verre-panneau'),
    seuil: SEUIL_TEXTE,
  },
  {
    nom: 'panneau — en-tête',
    couches: [
      ['.verre-panneau', 'background-color'],
      ['.verre-panneau-entete', 'background-color'],
    ],
    encre: texte('.verre-panneau-entete'),
    seuil: SEUIL_TEXTE,
  },
  {
    nom: "panneau — bandeau d'échec",
    couches: [
      ['.verre-panneau', 'background-color'],
      ['.panneau-alerte', 'background-color'],
    ],
    encre: texte('.panneau-alerte'),
    seuil: SEUIL_TEXTE,
  },
  {
    nom: 'panneau — ligne non lue',
    couches: [
      ['.verre-panneau', 'background-color'],
      ['.panneau-ligne-non-lue', 'background-color'],
    ],
    encre: texte('.verre-panneau'),
    seuil: SEUIL_TEXTE,
  },
  {
    nom: 'panneau — ligne non lue au survol',
    couches: [
      ['.verre-panneau', 'background-color'],
      ['.panneau-ligne-non-lue:hover', 'background-color'],
    ],
    encre: texte('.verre-panneau'),
    seuil: SEUIL_TEXTE,
  },
  {
    nom: 'panneau — ligne lue au survol',
    couches: [
      ['.verre-panneau', 'background-color'],
      ['.panneau-ligne-lue:hover', 'background-color'],
    ],
    encre: texte('.verre-panneau'),
    seuil: SEUIL_TEXTE,
  },
];

/** Un commentaire CSS peut contenir des accolades : on le retire AVANT de lire. */
const sansCommentaires = (css) => String(css).replace(/\/\*[\s\S]*?\*\//g, '');

const MOTIF_BLOC = /([^{}]+)\{([^{}]*)\}/g;

const declarationsDe = (corps) => {
  const declarations = new Map();
  for (const morceau of corps.split(';')) {
    const separateur = morceau.indexOf(':');
    if (separateur < 0) continue;
    declarations.set(morceau.slice(0, separateur).trim(), morceau.slice(separateur + 1).trim());
  }
  return declarations;
};

/**
 * Tous les blocs d'une feuille dont la LISTE de sélecteurs contient `selecteur`,
 * dans l'ordre du fichier. Plusieurs blocs peuvent matcher (la règle, puis son
 * repli `@supports`) : c'est voulu, le repli doit être LISIBLE, et l'appelant
 * prend le premier quand il veut la valeur peinte.
 */
export const blocsDe = (css, selecteur) => {
  const blocs = [];
  for (const match of sansCommentaires(css).matchAll(MOTIF_BLOC)) {
    const prelude = match[1].split(',').map((morceau) => morceau.trim());
    if (!prelude.includes(selecteur)) continue;
    blocs.push(declarationsDe(match[2]));
  }
  return blocs;
};

/** La première valeur déclarée d'une propriété, ou `undefined`. */
export const declaration = (css, selecteur, propriete) => {
  for (const bloc of blocsDe(css, selecteur)) {
    if (bloc.has(propriete)) return bloc.get(propriete);
  }
  return undefined;
};

/** Les variables de la feuille (`--kojo-*` et les autres), sans E/S. */
export const jetonsDe = (css) => {
  const jetons = new Map();
  for (const match of sansCommentaires(css).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    jetons.set(match[1], match[2].trim());
  }
  return jetons;
};

/**
 * Une couleur `#rrggbb`, `#rgb` ou `rgba(...)` → `{ r, g, b, a }` (0-255, 0-1).
 * Un `var(--jeton)` est résolu UNE fois (le site n'empile pas les variables).
 * Tout le reste est REFUSÉ : une mesure qui devine ce qu'elle ne comprend pas
 * est une mesure qui ment.
 */
export const analyserCouleur = (valeur, jetons = new Map(), profondeur = 0) => {
  if (typeof valeur !== 'string' || !valeur.trim()) {
    throw new Error(`couleur « ${valeur} » — vide ou absente`);
  }
  const brut = valeur.trim();
  const variable = brut.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (variable) {
    if (profondeur > 3) throw new Error(`couleur « ${valeur} » — variable circulaire`);
    const remplacee = jetons.get(variable[1]);
    if (remplacee === undefined) {
      throw new Error(`couleur « ${valeur} » — le jeton ${variable[1]} n'est pas déclaré`);
    }
    return analyserCouleur(remplacee, jetons, profondeur + 1);
  }
  const hex = brut.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const chiffres = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return {
      r: parseInt(chiffres.slice(0, 2), 16),
      g: parseInt(chiffres.slice(2, 4), 16),
      b: parseInt(chiffres.slice(4, 6), 16),
      a: 1,
    };
  }
  const fonction = brut.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/
  );
  if (fonction) {
    return {
      r: Number(fonction[1]),
      g: Number(fonction[2]),
      b: Number(fonction[3]),
      a: fonction[4] === undefined ? 1 : Number(fonction[4]),
    };
  }
  throw new Error(
    `couleur « ${valeur} » — la mesure ne lit que #rrggbb, #rgb et rgba(...), ` +
      'et ne devine rien (une couleur nommée ou un dégradé ne se compose pas ici)'
  );
};

/** La luminance relative WCAG (0 → 1). */
export const luminanceRelative = ({ r, g, b }) => {
  const canal = (valeur) => {
    const part = valeur / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
};

/** Le rapport de contraste WCAG entre deux couleurs (1 → 21). */
export const contrasteEntre = (a, b) => {
  const clair = Math.max(luminanceRelative(a), luminanceRelative(b));
  const sombre = Math.min(luminanceRelative(a), luminanceRelative(b));
  return (clair + 0.05) / (sombre + 0.05);
};

/** `dessus` posé sur `dessous`, avec l'alpha réel du dessus (source-over). */
export const composer = (dessus, dessous) => {
  const alpha = dessus.a + dessous.a * (1 - dessus.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const melange = (haut, bas) => (haut * dessus.a + bas * dessous.a * (1 - dessus.a)) / alpha;
  return {
    r: melange(dessus.r, dessous.r),
    g: melange(dessus.g, dessous.g),
    b: melange(dessus.b, dessous.b),
    a: alpha,
  };
};

const arrondi = (valeur) => Number(valeur.toFixed(3));

/**
 * LE VERDICT. Lit la feuille, compose chaque pile sur les deux fonds de
 * référence, retient le pire des deux et le compare au seuil de l'exigence.
 *
 * @param {string} css Le texte de `src/index.css`.
 * @returns {{ ok: boolean, erreurs: string[], verdicts: object[], pire: object|null }}
 */
export const mesurerVerre = (css) => {
  const jetons = jetonsDe(css);
  const lire = (selecteur, propriete) => {
    const valeur = declaration(css, selecteur, propriete);
    if (valeur === undefined) {
      throw new Error(`« ${selecteur} » ne déclare pas « ${propriete} » — la surface a quitté la feuille`);
    }
    return analyserCouleur(valeur, jetons);
  };

  const erreurs = [];
  const verdicts = [];

  for (const exigence of EXIGENCES) {
    let encre;
    try {
      encre = lire(exigence.encre.selecteur, exigence.encre.propriete);
    } catch (erreur) {
      erreurs.push(`${exigence.nom} : ${erreur.message}`);
      continue;
    }

    let pire = null;
    try {
      for (const fond of FONDS_DE_REFERENCE) {
        let surface = analyserCouleur(fond.couleur);
        for (const [selecteur, propriete] of exigence.couches) {
          surface = composer(lire(selecteur, propriete), surface);
        }
        const ratio = contrasteEntre(encre, surface);
        if (pire === null || ratio < pire.ratio) {
          pire = { ratio: arrondi(ratio), fond: fond.nom, surface };
        }
      }
    } catch (erreur) {
      erreurs.push(`${exigence.nom} : ${erreur.message}`);
      continue;
    }

    verdicts.push({
      nom: exigence.nom,
      seuil: exigence.seuil,
      categorie: exigence.encre.categorie,
      pire,
      ok: pire.ratio >= exigence.seuil,
    });
  }

  if (verdicts.length < PLANCHER_DE_MESURES) {
    erreurs.push(
      `lecture incomplète : ${verdicts.length} paire(s) mesurée(s) pour un plancher de ` +
        `${PLANCHER_DE_MESURES} — la feuille lue n'est pas celle du verre du site`
    );
  }

  const pire =
    verdicts.length === 0
      ? null
      : verdicts.reduce((a, b) => (b.pire.ratio < a.pire.ratio ? b : a));

  return {
    ok: erreurs.length === 0 && verdicts.every((verdict) => verdict.ok),
    erreurs,
    verdicts,
    pire,
  };
};
