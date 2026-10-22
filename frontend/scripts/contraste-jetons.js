// ── LE CONTRASTE PAR JETONS — la règle, sans E/S ───────────────────────────
//
// `verre-contraste.js` juge les surfaces TRANSLUCIDES (toasts, panneau) : il
// compose des piles de couches et retient le pire fond. Ce module-ci juge
// l'autre moitié du problème, celle qui restait invisible parce qu'elle
// paraissait aller de soi : les couleurs OPAQUES du site — une encre posée sur
// le papier, une teinte d'état posée sur sa pastille.
//
// ── Pourquoi « par jetons » ────────────────────────────────────────────────
// Un contraste se décide à DEUX endroits : la valeur de l'encre et celle du
// fond. Tant que les deux vivent en littéraux dispersés, une retouche d'un seul
// côté ne casse rien de visible dans le diff — elle casse la lisibilité. Les
// jetons `--kojo-*` de `src/index.css` sont donc le seul domicile de ces
// valeurs, et la règle ci-dessous les APPARIE :
//
//   • un jeton DÉCLARÉ mais jamais employé (`color: var(--kojo-x)` absent de la
//     feuille) est une erreur : une garantie qui ne peint rien ne garantit rien ;
//   • un jeton dont la VALEUR a dérivé par rapport à celle mesurée ici est une
//     erreur nommée : c'est la mesure qui a décidé la teinte, pas l'inverse ;
//   • un couple (encre, fond) sous son seuil est refusé avec son ratio et son
//     remède, jamais arrondi.
//
// Les seuils sont ceux de la norme, pas du relevé : 4,5:1 pour du texte courant
// (WCAG 1.4.3), 3:1 pour un objet graphique porteur d'information (1.4.11).
//
// ── Ce que la règle ne juge PAS, et le dit ─────────────────────────────────
// Elle ne lit que les jetons DÉCLARÉS ici : une encre écrite en littéral dans
// une règle (ou en utilitaire Tailwind dans un composant) lui échappe par
// construction. C'est pour cela que les pastilles d'état et la sélection sont
// passées aux jetons au moment où la règle est née.

/** Le seuil WCAG 1.4.3 : texte courant, en dessous de 18 pt / 14 pt gras. */
export const SEUIL_TEXTE = 4.5;

/** Le seuil WCAG 1.4.11 : objet graphique porteur d'information. */
export const SEUIL_GRAPHIQUE = 3;

/**
 * Les jetons mesurés, et leur DOMAINE D'EMPLOI (`color` ou `background-color`).
 * La valeur est celle que la feuille doit déclarer : c'est la mesure qui l'a
 * décidée, et une feuille qui s'en écarte est refusée en la nommant.
 */
export const JETONS = {
  // Encres
  encre: { valeur: '#1c1917', usage: 'color' },
  'encre-douce': { valeur: '#5c554d', usage: 'color' },
  brun: { valeur: '#7c2d12', usage: 'color' },
  'orange-fonce': { valeur: '#c2410c', usage: 'color' },
  bleu: { valeur: '#1d4ed8', usage: 'color' },
  succes: { valeur: '#15803d', usage: 'color' },
  neutre: { valeur: '#78716c', usage: 'color' },
  // Fonds
  papier: { valeur: '#fffdf9', usage: 'background-color' },
  sable: { valeur: '#f7f3ec', usage: 'background-color' },
  creme: { valeur: '#fff7ed', usage: 'background-color' },
  'bleu-fond': { valeur: '#eff6ff', usage: 'background-color' },
  'succes-fond': { valeur: '#f0fdf4', usage: 'background-color' },
  'neutre-fond': { valeur: '#fafaf9', usage: 'background-color' },
  selection: { valeur: '#fed7aa', usage: 'background-color' },
};

/**
 * Les couples que le site peint RÉELLEMENT, avec leur seuil.
 *
 * `usage` dit où le couple apparaît (un nom de règle, pas un sélecteur : la
 * règle est jugée sur les jetons, pas sur le CSS qui les porte).
 */
export const PAIRES = [
  { nom: 'texte courant sur papier', encre: 'encre', fond: 'papier', seuil: SEUIL_TEXTE, usage: 'corps de page' },
  { nom: 'texte courant sur sable', encre: 'encre', fond: 'sable', seuil: SEUIL_TEXTE, usage: 'sections alternées' },
  { nom: 'texte secondaire sur papier', encre: 'encre-douce', fond: 'papier', seuil: SEUIL_TEXTE, usage: 'notes et libellés' },
  { nom: 'texte secondaire sur sable', encre: 'encre-douce', fond: 'sable', seuil: SEUIL_TEXTE, usage: 'notes sur sable' },
  { nom: 'brun sur sélection', encre: 'brun', fond: 'selection', seuil: SEUIL_TEXTE, usage: '::selection' },
  { nom: 'orange sur crème (pastille ouverte)', encre: 'orange-fonce', fond: 'creme', seuil: SEUIL_TEXTE, usage: '.pastille-statut[open]' },
  { nom: 'orange sur papier', encre: 'orange-fonce', fond: 'papier', seuil: SEUIL_TEXTE, usage: 'liens et accents' },
  { nom: 'bleu sur bleu clair (pastille en cours)', encre: 'bleu', fond: 'bleu-fond', seuil: SEUIL_TEXTE, usage: '.pastille-statut[in_progress]' },
  { nom: 'vert sur vert clair (pastille terminée)', encre: 'succes', fond: 'succes-fond', seuil: SEUIL_TEXTE, usage: '.pastille-statut[completed]' },
  { nom: 'gris sur gris clair (pastille neutre)', encre: 'neutre', fond: 'neutre-fond', seuil: SEUIL_TEXTE, usage: '.pastille-statut[défaut]' },
  { nom: 'brun sur papier', encre: 'brun', fond: 'papier', seuil: SEUIL_TEXTE, usage: 'bande des pays' },
];

/** En dessous, la lecture est réputée incomplète et la mesure refuse de conclure. */
export const PLANCHER_JETONS = 14;
export const PLANCHER_PAIRES = 10;

const SANS_COMMENTAIRE = (css) => String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');

const normaliser = (valeur) => String(valeur || '').trim().toLowerCase();

/** Le rapport de contraste WCAG entre deux couleurs `#rrggbb` (1 → 21). */
export function contrasteEntre(couleurA, couleurB) {
  const canal = (valeur) => {
    const nombre = parseInt(String(valeur).replace('#', ''), 16) / 255;
    return nombre <= 0.04045 ? nombre / 12.92 : ((nombre + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (couleur) => {
    const hex = String(couleur).replace('#', '');
    const [r, g, b] = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map(canal);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [luminance(couleurA), luminance(couleurB)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** La valeur déclarée d'un jeton dans la feuille, ou `null`. */
function valeurDeclaree(css, jeton) {
  const motif = new RegExp(`--kojo-${jeton.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;]+);`);
  const trouve = css.match(motif);
  return trouve ? normaliser(trouve[1]) : null;
}

/** Le jeton est-il EMPLOYÉ dans le domaine qu'il prétend servir ? */
function jetonEmploye(css, jeton, usage) {
  const motif = new RegExp(
    `(?:^|[;{\\s])${usage}\\s*:\\s*var\\(\\s*--kojo-${jeton.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)`
  );
  return motif.test(css);
}

/**
 * Mesure une feuille.
 *
 * @param {string} feuille  le texte de `src/index.css`.
 * @param {{jetons?: object, paires?: object[]}} [tables]  surcharges de TEST
 *   (pour rejouer un refus sur une table construite, sans muter la feuille).
 * @returns {{erreurs: string[], verdicts: object[], ok: boolean}}
 */
export function mesurerContrasteJetons(feuille, { jetons: tableJetons = JETONS, paires: tablePaires = PAIRES } = {}) {
  const css = SANS_COMMENTAIRE(feuille);
  const erreurs = [];
  const verdicts = [];

  const jetons = Object.entries(tableJetons);
  const lecture = jetons.length < PLANCHER_JETONS
    ? `la table ne déclare que ${jetons.length} jetons (< ${PLANCHER_JETONS}) : elle ne couvre plus le site`
    : null;
  if (lecture) erreurs.push(lecture);

  let jetonsLus = 0;
  for (const [jeton, { valeur, usage }] of jetons) {
    const declaree = valeurDeclaree(css, jeton);
    if (declaree === null) {
      erreurs.push(`--kojo-${jeton} : absent de la feuille (le jeton mesuré n’y est plus déclaré)`);
      continue;
    }
    if (declaree !== normaliser(valeur)) {
      erreurs.push(
        `--kojo-${jeton} : la feuille déclare ${declaree}, la mesure a décidé ${normaliser(valeur)} — ` +
          're-mesurer avant de changer la teinte'
      );
    }
    if (!jetonEmploye(css, jeton, usage)) {
      erreurs.push(
        `--kojo-${jeton} : déclaré mais jamais employé en \`${usage}: var(--kojo-${jeton})\` — ` +
          'un jeton que rien ne peint ne garantit aucun contraste'
      );
      continue;
    }
    jetonsLus += 1;
  }

  if (jetonsLus < PLANCHER_JETONS) {
    erreurs.push(
      `la feuille ne déclare et n’emploie que ${jetonsLus} jeton(s) mesuré(s) (< ${PLANCHER_JETONS}) — ` +
        'la règle refuse de conclure sur un CSS qu’elle lit à peine'
    );
  }

  for (const paire of tablePaires) {
    const encre = tableJetons[paire.encre];
    const fond = tableJetons[paire.fond];
    if (!encre || !fond) {
      erreurs.push(`${paire.nom} : jeton d’encre ou de fond inconnu (${paire.encre} / ${paire.fond})`);
      continue;
    }
    // Un couple dont l'ENJEU est du texte ne peut pas descendre sous 3:1 « par
    // exception » : le seuil est porté par la paire, et il est lu ici.
    if (paire.seuil !== SEUIL_TEXTE && paire.seuil !== SEUIL_GRAPHIQUE) {
      erreurs.push(`${paire.nom} : seuil ${paire.seuil} hors norme (4,5 pour du texte, 3 pour un graphique)`);
      continue;
    }
    // La mesure porte sur la valeur SERVIE quand la feuille la déclare : une
    // retouche du CSS qui rend le couple illisible doit rougir, pas être
    // couverte par la valeur « décidée » ci-dessus.
    const encreServie = valeurDeclaree(css, paire.encre) || encre.valeur;
    const fondServi = valeurDeclaree(css, paire.fond) || fond.valeur;
    const ratio = contrasteEntre(encreServie, fondServi);
    verdicts.push({
      nom: paire.nom,
      usage: paire.usage,
      ratio: Number(ratio.toFixed(2)),
      seuil: paire.seuil,
      ok: ratio >= paire.seuil,
    });
  }

  if (verdicts.length < PLANCHER_PAIRES) {
    erreurs.push(
      `seulement ${verdicts.length} couple(s) mesuré(s) (< ${PLANCHER_PAIRES}) : la règle refuse de conclure ` +
        'sur une feuille qu’elle lit à peine'
    );
  }

  const enDefaut = verdicts.filter((verdict) => !verdict.ok);
  for (const defaut of enDefaut) {
    erreurs.push(
      `${defaut.nom} (${defaut.usage}) : ${defaut.ratio}:1, sous le seuil ${defaut.seuil}:1 — ` +
        'assombrir l’encre ou éclaircir le fond, puis re-mesurer'
    );
  }

  return { erreurs, verdicts, ok: erreurs.length === 0 };
}
