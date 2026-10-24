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

// Les GAINS du propriétaire viennent de SA route : elle est simulée ici, sinon
// la page appellerait le vrai client et le cas ne jugerait qu'une panne.
const ownerApi = vi.hoisted(() => ({
  getCommissionStats: vi.fn(),
  isOwnerSessionValid: vi.fn(() => false),
}));
vi.mock('../../services/ownerService', () => ({ default: ownerApi }));

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

/**
 * LE PROPRIÉTAIRE N'EST NI UN CLIENT NI UN TRAVAILLEUR (23/10/2026).
 *
 * Mesuré en production : son tableau de bord tombait dans la branche
 * travailleur (il comptait les offres du marché), il lui proposait de publier
 * une mission et de remplir un profil de travailleur, et l'application le
 * jugeait « client inachevé » (mur de paiement). Son écran doit dire ce qu'il a
 * GAGNÉ, et rien de plus.
 */
describe('Tableau de bord — les GAINS du propriétaire, sans parcours client', () => {
  afterEach(() => {
    etat.session = { id: 'client-1', user_type: 'client', first_name: 'Awa', is_verified: true };
  });

  it('affiche les gains encaissés, du mois et du jour, et aucune tuile de missions', async () => {
    etat.session = {
      id: 'owner-1',
      user_type: 'owner',
      is_owner: true,
      first_name: 'Famakan',
      is_verified: true,
      email_verified: false,
    };
    jobsAPI.getAll.mockResolvedValueOnce([]);
    ownerApi.getCommissionStats.mockResolvedValueOnce({
      stats: { total_commission_earned: 12500, monthly_commission: 5000, daily_commission: 0 },
    });

    rendre();

    expect(await screen.findByText('12 500 FCFA')).toBeInTheDocument();
    expect(screen.getByText('5 000 FCFA')).toBeInTheDocument();
    expect(screen.getByText('0 FCFA')).toBeInTheDocument();
    expect(screen.getByText('Gains encaissés')).toBeInTheDocument();

    // Aucune mesure de client ni de travailleur sur cet écran.
    expect(screen.queryByText('Emplois disponibles')).not.toBeInTheDocument();
    expect(screen.queryByText('Jobs actifs')).not.toBeInTheDocument();
    // Et aucun rappel de compte de paiement : l'argent part sur PayDunya.
    expect(screen.queryByText(/compte de paiement/i)).not.toBeInTheDocument();
    // Ses actions : ses gains et le support, pas « publier une mission ».
    // Deux liens portent ce libellé : l'action principale du bandeau et la
    // tuile des actions rapides — les deux mènent à ses gains.
    const liensGains = screen.getAllByRole('link', { name: /Commission Dashboard/i });
    expect(liensGains.length).toBeGreaterThan(0);
    expect(liensGains.every((lien) => lien.getAttribute('href') === '/commission-dashboard')).toBe(true);
    expect(screen.queryByRole('link', { name: /Publier/ })).not.toBeInTheDocument();

    // ── MESURÉ EN PRODUCTION LE 24/10/2026 ───────────────────────────────
    // Le corps de la page était bien passé à la branche propriétaire, mais le
    // BANDEAU, lui, gardait ses deux branches : l'étiquette annonçait
    // « TRAVAILLEUR », la phrase de tête « découvrez de nouvelles
    // opportunités de travail », et le bouton principal « Chercher Emplois »
    // (→ /jobs). L'écran se contredisait d'une ligne à l'autre.
    expect(screen.getByText('Propriétaire')).toBeInTheDocument();
    expect(screen.queryByText('Travailleur')).not.toBeInTheDocument();
    expect(
      screen.getByText('Ce que la plateforme a encaissé')
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/opportunités de travail/i)
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Chercher Emplois/i })).not.toBeInTheDocument();
    // Et aucune étiquette de moyens de paiement : il n'en a pas besoin.
    expect(screen.queryByText('Moyens de paiement renseignés')).not.toBeInTheDocument();
  });

  it('une lecture des gains en panne écrit « — », jamais « 0 FCFA »', async () => {
    etat.session = { id: 'owner-1', user_type: 'owner', is_owner: true, first_name: 'Famakan', is_verified: true };
    jobsAPI.getAll.mockResolvedValueOnce([]);
    ownerApi.getCommissionStats.mockRejectedValueOnce(new Error('403'));

    rendre();

    await waitFor(() => expect(ownerApi.getCommissionStats).toHaveBeenCalled());
    const tuiles = [...document.querySelectorAll('.tuile-mesure-chiffre')].map((n) => n.textContent);
    expect(tuiles).toEqual(['—', '—', '—']);
    expect(tuiles.join(' ')).not.toContain('FCFA');
  });
});

/**
 * L'ÉQUIPE SUPPORT N'EST NI CLIENTE NI TRAVAILLEUSE (24/10/2026).
 *
 * Le propriétaire peut ajouter des personnes au service clientèle ; sans
 * branche propre, elles tombaient sur le tableau de bord d'un client ou d'un
 * travailleur — marché à parcourir, profil à remplir, mission à publier — alors
 * que leur seul travail est la file des demandes. Ce qui est mesuré : aucune
 * mesure de missions, aucune catégorie, et une action principale qui mène aux
 * demandes.
 */
describe('Tableau de bord — l’équipe support ne voit que le service clientèle', () => {
  afterEach(() => {
    etat.session = { id: 'client-1', user_type: 'client', first_name: 'Awa', is_verified: true };
  });

  it('n’affiche ni tuile de missions ni marché, et mène aux demandes', async () => {
    etat.session = { id: 'agent-1', user_type: 'client', first_name: 'Awa', is_verified: true, support_role: 'agent' };
    jobsAPI.getAll.mockResolvedValueOnce([MISSION]);

    rendre();

    expect(await screen.findByText('Équipe support')).toBeInTheDocument();
    // Le bandeau dit le périmètre, et ne promet aucun parcours de travail.
    expect(screen.getByText(/Votre accès se limite au service clientèle/)).toBeInTheDocument();
    expect(screen.queryByText(/opportunités de travail/i)).not.toBeInTheDocument();

    // Aucune mesure : les compteurs de cette page sont ceux des missions.
    expect(document.querySelectorAll('.tuile-mesure')).toHaveLength(0);

    // Ni catégories du marché, ni liste de missions.
    expect(screen.queryByText('Catégories populaires')).not.toBeInTheDocument();
    expect(screen.queryByText('Réparer une pompe')).not.toBeInTheDocument();

    // L'action principale mène à la file des demandes.
    const liens = screen.getAllByRole('link', { name: /Demandes de support/i });
    expect(liens.length).toBeGreaterThan(0);
    expect(liens.every((lien) => lien.getAttribute('href') === '/support-admin')).toBe(true);
    expect(screen.queryByRole('link', { name: /Publier/ })).not.toBeInTheDocument();
  });
});
