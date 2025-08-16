import React, { createContext, useState, useContext, useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const NotificationContext = createContext({});

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const [expoPushToken, setExpoPushToken] = useState('');
  const [notification, setNotification] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);

  useEffect(() => {
    registerForPushNotificationsAsync().then(token => {
      setExpoPushToken(token || '');
    });

    // Listener for notifications received while app is running
    const notificationListener = Notifications.addNotificationReceivedListener(notification => {
      setNotification(notification);
    });

    // Listener for user tapping on notifications
    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification tapped:', response);
      // Handle notification tap here
    });

    return () => {
      Notifications.removeNotificationSubscription(notificationListener);
      Notifications.removeNotificationSubscription(responseListener);
    };
  }, []);

  const registerForPushNotificationsAsync = async () => {
    let token;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#EA580C',
      });
    }

    if (Device.isDevice) {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        setPermissionGranted(false);
        return null;
      }
      
      setPermissionGranted(true);
      token = (await Notifications.getExpoPushTokenAsync()).data;
      await AsyncStorage.setItem('expo_push_token', token);
    } else {
      console.log('Must use physical device for Push Notifications');
    }

    return token;
  };

  const scheduleLocalNotification = async ({ title, body, data = {} }) => {
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: 'default',
        },
        trigger: null, // Show immediately
      });
      return { success: true, id };
    } catch (error) {
      console.error('Error scheduling notification:', error);
      return { success: false, error: error.message };
    }
  };

  const scheduleJobNotification = async (jobTitle, workerName) => {
    return await scheduleLocalNotification({
      title: 'Nouvelle proposition reçue',
      body: `${workerName} a soumis une proposition pour "${jobTitle}"`,
      data: { type: 'job_proposal' }
    });
  };

  const scheduleMessageNotification = async (senderName, message) => {
    return await scheduleLocalNotification({
      title: `Message de ${senderName}`,
      body: message.length > 50 ? `${message.substring(0, 50)}...` : message,
      data: { type: 'message' }
    });
  };

  const cancelNotification = async (notificationId) => {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
      return { success: true };
    } catch (error) {
      console.error('Error canceling notification:', error);
      return { success: false, error: error.message };
    }
  };

  const clearAllNotifications = async () => {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      await Notifications.dismissAllNotificationsAsync();
      return { success: true };
    } catch (error) {
      console.error('Error clearing notifications:', error);
      return { success: false, error: error.message };
    }
  };

  const value = {
    expoPushToken,
    notification,
    permissionGranted,
    scheduleLocalNotification,
    scheduleJobNotification,
    scheduleMessageNotification,
    cancelNotification,
    clearAllNotifications,
    registerForPushNotificationsAsync
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};