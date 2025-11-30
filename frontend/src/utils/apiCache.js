/**
 * API Cache Utility for West Africa
 * Reduces API calls on slow networks by caching responses
 */

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
        console.log('📦 Cache HIT (memory):', url);
        return cached.data;
      }
      this.memoryCache.delete(key);
    }

    // Try localStorage (persistent across sessions)
    if (this.storageAvailable) {
      try {
        const cached = localStorage.getItem(key);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (this.isValid(parsed)) {
            console.log('📦 Cache HIT (storage):', url);
            // Restore to memory cache
            this.memoryCache.set(key, parsed);
            return parsed.data;
          }
          localStorage.removeItem(key);
        }
      } catch (e) {
        console.warn('Cache read error:', e);
      }
    }

    console.log('📭 Cache MISS:', url);
    return null;
  }

  /**
   * Store data in cache
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

    // Store in memory cache
    this.memoryCache.set(key, cached);

    // Store in localStorage for persistence
    if (this.storageAvailable) {
      try {
        localStorage.setItem(key, JSON.stringify(cached));
      } catch (e) {
        console.warn('Cache write error (quota exceeded?):', e);
        // Clear old cache entries if quota exceeded
        this.clearOldEntries();
      }
    }
  }

  /**
   * Check if cached data is still valid
   */
  isValid(cached) {
    if (!cached || !cached.timestamp || !cached.data) {
      return false;
    }

    const age = Date.now() - cached.timestamp;
    const ttl = cached.ttl || DEFAULT_TTL;
    
    return age < ttl;
  }

  /**
   * Invalidate cache for specific URL
   */
  invalidate(url, params = {}) {
    const key = this.generateKey(url, params);
    
    this.memoryCache.delete(key);
    
    if (this.storageAvailable) {
      localStorage.removeItem(key);
    }
  }

  /**
   * Clear all cache
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
   * Clear old/expired cache entries
   */
  clearOldEntries() {
    if (!this.storageAvailable) return;

    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(CACHE_PREFIX)) {
        try {
          const cached = JSON.parse(localStorage.getItem(key));
          if (!this.isValid(cached)) {
            localStorage.removeItem(key);
          }
        } catch (e) {
          localStorage.removeItem(key);
        }
      }
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
      memoryEntries: memorySize,
      storageEntries: storageSize,
      totalEntries: memorySize + storageSize
    };
  }
}

// Create singleton instance
const apiCache = new APICache();

/**
 * Wrapper function for API calls with automatic caching
 * @param {Function} apiCall - Function that returns a Promise with API data
 * @param {string} cacheKey - Unique cache key for this call
 * @param {Object} options - Caching options
 */
export async function cachedAPICall(apiCall, cacheKey, options = {}) {
  const {
    ttl = DEFAULT_TTL,
    params = {},
    forceRefresh = false,
    cacheFirst = true
  } = options;

  // Try cache first if not forcing refresh
  if (!forceRefresh && cacheFirst) {
    const cached = apiCache.get(cacheKey, params);
    if (cached !== null) {
      return cached;
    }
  }

  // Make actual API call
  try {
    const data = await apiCall();
    
    // Cache the result
    apiCache.set(cacheKey, data, params, ttl);
    
    return data;
  } catch (error) {
    // On network error, try to return stale cache if available
    if (!navigator.onLine) {
      const staleCache = apiCache.get(cacheKey, params);
      if (staleCache !== null) {
        console.warn('⚠️ Using stale cache due to offline status');
        return staleCache;
      }
    }
    
    throw error;
  }
}

/**
 * Invalidate cache for a specific endpoint
 */
export function invalidateCache(cacheKey, params = {}) {
  apiCache.invalidate(cacheKey, params);
}

/**
 * Clear all API cache
 */
export function clearAllCache() {
  apiCache.clearAll();
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return apiCache.getStats();
}

// Cache TTL presets for different data types
export const CACHE_TTL = {
  STATIC: 60 * 60 * 1000,      // 1 hour - for rarely changing data (countries, categories)
  MEDIUM: 5 * 60 * 1000,       // 5 minutes - for frequently accessed data (user profile, jobs list)
  SHORT: 1 * 60 * 1000,        // 1 minute - for real-time data (messages, notifications)
  LONG: 24 * 60 * 60 * 1000   // 24 hours - for very static data (translations, config)
};

export default apiCache;
