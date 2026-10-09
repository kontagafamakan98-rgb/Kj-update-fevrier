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
// ── LE SUJET EST LE HTML DES PAGES LIVRÉES, ET C'EST UNE MESURE (09/10/2026) ──
// Le fait n'est pas lisible de la même façon dans les deux artefacts servis, et
// l'écart est mesuré.
//
//   • Le JavaScript du bundle ne s'y prête PAS. Tailwind SCANNE `src/**` (le
//     `content` de `tailwind.config.cjs`) et génère un utilitaire dès qu'un jeton
//     candidat apparaît dans un fichier scanné : un littéral de `className` écrit
//     dans `src/` a donc sa règle par construction. Mesuré sur le build du
//     09/10/2026 : le corpus des poseurs du garde des sélecteurs retient 2 802
//     valeurs de classe, dont 515 jetons SANS règle servie — et ce vocabulaire
//     était `'leaflet-'`, `'lucide'`, `'En'`, `'cours'`, `'page'`, `'completed'`,
//     `'none'`, `'canvas'`, `<path`, `d="M15`, du SVG, de la prose et des noms de
//     route. Un verdict rendu là-dessus serait du BRUIT : le corpus ne sait pas
//     distinguer une classe d'un fragment de chaîne (`'bg-' + …`), d'un argument
//     de `document.createElement('canvas')` ou d'une clé de traduction, et un
//     garde qui rougit à tort finit ignoré.
//
//   • Les PAGES, elles, n'ont aucune ambiguïté : un attribut `class=` est une
//     position de classe par définition. Et c'est exactement l'artefact où le
//     trou est réel : `vite-plugins/prerender/**` (les coquilles pré-rendues)
//     n'est PAS dans le `content` de Tailwind. Une classe qui n'est écrite QUE
//     là n'est donc générée par personne — et c'est la peinture que le visiteur
//     voit AVANT le JavaScript (le premier écran, l'élément LCP). Les autres
//     gardes comparent déjà la géométrie et les mots des deux canaux
//     (`e2e/geometrie-coquille-react.spec.js`, `e2e/texte-coquille-react.spec.js`) :
//     aucun ne comparait les CLASSES, et une classe manquante ne déplace rien —
//     elle fait seulement qu'un bouton n'est pas grisé.
//
// Trouvé par cette sonde à son premier passage : `opacity-50` sur le bouton de
// suivi de /support, écrit par `vite-plugins/prerender/shells-routes.js` tandis
// que le composant React écrit `disabled:opacity-50` — Tailwind ne génère aucune
// règle `.opacity-50` nue, donc la coquille publiait un bouton PLEIN que React
// grise au montage.
//
// ── Ce que ce module NE JUGE PAS, et pourquoi ───────────────────────────────
//   • le JavaScript du bundle (raison ci-dessus) ;
//   • les feuilles : une règle servie sans porteur est le sujet du garde des
//     sélecteurs — deux gardes ne se répètent pas ;
//   • les noms de `NOMS_ACCEPTES_SANS_REGLE` : une classe peut être posée SANS
//     règle par DÉCISION, et une telle décision se déclare ici avec sa raison.
//     Deux refus la tiennent honnête : une exemption SANS MOTIF est refusée, et
//     une exemption qui n'est plus POSÉE nulle part est refusée AUSSI (une
//     exception qu'on n'ose plus retirer est une exception qui mente).
import postcss from 'postcss';
import { classesDuHtml, nomsDeSelecteur } from './css-selecteurs-morts.js';

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
 *
 * @param {string} html Page livrée.
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
