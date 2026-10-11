// LA PHOTO DU HÉROS, SON ALTERNANCE, ET LE CONTRÔLE QUI LA MET EN PAUSE.
//
// Elle publie UN SEUL `<img>` — celui que la coquille pré-rendue peint avant
// tout JavaScript — et change son `src` à intervalle régulier. Le choix est
// mesuré, pas esthétique :
//
//   • UN SEUL nœud : `createRoot()` efface `#root` et React reconstruit la même
//     boîte. Deux `<img>` empilés pour un fondu enchaîné doubleraient le
//     téléchargement du premier écran (2 × 62 ko) pour un effet que personne n'a
//     demandé, et l'élément LCP est CETTE image : elle seule doit être dans le
//     chemin critique (`fetchpriority="high"`, `decoding="sync"`).
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
//     propriétaire du site y était donc invisible.
//
// ── LE CONTRÔLE DE PAUSE, ET POURQUOI IL EST ICI (07/10/2026) ───────────────
// Une alternance automatique de plus de cinq secondes est exactement le cas du
// critère WCAG 2.2.2 : il faut un MÉCANISME pour l'interrompre, pas une
// extinction silencieuse derrière une préférence système. Le bouton ci-dessous
// est ce mécanisme — VISIBLE (un dessin de pause/lecture, une cible carrée de
// 48 px, mesurée dans le navigateur), nommé (`aria-label`, depuis le
// dictionnaire : un nom accessible est du texte publié), et il porte son état
// (`aria-pressed`).
//
// TROIS PROPRIÉTÉS DE GÉOMÉTRIE, chacune mesurée par une sonde existante :
//
//   1. IL NE PREND AUCUNE PLACE DANS LE FLUX. Il est `position: absolute` dans
//      `.cadre-illustration` (qui est `relative`, src/index.css) : l'apparition
//      du contrôle ne décale donc RIEN — ni la photo, ni ce qui la suit. C'est
//      `e2e/cls-coquille-react.spec.js` qui le dit, sur « / », en comparant le
//      CLS de la coquille et celui du montage de React.
//   2. IL N'AJOUTE AUCUNE CANDIDATE LCP. Il ne peint aucun texte (le libellé
//      est un nom ACCESSIBLE, pas une phrase peinte) et sa boîte de 48 px de
//      côté est minuscule devant celle de la photo (307 200 px² en desktop,
//      mesuré) : Chrome ne ré-élit un élément LCP que pour une aire STRICTEMENT
//      plus grande. Mesuré par `e2e/heros-pause.spec.js` — une seule candidate,
//      de même balise et de même aire que celle de la coquille — et par
//      `e2e/lcp-geometrie.spec.js` sur toutes les routes pré-rendues.
//   3. IL EST ATTEIGNABLE. Il est peint après la photo et au-dessus d'elle, et
//      rien ne le recouvre — c'est `e2e/heros-pause.spec.js` qui vérifie, au
//      centre de sa boîte, que l'élément rendu par le navigateur est bien le
//      contrôle (et `e2e/commandes-atteignables.spec.js` qui tient la même
//      propriété pour toutes les commandes du premier écran).
//
// POURQUOI IL N'EST PAS PUBLIÉ PAR LA COQUILLE PRÉ-RENDUE, alors que la photo
// l'est : sans JavaScript il n'y a AUCUNE alternance à interrompre (le
// `setInterval` est la seule chose qui fait tourner la liste). Un bouton que
// rien n'écoute serait un contrôle en trompe-l'œil — et le critère ne s'applique
// qu'à un contenu qui se met réellement à jour. Les deux canaux restent d'accord
// là où c'est obligatoire : la photo, sa boîte et ses attributs.
//
// ── LES VARIANTES AVIF ET WEBP, ET LE PRÉCHARGEMENT QUI LES SUIT (08/10/2026) ─
// La photo est publiée dans un `<picture>` : un `<source>` AVIF puis un WebP
// (chacun avec ses deux largeurs en `srcset`), et l'`<img>` JPEG en dernier
// recours. C'est LE MÊME balisage que celui de la coquille pré-rendue, construit
// depuis le même module (src/config/photos-heros.js) — un canal qui publierait
// un autre jeu de variantes ferait télécharger un fichier au premier paint et un
// AUTRE à la bascule.
//
// CE QUI NE CHANGE PAS, et c'est la condition : l'`<img>` reste LE SEUL nœud
// image, avec ses `width`/`height` réels, son `fetchpriority="high"`, son
// `decoding="sync"` et sa classe. La boîte réservée est donc la même, et
// l'élément LCP de « / » reste celui d'avant (mesuré par `e2e/heros-pause.spec.js`
// et `e2e/lcp-geometrie.spec.js` : une seule candidate, au premier paint).
//
// LE PRÉCHARGEMENT DU CRAN SUIVANT SUIT LE CHOIX DU NAVIGATEUR, et c'est le
// point qui a demandé le plus d'attention. Précharger le JPEG quand le tour
// suivant servira l'AVIF ferait télécharger DEUX fichiers pour une seule photo —
// plus qu'avant cette passe, exactement l'inverse du but. Le composant lit donc
// `currentSrc` de l'image affichée (la variante que le navigateur a RÉELLEMENT
// choisie, format et largeur) et précharge la MÊME forme pour la photo suivante
// (`memeVarianteQue`). Aucune détection de capacités n'est nécessaire : le
// navigateur a déjà répondu, et quand il n'a pas encore répondu (pas de
// `currentSrc`), le préchargement ATTEND son `load` au lieu de deviner.
//
// Ce que ce composant ne fait PAS : il ne connaît ni les chemins ni les
// dimensions — ils appartiennent à src/config/photos-heros.js, que la coquille
// pré-rendue lit AUSSI. C'est ce qui empêche les deux canaux de peindre deux
// photos différentes au premier rendu.
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  PHOTOS_HEROS,
  PHOTO_HEROS_DELAI_MS,
  PHOTO_HEROS_FORMATS,
  PHOTO_HEROS_HAUTEUR,
  PHOTO_HEROS_LARGEUR,
  PHOTO_HEROS_SIZES,
  memeVarianteQue,
  srcsetHeros,
} from '../config/photos-heros';

/** Le repli quand `requestIdleCallback` n'existe pas (Safari) : même règle que
 *  `src/index.js` et `src/utils/analytics.js` — un temps mort borné, jamais le
 *  chemin du premier paint. */
const REPLI_TEMPS_MORT_MS = 2500;

export default function PhotoDuHeros({ className }) {
  const [index, setIndex] = useState(0);
  const [enPause, setEnPause] = useState(false);
  // La référence sert au PRÉCHARGEMENT (lire `currentSrc`, c'est-à-dire la
  // variante choisie par le navigateur) : elle ne pilote rien du rendu.
  const refImage = useRef(null);
  const { t } = useLanguage();

  // ── L'alternance ──────────────────────────────────────────────────────────
  // Le compteur vit DANS l'intervalle (mise à jour fonctionnelle de l'état) :
  // l'effet ne dépend donc d'aucune valeur qui changerait à chaque tour — il
  // s'installe une fois, se démonte avec le composant, et ne se réinstalle que
  // si `enPause` CHANGE (c'est-à-dire quand un humain appuie sur le contrôle).
  // Un `setInterval` non démonté continuerait de tourner sur une page quittée —
  // c'est la fuite classique de ce genre de carrousel, et les tests la
  // surveillent.
  useEffect(() => {
    if (PHOTOS_HEROS.length < 2 || enPause) return undefined;
    const minuteur = setInterval(() => {
      setIndex((courant) => (courant + 1) % PHOTOS_HEROS.length);
    }, PHOTO_HEROS_DELAI_MS);
    return () => clearInterval(minuteur);
  }, [enPause]);

  // ── Le préchargement de la photo SUIVANTE ─────────────────────────────────
  // APRÈS le premier paint, pendant un temps mort : l'image affichée est déjà
  // partie en `fetchpriority="high"`, la suivante n'a pas à lui disputer la
  // bande passante. `decode()` évite le trou visuel au moment du remplacement
  // (il est alors instantané) ; son absence (navigateur ancien) ou son échec
  // n'est pas une erreur — la photo se chargera au moment du tour.
  //
  // L'effet dépend de `index` : chaque remplacement prépare LE cran suivant,
  // donc la liste peut grandir sans que le coût du premier écran grandisse.
  // En pause, il ne précharge RIEN de plus : la photo suivante n'est pas
  // « la suivante » d'une alternance qui ne tourne plus.
  //
  // LA VARIANTE PRÉCHARGÉE EST CELLE QUE LE NAVIGATEUR A CHOISIE (voir plus
  // haut) : le `currentSrc` de l'image affichée, reporté sur la photo suivante
  // par `memeVarianteQue` (qui tolère une URL absolue de CDN).
  //
  // ET QUAND IL N'A PAS ENCORE CHOISI, ON ATTEND — ON NE DEVINE PAS. Sur une
  // liaison lente, le temps mort arrive AVANT que l'image de tête ne soit
  // sélectionnée ; précharger le JPEG « faute de mieux » ferait télécharger un
  // fichier que le tour suivant n'utiliserait pas, c'est-à-dire exactement le
  // défaut que cette passe supprime. On écoute donc le `load` de l'image
  // affichée, et le filet borné ne fait RIEN (`annule`) : si la sélection finit
  // par arriver, le tour suivant demandera sa variante, un point c'est tout.
  useEffect(() => {
    if (PHOTOS_HEROS.length < 2 || enPause) return undefined;
    const indexSuivant = (index + 1) % PHOTOS_HEROS.length;
    let parti = false;
    const charger = () => {
      if (parti) return;
      parti = true;
      const affichee = refImage.current;
      const choisieSurLaPage = affichee ? affichee.currentSrc : '';
      // L'`Image` est créée ICI, pas à l'installation de l'effet : une
      // allocation qui ne charge rien serait un objet de plus sur une page qui
      // n'en a pas besoin (et un préchargement qui n'arrive jamais doit coûter
      // zéro, pas une image vide).
      const image = new Image();
      image.src = memeVarianteQue(choisieSurLaPage, indexSuivant) || PHOTOS_HEROS[indexSuivant];
      if (typeof image.decode === 'function') image.decode().catch(() => {});
    };
    const affichee = refImage.current;
    // La sélection est déjà faite (le cas normal : l'image est préchargée par
    // le `<head>` avec `fetchpriority="high"`, donc elle est arrivée au premier
    // paint) ou pas encore.
    const enAttenteDeSelection = Boolean(affichee && !affichee.currentSrc && !affichee.complete);
    if (enAttenteDeSelection) affichee.addEventListener('load', charger, { once: true });
    const lancer = () => {
      if (!enAttenteDeSelection) charger();
    };
    let id;
    if (typeof window.requestIdleCallback === 'function') {
      id = window.requestIdleCallback(lancer, { timeout: 3000 });
    } else {
      id = setTimeout(lancer, REPLI_TEMPS_MORT_MS);
    }
    return () => {
      if (enAttenteDeSelection) affichee.removeEventListener('load', charger);
      if (typeof window.requestIdleCallback === 'function') {
        if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(id);
      } else {
        clearTimeout(id);
      }
    };
  }, [index, enPause]);

  const libelle = t(enPause ? 'heroRotationResume' : 'heroRotationPause');

  // Le `<picture>` : deux `<source>` par format, avec leurs deux largeurs, puis
  // l'`<img>`. L'ORDRE des sources est celui de `PHOTO_HEROS_FORMATS` (AVIF
  // d'abord, le plus léger) : c'est le premier format que le navigateur SAIT
  // lire qui gagne, et le JPEG reste ce qu'il obtient s'il n'en connaît aucun.
  return (
    <>
      <picture>
        {PHOTO_HEROS_FORMATS.map((format) => (
          <source
            key={format}
            type={`image/${format}`}
            srcSet={srcsetHeros(index, format)}
            sizes={PHOTO_HEROS_SIZES}
          />
        ))}
        <img
          ref={refImage}
          src={PHOTOS_HEROS[index]}
          alt=""
          width={PHOTO_HEROS_LARGEUR}
          height={PHOTO_HEROS_HAUTEUR}
          fetchpriority="high"
          // ── `decoding="sync"`, ET C'EST UNE DÉCISION MESURÉE (07/10/2026) ──
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
      </picture>
      {/* LE CONTRÔLE N'EXISTE QUE S'IL Y A QUELQUE CHOSE À INTERROMPRE : une
          liste d'une seule photo ne tourne pas, donc elle n'a pas de pause à
          offrir. `aria-pressed` dit l'ÉTAT (l'alternance est-elle en pause ?),
          et le libellé dit l'ACTION qui suit — c'est la convention des boutons
          à bascule, et c'est ce que le nom accessible doit annoncer. */}
      {PHOTOS_HEROS.length >= 2 ? (
        <button
          type="button"
          className="heros-controle"
          aria-pressed={enPause}
          aria-label={libelle}
          title={libelle}
          onClick={() => setEnPause((pause) => !pause)}
        >
          {/* Les deux dessins vivent ICI, et pas dans `page-icons.js` : ce
              registre-là existe pour être lu par les DEUX canaux (la page et la
              coquille), or la coquille ne publie pas ce contrôle. */}
          {enPause ? (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          )}
        </button>
      ) : null}
    </>
  );
}
