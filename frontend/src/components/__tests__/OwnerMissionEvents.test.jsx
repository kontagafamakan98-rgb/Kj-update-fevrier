import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getMissionBusinessEvents = vi.fn();
const getMissionDispute = vi.fn();

vi.mock('../../services/ownerService', () => ({
  default: {
    getMissionBusinessEvents: (...args) => getMissionBusinessEvents(...args),
    getMissionDispute: (...args) => getMissionDispute(...args),
  },
}));

import OwnerMissionEvents, { detailLisible } from '../OwnerMissionEvents';

const saisirEtSoumettre = (valeur) => {
  fireEvent.change(screen.getByPlaceholderText('Identifiant de la mission'), {
    target: { value: valeur },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Afficher le journal' }));
};

// Les CINQ jalons du litige tracé, tels que `business_events` les écrit : rien
// que des clés énumérées (decision, paiement, echeance, position).
const JALONS_LITIGE = [
  {
    id: 'l1',
    type: 'mission_dispute_opened',
    details: { echeance: '2026-10-27T09:00:00+00:00' },
    created_at: '2026-10-22T09:00:00+00:00',
  },
  {
    id: 'l2',
    type: 'mission_dispute_answered',
    details: { position: 'refund_client' },
    created_at: '2026-10-23T09:00:00+00:00',
  },
  {
    id: 'l3',
    type: 'mission_dispute_decided',
    details: { decision: 'release_worker', paiement: 'released' },
    created_at: '2026-10-24T09:00:00+00:00',
  },
];

describe('OwnerMissionEvents', () => {
  beforeEach(() => {
    getMissionBusinessEvents.mockReset();
    getMissionDispute.mockReset();
    // Par défaut : pas de litige. Les cas qui en ont un le disent.
    getMissionDispute.mockResolvedValue({ job_id: 'job-42', litige: { response: null } });
  });

  it('affiche les jalons dans l\'ordre reçu, avec leur libellé français', async () => {
    getMissionBusinessEvents.mockResolvedValue({
      job_id: 'job-42',
      count: 2,
      evenements: [
        { id: 'e1', type: 'mission_created', created_at: '2026-10-01T10:00:00+00:00' },
        { id: 'e2', type: 'proposal_accepted', created_at: '2026-10-01T11:00:00+00:00' },
      ],
    });

    render(<OwnerMissionEvents />);
    saisirEtSoumettre('job-42');

    await waitFor(() => expect(screen.getByText('Mission créée')).toBeTruthy());
    expect(getMissionBusinessEvents).toHaveBeenCalledWith('job-42');
    const libelles = Array.from(document.querySelectorAll('ol li span')).map((n) => n.textContent);
    expect(libelles).toEqual(['Mission créée', 'Proposition acceptée']);
  });

  it('nomme les cinq jalons du litige — aucun nom brut à l\'écran', async () => {
    getMissionBusinessEvents.mockResolvedValue({
      job_id: 'job-42',
      count: 5,
      evenements: [
        ...JALONS_LITIGE,
        {
          id: 'l4',
          type: 'mission_dispute_withdrawn',
          created_at: '2026-10-25T09:00:00+00:00',
        },
        {
          id: 'l5',
          type: 'mission_dispute_expired',
          details: { echeance: '2026-10-27T09:00:00+00:00' },
          created_at: '2026-10-27T09:05:00+00:00',
        },
      ],
    });

    render(<OwnerMissionEvents />);
    saisirEtSoumettre('job-42');

    await waitFor(() => expect(screen.getByText(/Litige ouvert/)).toBeTruthy());
    const texte = document.body.textContent;
    expect(texte).toContain('Réponse de l’autre partie');
    expect(texte).toContain('Litige retiré');
    expect(texte).toContain('Litige tranché');
    expect(texte).toContain('Litige échu sans décision');
    // Aucun type brut ne subsiste : c'est ce qui faisait lire un journal muet.
    expect(texte).not.toContain('mission_dispute_');
  });

  it('traduit position, décision, paiement et échéance en français lisible', async () => {
    getMissionBusinessEvents.mockResolvedValue({
      job_id: 'job-42',
      count: 3,
      evenements: JALONS_LITIGE,
    });

    render(<OwnerMissionEvents />);
    saisirEtSoumettre('job-42');

    await waitFor(() => expect(screen.getByText(/Litige ouvert/)).toBeTruthy());
    const texte = document.body.textContent;
    expect(texte).toContain('Échéance d’arbitrage : 27/10/2026');
    expect(texte).toContain('Demande : rembourser le client');
    expect(texte).toContain('Décision : verser au travailleur');
    expect(texte).toContain('paiement : versement effectué');
    // Le vocabulaire machine ne fuit pas jusqu'à l'écran de l'arbitre.
    expect(texte).not.toContain('refund_client');
    expect(texte).not.toContain('release_worker');
  });

  it('nomme une décision NON exécutée et sa cause, sans le nom brut du type', async () => {
    getMissionBusinessEvents.mockResolvedValue({
      job_id: 'job-42',
      count: 1,
      evenements: [{
        id: 'l6',
        type: 'mission_dispute_decision_failed',
        details: { decision: 'refund_client', echec: 'versement_refuse' },
        created_at: '2026-10-24T09:00:00+00:00',
      }],
    });

    render(<OwnerMissionEvents />);
    saisirEtSoumettre('job-42');

    await waitFor(() => expect(screen.getByText(/Décision non exécutée/)).toBeTruthy());
    const texte = document.body.textContent;
    // La décision TENTÉE et la cause nommée : un échec sans objet ne se relit pas.
    expect(texte).toContain('décision tentée : rembourser le client');
    expect(texte).toContain('versement refusé');
    expect(texte).not.toContain('mission_dispute_decision_failed');
  });

  it('pose la réponse de l\'autre partie SOUS son jalon, lue chez le propriétaire', async () => {
    getMissionBusinessEvents.mockResolvedValue({
      job_id: 'job-42',
      count: 3,
      evenements: JALONS_LITIGE,
    });
    getMissionDispute.mockResolvedValue({
      job_id: 'job-42',
      litige: {
        state: 'open',
        response: { position: 'refund_client', note: 'Le chantier est resté à moitié fait.' },
      },
    });

    render(<OwnerMissionEvents />);
    saisirEtSoumettre('job-42');

    await waitFor(() =>
      expect(screen.getByText('Le chantier est resté à moitié fait.')).toBeTruthy()
    );
    expect(getMissionDispute).toHaveBeenCalledWith('job-42');
    // Une seule fois : la note n'est pas recopiée sur les autres jalons.
    expect(screen.getAllByText('Le chantier est resté à moitié fait.')).toHaveLength(1);
  });

  it('pose la motivation du propriétaire SOUS le jalon de la décision', async () => {
    getMissionBusinessEvents.mockResolvedValue({
      job_id: 'job-42',
      count: 3,
      evenements: JALONS_LITIGE,
    });
    const MOTIVATION = 'Preuves photo conformes, travail achevé le jour même.';
    getMissionDispute.mockResolvedValue({
      job_id: 'job-42',
      litige: {
        state: 'resolved',
        decision: 'release_worker',
        decision_note: MOTIVATION,
        response: { position: 'refund_client', note: 'Le chantier est resté à moitié fait.' },
      },
    });

    render(<OwnerMissionEvents />);
    saisirEtSoumettre('job-42');

    await waitFor(() => expect(screen.getByText(MOTIVATION)).toBeTruthy());
    // Nommée : sans étiquette, elle se lirait comme la réponse de l'autre partie.
    const etiquette = screen.getByText('Motivation de la décision (propriétaire)');
    // Elle est POSÉE sous le jalon de la décision, pas sous un autre.
    const jalon = etiquette.closest('li');
    expect(jalon.textContent).toContain('Litige tranché');
    expect(jalon.textContent).toContain(MOTIVATION);
    // Une seule fois : la motivation ne se recopie pas sur la réponse.
    expect(screen.getAllByText(MOTIVATION)).toHaveLength(1);
    // La réponse de l'autre partie reste sous SON jalon.
    expect(screen.getByText('Le chantier est resté à moitié fait.').closest('li').textContent)
      .toContain('Réponse de l’autre partie');
  });

  it('une décision sans motivation n’invente pas de note', async () => {
    getMissionBusinessEvents.mockResolvedValue({
      job_id: 'job-42',
      count: 3,
      evenements: JALONS_LITIGE,
    });
    getMissionDispute.mockResolvedValue({
      job_id: 'job-42',
      litige: { state: 'resolved', decision: 'release_worker', decision_note: null, response: null },
    });

    render(<OwnerMissionEvents />);
    saisirEtSoumettre('job-42');

    await waitFor(() => expect(screen.getByText(/Litige tranché/)).toBeTruthy());
    // Une décision d'avant la note obligatoire reste lisible — sans prose inventée.
    expect(screen.queryByText(/Motivation de la décision/i)).toBeNull();
    expect(document.querySelectorAll('ol li p')).toHaveLength(0);
  });

  it('garde la chronologie quand la lecture du litige échoue (la note manque, point)', async () => {
    getMissionBusinessEvents.mockResolvedValue({
      job_id: 'job-42',
      count: 3,
      evenements: JALONS_LITIGE,
    });
    getMissionDispute.mockRejectedValue(new Error('Litige inaccessible'));

    render(<OwnerMissionEvents />);
    saisirEtSoumettre('job-42');

    await waitFor(() => expect(screen.getByText(/Litige tranché/)).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Réponse de l’autre partie/)).toBeTruthy();
    // Les deux notes manquent ensemble : la lecture est la même pour les deux.
    expect(screen.queryByText(/Motivation de la décision/i)).toBeNull();
  });

  it('n\'affiche aucune note quand le litige n\'a pas encore de réponse', async () => {
    getMissionBusinessEvents.mockResolvedValue({
      job_id: 'job-42',
      count: 1,
      evenements: [JALONS_LITIGE[0]],
    });
    getMissionDispute.mockResolvedValue({ job_id: 'job-42', litige: { state: 'open', response: null } });

    render(<OwnerMissionEvents />);
    saisirEtSoumettre('job-42');

    await waitFor(() => expect(screen.getByText(/Litige ouvert/)).toBeTruthy());
    expect(screen.queryByText(/Demande :/)).toBeNull();
    expect(document.querySelectorAll('ol li p')).toHaveLength(0);
  });

  it('affiche un message clair quand la mission n\'a aucun événement', async () => {
    getMissionBusinessEvents.mockResolvedValue({ job_id: 'job-vide', count: 0, evenements: [] });

    render(<OwnerMissionEvents />);
    saisirEtSoumettre('job-vide');

    await waitFor(() =>
      expect(screen.getByText('Aucun événement enregistré pour cette mission.')).toBeTruthy()
    );
  });

  it('affiche l\'erreur du service au lieu d\'un journal vide', async () => {
    getMissionBusinessEvents.mockRejectedValue(new Error('Accès interdit'));

    render(<OwnerMissionEvents />);
    saisirEtSoumettre('job-refuse');

    const alerte = await screen.findByRole('alert');
    expect(alerte.textContent).toBe('Accès interdit');
    expect(screen.queryByText('Aucun événement enregistré pour cette mission.')).toBeNull();
    // Le journal est la première lecture : si elle échoue, on ne demande pas le litige.
    expect(getMissionDispute).not.toHaveBeenCalled();
  });

  it('ne lance aucune requête sans identifiant de mission', () => {
    render(<OwnerMissionEvents />);
    const bouton = screen.getByRole('button', { name: 'Afficher le journal' });

    expect(bouton.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Identifiant de la mission'), {
      target: { value: '   ' },
    });
    fireEvent.click(bouton);

    expect(getMissionBusinessEvents).not.toHaveBeenCalled();
  });
});

describe('detailLisible', () => {
  it('rend une chaîne vide pour un jalon sans détail', () => {
    expect(detailLisible({ type: 'mission_created' })).toBe('');
    expect(detailLisible({ type: 'mission_dispute_withdrawn' })).toBe('');
  });

  it('nomme un paiement inconnu au lieu de le taire', () => {
    // Une issue nouvelle côté backend doit rester visible, pas disparaître.
    expect(detailLisible({ type: 'mission_dispute_decided', details: { paiement: 'refund_pending' } }))
      .toBe('paiement : refund_pending');
  });
});
