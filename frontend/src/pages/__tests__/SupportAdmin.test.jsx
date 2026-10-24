/**
 * /support-admin : une requête en vol ne doit plus écrire d'état APRÈS le
 * démontage de la page.
 *
 * ── La classe de défaut que ce fichier ferme ────────────────────────────────
 * Sur `main`, le job « Frontend tests + build » est devenu ROUGE sur
 * `src/pages/SupportAdmin.js` : une réponse de `supportAPI.listTickets` arrivait
 * après la fin de l'environnement de test, la page appelait `setTickets(...)`,
 * et React lit `window` pour choisir la priorité d'une mise à jour d'état —
 * `ReferenceError: window is not defined`. Même cause côté produit : quitter la
 * page pendant qu'une requête est en vol faisait écrire dans un arbre démonté.
 *
 * ── Ce qui est mesuré ───────────────────────────────────────────────────────
 * Pas une relecture : on compte les ÉCRITURES D'ÉTAT réelles. Le test enveloppe
 * `useState` et enregistre tout appel de setter APRÈS le démontage. Retirer le
 * garde de démontage fait donc rougir ce test, sans dépendre du hasard du
 * timing d'un runner.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Compteur d'écritures d'état postérieures au démontage ─────────────────
const etatDeLaPage = { demontee: false, ecrituresApresDemon: 0 };
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal();
  const useState = (initial) => {
    const [valeur, setValeur] = actual.useState(initial);
    return [
      valeur,
      (...args) => {
        if (etatDeLaPage.demontee) etatDeLaPage.ecrituresApresDemon += 1;
        return setValeur(...args);
      },
    ];
  };
  return { ...actual, useState };
});

const listTickets = vi.fn();
const listTeam = vi.fn();
const addAgent = vi.fn();
const removeAgent = vi.fn();
vi.mock('../../services/apiEndpoints', () => ({
  supportAPI: {
    listTickets: (...args) => listTickets(...args),
    updateTicketStatus: vi.fn(),
    listTeam: (...args) => listTeam(...args),
    addAgent: (...args) => addAgent(...args),
    removeAgent: (...args) => removeAgent(...args),
  },
}));

// ── La SESSION décide de ce que la page montre (24/10/2026) ────────────────
// Le panneau « Équipe support » n'existe que pour le PROPRIÉTAIRE : un agent
// traite les demandes, il ne recrute pas (le backend le refuse aussi). La
// session est donc mutable, et les cas ci-dessous la font varier.
const session = vi.hoisted(() => ({ utilisateur: { id: 'owner-1', email: 'owner@kojo.sn', is_owner: true } }));
vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAuth: () => ({ user: session.utilisateur, loading: false }) };
});
vi.mock('../../contexts/LanguageContext', async (importOriginal) => {
  const actual = await importOriginal();
  const { default: fr } = await vi.importActual('../../i18n/fr.json');
  return {
    ...actual,
    useLanguage: () => ({ currentLanguage: 'fr', changeLanguage: vi.fn(), t: (key) => fr[key] ?? key }),
  };
});

const SupportAdmin = (await import('../SupportAdmin.js')).default;

// Ce qu'un ticket WhatsApp porte réellement : pas d'email (le canal n'en a
// pas), un statut français, et une date lisible.
const TICKET = {
  id: 't1',
  full_name: 'Zoya🤍',
  phone: '+221771234567',
  email: null,
  reason: 'Support WhatsApp',
  message: 'Bonjour, j’ai besoin de parler à une personne.',
  status: 'Nouveau',
  channel: 'whatsapp',
  created_at: new Date().toISOString(),
};

const reponseDifferee = () => {
  let resolve;
  const promesse = new Promise((r) => { resolve = r; });
  return { promesse, resolve };
};

describe('SupportAdmin — démontage pendant une requête', () => {
  beforeEach(() => {
    listTickets.mockReset();
    listTeam.mockReset();
    addAgent.mockReset();
    removeAgent.mockReset();
    listTeam.mockResolvedValue({ agents: [] });
    session.utilisateur = { id: 'owner-1', email: 'owner@kojo.sn', is_owner: true };
    etatDeLaPage.demontee = false;
    etatDeLaPage.ecrituresApresDemon = 0;
  });

  it('la charge initiale aboutit (témoin : la page fonctionne)', async () => {
    listTickets.mockResolvedValue([TICKET]);
    render(<SupportAdmin />);
    await waitFor(() => expect(screen.queryByText('Chargement...')).toBeNull());
    expect(listTickets).toHaveBeenCalledTimes(1);
  });

  /* ── LA LISTE EST CELLE QUE LA ROUTE REND (24/10/2026) ───────────────────
     Le défaut mesuré en production : `GET /support/tickets` rendait cinq
     tickets, la page affichait « 0 demande · Aucune demande de support » sur
     TOUS les filtres. La page lisait `response.data` alors que `api.get` rend
     le CORPS (la liste), donc `undefined || []` = un tableau vide.
     Le témoin ci-dessus ne pouvait pas le voir : sa doublure imitait la
     lecture fautive (`{ data: [...] }`) au lieu de la vraie forme de l'API.
     Ce cas-ci monte la forme RÉELLE et exige que le ticket soit LU.
     Il rougit si la page revient à `response.data`. */
  it('affiche les tickets que la route rend (le corps est un TABLEAU)', async () => {
    listTickets.mockResolvedValue([TICKET, { ...TICKET, id: 't2', full_name: 'Sonde Kojo' }]);

    render(<SupportAdmin />);

    expect(await screen.findByText('Zoya🤍')).toBeTruthy();
    expect(screen.getByText('Sonde Kojo')).toBeTruthy();
    expect(screen.queryByText('Aucune demande de support pour le moment.')).toBeNull();
  });

  /* Une forme INATTENDUE n'est pas « aucune demande » : la page le DIT.
     Sans ce cas, un changement de contrat côté API rendrait la seule page qui
     montre les demandes silencieusement vide, et le propriétaire n'aurait
     aucun moyen de distinguer « rien reçu » de « lecture cassée ». */
  it('une réponse de forme inattendue est une ERREUR, pas un faux vide', async () => {
    listTickets.mockResolvedValue({ data: [TICKET] });

    render(<SupportAdmin />);

    expect(await screen.findByText('Impossible de charger les demandes de support.')).toBeTruthy();
    expect(screen.queryByText('Aucune demande de support pour le moment.')).toBeNull();
  });

  it("une réponse arrivée APRÈS le démontage n'écrit plus d'état", async () => {
    listTeam.mockReturnValue(new Promise(() => {}));
    const { promesse, resolve } = reponseDifferee();
    listTickets.mockReturnValue(promesse);

    const { unmount } = render(<SupportAdmin />);
    unmount();
    etatDeLaPage.demontee = true;

    resolve([TICKET]);
    await new Promise((r) => setTimeout(r, 20));

    expect(listTickets).toHaveBeenCalledTimes(1);
    expect(
      etatDeLaPage.ecrituresApresDemon,
      'une requête terminée après le démontage ne doit plus toucher l’état de la page'
    ).toBe(0);
  });
});

/**
 * L'ÉQUIPE SUPPORT (24/10/2026) : le propriétaire ajoute des personnes au
 * service clientèle, et ce pouvoir ne suit PAS le rôle d'agent.
 *
 * Ce qui est mesuré : la page dit qui a été ajouté (message du serveur), la
 * liste se relit après l'ajout, et un refus du serveur est rendu TEL QUEL —
 * c'est lui qui porte le remède (« la personne doit d'abord créer son
 * compte »). Un agent, lui, ne voit pas le panneau : proposer un geste que le
 * backend refuse serait un bouton mort.
 */
describe('SupportAdmin — l’équipe support', () => {
  beforeEach(() => {
    listTickets.mockReset();
    listTeam.mockReset();
    addAgent.mockReset();
    removeAgent.mockReset();
    listTickets.mockResolvedValue([]);
    session.utilisateur = { id: 'owner-1', email: 'owner@kojo.sn', is_owner: true };
    etatDeLaPage.demontee = false;
    etatDeLaPage.ecrituresApresDemon = 0;
  });

  it('le propriétaire ajoute une personne par son adresse, et la liste se relit', async () => {
    listTeam
      .mockResolvedValueOnce({ agents: [] })
      .mockResolvedValueOnce({
        agents: [{ id: 'agent-1', email: 'awa@kojo.sn', first_name: 'Awa', last_name: 'Diallo' }],
      });
    addAgent.mockResolvedValue({ message: 'Awa fait désormais partie de l’équipe support.' });

    render(<SupportAdmin />);

    const champ = await screen.findByLabelText('Adresse email du compte');
    await userEvent.type(champ, 'awa@kojo.sn');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter à l’équipe' }));

    expect(addAgent).toHaveBeenCalledWith('awa@kojo.sn');
    // Le message vient du SERVEUR : c'est lui qui sait ce qui s'est passé.
    expect(await screen.findByText('Awa fait désormais partie de l’équipe support.')).toBeTruthy();
    expect(await screen.findByText('awa@kojo.sn')).toBeTruthy();
    expect(listTeam).toHaveBeenCalledTimes(2);
  });

  it('un refus du serveur est affiché tel quel (il porte le remède)', async () => {
    listTeam.mockResolvedValue({ agents: [] });
    const refus = new Error(
      'Aucun compte Kojo n’utilise cette adresse. La personne doit d’abord créer son compte sur Kojo, puis vous pourrez l’ajouter à l’équipe.'
    );
    refus.response = {
      status: 404,
      data: {
        detail:
          'Aucun compte Kojo n’utilise cette adresse. La personne doit d’abord créer son compte sur Kojo, puis vous pourrez l’ajouter à l’équipe.',
      },
    };
    addAgent.mockRejectedValue(refus);

    render(<SupportAdmin />);

    await userEvent.type(await screen.findByLabelText('Adresse email du compte'), 'inconnu@kojo.sn');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter à l’équipe' }));

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent('créer son compte');
  });

  it('retirer un membre appelle la route de retrait', async () => {
    listTeam
      .mockResolvedValueOnce({
        agents: [{ id: 'agent-1', email: 'awa@kojo.sn', first_name: 'Awa', last_name: 'Diallo' }],
      })
      .mockResolvedValueOnce({ agents: [] });
    removeAgent.mockResolvedValue({ message: 'Awa ne fait plus partie de l’équipe support.' });

    render(<SupportAdmin />);

    await userEvent.click(await screen.findByRole('button', { name: 'Retirer awa@kojo.sn' }));

    expect(removeAgent).toHaveBeenCalledWith('agent-1');
    expect(await screen.findByText('Awa ne fait plus partie de l’équipe support.')).toBeTruthy();
    expect(screen.queryByText('awa@kojo.sn')).toBeNull();
  });

  it('un agent du service clientèle ne voit PAS le panneau d’équipe', async () => {
    session.utilisateur = { id: 'agent-1', email: 'awa@kojo.sn', user_type: 'client', support_role: 'agent' };
    listTickets.mockResolvedValue([TICKET]);

    render(<SupportAdmin />);

    // Il voit bien les demandes (c'est son travail)…
    expect(await screen.findByText('Zoya🤍')).toBeTruthy();
    // …mais pas le panneau de recrutement, et sa route n'est même pas appelée.
    expect(screen.queryByText('Équipe support')).toBeNull();
    expect(listTeam).not.toHaveBeenCalled();
  });
});
