/**
 * UNE BARRE QUI CESSE D'ÊTRE AFFICHÉE NE GARDE PAS SON ÉTAT OUVERT.
 *
 * ── La classe de défaut, la même que le panneau de notifications ─────────────
 * La barre de navigation existe en DEUX dispositions, séparées par un point de
 * rupture CSS (`hidden md:flex` / `md:hidden`) : les deux vivent dans le même
 * DOM, et rien n'empêche une surface ouverte dans l'une de survivre au
 * franchissement. Le centre de notifications l'a payé (une instance masquée
 * refermait le panneau de l'autre PENDANT l'appui) et s'en protège en fermant
 * dès que son conteneur n'est plus affiché (`NotificationPanel`, sur
 * `resize`). Le MENU MOBILE portait le même défaut, à l'identique, et c'est ce
 * que ce fichier tient : `Navbar.js` lit l'affichage RÉEL de son panneau
 * (`getClientRects()`) au lieu de recopier les 768 px de Tailwind.
 *
 * Ce que jsdom peut et ne peut pas dire : il ne calcule AUCUNE mise en page,
 * donc il ne verra jamais le défaut lui-même (le menu qui reste ouvert quand la
 * barre disparaît) — c'est le fait mesuré par `e2e/barres-rupture.spec.js`, dans
 * Chromium, où 900 px de molette ne faisaient défiler la page que de 0 px. Ce
 * qui se prouve ICI est la RÈGLE, dans les deux sens : un panneau mesuré comme
 * non affiché ferme le menu, un panneau mesuré comme affiché NE LE FERME PAS
 * (une garde qui fermerait sur n'importe quel redimensionnement serait un autre
 * défaut, et le test qui ne prouverait que le premier sens le laisserait
 * passer), et l'écouteur n'existe que tant que le menu est ouvert.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// `t` rend la clé : le test nomme ses cibles par la clé que le composant
// utilise réellement (jamais par une copie du libellé français).
vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, changeLanguage: vi.fn(), currentLanguage: 'fr' }),
}));

// Visiteur NON connecté : le menu mobile est le même, et sa barre ne monte
// alors aucune cloche (le couple cloche/panneau a son propre fichier).
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, logout: vi.fn() }),
}));

import Navbar from '../Navbar';
import { LANGUAGES } from '../../config/languages';

const MENU = () => document.querySelector('#mobile_menu');
const ouvrir = () => {
  fireEvent.click(screen.getByRole('button', { name: 'openMenu' }));
};
const redimensionner = () => act(() => { window.dispatchEvent(new Event('resize')); });

/** Les dimensions d'un élément affiché : ce que `getClientRects()` rendrait. */
const RECT_AFFICHE = [{ width: 380, height: 320, top: 64, left: 0, right: 380, bottom: 384, x: 0, y: 64 }];

let rectsOriginaux;

beforeEach(() => {
  rectsOriginaux = Element.prototype.getClientRects;
});

afterEach(() => {
  Element.prototype.getClientRects = rectsOriginaux;
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

describe('menu mobile — il se ferme quand sa barre cesse d’être affichée', () => {
  it('un panneau mesuré comme NON AFFICHÉ ferme le menu et rend le défilement', () => {
    render(<MemoryRouter><Navbar /></MemoryRouter>);
    ouvrir();
    expect(MENU()).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');

    // jsdom ne calcule aucune mise en page : `getClientRects()` y rend une liste
    // vide pour TOUT élément, exactement ce que la garde doit lire comme « plus
    // rien n'est affiché » (en Chromium, c'est ce que rend la barre passée sous
    // `md:hidden`).
    redimensionner();

    expect(MENU()).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('un panneau mesuré comme AFFICHÉ n’est PAS fermé par un redimensionnement', () => {
    Element.prototype.getClientRects = () => RECT_AFFICHE;
    render(<MemoryRouter><Navbar /></MemoryRouter>);
    ouvrir();
    expect(MENU()).toBeTruthy();

    redimensionner();

    // Le second sens est ce qui empêche la garde d'être un « ferme sur resize »
    // déguisé : un téléphone qui change de barre d'URL, un clavier qui s'ouvre
    // et un zoom émettent tous des `resize`.
    expect(MENU()).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('la barre qui DISPARAÎT rend le défilement, même sans repasser par l’état fermé', () => {
    const { unmount } = render(<MemoryRouter><Navbar /></MemoryRouter>);
    ouvrir();
    expect(document.body.style.overflow).toBe('hidden');

    // Le cas que l'écran de fermeture ne couvre pas : la barre est DÉMONTÉE
    // alors que le menu est ouvert. Personne ne rappellera `closeMobileMenu`,
    // donc aucune re-exécution de l'effet ne remettra le verrou. C'est le
    // chemin de l'écran d'erreur (l'ErrorBoundary remplace tout `AppRoutes`,
    // navbar comprise) : sans restitution au démontage, le visiteur tombe sur
    // une page qu'il ne peut plus faire défiler — le symptôme exact du défaut
    // que ce fichier surveille, sur l'écran qui doit justement expliquer ce qui
    // vient de casser.
    unmount();

    expect(document.body.style.overflow, 'un verrou global doit mourir avec son preneur').toBe('');
  });

  it('l’écouteur de redimensionnement n’existe QUE quand le menu est ouvert', () => {
    const ajouts = vi.spyOn(window, 'addEventListener');
    const retraits = vi.spyOn(window, 'removeEventListener');

    render(<MemoryRouter><Navbar /></MemoryRouter>);
    const combien = (espion) => espion.mock.calls.filter(([type]) => type === 'resize').length;

    expect(combien(ajouts)).toBe(0);
    ouvrir();
    expect(combien(ajouts)).toBe(1);

    // Fermer par la commande du menu (le fond de fermeture, `closeMenu`) doit
    // défaire l'écouteur : sans ça, chaque ouverture en laisserait un.
    fireEvent.click(screen.getAllByRole('button', { name: 'closeMenu' })[0]);
    expect(MENU()).toBeNull();
    expect(combien(retraits)).toBe(1);
  });
});

/**
 * LE TIROIR MOBILE MONTE LE MÊME MENU QUE LA BARRE DU HAUT, ET LA LISTE A UN
 * SEUL PROPRIÉTAIRE.
 *
 * Deux duplications se referment ici. D'abord la FORME : le tiroir portait son
 * propre `<select>` natif pendant que la barre du haut portait un menu déroulant
 * (`LanguageSelector`) — deux contrôles différents pour un seul choix, avec
 * deux comportements d'appui extérieur à maintenir. Le tiroir monte désormais le
 * MÊME composant, donc le même menu. Ensuite la LISTE : elle vivait à TROIS
 * endroits — `LANGUAGES` du menu de la barre du haut, les cinq `<option>` ÉCRITS
 * EN DUR dans le tiroir mobile (« Français » … « Mooré ») et les codes nus du
 * contexte. Une langue ajoutée au menu haut n'arrivait donc jamais dans le
 * tiroir, et rien ne rougissait : c'est exactement ce que
 * `src/config/countries.js` a fermé pour les pays, et pour la même raison — on
 * ne surveille pas une copie, on la supprime. Le premier cas lit le RENDU (le
 * menu du tiroir offre chaque langue du propriétaire, et plus aucun `<select>`) ;
 * le second tient la FORME sur `src/` (aucun autre fichier ne la re-déclare).
 */
describe('le menu de langue, partagé et d’un seul propriétaire', () => {
  it('le tiroir mobile monte le MÊME menu que la barre du haut, et non un sélecteur à lui', () => {
    render(<MemoryRouter><Navbar /></MemoryRouter>);
    ouvrir();

    // Le tiroir ne publie plus de sélecteur natif : un seul rendu pour la liste.
    expect(
      document.querySelector('#mobile_language_selector'),
      'le tiroir mobile ne doit plus publier son propre <select>'
    ).toBeNull();

    const boutonsTiroir = () => [...document.querySelectorAll('#mobile_menu button')];
    const declencheur = boutonsTiroir().find((b) => b.textContent.includes(LANGUAGES[0].nativeName));
    expect(declencheur, 'le déclencheur de langue du tiroir est introuvable').toBeTruthy();

    fireEvent.click(declencheur);
    const ouverts = boutonsTiroir();
    // Plancher de lecture : un menu qui ne rendrait rien passerait sans rien
    // comparer (le seul déclencheur ne suffit pas à prouver la liste).
    expect(ouverts.length, 'le menu déroulant du tiroir n’a pas été lu').toBeGreaterThanOrEqual(
      LANGUAGES.length + 1
    );
    expect(
      LANGUAGES.filter((l) => ouverts.some((b) => b.textContent.includes(l.nativeName))).length,
      'chaque langue du propriétaire doit être offerte par le menu du tiroir'
    ).toBe(LANGUAGES.length);
  });

  it('aucun autre fichier de src/ ne re-déclare la liste', () => {
    const fichiers = import.meta.glob('../../**/*.{js,jsx}', { query: '?raw', import: 'default', eager: true });
    const sources = Object.entries(fichiers).filter(
      ([chemin]) => !chemin.includes('__tests__') && !chemin.endsWith('setupTests.js')
    );
    expect(sources.length, 'le balayage ne lit plus son sujet').toBeGreaterThan(100);

    // Ce qui est cherché est une DÉCLARATION, pas une mention : le libellé est
    // la valeur d'une propriété de libellé (`name:`, `nativeName:`, `label:`)
    // ou le texte publié par JSX (`>Français<`). Deux pièges mesurés le
    // 25/09/2026, tous deux rencontrés pour de vrai :
    //   • un premier détecteur ne lisait que les libellés ENTRE GUILLEMETS, or
    //     le tiroir mobile les publie en TEXTE JSX — la mutation qui remettait
    //     les cinq `<option>` en dur restait donc VERTE, sans un mot ;
    //   • un second comptait les libellés nommés PARTOUT, or
    //     `geolocationService.js` les nomme aussi dans ses MESSAGES de
    //     suggestion (« … préfèrent le Français ou le Wolof ») : sa copie
    //     aurait alors pu disparaître sans que l'exemption devienne périmée,
    //     c'est-à-dire sans que le refus ci-dessous ait le moindre sujet.
    const libelles = [...new Set(LANGUAGES.flatMap(({ name, nativeName }) => [name, nativeName]))];
    const declarees = (texte) =>
      libelles.filter((l) =>
        new RegExp(`(?:name|nativeName|label)\\s*:\\s*['"\u0060]${l}['"\u0060]|>\\s*${l}\\s*<`).test(texte)
      ).length;
    const declarants = sources
      .filter(([, texte]) => declarees(texte) >= 2)
      .map(([chemin]) => chemin);

    // Une seule copie est tolérée, et elle dit POURQUOI : `AVAILABLE_LANGUAGES`
    // du service de géolocalisation est une table indexée qui porte en plus le
    // DRAPEAU, lue par le contrôle de langue de l'inscription et par la
    // suggestion de langue d'un pays — un fait voisin, pas la liste de la barre.
    // Son unification est un chantier à part ; ce qui est refusé ici, c'est
    // qu'elle passe pour la même chose, et l'exemption est refusée dès qu'elle
    // n'a plus de sujet (copie supprimée ou renommée).
    const COPIE_CONNUE = '/services/geolocationService.js';
    expect(
      declarants.some((chemin) => chemin.endsWith(COPIE_CONNUE)),
      `l’exemption pour ${COPIE_CONNUE} n’a plus de sujet : elle doit être retirée`
    ).toBe(true);

    expect(
      declarants.filter((chemin) => !chemin.endsWith(COPIE_CONNUE)).map((chemin) => chemin.split('/').pop()),
      'la liste des langues est re-déclarée ailleurs que chez son propriétaire'
    ).toEqual(['languages.js']);
  });
});

/**
 * La règle de FORME, sur tout `src/` : le même défaut ne peut pas revenir par un
 * autre composant. Poser un verrou GLOBAL (`document.body.style.overflow`) sans
 * vérifier que la surface qui le justifie est encore AFFICHÉE, c'est accepter
 * qu'il survive à un point de rupture — et le symptôme ne ressemble pas à un
 * menu oublié, il ressemble à une page morte.
 */
describe('forme des verrous de défilement dans src/', () => {
  // `src/` est fait de `.js` (137 fichiers lus au 25/09/2026) : ne balayer que
  // les `.jsx` ne lirait que les tests, c'est-à-dire rien.
  const fichiers = import.meta.glob('../../**/*.{js,jsx}', { query: '?raw', import: 'default', eager: true });
  const sources = Object.entries(fichiers).filter(
    ([chemin]) => !chemin.includes('__tests__') && !chemin.endsWith('setupTests.js')
  );

  it('tout verrou de défilement lit l’affichage de sa surface (getClientRects)', () => {
    // Plancher de lecture : un balayage qui ne trouve rien passerait sans rien
    // vérifier (dossier renommé, glob cassé, extension oubliée).
    expect(sources.length).toBeGreaterThan(100);

    const verrouillent = sources.filter(([, texte]) => /document\.body\.style\.overflow\s*=/.test(texte));
    expect(verrouillent.length, 'aucun verrou de défilement trouvé : le balayage ne lit plus son sujet').toBeGreaterThan(0);

    const fautifs = verrouillent
      .filter(([, texte]) => !/getClientRects\s*\(/.test(texte))
      .map(([chemin]) => chemin);
    expect(fautifs, 'un verrou de défilement sans lecture de l’affichage peut survivre à sa barre').toEqual([]);
  });
});
