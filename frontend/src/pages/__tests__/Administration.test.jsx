/**
 * /administration — LE PROPRIÉTAIRE VOIT, SANCTIONNE, ET LIT SANS ÉCRIRE.
 *
 * Ce que ces cas prouvent
 * -----------------------
 * 1. Le répertoire rend les comptes RÉELS avec leur état, et les tuiles
 *    comptent la même lecture (pas un second chiffre inventé).
 * 2. Une sanction ne part JAMAIS sans motif : le bouton reste fermé sous dix
 *    caractères, puis envoie le motif saisi — c'est la règle du serveur, et
 *    l'écran ne peut pas la contourner.
 * 3. Réactiver n'exige aucun motif : rendre un droit n'a pas à se justifier.
 * 4. La lecture d'un fil est LECTURE SEULE et le dit à l'écran : la route ne
 *    marque rien comme lu, et l'écran ne prétend pas le contraire.
 * 5. Une lecture en panne n'affiche PAS l'état vide : « aucun compte » et « je
 *    n'ai pas pu lire » sont deux faits différents.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
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

const serviceMock = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getAccount: vi.fn(),
  setAccountState: vi.fn(),
  getConversations: vi.fn(),
  getConversation: vi.fn(),
}));

vi.mock('../../services/ownerService', () => ({ default: serviceMock }));

const { default: Administration } = await import('../Administration.js');
const { ToastProvider } = await import('../../contexts/ToastContext.js');

const CLIENT_ACTIF = {
  id: 'client-1',
  first_name: 'Awa',
  last_name: 'Diallo',
  email: 'awa@kojo.sn',
  user_type: 'client',
  country: 'senegal',
  created_at: '2026-10-20T10:00:00+00:00',
  email_verified: true,
  account_state: 'actif',
  account_state_reason: null,
};

const TRAVAILLEUR_RESTREINT = {
  id: 'worker-1',
  first_name: 'Moussa',
  last_name: 'Traore',
  email: 'moussa@kojo.sn',
  user_type: 'worker',
  country: 'mali',
  created_at: '2026-10-19T09:00:00+00:00',
  email_verified: false,
  account_state: 'restreint',
  account_state_reason: 'Candidatures frauduleuses',
};

const REPERTOIRE = {
  count: 2,
  total: 2,
  tronque: false,
  comptes: [CLIENT_ACTIF, TRAVAILLEUR_RESTREINT],
  mesures: {
    total: 128,
    clients: 90,
    travailleurs: 38,
    restreints: 1,
    bannis: 2,
  },
};

const rendre = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Administration />
      </ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  serviceMock.getAccounts.mockReset();
  serviceMock.getAccount.mockReset();
  serviceMock.setAccountState.mockReset();
  serviceMock.getConversations.mockReset();
  serviceMock.getConversation.mockReset();

  serviceMock.getAccounts.mockResolvedValue(REPERTOIRE);
  serviceMock.getAccount.mockResolvedValue({
    ...CLIENT_ACTIF,
    activite: { missions_publiees: 4, propositions: 0, messages: 9, avis_recus: 2 },
    historique: [],
  });
  serviceMock.setAccountState.mockImplementation(async (id, { etat, motif }) => ({
    message: 'Compte mis à jour.',
    compte: { ...CLIENT_ACTIF, id, account_state: etat, account_state_reason: motif || null },
  }));
  serviceMock.getConversations.mockResolvedValue({
    total: 1,
    count: 1,
    tronque: false,
    conversations: [
      {
        conversation_id: 'client-1_worker-1',
        participants: [
          { id: 'client-1', nom: 'Awa Diallo', email: 'awa@kojo.sn', user_type: 'client' },
          { id: 'worker-1', nom: 'Moussa Traore', email: 'moussa@kojo.sn', user_type: 'worker' },
        ],
        dernier_message: 'La fuite est toujours là.',
        dernier_at: '2026-10-24T12:00:00+00:00',
        messages: 2,
      },
    ],
  });
  serviceMock.getConversation.mockResolvedValue({
    conversation_id: 'client-1_worker-1',
    participants: [
      { id: 'client-1', nom: 'Awa Diallo', email: 'awa@kojo.sn', user_type: 'client' },
      { id: 'worker-1', nom: 'Moussa Traore', email: 'moussa@kojo.sn', user_type: 'worker' },
    ],
    count: 2,
    lu_marque: false,
    messages: [
      {
        id: 'm1',
        sender_id: 'client-1',
        sender_name: 'Awa Diallo',
        content: 'Bonjour Moussa, la fuite est toujours là.',
        timestamp: '2026-10-24T11:00:00+00:00',
      },
      {
        id: 'm2',
        sender_id: 'worker-1',
        sender_name: 'Moussa Traore',
        content: 'Je passe demain matin.',
        timestamp: '2026-10-24T12:00:00+00:00',
      },
    ],
  });
});

afterEach(() => {
  cleanup();
});

describe('/administration — le répertoire et ses mesures', () => {
  it('rend les comptes réels, leurs états et les totaux de la MÊME lecture', async () => {
    rendre();

    expect(await screen.findByText(/awa@kojo.sn/)).toBeTruthy();
    expect(screen.getByText(/moussa@kojo\.sn/)).toBeTruthy();

    // Les états viennent du compte, pas d'un champ supposé. Le sélecteur de
    // filtre porte les mêmes mots : on juge la PASTILLE de la ligne (`span`),
    // pas une option de menu.
    expect(screen.getByText('Actif', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('Restreint', { selector: 'span' })).toBeTruthy();

    // Les tuiles lisent `mesures` : 90 clients, 38 travailleurs, 1 + 2 sanctionnés.
    expect(screen.getByText('128')).toBeTruthy();
    expect(screen.getByText('90')).toBeTruthy();
    expect(screen.getByText('38')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('une lecture en panne n’affiche pas « aucun compte »', async () => {
    serviceMock.getAccounts.mockRejectedValueOnce(new Error('Réseau indisponible'));

    rendre();

    await waitFor(() => expect(screen.getByText('Réseau indisponible')).toBeTruthy());
    expect(screen.queryByText('Aucun compte ne correspond à cette recherche.')).toBeNull();
    expect(screen.getByText('Réessayer')).toBeTruthy();
  });
});

describe('/administration — les décisions', () => {
  it('refuse de bannir sans motif, puis applique le motif saisi', async () => {
    rendre();
    await screen.findByText(/awa@kojo.sn/);

    // La ligne du client actif porte « Bannir » ; celle du travailleur déjà
    // restreint porte « Réactiver ».
    const boutonsBannir = screen.getAllByText('Bannir');
    fireEvent.click(boutonsBannir[0]);

    // La décision ne part pas tant que le motif est trop court : le bouton
    // « Appliquer » est FERMÉ, et le clic ne déclenche aucun appel.
    const appliquer = screen.getByText('Appliquer');
    expect(appliquer.disabled).toBe(true);

    const motif = screen.getByLabelText(/Motif de la décision/);
    fireEvent.change(motif, { target: { value: 'arnaque' } });
    expect(screen.getByText('Appliquer').disabled).toBe(true);

    fireEvent.change(motif, { target: { value: 'Faux comptes et arnaques répétées' } });
    await waitFor(() => expect(screen.getByText('Appliquer').disabled).toBe(false));

    // La relecture qui suit la décision rend le compte RÉELLEMENT en base :
    // c'est ce document-là que l'écran doit peindre, pas la demande.
    serviceMock.getAccounts.mockResolvedValue({
      ...REPERTOIRE,
      comptes: [{ ...CLIENT_ACTIF, account_state: 'banni' }, TRAVAILLEUR_RESTREINT],
      mesures: { ...REPERTOIRE.mesures, bannis: 3 },
    });

    fireEvent.click(screen.getByText('Appliquer'));

    await waitFor(() =>
      expect(serviceMock.setAccountState).toHaveBeenCalledWith('client-1', {
        etat: 'banni',
        motif: 'Faux comptes et arnaques répétées',
      })
    );
    // Le compte RENDU par le serveur remplace la ligne : l'écran montre
    // l'état appliqué, pas l'état demandé.
    await waitFor(() => expect(screen.getAllByText('Banni', { selector: 'span' }).length).toBeGreaterThan(0));
  });

  it('réactiver n’exige aucun motif', async () => {
    rendre();
    await screen.findByText(/moussa@kojo.sn/);

    fireEvent.click(screen.getByText('Réactiver'));

    // Aucun champ de motif pour rendre un droit.
    expect(screen.queryByLabelText(/Motif de la décision/)).toBeNull();
    fireEvent.click(screen.getByText('Appliquer'));

    await waitFor(() =>
      expect(serviceMock.setAccountState).toHaveBeenCalledWith('worker-1', {
        etat: 'actif',
        motif: '',
      })
    );
  });

  it('une fiche montre l’activité comptée et l’historique du compte', async () => {
    serviceMock.getAccount.mockResolvedValueOnce({
      ...CLIENT_ACTIF,
      account_state: 'restreint',
      account_state_reason: 'Publications hors sujet',
      activite: { missions_publiees: 4, propositions: 0, messages: 9, avis_recus: 2 },
      historique: [
        { etat: 'restreint', motif: 'Publications hors sujet', at: '2026-10-24T10:00:00+00:00', by: 'owner-1' },
      ],
    });

    rendre();
    await screen.findByText(/awa@kojo.sn/);
    fireEvent.click(screen.getByRole('button', { name: /Awa Diallo/ }));

    await waitFor(() => expect(serviceMock.getAccount).toHaveBeenCalledWith('client-1'));
    expect(await screen.findByText('Missions publiées')).toBeTruthy();
    expect(screen.getByText(/Publications hors sujet/)).toBeTruthy();
    expect(screen.getByText(/owner-1/)).toBeTruthy();
  });
});

describe('/administration — les conversations, en lecture seule', () => {
  it('ouvre un fil sans rien marquer comme lu, et le dit', async () => {
    rendre();
    await screen.findByText(/awa@kojo.sn/);

    fireEvent.click(screen.getByRole('tab', { name: 'Messages' }));

    await waitFor(() => expect(serviceMock.getConversations).toHaveBeenCalled());
    const ligne = await screen.findByText(/Awa Diallo ↔ Moussa Traore/);
    fireEvent.click(ligne);

    await waitFor(() => expect(serviceMock.getConversation).toHaveBeenCalledWith('client-1_worker-1'));
    expect(await screen.findByText('Bonjour Moussa, la fuite est toujours là.')).toBeTruthy();
    expect(
      screen.getByText('Lecture seule — vos ouvertures ne marquent aucun message comme lu.')
    ).toBeTruthy();
    // Aucune route d'écriture n'est appelée par la lecture d'un fil.
    expect(serviceMock.setAccountState).not.toHaveBeenCalled();
  });
});
