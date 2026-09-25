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
const deleteAll = vi.fn();
const markAllRead = vi.fn();
const markRead = vi.fn();
const getAll = vi.fn();

vi.mock('../../services/api', () => ({
  notificationAPI: {
    getAll: (...args) => getAll(...args),
    getUnreadCount: vi.fn(() => Promise.resolve({ unread_count: 1 })),
    markRead: (...args) => markRead(...args),
    markAllRead: (...args) => markAllRead(...args),
    deleteOne: (...args) => deleteOne(...args),
    deleteAll: (...args) => deleteAll(...args),
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
  deleteAll.mockReset().mockResolvedValue({ message: '0 notification(s) supprimée(s)' });
  markAllRead.mockReset().mockResolvedValue({ message: '0 notification(s) marquée(s) comme lue(s)' });
  markRead.mockReset().mockResolvedValue({ message: 'Notification marquée comme lue' });
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

    // Deux appuis : le premier ARME, le second exécute (action destructrice et
    // sans retour — un seul geste ne doit pas effacer le centre).
    fireEvent.click(screen.getByTitle('deleteAll'));
    await waitFor(() => expect(screen.getByTitle('confirmDeleteAll')).toBeTruthy());
    expect(deleteAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('confirmDeleteAll'));

    await waitFor(() => expect(deleteAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(NOTIF_SERVEUR.title)).toBeNull());
    expect(screen.getByText('noNotifications')).toBeTruthy();
  });

  it("« tout supprimer » armé puis abandonné n'efface RIEN", async () => {
    await ouvrirAvecLaLigneServeur();

    fireEvent.click(screen.getByTitle('deleteAll'));
    await waitFor(() => expect(screen.getByTitle('confirmDeleteAll')).toBeTruthy());

    // On referme le panneau : l'armement ne survit pas à un changement d'écran.
    fireEvent.click(screen.getByRole('button', { name: 'closeNotif' }));
    fireEvent.click(screen.getByRole('button', { name: /notificationsTitle/ }));
    await waitFor(() => expect(screen.getByText(NOTIF_SERVEUR.title)).toBeTruthy());

    expect(deleteAll).not.toHaveBeenCalled();
    expect(screen.getByTitle('deleteAll')).toBeTruthy();
  });
});

// Le second volet du défaut : une suppression qui échoue ne disait RIEN. Il y a
// deux échecs de nature opposée, et ils ne se traitent pas pareil —
//   403/500 : le serveur REFUSE, la ligne existe encore, elle reste et l'échec
//             se voit, avec de quoi le rejouer ;
//   404     : le serveur n'a PLUS la ligne, aucune tentative ne peut réussir —
//             l'identifiant d'un push dont l'enregistrement a échoué, une ligne
//             déjà supprimée d'un autre appareil. La garder la rendait
//             insupprimable à vie.
describe('NotificationDropdown — un échec se voit, et un 404 ne bloque plus la ligne', () => {
  const erreur = (status) => {
    const e = new Error(status === 404 ? 'Notification introuvable' : 'Erreur serveur');
    e.response = { status, data: { detail: e.message } };
    return e;
  };

  /** Ce que la LISTE du serveur contient : le 404 doit se vérifier par une relecture. */
  const servirLaListe = (contientLaLigne) => {
    getAll.mockImplementation(() => Promise.resolve(
      contientLaLigne
        ? { notifications: [{ ...NOTIF_SERVEUR }], unread_count: 1, total: 1 }
        : { notifications: [], unread_count: 0, total: 0 }
    ));
  };

  it("404 : la reliste confirme que la ligne n'existe plus → elle part, et rien n'est signalé", async () => {
    servirLaListe(true);
    deleteOne.mockRejectedValue(erreur(404));
    await ouvrirAvecLaLigneServeur();

    // Le serveur a « oublié » la ligne : c'est ce que dit son 404.
    getAll.mockClear();
    servirLaListe(false);
    fireEvent.click(screen.getByRole('button', { name: 'deleteNotification' }));

    await waitFor(() => expect(screen.queryByText(NOTIF_SERVEUR.title)).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('noNotifications')).toBeTruthy();
    // La suppression est VÉRIFIÉE, pas supposée : le server a été relu.
    await waitFor(() => expect(getAll).toHaveBeenCalled());
  });

  it("404 mais le serveur la liste ENCORE : la ligne revient, l'écran ne ment pas", async () => {
    servirLaListe(true);
    deleteOne.mockRejectedValue(erreur(404));
    await ouvrirAvecLaLigneServeur();

    getAll.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'deleteNotification' }));

    // La relecture retrouve la ligne (l'identifiant affiché ne désigne pas la
    // bonne ligne côté serveur) : c'est un défaut à corriger ailleurs, et
    // l'écran le dit au lieu de faire croire à une suppression.
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(NOTIF_SERVEUR.title)).toBeTruthy());
  });

  it("500 : la ligne RESTE, l'échec est visible, et le réessai la supprime", async () => {
    deleteOne.mockRejectedValue(erreur(500));
    await ouvrirAvecLaLigneServeur();

    fireEvent.click(screen.getByRole('button', { name: 'deleteNotification' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('notifDeleteFailed')).toBeTruthy();
    expect(screen.getByText(NOTIF_SERVEUR.title)).toBeTruthy();

    // Le serveur accepte enfin : le réessai aboutit et la ligne part.
    deleteOne.mockResolvedValue({ message: 'Notification supprimée' });
    fireEvent.click(screen.getByText('retry'));

    await waitFor(() => expect(screen.queryByText(NOTIF_SERVEUR.title)).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("un « tout marquer comme lu » refusé le dit, au lieu de ne rien faire", async () => {
    markAllRead.mockRejectedValue(erreur(500));
    await ouvrirAvecLaLigneServeur();

    fireEvent.click(screen.getByTitle('markAllRead'));

    await waitFor(() => expect(screen.getByText('notifMarkAllFailed')).toBeTruthy());
  });
});

/**
 * LA BARRE DE NAVIGATION MONTE DEUX FOIS LE PANNEAU, et l'instance cachée
 * fermait celui de l'autre : aucun clic DANS le panneau n'atteignait son bouton.
 *
 * `Navbar.js` rend `<NotificationDropdown />` deux fois — barre desktop
 * (`hidden md:flex`) et barre mobile (`md:hidden`) — parce que la cloche doit
 * exister dans deux dispositions. L'ouverture est un état PARTAGÉ (le contexte),
 * donc les DEUX instances rendent leur panneau ; l'une des deux vit dans un
 * conteneur `display:none`.
 *
 * Chaque instance écoute `mousedown` sur le document pour se refermer au clic
 * extérieur. Un clic de l'utilisateur dans le panneau visible n'est « à
 * l'intérieur » que pour UNE instance : pour l'autre, sa propre référence de
 * panneau ne contient pas la cible → elle appelle `closePanel()`. Le panneau se
 * démonte donc PENDANT le `mousedown`, et le `click` qui suit n'atteint plus le
 * bouton : supprimer ou marquer lu ne partait jamais — la notification restait à
 * l'écran, sans requête et sans un mot. C'est le symptôme « ça refuse de
 * disparaître », et c'est ce que ce test mesure.
 *
 * Pourquoi le trou n'était pas couvert : les tests précédents n'envoyaient
 * qu'un `click` isolé. Un doigt ou une souris envoie `mousedown` PUIS `click`
 * (c'est l'appui — pas le relâchement — que le panneau écoute).
 */
describe('NotificationDropdown — deux instances (barres desktop + mobile)', () => {
  const renduDouble = () => render(
    <MemoryRouter>
      <NotificationProvider>
        <Sonde />
        <div className="hidden md:flex"><NotificationDropdown /></div>
        <div className="md:hidden"><NotificationDropdown /></div>
      </NotificationProvider>
    </MemoryRouter>,
  );

  /** Un clic RÉEL : l'appui puis le relâchement, comme le fait le navigateur. */
  const clicReel = (element) => {
    fireEvent.mouseDown(element);
    fireEvent.click(element);
  };

  it("l'appui dans le panneau visible atteint son bouton : la ligne est supprimée par le serveur", async () => {
    renduDouble();
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    clicReel(screen.getAllByRole('button', { name: /notificationsTitle/ })[0]);
    await waitFor(() => expect(screen.getAllByText(NOTIF_SERVEUR.title).length).toBeGreaterThan(0));

    clicReel(screen.getAllByRole('button', { name: 'deleteNotification' })[0]);

    await waitFor(() => expect(deleteOne).toHaveBeenCalledWith(NOTIF_SERVEUR.id));
  });

  it("l'appui sur une ligne atteint sa ligne : elle est marquée lue", async () => {
    renduDouble();
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    clicReel(screen.getAllByRole('button', { name: /notificationsTitle/ })[0]);
    await waitFor(() => expect(screen.getAllByText(NOTIF_SERVEUR.title).length).toBeGreaterThan(0));

    // Un appui sur la ligne marque la notification lue (et naviguerait vers la
    // mission si elle en portait une) : c'est la preuve que l'appui est arrivé.
    const ligne = screen.getAllByRole('button', { name: `${NOTIF_SERVEUR.title}: ${NOTIF_SERVEUR.body}` })[0];
    clicReel(ligne);

    await waitFor(() => expect(markRead).toHaveBeenCalledWith(NOTIF_SERVEUR.id));
    expect(deleteOne).not.toHaveBeenCalled();
  });
});
