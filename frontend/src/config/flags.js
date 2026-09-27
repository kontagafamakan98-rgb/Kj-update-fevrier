// LES DRAPEAUX DESSINÉS — un propriétaire, deux canaux.
//
// ── Pourquoi ce fichier existe (27/09/2026) ────────────────────────────────
// La coquille pré-rendue de l'accueil publiait encore `country.flag` en EMOJI
// (🇲🇱 🇸🇳 🇧🇫 🇨🇮) dans ses quatre cartes « Disponible dans 4 pays », alors que
// React y peint un SVG depuis `src/components/FlagIcon.js` : deux peintures pour
// un même drapeau, et surtout la dernière chose de la coquille qui dépendît de la
// POLICE DU VISITEUR — un emoji est une suite de points de code que l'hôte rend
// comme il veut (glyphes colorés, ou rectangles vides sur un appareil sans police
// emoji). C'était donc la dernière mesure non portable du document, et la seule
// divergence de CONTENU que la sonde de géométrie nommait encore sur `/`.
// COÛT MESURÉ de la substitution (27/09/2026, variantes ENTRELACÉES, 25 tours,
// variante emoji RECONSTRUITE dans le document livré) : **−58,0 ms mobile**
// (280,4 → 222,4 ms, cpu×4) et **−13,7 ms desktop** (58,6 → 44,9 ms, cpu×1) de
// « Style & Layout », à hauteur de document IDENTIQUE (7 187 / 4 868 px) — les
// mêmes classes dimensionnent les deux peintures. Les nœuds passent de 355 à 370
// (+15 : un `<svg>` et ses aplats là où un `<div>` portait un caractère).
//
// ── Un module À PART, et pas une entrée de `page-icons.js` ─────────────────
// Le dessin devait descendre d'un seul endroit (la page ET la coquille le
// lisent : `IconeDrapeau` ici, `svgDuDrapeau` dans
// vite-plugins/prerender/icons-serveur.js). Le poser dans `page-icons.js` a été
// essayé d'abord, et MESURÉ : `FlagIcon` est importé par des composants du CHROME
// (les sélecteurs de langue et de pays), donc par le chunk d'ENTRÉE — et le
// registre d'icônes entier (~30 tracés) est monté avec lui dans le chemin
// critique. Mesuré : `index` 153,15 → 160,20 ko (initial 116,3 → 118,9 ko gzip).
// Un drapeau n'a rien à faire avec les tracés au trait des icônes (viewBox 900×600
// ou 60×30, aplats `fill`) : les séparer coûte un fichier et rend la frontière
// explicite. Après séparation, l'entrée revient à 153,04 ko / 116,5 ko gzip.
//
// ── Ce qui reste ici ───────────────────────────────────────────────────────
// Les six dessins (les quatre pays couverts + la France et le Royaume-Uni, que
// les sélecteurs affichent pour `fr` et `en`), la correspondance code → dessin
// (codes de PAYS et codes de LANGUE, parce que c'est l'usage réel des appelants),
// et le rendu React. Un nom absent fait ÉCHOUER bruyamment : la page peint une
// icône neutre (`FlagIcon`), le BUILD lève — le HTML pré-rendu n'a pas le droit
// de publier un drapeau qu'il ne sait pas dessiner (il en publiait un blanc,
// « 🏳️ », dépendant de la même police que l'emoji qu'on retire).
import { createElement } from 'react';
import { normalizeCountryCode } from '../utils/countryAliases.js';

/**
 * Le registre : un NOM STABLE vers le CONTENU de son `<svg>` et son `viewBox`.
 * Les tracés sont ceux que `src/components/FlagIcon.js` portait jusqu'ici, à
 * l'octet près (seule la notation JSX a été convertie en chaîne : `strokeWidth`
 * → `stroke-width`, `clipPath` → `clip-path`, parce que ces chaînes sont
 * injectées comme HTML des deux côtés et qu'un attribut camelCase y serait
 * ignoré).
 */
const DRAPEAUX = {
  mali: {
    viewBox: '0 0 900 600',
    contenu:
      '<rect width="300" height="600" fill="#14B53A"/><rect x="300" width="300" height="600" fill="#FFCD00"/><rect x="600" width="300" height="600" fill="#CE1126"/>',
  },
  senegal: {
    viewBox: '0 0 900 600',
    contenu:
      '<rect width="300" height="600" fill="#00853F"/><rect x="300" width="300" height="600" fill="#FDEF42"/><rect x="600" width="300" height="600" fill="#E31B23"/>' +
      '<g transform="translate(450,300)"><polygon points="0,-60 17.6,-18.5 58.8,-18.5 25.2,15 40.8,56.5 0,23 -40.8,56.5 -25.2,15 -58.8,-18.5 -17.6,-18.5" fill="#00853F"/></g>',
  },
  burkina_faso: {
    viewBox: '0 0 900 600',
    contenu:
      '<rect width="900" height="300" fill="#EF2B2D"/><rect y="300" width="900" height="300" fill="#009E49"/>' +
      '<g transform="translate(450,300)"><polygon points="0,-50 14.7,-15.5 49,-15.5 21,12.5 34,47.5 0,19 -34,47.5 -21,12.5 -49,-15.5 -14.7,-15.5" fill="#FCD116"/></g>',
  },
  ivory_coast: {
    viewBox: '0 0 900 600',
    contenu:
      '<rect width="300" height="600" fill="#F77F00"/><rect x="300" width="300" height="600" fill="#FFFFFF"/><rect x="600" width="300" height="600" fill="#009E60"/>',
  },
  france: {
    viewBox: '0 0 900 600',
    contenu:
      '<rect width="300" height="600" fill="#0055A4"/><rect x="300" width="300" height="600" fill="#FFFFFF"/><rect x="600" width="300" height="600" fill="#EF4135"/>',
  },
  royaumeUni: {
    viewBox: '0 0 60 30',
    contenu:
      '<clipPath id="uk-clip"><path d="M0,0 v30 h60 v-30 z"/></clipPath>' +
      '<path d="M0,0 v30 h60 v-30 z" fill="#012169"/>' +
      '<path d="M0,0 60,30 M60,0 0,30" stroke="#FFF" stroke-width="6" clip-path="url(#uk-clip)"/>' +
      '<path d="M0,0 60,30 M60,0 0,30" stroke="#C8102E" stroke-width="4" clip-path="url(#uk-clip)"/>' +
      '<path d="M30,0 v30 M0,15 h60" stroke="#FFF" stroke-width="10"/>' +
      '<path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/>',
  },
};

/**
 * Code → nom du dessin. Deux familles y cohabitent parce que c'est l'usage réel :
 * les codes de PAYS (`mali`, `sn`, `ivory_coast`…) des cartes et des contrôles, et
 * les codes de LANGUE (`fr`, `en`, `wo`, `bm`, `mos`) que le sélecteur de langue
 * affiche par un drapeau. `null` si rien ne correspond.
 */
const DRAPEAU_PAR_CODE = {
  mali: 'mali',
  ml: 'mali',
  bm: 'mali',
  senegal: 'senegal',
  sn: 'senegal',
  wo: 'senegal',
  burkina_faso: 'burkina_faso',
  bf: 'burkina_faso',
  mos: 'burkina_faso',
  ivory_coast: 'ivory_coast',
  ci: 'ivory_coast',
  fr: 'france',
  en: 'royaumeUni',
  gb: 'royaumeUni',
};

export function nomDuDrapeau(code) {
  const valeur = String(code ?? '')
    .toLowerCase()
    .trim();
  return DRAPEAU_PAR_CODE[normalizeCountryCode(valeur)] || DRAPEAU_PAR_CODE[valeur] || null;
}

/** Le contenu (aplats) d'un drapeau, ou une erreur bruyante si le nom est inconnu. */
export function contenuDuDrapeau(nom) {
  const drapeau = DRAPEAUX[nom];
  if (!drapeau) {
    throw new Error(
      `flags : le drapeau « ${nom} » n’est pas déclaré dans le registre — ` +
        'un canal ne peut pas dessiner un drapeau qui n’existe pas.'
    );
  }
  return drapeau.contenu;
}

/** Le viewBox d'un drapeau (900×600 pour l'essentiel, 60×30 pour le Royaume-Uni). */
export function viewBoxDuDrapeau(nom) {
  contenuDuDrapeau(nom);
  return DRAPEAUX[nom].viewBox;
}

/**
 * Le drapeau de la PAGE : un SVG de remplissage, `classe` portant la taille (un
 * SVG ne suit pas `font-size`). `data-drapeau` rend le dessin vérifiable — c'est
 * aussi ce repère qui permet de reconstruire une variante en emoji dans le
 * document livré quand on veut mesurer ce que l'emoji coûtait.
 */
export function IconeDrapeau({ nom, classe }) {
  return createElement(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: viewBoxDuDrapeau(nom),
      className: classe,
      'aria-hidden': true,
      'data-drapeau': nom,
      dangerouslySetInnerHTML: { __html: contenuDuDrapeau(nom) },
    }
  );
}
