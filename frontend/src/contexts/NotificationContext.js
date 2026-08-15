import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { notificationAPI } from '../services/api';
import { useAuth } from './AuthContext';
import { devLog, safeLog } from '../utils/env';

const NotificationContext = createContext();

// Intervalle de polling pour le compteur non-lus (en ms)
const POLL_INTERVAL_MS = 30_000; // 30 secondes

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
  const openPanel = useCallback(() => {
    setIsOpen(true);
    fetchNotifications();
  }, [fetchNotifications]);

  const closePanel = useCallback(() => setIsOpen(false), []);

  const togglePanel = useCallback(() => {
    if (isOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }, [isOpen, openPanel, closePanel]);

  // ----- Actions -----
  const markAsRead = useCallback(async (notificationId) => {
    try {
      await notificationAPI.markRead(notificationId);
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      safeLog.error('Erreur markAsRead:', err);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      await notificationAPI.markAllRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
      devLog.info('Toutes les notifications marquées comme lues');
    } catch (err) {
      safeLog.error('Erreur markAllAsRead:', err);
    }
  }, []);

  const deleteNotification = useCallback(async (notificationId) => {
    const target = notifications.find(n => n.id === notificationId);
    try {
      await notificationAPI.deleteOne(notificationId);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
      if (target && !target.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      safeLog.error('Erreur deleteNotification:', err);
    }
  }, [notifications]);

  const deleteAll = useCallback(async () => {
    try {
      await notificationAPI.deleteAll();
      setNotifications([]);
      setUnreadCount(0);
    } catch (err) {
      safeLog.error('Erreur deleteAll:', err);
    }
  }, []);

  // ----- Ajouter une notification locale (ex: toast foreground push) -----
  const addLocalNotification = useCallback((notif) => {
    setNotifications(prev => [notif, ...prev]);
    if (!notif.is_read) setUnreadCount(prev => prev + 1);
  }, []);

  const value = {
    notifications,
    unreadCount,
    loading,
    isOpen,
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
