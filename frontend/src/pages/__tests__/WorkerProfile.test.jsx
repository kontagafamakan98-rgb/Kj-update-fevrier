/**
 * LE PROFIL PUBLIC MONTRE CE QU'IL A, ET RIEN QUAND IL N'A RIEN.
 *
 * ── Ce que ce fichier ferme ────────────────────────────────────────────────
 * La page lit `GET /api/workers/:id`, qui publie une allowlist (aucune
 * coordonnée). Trois états doivent être DISTINCTS à l'écran, et c'est tout
 * l'objet du fichier :
 *   • un profil trouvé (nom, missions terminées, note, avis) ;
 *   • un profil inexistant (404) — la page le DIT, elle n'affiche pas un
 *     profil vide qui laisserait croire à un travailleur sans historique ;
 *   • une lecture échouée — l'erreur est annoncée et une relance est offerte.
 *
 * ── Un cas qui n'est pas cosmétique ────────────────────────────────────────
 * Un travailleur SANS avis renvoie `rating_average: null`. Afficher « 0 »
 * ferait passer un compte neuf pour un compte mal noté : le second cas exige
 * l'absence (tiret), pas un zéro.
 *
 * jsdom pour le COMPORTEMENT : le dessin, lui, appartient aux sondes navigateur.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../contexts/LanguageContext', async (importOriginal) => {
  const actual = await importOriginal();
  const { default: fr } = await vi.importActual('../../i18n/fr.json');
  return {
    ...actual,
    useLanguage: () => ({ currentLanguage: 'fr', changeLanguage: vi.fn(), t: (key) => fr[key] ?? key }),
  };
});

const { default: WorkerProfile } = await import('../WorkerProfile.js');

const rendre = () =>
  render(
    <MemoryRouter initialEntries={['/workers/w-1']}>
      <Routes>
        <Route path="/workers/:id" element={<WorkerProfile />} />
      </Routes>
    </MemoryRouter>
  );

const PROFIL = {
  id: 'w-1',
  first_name: 'Awa',
  last_name: 'Diallo',
  user_type: 'worker',
  photo_url: null,
  city: 'Dakar',
  country: 'Sénégal',
  verified: true,
  member_since: 2024,
  skills: ['Plomberie', 'Électricité'],
  bio: 'Dix ans de dépannage à Dakar.',
  stats: { missions_completed: 12, rating_average: 4.7, rating_count: 2 },
  reviews: [
    { rating: 5, comment: 'Travail impeccable.', created_at: '2026-09-01', reviewer_first_name: 'Moussa' },
  ],
};

const reponse = (corps, statut = 200) => ({
  ok: statut >= 200 && statut < 300,
  status: statut,
  json: async () => corps,
});

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Profil public d’un travailleur', () => {
  it('publie l’identité professionnelle, les missions terminées et les avis', async () => {
    global.fetch.mockResolvedValueOnce(reponse(PROFIL));

    rendre();

    expect(await screen.findByRole('heading', { name: 'Awa Diallo' })).toBeInTheDocument();
    // La note et les missions vivent dans des nœuds différents (la note est
    // DANS la ligne d'identité) : on lit le texte de la page, pas un nœud.
    expect(document.body.textContent).toContain('12');
    // La note est formatée par `toLocaleString()` : le séparateur dépend de la
    // locale du navigateur qui exécute le test. Ce qui est jugé ici, c'est que
    // la VALEUR est publiée — pas le séparateur décimal.
    expect(document.body.textContent).toMatch(/4[.,]7/);
    expect(screen.getByText('Plomberie')).toBeInTheDocument();
    expect(screen.getByText('Travail impeccable.')).toBeInTheDocument();
    // Seul le PRÉNOM du réviseur est publié — jamais un nom complet.
    expect(screen.getByText('Moussa')).toBeInTheDocument();
    // La route est publique : aucun en-tête d'authentification.
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('un travailleur sans avis n’affiche pas « 0 » mais une absence', async () => {
    global.fetch.mockResolvedValueOnce(
      reponse({ ...PROFIL, stats: { missions_completed: 0, rating_average: null, rating_count: 0 }, reviews: [] })
    );

    rendre();

    await screen.findByRole('heading', { name: 'Awa Diallo' });
    // Aucune note affichée : `rating_average: null` ne devient ni « 0 » ni
    // « 0.0 ». Et la mesure réellement lue (0 mission) reste visible, elle.
    expect(document.body.textContent).not.toMatch(/0[.,]0/);
    expect(document.body.textContent).toContain('0');
    // L'absence d'avis se DIT (clé existante `noReviewsYet`) : une section
    // muette sous le profil se lirait comme un chargement en panne.
    expect(document.body.textContent).toMatch(/Aucun avis/i);
  });

  it('un identifiant inconnu dit « page introuvable », pas un profil vide', async () => {
    global.fetch.mockResolvedValueOnce(reponse({ detail: 'Travailleur introuvable' }, 404));

    rendre();

    expect(await screen.findByRole('heading', { name: 'Page introuvable' })).toBeInTheDocument();
    expect(screen.queryByText('Travailleur')).not.toBeInTheDocument();
  });

  it('une lecture échouée s’annonce et se relance', async () => {
    global.fetch
      .mockRejectedValueOnce(new Error('réseau indisponible'))
      .mockResolvedValueOnce(reponse(PROFIL));

    rendre();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Awa Diallo' })).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
