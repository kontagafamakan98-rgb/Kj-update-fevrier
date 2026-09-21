/**
 * Le centre de notifications : supprimer une ligne la fait DISPARAÎTRE.
 *
 * RÉGRESSION COUVERTE — signalée par l'utilisateur le 21/09/2026 : « la
 * notification apparaît mais quand je supprime, ça refuse de disparaître et
 * reste ». Trois chemins produisaient ce symptôme, chacun pour la même raison
 * (l'identifiant affiché ne désignait rien côté serveur) :
 *
 * 1. Une entrée reçue par PUSH au premier plan portait un identifiant inventé
 *    côté client (`local_<horodatage>`) : le DELETE visait le vide, répondait
 *    404, et la ligne restait à l'écran pour toujours. Le push transporte
 *    désormais l'identifiant serveur ; une entrée qui n'en a pas se marque
 *    `local` et se supprime sur place, sans requête vouée au 404.
 * 2. Un document antérieur au champ `id` recevait un NOUVEL identifiant à chaque
 *    lecture (défaut `uuid4` du modèle) : l'id affiché changeait à chaque
 *    rafraîchissement. La liste rend l'identifiant du document
 *    (`kojo_identifiants`), stable et supprimable.
 * 3. Le panneau retire la ligne AVANT de savoir si le serveur a accepté : une
 *    suppression refusée disparaissait de l'écran alors que la notification
 *    existait toujours. Elle reste maintenant affichée — l'écran ne ment pas.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// --- Doublures : le panneau est isolé du réseau, de l'auth et de l'i18n ---

const deleteOne = vi.fn();
const getAll = vi.fn();

vi.mock('../../services/api', () => ({
  notificationAPI: {
    getAll: (...args) => getAll(...args),
    getUnreadCount: vi.fn(() => Promise.resolve({ unread_count: 1 })),
    markRead: vi.fn(() => Promise.resolve({})),
    markAllRead: vi.fn(() => Promise.resolve({})),
    deleteOne: (...args) => deleteOne(...args),
    deleteAll: vi.fn(() => Promise.resolve({})),
  },
  handleApiError: (error) => (error?.message || 'Erreur'),
  safeLog: { error: vi.fn(), warn: vi.fn() },
}));

// Référence STABLE : le vrai `useAuth` rend l'objet `user` de son état, dont
// l'identité ne change pas d'un rendu à l'autre. Un objet littéral recréé à
// chaque appel relançait l'effet du provider à chaque rendu (et donc un
// rechargement en boucle) — un artefact de doublure, pas un comportement du
// produit.
const UTILISATEUR_CONNECTE = { id: 'u1', user_type: 'client' };
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: UTILISATEUR_CONNECTE }),
}));

// `t` rend la clé : les libellés restent la seule source de texte, et le test
// nomme ses cibles par la clé réellement utilisée par le composant.
vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, currentLanguage: 'fr' }),
}));

import { NotificationProvider, useNotifications } from '../../contexts/NotificationContext';
import NotificationDropdown from '../NotificationDropdown';

// Sonde : atteint les actions du contexte par la vraie API du provider.
let contexte;
function Sonde() {
  contexte = useNotifications();
  return null;
}

const rendu = () => render(
  <MemoryRouter>
    <NotificationProvider>
      <Sonde />
      <NotificationDropdown />
    </NotificationProvider>
  </MemoryRouter>,
);

const NOTIF_SERVEUR = {
  id: '68b0a1f0c3d2e4f5a6b7c8d9',
  title: 'Nouvelle proposition reçue',
  body: 'Famakan Kontaga a soumis une proposition',
  type: 'proposal_received',
  is_read: false,
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  deleteOne.mockReset().mockResolvedValue({ message: 'Notification supprimée' });
  getAll.mockReset().mockResolvedValue({
    notifications: [{ ...NOTIF_SERVEUR }],
    unread_count: 1,
    total: 1,
  });
});

afterEach(() => {
  contexte = undefined;
  vi.clearAllMocks();
});

/** Ouvre le panneau et attend la ligne chargée depuis le serveur. */
const ouvrirAvecLaLigneServeur = async () => {
  rendu();
  await waitFor(() => expect(getAll).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /notificationsTitle/ }));
  await waitFor(() => expect(screen.getByText(NOTIF_SERVEUR.title)).toBeTruthy());
};

describe('NotificationDropdown — supprimer une notification la retire de l\'écran', () => {
  it("une notification du serveur : le serveur est appelé, puis la ligne disparaît", async () => {
    await ouvrirAvecLaLigneServeur();

    fireEvent.click(screen.getByRole('button', { name: 'deleteNotification' }));

    await waitFor(() => expect(deleteOne).toHaveBeenCalledWith(NOTIF_SERVEUR.id));
    await waitFor(() => expect(screen.queryByText(NOTIF_SERVEUR.title)).toBeNull());
  });

  it("une entrée reçue par PUSH (sans contrepartie serveur) disparaît SANS requête vouée au 404", async () => {
    await ouvrirAvecLaLigneServeur();

    // Ce que fait App.js en recevant un push au premier plan sans identifiant
    // serveur : l'entrée existe à l'écran, mais aucune ligne serveur ne lui
    // correspond.
    await act(async () => {
      contexte.addLocalNotification({
        id: 'local_1758400000000',
        local: true,
        title: 'Nouvelle proposition reçue',
        body: 'Push au premier plan',
        type: 'proposal_received',
        is_read: false,
        created_at: new Date().toISOString(),
      });
    });
    await waitFor(() => expect(screen.getByText('Push au premier plan')).toBeTruthy());

    const boutons = screen.getAllByRole('button', { name: 'deleteNotification' });
    fireEvent.click(boutons[0]);

    await waitFor(() => expect(screen.queryByText('Push au premier plan')).toBeNull());
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("un push porteur de l'identifiant serveur se supprime par le serveur (plus de ligne fantôme)", async () => {
    await ouvrirAvecLaLigneServeur();
    deleteOne.mockClear();

    await act(async () => {
      contexte.addLocalNotification({
        ...NOTIF_SERVEUR,
        is_read: true,
        local: false,
      });
    });

    // Idempotent : le push ne crée pas une SECONDE ligne pour la même
    // notification — sinon la supprimer en laisserait une copie à l'écran.
    expect(screen.getAllByText(NOTIF_SERVEUR.title)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'deleteNotification' }));

    await waitFor(() => expect(deleteOne).toHaveBeenCalledWith(NOTIF_SERVEUR.id));
    await waitFor(() => expect(screen.queryByText(NOTIF_SERVEUR.title)).toBeNull());
  });

  it("si le serveur refuse, la ligne RESTE : l'écran ne ment pas sur ce qui est supprimé", async () => {
    deleteOne.mockRejectedValue(new Error('Erreur serveur'));
    await ouvrirAvecLaLigneServeur();

    fireEvent.click(screen.getByRole('button', { name: 'deleteNotification' }));

    await waitFor(() => expect(deleteOne).toHaveBeenCalled());
    expect(screen.getByText(NOTIF_SERVEUR.title)).toBeTruthy();
  });

  it("« tout supprimer » vide la liste, panneau ouvert sur son état vide", async () => {
    await ouvrirAvecLaLigneServeur();

    fireEvent.click(screen.getByTitle('deleteAll'));

    await waitFor(() => expect(screen.queryByText(NOTIF_SERVEUR.title)).toBeNull());
    expect(screen.getByText('noNotifications')).toBeTruthy();
  });
});
