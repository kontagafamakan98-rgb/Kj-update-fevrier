/**
 * États de la liste des missions.
 *
 * Une panne de chargement et une liste vide ne sont pas la même chose, et
 * chacune a sa prochaine étape : la panne dit quoi vérifier et propose de
 * REJOUER la requête (sans recharger l'onglet), la liste vide dit quoi faire
 * pour l'enrichir — élargir la recherche, ou lever le filtre qui la vide.
 * Ces cas sont verrouillés ici parce qu'une panne affichée comme « aucune
 * mission » fait croire qu'il n'y a rien à trouver, et qu'un état vide sans
 * action laisse l'utilisateur sans issue.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Paramètres d'URL mutables d'un cas à l'autre (hoistés : les fabriques de
// vi.mock s'exécutent avant le corps du module).
const { SEARCH_PARAMS } = vi.hoisted(() => ({ SEARCH_PARAMS: { current: new URLSearchParams() } }));

vi.mock('react-router-dom', () => ({
  Link: ({ children }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
  useSearchParams: () => [SEARCH_PARAMS.current],
}));

// Le vrai dictionnaire français, comme le fournisseur réel : les copies
// d'échec et d'état vide sont des clés i18n, pas des littéraux de page.
vi.mock('../../contexts/LanguageContext', async () => {
  const { default: fr } = await vi.importActual('../../i18n/fr.json');
  return { useLanguage: () => ({ currentLanguage: 'fr', t: (key) => fr[key] || key }) };
});

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../contexts/CountryContext', () => ({
  useCountry: () => ({ currentCountry: 'mali', changeUserCountry: vi.fn(), isOwner: false }),
}));
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

// Le préchargement parallèle est un optim : neutralisé pour que chaque cas
// exerce le chemin de requête direct, dans un ordre déterministe.
vi.mock('../../utils/publicJobsPrefetch', () => ({
  makePublicJobsPrefetch: () => ({ kick: vi.fn(), consume: vi.fn().mockResolvedValue(null) }),
}));

// Leaflet n'a pas sa place dans jsdom, et la carte n'est pas l'objet du test.
vi.mock('../../components/JobsMap', () => ({ default: () => <div data-testid="carte" /> }));

vi.mock('../../services/apiEndpoints', () => ({
  jobsAPI: { getAll: vi.fn(), getMyProposals: vi.fn().mockResolvedValue([]) },
}));

// Import après les vi.mock (hoistés par Vitest).
import Jobs from '../Jobs';
import { jobsAPI } from '../../services/apiEndpoints';

const JOB_A = { id: 'job-1', title: 'Réparation de plomberie', status: 'open', category: 'plumbing' };
const JOB_B = { id: 'job-2', title: 'Peinture du salon', status: 'open', category: 'painting' };

// Formes EXACTES produites par la frontière de l'API (services/api.js) : une
// panne sans message du serveur arrive marquée `hasServerMessage = false` et
// porte le message du produit. La page, elle, doit afficher SES mots.
const panneReseau = () => Object.assign(
  new Error('Erreur de connexion. Vérifiez votre connexion internet.'),
  { hasServerMessage: false }
);
const panneServeur = () => Object.assign(
  new Error("Une erreur inattendue s'est produite. Veuillez rafraîchir la page."),
  { hasServerMessage: false, response: { status: 502, data: {} } }
);

const RESEAU = 'Pas de connexion. Vérifiez votre réseau, puis réessayez.';
const SERVEUR = "Le serveur n'a pas répondu. Réessayez dans un instant.";
const VIDE = 'Aucun job disponible pour le moment.';
const VIDE_FILTRE = 'Aucune mission ne correspond à ces filtres.';

beforeEach(() => {
  SEARCH_PARAMS.current = new URLSearchParams();
  vi.clearAllMocks();
  jobsAPI.getMyProposals.mockResolvedValue([]);
});

describe('Jobs — une panne se répare, une liste vide se dit', () => {
  it('une coupure réseau affiche ses propres mots (pas le texte du navigateur) et propose de réessayer', async () => {
    jobsAPI.getAll.mockRejectedValue(panneReseau());
    render(<Jobs />);

    expect(await screen.findByText(RESEAU)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
    // Ni la copie générique de la frontière, ni le texte du navigateur : c'est
    // la page qui parle, et la panne ne se déguise pas en liste vide.
    expect(screen.queryByText('Erreur de connexion. Vérifiez votre connexion internet.')).toBeNull();
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
    expect(screen.queryByText(VIDE)).toBeNull();
  });

  it('un serveur qui répond sans message utilisable dit de réessayer dans un instant', async () => {
    jobsAPI.getAll.mockRejectedValue(panneServeur());
    render(<Jobs />);

    expect(await screen.findByText(SERVEUR)).toBeTruthy();
    expect(screen.queryByText(RESEAU)).toBeNull();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('« Réessayer » rejoue la requête et affiche les missions', async () => {
    jobsAPI.getAll
      .mockRejectedValueOnce(panneReseau())
      .mockResolvedValue([JOB_A, JOB_B]);
    render(<Jobs />);

    fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByText('Réparation de plomberie')).toBeTruthy();
    expect(screen.getByText('Peinture du salon')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(RESEAU)).toBeNull());
    expect(jobsAPI.getAll).toHaveBeenCalledTimes(2);
  });

  it('une liste vide sans filtre invite à élargir, et ne propose pas de réessai', async () => {
    jobsAPI.getAll.mockResolvedValue([]);
    render(<Jobs />);

    expect(await screen.findByText(VIDE)).toBeTruthy();
    expect(screen.getByText('Élargissez votre recherche ou revenez plus tard.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  });

  it('une liste vidée par un filtre propose de l’effacer, et la relance le charge', async () => {
    SEARCH_PARAMS.current = new URLSearchParams('category=plumbing');
    jobsAPI.getAll.mockResolvedValue([]);
    render(<Jobs />);

    expect(await screen.findByText(VIDE_FILTRE)).toBeTruthy();
    jobsAPI.getAll.mockResolvedValue([JOB_A]);
    fireEvent.click(screen.getByRole('button', { name: 'Effacer les filtres' }));

    expect(await screen.findByText('Réparation de plomberie')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(VIDE_FILTRE)).toBeNull());
  });
});
