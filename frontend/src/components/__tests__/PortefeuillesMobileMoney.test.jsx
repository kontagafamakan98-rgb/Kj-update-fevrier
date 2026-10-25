/**
 * /support-admin → onglet « Portefeuilles » — LE CONTRÔLE MANUEL DU TITULAIRE.
 *
 * Ce que ces cas prouvent
 * -----------------------
 * 1. La file rend les NOMS RÉELS : le titulaire déclaré ET le nom du compte,
 *    côte à côte — c'est la comparaison qui décide, pas une pastille seule.
 * 2. Une décision ne part JAMAIS sans motif : le bouton reste fermé sous dix
 *    caractères, puis envoie la décision et le motif saisis.
 * 3. Refuser est aussi une décision : le motif est exigé de la même façon.
 * 4. Une lecture en panne n'affiche PAS « aucun portefeuille » : les deux faits
 *    sont différents, et confondre les deux ferait croire que l'argent part.
 * 5. Le numéro n'est jamais rendu en entier par l'écran : la route le masque,
 *    l'écran ne le recompose pas.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

// Le dictionnaire FRANÇAIS RÉEL du scope, comme le fournisseur.
vi.mock('../../contexts/LanguageContext', async (importOriginal) => {
  const actual = await importOriginal();
  const { dict } = await vi.importActual('../../utils/pack2PageI18n/portefeuilles');
  return {
    ...actual,
    useLanguage: () => ({
      currentLanguage: 'fr',
      changeLanguage: vi.fn(),
      t: (key) => dict.fr[key] ?? key,
    }),
  };
});

const apiMock = vi.hoisted(() => ({
  listWallets: vi.fn(),
  decideWallet: vi.fn(),
}));

vi.mock('../../services/apiEndpoints', () => ({ supportAPI: apiMock }));

const { default: PortefeuillesPanel } = await import('../PortefeuillesMobileMoney.js');

const EN_ATTENTE = {
  compte_id: 'worker-1',
  nom: 'Kojo Test',
  email: 'worker@kojo.sn',
  user_type: 'worker',
  country: 'senegal',
  etat: 'en_attente',
  motif: 'nom_different',
  methode: null,
  nom_declare: 'Fatoumata Diop',
  nom_compte: 'Kojo Test',
  wallet_methode: 'orange_money',
  wallet_masque: '•••• 67',
  decide_le: null,
  decide_par: null,
  note: null,
  historique: [],
};

const VERIFIE = {
  ...EN_ATTENTE,
  compte_id: 'worker-2',
  nom: 'Awa Diallo',
  email: 'awa@kojo.sn',
  etat: 'verifie',
  motif: 'valide_par_le_proprietaire',
  methode: 'manuel',
  nom_declare: 'Awa Diallo',
  wallet_masque: '•••• 68',
  decide_le: '2026-10-25T09:00:00+00:00',
  decide_par: 'agent-1',
  note: 'Titulaire confirmé au téléphone',
};

const FILE = {
  total: 2,
  count: 2,
  offset: 0,
  limite: 50,
  tronque: false,
  portefeuilles: [EN_ATTENTE, VERIFIE],
};

beforeEach(() => {
  apiMock.listWallets.mockReset();
  apiMock.decideWallet.mockReset();
  apiMock.listWallets.mockResolvedValue(FILE);
  apiMock.decideWallet.mockImplementation(async (id, { decision }) => ({
    message: decision === 'verifier' ? 'Portefeuille validé.' : 'Portefeuille refusé.',
    compte_id: id,
    etat: decision === 'verifier' ? 'verifie' : 'refuse',
    decision,
  }));
});

afterEach(() => {
  cleanup();
});

describe('Portefeuilles — la file et ses deux noms', () => {
  it('rend le titulaire déclaré ET le nom du compte, avec un numéro masqué', async () => {
    render(<PortefeuillesPanel />);

    // « Kojo Test » est porté DEUX fois pour ce portefeuille : c'est le nom du
    // compte ET le titulaire du wallet. On juge la ligne, pas une occurrence.
    expect((await screen.findAllByText('Kojo Test')).length).toBeGreaterThanOrEqual(2);
    // Le nom DIFFÉRENT est affiché à côté : c'est leur comparaison qui décide.
    expect(screen.getByText('Fatoumata Diop')).toBeTruthy();
    // Ce portefeuille-là porte le MÊME nom des deux côtés (compte et wallet) :
    // deux occurrences, et c'est bien ce que l'écran doit montrer.
    expect(screen.getAllByText('Awa Diallo').length).toBeGreaterThanOrEqual(2);

    // L'état vient du serveur, jamais d'un calcul d'écran. Il apparaît aussi
    // dans le filtre : on demande au moins une occurrence (la pastille).
    expect(screen.getAllByText('À vérifier').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vérifié').length).toBeGreaterThan(0);

    // Le numéro masqué est rendu tel quel, et le numéro complet n'apparaît pas.
    expect(screen.getByText(/•••• 67/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('+221771234567');
  });

  it('une lecture en panne n’affiche pas « aucun portefeuille »', async () => {
    apiMock.listWallets.mockRejectedValueOnce(new Error('Réseau indisponible'));

    render(<PortefeuillesPanel />);

    await waitFor(() => expect(screen.getByText('Réseau indisponible')).toBeTruthy());
    expect(screen.queryByText('Aucun portefeuille dans cet état.')).toBeNull();
    expect(screen.getByText('Réessayer')).toBeTruthy();
  });

  it('une file réellement vide le dit, et ne fabrique pas d’erreur', async () => {
    apiMock.listWallets.mockResolvedValueOnce({ ...FILE, total: 0, portefeuilles: [] });

    render(<PortefeuillesPanel />);

    expect(await screen.findByText('Aucun portefeuille dans cet état.')).toBeTruthy();
  });
});

describe('Portefeuilles — les décisions', () => {
  it('refuse de valider sans motif, puis envoie la décision et le motif', async () => {
    render(<PortefeuillesPanel />);
    await screen.findByText('Fatoumata Diop');

    fireEvent.click(screen.getAllByText('Valider')[0]);

    // Le bouton reste FERMÉ tant que le motif est trop court.
    const appliquer = screen.getByText('Appliquer');
    expect(appliquer.disabled).toBe(true);

    const motif = screen.getByLabelText(/Motif de la décision/);
    fireEvent.change(motif, { target: { value: 'court' } });
    expect(screen.getByText('Appliquer').disabled).toBe(true);

    fireEvent.change(motif, {
      target: { value: 'Titulaire joint par téléphone, pièce vue au guichet.' },
    });
    await waitFor(() => expect(screen.getByText('Appliquer').disabled).toBe(false));

    fireEvent.click(screen.getByText('Appliquer'));

    await waitFor(() =>
      expect(apiMock.decideWallet).toHaveBeenCalledWith('worker-1', {
        decision: 'verifier',
        note: 'Titulaire joint par téléphone, pièce vue au guichet.',
      })
    );
    // La file est RELUE après la décision : l'écran peint l'état réel.
    await waitFor(() => expect(apiMock.listWallets).toHaveBeenCalledTimes(2));
  });

  it('refuser exige le même motif, et envoie l’autre sens', async () => {
    render(<PortefeuillesPanel />);
    await screen.findByText('Fatoumata Diop');

    fireEvent.click(screen.getAllByText('Refuser')[0]);
    fireEvent.change(screen.getByLabelText(/Motif de la décision/), {
      target: { value: 'Wallet d’un tiers sans lien avec le compte.' },
    });
    await waitFor(() => expect(screen.getByText('Appliquer').disabled).toBe(false));
    fireEvent.click(screen.getByText('Appliquer'));

    await waitFor(() =>
      expect(apiMock.decideWallet).toHaveBeenCalledWith('worker-1', {
        decision: 'refuser',
        note: 'Wallet d’un tiers sans lien avec le compte.',
      })
    );
  });

  it('un refus du serveur est rendu tel quel, sans effacer le remède', async () => {
    apiMock.decideWallet.mockRejectedValueOnce(
      new Error('Une note d’au moins 10 caractères est exigée.')
    );

    render(<PortefeuillesPanel />);
    await screen.findByText('Fatoumata Diop');
    fireEvent.click(screen.getAllByText('Valider')[0]);
    fireEvent.change(screen.getByLabelText(/Motif de la décision/), {
      target: { value: 'Vérifié avec le travailleur au téléphone.' },
    });
    await waitFor(() => expect(screen.getByText('Appliquer').disabled).toBe(false));
    fireEvent.click(screen.getByText('Appliquer'));

    expect(
      await screen.findByText('Une note d’au moins 10 caractères est exigée.')
    ).toBeTruthy();
  });

  it('le filtre d’état interroge la route avec cet état', async () => {
    render(<PortefeuillesPanel />);
    await screen.findByText('Fatoumata Diop');

    // La PUCE du filtre, pas la pastille de la ligne : même mot, deux rôles.
    fireEvent.click(screen.getByRole('button', { name: 'À vérifier' }));

    await waitFor(() =>
      expect(apiMock.listWallets).toHaveBeenLastCalledWith('en_attente')
    );
  });
});
