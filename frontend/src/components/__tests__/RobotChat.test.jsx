import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RobotChat from '../RobotChat';
import { supportAPI } from '../../services/apiEndpoints';
import fr from '../../i18n/fr.json';

// Le LanguageContext n'est pas simulé : la page résout ses textes par le repli
// réel (fr.json), donc asserter un libellé échoue si la clé disparaît.
vi.mock('../../services/apiEndpoints', () => ({
  supportAPI: { robotChat: vi.fn(), createTicket: vi.fn() },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

const poser = (texte) => {
  const champ = screen.getByPlaceholderText(fr.robotChatPlaceholder);
  fireEvent.change(champ, { target: { value: texte } });
  fireEvent.keyDown(champ, { key: 'Enter' });
  return champ;
};

describe('RobotChat — plafond de dépense', () => {
  // Le backend répond 429 quand le budget journalier de l'assistant est épuisé
  // (kojo_ai_budget). Ce n'est PAS une panne : le message doit le dire dans la
  // langue du visiteur, et insister ne doit pas repartir pour un second refus.
  it('nomme le plafond et ferme la saisie, sans retirer le formulaire', async () => {
    supportAPI.robotChat.mockRejectedValue({
      response: { status: 429, data: { detail: 'plafond', bucket: 'ai-budget' } },
    });
    render(<RobotChat onBack={() => {}} />);

    poser('Comment payer une mission ?');

    expect(await screen.findByText(fr.robotChatBudgetReached)).toBeTruthy();
    expect(screen.getByPlaceholderText(fr.robotChatPlaceholder).disabled).toBe(true);
    // Le repli reste à l'écran : déposer une demande ne dépend pas de l'IA.
    expect(screen.getAllByText(fr.robotChatStartTicket).length).toBeGreaterThan(0);
  });

  // Le rate-limiter répond 429 LUI AUSSI (`bucket: support-robot`) : cette
  // limite-là se relâche en cinq minutes, donc fermer la saisie pour la journée
  // serait un mensonge — et un second refus pour rien.
  it('ne confond pas la limite de débit avec le plafond', async () => {
    supportAPI.robotChat.mockRejectedValue({
      response: { status: 429, data: { detail: 'Trop de requêtes.', bucket: 'support-robot' } },
    });
    render(<RobotChat onBack={() => {}} />);

    poser('Comment payer une mission ?');

    expect(await screen.findByText(/Trop de requêtes/)).toBeTruthy();
    expect(screen.queryByText(fr.robotChatBudgetReached)).toBeNull();
    expect(screen.getByPlaceholderText(fr.robotChatPlaceholder).disabled).toBe(false);
  });

  it('garde le message générique pour une panne ordinaire', async () => {
    supportAPI.robotChat.mockRejectedValue({ response: { status: 502 } });
    render(<RobotChat onBack={() => {}} />);

    poser('Comment payer une mission ?');

    expect(await screen.findByText(fr.supportGenericError)).toBeTruthy();
    expect(screen.queryByText(fr.robotChatBudgetReached)).toBeNull();
    expect(screen.getByPlaceholderText(fr.robotChatPlaceholder).disabled).toBe(false);
  });
});
