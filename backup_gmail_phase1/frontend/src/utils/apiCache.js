/**
 * API Cache Utility for West Africa
 * Reduces API calls on slow networks by caching responses
 */

import { devLog } from './env';

const CACHE_PREFIX = 'kojo_api_cache_';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes default

class APICache {
  constructor() {
    this.memoryCache = new Map();
    this.storageAvailable = this.checkStorageAvailable();
  }

  /**
   * Check if localStorage is available
   */
  checkStorageAvailable() {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Generate cache key from URL and params
   */
  generateKey(url, params = {}) {
    const paramString = JSON.stringify(params);
    return `${CACHE_PREFIX}${url}_${paramString}`;
  }

  /**
   * Get cached data
   * @param {string} url - API endpoint URL
   * @param {Object} params - Request parameters
   * @returns {any|null} Cached data or null
   */
  get(url, params = {}) {
    const key = this.generateKey(url, params);

    // Try memory cache first (faster)
    if (this.memoryCache.has(key)) {
      const cached = this.memoryCache.get(key);
      if (this.isValid(cached)) {
        devLog.info('📦 Cache HIT (memory):', url);
        return cached.data;
      }
    }

    // Try localStorage if available
    if (this.storageAvailable) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const cached = JSON.parse(stored);
          if (this.isValid(cached)) {
            // Also store in memory cache for faster access
            this.memoryCache.set(key, cached);
            devLog.info('📦 Cache HIT (storage):', url);
            return cached.data;
          } else {
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        devLog.warn('Cache read error:', e);
      }
    }

    devLog.info('📭 Cache MISS:', url);
    return null;
  }

  /**
   * Set cache data
   * @param {string} url - API endpoint URL
   * @param {any} data - Data to cache
   * @param {Object} params - Request parameters
   * @param {number} ttl - Time to live in milliseconds
   */
  set(url, data, params = {}, ttl = DEFAULT_TTL) {
    const key = this.generateKey(url, params);
    const cached = {
      data,
      timestamp: Date.now(),
      ttl
    };

    // Always store in memory cache
    this.memoryCache.set(key, cached);

    // Try to store in localStorage if available
    if (this.storageAvailable) {
      try {
        localStorage.setItem(key, JSON.stringify(cached));
      } catch (e) {
        devLog.warn('Cache write error (quota exceeded?):', e);
        // If quota exceeded, clear old cache entries
        this.clearOldEntries();
      }
    }
  }

  /**
   * Check if cached data is still valid
   */
  isValid(cached) {
    if (!cached || !cached.timestamp || !cached.ttl) {
      return false;
    }
    const age = Date.now() - cached.timestamp;
    return age < cached.ttl;
  }

  /**
   * Clear specific cache entry
   */
  clear(url, params = {}) {
    const key = this.generateKey(url, params);
    this.memoryCache.delete(key);
    if (this.storageAvailable) {
      localStorage.removeItem(key);
    }
  }

  /**
   * Clear all cache entries
   */
  clearAll() {
    this.memoryCache.clear();
    if (this.storageAvailable) {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(CACHE_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
    }
  }

  /**
   * Clear old cache entries to free up space
   */
  clearOldEntries() {
    if (!this.storageAvailable) return;

    const keys = Object.keys(localStorage);
    const cacheKeys = keys.filter(key => key.startsWith(CACHE_PREFIX));
    
    // Remove oldest entries first
    const entries = cacheKeys.map(key => {
      try {
        const cached = JSON.parse(localStorage.getItem(key));
        return { key, timestamp: cached.timestamp || 0 };
      } catch (e) {
        return { key, timestamp: 0 };
      }
    });

    entries.sort((a, b) => a.timestamp - b.timestamp);
    
    // Remove oldest 25%
    const toRemove = Math.ceil(entries.length * 0.25);
    entries.slice(0, toRemove).forEach(entry => {
      localStorage.removeItem(entry.key);
    });
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const memorySize = this.memoryCache.size;
    let storageSize = 0;

    if (this.storageAvailable) {
      const keys = Object.keys(localStorage);
      storageSize = keys.filter(key => key.startsWith(CACHE_PREFIX)).length;
    }

    return {
      memorySize,
      storageSize,
      total: memorySize + storageSize
    };
  }

  /**
   * Wrapper for API calls with caching
   * @param {string} url - API endpoint
   * @param {Function} fetchFn - Function that performs the API call
   * @param {Object} options - Cache options
   */
  async fetch(url, fetchFn, options = {}) {
    const { params = {}, ttl = DEFAULT_TTL, forceRefresh = false, useStaleWhileRevalidate = false } = options;

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = this.get(url, params);
      if (cached !== null) {
        // If using stale-while-revalidate, return cached and refresh in background
        if (useStaleWhileRevalidate) {
          // Refresh in background
          fetchFn().then(data => {
            this.set(url, data, params, ttl);
          }).catch(() => {
            // Ignore background refresh errors
          });
        }
        return cached;
      }
    }

    // Fetch fresh data
    try {
      const data = await fetchFn();
      this.set(url, data, params, ttl);
      return data;
    } catch (error) {
      // On error, try to return stale cache if available
      const staleCache = this.get(url, params);
      if (staleCache !== null && options.returnStaleOnError) {
        devLog.warn('⚠️ Using stale cache due to error:', error.message);
        return staleCache;
      }
      throw error;
    }
  }

  /**
   * Check if user is offline
   */
  isOffline() {
    return !navigator.onLine;
  }

  /**
   * Fetch with offline support
   * Automatically returns cached data if offline
   */
  async fetchWithOfflineSupport(url, fetchFn, options = {}) {
    if (this.isOffline()) {
      const cached = this.get(url, options.params);
      if (cached !== null) {
        devLog.warn('⚠️ Using stale cache due to offline status');
        return cached;
      }
      throw new Error('Offline and no cached data available');
    }

    return this.fetch(url, fetchFn, { ...options, returnStaleOnError: true });
  }
}

// Export singleton instance
const apiCache = new APICache();
export default apiCache;

// Also export class for testing
export { APICache };
