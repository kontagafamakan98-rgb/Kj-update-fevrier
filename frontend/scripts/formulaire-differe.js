// RÈGLE : LES BLOCS DIFFÉRÉS DU FORMULAIRE DE /register SONT POSÉS PAR LES DEUX
// CANAUX, AVEC UNE CONSTANTE DE HAUTEUR DE CONTENU DANS LA FEUILLE.
//
// ── Ce que la règle protège, et pourquoi il faut deux propriétaires ─────────
// Le levier `content-visibility: auto` de la feuille d'accueil
// (`src/App.css`) s'appuie sur `contain-intrinsic-size` pour que le document
// garde la MÊME hauteur levier actif et levier neutralisé : la constante EST la
// hauteur de contenu du bloc, padding et bordure retranchés. Si cette constante
// disparaît, le bloc retombe sur la taille de repli (0) et la page s'effondre —
// c'est exactement ce que mesure la sonde du document.
//
// Deux canaux peignent /register : React (`src/pages/Register.js`) et la
// coquille pré-rendue (`vite-plugins/prerender/shells-routes.js`). Une classe
// posée d'un seul côté ferait diverger les deux peintures, et la parité
// coquille↔React (e2e/geometrie-coquille-react, e2e/texte-coquille-react) n'est
// mesurée QUE sur les routes déclarées : ce garde-ci refuse la divergence à la
// SOURCE, avant qu'un build ne la rende invisible.
//
// ── Angles morts assumés ────────────────────────────────────────────────────
//   - La règle lit les classes comme des SUITES DE CARACTÈRES (`bloc-differe-…`),
//     jamais l'AST JSX : une classe composée dynamiquement
//     (`` `bloc-differe-${x}` ``) échapperait à la lecture. Les quatre blocs de
//     /register sont écrits en clair, et un cas le verrouille.
//   - Elle ne juge PAS la valeur de la constante (elle vérifie la FORME
//     « auto <nombre>px ») : que 539,8 px soit la vraie hauteur de contenu est
//     une mesure, pas une propriété du texte — c'est la sonde du document qui
//     la refuse si elle se casse.

/** Les quatre blocs différés, dans l'ordre de la feuille. La LISTE est la règle. */
export const BLOCS_DIFFERES = [
  'bloc-differe-photo',
  'bloc-differe-legal',
  'bloc-differe-envoi',
  'bloc-differe-lien',
];

/** La feuille qui porte le levier ET les constantes. */
export const FEUILLE = 'src/App.css';

/** Les deux canaux qui doivent poser la MÊME classe sur le même bloc. */
export const CANAUX = [
  { nom: 'React (src/pages/Register.js)', chemin: 'src/pages/Register.js' },
  {
    nom: 'coquille (vite-plugins/prerender/shells-routes.js)',
    chemin: 'vite-plugins/prerender/shells-routes.js',
  },
];

/** Une classe différée : `bloc-differe-` suivi d'au moins une lettre. Le nom
 *  nu `bloc-differe` (celui de la feuille injectée du harnais de mesure, entre
 *  guillemets) ne compte donc PAS comme une classe — c'est un motif de sonde. */
const MOTIF_CLASSE = /bloc-differe-[a-z][a-z-]*/g;

const MOTIF_CONSTANTE = /\.(bloc-differe-[a-z-]+)\s*\{[^}]*?contain-intrinsic-size\s*:\s*([^;}]+)/g;

const MOTIF_TAILLE_CONTENU = /^auto\s+\d+(?:\.\d+)?px$/;

/** Retire les commentaires CSS : la prose de la feuille NOMME le sujet, elle ne
 *  doit pas être prise pour un sélecteur. */
export function retirerCommentairesCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Les classes différées CITÉES par un texte (feuille ou canal), sans doublon. */
export function classesCitees(texte) {
  return [...new Set(texte.match(MOTIF_CLASSE) || [])];
}

/**
 * Les constantes `contain-intrinsic-size` de la feuille, par classe.
 *
 * @returns {Map<string, string[]>} classe → valeurs déclarées (mobile, puis
 *   desktop s'il y en a une : un même bloc peut avoir deux formes).
 */
export function constantesDeLaFeuille(feuille) {
  const css = retirerCommentairesCss(feuille);
  const parClasse = new Map();
  for (const correspondance of css.matchAll(MOTIF_CONSTANTE)) {
    const classe = correspondance[1];
    const valeur = correspondance[2].trim();
    if (!parClasse.has(classe)) parClasse.set(classe, []);
    parClasse.get(classe).push(valeur);
  }
  return parClasse;
}

/**
 * Audite la parité des blocs différés de /register. Aucune E/S : les textes
 * sont passés en clair, ce qui rend la règle éprouvable par mutation.
 *
 * @param {{ feuille: string, canaux: Array<{nom: string, texte: string}> }} sources
 * @returns {string[]} les problèmes, en clair, nommant toujours la classe et la
 *   source fautives. Vide = la règle tient.
 */
export function analyserFormulaireDiffere({ feuille, canaux }) {
  const problemes = [];
  const css = retirerCommentairesCss(feuille);

  if (!/content-visibility\s*:\s*auto/.test(css)) {
    problemes.push(
      `la feuille ${FEUILLE} déclare des classes différées sans jamais poser « content-visibility: auto » — le levier a disparu`
    );
  }

  const classesFeuille = classesCitees(css);
  const constantes = constantesDeLaFeuille(css);

  for (const classe of BLOCS_DIFFERES) {
    if (!classesFeuille.includes(classe)) {
      problemes.push(
        `${classe} : listé dans BLOCS_DIFFERES mais absent de ${FEUILLE} — la classe n'a pas de propriétaire`
      );
    }
    const valeurs = constantes.get(classe) || [];
    if (valeurs.length === 0) {
      problemes.push(
        `${classe} : aucune « contain-intrinsic-size » dans ${FEUILLE} — le bloc retomberait sur la taille de repli (0) et le document s'effondrerait`
      );
    }
    for (const valeur of valeurs) {
      if (!MOTIF_TAILLE_CONTENU.test(valeur)) {
        problemes.push(
          `${classe} : la constante « ${valeur} » n'est pas une taille de contenu (attendu « auto <nombre>px »)`
        );
      }
    }
  }

  for (const classe of classesFeuille) {
    if (!BLOCS_DIFFERES.includes(classe)) {
      problemes.push(
        `${classe} : déclaré dans ${FEUILLE} mais absent de BLOCS_DIFFERES — ce garde ne saurait pas ce qui doit rester en parité`
      );
    }
  }

  for (const canal of canaux) {
    const citees = classesCitees(canal.texte);
    for (const classe of BLOCS_DIFFERES) {
      if (!citees.includes(classe)) {
        problemes.push(
          `${classe} : ${canal.nom} ne le pose pas — les DEUX canaux doivent poser la même classe`
        );
      }
    }
    for (const classe of citees) {
      if (!BLOCS_DIFFERES.includes(classe)) {
        problemes.push(
          `${classe} : ${canal.nom} le pose mais ${FEUILLE} / BLOCS_DIFFERES ne le connaît pas`
        );
      }
    }
  }

  return problemes;
}
