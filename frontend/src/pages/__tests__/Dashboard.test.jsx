/**
 * /dashboard NE PRÉTEND PAS SAVOIR QUAND ELLE N'A PAS PU LIRE.
 *
 * ── Le défaut que ce fichier ferme ──────────────────────────────────────────
 * `loadDashboardData` n'écrivait qu'un log en cas d'échec : la page gardait ses
 * compteurs à leur valeur initiale et affichait `0 / 0 / 0`. Une coupure réseau
 * se lisait donc « vous n'avez aucune mission », c'est-à-dire un fait que la
 * page n'avait pas mesuré. Le premier cas exige l'inverse : l'erreur est
 * ANNONCÉE, la relance est offerte, et les mesures disent « je ne sais pas »
 * (tiret) au lieu de zéro.
 *
 * ── Pourquoi deux cas, et pas un ───────────────────────────────────────────
 * Fermer le mensonge sans offrir d'issue laisserait l'utilisateur devant un
 * écran mort. Le second cas prouve la sortie de secours : après un clic sur
 * « Réessayer », la lecture réussit et les VRAIES valeurs remplacent les
 * tirets. Aucun des deux ne vérifie un dessin : c'est du comportement, donc
 * jsdom (la géométrie de cette page a ses propres sondes navigateur).
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Le dictionnaire FRANÇAIS RÉEL, comme le fournisseur : une clé absente du
// dictionnaire se voit dans l'assertion, pas dans une copie de test.
vi.mock('../../contexts/LanguageContext', async (importOriginal) => {
  const actual = await importOriginal();
  const { default: fr } = await vi.importActual('../../i18n/fr.json');
  return {
    ...actual,
    useLanguage: () => ({ currentLanguage: 'fr', changeLanguage: vi.fn(), t: (key) => fr[key] ?? key }),
  };
});

// La SESSION est mutable : le rappel « ajoute un compte de paiement » dépend
// de ce que le compte porte, et figer un seul utilisateur ne le prouverait pas.
const etat = vi.hoisted(() => ({
  session: { id: 'client-1', user_type: 'client', first_name: 'Awa', is_verified: true },
}));

vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({ user: etat.session, loading: false }),
  };
});

// Le seul réseau de cette page : la liste des missions.
vi.mock('../../services/apiEndpoints', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, jobsAPI: { ...actual.jobsAPI, getAll: vi.fn() } };
});

const { default: Dashboard } = await import('../Dashboard.js');
const { jobsAPI } = await import('../../services/apiEndpoints');

const rendre = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Dashboard />
    </MemoryRouter>
  );

const MISSION = {
  id: 'job-1',
  title: 'Réparer une pompe',
  description: 'Fuite sous l’évier de la cuisine.',
  category: 'plumbing',
  status: 'open',
  budget_min: 100,
  budget_max: 200,
  client_id: 'client-1',
};

beforeEach(() => {
  jobsAPI.getAll.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Tableau de bord — la lecture échouée se dit', () => {  it('une panne affiche l’erreur, offre de réessayer, et n’affiche PAS des zéros', async () => {
    jobsAPI.getAll.mockRejectedValueOnce(new Error('réseau indisponible'));

    rendre();

    // Le bandeau est annoncé (role="alert") et nomme la cause : la connexion.
    const bandeau = await screen.findByRole('alert');
    expect(bandeau).toHaveTextContent("Erreur de connexion. Vérifiez votre connexion internet.");

    // La relance existe, et les mesures ne prétendent plus rien.
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    // Le mensonge précis qu'on ferme : plus aucun « 0 » de mesure.
    const tuiles = document.querySelectorAll('.tuile-mesure-chiffre');
    expect(tuiles.length).toBeGreaterThan(0);
    expect([...tuiles].map((n) => n.textContent)).not.toContain('0');

    // Et la liste vide ne dit pas « aucune mission » : sa carte disparaît.
    expect(screen.queryByText('Aucun emploi publié')).not.toBeInTheDocument();
  });

  it('« Réessayer » relit les données et affiche les vraies valeurs', async () => {
    jobsAPI.getAll
      .mockRejectedValueOnce(new Error('réseau indisponible'))
      .mockResolvedValueOnce([MISSION]);

    rendre();

    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    // Les compteurs du client sont ceux de SES missions (une, ouverte).
    await waitFor(() => {
      const valeurs = [...document.querySelectorAll('.tuile-mesure-chiffre')].map((n) => n.textContent);
      expect(valeurs).toEqual(['1', '0', '1']);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // La mission est bien dans la liste (titre réel, pas un exemple).
    expect(screen.getByText('Réparer une pompe')).toBeInTheDocument();
    expect(jobsAPI.getAll).toHaveBeenCalledTimes(2);
  });
});

describe('Tableau de bord — les comptes de paiement se RAPPELLENT, sans bloquer', () => {
  it('un compte sans moyen de paiement lit une occasion, avec le chemin pour l’ajouter', async () => {
    etat.session = { id: 'client-1', user_type: 'client', first_name: 'Awa', is_verified: false };
    jobsAPI.getAll.mockResolvedValueOnce([]);

    rendre();

    const rappel = await screen.findByText(/Tu n’as pas encore de compte de paiement/);
    // Ce n'est PAS une erreur : rien n'est annoncé comme une alerte.
    expect(rappel.closest('[role="alert"]')).toBeNull();

    const lien = screen.getByRole('link', { name: 'Ajouter un compte de paiement' });
    expect(lien.getAttribute('href')).toBe('/profile');
  });

  it('un compte déjà payé ne voit pas le rappel', async () => {
    etat.session = { id: 'client-1', user_type: 'client', first_name: 'Awa', is_verified: true };
    jobsAPI.getAll.mockResolvedValueOnce([]);

    rendre();

    await waitFor(() => expect(jobsAPI.getAll).toHaveBeenCalled());
    expect(screen.queryByText(/Tu n’as pas encore de compte de paiement/)).not.toBeInTheDocument();
  });
});
