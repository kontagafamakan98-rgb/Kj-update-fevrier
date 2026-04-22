/**
 * Network Optimizer for Kojo - West African Network Conditions
 * Adapts app behavior based on network quality, typical in West Africa
 */

import kojoCache, { CACHE_KEYS } from './cache';
import { devLog } from './env';

/**
 * Network quality levels based on West African infrastructure
 */
export const NETWORK_QUALITY = {
  EXCELLENT: 'excellent',    // 4G+, stable connection
  GOOD: 'good',             // 3G/4G, mostly stable  
  MODERATE: 'moderate',     // 2G/3G, intermittent
  POOR: 'poor',            // 2G, very slow
  OFFLINE: 'offline'       // No connection
};

/**
 * Network-aware configuration for different quality levels
 */
const NETWORK_CONFIG = {
  [NETWORK_QUALITY.EXCELLENT]: {
    imageQuality: 'high',
    cacheExpiry: 1000 * 60 * 15,     // 15 minutes
    requestTimeout: 10000,           // 10 seconds
    maxRetries: 2,
    batchSize: 20,
    enableRealtime: true,
    preloadContent: true
  },
  [NETWORK_QUALITY.GOOD]: {
    imageQuality: 'medium',
    cacheExpiry: 1000 * 60 * 30,     // 30 minutes
    requestTimeout: 15000,           // 15 seconds
    maxRetries: 3,
    batchSize: 15,
    enableRealtime: true,
    preloadContent: false
  },
  [NETWORK_QUALITY.MODERATE]: {
    imageQuality: 'low',
    cacheExpiry: 1000 * 60 * 60,     // 1 hour
    requestTimeout: 20000,           // 20 seconds
    maxRetries: 4,
    batchSize: 10,
    enableRealtime: false,
    preloadContent: false
  },
  [NETWORK_QUALITY.POOR]: {
    imageQuality: 'lowest',
    cacheExpiry: 1000 * 60 * 60 * 2, // 2 hours
    requestTimeout: 30000,           // 30 seconds
    maxRetries: 5,
    batchSize: 5,
    enableRealtime: false,
    preloadContent: false
  },
  [NETWORK_QUALITY.OFFLINE]: {
    imageQuality: 'cached',
    cacheExpiry: 1000 * 60 * 60 * 24, // 24 hours
    requestTimeout: 0,
    maxRetries: 0,
    batchSize: 0,
    enableRealtime: false,
    preloadContent: false
  }
};

class NetworkOptimizer {
  constructor() {
    this.currentQuality = NETWORK_QUALITY.GOOD;
    this.isOnline = navigator.onLine;
    this.connectionSpeed = null;
    this.lastSpeedTest = null;
    this.listeners = new Set();
    this.connectionChangeHandler = null;
    
    this.initializeMonitoring();
  }

  /**
   * Initialize network monitoring
   */
  initializeMonitoring() {
    // Online/offline detection
    window.addEventListener('online', this.handleOnline.bind(this));
    window.addEventListener('offline', this.handleOffline.bind(this));
    
    // Connection API if available (limited support)
    if ('connection' in navigator) {
      const connection = navigator.connection;
      this.connectionChangeHandler = this.handleConnectionChange.bind(this);
      connection.addEventListener('change', this.connectionChangeHandler);
      this.updateQualityFromConnection(connection);
      return;
    }

    this.assessNetworkQuality();
  }

  /**
   * Handle online event
   */
  handleOnline() {
    this.isOnline = true;
    devLog.info('🌐 Network: Back online');
    this.currentQuality = NETWORK_QUALITY.MODERATE; // Conservative assumption
    this.notifyListeners();
    
    // Sync pending data
    this.syncPendingData();
  }

  /**
   * Handle offline event
   */
  handleOffline() {
    this.isOnline = false;
    this.currentQuality = NETWORK_QUALITY.OFFLINE;
    devLog.warn('📴 Network: Gone offline');
    this.notifyListeners();
  }

  /**
   * Handle connection change (Network Information API)
   */
  handleConnectionChange(event) {
    const connection = event.target;
    this.updateQualityFromConnection(connection);
    this.notifyListeners();
  }

  /**
   * Update quality based on Connection API
   */
  updateQualityFromConnection(connection) {
    const effectiveType = connection.effectiveType;
    const downlink = connection.downlink;
    
    devLog.info(`📶 Network: ${effectiveType}, ${downlink} Mbps`);
    
    // Map effective type to quality
    switch (effectiveType) {
      case '4g':
        this.currentQuality = downlink > 2 ? NETWORK_QUALITY.EXCELLENT : NETWORK_QUALITY.GOOD;
        break;
      case '3g':
        this.currentQuality = NETWORK_QUALITY.MODERATE;
        break;
      case '2g':
        this.currentQuality = NETWORK_QUALITY.POOR;
        break;
      case 'slow-2g':
        this.currentQuality = NETWORK_QUALITY.POOR;
        break;
      default:
        this.currentQuality = NETWORK_QUALITY.MODERATE;
    }
  }

  /**
   * Assess network quality with speed test
   */
  assessNetworkQuality() {
    if (!this.isOnline) {
      this.currentQuality = NETWORK_QUALITY.OFFLINE;
      return;
    }

    if ('connection' in navigator && navigator.connection) {
      this.updateQualityFromConnection(navigator.connection);
      return;
    }

    // Fallback without timer-based speed tests to keep the main thread quiet.
    this.currentQuality = NETWORK_QUALITY.GOOD;
  }

  /**
   * Analyze response time and update quality
   */
  analyzeResponseTime(duration) {
    if (duration < 500) {
      this.currentQuality = NETWORK_QUALITY.EXCELLENT;
    } else if (duration < 1500) {
      this.currentQuality = NETWORK_QUALITY.GOOD;
    } else if (duration < 3000) {
      this.currentQuality = NETWORK_QUALITY.MODERATE;
    } else {
      this.currentQuality = NETWORK_QUALITY.POOR;
    }
  }

  /**
   * Get current network configuration
   */
  getConfig() {
    return NETWORK_CONFIG[this.currentQuality];
  }

  /**
   * Get current network quality
   */
  getQuality() {
    return this.currentQuality;
  }

  /**
   * Check if online
   */
  isNetworkOnline() {
    return this.isOnline;
  }

  /**
   * Add listener for network changes
   */
  addListener(callback) {
    this.listeners.add(callback);
    
    // Return unsubscribe function
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners
   */
  notifyListeners() {
    this.listeners.forEach(callback => {
      try {
        callback(this.currentQuality, this.isOnline);
      } catch (error) {
        devLog.warn('Network listener error:', error);
      }
    });
  }

  /**
   * Optimize image URL based on network quality
   */
  optimizeImageUrl(originalUrl, options = {}) {
    if (!originalUrl) return originalUrl;
    
    const config = this.getConfig();
    const quality = options.quality || config.imageQuality;
    
    // Add quality parameter to image URLs
    const separator = originalUrl.includes('?') ? '&' : '?';
    const qualityParam = `${separator}quality=${quality}`;
    
    return `${originalUrl}${qualityParam}`;
  }

  /**
   * Should enable real-time features
   */
  shouldEnableRealtime() {
    return this.getConfig().enableRealtime;
  }

  /**
   * Get optimal batch size for requests
   */
  getBatchSize() {
    return this.getConfig().batchSize;
  }

  /**
   * Get request timeout
   */
  getRequestTimeout() {
    return this.getConfig().requestTimeout;
  }

  /**
   * Get max retries
   */
  getMaxRetries() {
    return this.getConfig().maxRetries;
  }

  /**
   * Sync pending data when back online
   */
  async syncPendingData() {
    try {
      // Get pending actions from cache
      const pendingActions = kojoCache.get(CACHE_KEYS.PENDING_ACTIONS) || [];
      
      if (pendingActions.length === 0) return;
      
      devLog.info(`🔄 Syncing ${pendingActions.length} pending actions`);
      
      // Process pending actions
      for (const action of pendingActions) {
        try {
          await this.processPendingAction(action);
        } catch (error) {
          devLog.warn('Failed to sync action:', error);
        }
      }
      
      // Clear pending actions
      kojoCache.remove(CACHE_KEYS.PENDING_ACTIONS);
      
    } catch (error) {
      devLog.warn('Sync failed:', error);
    }
  }

  /**
   * Process individual pending action
   */
  async processPendingAction(action) {
    // Implementation depends on action type
    devLog.info('Processing pending action:', action);
    // This would integrate with your API service
  }

  /**
   * Add action to pending queue for offline processing
   */
  addPendingAction(action) {
    const pendingActions = kojoCache.get(CACHE_KEYS.PENDING_ACTIONS) || [];
    pendingActions.push({
      ...action,
      timestamp: Date.now(),
      id: `pending_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });
    
    kojoCache.set(CACHE_KEYS.PENDING_ACTIONS, pendingActions, 24 * 60 * 60 * 1000); // 24 hours
    devLog.info('Added pending action:', action);
  }

  /**
   * Get network status display
   */
  getStatusDisplay() {
    const quality = this.currentQuality;
    const emoji = {
      [NETWORK_QUALITY.EXCELLENT]: '🚀',
      [NETWORK_QUALITY.GOOD]: '📱',
      [NETWORK_QUALITY.MODERATE]: '⚡',
      [NETWORK_QUALITY.POOR]: '🐌',
      [NETWORK_QUALITY.OFFLINE]: '📴'
    };
    
    const text = {
      [NETWORK_QUALITY.EXCELLENT]: 'Excellent',
      [NETWORK_QUALITY.GOOD]: 'Bon',
      [NETWORK_QUALITY.MODERATE]: 'Modéré',
      [NETWORK_QUALITY.POOR]: 'Lent',
      [NETWORK_QUALITY.OFFLINE]: 'Hors ligne'
    };
    
    return {
      emoji: emoji[quality],
      text: text[quality],
      quality: quality
    };
  }
}

// Create singleton instance
const networkOptimizer = new NetworkOptimizer();

export default networkOptimizer;