import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-netinfo/netinfo';

class OfflineService {
  constructor() {
    this.isOnline = true;
    this.unsubscribeNetInfo = null;
    this.offlineQueue = [];
    this.listeners = [];
    this.lastSyncTime = null;
  }

  // Initialize offline service
  async initialize() {
    try {
      // Check initial connection state
      const netInfoState = await NetInfo.fetch();
      this.isOnline = netInfoState.isConnected;
      
      // Subscribe to network state changes
      this.unsubscribeNetInfo = NetInfo.addEventListener(state => {
        const wasOnline = this.isOnline;
        this.isOnline = state.isConnected;
        
        console.log('Network state changed:', {
          isConnected: state.isConnected,
          type: state.type,
          isInternetReachable: state.isInternetReachable
        });

        // Notify listeners of connection state change
        this.notifyListeners(this.isOnline, wasOnline);

        // Process offline queue when coming back online
        if (!wasOnline && this.isOnline) {
          this.processOfflineQueue();
        }
      });

      // Load offline queue from storage
      await this.loadOfflineQueue();
      
      // Load last sync time
      const lastSync = await AsyncStorage.getItem('lastSyncTime');
      this.lastSyncTime = lastSync ? new Date(lastSync) : null;

      console.log('Offline service initialized:', { 
        isOnline: this.isOnline, 
        queueSize: this.offlineQueue.length,
        lastSync: this.lastSyncTime
      });

      return { success: true, isOnline: this.isOnline };
    } catch (error) {
      console.error('Failed to initialize offline service:', error);
      return { success: false, error: error.message };
    }
  }

  // Subscribe to network state changes
  addListener(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(listener => listener !== callback);
    };
  }

  // Notify all listeners of network state change
  notifyListeners(isOnline, wasOnline) {
    this.listeners.forEach(callback => {
      try {
        callback(isOnline, wasOnline);
      } catch (error) {
        console.error('Error in network state listener:', error);
      }
    });
  }

  // Check if device is online
  getConnectionState() {
    return {
      isOnline: this.isOnline,
      lastSyncTime: this.lastSyncTime,
      queueSize: this.offlineQueue.length
    };
  }

  // Cache data locally
  async cacheData(key, data, expiry = 24 * 60 * 60 * 1000) { // 24 hours default
    try {
      const item = {
        data,
        timestamp: Date.now(),
        expiry: Date.now() + expiry
      };
      
      await AsyncStorage.setItem(`cache_${key}`, JSON.stringify(item));
      console.log('Data cached:', key);
      return { success: true };
    } catch (error) {
      console.error('Error caching data:', error);
      return { success: false, error: error.message };
    }
  }

  // Get cached data
  async getCachedData(key) {
    try {
      const itemString = await AsyncStorage.getItem(`cache_${key}`);
      if (!itemString) {
        return { success: false, error: 'Data not found' };
      }

      const item = JSON.parse(itemString);
      
      // Check if data has expired
      if (Date.now() > item.expiry) {
        await AsyncStorage.removeItem(`cache_${key}`);
        return { success: false, error: 'Data expired' };
      }

      console.log('Data retrieved from cache:', key);
      return { success: true, data: item.data, timestamp: item.timestamp };
    } catch (error) {
      console.error('Error getting cached data:', error);
      return { success: false, error: error.message };
    }
  }

  // Clear expired cache entries
  async clearExpiredCache() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(key => key.startsWith('cache_'));
      
      let clearedCount = 0;
      for (const key of cacheKeys) {
        const itemString = await AsyncStorage.getItem(key);
        if (itemString) {
          const item = JSON.parse(itemString);
          if (Date.now() > item.expiry) {
            await AsyncStorage.removeItem(key);
            clearedCount++;
          }
        }
      }

      console.log(`Cleared ${clearedCount} expired cache entries`);
      return { success: true, clearedCount };
    } catch (error) {
      console.error('Error clearing expired cache:', error);
      return { success: false, error: error.message };
    }
  }

  // Add request to offline queue
  async addToOfflineQueue(request) {
    try {
      const queueItem = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        ...request
      };

      this.offlineQueue.push(queueItem);
      await this.saveOfflineQueue();
      
      console.log('Request added to offline queue:', queueItem.id);
      return { success: true, id: queueItem.id };
    } catch (error) {
      console.error('Error adding to offline queue:', error);
      return { success: false, error: error.message };
    }
  }

  // Process offline queue when back online
  async processOfflineQueue() {
    if (!this.isOnline || this.offlineQueue.length === 0) {
      return { success: true, processed: 0 };
    }

    console.log(`Processing ${this.offlineQueue.length} offline requests...`);
    
    let processed = 0;
    let failed = 0;
    const failedRequests = [];

    for (const request of [...this.offlineQueue]) {
      try {
        // Process the request based on its type
        const result = await this.processOfflineRequest(request);
        
        if (result.success) {
          // Remove from queue on success
          this.offlineQueue = this.offlineQueue.filter(item => item.id !== request.id);
          processed++;
          console.log('Processed offline request:', request.id);
        } else {
          failedRequests.push(request);
          failed++;
          console.error('Failed to process offline request:', request.id, result.error);
        }
      } catch (error) {
        failedRequests.push(request);
        failed++;
        console.error('Error processing offline request:', request.id, error);
      }
    }

    // Save updated queue
    await this.saveOfflineQueue();
    
    // Update last sync time
    this.lastSyncTime = new Date();
    await AsyncStorage.setItem('lastSyncTime', this.lastSyncTime.toISOString());

    console.log(`Offline queue processing complete: ${processed} processed, ${failed} failed`);
    
    return { 
      success: true, 
      processed, 
      failed, 
      failedRequests: failedRequests.length 
    };
  }

  // Process individual offline request
  async processOfflineRequest(request) {
    try {
      switch (request.type) {
        case 'job_application':
          return await this.processJobApplication(request);
        case 'message_send':
          return await this.processMessageSend(request);
        case 'profile_update':
          return await this.processProfileUpdate(request);
        case 'photo_upload':
          return await this.processPhotoUpload(request);
        default:
          console.warn('Unknown offline request type:', request.type);
          return { success: false, error: 'Unknown request type' };
      }
    } catch (error) {
      console.error('Error processing offline request:', error);
      return { success: false, error: error.message };
    }
  }

  // Process job application from offline queue
  async processJobApplication(request) {
    // This would integrate with your API service
    console.log('Processing offline job application:', request.data);
    // const result = await api.post('/jobs/applications', request.data);
    return { success: true }; // Simulated success
  }

  // Process message send from offline queue
  async processMessageSend(request) {
    console.log('Processing offline message:', request.data);
    // const result = await api.post('/messages', request.data);
    return { success: true }; // Simulated success
  }

  // Process profile update from offline queue
  async processProfileUpdate(request) {
    console.log('Processing offline profile update:', request.data);
    // const result = await api.put('/users/profile', request.data);
    return { success: true }; // Simulated success
  }

  // Process photo upload from offline queue
  async processPhotoUpload(request) {
    console.log('Processing offline photo upload:', request.data);
    // const result = await api.post('/users/profile-photo', request.data);
    return { success: true }; // Simulated success
  }

  // Save offline queue to storage
  async saveOfflineQueue() {
    try {
      await AsyncStorage.setItem('offlineQueue', JSON.stringify(this.offlineQueue));
      return { success: true };
    } catch (error) {
      console.error('Error saving offline queue:', error);
      return { success: false, error: error.message };
    }
  }

  // Load offline queue from storage
  async loadOfflineQueue() {
    try {
      const queueString = await AsyncStorage.getItem('offlineQueue');
      if (queueString) {
        this.offlineQueue = JSON.parse(queueString);
        console.log('Loaded offline queue:', this.offlineQueue.length, 'items');
      }
      return { success: true };
    } catch (error) {
      console.error('Error loading offline queue:', error);
      this.offlineQueue = [];
      return { success: false, error: error.message };
    }
  }

  // Clear offline queue
  async clearOfflineQueue() {
    try {
      this.offlineQueue = [];
      await AsyncStorage.removeItem('offlineQueue');
      console.log('Offline queue cleared');
      return { success: true };
    } catch (error) {
      console.error('Error clearing offline queue:', error);
      return { success: false, error: error.message };
    }
  }

  // Sync data when coming back online
  async syncData() {
    if (!this.isOnline) {
      return { success: false, error: 'Device is offline' };
    }

    try {
      console.log('Starting data sync...');
      
      // Process offline queue
      const queueResult = await this.processOfflineQueue();
      
      // Clear expired cache
      const cacheResult = await this.clearExpiredCache();
      
      // Update last sync time
      this.lastSyncTime = new Date();
      await AsyncStorage.setItem('lastSyncTime', this.lastSyncTime.toISOString());

      console.log('Data sync completed');
      
      return {
        success: true,
        queueProcessed: queueResult.processed,
        queueFailed: queueResult.failed,
        cacheCleared: cacheResult.clearedCount || 0
      };
    } catch (error) {
      console.error('Error syncing data:', error);
      return { success: false, error: error.message };
    }
  }

  // Get offline data for specific screens
  async getOfflineJobs() {
    return await this.getCachedData('jobs');
  }

  async getOfflineMessages() {
    return await this.getCachedData('messages');
  }

  async getOfflineProfile() {
    return await this.getCachedData('profile');
  }

  // Cache data for specific screens
  async cacheJobs(jobs) {
    return await this.cacheData('jobs', jobs, 2 * 60 * 60 * 1000); // 2 hours
  }

  async cacheMessages(messages) {
    return await this.cacheData('messages', messages, 30 * 60 * 1000); // 30 minutes
  }

  async cacheProfile(profile) {
    return await this.cacheData('profile', profile, 24 * 60 * 60 * 1000); // 24 hours
  }

  // Cleanup
  cleanup() {
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
    }
    this.listeners = [];
  }
}

export default new OfflineService();