import { devLog, safeLog } from '../utils/env';
import { api } from './api';

export const FALLBACK_COUNTRY_DATA = {
  mali: {
    country: 'Mali',
    nameFrench: 'Mali',
    flag: '🇲🇱',
    phonePrefix: '+223',
    currency: 'XOF',
    language: 'fr',
    bounds: { north: 25.0, south: 10.15997, east: 4.27, west: -12.2422 },
    majorCities: []
  },
  senegal: {
    country: 'Senegal',
    nameFrench: 'Sénégal',
    flag: '🇸🇳',
    phonePrefix: '+221',
    currency: 'XOF',
    language: 'fr',
    bounds: { north: 16.6917, south: 12.3075, east: -11.3557, west: -17.5354 },
    majorCities: []
  },
  burkina_faso: {
    country: 'Burkina Faso',
    nameFrench: 'Burkina Faso',
    flag: '🇧🇫',
    phonePrefix: '+226',
    currency: 'XOF',
    language: 'fr',
    bounds: { north: 15.0841, south: 9.4011, east: 2.405, west: -5.5189 },
    majorCities: []
  },
  cote_divoire: {
    country: 'Ivory Coast',
    nameFrench: "Côte d'Ivoire",
    flag: '🇨🇮',
    phonePrefix: '+225',
    currency: 'XOF',
    language: 'fr',
    bounds: { north: 10.7402, south: 4.3571, east: -2.4947, west: -8.6024 },
    majorCities: []
  }
};

export const DB_CACHE_KEY = 'kojo_geo_db';
export const DB_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 jours

let geographicDatabase = null;
let databaseLoadPromise = null;

export const hydrateDatabaseFromCache = () => {
  try {
    if (typeof localStorage === 'undefined') return;
    const cached = localStorage.getItem(DB_CACHE_KEY);
    if (!cached) return;
    const parsed = JSON.parse(cached);
    if (parsed && parsed.data && parsed.timestamp && (Date.now() - parsed.timestamp) < DB_CACHE_TTL) {
      geographicDatabase = parsed.data;
      devLog.info('🗺️ Base géographique chargée depuis le cache local');
    }
  } catch (e) {
    devLog.info('⚠️ Cache base géographique illisible:', e?.message);
  }
};

export const getDatabase = () => geographicDatabase || FALLBACK_COUNTRY_DATA;

export const loadGeographicDatabase = async () => {
  if (databaseLoadPromise) return databaseLoadPromise;
  databaseLoadPromise = (async () => {
    try {
      const data = await api.get('/geolocation/cities');
      const countries = data?.countries || data?.database;
      if (countries && typeof countries === 'object' && Object.keys(countries).length > 0) {
        geographicDatabase = countries;
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(DB_CACHE_KEY, JSON.stringify({ data: countries, timestamp: Date.now() }));
          }
        } catch (e) {
          devLog.info('⚠️ Impossible de mettre en cache la base géographique:', e?.message);
        }
        devLog.info('✅ Base géographique chargée depuis le backend');
      }
    } catch (error) {
      safeLog.error('⚠️ Base géographique indisponible, fallback local:', error);
    }
    return getDatabase();
  })();
  return databaseLoadPromise;
};

hydrateDatabaseFromCache();
