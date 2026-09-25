/**
 * Les surfaces qui se ferment sur un appui EXTÉRIEUR ne doivent pas avaler cet
 * appui.
 *
 * ── Le défaut, mesuré ──────────────────────────────────────────────────────
 * Deux mécanismes de « fermer au clic dehors » coexistaient dans le dépôt, et un
 * seul des deux laisse l'appui atteindre sa cible :
 *
 *   1. un ÉCOUTEUR sur `document` qui demande si l'appui est tombé dans son
 *      propre conteneur (`contains`) — l'appui n'est pas intercepté, il poursuit
 *      vers sa cible, et le menu se ferme par effet de bord : c'est ce que fait
 *      un menu natif du navigateur ;
 *   2. une SURFACE PLEIN ÉCRAN (`fixed inset-0`) posée pour capter l'appui.
 *      Celle-ci le CAPTURE : tant que le menu de langue était ouvert, Chromium
 *      arrêtait sur ce `<div>` chaque appui visant une autre commande de la
 *      barre — MESURÉ le 25/09/2026 par `e2e/appuis-exterieurs.spec.js`, qui
 *      voyait Playwright retenter 55 fois le clic sur le lien « Emplois ».
 *
 * C'est le même défaut de fond que le panneau de notifications dupliqué (un
 * appui visant une commande n'atteignait pas cette commande), par un autre
 * chemin. Ces tests le verrouillent sur les DEUX plans :
 *
 *   • le COMPORTEMENT des trois composants qui se ferment dehors
 *     (LanguageSelector, CountrySelector, CountrySelect) : la séquence réelle
 *     `mousedown` → `click`, l'appui dans la surface, l'appui sur le
 *     déclencheur, l'appui sur une autre commande ;
 *   • la FORME du mécanisme, sur tout `src/` : aucune surface plein écran
 *     invisible, et aucun écouteur d'appui extérieur dans un fichier qui ne
 *     teste pas la cible contre son propre conteneur.
 *
 * Ce que jsdom NE peut PAS voir, et pourquoi la preuve navigateur existe :
 * jsdom ne fait aucune mise en page et `fireEvent.click(element)` envoie l'appui
 * DIRECTEMENT à l'élément — une surface plein écran ne peut donc pas y
 * intercepter quoi que ce soit. Les tests de comportement ci-dessous mesurent la
 * logique de fermeture ; c'est la règle de forme (dernier `describe`) et
 * `e2e/appuis-exterieurs.spec.js` qui attrapent la surface qui capte.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

const changeLanguage = vi.fn();
const changeUserCountry = vi.fn();

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, currentLanguage: 'fr', changeLanguage }),
}));

vi.mock('../../contexts/CountryContext', () => ({
  useCountry: () => ({ currentCountry: 'senegal', changeUserCountry, isOwner: false }),
}));

import LanguageSelector from '../LanguageSelector';
import CountrySelector from '../CountrySelector';
import { CountrySelect } from '../CountryDisplay';

/** Un clic RÉEL : l'appui puis le relâchement, comme le fait le navigateur. */
const clicReel = (element) => {
  fireEvent.mouseDown(element);
  fireEvent.click(element);
};

/** Le libellé d'option, dans la liste du menu de langue. */
const optionLangue = (nom) => screen.getByRole('button', { name: new RegExp(nom) });

beforeEach(() => {
  changeLanguage.mockReset();
  changeUserCountry.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LanguageSelector — l'appui extérieur ferme, et atteint sa cible", () => {
  /** Le menu ET une autre commande de la même barre, comme dans la navbar. */
  const rendu = (onAutreCommande = vi.fn()) => {
    render(
      <>
        <LanguageSelector showDropdown />
        <button onClick={onAutreCommande}>Déconnexion</button>
      </>,
    );
    return onAutreCommande;
  };

  // Le déclencheur est le PREMIER bouton du document (les options du menu, qui
  // portent parfois le même libellé, sont rendues après lui).
  const declencheur = () => screen.getAllByRole('button')[0];

  it("un appui sur une AUTRE commande de la barre la déclenche, tout en refermant le menu", async () => {
    const autre = rendu();
    clicReel(declencheur());
    await waitFor(() => expect(optionLangue('Wolof')).toBeTruthy());

    clicReel(screen.getByRole('button', { name: 'Déconnexion' }));

    // Les DEUX effets, dans le même geste : c'est la propriété qui manquait.
    expect(autre).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Wolof/ })).toBeNull());
  });

  it("un appui sur le déclencheur ferme le menu — et ne le rouvre pas", async () => {
    rendu();
    clicReel(declencheur());
    await waitFor(() => expect(optionLangue('Wolof')).toBeTruthy());

    // Si l'appui sur le déclencheur était lu comme « extérieur », il fermerait
    // sur le `mousedown` et le `click` qui suit rouvrirait le menu.
    clicReel(declencheur());

    await waitFor(() => expect(screen.queryByRole('button', { name: /Wolof/ })).toBeNull());
  });

  it("un appui DANS la liste change la langue et ferme", async () => {
    rendu();
    clicReel(declencheur());
    await waitFor(() => expect(optionLangue('Wolof')).toBeTruthy());

    clicReel(optionLangue('Wolof'));

    expect(changeLanguage).toHaveBeenCalledWith('wo');
    await waitFor(() => expect(screen.queryByRole('button', { name: /Wolof/ })).toBeNull());
  });

  it("aucune surface plein écran n'est publiée pendant que le menu est ouvert", async () => {
    const { container } = render(<LanguageSelector showDropdown />);
    clicReel(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(optionLangue('Wolof')).toBeTruthy());

    expect(container.querySelectorAll('.fixed.inset-0')).toHaveLength(0);
  });
});

describe("CountrySelector — l'appui extérieur ferme, et atteint sa cible", () => {
  const rendu = (onAutreCommande = vi.fn()) => {
    render(
      <>
        <CountrySelector />
        <button onClick={onAutreCommande}>Filtres</button>
      </>,
    );
    return onAutreCommande;
  };

  // Le déclencheur est le PREMIER bouton du document — il porte le nom du pays
  // courant, qu'une option du menu porte AUSSI quand la liste est ouverte.
  const declencheur = () => screen.getAllByRole('button')[0];

  it("un appui sur une AUTRE commande de la page la déclenche, tout en refermant le menu", async () => {
    const autre = rendu();
    clicReel(declencheur());
    await waitFor(() => expect(screen.getByRole('button', { name: /Burkina/ })).toBeTruthy());

    clicReel(screen.getByRole('button', { name: 'Filtres' }));

    expect(autre).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Burkina/ })).toBeNull());
  });

  it("un appui sur le déclencheur ferme le menu — et ne le rouvre pas", async () => {
    rendu();
    clicReel(declencheur());
    await waitFor(() => expect(screen.getByRole('button', { name: /Burkina/ })).toBeTruthy());

    clicReel(declencheur());

    await waitFor(() => expect(screen.queryByRole('button', { name: /Burkina/ })).toBeNull());
  });

  it("aucune surface plein écran n'est publiée pendant que le menu est ouvert", async () => {
    const { container } = render(<CountrySelector />);
    clicReel(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: /Burkina/ })).toBeTruthy());

    expect(container.querySelectorAll('.fixed.inset-0')).toHaveLength(0);
  });
});

describe("CountrySelect — l'écouteur n'existe que quand il a quelque chose à fermer", () => {
  const appuisEnregistres = (espion) =>
    espion.mock.calls.filter(([evenement]) => evenement === 'mousedown' || evenement === 'touchstart').length;

  it("aucun écouteur d'appui n'est posé tant que la liste est fermée", async () => {
    const espion = vi.spyOn(document, 'addEventListener');
    render(<CountrySelect value="" onChange={vi.fn()} />);

    expect(appuisEnregistres(espion)).toBe(0);

    fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() => expect(appuisEnregistres(espion)).toBeGreaterThan(0));

    // Refermer le retire : l'écouteur suit la vie de la liste, pas celle du
    // composant.
    fireEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(screen.queryAllByRole('listbox')).toHaveLength(0));
  });

  it("un appui dehors ferme la liste sans avaler l'appui", async () => {
    const autre = vi.fn();
    render(
      <>
        <CountrySelect value="" onChange={vi.fn()} />
        <button onClick={autre}>Autre commande</button>
      </>,
    );

    fireEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());

    clicReel(screen.getByRole('button', { name: 'Autre commande' }));

    expect(autre).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });
});

/**
 * LA RÈGLE DE FORME, sur tout `src/`.
 *
 * Les tests ci-dessus mesurent trois composants ; ceux-ci mesurent la RÈGLE, pour
 * qu'un quatrième ne puisse pas rouvrir le défaut sans le dire. Deux formes sont
 * refusées, et une seule est exigée :
 *
 *   • une surface PLEIN ÉCRAN INVISIBLE (`fixed inset-0` sans fond dans sa propre
 *     classe) n'a qu'un usage : capter l'appui. C'est elle qui perdait les clics ;
 *   • un écouteur d'appui extérieur dans un fichier qui ne demande JAMAIS si
 *     l'appui est tombé chez lui (`contains`) : il fermerait sur l'appui qui vise
 *     sa propre surface, et un `click` ultérieur la rouvrirait ;
 *   • en revanche, un fond VISIBLE (`bg-black/30`, `bg-black/50`) est une
 *     décision d'interface : un tiroir ou une modale bloque la page derrière,
 *     c'est l'intention. Ces surfaces restent, et la règle les distingue par le
 *     fond, pas par une liste d'exceptions à tenir à jour.
 */
const RACINE_SRC = path.resolve(__dirname, '../..');

/** Les fichiers livrés de `src/` : les tests et le harnais ne se jugent pas. */
function fichiersSource(dossier = RACINE_SRC, accumule = []) {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      if (entree.name === '__tests__') continue;
      fichiersSource(complet, accumule);
    } else if (/\.jsx?$/.test(entree.name) && entree.name !== 'setupTests.js') {
      accumule.push(complet);
    }
  }
  return accumule;
}

/**
 * La chaîne de la classe CSS qui PRÉCÈDE la position donnée — la classe de
 * l'élément qui porte l'attribut trouvé juste après. On lit la valeur jusqu'à
 * son délimiteur (`"`, `'` ou backtick) : un fond déclaré dans la MÊME classe
 * compte, une classe voisine ne compte pas.
 */
function chaineDeClasse(source, position) {
  const debut = source.lastIndexOf('className', position);
  if (debut === -1 || position - debut > 400) return null;
  const affectation = source.indexOf('=', debut);
  // `className={`…`}` et `className={'…'}` passent par une accolade : on avance
  // jusqu'au DÉLIMITEUR de la valeur, pas jusqu'au caractère qui suit le `=`.
  // (Mesuré : sans ça, la forme synthétique en gabarit n'était pas vue du tout —
  // le contrôle aurait été aveugle à toutes les classes écrites ainsi.)
  let curseur = affectation + 1;
  while (source[curseur] === ' ' || source[curseur] === '{') curseur += 1;
  const ouvre = source[curseur];
  if (!['"', "'", '`'].includes(ouvre)) return null;
  const fin = source.indexOf(ouvre, curseur + 1);
  return fin === -1 ? null : source.slice(curseur + 1, fin);
}

/** Positions (1-indexées) de chaque occurrence de `motif` dans `source`. */
function lignesDe(source, motif) {
  const lignes = [];
  let index = source.indexOf(motif);
  while (index !== -1) {
    lignes.push({ ligne: source.slice(0, index).split('\n').length, classe: chaineDeClasse(source, index) });
    index = source.indexOf(motif, index + motif.length);
  }
  return lignes;
}

// Sans drapeau global : ce motif sert à `test()`, et un `g` y rendrait le
// résultat dépendant de l'appel précédent (`lastIndex` conservé).
const APPUI_EXTERIEUR = /(?:document|window)\.addEventListener\(\s*['"](mousedown|touchstart|click|pointerdown)['"]/;

/** Toutes les surfaces plein écran d'une source, avec la classe qui les porte. */
function surfacesPleinEcran(source) {
  return lignesDe(source, 'fixed inset-0')
    .filter(({ classe }) => classe !== null);
}

/** Celles qui ne déclarent aucun fond : elles ne peuvent que capter l'appui. */
function surfacesCaptantes(source) {
  return surfacesPleinEcran(source).filter(({ classe }) => !/\bbg-/.test(classe));
}

describe('le motif de fermeture extérieure est pinné sur tout src/', () => {
  const sources = fichiersSource().map((fichier) => ({
    relatif: path.relative(RACINE_SRC, fichier).replace(/\\/g, '/'),
    contenu: fs.readFileSync(fichier, 'utf8'),
  }));

  it('la règle distingue bien un fond visible d’une surface qui capte', () => {
    // Formes synthétiques : le fond est ce qui décide, pas la position.
    expect(surfacesCaptantes('  <div className="fixed inset-0 z-10" onClick={f} />')).toHaveLength(1);
    expect(surfacesCaptantes('  <div className="fixed inset-0 bg-black/30" onClick={f} />')).toHaveLength(0);
    expect(surfacesCaptantes('  <div className={`fixed inset-0 ${x}`} onClick={f} />')).toHaveLength(1);
    expect(surfacesCaptantes('  <div className="absolute inset-0" onClick={f} />')).toHaveLength(0);
  });

  it("aucune surface plein écran sans fond n'est livrée (c'est la forme qui avalait l'appui)", () => {
    const toutes = sources.flatMap(({ relatif, contenu }) =>
      surfacesPleinEcran(contenu).map(({ ligne, classe }) => ({ relatif, ligne, classe })));
    const fautives = toutes
      .filter(({ classe }) => !/\bbg-/.test(classe))
      .map(({ relatif, ligne, classe }) => `${relatif}:${ligne} — classe « ${classe} »`);

    // Le contrôle lit-il son sujet ? Sans cette ligne, un balayage aveugle (mauvais
    // chemin, extraction cassée) passerait au vert en ne trouvant rien.
    expect(toutes.length).toBeGreaterThan(0);
    expect(fautives).toEqual([]);
  });

  it("chaque écouteur d'appui extérieur demande si l'appui est tombé chez lui", () => {
    const ecouteurs = sources.filter(({ contenu }) => APPUI_EXTERIEUR.test(contenu));
    const fautifs = ecouteurs
      .filter(({ contenu }) => !contenu.includes('.contains('))
      .map(({ relatif }) => relatif);

    // Trois composants se ferment aujourd'hui sur un appui extérieur (le
    // panneau de notifications, le menu de langue, le sélecteur de pays de la
    // page des missions) — plus le sélecteur de pays des formulaires : quatre
    // fichiers. En trouver moins veut dire que le balayage n'a pas lu son sujet.
    expect(ecouteurs.length).toBeGreaterThanOrEqual(4);
    expect(fautifs).toEqual([]);
  });

  it('la règle sait mordre : un écouteur sans test de conteneur est nommé', () => {
    // Le contrôle ci-dessus ne vaut que s'il peut échouer : une source
    // synthétique qui écoute dehors sans jamais vérifier la cible doit être
    // retenue, et la même avec `contains` doit passer.
    const sansTest = "document.addEventListener('mousedown', () => setOpen(false));";
    const avecTest = "document.addEventListener('mousedown', (e) => { if (!ref.current.contains(e.target)) setOpen(false); });";

    expect([sansTest, avecTest].filter((source) => APPUI_EXTERIEUR.test(source) && !source.includes('.contains(')))
      .toEqual([sansTest]);
  });
});
