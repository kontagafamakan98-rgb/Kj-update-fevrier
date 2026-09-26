/**
 * Le centre de notifications : UN panneau pour tout le site, et une suppression
 * qui fait VRAIMENT disparaître la ligne.
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
 *
 * QUATRIÈME CHEMIN, celui du lot suivant : la barre de navigation existe en DEUX
 * dispositions (desktop et mobile) et montait donc DEUX panneaux, chacun avec
 * son écouteur `mousedown`. L'instance dont le conteneur était masqué recevait
 * l'appui fait dans l'autre, ne le reconnaissait pas comme « intérieur », et
 * refermait le panneau PENDANT l'appui : le bouton démonté, le `click` qui suit
 * n'atteignait plus rien — supprimer ou marquer lu ne partait JAMAIS. Le
 * panneau est donc unique et rendu par portail dans le conteneur de la cloche
 * qui l'ouvre ; ces tests mesurent les deux propriétés qui en découlent (une
 * seule instance, hébergée par la barre qui l'a ouverte) et la séquence
 * d'événements réelle (`mousedown` PUIS `click`).
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
import NotificationBell from '../NotificationBell';
import NotificationPanel from '../NotificationPanel';
import MobileBottomNav from '../MobileBottomNav';
import { VERS_LE_HAUT } from '../notificationPanelPlacement';

// Sonde : atteint les actions du contexte par la vraie API du provider.
let contexte;
function Sonde() {
  contexte = useNotifications();
  return null;
}

/**
 * La composition de l'application, réduite à ce qui compte ici : les DEUX
 * cloches du site (desktop puis barre du bas, dans cet ordre — le même partage
 * que `Navbar.js` et `MobileBottomNav.js` : la barre du haut ne porte plus sa
 * cloche que dans sa disposition desktop, la barre du BAS la porte sous le
 * pouce, et c'est elle qui déclare une ouverture VERS LE HAUT) et le panneau
 * UNIQUE monté à côté, comme dans `AppRoutes`.
 *
 * Le nom du composant importé ne dit pas combien de panneaux le site en monte :
 * c'est cette composition qui le dit, et c'est donc elle que les tests doivent
 * monter. Elle doit aussi dire la VÉRITÉ du partage des barres : une doublure
 * qui recopierait une cloche de header mobile ferait passer les tests pour ce
 * que le site ne fait plus.
 */
const rendu = () => render(
  <MemoryRouter>
    <NotificationProvider>
      <Sonde />
      <nav>
        <div className="hidden md:flex"><NotificationBell /></div>
      </nav>
      <div data-mobile-bottom-nav="true">
        <NotificationBell sens={VERS_LE_HAUT} />
      </div>
      <NotificationPanel />
    </NotificationProvider>
  </MemoryRouter>,
);

const cloches = () => screen.getAllByRole('button', { name: /notificationsTitle/ });
const panneaux = () => document.querySelectorAll('[data-notification-panel]');

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
  vi.restoreAllMocks();
});

/** Ouvre le panneau (par la PREMIÈRE cloche) et attend la ligne du serveur. */
const ouvrirAvecLaLigneServeur = async () => {
  rendu();
  await waitFor(() => expect(getAll).toHaveBeenCalled());
  fireEvent.click(cloches()[0]);
  await waitFor(() => expect(screen.getByText(NOTIF_SERVEUR.title)).toBeTruthy());
};

describe('centre de notifications — supprimer une notification la retire de l\'écran', () => {
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
    fireEvent.click(cloches()[0]);
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
describe('centre de notifications — un échec se voit, et un 404 ne bloque plus la ligne', () => {
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
    // La suppression est VÉRIFIÉE, pas supposée : le serveur a été relu.
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
 * UN PANNEAU, DEUX CLOCHES — et l'appui qui va jusqu'au bout.
 *
 * La barre de navigation existe en deux dispositions parce que la cloche doit
 * exister dans les deux ; le panneau, lui, n'a aucune raison d'être dupliqué, et
 * l'être était le défaut : chaque instance écoutait `mousedown` sur le document,
 * donc un appui dans le panneau visible n'était « à l'intérieur » que pour UNE
 * instance — l'autre appelait `closePanel()`, le panneau se démontait PENDANT
 * l'appui, et le `click` n'atteignait plus le bouton. `page.click()` et un doigt
 * envoient `mousedown` PUIS `click` : un test qui n'enverrait qu'un `click`
 * isolé ne peut pas voir ce défaut, et c'est pourquoi la séquence est rejouée
 * ici telle que le navigateur l'émet.
 *
 * Les deux propriétés mesurées :
 *   1. le nombre de panneaux du document ne dépend PAS du nombre de cloches ;
 *   2. le panneau est rendu DANS le conteneur de la cloche qui l'a ouvert — donc
 *      sous la bonne barre, sans une seule mesure de coordonnées.
 */
describe('centre de notifications — un seul panneau, deux cloches', () => {
  /** Un clic RÉEL : l'appui puis le relâchement, comme le fait le navigateur. */
  const clicReel = (element) => {
    fireEvent.mouseDown(element);
    fireEvent.click(element);
  };

  it("deux barres montées, mais UN seul panneau dans le document", async () => {
    rendu();
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    expect(cloches()).toHaveLength(2);

    clicReel(cloches()[0]);

    await waitFor(() => expect(panneaux()).toHaveLength(1));
    expect(panneaux()).toHaveLength(1);
  });

  it("le panneau est hébergé par la barre qui l'a ouvert (la cloche de la barre du bas)", async () => {
    rendu();
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    // La SECONDE cloche est celle de la barre mobile : c'est elle qui ouvre.
    clicReel(cloches()[1]);
    await waitFor(() => expect(panneaux()).toHaveLength(1));

    const panneau = panneaux()[0];
    const heberge = cloches().filter((cloche) => panneau.parentElement.contains(cloche));

    expect(heberge).toHaveLength(1);
    expect(heberge[0]).toBe(cloches()[1]);
  });

  it("l'appui dans le panneau atteint son bouton : la ligne est supprimée par le serveur", async () => {
    rendu();
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    clicReel(cloches()[0]);
    await waitFor(() => expect(screen.getByText(NOTIF_SERVEUR.title)).toBeTruthy());

    clicReel(screen.getByRole('button', { name: 'deleteNotification' }));

    await waitFor(() => expect(deleteOne).toHaveBeenCalledWith(NOTIF_SERVEUR.id));
  });

  it("l'appui sur une ligne atteint sa ligne : elle est marquée lue", async () => {
    rendu();
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    clicReel(cloches()[0]);
    await waitFor(() => expect(screen.getByText(NOTIF_SERVEUR.title)).toBeTruthy());

    clicReel(screen.getByRole('button', { name: `${NOTIF_SERVEUR.title}: ${NOTIF_SERVEUR.body}` }));

    await waitFor(() => expect(markRead).toHaveBeenCalledWith(NOTIF_SERVEUR.id));
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("l'appui sur la cloche pendant que le panneau est ouvert le REFERME (pas de réouverture)", async () => {
    rendu();
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    clicReel(cloches()[0]);
    await waitFor(() => expect(panneaux()).toHaveLength(1));

    // L'appui sur la cloche ne doit pas être pris pour un clic « extérieur » :
    // le panneau se fermerait sur le `mousedown`, et le `click` qui suit
    // rouvrirait un panneau que l'utilisateur venait de fermer.
    clicReel(cloches()[0]);

    await waitFor(() => expect(panneaux()).toHaveLength(0));
  });

  it("un appui hors de la barre ferme le panneau", async () => {
    rendu();
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    clicReel(cloches()[0]);
    await waitFor(() => expect(panneaux()).toHaveLength(1));

    clicReel(document.body);

    await waitFor(() => expect(panneaux()).toHaveLength(0));
  });

  it("si la barre qui héberge le panneau cesse d'être affichée, il se ferme", async () => {
    rendu();
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    clicReel(cloches()[0]);
    await waitFor(() => expect(panneaux()).toHaveLength(1));

    // jsdom ne calcule aucune mise en page : `getClientRects()` y est TOUJOURS
    // vide, ce qui est justement l'état « masquée » que le composant teste. On
    // ne simule donc pas un franchissement de point de rupture — on déclenche
    // l'événement dont ce franchissement s'accompagne, et on exige la décision.
    // Le franchissement réel (barre desktop → mobile) est mesuré dans un vrai
    // Chromium par frontend/e2e/notifications.spec.js.
    window.dispatchEvent(new Event('resize'));

    await waitFor(() => expect(panneaux()).toHaveLength(0));
  });
});

/**
 * LE SENS D'OUVERTURE EST DÉCLARÉ PAR LA CLOCHE QUI OUVRE.
 *
 * Le panneau est UN et ne sait pas quelle barre l'héberge : il tombe sur le
 * bord droit de son conteneur (`absolute right-0`), et rien de ce conteneur ne
 * dit de quel CÔTÉ il doit s'ouvrir. C'est une DÉCLARATION de la cloche — vers
 * le bas sous la barre du haut (la page est là), vers le HAUT au-dessus de la
 * barre du bas (collée au bas de l'écran, un panneau qui descendrait sortirait
 * de la fenêtre). jsdom ne calcule aucune mise en page : ce qui se vérifie ici
 * est que la bonne classe d'ancrage part du bon déclencheur, et que chacune
 * exclut l'autre. Le FAIT — le panneau réellement peint au-dessus de la barre
 * du bas — se mesure dans Chromium (`e2e/notifications.spec.js`).
 */
describe("centre de notifications — le sens d'ouverture est déclaré par la cloche", () => {
  const clicReel = (element) => {
    fireEvent.mouseDown(element);
    fireEvent.click(element);
  };
  const panneau = () => document.querySelector('[data-notification-panel]');

  it("la barre du haut ouvre vers le bas, la barre du bas vers le haut — et le sens suit la cloche ouverte", async () => {
    rendu();
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    // 1. La cloche qui ne déclare RIEN : l'ouverture historique, sous elle.
    clicReel(cloches()[0]);
    await waitFor(() => expect(panneau()).toBeTruthy());
    expect(panneau().classList.contains('mt-2')).toBe(true);
    expect(panneau().classList.contains('bottom-full')).toBe(false);
    // Le bord droit reste du côté de la cloche, quel que soit le sens.
    expect(panneau().classList.contains('right-0')).toBe(true);

    // Refermer, puis ouvrir par l'autre barre : le sens doit SUIVRE la cloche
    // qui ouvre, et pas rester celui de la précédente.
    clicReel(cloches()[0]);
    await waitFor(() => expect(panneau()).toBeNull());

    clicReel(cloches()[1]);
    await waitFor(() => expect(panneau()).toBeTruthy());
    expect(panneau().classList.contains('bottom-full')).toBe(true);
    expect(panneau().classList.contains('mt-2')).toBe(false);
  });

  it("la barre du bas porte la cloche, avec une colonne de plus dans sa grille", async () => {
    render(
      <MemoryRouter>
        <NotificationProvider>
          <MobileBottomNav />
          <NotificationPanel />
        </NotificationProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(getAll).toHaveBeenCalled());

    // Un seul déclencheur dans cette barre, et c'est celui du centre.
    const cloche = screen.getByRole('button', { name: /notificationsTitle/ });

    // La grille suit le nombre d'items : cinq avec la cloche, quatre sans elle.
    // Ajouter l'item sans élargir la grille ferait passer le cinquième sur une
    // SECONDE ligne — la barre doublerait de hauteur, et rien ne le dirait.
    const grille = cloche.closest('.grid');
    expect(grille).toBeTruthy();
    expect(grille.className).toContain('grid-cols-5');

    clicReel(cloche);
    await waitFor(() => expect(panneau()).toBeTruthy());

    // Le panneau est hébergé par la cloche de la barre du BAS…
    expect(panneau().parentElement.contains(cloche)).toBe(true);
    // …et il s'ouvre VERS LE HAUT : sous la barre du bas, il n'y a plus d'écran.
    expect(panneau().classList.contains('bottom-full')).toBe(true);
  });
});
