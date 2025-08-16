import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NotificationService from '../services/notificationService';
import OfflineService from '../services/offlineService';

const NotificationContext = createContext();

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pushToken, setPushToken] = useState(null);
  const [settings, setSettings] = useState({
    jobNotifications: true,
    messageNotifications: true,
    marketingNotifications: false,
    soundEnabled: true,
    vibrationEnabled: true
  });
  
  // New state for enhanced features
  const [isInitialized, setIsInitialized] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [offlineQueueSize, setOfflineQueueSize] = useState(0);

  useEffect(() => {
    initializeEnhancedServices();
    
    return () => {
      NotificationService.cleanup();
      OfflineService.cleanup();
    };
  }, []);

  const initializeEnhancedServices = async () => {
    try {
      console.log('Initializing enhanced notification and offline services...');
      
      // Load existing notification data
      await loadNotificationSettings();
      await loadNotifications();
      
      // Initialize notification service
      const notificationResult = await NotificationService.initialize();
      if (notificationResult.success) {
        setPushToken(notificationResult.token);
        console.log('✅ Push notification service initialized');
      } else {
        console.error('❌ Failed to initialize push notifications:', notificationResult.error);
      }

      // Initialize offline service
      const offlineResult = await OfflineService.initialize();
      if (offlineResult.success) {
        setIsOnline(offlineResult.isOnline);
        console.log('✅ Offline service initialized');
        
        // Set up offline service listener
        OfflineService.addListener((online, wasOnline) => {
          setIsOnline(online);
          updateOfflineState();
          
          if (!wasOnline && online) {
            // Just came back online
            addNotification({
              title: 'Connexion rétablie',
              body: 'Synchronisation des données en cours...',
              type: 'system',
              icon: 'wifi'
            });
          } else if (wasOnline && !online) {
            // Just went offline
            addNotification({
              title: 'Mode hors ligne',
              body: 'Vos actions seront synchronisées quand la connexion sera rétablie',
              type: 'system',
              icon: 'wifi-off'
            });
          }
        });
      } else {
        console.error('❌ Failed to initialize offline service:', offlineResult.error);
      }

      // Get initial permission status
      const permissionResult = await NotificationService.getPermissionStatus();
      if (permissionResult.success) {
        setPermissionStatus(permissionResult.status);
      }

      // Update offline state
      await updateOfflineState();
      
      setIsInitialized(true);
      console.log('🎉 Enhanced services initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing enhanced services:', error);
      setIsInitialized(true); // Set to true even on error to prevent infinite loading
    }
  };

  const updateOfflineState = async () => {
    const state = OfflineService.getConnectionState();
    setLastSyncTime(state.lastSyncTime);
    setOfflineQueueSize(state.queueSize);
  };

  const loadNotificationSettings = async () => {
    try {
      const savedSettings = await AsyncStorage.getItem('notificationSettings');
      if (savedSettings) {
        setSettings(JSON.parse(savedSettings));
      }
    } catch (error) {
      console.error('Error loading notification settings:', error);
    }
  };

  const saveNotificationSettings = async (newSettings) => {
    try {
      await AsyncStorage.setItem('notificationSettings', JSON.stringify(newSettings));
      setSettings(newSettings);
    } catch (error) {
      console.error('Error saving notification settings:', error);
    }
  };

  const loadNotifications = async () => {
    try {
      const savedNotifications = await AsyncStorage.getItem('notifications');
      if (savedNotifications) {
        const parsedNotifications = JSON.parse(savedNotifications);
        setNotifications(parsedNotifications);
        setUnreadCount(parsedNotifications.filter(n => !n.read).length);
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
    }
  };

  const addNotification = async (notification) => {
    const newNotification = {
      id: Date.now().toString(),
      ...notification,
      timestamp: new Date().toISOString(),
      read: false
    };

    const updatedNotifications = [newNotification, ...notifications].slice(0, 50); // Keep last 50
    setNotifications(updatedNotifications);
    setUnreadCount(prev => prev + 1);

    try {
      await AsyncStorage.setItem('notifications', JSON.stringify(updatedNotifications));
    } catch (error) {
      console.error('Error saving notification:', error);
    }

    return newNotification;
  };

  const markAsRead = async (notificationId) => {
    const updatedNotifications = notifications.map(notification =>
      notification.id === notificationId
        ? { ...notification, read: true }
        : notification
    );

    setNotifications(updatedNotifications);
    setUnreadCount(updatedNotifications.filter(n => !n.read).length);

    try {
      await AsyncStorage.setItem('notifications', JSON.stringify(updatedNotifications));
    } catch (error) {
      console.error('Error updating notification:', error);
    }
  };

  const markAllAsRead = async () => {
    const updatedNotifications = notifications.map(notification => ({
      ...notification,
      read: true
    }));

    setNotifications(updatedNotifications);
    setUnreadCount(0);

    try {
      await AsyncStorage.setItem('notifications', JSON.stringify(updatedNotifications));
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  const clearAllNotifications = async () => {
    setNotifications([]);
    setUnreadCount(0);
    
    try {
      await AsyncStorage.removeItem('notifications');
    } catch (error) {
      console.error('Error clearing notifications:', error);
    }
  };

  // Simulate receiving notifications (in real app, this would come from push notification service)
  const simulateNotification = (type = 'message') => {
    const notificationTypes = {
      message: {
        title: 'Nouveau message',
        body: 'Vous avez reçu un nouveau message',
        type: 'message',
        icon: 'message'
      },
      job: {
        title: 'Nouveau job disponible',
        body: 'Un nouveau job correspond à votre profil',
        type: 'job',
        icon: 'work'
      },
      booking: {
        title: 'Réservation confirmée',
        body: 'Votre réservation a été confirmée',
        type: 'booking',
        icon: 'check-circle'
      },
      payment: {
        title: 'Paiement reçu',
        body: 'Vous avez reçu un paiement de 15,000 XOF',
        type: 'payment',
        icon: 'payment'
      }
    };

    const notification = notificationTypes[type] || notificationTypes.message;
    addNotification(notification);
  };

  const value = {
    notifications,
    unreadCount,
    pushToken,
    settings,
    addNotification,
    markAsRead,
    markAllAsRead,
    clearAllNotifications,
    saveNotificationSettings,
    simulateNotification
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};