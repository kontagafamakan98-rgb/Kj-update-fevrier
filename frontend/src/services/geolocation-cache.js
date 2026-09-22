import { devLog } from '../utils/env';

export const CACHE_KEY = 'kojo_precise_location';
export const CACHE_DURATION = 60 * 1000; // 60 secondes pour éviter les localisations obsolètes
export const MIN_CACHEABLE_GPS_ACCURACY = 35;

export class GeolocationCache {
  constructor(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
    this.storage = storage;
    this.cachedLocation = null;
    this.cacheTimestamp = null;
    this.load();
  }

  load() {
    try {
      if (!this.storage) return;
      const cached = this.storage.getItem(CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < CACHE_DURATION) {
          this.cachedLocation = data.location;
          this.cacheTimestamp = data.timestamp;
          devLog.info('📍 Position précise cachée chargée:', this.cachedLocation);
        } else {
          this.storage.removeItem(CACHE_KEY);
        }
      }
    } catch (e) {
      devLog.info('⚠️ Erreur chargement cache position précise:', e);
    }
  }

  save(location) {
    const gpsAccuracy = Number(location?.gpsAccuracy ?? location?.accuracy);
    const isCacheableGps = Boolean(
      location?.coordinates &&
      Number.isFinite(gpsAccuracy) &&
      gpsAccuracy > 0 &&
      gpsAccuracy <= MIN_CACHEABLE_GPS_ACCURACY &&
      !location?.isApproximate
    );

    if (!isCacheableGps) {
      devLog.info('ℹ️ Position non assez précise pour le cache persistant');
      return;
    }

    try {
      if (!this.storage) return;
      const now = Date.now();
      this.storage.setItem(CACHE_KEY, JSON.stringify({
        location,
        timestamp: now
      }));
      this.cachedLocation = location;
      this.cacheTimestamp = now;
      devLog.info('✅ Position précise sauvegardée dans le cache');
    } catch (e) {
      devLog.info('⚠️ Erreur sauvegarde cache position précise:', e);
    }
  }

  getValidCached(forceRefresh = false) {
    if (forceRefresh || !this.cachedLocation || !this.cacheTimestamp) {
      return null;
    }
    const age = Date.now() - this.cacheTimestamp;
    const cachedGpsAccuracy = Number(this.cachedLocation?.gpsAccuracy ?? this.cachedLocation?.accuracy);
    const canReuseCache = (
      age < CACHE_DURATION &&
      this.cachedLocation?.coordinates &&
      Number.isFinite(cachedGpsAccuracy) &&
      cachedGpsAccuracy > 0 &&
      cachedGpsAccuracy <= MIN_CACHEABLE_GPS_ACCURACY
    );

    if (canReuseCache) {
      return {
        location: this.cachedLocation,
        age
      };
    }
    return null;
  }
}
