/**
 * /commission-dashboard JUGE LE PROFIL VIVANT, PAS UN STOCKAGE DISPARU.
 *
 * ── Le défaut que ce fichier ferme ──────────────────────────────────────────
 * Mesuré en production le 24/10/2026 : connecté au compte propriétaire,
 * `/auth/me` répondant `is_owner: true` et `user_type: 'owner'`, la page
 * affichait « Accès réservé à Famakan Kontaga Master — Niveau d'accès :
 * Utilisateur standard ». Cause : la page jugeait
 * `OwnerService.isFamakanLoggedIn()` SANS argument, donc le profil relu dans
 * `localStorage['user']` — une clé que le web n'écrit plus depuis le
 * 20/10/2026 (le profil ne vit qu'en mémoire, cf.
 * `AuthContext.purgerProfilWebPersistant`). La lecture rendait `null` pour
 * tout le monde, propriétaire compris.
 *
 * ── Ce que les cas prouvent ─────────────────────────────────────────────────
 * Le premier : profil propriétaire fourni par la session, AUCUN profil en
 * stockage (l'état web réel) → le tableau de bord s'ouvre. Les deux suivants
 * ferment la porte dans l'autre sens : un client reste refusé, et un profil
 * propriétaire sans trace de session aussi — la correction n'ouvre pas la page
 * à qui la demande.
 *
 * Les enfants (journal, litiges, paliers) sont simulés : ce fichier juge la
 * PORTE, pas ce qu'il y a derrière. Le réseau des stats est simulé aussi, sans
 * quoi le cas ne mesurerait qu'une panne.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Le dictionnaire FRANÇAIS RÉEL, comme le fournisseur.
vi.mock('../../contexts/LanguageContext', async (importOriginal) => {
  const actual = await importOriginal();
  const { default: fr } = await vi.importActual('../../i18n/fr.json');
  return {
    ...actual,
    useLanguage: () => ({ currentLanguage: 'fr', changeLanguage: vi.fn(), t: (key) => fr[key] ?? key }),
  };
});

// La SESSION est mutable : le même écran doit refuser un client et accepter le
// propriétaire.
const etat = vi.hoisted(() => ({ session: null }));

vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({ user: etat.session, loading: false }),
  };
});

// Le seul appel réseau que la porte déclenche une fois ouverte.
const apiMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { ...actual.api, get: apiMock.get } };
});

vi.mock('../../services/commissionService', () => ({
  default: {
    loadOwnerAccounts: vi.fn(),
    getCommissionStats: vi.fn(() => ({ total_commission_earned: 0 })),
    getStoredTransactions: vi.fn(() => []),
    getOwnerAccounts: vi.fn(() => ({})),
    updateOwnerAccounts: vi.fn(),
  },
}));

vi.mock('../../components/OwnerMissionEvents', () => ({ default: () => <div data-testid="journal" /> }));
vi.mock('../../components/OwnerDisputes', () => ({ default: () => <div data-testid="litiges" /> }));
vi.mock('../../components/OwnerCommissionTiers', () => ({ default: () => <div data-testid="paliers" /> }));

const { default: CommissionDashboard } = await import('../CommissionDashboard.js');
const { ToastProvider } = await import('../../contexts/ToastContext.js');

const PROPRIETAIRE = {
  id: 'owner-1',
  email: 'kontagafamakan98@gmail.com',
  user_type: 'owner',
  is_owner: true,
  first_name: 'Famakan',
  last_name: 'Master',
};

const CLIENT = {
  id: 'client-1',
  email: 'client@example.com',
  user_type: 'client',
  is_owner: false,
  first_name: 'Awa',
  last_name: 'Diarra',
};

const TITRE_TABLEAU = 'Tableau de bord - commissions propriétaire';
const TITRE_REFUS = 'Accès réservé à Famakan Kontaga Master';

const rendre = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <CommissionDashboard />
      </ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  // Session ouverte sur le WEB : la seule trace est le marqueur sans PII.
  localStorage.setItem('kojo_session_trace', '1');
  apiMock.get.mockReset();
  apiMock.get.mockResolvedValue({ stats: {} });
  etat.session = PROPRIETAIRE;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('/commission-dashboard — la porte lit le profil de session', () => {
  it('ouvre le tableau de bord au propriétaire alors qu’aucun profil n’est stocké', async () => {
    // L'état web RÉEL : la session vit, le profil n'est nulle part au repos.
    expect(localStorage.getItem('user')).toBeNull();

    rendre();

    await waitFor(() => expect(screen.getByText(TITRE_TABLEAU)).toBeTruthy());
    expect(screen.queryByText(TITRE_REFUS)).toBeNull();
  });

  it('refuse un client, même connecté', async () => {
    etat.session = CLIENT;

    rendre();

    await waitFor(() => expect(screen.getByText(TITRE_REFUS)).toBeTruthy());
    expect(screen.queryByText(TITRE_TABLEAU)).toBeNull();
  });

  it('refuse un profil propriétaire sans aucune trace de session', async () => {
    // Sans marqueur de session, le profil présenté ne prouve rien : la page
    // ne s'ouvre pas sur un objet qu'on lui a tendu.
    localStorage.clear();

    rendre();

    await waitFor(() => expect(screen.getByText(TITRE_REFUS)).toBeTruthy());
    expect(screen.queryByText(TITRE_TABLEAU)).toBeNull();
  });
});
