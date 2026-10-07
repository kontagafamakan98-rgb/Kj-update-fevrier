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
 * `appels=1`, aucun rechargement, aucune erreur console) et l'appui RÉEL sur les
 * deux appels du héros de l'accueil l'est aussi (`e2e/commandes-atteignables.spec.js`,
 * ajouté le 07/10/2026 : c'est là que la navigation a été délivrée en même temps
 * que la réparation, après qu'une couche décorative l'avait rendue inatteignable).
 *
 * ── Et le SECOND propriétaire du lien, refusé à la source ───────────────────
 * L'amélioration progressive ne vaut que si elle est UNIVERSELLE : un seul
 * fichier livré qui garde le `Link` de React Router, et les liens de ce fichier
 * changent de page d'un coup, sans que rien ne rougisse. C'est arrivé — la
 * migration des pages du 27/09/2026 a laissé `components/JobsResults.js`
 * derrière elle, mesuré le 07/10/2026 — donc le dernier `describe` de ce fichier
 * refuse tout importateur du `Link` de React Router autre que ce composant.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LienVue from '../LienVue';
import { sourcesLivrees } from './aide-sources-livrees';

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

/**
 * L'import du `Link` de React Router — la forme qu'un seul fichier a le droit
 * d'écrire, parce que c'est le fichier qui l'enveloppe.
 */
const IMPORT_LINK_BRUT = /import\s*\{[^}]*\bLink\b[^}]*\}\s*from\s*['"]react-router-dom['"]/;

/** Le fichier qui DÉLÈGUE à LienVue (le lien interne du site). */
const PASSE_PAR_LIENVUE = /from\s+['"][^'"]*LienVue['"]/;

/** Les relatif des sources qui importent encore le `Link` brut. */
const importateursBruts = (sources) =>
  sources.filter(({ contenu }) => IMPORT_LINK_BRUT.test(contenu)).map(({ relatif }) => relatif);

describe('le lien interne a UN propriétaire', () => {
  const sources = sourcesLivrees();

  it('la règle sait mordre, et elle ne confond pas un import avec un commentaire', () => {
    const synthetiques = [
      { relatif: 'pages/Faux.js', contenu: "import { Link } from 'react-router-dom';" },
      { relatif: 'pages/Melange.js', contenu: "import { Link, useNavigate } from 'react-router-dom';" },
      { relatif: 'pages/Prose.js', contenu: "// Le Link de react-router-dom ne sert plus ici." },
      { relatif: 'pages/Navigation.js', contenu: "import { useNavigate } from 'react-router-dom';" },
    ];
    expect(importateursBruts(synthetiques)).toEqual(['pages/Faux.js', 'pages/Melange.js']);
    expect(PASSE_PAR_LIENVUE.test("import Link from '../components/LienVue';")).toBe(true);
  });

  it('aucun fichier livré n’importe le Link brut, sauf LienVue lui-même', () => {
    // Le contrôle a-t-il lu son sujet ?
    expect(sources.length).toBeGreaterThan(100);
    expect(importateursBruts(sources)).toEqual(['components/LienVue.js']);
  });

  it('et le site passe bien par lui — le plancher dit que le balayage a lu', () => {
    const delegants = sources.filter(({ contenu }) => PASSE_PAR_LIENVUE.test(contenu));
    // 19 relevés le 07/10/2026 (les quinze pages, le chrome et JobsResults) :
    // en trouver moins veut dire que le balayage n'a pas lu son sujet.
    expect(delegants.length).toBeGreaterThanOrEqual(18);
  });
});
