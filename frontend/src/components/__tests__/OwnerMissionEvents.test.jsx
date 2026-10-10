import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getMissionBusinessEvents = vi.fn();

vi.mock('../../services/ownerService', () => ({
  default: { getMissionBusinessEvents: (...args) => getMissionBusinessEvents(...args) },
}));

import OwnerMissionEvents from '../OwnerMissionEvents';

const saisirEtSoumettre = (valeur) => {
  fireEvent.change(screen.getByPlaceholderText('Identifiant de la mission'), {
    target: { value: valeur },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Afficher le journal' }));
};

describe('OwnerMissionEvents', () => {
  beforeEach(() => {
    getMissionBusinessEvents.mockReset();
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
