import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import DeferredMap, { FENETRE_DE_STABILITE_MS } from '../DeferredMap';

// ── CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PEUT PAS PROUVER ───────────────
// Ici : le COMPORTEMENT — l'observateur n'est créé qu'à une mise en page
// STABLE, l'iframe n'est montée que sur une intersection RÉELLE, et un
// navigateur sans observateur ne reçoit pas de carte du tout.
// jsdom n'a ni mise en page ni requête réseau : il ne peut pas prouver que rien
// n'est PARTI. Ce fait-là est mesuré en vrai Chromium par
// `e2e/carte-facade.spec.js` (aucune requête tant que le bloc est hors du
// viewport, la carte chargée dès qu'il y entre) — même partage des rôles que
// partout dans ce dépôt.

/** Une doublure d'observateur qui RETIENT ses rappels : le test décide quand. */
class ObservateurDoublure {
  static instances = [];

  constructor(rappel) {
    this.rappel = rappel;
    this.observe = vi.fn();
    this.disconnect = vi.fn();
    ObservateurDoublure.instances.push(this);
  }

  /** Simule l'entrée (ou non) du bloc dans le viewport. */
  declencher(isIntersecting) {
    act(() => {
      this.rappel([{ isIntersecting }], this);
    });
  }
}

const POSER_UN_OBSERVATEUR = () => {
  ObservateurDoublure.instances = [];
  vi.stubGlobal('IntersectionObserver', ObservateurDoublure);
};

const dernierObservateur = () => ObservateurDoublure.instances[ObservateurDoublure.instances.length - 1];

/** Laisse passer la porte de stabilité (deux échantillons de mise en page égaux). */
const laisserSeStabiliser = () => act(() => vi.advanceTimersByTime(FENETRE_DE_STABILITE_MS + 10));

/**
 * Fige la hauteur du document, pour que le test puisse présenter une mise en
 * page qui BOUGE (le cas mesuré en vrai : un panneau au-dessus du bloc rend son
 * contenu après coup). jsdom ne calcule aucune mise en page : sans ce contrôle,
 * `scrollHeight` vaut toujours 0 et la porte de stabilité serait franchie au
 * premier échantillon.
 */
const figerLaHauteurDuDocument = (hauteurs) => {
  let appel = 0;
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => {
      const valeur = hauteurs[Math.min(appel, hauteurs.length - 1)];
      appel += 1;
      return valeur;
    },
  });
};

const PROPS = {
  src: 'https://www.openstreetmap.org/export/embed.html?bbox=-17%2C12%2C-11%2C16&layer=mapnik',
  href: 'https://www.openstreetmap.org/?bbox=-17%2C12%2C-11%2C16',
  title: 'Carte · Kojo, Sénégal',
  label: 'Afficher la carte',
};

describe('carte différée — le comportement', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete document.documentElement.scrollHeight;
  });

  it('sans `IntersectionObserver`, publie un LIEN (pas de carte, et surtout pas de chargement de secours)', () => {
    // jsdom ne fournit pas d'observateur : c'est exactement l'état testé.
    expect(typeof IntersectionObserver).toBe('undefined');

    const { container } = render(<DeferredMap {...PROPS} />);

    expect(container.querySelectorAll('iframe')).toHaveLength(0);
    const lien = screen.getByRole('link', { name: PROPS.label });
    expect(lien.getAttribute('href')).toBe(PROPS.href);
    expect(lien.getAttribute('target')).toBe('_blank');
  });

  it('n’observe PAS avant que la mise en page soit stable (le bloc ne juge pas un état transitoire)', () => {
    POSER_UN_OBSERVATEUR();
    vi.useFakeTimers();
    render(<DeferredMap {...PROPS} />);

    // Rien n'est observé au montage : c'est la porte, et c'est elle qui empêche
    // de décider sur une page qui grandit encore.
    expect(ObservateurDoublure.instances).toHaveLength(0);

    laisserSeStabiliser();

    expect(ObservateurDoublure.instances).toHaveLength(1);
  });

  it('attend que la mise en page CESSE de bouger : une page qui grandit ne fait pas créer l’observateur', () => {
    POSER_UN_OBSERVATEUR();
    vi.useFakeTimers();
    // Le cas mesuré : 1 608 px au montage, 1 975 px après le rendu du panneau
    // au-dessus du bloc — puis plus rien.
    figerLaHauteurDuDocument([1608, 1975, 1975, 1975]);
    render(<DeferredMap {...PROPS} />);

    laisserSeStabiliser();
    // Deux hauteurs différentes ne font pas deux échantillons ÉGAUX : on attend
    // encore.
    expect(ObservateurDoublure.instances).toHaveLength(0);

    laisserSeStabiliser();
    expect(ObservateurDoublure.instances).toHaveLength(1);
  });

  it('ne monte RIEN tant que le bloc n’est pas entré dans le viewport', () => {
    POSER_UN_OBSERVATEUR();
    vi.useFakeTimers();
    const { container } = render(<DeferredMap {...PROPS} />);
    laisserSeStabiliser();

    const observateur = dernierObservateur();
    expect(observateur.observe).toHaveBeenCalledTimes(1);
    expect(observateur.observe.mock.calls[0][0]).toBe(container.querySelector('[data-carte-differee]'));
    expect(container.querySelectorAll('iframe')).toHaveLength(0);

    // Un rappel « pas encore dans la fenêtre » ne monte rien : c'est la
    // différence avec `loading="lazy"`, qui charge à l'approche.
    observateur.declencher(false);
    expect(container.querySelectorAll('iframe')).toHaveLength(0);
    expect(screen.getByRole('link', { name: PROPS.label })).toBeTruthy();
  });

  it('monte la carte sur une intersection RÉELLE, avec sa source et son titre', () => {
    POSER_UN_OBSERVATEUR();
    vi.useFakeTimers();
    const { container } = render(<DeferredMap {...PROPS} />);
    laisserSeStabiliser();
    dernierObservateur().declencher(true);

    const carte = container.querySelector('iframe');
    expect(carte).toBeTruthy();
    expect(carte.getAttribute('src')).toBe(PROPS.src);
    expect(carte.getAttribute('title')).toBe(PROPS.title);
    // Le lien de repli disparaît : il n'y a plus deux fois la même destination.
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('débranche l’observateur dès qu’il a servi, et n’en crée pas un second', () => {
    POSER_UN_OBSERVATEUR();
    vi.useFakeTimers();
    const { container } = render(<DeferredMap {...PROPS} />);
    laisserSeStabiliser();

    const observateur = dernierObservateur();
    expect(observateur.disconnect).not.toHaveBeenCalled();

    observateur.declencher(true);

    // Le rappel débranche lui-même, et le nettoyage d'effet repasse derrière
    // (`disconnect()` est idempotent) : ce qui compte est qu'aucun SECOND
    // observateur n'existe, donc qu'aucune observation ne survit au montage.
    expect(observateur.disconnect).toHaveBeenCalled();
    expect(ObservateurDoublure.instances).toHaveLength(1);
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('garde la MÊME boîte avant et après le montage — l’apparition de la carte ne déplace rien', () => {
    POSER_UN_OBSERVATEUR();
    vi.useFakeTimers();
    const { container } = render(<DeferredMap {...PROPS} />);
    laisserSeStabiliser();
    const boite = container.querySelector('[data-carte-differee]');
    const classesAvant = boite.className;

    dernierObservateur().declencher(true);

    expect(container.querySelector('[data-carte-differee]').className).toBe(classesAvant);
  });

  it('ne laisse pas de minuteur derrière lui quand il est démonté', () => {
    POSER_UN_OBSERVATEUR();
    vi.useFakeTimers();
    const { unmount } = render(<DeferredMap {...PROPS} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
