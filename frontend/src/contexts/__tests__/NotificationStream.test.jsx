/**
 * Le centre de notifications branché sur le PUSH (SSE), plus sur l'horloge.
 *
 * Ce qui est mesuré ici est le remplacement lui-même, et pas son décor :
 *   • tant que le flux vit, AUCUN appel de compteur ne part (l'ancien
 *     `setInterval` de 30 s faisait 2 requêtes par minute et par session) ;
 *   • `ready` porte le compteur EXACT — pas de sondage d'amorçage déguisé ;
 *   • une notification poussée apparaît et incrémente le badge, UNE SEULE fois
 *     même si elle arrive par deux canaux (push du service worker + flux) ;
 *   • un flux tombé bascule sur le repli : une relecture IMMÉDIATE (pas de trou
 *     visible), puis une basse fréquence — pas l'ancien rythme ;
 *   • le démontage FERME le flux (un abonné fantôme épuiserait le plafond).
 *
 * Le lecteur SSE lui-même (recollage des trames, reconnexion, 401) a son
 * propre fichier : `services/__tests__/liveStream.test.js`.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

const etat = vi.hoisted(() => ({ options: null, fermetures: 0 }));
vi.mock('../../services/liveStream', () => ({
  openLiveStream: (path, options) => {
    etat.options = { path, ...options };
    return () => {
      etat.fermetures += 1;
    };
  },
}));

const getAll = vi.fn();
const getUnreadCount = vi.fn();

vi.mock('../../services/api', () => ({
  notificationAPI: {
    getAll: (...args) => getAll(...args),
    getUnreadCount: (...args) => getUnreadCount(...args),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    deleteOne: vi.fn(),
    deleteAll: vi.fn(),
  },
  getAuthToken: () => '',
}));

const UTILISATEUR = { id: 'u1', user_type: 'client' };
vi.mock('../AuthContext', () => ({
  useAuth: () => ({ user: UTILISATEUR }),
}));

import { NotificationProvider, useNotifications } from '../NotificationContext';

let contexte;
function Sonde() {
  contexte = useNotifications();
  return null;
}

const rendre = () => render(
  <NotificationProvider>
    <Sonde />
  </NotificationProvider>,
);

const NOTIFICATION = {
  id: 'n1',
  title: 'Nouvelle proposition reçue',
  body: 'Un client a soumis une proposition',
  type: 'proposal_received',
  is_read: false,
  created_at: '2026-10-18T10:00:00Z',
};

beforeEach(() => {
  etat.options = null;
  etat.fermetures = 0;
  getAll.mockReset().mockResolvedValue({ notifications: [], unread_count: 0, total: 0 });
  getUnreadCount.mockReset().mockResolvedValue({ unread_count: 2 });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('notifications — le flux remplace le sondage', () => {
  it('ouvre le flux du compte et n’interroge JAMAIS le compteur pendant qu’il vit', async () => {
    rendre();

    await waitFor(() => expect(etat.options).toBeTruthy());
    expect(etat.options.path).toBe('/notifications/stream');
    // La liste complète se charge une fois (l'historique n'est pas dans le flux).
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    act(() => etat.options.onStatus('open'));
    act(() => etat.options.onEvent('ready', { unread_count: 4 }));

    await waitFor(() => expect(contexte.unreadCount).toBe(4));
    // L'ancien sondage aurait déjà appelé le compteur plusieurs fois.
    expect(getUnreadCount).not.toHaveBeenCalled();
  });

  it('une notification poussée s’affiche et incrémente le badge UNE seule fois', async () => {
    rendre();
    await waitFor(() => expect(etat.options).toBeTruthy());
    act(() => etat.options.onStatus('open'));
    act(() => etat.options.onEvent('ready', { unread_count: 0 }));
    await waitFor(() => expect(contexte.unreadCount).toBe(0));

    act(() => etat.options.onEvent('notification', { notification: { ...NOTIFICATION } }));

    await waitFor(() => expect(contexte.notifications.some((n) => n.id === 'n1')).toBe(true));
    await waitFor(() => expect(contexte.unreadCount).toBe(1));

    // Deuxième canal (push du service worker) pour la MÊME ligne : ni doublon
    // à l'écran, ni second incrément.
    act(() => etat.options.onEvent('notification', { notification: { ...NOTIFICATION } }));
    await act(async () => {});
    expect(contexte.notifications.filter((n) => n.id === 'n1')).toHaveLength(1);
    expect(contexte.unreadCount).toBe(1);
  });

  it('un flux tombé relit TOUT DE SUITE, puis à basse fréquence (60 s)', async () => {
    const setIntervalEspion = vi.spyOn(globalThis, 'setInterval');
    rendre();
    await waitFor(() => expect(etat.options).toBeTruthy());
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    expect(getUnreadCount).not.toHaveBeenCalled();

    act(() => etat.options.onStatus('down'));

    // Pas de trou visible : la relecture part à l'instant de la coupure…
    await waitFor(() => expect(getUnreadCount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(contexte.unreadCount).toBe(2));
    // …et le repli est une MINUTE, pas l'ancien rythme de 30 s.
    const delais = setIntervalEspion.mock.calls.map((appel) => appel[1]);
    expect(delais).toContain(60_000);
    expect(delais).not.toContain(30_000);

    // Le flux revient : le repli s'arrête.
    const clearEspion = vi.spyOn(globalThis, 'clearInterval');
    act(() => etat.options.onStatus('open'));
    expect(clearEspion).toHaveBeenCalled();
  });

  it('« resync » relit la liste au lieu de deviner ce qui a été manqué', async () => {
    rendre();
    await waitFor(() => expect(etat.options).toBeTruthy());
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    getAll.mockClear();

    act(() => etat.options.onEvent('resync', { motif: 'file_pleine' }));

    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(1));
  });

  it('le démontage ferme le flux (aucun abonné fantôme)', async () => {
    const { unmount } = rendre();
    await waitFor(() => expect(etat.options).toBeTruthy());

    unmount();

    expect(etat.fermetures).toBe(1);
  });
});
