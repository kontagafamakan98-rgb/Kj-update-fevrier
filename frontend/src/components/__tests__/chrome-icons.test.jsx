import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { ICONES, Icone } from '../chrome-icons';

/**
 * Régression mesurée en production le 23/10/2026 : le hamburger du téléphone
 * existait, répondait au doigt, et ne dessinait RIEN.
 *
 * Le défaut n'était pas dans le composant mais dans le registre : quatre entrées
 * (`menu`, `fermer`, `coche`, `croix`) portaient la seule donnée `d` du tracé
 * (`M4 6h16…`) au lieu d'un élément (`<path d="…"/>`). `Icone` l'injecte par
 * `dangerouslySetInnerHTML` : dans un `<svg>`, ce texte devient un NŒUD DE TEXTE,
 * que le navigateur ne peint jamais. Le bouton mesurait donc 44 × 44 px, le
 * `<svg>` 24 × 24, et l'écran ne montrait rien — l'utilisateur ne pouvait ni voir
 * qu'un menu existait, ni voir la croix qui le referme.
 *
 * Ce que ce test tient, et pourquoi il est sur le REGISTRE et pas sur un seul
 * nom : la même erreur d'écriture peut revenir sur n'importe quelle icône
 * ajoutée demain, et une icône vide ne lève nulle part — elle ne se voit qu'à
 * l'œil, sur un seul écran, souvent sur un seul appareil.
 */
describe('registre des icônes du chrome', () => {
  it('chaque entrée est du BALISAGE SVG, jamais la seule donnée d’un tracé', () => {
    const fautives = Object.entries(ICONES)
      .filter(([, contenu]) => !/<(path|circle|rect|line|polyline|polygon|ellipse)\b/.test(contenu))
      .map(([nom, contenu]) => `${nom} = ${JSON.stringify(contenu)}`);

    expect(fautives).toEqual([]);
  });

  it('le hamburger et la croix dessinent un tracé dans le SVG rendu', () => {
    for (const nom of ['menu', 'fermer']) {
      const { container, unmount } = render(<Icone nom={nom} />);
      const svg = container.querySelector(`svg[data-icone="${nom}"]`);

      expect(svg).toBeTruthy();
      // Un `<path>` ENFANT : c'est ce que le navigateur peint. Un nœud de texte
      // dans le `<svg>` (l'ancien défaut) laisse `querySelector` vide.
      expect(svg.querySelector('path')).toBeTruthy();
      // Le dessin n'est pas vide pour autant : trois traits pour le menu, deux
      // pour la croix — la donnée `d` doit être celle du registre.
      expect(svg.querySelector('path').getAttribute('d')).toBe(
        ICONES[nom].match(/d="([^"]+)"/)[1]
      );

      unmount();
    }
  });

  it('un nom inconnu lève au lieu de peindre un SVG vide', () => {
    expect(() => render(<Icone nom="inexistante" />)).toThrow(/n’est pas déclarée dans le registre/);
  });
});
