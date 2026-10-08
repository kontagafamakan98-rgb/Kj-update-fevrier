import { useState } from 'react';
import { IconePage } from '../config/page-icons';

/**
 * Carte Google : un CONTRÔLE d'abord, l'iframe ensuite — à l'appui.
 *
 * ── Pourquoi ce composant existe ────────────────────────────────────────────
 * /contact publiait l'iframe `output=embed` directement, avec
 * `loading="lazy"`. Mesuré (Lighthouse 12.6.1, pile de la CI, Chrome 152,
 * mobile, 3 runs) : le premier écran tirait quand même l'embed tiers, et le LCP
 * de la page — qui est notre PROPRE paragraphe d'introduction, pas la carte —
 * était repoussé à 4143 / 4143 / 4397 ms simulés, scores 81 / 85 / 84, avec
 * jusqu'à 2800 ms de « element render delay » et les octets tiers comptés dans
 * le graphe LCP. `loading="lazy"` ne suffit pas : le navigateur charge une
 * iframe dès qu'elle approche du viewport, et sur desktop elle y est déjà.
 *
 * ── Ce que le contrôle fait ─────────────────────────────────────────────────
 * Tant que l'utilisateur n'a rien demandé, ce composant ne rend AUCUN iframe :
 * il rend un bloc de la hauteur réservée (la même que la carte, donc aucun
 * décalage au remplacement) contenant un LIEN vers la fiche Google — un lien
 * réel, qui fonctionne même si le JavaScript n'a pas encore pris la main, et
 * qui reste le repère « Google Business Profile » cherché sur une page de
 * contact. À l'appui, `preventDefault()` garde l'utilisateur sur la page et
 * monte l'iframe, qui porte le titre du dictionnaire (`mapIframeTitle`).
 *
 * Les classes viennent du plan de la page (`src/config/page-sections.js`), que
 * lit aussi la coquille pré-rendue : les deux canaux publient la même boîte,
 * donc la bascule shell → React ne décale rien.
 *
 * @param {{
 *   src: string, title: string, href: string, label: string,
 *   icone: string, classeIcone: string, frameClass: string, controlClass: string,
 * }} props
 */
export default function MapEmbed({ src, title, href, label, icone, classeIcone, frameClass, controlClass }) {
  const [afficherLaCarte, setAfficherLaCarte] = useState(false);

  if (afficherLaCarte) {
    return (
      <iframe
        src={src}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        className={frameClass}
        style={{ border: 0 }}
      />
    );
  }

  return (
    <div className={frameClass}>
      <IconePage nom={icone} classe={classeIcone} />
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={title}
        className={controlClass}
        onClick={(evenement) => {
          // Le lien reste vrai (il ouvre la fiche Google dans un nouvel onglet
          // si on le laisse faire) : c'est ce qui le rend utile sans JavaScript.
          evenement.preventDefault();
          setAfficherLaCarte(true);
        }}
      >
        {label}
      </a>
    </div>
  );
}
