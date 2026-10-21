/**
 * Fin de mission à deux temps — ce que chaque partie VOIT et peut faire.
 *
 * Ce test ferme le défaut qui motivait le changement : l'interface ne disait au
 * travailleur ni comment déclarer, ni quand l'argent partirait sans le client.
 * Il vérifie donc trois choses concrètes :
 *   1. le formulaire du travailleur n'envoie rien sous 20 caractères (la note
 *      est la preuve que le client lira) ;
 *   2. la déclaration AFFICHE l'échéance, et le client voit le bouton de
 *      validation ;
 *   3. le travailleur, lui, ne voit jamais ce bouton — il attend.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CompletionPanel from '../CompletionPanel';
import fr from '../../i18n/fr.json';

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    currentLanguage: 'fr',
    t: (key) => fr[key] ?? key,
  }),
}));

const JOB_EN_COURS = { id: 'job-1', status: 'in_progress', title: 'Plomberie' };
const MARKED = {
  state: 'marked',
  note: 'Fuite réparée, joint changé et test d’étanchéité effectué.',
  proofs: ['https://res.cloudinary.com/kojo/image/upload/preuve.jpg'],
  auto_release_at: '2026-10-27T10:00:00+00:00',
};

afterEach(() => cleanup());

describe('CompletionPanel', () => {
  it('ne rend rien quand la mission n’est ni déclarée ni déclarable', () => {
    const { container } = render(
      <CompletionPanel job={{ ...JOB_EN_COURS, status: 'open' }} isOwner={false} isWorker={false} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('le travailleur ne peut pas déclarer avec une note trop courte', async () => {
    const onMark = vi.fn();
    render(<CompletionPanel job={JOB_EN_COURS} isWorker onMark={onMark} />);

    const bouton = screen.getByRole('button', { name: /déclarer le travail terminé/i });
    expect(bouton).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/ce qui a été fait/i), 'Fuite réparée');
    expect(bouton).toBeDisabled();
    // Le message dit pourquoi, au lieu de laisser un bouton mort. (La phrase
    // cherchée est celle de l'AIDE du champ : l'introduction contient AUSSI
    // « 20 caractères minimum », donc ce fragment en trouverait deux.)
    expect(screen.getByText(/preuve que le client lira/i)).toBeInTheDocument();

    fireEvent.click(bouton);
    expect(onMark).not.toHaveBeenCalled();
  });

  it('une note suffisante envoie la déclaration (note nettoyée, sans photo)', async () => {
    const onMark = vi.fn();
    render(<CompletionPanel job={JOB_EN_COURS} isWorker onMark={onMark} />);

    await userEvent.type(
      screen.getByLabelText(/ce qui a été fait/i),
      '  Fuite réparée, joint changé et test d’étanchéité effectué.  ',
    );
    await userEvent.click(screen.getByRole('button', { name: /déclarer le travail terminé/i }));

    expect(onMark).toHaveBeenCalledTimes(1);
    expect(onMark.mock.calls[0][0]).toEqual({
      note: 'Fuite réparée, joint changé et test d’étanchéité effectué.',
      files: [],
    });
  });

  it('le client voit l’échéance et valide le paiement', async () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <CompletionPanel job={{ ...JOB_EN_COURS, completion: MARKED }} isOwner onConfirm={onConfirm} />,
    );

    // L'échéance est peinte par `toLocaleDateString`, donc l'ORDRE des nombres
    // suit la locale du navigateur (fr : 27/10/2026, en-US — celle des runners
    // de CI — : 10/27/2026). La version qui figeait « 27/10/2026 » mesurait la
    // locale de la machine, pas le fait que le panneau AFFICHE l'échéance : elle
    // a rougi en intégration le 21/10/2026 sans qu'aucune ligne de production
    // n'ait changé. La date attendue se DÉRIVE donc de la même source que le
    // composant, jamais d'une copie de sa sortie.
    const attendu = new Date(MARKED.auto_release_at).toLocaleDateString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    expect(attendu).not.toBe('');
    expect(container.textContent).toContain(attendu);
    expect(screen.getByText(MARKED.note)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /valider et payer/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('le travailleur attend, et ne voit pas le bouton de validation', () => {
    render(<CompletionPanel job={{ ...JOB_EN_COURS, completion: MARKED }} isWorker />);

    expect(screen.getByText(/en attente de la validation du client/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /valider et payer/i })).not.toBeInTheDocument();
  });

  it('une libération automatique impossible est dite, pas silencieuse', () => {
    render(
      <CompletionPanel
        job={{ ...JOB_EN_COURS, completion: { ...MARKED, state: 'auto_release_blocked' } }}
        isOwner
      />,
    );

    expect(screen.getByText(/aucun paiement séquestré/i)).toBeInTheDocument();
  });

  it('l’erreur du serveur est annoncée au lecteur d’écran', () => {
    render(<CompletionPanel job={JOB_EN_COURS} isWorker error="Le serveur a refusé la déclaration." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Le serveur a refusé la déclaration.');
  });
});
