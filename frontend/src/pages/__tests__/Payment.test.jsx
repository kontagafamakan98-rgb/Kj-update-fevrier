/**
 * Cohérence de la répartition affichée au checkout.
 *
 * Scénario couvert : le taux de commission est modifié en base (backend)
 * ENTRE le chargement initial de la page et le clic sur « Payer ». Le quote
 * affiché (14%) est alors périmé : le checkout appliquerait le nouveau taux
 * (20%). La page doit donc re-fetch le quote au clic, mettre à jour la
 * répartition affichée et demander une confirmation avant de rediriger —
 * jamais rediriger avec une répartition incohérente.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- Mocks : isole Payment des providers, du router et du réseau ----

vi.mock('react-router-dom', () => ({
  Link: ({ children }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ currentLanguage: 'fr' }),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', first_name: 'Jean', last_name: 'Dupont', email: 'a@b.c', phone: '+221771234567' },
  }),
}));

vi.mock('../../services/commissionService', () => ({
  default: {
    getProviderConfig: vi.fn().mockResolvedValue({ provider: 'paydunya', configured: true, mode: 'test', commission_rate_percent: 14 }),
    getQuote: vi.fn(),
    createCheckout: vi.fn(),
    getMyPayments: vi.fn().mockResolvedValue([]),
  },
}));

// Import après les vi.mock (hoistés par Vitest).
import Payment from '../Payment';
import CommissionService from '../../services/commissionService';

// Intercepte l'assignation window.location.href (redirection checkout) sans
// déclencher la navigation jsdom, tout en préservant les autres propriétés.
const installLocationStub = () => {
  const hrefSetter = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, set href(v) { hrefSetter(v); } },
    writable: true,
    configurable: true,
  });
  return hrefSetter;
};

// Quote backend à 14% : 1000 FCFA → commission 140, travailleur 860.
const quoteAt14 = {
  provider: 'paydunya', configured: true, total_amount: 1000,
  commission_amount: 140, worker_amount: 860, commission_rate: 14,
};

// Quote backend à 20% (taux modifié en base) : 1000 → commission 200, travailleur 800.
const quoteAt20 = {
  provider: 'paydunya', configured: true, total_amount: 1000,
  commission_amount: 200, worker_amount: 800, commission_rate: 20,
};

describe('Payment — cohérence de la répartition quand le taux change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CommissionService.getQuote.mockImplementation(() => Promise.resolve(quoteAt14));
    CommissionService.createCheckout.mockResolvedValue({ checkout_url: 'https://paydunya.test/checkout', payment_id: 'p1' });
  });

  it('affiche la répartition du quote backend et la met à jour + confirmation si le taux change au paiement', async () => {
    const hrefSetter = installLocationStub();
    render(<Payment />);

    // Saisie du montant → le quote (14%) est fetché et affiché.
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '1000' } });
    // Répartition du quote backend affichée (140 XOF de commission).
    expect(await screen.findByText('140 XOF')).toBeInTheDocument();
    expect(screen.getByText('860 XOF')).toBeInTheDocument();
    // Total (séparateur de milliers selon la locale : 1000 / 1 000 / 1,000).
    expect(screen.getByText(/1[.,\s]?000 XOF/)).toBeInTheDocument();

    // Le taux change EN BASE entre le chargement et le paiement (20%).
    CommissionService.getQuote.mockImplementation(() => Promise.resolve(quoteAt20));

    // 1er clic : le quote à jour diffère de l'affiché → confirmation requise,
    // PAS de checkout, PAS de redirection.
    fireEvent.click(screen.getByRole('button', { name: 'Payer maintenant' }));
    expect(await screen.findByText(/taux de commission a changé/i)).toBeInTheDocument();
    // La répartition affichée a été mise à jour (200 XOF).
    expect(screen.getByText('200 XOF')).toBeInTheDocument();
    expect(CommissionService.createCheckout).not.toHaveBeenCalled();
    expect(hrefSetter).not.toHaveBeenCalled();

    // 2ème clic : la répartition affichée est à jour → checkout + redirection.
    fireEvent.click(screen.getByRole('button', { name: 'Payer maintenant' }));
    await waitFor(() => expect(CommissionService.createCheckout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('https://paydunya.test/checkout'));
  });

  it('lance le checkout directement si le taux n’a pas changé', async () => {
    const hrefSetter = installLocationStub();
    render(<Payment />);

    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '1000' } });
    expect(await screen.findByText('140 XOF')).toBeInTheDocument();

    // Aucun changement de taux : le quote re-fetché est identique.
    fireEvent.click(screen.getByRole('button', { name: 'Payer maintenant' }));
    await waitFor(() => expect(CommissionService.createCheckout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('https://paydunya.test/checkout'));
    // Pas de message de confirmation.
    expect(screen.queryByText(/taux de commission a changé/i)).not.toBeInTheDocument();
  });
});
