/**
 * Paliers de commission — le barème du propriétaire.
 *
 * Ce qui est prouvé ici : le panneau LIT ce que le serveur publie, ÉCRIT le
 * barème, et RÉAFFICHE ce que le serveur a réellement enregistré (jamais la
 * saisie locale). Un refus doit s'afficher en nommant la cause : une valeur
 * corrigée en silence ferait croire que le barème saisi s'applique.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OwnerCommissionTiers from '../OwnerCommissionTiers';
import OwnerService from '../../services/ownerService';

vi.mock('../../services/ownerService', () => ({
  default: {
    getCommissionTiers: vi.fn(),
    updateCommissionTiers: vi.fn(),
  },
}));

const LECTURE = {
  status: 'success',
  taux_standard_percent: 14,
  paliers: {
    actif: false,
    lancement_missions: 3,
    lancement_taux_percent: 0,
    recurrent_missions: 10,
    recurrent_taux_percent: 8,
  },
};

beforeEach(() => {
  OwnerService.getCommissionTiers.mockResolvedValue(LECTURE);
  OwnerService.updateCommissionTiers.mockResolvedValue({
    ...LECTURE,
    status: 'success',
    paliers: { ...LECTURE.paliers, actif: true, lancement_missions: 5 },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Paliers de commission (propriétaire)', () => {
  it('rend le barème lu et le taux standard auquel il se compare', async () => {
    render(<OwnerCommissionTiers />);

    expect(await screen.findByText('Paliers de commission')).toBeInTheDocument();
    // Le taux de croisière est publié AVEC les paliers : « lancement 0 % » ne
    // se lit pas sans ce à quoi il se compare.
    expect(screen.getByText(/14 %/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Missions offertes au lancement/i)).toHaveValue(3);
    expect(screen.getByLabelText(/Commission de fidélité/i)).toHaveValue(8);
  });

  it('enregistre la saisie puis réaffiche ce que le serveur a retenu', async () => {
    const utilisateur = userEvent.setup();
    render(<OwnerCommissionTiers />);

    const champ = await screen.findByLabelText(/Missions offertes au lancement/i);
    await utilisateur.clear(champ);
    await utilisateur.type(champ, '5');
    await utilisateur.click(screen.getByLabelText(/Appliquer les paliers/i));
    await utilisateur.click(screen.getByRole('button', { name: /Enregistrer les paliers/i }));

    await waitFor(() => {
      expect(OwnerService.updateCommissionTiers).toHaveBeenCalledWith({
        actif: true,
        lancement_missions: 5,
        lancement_taux_percent: 0,
        recurrent_missions: 10,
        recurrent_taux_percent: 8,
      });
    });
    // La confirmation ne dit pas « enregistré » d'après la saisie : elle
    // réaffiche la configuration relue.
    expect(await screen.findByText(/Paliers enregistrés/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Missions offertes au lancement/i)).toHaveValue(5);
  });

  it('affiche le refus du serveur au lieu de faire semblant', async () => {
    OwnerService.updateCommissionTiers.mockRejectedValueOnce(
      new Error('recurrent_taux_percent doit être entre 0 et 50')
    );
    const utilisateur = userEvent.setup();
    render(<OwnerCommissionTiers />);

    await screen.findByLabelText(/Missions offertes au lancement/i);
    await utilisateur.click(screen.getByRole('button', { name: /Enregistrer les paliers/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'recurrent_taux_percent doit être entre 0 et 50'
    );
    expect(screen.queryByText(/Paliers enregistrés/i)).not.toBeInTheDocument();
  });

  it('une lecture en panne se dit, et ne laisse pas un formulaire vide', async () => {
    OwnerService.getCommissionTiers.mockRejectedValueOnce(new Error('Accès interdit'));
    render(<OwnerCommissionTiers />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Accès interdit');
    expect(screen.queryByRole('button', { name: /Enregistrer les paliers/i })).not.toBeInTheDocument();
  });
});
