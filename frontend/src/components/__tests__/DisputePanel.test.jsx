/**
 * Litige tracé — ce que chaque PARTIE voit et peut faire.
 *
 * Le défaut que ce panneau ferme : un désaccord n'existait que comme ticket
 * support, sans état, sans échéance et sans trace, et l'échéance de libération
 * automatique payait le travailleur sans qu'aucun arbitre ait lu la
 * contestation. Les cas ci-dessous jugent donc les faits qui changent le geste :
 *   1. le formulaire ne part pas sous 20 caractères (le motif est ce que le
 *      propriétaire lira) ;
 *   2. le litige ouvert AFFICHE l'échéance et l'état de gel ;
 *   3. seul l'OUVREUR voit le retrait — laisser l'autre partie débloquer
 *      l'argent reviendrait à donner au débiteur la clé du séquestre ;
 *   4. l'AUTRE partie répond UNE fois (position + note bornée), et l'ouvreur
 *      relit cette version : le propriétaire tranche sur les deux textes ;
 *   5. un tiers ne voit rien du tout (le serveur ne le lui rend même pas).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DisputePanel from '../DisputePanel';
import fr from '../../i18n/fr.json';

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    currentLanguage: 'fr',
    t: (key) => fr[key] ?? key,
  }),
}));

const MOTIF = 'Le joint posé fuit au bout de deux jours, le travail n’est pas fini.';
const REPONSE = 'Le joint a été changé et testé le jour même ; la fuite vient du siphon.';
const JOB = {
  id: 'job-1',
  status: 'in_progress',
  assigned_worker_id: 'worker-1',
  client_id: 'client-1',
};
const LITIGE = {
  state: 'open',
  reason: MOTIF,
  opened_by: 'client-1',
  opened_by_role: 'client',
  opened_at: '2026-10-21T10:00:00+00:00',
  decision_deadline_at: '2026-10-26T10:00:00+00:00',
};

afterEach(() => cleanup());

describe('DisputePanel', () => {
  it('ne rend rien à un tiers, ni sans litige ni pour ouvrir', () => {
    const { container } = render(<DisputePanel job={JOB} currentUserId="tiers-1" />);
    expect(container.innerHTML).toBe('');
  });

  it('ne rend rien quand la mission n’est plus en cours et sans litige', () => {
    const { container } = render(
      <DisputePanel job={{ ...JOB, status: 'completed' }} isOwner currentUserId="client-1" />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('le motif est exigé : sous 20 caractères, rien ne part', async () => {
    const onOpen = vi.fn();
    render(<DisputePanel job={JOB} isOwner currentUserId="client-1" onOpen={onOpen} />);

    await userEvent.click(screen.getByRole('button', { name: /ouvrir un litige/i }));
    const envoyer = screen.getByRole('button', { name: /ouvrir le litige/i });
    expect(envoyer).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/ce que je conteste/i), 'Ça fuit');
    expect(envoyer).toBeDisabled();
    // L'aide dit POURQUOI, au lieu de laisser un bouton mort.
    expect(screen.getByText(/ce que le propriétaire lira pour trancher/i)).toBeInTheDocument();

    fireEvent.click(envoyer);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('un motif suffisant ouvre le litige (texte nettoyé)', async () => {
    const onOpen = vi.fn();
    render(<DisputePanel job={JOB} isOwner currentUserId="client-1" onOpen={onOpen} />);

    await userEvent.click(screen.getByRole('button', { name: /ouvrir un litige/i }));
    await userEvent.type(screen.getByLabelText(/ce que je conteste/i), `  ${MOTIF}  `);
    await userEvent.click(screen.getByRole('button', { name: /ouvrir le litige/i }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toBe(MOTIF);
  });

  it('le litige ouvert affiche l’état, le motif et l’échéance', () => {
    const { container } = render(
      <DisputePanel job={{ ...JOB, dispute: LITIGE }} isOwner currentUserId="client-1" />,
    );

    // La date est peinte par `toLocaleDateString` : elle se DÉRIVE de la même
    // source que le composant (l'ordre des nombres suit la locale du runner).
    const attendu = new Date(LITIGE.decision_deadline_at).toLocaleDateString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    expect(attendu).not.toBe('');
    expect(container.textContent).toContain(attendu);
    expect(screen.getByText(MOTIF)).toBeInTheDocument();
    expect(screen.getByText(/paiement gelé/i)).toBeInTheDocument();
    expect(screen.getByText(/ouvert par le client/i)).toBeInTheDocument();
  });

  it('seul l’ouvreur peut retirer le litige', () => {
    const { container: coteClient } = render(
      <DisputePanel job={{ ...JOB, dispute: LITIGE }} isOwner currentUserId="client-1" onWithdraw={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /retirer le litige/i })).toBeInTheDocument();
    coteClient.remove();

    // Le travailleur voit le désaccord (il doit savoir ce qu'on lui reproche)
    // mais pas le geste qui débloque l'argent : il a RÉPONDRE, pas retirer.
    render(
      <DisputePanel job={{ ...JOB, dispute: LITIGE }} isWorker currentUserId="worker-1" onWithdraw={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /retirer le litige/i })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: /ce que je demande/i })).toBeInTheDocument();
    expect(screen.getByText(MOTIF)).toBeInTheDocument();
  });

  it('l’autre partie envoie sa version avec la position qu’elle demande', async () => {
    const onRespond = vi.fn();
    render(
      <DisputePanel job={{ ...JOB, dispute: LITIGE }} isWorker currentUserId="worker-1" onRespond={onRespond} />,
    );

    await userEvent.click(screen.getByLabelText(/rembourser le client/i));
    await userEvent.type(screen.getByLabelText(/ma version des faits/i), `  ${REPONSE}  `);
    await userEvent.click(screen.getByRole('button', { name: /envoyer ma réponse/i }));

    expect(onRespond).toHaveBeenCalledTimes(1);
    // Le texte part nettoyé, et la position est celle du vocabulaire de la décision.
    expect(onRespond.mock.calls[0][0]).toEqual({ position: 'refund_client', note: REPONSE });
  });

  it('une réponse de moins de 20 caractères ne part pas', async () => {
    const onRespond = vi.fn();
    render(
      <DisputePanel job={{ ...JOB, dispute: LITIGE }} isWorker currentUserId="worker-1" onRespond={onRespond} />,
    );

    await userEvent.click(screen.getByLabelText(/verser le paiement au travailleur/i));
    await userEvent.type(screen.getByLabelText(/ma version des faits/i), 'Faux');

    const envoyer = screen.getByRole('button', { name: /envoyer ma réponse/i });
    expect(envoyer).toBeDisabled();
    // L'aide dit POURQUOI le bouton est mort, comme pour le motif.
    expect(screen.getByText(/le propriétaire lira les deux versions/i)).toBeInTheDocument();
    fireEvent.click(envoyer);
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('l’ouvreur ne répond pas à son propre litige : sa version, c’est le motif', () => {
    render(
      <DisputePanel job={{ ...JOB, dispute: LITIGE }} isOwner currentUserId="client-1" onRespond={vi.fn()} />,
    );

    expect(screen.queryByRole('group', { name: /ce que je demande/i })).not.toBeInTheDocument();
    expect(screen.getByText(/l’autre partie peut répondre une fois/i)).toBeInTheDocument();
  });

  it('l’ouvreur relit la réponse de l’autre partie, et garde le retrait', () => {
    render(
      <DisputePanel
        job={{
          ...JOB,
          dispute: {
            ...LITIGE,
            response: {
              position: 'release_worker',
              note: REPONSE,
              author_id: 'worker-1',
              author_role: 'worker',
              responded_at: '2026-10-22T09:00:00+00:00',
            },
          },
        }}
        isOwner
        currentUserId="client-1"
        onWithdraw={vi.fn()}
      />,
    );

    expect(screen.getByText(/réponse de l’autre partie/i)).toBeInTheDocument();
    expect(screen.getByText(/demande : verser le paiement au travailleur/i)).toBeInTheDocument();
    expect(screen.getByText(REPONSE)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /ce que je demande/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retirer le litige/i })).toBeInTheDocument();
  });

  it('un litige tranché dit la décision rendue', () => {
    render(
      <DisputePanel
        job={{
          ...JOB,
          status: 'completed',
          dispute: { ...LITIGE, state: 'resolved', decision: 'release_worker' },
        }}
        isOwner
        currentUserId="client-1"
      />,
    );

    expect(screen.getByText(/versé au travailleur/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retirer le litige/i })).not.toBeInTheDocument();
  });

  it('l’erreur du serveur est annoncée au lecteur d’écran', () => {
    render(
      <DisputePanel job={JOB} isOwner currentUserId="client-1" error="Un litige est déjà ouvert." />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Un litige est déjà ouvert.');
  });
});
