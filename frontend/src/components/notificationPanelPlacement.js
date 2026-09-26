/**
 * DE QUEL CÔTÉ s'ouvre le panneau du centre de notifications.
 *
 * ── Pourquoi ce n'est pas une mesure, mais une déclaration ──────────────────
 * Le panneau est UNIQUE (`NotificationPanel.js`, monté dans App.js) et il se
 * rend, par portail React, DANS le conteneur `relative` de la cloche qui l'a
 * ouvert (`NotificationBell.js`). Sa position vient donc de ce conteneur, sans
 * une seule coordonnée écrite nulle part : le panneau garde son `absolute
 * right-0` et tombe sur le bord droit de la barre qui l'a ouvert.
 *
 * Ce que le conteneur ne peut pas dire, en revanche, c'est de quel CÔTÉ : une
 * cloche de la barre du haut ouvre vers le BAS (sous elle, c'est la page), une
 * cloche de la barre du BAS ouvre vers le HAUT — sous une barre collée au bas
 * de l'écran (`fixed bottom-0`), un panneau qui descendrait sortirait de la
 * fenêtre, entièrement ou presque.
 *
 * La cloche DÉCLARE donc son sens, et c'est le SEUL propriétaire de ce fait :
 * le panneau, lui, ne lit ni ne mesure rien de plus (il ne demande pas sa
 * position au navigateur, ne connaît pas le point de rupture, et n'a pas à
 * deviner quelle barre l'a ouvert). Une cloche qui n'a rien à dire se tait : le
 * sens par défaut est celui du haut, c'est-à-dire la disposition historique.
 *
 * Les classes sont écrites en clair (jamais composées à l'exécution) : Tailwind
 * les relève dans le source, et `scripts/check-css-selecteurs-morts.js` exige
 * que chaque classe servie ait un porteur — une classe fabriquée par
 * concaténation n'aurait ni l'un ni l'autre.
 */

/** Le panneau s'ouvre sous la cloche : la barre du haut. */
export const VERS_LE_BAS = 'versLeBas';

/** Le panneau s'ouvre au-dessus de la cloche : la barre du bas. */
export const VERS_LE_HAUT = 'versLeHaut';

/**
 * L'ancrage du panneau, par sens déclaré. `mt-2` seul suffit vers le bas :
 * sans `top` ni `bottom`, l'élément absolu garde sa position STATIQUE, qui est
 * celle du portail dans le conteneur — juste après le bouton de la cloche.
 * C'est l'ancrage d'origine, inchangé.
 */
export const ANCRAGES = {
  [VERS_LE_BAS]: 'mt-2',
  [VERS_LE_HAUT]: 'bottom-full mb-2',
};

/** L'ancrage d'un sens, avec repli sur celui de la barre du haut. */
export const ancrageDe = (sens) => ANCRAGES[sens] || ANCRAGES[VERS_LE_BAS];
