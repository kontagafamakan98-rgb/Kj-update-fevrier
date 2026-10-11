/**
 * LE CADRE DES PAGES D'APPLICATION — un seul endroit qui pose le pas, la largeur
 * et l'en-tête, pour que six pages ne puissent plus en diverger.
 *
 * ── Pourquoi un composant, et pas des classes recopiées ────────────────────
 * Le dépôt a déjà tranché ce choix pour les coquilles : une chaîne de classes qui
 * doit être identique à deux endroits a UN propriétaire, et les consommateurs la
 * LISENT. Ici le propriétaire est `src/config/app-cadres.js` ; ce composant est
 * son unique lecteur, et les pages délèguent — elles ne connaissent plus ni la
 * largeur ni la gouttière, seulement leur titre et leur corps.
 *
 * ── Ce qu'il ne fait PAS, volontairement ───────────────────────────────────
 * Il ne pose pas le pas INTERNE de la page : une pile de cartes de tableau de
 * bord ne se rythme pas comme les sections d'une page éditoriale (le pourquoi
 * est écrit dans `src/config/app-cadres.js`). Les blocs du corps lisent le jeton
 * de GROUPE par la classe `.bloc-app`, que chaque page pose sur ses propres
 * blocs — une page qui n'en a qu'un n'en pose aucun. Il ne pose pas non plus de
 * fond : `/payment` peint sur un gris, les autres sur le papier du site, et un
 * fond est une décision de page.
 *
 * ── LE PAS DE L'EN-TÊTE, LUI, EST POSÉ ICI (09/10/2026) ────────────────────
 * `--rythme-tete`, dont la définition est exactement cela : « ce qu'un en-tête
 * (titre de page ou d'entrée de section) laisse avant le corps qu'il annonce ».
 * Il se pose sur le DERNIER élément de l'en-tête, jamais sur le titre seul : une
 * page qui a un chapeau forme avec lui UN en-tête, et c'est l'ensemble qui
 * laisse le pas avant le corps (le titre garde son pas de groupe vers son
 * chapeau, comme le sur-titre et le titre d'`.entree-section` forment un seul
 * objet).
 *
 * MESURÉ le 09/10/2026 (relevé des cinq routes, 412×823 et 1350×940, AVANT) :
 * ce pas valait 16 px sur `/messages` et 24 sur `/create-job` — un chapeau écrit
 * à la main — quand le jeton vaut 32,19 → 47,2 px. Le minimum du site était
 * ailleurs : le titre du tableau de bord, rendu par sa page, restait collé à sa
 * première carte (4 px d'encre).
 *
 * ── L'EN-TÊTE EST OPTIONNEL, ET C'EST UN ÉTAT RÉEL ─────────────────────────
 * Deux pages d'application rendent un état SANS titre de page — le squelette de
 * chargement de `/profile`, et le repli « mission introuvable » du détail de
 * mission, qui a son propre message. Leur passer `titre={null}` est donc
 * légitime : un cadre sans en-tête est un cadre, pas un cas dégradé.
 */

import { cadreAppDe } from '../config/app-cadres';

/**
 * @param {object} props
 * @param {string} props.chemin La clé de route déclarée (`/dashboard`, `/profile`…).
 * @param {import('react').ReactNode} [props.titre] Le titre de page, ou `null`
 *   pour un état sans en-tête.
 * @param {import('react').ReactNode} [props.chapeau] Le paragraphe sous le titre.
 * @param {string} [props.classeCorps] Le pas interne de la page (`space-y-6`…).
 *   Une valeur VIDE n'enveloppe pas le corps : voir plus bas.
 * @param {boolean} [props.squelette] Cette instance est un ÉTAT DE CHARGEMENT,
 *   pas la page : la route peut donc déclarer une hauteur réservée (voir
 *   `src/config/app-cadres.js`), que ce composant applique au corps. Un booléen
 *   et non la classe : le squelette n'a pas à connaître la valeur, il dit
 *   seulement ce qu'il EST — la même séparation que le cadre (la page ne
 *   connaît ni sa largeur ni sa gouttière, elle délègue).
 * @param {import('react').ReactNode} props.children Le corps de la page.
 */
export default function CadrePage({
  chemin,
  titre = null,
  chapeau = null,
  classeCorps = 'space-y-6',
  squelette = false,
  children,
}) {
  const { frameClass, titleClass, squelette: regleSquelette } = cadreAppDe(chemin);
  // L'en-tête se termine sur le chapeau s'il y en a un : c'est LUI qui porte le
  // pas vers le corps, sinon le titre le ferait deux fois. Le titre, lui, porte
  // alors le pas de GROUPE vers son chapeau (`bloc-app` : « l'espace dans un
  // groupe, titre → phrase » est la définition même de `--rythme-bloc`) — dans
  // les deux cas un JETON, jamais un `mb-*` recopié.
  const titrePorteLePas = !chapeau;
  const classeTitre = `${titleClass} ${titrePorteLePas ? 'tete-app' : 'bloc-app'}`;
  // La réserve vient de la DÉCLARATION et ne s'applique qu'au squelette : une
  // page peinte garde sa hauteur naturelle (c'est la différence entre « réserver
  // la place » et « peindre la place »), et une route qui n'en déclare pas n'en
  // reçoit pas — `hauteurClass` absent ne produit donc aucun nœud de plus.
  const hauteurReservee = squelette ? regleSquelette?.hauteurClass || '' : '';

  // `classeCorps` VIDE → pas d'enveloppe du tout. Ce n'est pas une coquetterie :
  // la plupart des pages d'application rythment leurs blocs par leurs propres
  // marges (`mb-8`, `space-y-*` écrits sur leurs enfants), donc elles passent la
  // valeur vide — et une `<div>` sans classe ajouterait un NŒUD à la page sans
  // rien peindre. Or un nœud de plus n'est pas neutre ici : les squelettes de
  // Suspense sont comptés par `antiClsSkeletons.test.jsx` et les sondes de
  // géométrie comparent les arbres. Rendre les enfants DIRECTEMENT garde à la
  // page la structure qu'elle avait, et ne laisse l'enveloppe qu'aux pages qui
  // demandent explicitement un pas.
  const classesCorps = [hauteurReservee, classeCorps].filter(Boolean).join(' ');
  const corps = classesCorps ? <div className={classesCorps}>{children}</div> : children;

  return (
    <div className={frameClass}>
      {titre ? (
        <h1 className={classeTitre}>{titre}</h1>
      ) : null}
      {chapeau ? <p className="text-stone-600 tete-app">{chapeau}</p> : null}
      {corps}
    </div>
  );
}
