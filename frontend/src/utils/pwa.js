import { devLog, safeLog } from 'env';

// PWA utility functions

// Check if app is installed as PWA
export const isPWA = () => {
  return window.matchMedia('(display-mode: standalone)').matches || 
         window.navigator.standalone === true;
};

// Check if device supports PWA
export const isPWASupported = () => {
  return 'serviceWorker' in navigator && 'PushManager' in window;
};

// Request notification permission
export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) {
    devLog.info('This browser does not support notifications');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === 'granted';
};

// Show local notification
export const showNotification = (title, options = {}) => {
  if (!('Notification' in window)) {
    return;
  }

  if (Notification.permission === 'granted') {
    const defaultOptions = {
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      vibrate: [200, 100, 200],
      ...options
    };
    
    new Notification(title, defaultOptions);
  }
};

// Subscribe to push notifications
export const subscribeToPushNotifications = async () => {
  if (!isPWASupported()) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertVapidKey(process.env.REACT_APP_VAPID_PUBLIC_KEY || '')
    });
    
    return subscription;
  } catch (error) {
    safeLog.error('Failed to subscribe to push notifications:', error);
    return null;
  }
};

// Convert VAPID key for push notifications
const convertVapidKey = (vapidKey) => {
  const padding = '='.repeat((4 - vapidKey.length % 4) % 4);
  const base64 = (vapidKey + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
    
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  
  return outputArray;
};

// Get device info for PWA analytics
export const getDeviceInfo = () => {
  const userAgent = navigator.userAgent;
  const isAndroid = /Android/i.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|Opera Mini|IEMobile|WPDesktop/i.test(userAgent);
  
  return {
    isAndroid,
    isIOS,
    isMobile,
    isPWA: isPWA(),
    userAgent
  };
};

// Share functionality for mobile
export const shareContent = async (shareData) => {
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return true;
    } catch (error) {
      safeLog.error('Error sharing:', error);
      return false;
    }
  } else {
    // Fallback for browsers that don't support Web Share API
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(shareData.url || shareData.text);
      return true;
    }
    return false;
  }
};

// Add to home screen banner handling
export const handleAddToHomeScreen = () => {
  // This will be handled by the PWAInstallPrompt component
  // But we can track analytics here
  devLog.info('Add to home screen prompted');
};

// Detect if running in mobile browser
export const isMobileBrowser = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// Check network status
export const getNetworkStatus = () => {
  return {
    online: navigator.onLine,
    connection: navigator.connection || navigator.mozConnection || navigator.webkitConnection
  };
};

// PWA lifecycle events
export const onPWAInstalled = (callback) => {
  window.addEventListener('appinstalled', callback);
};

export const onPWABeforeInstall = (callback) => {
  window.addEventListener('beforeinstallprompt', callback);
};

// Cache management
export const clearPWACache = async () => {
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map(cacheName => caches.delete(cacheName))
    );
  }
};