/**
 * LA 404 DANS L'APPLICATION — la même matière que le reste du site.
 *
 * Elle peignait son propre écran : papier blanc, texte `stone`, et trois liens
 * nus en `orange-600` — une teinte mesurée à 3,39:1 sur une surface claire, sous
 * le seuil de 4,5:1 (défaut trouvé sur /login le 26/10/2026, corrigé là-bas en
 * `orange-700`). Une page 404 n'est pas un cas à part : c'est la dernière page
 * que voit un visiteur égaré, et elle était la seule du site à ne pas employer
 * son sable, sa carte, ni ses boutons.
 *
 * Ce fichier juge trois choses, et la troisième est celle qu'aucun autre garde
 * ne pouvait voir :
 *   1. les CLASSES qui portent la palette du site (sable, carte éditoriale,
 *      titre serif, boutons) — une page qui les perd repasse en indicateurs
 *      Tailwind inventés sans que rien ne le dise ;
 *   2. les DESTINATIONS de la 404 React et de la 404 STATIQUE sont les mêmes,
 *      et dans le même ordre : deux pages qui annoncent deux choses différentes
 *      sous le même statut 404 font douter du site entier ;
 *   3. le CONTRASTE du ton de lien sur la carte RÉELLEMENT composée (le verre
 *      à 94 % posé sur le sable), et pas sur un blanc théorique.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { contrasteEntre, SEUIL_TEXTE } from '../../../scripts/contraste-jetons.js';
import { CONTACT } from '../../config/contact';
import { buildNotFoundPage } from '../../../vite-plugins/prerender/not-found.js';
import fr from '../../i18n/fr.json';
import NotFound from '../NotFound';

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ currentLanguage: 'fr', changeLanguage: vi.fn(), t: (cle) => fr[cle] ?? cle }),
}));

const rendre = () => render(
  <MemoryRouter>
    <NotFound />
  </MemoryRouter>
);

/** Le SABLE de la page et le VERRE de la carte, ceux de `src/index.css`. */
const SABLE = [247, 243, 236]; // --kojo-sable #f7f3ec
const VERRE = [252, 249, 242]; // .carte-editoriale rgba(252, 249, 242, 0.94)
const OPACITE_DU_VERRE = 0.94;
// Les teintes de lien que le dépôt emploie sur une surface claire, et la valeur
// que chacune vaut réellement. Une classe inconnue est un REFUS NOMMÉ, jamais
// une mesure sur un ton supposé : c'est ainsi que le garde de /login a trouvé
// qu'`orange-600` valait 3,39:1 là où on le croyait lisible.
const TONS_DE_LIEN = {
  'text-orange-700': '#c2410c', // --kojo-orange-fonce
  'text-orange-600': '#ea580c', // la teinte de la régression (3,39:1 sur la carte)
  'text-orange-900': '#7c2d12', // --kojo-brun
  'text-stone-600': '#57534e',
};

const tonDuLien = (classe) => {
  const nom = String(classe)
    .split(/\s+/)
    .find((jeton) => jeton in TONS_DE_LIEN);
  if (!nom) {
    throw new Error(`ton de lien INCONNU dans « ${classe} » : ce garde ne sait pas le mesurer`);
  }
  return TONS_DE_LIEN[nom];
};

const composer = (dessus, opacite, dessous) =>
  dessus.map((canal, i) => Math.round(canal * opacite + dessous[i] * (1 - opacite)));

const hexa = (canaux) => `#${canaux.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

describe('NotFound — la palette et les composants du site', () => {
  it('peint le sable du site et une carte éditoriale, pas un écran à part', () => {
    const { container } = rendre();
    const page = container.firstElementChild;
    expect(page.className).toContain('fond-sable');

    const carte = container.querySelector('.carte-editoriale');
    expect(carte, 'la 404 ne monte pas de carte éditoriale').not.toBeNull();
    expect(carte.className).toContain('carte-publique');
    expect(carte.className).toContain('text-center');
  });

  it('emploie le titre serif et les DEUX boutons du site', () => {
    rendre();
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('titre-section');

    const accueil = screen.getByRole('link', { name: fr.home });
    const emplois = screen.getByRole('link', { name: fr.notFoundJobsLink });
    expect(accueil.className).toContain('bouton');
    expect(accueil.className).toContain('bouton-encre');
    expect(emplois.className).toContain('bouton');
    expect(emplois.className).toContain('bouton-clair');
  });

  it('ne revient ni au gris froid ni à la teinte de lien qui échouait', () => {
    const { container } = rendre();
    const html = container.innerHTML;
    for (const ancienne of ['orange-600', 'bg-white', 'bg-gray-50', 'text-gray-']) {
      expect(html, `la 404 repeint « ${ancienne} »`).not.toContain(ancienne);
    }
  });

  it('garde son ton de lien AU-DESSUS du seuil, sur la carte composée', () => {
    // Le lien est peint sur la carte, qui est du verre posé sur le sable : le
    // fond réel n'est ni blanc ni le sable, c'est le composite des deux. Et le
    // ton est LIS DANS LA CLASSE du lien, jamais supposé.
    const { container } = rendre();
    const surface = hexa(composer(VERRE, OPACITE_DU_VERRE, SABLE));

    // Les liens TEXTE de la carte — les seuls dont l'encre est portée par une
    // classe du plan (`text-orange-…`), donc les seuls qu'on puisse lire.
    const liens = [...container.querySelectorAll('.carte-editoriale nav a')];
    expect(liens).toHaveLength(2);
    for (const lien of liens) {
      const teinte = tonDuLien(lien.className);
      const ratio = contrasteEntre(teinte, surface);
      expect(ratio, `${teinte} (${lien.className}) sur ${surface} (verre sur sable)`)
        .toBeGreaterThanOrEqual(SEUIL_TEXTE);
    }

    // Les deux BOUTONS : leur couple encre/fond est celui de la feuille
    // (`.bouton-encre`, `.bouton-clair`, jetons du socle), pas d'une classe du
    // plan — on le mesure donc aux valeurs nommées de `src/index.css`.
    for (const [nom, encre, fond] of [
      ['bouton-encre', '#ffffff', '#1c1917'],
      ['bouton-clair', '#1c1917', '#fffdf9'],
    ]) {
      const ratio = contrasteEntre(encre, fond);
      expect(ratio, `${nom} : ${encre} sur ${fond}`).toBeGreaterThanOrEqual(SEUIL_TEXTE);
    }
  });

  it('annonce les MÊMES destinations que la 404 statique', () => {
    const { container } = rendre();
    const peintes = [...container.querySelectorAll('a')].map((lien) =>
      lien.getAttribute('href')
    );

    const T = (cle) => fr[cle];
    const statique = buildNotFoundPage({ T, contact: CONTACT });
    const servies = [...statique.matchAll(/<a [^>]*href="([^"]+)"/g)].map(([, href]) => href);

    expect(peintes).toEqual(servies);
    // Et ce sont bien les quatre portes, nommées : un lien recopié de travers
    // ne peut pas pourrir d'un seul côté sans que ce cas le voie.
    expect(peintes).toEqual(['/', '/jobs', '/how-it-works', `mailto:${CONTACT.email}`]);
  });
});
