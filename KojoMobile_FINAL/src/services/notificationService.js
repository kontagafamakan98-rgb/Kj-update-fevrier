import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

class NotificationService {
  constructor() {
    this.expoPushToken = null;
    this.notificationListener = null;
    this.responseListener = null;
  }

  // Initialize notification service
  async initialize() {
    try {
      // Register for push notifications
      const token = await this.registerForPushNotificationsAsync();
      this.expoPushToken = token;

      // Store token locally
      if (token) {
        await AsyncStorage.setItem('pushToken', token);
        console.log('Push notification token saved:', token);
      }

      // Set up notification listeners
      this.setupNotificationListeners();

      return { success: true, token };
    } catch (error) {
      console.error('Failed to initialize notifications:', error);
      return { success: false, error: error.message };
    }
  }

  // Register for push notifications
  async registerForPushNotificationsAsync() {
    let token;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Kojo Notifications',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#ea580c',
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
        console.log('Failed to get push token for push notification!');
        return null;
      }
      
      token = (await Notifications.getExpoPushTokenAsync({
        projectId: 'your-project-id', // Replace with actual project ID
      })).data;
      
      console.log('Expo push token:', token);
    } else {
      console.log('Must use physical device for Push Notifications');
    }

    return token;
  }

  // Set up notification event listeners
  setupNotificationListeners() {
    // Listener for notifications received while app is foregrounded
    this.notificationListener = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
      this.handleNotificationReceived(notification);
    });

    // Listener for when user taps on or interacts with a notification
    this.responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response:', response);
      this.handleNotificationResponse(response);
    });
  }

  // Handle received notification (app in foreground)
  handleNotificationReceived(notification) {
    const { title, body, data } = notification.request.content;
    
    // You can customize behavior based on notification type
    if (data?.type === 'job_notification') {
      // Handle job-related notifications
      console.log('Job notification received:', { title, body, data });
    } else if (data?.type === 'message_notification') {
      // Handle message notifications
      console.log('Message notification received:', { title, body, data });
    }
  }

  // Handle notification tap/interaction
  handleNotificationResponse(response) {
    const { title, body, data } = response.notification.request.content;
    
    // Navigate based on notification type
    if (data?.screen) {
      // You can integrate with navigation here
      console.log('Should navigate to:', data.screen, 'with params:', data.params);
    }
  }

  // Send local notification
  async sendLocalNotification(title, body, data = {}) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: true,
        },
        trigger: null, // Send immediately
      });
      console.log('Local notification sent:', { title, body });
      return { success: true };
    } catch (error) {
      console.error('Error sending local notification:', error);
      return { success: false, error: error.message };
    }
  }

  // Schedule local notification for later
  async scheduleNotification(title, body, scheduledTime, data = {}) {
    try {
      const scheduledNotificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: true,
        },
        trigger: {
          date: scheduledTime,
        },
      });
      
      console.log('Notification scheduled:', { id: scheduledNotificationId, title, scheduledTime });
      return { success: true, id: scheduledNotificationId };
    } catch (error) {
      console.error('Error scheduling notification:', error);
      return { success: false, error: error.message };
    }
  }

  // Cancel scheduled notification
  async cancelNotification(notificationId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
      console.log('Notification cancelled:', notificationId);
      return { success: true };
    } catch (error) {
      console.error('Error cancelling notification:', error);
      return { success: false, error: error.message };
    }
  }

  // Cancel all scheduled notifications
  async cancelAllNotifications() {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      console.log('All notifications cancelled');
      return { success: true };
    } catch (error) {
      console.error('Error cancelling all notifications:', error);
      return { success: false, error: error.message };
    }
  }

  // Get notification permissions status
  async getPermissionStatus() {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      return { success: true, status };
    } catch (error) {
      console.error('Error getting permission status:', error);
      return { success: false, error: error.message };
    }
  }

  // Request notification permissions
  async requestPermissions() {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      return { success: true, status };
    } catch (error) {
      console.error('Error requesting permissions:', error);
      return { success: false, error: error.message };
    }
  }

  // Send push token to server
  async sendTokenToServer(userId, token) {
    try {
      console.log('Registering push token with server for user:', userId);
      
      // Integrate with backend API
      const api = require('./api').default;
      const response = await api.post('/users/push-token', { 
        user_id: userId, 
        push_token: token,
        device_type: Platform.OS 
      });
      
      console.log('Push token registered successfully:', response.data);
      
      // Also store locally as backup
      await AsyncStorage.setItem(`pushToken_${userId}`, token);
      
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error sending token to server:', error);
      
      // Store locally as fallback if server registration fails
      try {
        await AsyncStorage.setItem(`pushToken_${userId}`, token);
        console.log('Push token stored locally as fallback');
      } catch (storageError) {
        console.error('Failed to store token locally:', storageError);
      }
      
      return { success: false, error: error.message };
    }
  }

  // Cleanup notification listeners
  cleanup() {
    if (this.notificationListener) {
      Notifications.removeNotificationSubscription(this.notificationListener);
    }
    if (this.responseListener) {
      Notifications.removeNotificationSubscription(this.responseListener);
    }
  }

  // Helper methods for common notification types
  async notifyNewJob(jobTitle, clientName) {
    return await this.sendLocalNotification(
      'Nouveau Job Disponible',
      `${jobTitle} par ${clientName}`,
      { type: 'job_notification', screen: 'Jobs' }
    );
  }

  async notifyNewMessage(senderName, messagePreview) {
    return await this.sendLocalNotification(
      `Message de ${senderName}`,
      messagePreview,
      { type: 'message_notification', screen: 'Messages' }
    );
  }

  async notifyJobStatusUpdate(jobTitle, status) {
    const statusMessages = {
      'accepted': 'Votre proposition a été acceptée',
      'rejected': 'Votre proposition a été rejetée',
      'completed': 'Job marqué comme terminé',
      'cancelled': 'Job annulé'
    };

    return await this.sendLocalNotification(
      `Mise à jour: ${jobTitle}`,
      statusMessages[status] || `Statut mis à jour: ${status}`,
      { type: 'job_status', screen: 'Jobs' }
    );
  }
}

export default new NotificationService();