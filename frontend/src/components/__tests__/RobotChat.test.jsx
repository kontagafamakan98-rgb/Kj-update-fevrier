import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RobotChat from '../RobotChat';
import { supportAPI } from '../../services/apiEndpoints';
import fr from '../../i18n/fr.json';

// L'assistant IA vit derrière `supportAPI.robotChat` : la doublure remplace le
// RÉSEAU (jsdom ne joint rien), jamais le composant. Le LanguageContext n'est
// pas simulé : les textes attendus viennent de src/i18n/fr.json, donc une clé
// disparue rougit ici au lieu d'afficher son nom à l'écran.
vi.mock('../../services/apiEndpoints', () => ({
  supportAPI: {
    robotChat: vi.fn(),
    createTicket: vi.fn(),
  },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

const ecrireEtEnvoyer = (champ, texte) => {
  fireEvent.change(champ, { target: { value: texte } });
  fireEvent.click(screen.getByRole('button', { name: fr.robotChatSend }));
};

describe('RobotChat — assistant IA', () => {
  beforeEach(() => {
    supportAPI.robotChat.mockReset();
    supportAPI.createTicket.mockReset();
  });

  it('ouvre le chat, et garde le questionnaire derrière une action explicite', () => {
    render(<RobotChat onBack={() => {}} />);

    expect(screen.getByPlaceholderText(fr.robotChatPlaceholder)).toBeTruthy();
    expect(screen.getByText(fr.robotChatIntro)).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(fr.robotChatStartTicket) })).toBeTruthy();
    // Le questionnaire n'est pas affiché d'emblée : sa première question est
    // absente tant que le visiteur n'a pas demandé à déposer une demande.
    expect(screen.queryByText(fr.supportQuestion1)).toBeNull();
  });

  it('envoie la question avec son historique et publie la réponse', async () => {
    supportAPI.robotChat.mockResolvedValue({ data: { reply: 'Le paiement passe par Wave.', ticket_suggested: false, model: 'claude-haiku-4-5' } });

    render(<RobotChat onBack={() => {}} />);
    ecrireEtEnvoyer(screen.getByPlaceholderText(fr.robotChatPlaceholder), 'Comment payer ?');

    await waitFor(() => expect(screen.getByText('Le paiement passe par Wave.')).toBeTruthy());
    expect(supportAPI.robotChat).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'Comment payer ?' }],
      language: 'fr',
    });

    // Deuxième tour : l'historique envoyé porte le tour précédent, donc
    // l'assistant répond avec le contexte — c'est le contrat de l'API.
    supportAPI.robotChat.mockResolvedValue({ data: { reply: 'Avec Wave ou Orange Money.', ticket_suggested: false } });
    ecrireEtEnvoyer(screen.getByPlaceholderText(fr.robotChatPlaceholder), 'Et sinon ?');

    await waitFor(() => expect(screen.getByText('Avec Wave ou Orange Money.')).toBeTruthy());
    expect(supportAPI.robotChat).toHaveBeenLastCalledWith({
      messages: [
        { role: 'user', content: 'Comment payer ?' },
        { role: 'assistant', content: 'Le paiement passe par Wave.' },
        { role: 'user', content: 'Et sinon ?' },
      ],
      language: 'fr',
    });
  });

  it('une demande suggérée par l’assistant ouvre le questionnaire', async () => {
    supportAPI.robotChat.mockResolvedValue({ data: { reply: 'Je transmets votre demande.', ticket_suggested: true } });

    render(<RobotChat onBack={() => {}} />);
    ecrireEtEnvoyer(screen.getByPlaceholderText(fr.robotChatPlaceholder), 'Mon paiement a échoué');

    await waitFor(() => expect(screen.getByText(fr.robotChatTicketHint)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(fr.robotChatStartTicket) }));

    expect(screen.getByText(fr.supportQuestion1)).toBeTruthy();
  });

  it('une panne de l’assistant laisse le dépôt d’une demande accessible', async () => {
    // La panne réelle : 503 quand le gateway n'est pas configuré, 502 quand il
    // ne répond pas (voir kojo_routers_support.robot_chat). Un 5xx fait
    // publier le repli TRADUIT par `handleApiError`, jamais la cause interne.
    supportAPI.robotChat.mockRejectedValue({
      response: { status: 503, data: { detail: 'Assistant momentanément indisponible.' } },
    });

    render(<RobotChat onBack={() => {}} />);
    ecrireEtEnvoyer(screen.getByPlaceholderText(fr.robotChatPlaceholder), 'Bonjour');

    await waitFor(() => expect(screen.getByText(fr.supportGenericError)).toBeTruthy());

    // L'impasse est interdite : le dépôt et le questionnaire restent là, même
    // quand l'assistant ne répond pas.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(fr.robotChatStartTicket) }));
    expect(screen.getByText(fr.supportQuestion1)).toBeTruthy();
  });

  it('le questionnaire dépose toujours la demande, canal « robot »', async () => {
    supportAPI.createTicket.mockResolvedValue({ data: { ticket_id: 'T-42' } });

    render(<RobotChat onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(fr.robotChatStartTicket) }));

    ecrireEtEnvoyer(screen.getByPlaceholderText(fr.supportPlaceholder1), 'Awa Diop');
    ecrireEtEnvoyer(screen.getByPlaceholderText(fr.supportPlaceholder2), '+221771234567');
    ecrireEtEnvoyer(screen.getByPlaceholderText(fr.supportPlaceholder3), 'awa@exemple.com');
    // Le motif est choisi d'un clic, puis validé par le même bouton d'envoi :
    // c'est ce que fait le questionnaire, et c'est ce que ce test protège.
    fireEvent.click(screen.getByRole('button', { name: fr.supportReason1 }));
    fireEvent.click(screen.getByRole('button', { name: fr.robotChatSend }));
    ecrireEtEnvoyer(screen.getByPlaceholderText(fr.supportPlaceholder5), 'Mon paiement a échoué hier.');

    await waitFor(() => expect(supportAPI.createTicket).toHaveBeenCalledTimes(1));
    expect(supportAPI.createTicket).toHaveBeenCalledWith({
      full_name: 'Awa Diop',
      phone: '+221771234567',
      email: 'awa@exemple.com',
      reason: fr.supportReason1,
      message: 'Mon paiement a échoué hier.',
      channel: 'robot',
    });
    expect(screen.getByText(fr.supportConfirmTitle)).toBeTruthy();
    expect(screen.getByText('T-42')).toBeTruthy();
  });

  it('revient du questionnaire au chat sans perdre la conversation', async () => {
    supportAPI.robotChat.mockResolvedValue({ data: { reply: 'Bonjour !', ticket_suggested: false } });

    render(<RobotChat onBack={() => {}} />);
    ecrireEtEnvoyer(screen.getByPlaceholderText(fr.robotChatPlaceholder), 'Bonjour');
    await waitFor(() => expect(screen.getByText('Bonjour !')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: new RegExp(fr.robotChatStartTicket) }));
    expect(screen.getByText(fr.supportQuestion1)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: fr.robotChatBackToChat }));

    expect(screen.getByText('Bonjour !')).toBeTruthy();
  });
});
