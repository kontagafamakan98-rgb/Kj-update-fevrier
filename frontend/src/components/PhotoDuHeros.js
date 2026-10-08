// LA PHOTO DU HÉROS, ET SON ALTERNANCE.
//
// Elle publie UN SEUL `<img>` — celui que la coquille pré-rendue peint avant
// tout JavaScript — et change son `src` à intervalle régulier. Le choix est
// mesuré, pas esthétique :
//
//   • UN SEUL nœud : `createRoot()` efface `#root` et React reconstruit la même
//     boîte. Deux `<img>` empilés pour un fondu enchaîné doubleraient le
//     téléchargement du premier écran (2 × 62 ko) pour un effet que personne n'a
//     demandé, et l'élément LCP est CETTE image : elle seule doit être dans le
//     chemin critique (`fetchpriority="high"`, `decoding="async"`).
//   • LA MÊME BOÎTE À CHAQUE TOUR : les SIX fichiers sont au même rapport
//     (720 × 960, voir src/config/photos-heros.js). `width` et `height` portent
//     les dimensions RÉELLES du fichier, donc la place est réservée avant le
//     chargement, et remplacer la photo n'enregistre ni décalage (CLS) ni
//     seconde candidate LCP — c'est la condition que `e2e/cls-coquille-react.spec.js`
//     et `e2e/lcp-geometrie.spec.js` mesurent sur « / ».
//   • SEULE LA SUIVANTE EST CHARGÉE, ET AVANT DE REMPLACER : elle est
//     téléchargée et décodée pendant un TEMPS MORT (après le premier paint,
//     jamais pendant : elle n'a rien à faire dans le chemin critique), donc le
//     remplacement n'a pas de trou visible. La liste compte six photos : les
//     charger toutes d'avance coûterait ~560 ko aussitôt après le premier paint
//     à des visiteurs qui n'en verront peut-être qu'une — le préchargement
//     avance donc d'UN cran, et se décale d'un cran après chaque remplacement.
//     (Le poids compte ici plus qu'ailleurs : le site sert l'Afrique de l'Ouest,
//     souvent en 3G/4G facturée au mégaoctet.)
//   • L'ALTERNANCE NE DÉPEND PAS DE `prefers-reduced-motion`, ET C'EST UN CHOIX
//     EXPLICITE (29/09/2026). Le site honore cette préférence pour ses
//     ANIMATIONS (src/index.css) : un mouvement, un défilement ou un
//     clignotement se coupent. Ici il n'y a NI mouvement, NI clignotement :
//     une photo fixe en remplace une autre, dans la même boîte, sans transition
//     — et cette boîte ne bouge pas d'un pixel (c'est la condition du CLS 0).
//     La première version de ce composant l'éteignait tout de même, par
//     prudence ; mesuré dans le navigateur de l'aperçu, `prefers-reduced-motion`
//     y vaut `reduce` PAR DÉFAUT — la fonctionnalité demandée par le
//     propriétaire du site y était donc invisible. Ce qui reste à faire pour une
//     conformité WCAG complète (critère 2.2.2, contenu qui se met à jour tout
//     seul) est un CONTRÔLE de pause, pas une extinction silencieuse : c'est
//     écrit ici comme travail non fait, pas comme travail fait.
//
// Ce que ce composant ne fait PAS : il ne connaît ni les chemins ni les
// dimensions — ils appartiennent à src/config/photos-heros.js, que la coquille
// pré-rendue lit AUSSI. C'est ce qui empêche les deux canaux de peindre deux
// photos différentes au premier rendu.
import { useEffect, useState } from 'react';
import {
  PHOTOS_HEROS,
  PHOTO_HEROS_DELAI_MS,
  PHOTO_HEROS_HAUTEUR,
  PHOTO_HEROS_LARGEUR,
} from '../config/photos-heros';

/** Le repli quand `requestIdleCallback` n'existe pas (Safari) : même règle que
 *  `src/index.js` et `src/utils/analytics.js` — un temps mort borné, jamais le
 *  chemin du premier paint. */
const REPLI_TEMPS_MORT_MS = 2500;

export default function PhotoDuHeros({ className }) {
  const [index, setIndex] = useState(0);

  // ── L'alternance ──────────────────────────────────────────────────────────
  // Le compteur vit DANS l'intervalle (mise à jour fonctionnelle de l'état) :
  // l'effet ne dépend donc d'aucune valeur qui changerait à chaque tour, il
  // s'installe une fois et se démonte avec le composant. Un `setInterval` non
  // démonté continuerait de tourner sur une page quittée — c'est la fuite
  // classique de ce genre de carrousel, et les tests la surveillent.
  useEffect(() => {
    if (PHOTOS_HEROS.length < 2) return undefined;
    const minuteur = setInterval(() => {
      setIndex((courant) => (courant + 1) % PHOTOS_HEROS.length);
    }, PHOTO_HEROS_DELAI_MS);
    return () => clearInterval(minuteur);
  }, []);

  // ── Le préchargement de la photo SUIVANTE ─────────────────────────────────
  // APRÈS le premier paint, pendant un temps mort : l'image affichée est déjà
  // partie en `fetchpriority="high"`, la suivante n'a pas à lui disputer la
  // bande passante. `decode()` évite le trou visuel au moment du remplacement
  // (il est alors instantané) ; son absence (navigateur ancien) ou son échec
  // n'est pas une erreur — la photo se chargera au moment du tour.
  //
  // L'effet dépend de `index` : chaque remplacement prépare LE cran suivant,
  // donc la liste peut grandir sans que le coût du premier écran grandisse.
  useEffect(() => {
    if (PHOTOS_HEROS.length < 2) return undefined;
    const suivante = PHOTOS_HEROS[(index + 1) % PHOTOS_HEROS.length];
    const charger = () => {
      const image = new Image();
      image.src = suivante;
      if (typeof image.decode === 'function') image.decode().catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(charger, { timeout: 3000 });
      return () => {
        if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(id);
      };
    }
    const id = setTimeout(charger, REPLI_TEMPS_MORT_MS);
    return () => clearTimeout(id);
  }, [index]);

  return (
    <img
      src={PHOTOS_HEROS[index]}
      alt=""
      width={PHOTO_HEROS_LARGEUR}
      height={PHOTO_HEROS_HAUTEUR}
      fetchpriority="high"
      // ── `decoding="sync"`, ET C'EST UNE DÉCISION MESURÉE (07/10/2026) ──────
      // Cette image est l'élément LCP de « / » (69 920 px²). En décodage
      // `async`, elle se peint une TRAME APRÈS le texte du héros : Chrome
      // ré-élit alors un élément LCP plus tardif, le repaint de React entre
      // dans le graphe LCP simulé de Lantern, et la sonde
      // `e2e/lcp-geometrie.spec.js` compte DEUX candidates au lieu d'une.
      // Reproduit puis mesuré (Chromium, 412×823, limitation du CPU par CDP) :
      // à ×15, la navigation réelle sortait `<h1>` à t=1580 puis `<img>` à
      // t=1948 ; le préchargement de la photo (prerender-route-meta.js) ET le
      // décodage synchrone la ramènent à UNE candidate, l'`<img>`, horodatée
      // au premier paint. Ce que le décodage synchrone NE fait PAS : retarder
      // le LCP — sans lui, le premier paint est plus tôt mais l'image arrive
      // après, et c'est ELLE le LCP. Il aligne les deux peintures sur la même
      // trame, ce qui est la condition de l'égalité coquille → React.
      decoding="sync"
      className={className}
    />
  );
}
