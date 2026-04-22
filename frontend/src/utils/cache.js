import { devLog, safeLog } from './env';

/**
 * Advanced Caching System for Kojo - Optimized for West African Networks
 * Handles slow connections, intermittent connectivity, and data optimization
 */

const CACHE_VERSION = '1.0.0';
const CACHE_EXPIRY_TIME = 1000 * 60 * 30; // 30 minutes default
const CRITICAL_DATA_EXPIRY = 1000 * 60 * 60 * 24; // 24 hours for critical data

/**
 * Smart cache with compression for West African networks
 */
class KojoCache {
  constructor() {
    this.namespace = 'kojo_cache_';
    this.compressionEnabled = this.supportsCompression();
  }

  /**
   * Check if browser supports compression
   */
  supportsCompression() {
    try {
      return typeof LZString !== 'undefined' || typeof pako !== 'undefined';
    } catch {
      return false;
    }
  }

  /**
   * Generate cache key with namespace
   */
  getCacheKey(key) {
    return `${this.namespace}${key}_v${CACHE_VERSION}`;
  }

  /**
   * Compress data if possible (for slow networks)
   */
  compress(data) {
    try {
      const jsonString = JSON.stringify(data);
      if (this.compressionEnabled && window.LZString) {
        return window.LZString.compress(jsonString);
      }
      return jsonString;
    } catch (error) {
      safeLog.warn('Cache compression failed:', error);
      return JSON.stringify(data);
    }
  }

  /**
   * Decompress data
   */
  decompress(compressedData) {
    try {
      if (this.compressionEnabled && window.LZString && typeof compressedData === 'string') {
        const decompressed = window.LZString.decompress(compressedData);
        return decompressed ? JSON.parse(decompressed) : JSON.parse(compressedData);
      }
      return JSON.parse(compressedData);
    } catch (error) {
      safeLog.warn('Cache decompression failed:', error);
      return null;
    }
  }

  /**
   * Set cache with expiry and compression
   */
  set(key, data, expiryTime = CACHE_EXPIRY_TIME) {
    try {
      const cacheKey = this.getCacheKey(key);
      const cacheData = {
        data: data,
        timestamp: Date.now(),
        expiry: Date.now() + expiryTime,
        version: CACHE_VERSION,
        compressed: this.compressionEnabled
      };

      const compressed = this.compress(cacheData);
      localStorage.setItem(cacheKey, compressed);
      
      // Log cache size for monitoring
      this.logCacheSize(key, compressed);
      
      return true;
    } catch (error) {
      safeLog.warn(`Cache set failed for key ${key}:`, error);
      // Attempt cleanup if quota exceeded
      if (error.name === 'QuotaExceededError') {
        this.cleanup();
      }
      return false;
    }
  }

  /**
   * Get cache with expiry check
   */
  get(key) {
    try {
      const cacheKey = this.getCacheKey(key);
      const cachedItem = localStorage.getItem(cacheKey);
      
      if (!cachedItem) {
        return null;
      }

      const cacheData = this.decompress(cachedItem);
      
      if (!cacheData || !cacheData.timestamp) {
        this.remove(key);
        return null;
      }

      // Check expiry
      if (Date.now() > cacheData.expiry) {
        this.remove(key);
        return null;
      }

      return cacheData.data;
    } catch (error) {
      safeLog.warn(`Cache get failed for key ${key}:`, error);
      this.remove(key);
      return null;
    }
  }

  /**
   * Remove specific cache entry
   */
  remove(key) {
    try {
      const cacheKey = this.getCacheKey(key);
      localStorage.removeItem(cacheKey);
      return true;
    } catch (error) {
      safeLog.warn(`Cache remove failed for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Clear all Kojo cache
   */
  clear() {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.namespace)) {
          localStorage.removeItem(key);
        }
      });
      return true;
    } catch (error) {
      safeLog.warn('Cache clear failed:', error);
      return false;
    }
  }

  /**
   * Cleanup expired cache entries
   */
  cleanup() {
    try {
      const keys = Object.keys(localStorage);
      let cleanedCount = 0;
      
      keys.forEach(key => {
        if (key.startsWith(this.namespace)) {
          try {
            const cachedItem = localStorage.getItem(key);
            if (cachedItem) {
              const cacheData = this.decompress(cachedItem);
              if (!cacheData || Date.now() > cacheData.expiry) {
                localStorage.removeItem(key);
                cleanedCount++;
              }
            }
          } catch {
            localStorage.removeItem(key);
            cleanedCount++;
          }
        }
      });
      
      devLog.info(`Cache cleanup completed: ${cleanedCount} entries removed`);
      return cleanedCount;
    } catch (error) {
      safeLog.warn('Cache cleanup failed:', error);
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    try {
      const keys = Object.keys(localStorage);
      const kojoKeys = keys.filter(key => key.startsWith(this.namespace));
      
      let totalSize = 0;
      let validEntries = 0;
      let expiredEntries = 0;

      kojoKeys.forEach(key => {
        try {
          const cachedItem = localStorage.getItem(key);
          if (cachedItem) {
            totalSize += cachedItem.length;
            const cacheData = this.decompress(cachedItem);
            if (cacheData && Date.now() <= cacheData.expiry) {
              validEntries++;
            } else {
              expiredEntries++;
            }
          }
        } catch {
          expiredEntries++;
        }
      });

      return {
        totalEntries: kojoKeys.length,
        validEntries,
        expiredEntries,
        totalSize: `${(totalSize / 1024).toFixed(2)} KB`,
        compressionEnabled: this.compressionEnabled
      };
    } catch (error) {
      safeLog.warn('Cache stats failed:', error);
      return null;
    }
  }

  /**
   * Log cache size for monitoring
   */
  logCacheSize(key, data) {
    if (process.env.NODE_ENV === 'development') {
      const size = new Blob([data]).size;
      devLog.info(`💾 Cache set: ${key} (${(size / 1024).toFixed(2)} KB)`);
    }
  }

  /**
   * Cache with automatic retry for network failures
   */
  async cacheWithRetry(key, dataFetcher, maxRetries = 3, expiryTime = CACHE_EXPIRY_TIME) {
    // Try to get from cache first
    const cached = this.get(key);
    if (cached) {
      return cached;
    }

    // Attempt to fetch fresh data with retries
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const data = await dataFetcher();
        this.set(key, data, expiryTime);
        return data;
      } catch (error) {
        safeLog.warn(`Cache fetch attempt ${attempt} failed for ${key}:`, error);
        
        if (attempt === maxRetries) {
          // Return stale cache if available on final failure
          const staleCache = this.getStale(key);
          if (staleCache) {
            devLog.info(`Returning stale cache for ${key}`);
            return staleCache;
          }
          throw error;
        }
        
        // Yield before retry without scheduling another timeout callback on the main thread.
        const retryDelay = Math.min(Math.pow(2, attempt) * 1000, 4000);
        await new Promise(resolve => {
          if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
            window.requestIdleCallback(() => resolve(), { timeout: retryDelay });
            return;
          }

          if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
            window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
            return;
          }

          resolve();
        });
      }
    }
  }

  /**
   * Get stale cache (expired but still available)
   */
  getStale(key) {
    try {
      const cacheKey = this.getCacheKey(key);
      const cachedItem = localStorage.getItem(cacheKey);
      
      if (!cachedItem) return null;

      const cacheData = this.decompress(cachedItem);
      return cacheData ? cacheData.data : null;
    } catch (error) {
      safeLog.warn(`Stale cache get failed for key ${key}:`, error);
      return null;
    }
  }
}

// Create singleton instance
const kojoCache = new KojoCache();

const scheduleCacheCleanup = () => {
  // Intentionally disabled during normal app startup to keep the console and main thread quiet.
  // Cleanup can still happen explicitly when cache writes fail or maintenance actions are triggered.
  return null;
};

// Startup cleanup intentionally disabled to avoid global timeout warnings on every page load.
scheduleCacheCleanup();

// Predefined cache keys for consistency
export const CACHE_KEYS = {
  USER_PROFILE: 'user_profile',
  USER_JOBS: 'user_jobs',
  AVAILABLE_JOBS: 'available_jobs',
  AVAILABLE_WORKERS: 'available_workers',
  CONVERSATIONS: 'conversations',
  PAYMENT_ACCOUNTS: 'payment_accounts',
  APP_CONFIG: 'app_config',
  GEOLOCATION_DATA: 'geolocation_data',
  LANGUAGE_PREFERENCES: 'language_preferences',
  PENDING_ACTIONS: 'pending_actions'
};

export default kojoCache;