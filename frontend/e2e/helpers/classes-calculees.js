/**
 * La liste de classes CALCULÉE de chaque élément rendu, comparée entre la
 * coquille pré-rendue et le premier rendu de React.
 *
 * ── Ce que les gardes statiques ne voient pas ───────────────────────────────
 * `scripts/check-classes-coquilles.js` lit les LITTÉRAUX du code : il prouve
 * qu'une classe n'est pas recopiée, il ne prouve pas que les deux peintures
 * portent les mêmes classes à l'exécution (une classe composée, un état React
 * ou une classe ajoutée par un hook n'existent que dans le DOM). Cette sonde
 * mesure le DOM rendu : pour chaque élément visible de la coquille, l'élément
 * React qui occupe la MÊME boîte (même balise, mêmes coordonnées à 0,5 px près,
 * même ancêtre apparié) doit porter les MÊMES classes, et un écart est nommé
 * par sa paire.
 *
 * ── Ce qui est comparé, exactement ──────────────────────────────────────────
 * L'ensemble des classes de `classList`, trié, après rendu. Ce n'est PAS le
 * style calculé : deux classes différentes peuvent peindre la même chose (et
 * une même classe peut être neutralisée par la cascade). La comparaison est
 * donc plus SÉVÈRE que le rendu — elle dit « ces deux éléments ne portent pas
 * les mêmes classes », pas « ils ne se voient pas pareil ». Le style calculé
 * reste une sonde à écrire à part si ce resserrement devient nécessaire.
 *
 * ── Les écarts déclarés ─────────────────────────────────────────────────────
 * Une liste que la coquille publie SEULE (un état que React n'atteint jamais au
 * premier rendu, cf. `CLASSES_PROPRES_AUX_COQUILLES` dans
 * `scripts/classes-coquilles.js`) est attendue différente de React. Elle n'est
 * pas une divergence : c'est la décision déjà écrite, avec son motif. La sonde
 * ne la recopie pas, elle la LIT — et ne l'accepte que pour la liste exacte
 * déclarée, jamais pour une liste voisine.
 *
 * ── Le protocole ────────────────────────────────────────────────────────────
 * Identique à `geometrie.js` (c'est le même harnais, pas une copie) : la
 * coquille avec le bundle d'entrée bloqué, puis React au premier rendu figé.
 */
import { ENTREE_APPLICATION, MARQUEUR_DE_MONTAGE, attendreLaStabilite, gelerLePremierRendu, ouvrirLaPage } from './geometrie.js';

export { ENTREE_APPLICATION, MARQUEUR_DE_MONTAGE, attendreLaStabilite, gelerLePremierRendu, ouvrirLaPage };

/** Tolérance de boîte : la mise en page est en pixels entiers des deux côtés. */
export const TOLERANCE_BOITE_PX = 0.5;

/**
 * Capture les éléments VISIBLES de la page, dans l'ordre du document (ordre
 * de pré-parcours), avec la balise, la boîte, les classes après rendu et
 * l'index de l'ancêtre visible le plus proche. Sérialisée vers le navigateur :
 * aucune référence de module ici.
 */
export const CAPTURE_CLASSES = () => {
  const arrondi = (valeur) => +valeur.toFixed(2);
  const exclus = 'style,script,noscript,template,head,title,select,textarea';
  const visibles = [...document.querySelectorAll('body *')].filter((element) => {
    if (element.closest(exclus)) return false;
    // Les enfants d'un SVG sont du dessin ; l'élément `svg` lui-même porte ses classes.
    if (element.localName !== 'svg' && element.closest('svg')) return false;
    const r = element.getBoundingClientRect();
    return element.getClientRects().length > 0 && r.width > 0 && r.height > 0;
  });
  const index = new Map(visibles.map((element, i) => [element, i]));
  const ancetre = (element) => {
    let parent = element.parentElement;
    while (parent) {
      if (index.has(parent)) return index.get(parent);
      parent = parent.parentElement;
    }
    return null;
  };
  return visibles.map((element, i) => {
    const r = element.getBoundingClientRect();
    return {
      id: i,
      parent: ancetre(element),
      tag: element.localName,
      x: arrondi(r.x),
      y: arrondi(r.y),
      w: arrondi(r.width),
      h: arrondi(r.height),
      classes: [...element.classList].sort(),
    };
  });
};

/** Deux boîtes coïncident quand les quatre côtés sont à la tolérance près. */
const memeBoite = (a, b) =>
  Math.abs(a.x - b.x) <= TOLERANCE_BOITE_PX &&
  Math.abs(a.y - b.y) <= TOLERANCE_BOITE_PX &&
  Math.abs(a.w - b.w) <= TOLERANCE_BOITE_PX &&
  Math.abs(a.h - b.h) <= TOLERANCE_BOITE_PX;

const memeEnsemble = (a, b) => a.length === b.length && a.every((valeur, i) => valeur === b[i]);

/**
 * Apparie les éléments de la coquille à ceux de React, par balise et boîte, en
 * exigeant que leurs ANCÊTRES APPARIÉS coïncident aussi : deux `div` de même
 * boîte imbriquées ne peuvent pas se croiser. Un élément sans homologue (React
 * ajoute un wrapper, la coquille en a un de plus) n'est pas une divergence : il
 * est compté, et le journal le dit.
 *
 * @param {Array<object>} coquille Capture de la coquille (ordre du document).
 * @param {Array<object>} react Capture de React (ordre du document).
 * @returns {{paires: Array<{coquille: object, react: object}>, nonAppariesCoquille: number, nonAppariesReact: number}}
 */
export function apparier(coquille, react) {
  const coquilleParId = new Map(coquille.map((el) => [el.id, el]));
  const reactParId = new Map(react.map((el) => [el.id, el]));
  const appariee = new Map(); // id coquille -> id React
  const reactApparie = new Set(); // ids React déjà pris

  // Ancêtre apparié le plus proche (côté coquille) — ou null.
  const ancetreApparieCoquille = (el) => {
    let parent = el.parent;
    while (parent !== null && !appariee.has(parent)) parent = coquilleParId.get(parent).parent;
    return parent;
  };
  // Ancêtre apparié le plus proche (côté React), parmi les éléments déjà pris.
  const ancetreApparieReact = (el) => {
    let parent = el.parent;
    while (parent !== null && !reactApparie.has(parent)) parent = reactParId.get(parent).parent;
    return parent;
  };

  for (const el of coquille) {
    const ancre = ancetreApparieCoquille(el);
    const ancreReact = ancre === null ? null : appariee.get(ancre);
    const candidat = react.find(
      (r) =>
        !reactApparie.has(r.id) &&
        r.tag === el.tag &&
        memeBoite(el, r) &&
        ancetreApparieReact(r) === ancreReact
    );
    if (candidat) {
      appariee.set(el.id, candidat.id);
      reactApparie.add(candidat.id);
    }
  }

  const paires = [...appariee].map(([idCoquille, idReact]) => ({
    coquille: coquilleParId.get(idCoquille),
    react: reactParId.get(idReact),
  }));
  return {
    paires,
    nonAppariesCoquille: coquille.length - appariee.size,
    nonAppariesReact: react.length - reactApparie.size,
  };
}

/**
 * Les paires dont les classes diffèrent, avec ce qui est propre à chaque côté.
 *
 * @param {Array<{coquille: object, react: object}>} paires Sortie de `apparier`.
 * @returns {Array<{tag: string, boite: number[], coquille: string[], react: string[], seulementCoquille: string[], seulementReact: string[]}>}
 */
export function classesDivergentes(paires) {
  return paires
    .filter(({ coquille, react }) => !memeEnsemble(coquille.classes, react.classes))
    .map(({ coquille, react }) => ({
      tag: coquille.tag,
      boite: [coquille.x, coquille.y, coquille.w, coquille.h],
      coquille: coquille.classes,
      react: react.classes,
      seulementCoquille: coquille.classes.filter((c) => !react.classes.includes(c)),
      seulementReact: react.classes.filter((c) => !coquille.classes.includes(c)),
    }));
}

/**
 * La divergence est-elle DÉCLARÉE ? Oui seulement si la liste publiée par la
 * coquille est EXACTEMENT une liste déclarée propre à la coquille (même
 * ensemble de classes, pas un voisinage). Une liste proche d'une déclaration
 * reste une divergence.
 *
 * @param {string[]} classesCoquille Classes de l'élément de la coquille.
 * @param {Array<{publiee: string}>} declarees `CLASSES_PROPRES_AUX_COQUILLES`.
 */
export function estDeclaree(classesCoquille, declarees) {
  return declarees.some((entree) => memeEnsemble([...entree.publiee.split(/\s+/).filter(Boolean)].sort(), classesCoquille));
}

/**
 * Les divergences DÉCLARÉES entre une classe de la coquille et celle de React,
 * quand la boîte est IDENTIQUE des deux côtés et que l'écart est une question de
 * porteur, pas de peinture. Chaque entrée porte les listes EXACTES des deux côtés
 * (pas un voisinage), les ROUTES où elle doit apparaître, et une CONTREPARTIE :
 * React doit peindre, à la même hauteur et de la même taille, un élément qui porte
 * la classe qu'il a et la coquille non. Une entrée absente d'une route qu'elle
 * déclare rougit : une exception qu'on ne retire pas est une exception qui ment.
 *
 * AUCUN écart n'est déclaré aujourd'hui. L'écart de la barre de navigation (la
 * coquille posait `h-16` sur le conteneur, React sur la rangée) a été SUPPRIMÉ
 * à la source : la coquille publie désormais la même structure que React, et les
 * deux lisent `NAV_RANGEE_CLASS` (src/config/classes-chrome.js). Le mécanisme reste,
 * vide, pour qu'un futur écart voulu passe par une déclaration motivée et
 * périmable plutôt que par une tolérance silencieuse.
 */
export const DIVERGENCES_DECLAREES = [];

/**
 * Une divergence est-elle DÉCLARÉE ? Oui seulement si elle a les listes EXACTES
 * d'une entrée de `DIVERGENCES_DECLAREES` pour cette route ET que la contrepartie
 * est peinte par React. Renvoie l'entrée, ou null.
 *
 * @param {{tag: string, coquille: string[], react: string[], boite: number[]}} d Divergence.
 * @param {string} route La route mesurée.
 * @param {Array<object>} reactCapture Capture React complète (pour la contrepartie).
 */
/** L'entrée s'applique-t-elle à cette route ? `'toutes'` = toutes les routes mesurées. */
export const estApplicable = (entree, route) => entree.routes === 'toutes' || entree.routes.includes(route);

export function declareeDivergence(d, route, reactCapture, declarations = DIVERGENCES_DECLAREES) {
  return (
    declarations.find(
      (entree) =>
        estApplicable(entree, route) &&
        entree.balise === d.tag &&
        memeEnsemble([...entree.coquille].sort(), d.coquille) &&
        memeEnsemble([...entree.react].sort(), d.react) &&
        reactCapture.some(
          (r) => r.classes.includes(entree.contrepartieClasse) && r.y === d.boite[1] && r.h === d.boite[3]
        )
    ) || null
  );
}

/** Libellé court d'une boîte, pour nommer la paire dans le message d'échec. */
export function nommerBoite([x, y, w, h]) {
  return `${w}×${h} px à (${x}, ${y})`;
}
