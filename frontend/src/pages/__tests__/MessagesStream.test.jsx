/**
 * `/messages` branché sur le PUSH : le fil et la liste ne se relisent plus à
 * l'horloge.
 *
 * Avant ce branchement, un utilisateur qui lisait une conversation coûtait
 * 12 requêtes par minute (fil toutes les 5 s) plus 4 (liste toutes les 15 s) —
 * jusqu'à 16 requêtes par minute pour des messages qui n'arrivaient pas
 * (`SCALING.md` §5). Ce fichier mesure le remplacement :
 *
 *   • AUCUN intervalle de 5 s ni de 15 s n'est posé ;
 *   • un message poussé met à jour la LISTE sur place (aperçu, ordre) sans
 *     relire l'API ;
 *   • quand le fil est ouvert, le message déclenche UNE relecture — c'est elle
 *     qui marque les messages comme lus, donc le badge de l'autre personne ;
 *   • un flux tombé repasse à une relecture immédiate puis à 60 s (dégradé),
 *     jamais au rythme d'avant.
 *
 * Le lecteur SSE a son propre fichier (`services/__tests__/liveStream.test.js`).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const etat = vi.hoisted(() => ({ options: null, fermetures: 0 }));
vi.mock('../../services/liveStream', () => ({
  openLiveStream: (path, options) => {
    etat.options = { path, ...options };
    return () => {
      etat.fermetures += 1;
    };
  },
}));

const getConversations = vi.fn();
const getMessages = vi.fn();
const sendMessage = vi.fn();

vi.mock('../../services/apiEndpoints', () => ({
  messagesAPI: {
    getConversations: (...args) => getConversations(...args),
    getMessages: (...args) => getMessages(...args),
    sendMessage: (...args) => sendMessage(...args),
  },
}));
vi.mock('../../services/api', () => ({
  handleApiError: (error) => (error?.message || 'Erreur'),
  getAuthToken: () => '',
}));

// Référence STABLE : un objet recréé à chaque appel relancerait l'effet du
// flux à chaque rendu (et compterait un démontage de trop).
const utilisateur = vi.hoisted(() => ({ id: 'moi', user_type: 'client' }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: utilisateur }),
}));
vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, currentLanguage: 'fr' }),
}));
vi.mock('../../components/SkeletonLoader', () => ({
  MessagesSkeleton: () => null,
}));
// Le cadre de page a ses propres tests ; ici il ne doit pas cacher le contenu.
vi.mock('../../components/CadrePage', () => ({
  default: ({ children }) => <div>{children}</div>,
}));
vi.mock('../../utils/seo', () => ({ usePageTitle: () => {} }));
vi.mock('../../utils/pack2PageI18n/core', () => ({ getLocaleForLanguage: () => 'fr-FR' }));
vi.mock('../../utils/pack2PageI18n/messages', () => ({
  makeScopedTranslator: () => (key) => key,
}));

import Messages from '../Messages';

const CONVERSATION = {
  _id: 'moi_eux',
  other_user_name: 'Awa',
  last_message: 'Salut',
  last_timestamp: '2026-10-18T10:00:00Z',
  unread_count: 0,
  other_user: { id: 'eux', profile_photo: null },
};

const messageRecu = (id, contenu) => ({
  id,
  conversation_id: 'moi_eux',
  sender_id: 'eux',
  receiver_id: 'moi',
  content: contenu,
  timestamp: '2026-10-18T10:00:05Z',
  read: false,
});

const rendre = () => render(
  <MemoryRouter>
    <Messages />
  </MemoryRouter>,
);

beforeEach(() => {
  etat.options = null;
  etat.fermetures = 0;
  getConversations.mockReset().mockResolvedValue([{ ...CONVERSATION }]);
  getMessages.mockReset().mockResolvedValue([]);
  sendMessage.mockReset().mockResolvedValue({ id: 'envoye' });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('messages — le flux remplace le sondage', () => {
  it('n’installe NI le fil de 5 s NI la liste de 15 s', async () => {
    const setIntervalEspion = vi.spyOn(globalThis, 'setInterval');
    rendre();

    await screen.findByText('Awa');
    await waitFor(() => expect(etat.options).toBeTruthy());
    expect(etat.options.path).toBe('/messages/stream');
    act(() => etat.options.onStatus('open'));

    const delais = setIntervalEspion.mock.calls.map((appel) => appel[1]);
    expect(delais).not.toContain(5000);
    expect(delais).not.toContain(15000);
    // Une seule lecture initiale, puis plus rien : le flux fait le travail.
    expect(getConversations).toHaveBeenCalledTimes(1);
  });

  it('un message poussé met à jour la LISTE sur place, sans relire l’API', async () => {
    rendre();
    await screen.findByText('Awa');
    await waitFor(() => expect(etat.options).toBeTruthy());
    getConversations.mockClear();

    act(() => etat.options.onEvent('message', messageRecu('m1', 'Nouveau texte')));

    await waitFor(() => expect(screen.getByText('Nouveau texte')).toBeTruthy());
    // Rien à relire : la conversation était connue (interlocuteur, ordre,
    // compteur se déduisent de l'événement).
    expect(getConversations).not.toHaveBeenCalled();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('un message envoyé depuis un AUTRE appareil met à jour l’aperçu (sans relecture)', async () => {
    rendre();
    await screen.findByText('Awa');
    await waitFor(() => expect(etat.options).toBeTruthy());
    getConversations.mockClear();

    act(() => etat.options.onEvent('message', {
      ...messageRecu('m9', 'Envoyé depuis mon téléphone'),
      sender_id: 'moi',
      receiver_id: 'eux',
    }));

    await waitFor(() => expect(screen.getByText('Envoyé depuis mon téléphone')).toBeTruthy());
    expect(getConversations).not.toHaveBeenCalled();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('fil OUVERT : le message déclenche UNE relecture (c’est elle qui marque lu)', async () => {
    rendre();
    await screen.findByText('Awa');
    await waitFor(() => expect(etat.options).toBeTruthy());

    // Ouvrir la conversation : la liste rend le bouton de l'interlocuteur.
    fireEvent.click(screen.getByText('Awa'));
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(1));
    getMessages.mockClear();

    act(() => etat.options.onEvent('message', messageRecu('m2', 'Réponse pendant la lecture')));

    // UNE relecture du fil, à l'arrivée du message — et c'est la lecture qui
    // marque les messages reçus comme lus côté serveur.
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(1));
    expect(getMessages.mock.calls[0][0]).toBe('moi_eux');
    expect(getMessages.mock.calls[0][1]).toEqual(
      expect.objectContaining({ limit: 50, order: 'desc' })
    );
  });

  it('la conversation inconnue (premier message) fait relire la LISTE une fois', async () => {
    rendre();
    await screen.findByText('Awa');
    await waitFor(() => expect(etat.options).toBeTruthy());
    getConversations.mockClear();

    act(() => etat.options.onEvent('message', {
      ...messageRecu('m3', 'Bonjour'),
      conversation_id: 'moi_inconnu',
    }));

    await waitFor(() => expect(getConversations).toHaveBeenCalledTimes(1));
  });

  it('flux tombé : relecture immédiate puis repli à 60 s (jamais 5/15 s)', async () => {
    const setIntervalEspion = vi.spyOn(globalThis, 'setInterval');
    rendre();
    await screen.findByText('Awa');
    await waitFor(() => expect(etat.options).toBeTruthy());

    act(() => etat.options.onStatus('down'));

    await waitFor(() => expect(getConversations).toHaveBeenCalledTimes(2));
    const delais = setIntervalEspion.mock.calls.map((appel) => appel[1]);
    expect(delais).toContain(60_000);
    expect(delais).not.toContain(5000);
    expect(delais).not.toContain(15000);
  });

  it('le démontage ferme le flux', async () => {
    const { unmount } = rendre();
    await screen.findByText('Awa');
    await waitFor(() => expect(etat.options).toBeTruthy());

    unmount();

    expect(etat.fermetures).toBe(1);
  });
});
