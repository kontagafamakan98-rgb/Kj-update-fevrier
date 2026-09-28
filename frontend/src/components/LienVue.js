import { Link as LienReactRouter, useNavigate } from 'react-router-dom';
import { flushSync } from 'react-dom';

/**
 * LE LIEN INTERNE DÉCLENCHE LA TRANSITION DE VUE NATIVE — quand le navigateur
 * sait la faire, et SILENCIEUSEMENT sinon.
 *
 * ── Ce que ça change, et pourquoi ce n'est pas de la décoration ─────────────
 * Passer d'une page à l'autre changeait tout l'écran D'UN COUP : l'ancienne
 * peinture disparaissait au profit de la nouvelle, sans aucun raccord. C'est le
 * geste le plus fréquent du site (un appui sur un lien de la barre ou du pied de
 * page, et le contenu saute). `document.startViewTransition` demande au
 * navigateur de photographier la page sortante, de peindre l'entrante, et de
 * croiser les deux — ce qu'aucun `<div>` ne peut faire, parce qu'il ne connaît
 * pas la peinture qui s'en va.
 *
 * ── Pourquoi CE composant, et pourquoi pas la propriété de React Router ─────
 * React Router v7 expose `viewTransition` sur ses liens, mais elle n'est
 * HONORÉE que par un routeur de DONNÉES (`createBrowserRouter`) : le site monte
 * un `<BrowserRouter>`, où la propriété est acceptée puis ignorée. Mesuré le
 * 27/09/2026 (sonde navigateur, `document.startViewTransition` instrumenté) :
 * une navigation interne ne l'appelait JAMAIS. Le raccord est donc posé ici, au
 * seul endroit qui décide de la navigation : le clic.
 *
 * `flushSync` est le cœur de l'affaire, et pas un détail : une navigation
 * React Router est un changement d'état ASYNCHRONE. Sans lui, le navigateur
 * photographierait la page AVANT que React n'ait peint la suivante, et
 * animerait une image identique à elle-même — un raccord invisible. `flushSync`
 * force la peinture de la nouvelle page À L'INTÉRIEUR de la photographie du
 * navigateur, et c'est ce qui rend l'animation réelle.
 *
 * ── Ce que ce lien NE fait PAS ─────────────────────────────────────────────
 * Il ne s'intercepte QUE pour un clic gauche simple, sans modificatrice, sur la
 * même fenêtre : `Ctrl`/`Cmd` + clic, clic du milieu, `target="_blank"` et les
 * navigations de rechargement passent par le `<Link>` d'origine, intact. Sans
 * `startViewTransition` (navigateur plus ancien), il ne fait RIEN non plus :
 * chaque garde `return` laisse la main à React Router, qui navigue comme avant.
 * C'est une amélioration progressive, jamais un prérequis. L'animation
 * elle-même est neutralisée sous `prefers-reduced-motion` (src/index.css).
 *
 * ── Un propriétaire, pas trente copies ─────────────────────────────────────
 * Le chrome porte une trentaine de liens internes (barre desktop, tiroir mobile,
 * barre basse, pied de page). Les trois surfaces importent ce composant À LA
 * PLACE de `Link` : un lien AJOUTÉ demain hérite du raccord sans que personne
 * n'y pense, et changer la règle se fait ici.
 *
 * @param {object} props Les mêmes propriétés qu'un `Link` de React Router.
 */
export default function LienVue({
  to,
  replace,
  state,
  preventScrollReset,
  relative,
  target,
  onClick,
  ...props
}) {
  const navigate = useNavigate();

  const auClic = (evenement) => {
    // D'abord l'intention de l'appelant (fermer un menu, etc.) : elle peut
    // annuler la navigation, et une annulation ne se contourne pas.
    if (onClick) onClick(evenement);
    if (evenement.defaultPrevented) return;
    // Un appui qui n'est PAS un clic gauche simple appartient au navigateur
    // (nouvel onglet, nouvel fenêtre) : on n'y touche pas.
    if (target && target !== '_self') return;
    if (
      evenement.button !== 0 ||
      evenement.metaKey ||
      evenement.ctrlKey ||
      evenement.shiftKey ||
      evenement.altKey
    ) {
      return;
    }
    if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') {
      return;
    }
    evenement.preventDefault();
    document.startViewTransition(() => {
      flushSync(() => {
        navigate(to, { replace, state, preventScrollReset, relative });
      });
    });
  };

  return (
    <LienReactRouter
      to={to}
      replace={replace}
      state={state}
      preventScrollReset={preventScrollReset}
      relative={relative}
      target={target}
      onClick={auClic}
      {...props}
    />
  );
}
