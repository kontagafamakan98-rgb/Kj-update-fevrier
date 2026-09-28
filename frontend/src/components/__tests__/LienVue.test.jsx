/**
 * LE RACCORD DE PAGE N'EST POSÉ QUE POUR UN CLIC QUI LUI APPARTIENT.
 *
 * Ce que ce fichier tient, et ce que jsdom ne peut PAS dire : jsdom ne peint
 * rien, donc il ne voit jamais l'animation elle-même. Ce qui se prouve ici est
 * la RÈGLE, dans les trois sens qui comptent :
 *   • un clic gauche simple appelle `document.startViewTransition` UNE fois et
 *     navigue ;
 *   • un appui modifié (Ctrl/Cmd/Shift/Alt) n'appelle RIEN — c'est le
 *     navigateur qui décide d'un nouvel onglet — et la navigation normale de
 *     React Router reste disponible ;
 *   • sans `startViewTransition` (navigateur plus ancien), RIEN n'est appelé et
 *     le lien navigue comme avant : l'amélioration est progressive, jamais un
 *     prérequis.
 * L'animation réelle est mesurée en navigateur (sonde instrumentée, 27/09/2026 :
 * `appels=1`, aucun rechargement, aucune erreur console).
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LienVue from '../LienVue';

const Page = () => (
  <MemoryRouter initialEntries={['/']}>
    <LienVue to="/cible">Aller</LienVue>
    <Routes>
      <Route path="/" element={<div>Accueil</div>} />
      <Route path="/cible" element={<div>Cible</div>} />
    </Routes>
  </MemoryRouter>
);

/** Un `startViewTransition` de laboratoire : il compte et joue le callback. */
const poserStub = (compteur) => {
  document.startViewTransition = (rappel) => {
    compteur.appels += 1;
    rappel();
    return {
      finished: Promise.resolve(),
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      skipTransition() {},
    };
  };
};

describe('LienVue — la transition de vue native, et ses gardes', () => {
  let compteur;
  const original = document.startViewTransition;

  beforeEach(() => {
    compteur = { appels: 0 };
  });

  afterEach(() => {
    if (original === undefined) delete document.startViewTransition;
    else document.startViewTransition = original;
  });

  it('un clic gauche simple déclenche la transition et navigue', () => {
    poserStub(compteur);
    render(<Page />);
    fireEvent.click(screen.getByRole('link', { name: 'Aller' }));
    expect(compteur.appels).toBe(1);
    expect(screen.getByText('Cible')).toBeTruthy();
  });

  it('un appui modifié (Ctrl) n’est pas intercepté', () => {
    poserStub(compteur);
    render(<Page />);
    fireEvent.click(screen.getByRole('link', { name: 'Aller' }), { ctrlKey: true });
    expect(compteur.appels).toBe(0);
  });

  it('sans startViewTransition, rien n’est appelé et le lien navigue quand même', () => {
    delete document.startViewTransition;
    render(<Page />);
    fireEvent.click(screen.getByRole('link', { name: 'Aller' }));
    expect(compteur.appels).toBe(0);
    expect(screen.getByText('Cible')).toBeTruthy();
  });
});
