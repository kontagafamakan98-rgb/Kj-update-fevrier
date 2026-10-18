import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { notificationAPI } from '../services/api';
import { openLiveStream } from '../services/liveStream';
import { useAuth } from './AuthContext';
import { devLog, safeLog } from '../utils/env';
import { VERS_LE_BAS } from '../components/notificationPanelPlacement';

const NotificationContext = createContext();

// ── Le compteur n'est plus interrogé à l'horloge ────────────────────────────
// Chaque session connectée appelait `/notifications/unread-count` toutes les
// 30 s, soit 2 requêtes par minute et par session, pour ne rien apprendre la
// plupart du temps (mesuré : `SCALING.md` §5). Le serveur POUSSE désormais
// (/notifications/stream, voir `kojo_live.py`) : le premier événement `ready`
// porte le compteur exact, et chaque notification est ensuite annoncée.
//
// FALLBACK_POLL_MS ne sert QUE si le flux est tombé ou refusé (503, proxy qui
// tamponne, réseau). Il est délibérément BASSE FRÉQUENCE : un repli aussi
// bavard que l'ancien sondage rendrait le remplacement inutile le jour où le
// flux ne passe pas. Une seconde après la coupure, le repli relit une fois —
// l'utilisateur ne voit pas de trou — puis il se tait une minute.
const FALLBACK_POLL_MS = 60_000; // 1 minute, seulement sans flux

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
  // Identifiants DÉJÀ vus par un canal temps réel (SSE) ou push. Sans ce
  // registre, la même notification arrivée par les DEUX canaux (push du service
  // worker et flux ouvert) serait comptée deux fois : les deux événements
  // peuvent tomber dans le même rendu, et `notifications` n'est alors pas encore
  // à jour. Le registre rend la déduplication vraie même dans cette course.
  const vusRef = useRef(new Set());
  // Dernière liste connue, lue par `addLocalNotification` sans en faire une
  // dépendance : une dépendance sur `notifications` changeait l'identité de la
  // fonction à chaque liste reçue, donc ROUVRAIT le flux à chaque événement.
  const notificationsRef = useRef([]);

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

  // ----- Repli : lecture du compteur non-lus quand le flux est indisponible -----
  const pollUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await notificationAPI.getUnreadCount();
      setUnreadCount(res.unread_count ?? 0);
    } catch (_) {
      // Silencieux — un repli qui échoue ne doit pas perturber l'UI
    }
  }, [user]);

  // La liste affichée est la dernière reçue (lue hors dépendances).
  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  // Déconnexion : rien du compte précédent ne doit rester à l'écran (ni le
  // registre des identifiants vus, sinon une notification du même identifiant
  // serait ignorée après reconnexion).
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      vusRef.current.clear();
    }
  }, [user]);

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
    if (!notif?.id) return;
    // Le registre décide AVANT les setters : deux canaux (push + SSE) peuvent
    // annoncer la même ligne dans le même rendu, où `notifications` n'a pas
    // encore bougé — une comparaison sur la liste la compterait deux fois.
    const dejaVue = vusRef.current.has(notif.id);
    vusRef.current.add(notif.id);
    if (vusRef.current.size > 200) {
      // Borne : la plus ancienne entrée sort (l'ordre d'insertion est garanti).
      const plusAncienne = vusRef.current.values().next().value;
      vusRef.current.delete(plusAncienne);
    }

    // Le compteur se règle EN DEHORS de l'updater : React exige des updaters
    // purs (il les rejoue en mode strict), et un état modifié depuis l'un d'eux
    // compterait deux fois.
    const existante = notificationsRef.current.find(n => n.id === notif.id);
    setNotifications(prev => {
      const index = prev.findIndex(n => n.id === notif.id);
      if (index === -1) return [notif, ...prev];
      const suite = [...prev];
      suite[index] = { ...suite[index], ...notif };
      return suite;
    });
    if (!dejaVue && !notif.is_read && !existante?.is_read) {
      setUnreadCount(prev => prev + 1);
    }
  }, []);

  // ----- PUSH (SSE) : le temps réel remplace le sondage -----------------------
  // Le flux est ouvert UNE fois par session connectée et refermé au démontage
  // ou à la déconnexion. Tant qu'il vit, aucune requête périodique ne part :
  // c'est le serveur qui annonce. S'il tombe (ou est refusé), on relit le
  // compteur une fois tout de suite, puis à basse fréquence — le produit
  // continue de fonctionner sans flux, il ne se tait pas.
  useEffect(() => {
    if (!user) return undefined;

    let demonte = false;
    let repli = null;

    const arreterRepli = () => {
      if (repli !== null) {
        clearInterval(repli);
        repli = null;
      }
    };

    const demarrerRepli = () => {
      if (repli !== null || demonte) return;
      pollUnreadCount();
      repli = setInterval(pollUnreadCount, FALLBACK_POLL_MS);
    };

    // La liste complète se charge à l'ouverture de session : le flux ne porte
    // que le compteur et les nouvelles lignes, pas l'historique.
    fetchNotifications();

    const fermer = openLiveStream('/notifications/stream', {
      onStatus: (statut) => {
        if (demonte) return;
        if (statut === 'open') arreterRepli();
        else if (statut === 'down') demarrerRepli();
        else if (statut === 'closed') arreterRepli();
      },
      onEvent: (nom, data) => {
        if (demonte) return;
        if (nom === 'ready') {
          // État EXACT au branchement : pas besoin d'un appel de compteur.
          if (typeof data?.unread_count === 'number') setUnreadCount(data.unread_count);
          return;
        }
        if (nom === 'resync') {
          // Le flux a pris du retard (file pleine) : on relit la vérité au lieu
          // de deviner ce qui a été manqué.
          fetchNotifications();
          return;
        }
        if (nom === 'notification' && data?.notification) {
          addLocalNotification(data.notification);
          if (typeof data.unread_count === 'number') setUnreadCount(data.unread_count);
        }
      },
    });

    return () => {
      demonte = true;
      arreterRepli();
      fermer();
    };
  }, [user, fetchNotifications, pollUnreadCount, addLocalNotification]);

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
