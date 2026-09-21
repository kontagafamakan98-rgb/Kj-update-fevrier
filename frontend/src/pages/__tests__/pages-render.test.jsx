/**
 * CHAQUE page du site se REND sans lever.
 *
 * ── La classe de défaut que ce fichier ferme ────────────────────────────────
 * Le 20/09/2026, l'accueil de production a servi une page VIDE : trois valeurs
 * (`statX`) étaient lues avant la déclaration de la table qui les portait
 * (`ReferenceError` de zone morte temporelle), attrapé par l'ErrorBoundary. Ni
 * le build, ni les cinq gardes de pré-rendu, ni 638 tests verts ne l'ont vu :
 * aucun d'eux ne RENDAIT la page. Les tests protégeaient les gardes, presque
 * jamais les pages — 4 fichiers de test pour 22 pages.
 *
 * ── Pourquoi une liste DÉRIVÉE, et pas une liste de pages ───────────────────
 * Le tour de couverture vient de `import.meta.glob` : la liste des pages est
 * celle du répertoire, donc une page AJOUTÉE est couverte au premier `npm
 * test`, sans que personne ait à penser à ce fichier. Une liste recopiée ici
 * aurait reproduit le défaut qu'elle surveille (une page de plus, un test de
 * moins, personne pour le dire).
 *
 * ── Ce que ce test est, et n'est pas ───────────────────────────────────────
 * C'est un test de FUMÉE : il exige que chaque page se rende (aucune exception
 * au montage, un contenu non vide). Il ne remplace pas les tests de
 * comportement (Jobs.test.jsx, Payment.test.jsx…) : il garantit seulement ce
 * qu'aucun garde ne garantissait — qu'une page existe à l'écran.
 *
 * Les appels réseau sont neutralisés (le `fetch` global du setup rejette) :
 * c'est l'état qu'un utilisateur voit quand l'API est injoignable, et une page
 * doit continuer de s'y rendre.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Les contextes réels sont conservés ; seuls les HOOKS sont figés (les pages
// n'ont pas besoin d'une session ni d'un pays réel pour se rendre, et le
// fournisseur réel ferait des appels réseau au montage).
vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAuth: () => ({ user: null, loading: false, logout: vi.fn() }) };
});
vi.mock('../../contexts/LanguageContext', async (importOriginal) => {
  const actual = await importOriginal();
  // Le vrai dictionnaire français, comme le fournisseur réel : une clé
  // manquante se voit dans le rendu, pas dans une copie de test.
  const { default: fr } = await vi.importActual('../../i18n/fr.json');
  return {
    ...actual,
    useLanguage: () => ({ currentLanguage: 'fr', changeLanguage: vi.fn(), t: (key) => fr[key] ?? key }),
  };
});
vi.mock('../../contexts/ToastContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  };
});
vi.mock('../../contexts/CountryContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useCountry: () => ({
      currentCountry: 'mali',
      changeUserCountry: vi.fn(),
      isOwner: false,
      countryData: actual.DEFAULT_COUNTRY || {},
    }),
  };
});

// Leaflet n'a pas sa place dans jsdom et la carte n'est pas l'objet du test.
vi.mock('../../components/JobsMap', () => ({ default: () => <div data-testid="carte" /> }));

// La détection de pays est une dépendance d'ENVIRONNEMENT (base géographique,
// IP, GPS). Plusieurs pages l'appellent au montage et font un `setState` dans
// leur `finally` : laissée réelle, sa promesse se résout APRÈS la fin du test,
// et react-dom met alors à jour un `window` déjà démonté —
// `ReferenceError: window is not defined`, vu en CI le 21/09/2026, jamais en
// local : ce rouge ne dépendait que de la charge du runner. Le service est donc
// figé sur son RÉSULTAT D'ÉCHEC (`detected: false`, la convention que le service
// documente lui-même et que ses appelants traitent), pendant que le rendu des
// pages, lui, reste réel. La logique de détection garde son propre test :
// src/services/__tests__/geolocationService.test.js.
vi.mock('../../services/geolocationService', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, detectUserCountry: vi.fn(async () => ({ detected: false })) };
});

// Toutes les pages du répertoire, chargées par leur chemin : une page ajoutée
// entre dans le tour sans qu'on touche à ce fichier.
const PAGES = import.meta.glob('../*.js');

/**
 * URL à laquelle rendre chaque page. Seule la fiche mission LIT son identifiant
 * dans l'URL : rendue sur une route statique, elle testerait son état « sans
 * identifiant » au lieu de la page. Les autres se rendent sous un motif
 * attrape-tout (leurs `useParams` n'ont rien à lire).
 */
const JOB_ID = 'aaaa1111-bbbb-4222-8333-cccc44445555';
const URL_PAR_PAGE = {
  JobDetails: { motif: '/jobs/:id', entree: `/jobs/${JOB_ID}` },
};
const URL_PAR_DEFAUT = { motif: '*', entree: '/page' };

const rendre = (Page, { motif, entree }) =>
  render(
    <MemoryRouter initialEntries={[entree]}>
      <Routes>
        <Route path={motif} element={<Page />} />
      </Routes>
    </MemoryRouter>
  );

// Le nom de la page depuis son chemin de fichier ('../Home.js' → 'Home').
const nomDe = (chemin) => chemin.replace(/^.*\//, '').replace(/\.js$/, '');

const pages = Object.keys(PAGES).sort();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('rendu de fumée — chaque page', () => {
  it('le répertoire des pages n’est pas vide (sinon ce fichier ne prouverait rien)', () => {
    expect(pages.length).toBeGreaterThanOrEqual(20);
  });

  it.each(pages)('%s se rend sans lever et sans contenu vide', async (chemin) => {
    const { default: Page } = await PAGES[chemin]();
    const { container, unmount } = rendre(Page, URL_PAR_PAGE[nomDe(chemin)] || URL_PAR_DEFAUT);

    // Aucune exception (le rendu aurait levé) ET quelque chose à l'écran : une
    // page qui monte vide est le symptôme exact de l'incident de l'accueil.
    expect(container.innerHTML.length).toBeGreaterThan(0);

    // Toute mise à jour d'état lancée par le montage (détection de pays,
    // chargements) doit atterrir MAINTENANT, pendant que jsdom est vivant :
    // une promesse qui se résout après le démontage fait planter react-dom sur
    // un `window` disparu (`ReferenceError: window is not defined`) — un rouge
    // qui ne dépendait que de la charge du runner, vu en CI le 21/09/2026.
    await act(async () => {});
    unmount();
  });
});
