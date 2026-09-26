import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { notificationAPI } from '../services/api';
import { useAuth } from './AuthContext';
import { devLog, safeLog } from '../utils/env';
import { VERS_LE_BAS } from '../components/notificationPanelPlacement';

const NotificationContext = createContext();

// Intervalle de polling pour le compteur non-lus (en ms)
const POLL_INTERVAL_MS = 30_000; // 30 secondes

/**
 * Le serveur dit-il « je n'ai pas cette ligne » (404) ?
 *
 * C'est la distinction qui décide si une notification est SUPPRIMABLE. Une
 * panne (5xx, 403, réseau) est une demande refusée : la ligne existe encore
 * là-bas, la retirer de l'écran mentirait — elle reste, et l'utilisateur la
 * voit échouer (voir `actionError`). Un 404 dit l'inverse : il n'y a PLUS de
 * ligne serveur à atteindre, donc réessayer ne peut pas réussir — c'est
 * exactement la ligne qui « refuse de disparaître » (identifiant d'un push dont
 * l'enregistrement a échoué, document d'un ancien compte, ligne déjà supprimée
 * depuis un autre appareil). La garder à l'écran la rendrait insupprimable à
 * vie : on l'enlève, et un rafraîchissement de la liste ne la ramènera pas.
 */
const ligneAbsenteDuServeur = (erreur) => erreur?.response?.status === 404;

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  // Le CONTENEUR de la cloche qui a ouvert le panneau. Le centre de
  // notifications est UN pour tout le site (monté dans App.js) alors qu'il
  // existe deux cloches (barres desktop et mobile) : le panneau doit donc
  // savoir SOUS LAQUELLE s'afficher. C'est cette ancre que le portail de
  // NotificationPanel.js prend pour cible, ce qui garde son ancrage CSS
  // (`absolute right-0 mt-2`) sans mesurer un seul pixel. Nulle quand rien
  // n'est ouvert — le panneau n'a alors pas de domicile, donc pas de rendu.
  const [ancre, setAncre] = useState(null);
  // Le SENS dans lequel le panneau s'ouvre, déclaré par la cloche qui l'a
  // ouvert (barre du haut → vers le bas, barre du bas → vers le haut). Le
  // contexte le transporte comme il transporte l'ancre : le panneau est UN et
  // ne sait pas quelle barre l'héberge, donc la cloche le lui DIT au lieu de le
  // lui faire mesurer. Défaut : la disposition historique (ouverture vers le
  // bas), pour qu'une cloche qui ne déclare rien garde le dessin d'origine.
  const [sens, setSens] = useState(VERS_LE_BAS);
  // La DERNIÈRE action refusée par le serveur, telle qu'elle sera montrée :
  // quelle action, sur quelle ligne, et de quoi la rejouer. Une action qui
  // échoue en silence laissait l'utilisateur devant une liste qui ne bouge
  // pas, sans savoir s'il a mal visé ou si le serveur a refusé.
  const [actionError, setActionError] = useState(null);
  const pollRef = useRef(null);

  // ----- Chargement de toutes les notifications -----
  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await notificationAPI.getAll({ limit: 50 });
      setNotifications(res.notifications || []);
      setUnreadCount(res.unread_count ?? 0);
    } catch (err) {
      safeLog.error('Erreur chargement notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // ----- Polling léger du compteur non-lus -----
  const pollUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await notificationAPI.getUnreadCount();
      setUnreadCount(res.unread_count ?? 0);
    } catch (_) {
      // Silencieux — ne pas perturber l'UI pour un polling
    }
  }, [user]);

  // Démarre / arrête le polling selon la présence d'un utilisateur connecté
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    fetchNotifications();
    pollRef.current = setInterval(pollUnreadCount, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user, fetchNotifications, pollUnreadCount]);

  // ----- Ouvrir le panneau → marquer le fetch comme frais -----
  const openPanel = useCallback((conteneur, sensDeclare) => {
    setIsOpen(true);
    setAncre(conteneur || null);
    // Le sens suit l'ancre : c'est la même cloche qui donne les deux, donc un
    // panneau ouvert par la barre du bas ne peut pas s'ouvrir vers le bas même
    // si la cloche précédente avait déclaré l'inverse.
    setSens(sensDeclare || VERS_LE_BAS);
    fetchNotifications();
  }, [fetchNotifications]);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    setAncre(null);
  }, []);

  const togglePanel = useCallback((conteneur, sensDeclare) => {
    if (isOpen) {
      closePanel();
    } else {
      openPanel(conteneur, sensDeclare);
    }
  }, [isOpen, openPanel, closePanel]);

  // ----- Actions -----
  // Une entrée `local: true` n'a PAS de contrepartie serveur (son identifiant
  // est inventé côté client). Lui envoyer un PUT/DELETE voué au 404 la laisserait
  // à l'écran pour toujours — c'est le symptôme « je supprime, ça refuse de
  // disparaître ». Ces actions s'appliquent donc localement, sans requête.
  const markAsRead = useCallback(async (notificationId) => {
    const target = notifications.find(n => n.id === notificationId);
    const marquerLue = () => {
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
      if (target && !target.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    };
    try {
      if (!target?.local) {
        await notificationAPI.markRead(notificationId);
      }
      marquerLue();
    } catch (err) {
      // Même règle que la suppression : rien à marquer côté serveur (404) →
      // l'état local suit. Autrement la demande a échoué pour de vrai, et le
      // « non lu » reste affiché plutôt que de mentir.
      if (ligneAbsenteDuServeur(err)) {
        marquerLue();
      } else {
        safeLog.error('Erreur markAsRead:', err);
      }
    }
  }, [notifications]);

  const markAllAsRead = useCallback(async () => {
    try {
      await notificationAPI.markAllRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
      setActionError(null);
      devLog.info('Toutes les notifications marquées comme lues');
    } catch (err) {
      safeLog.error('Erreur markAllAsRead:', err);
      setActionError({ action: 'markAllRead' });
    }
  }, []);

  // Retire la ligne de l'écran, et décrémente le compteur SEULEMENT si elle
  // était non lue — le compteur est recalculé à chaque lecture de liste, mais
  // il doit rester juste entre deux rafraîchissements.
  const retirerDeLEcran = useCallback((notificationId) => {
    const target = notifications.find(n => n.id === notificationId);
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
    if (target && !target.is_read) {
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
  }, [notifications]);

  const deleteNotification = useCallback(async (notificationId) => {
    const target = notifications.find(n => n.id === notificationId);
    try {
      if (!target?.local) {
        await notificationAPI.deleteOne(notificationId);
      }
      retirerDeLEcran(notificationId);
      setActionError(null);
    } catch (err) {
      if (ligneAbsenteDuServeur(err)) {
        // Il n'y a plus rien à supprimer là-bas : la ligne part pour de bon.
        retirerDeLEcran(notificationId);
        setActionError(null);
        // …et on RELIT la liste : c'est la seule façon de savoir si la ligne a
        // vraiment disparu du serveur. Si elle y est encore (l'identifiant
        // affiché ne désigne pas la bonne ligne — un `id` numérique importé,
        // par exemple), elle revient à l'écran : l'affichage suit le serveur,
        // il ne prétend pas avoir supprimé ce qui existe toujours.
        fetchNotifications();
        return;
      }
      // Le serveur a REFUSÉ : la ligne est toujours là-bas, la retirer ferait
      // croire à une suppression qui n'a pas eu lieu. Elle reste, et l'échec
      // devient visible avec de quoi le rejouer.
      safeLog.error('Erreur deleteNotification:', err);
      setActionError({ action: 'delete', notificationId });
    }
  }, [notifications, retirerDeLEcran, fetchNotifications]);

  const deleteAll = useCallback(async () => {
    try {
      await notificationAPI.deleteAll();
      setNotifications([]);
      setUnreadCount(0);
      setActionError(null);
    } catch (err) {
      safeLog.error('Erreur deleteAll:', err);
      setActionError({ action: 'deleteAll' });
    }
  }, []);

  const clearActionError = useCallback(() => setActionError(null), []);

  /** Rejoue la dernière action refusée — c'est le bouton « Réessayer ». */
  const retryLastAction = useCallback(async () => {
    const echec = actionError;
    if (!echec) return;
    setActionError(null);
    if (echec.action === 'delete') return deleteNotification(echec.notificationId);
    if (echec.action === 'deleteAll') return deleteAll();
    if (echec.action === 'markAllRead') return markAllAsRead();
    return undefined;
  }, [actionError, deleteNotification, deleteAll, markAllAsRead]);

  // ----- Ajouter une entrée reçue par push (ex: foreground) -----
  // Idempotent par identifiant : un push rejoué (ou déjà présent dans la liste
  // serveur) remplace l'entrée existante au lieu d'en créer une deuxième, sinon
  // supprimer la ligne en laisserait une copie à l'écran.
  const addLocalNotification = useCallback((notif) => {
    // Le compteur se règle EN DEHORS de l'updater : React exige des updaters
    // purs (il les rejoue en mode strict), et un état modifié depuis l'un d'eux
    // compterait deux fois.
    const existante = notifications.find(n => n.id === notif.id);
    setNotifications(prev => {
      const index = prev.findIndex(n => n.id === notif.id);
      if (index === -1) return [notif, ...prev];
      const suite = [...prev];
      suite[index] = { ...suite[index], ...notif };
      return suite;
    });
    if (!notif.is_read && !existante?.is_read) {
      setUnreadCount(prev => prev + 1);
    }
  }, [notifications]);

  const value = {
    notifications,
    unreadCount,
    loading,
    isOpen,
    ancre,
    sens,
    actionError,
    clearActionError,
    retryLastAction,
    openPanel,
    closePanel,
    togglePanel,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteAll,
    addLocalNotification,
    refresh: fetchNotifications,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export default NotificationContext;
