import { devLog, safeLog } from '../utils/env';
import geolocationMonitor from '../utils/geolocationMonitor';
import { api } from './api';

/**
 * MODULE DE GÉOLOCALISATION UNIQUE (fusion de geolocationService.js et
 * preciseGeolocationService.js).
 *
 * L'ancien geolocationService.js dupliquait COUNTRIES, les méthodes GPS
 * (reverse geocoding, identifyLocationFromCoordinates, détection IP/context)
 * et les helpers téléphone avec des bases de villes inline qui doublonnaient
 * la base backend. Tout vit désormais ici :
 *  - La base géographique (villes/quartiers) est servie par
 *    `/api/geolocation/cities` (source de vérité) et mise en cache localement.
 *  - Le reverse geocoding passe par `/api/geolocation/reverse` (plus d'appel
 *    direct à nominatim.openstreetmap.org).
 *  - La détection IP passe par `/api/geolocation/detect` (plus d'appel direct
 *    à ipapi.co / ipinfo.io). La CSP du navigateur est ainsi réduite.
 *
 * Exports : service par défaut (détection précise), detectUserCountry,
 * helpers pays/téléphone (getCountriesList, getCountryByCode, formatPhoneNumber…),
 * banques (getPopularBanksByCountry) et langues (AVAILABLE_LANGUAGES, …).
 */

// Fallback compact (niveau pays) — utilisé uniquement si la base complète
// n'a pas encore été chargée depuis le backend (premier rendu, hors-ligne).
// Les villes/quartiers ne vivent que côté backend.
const FALLBACK_COUNTRY_DATA = {
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

const COUNTRY_CODE_ALIASES = {
  ivory_coast: 'cote_divoire',
  cote_divoire: 'cote_divoire',
  ci: 'cote_divoire',
  mali: 'mali',
  ml: 'mali',
  senegal: 'senegal',
  sn: 'senegal',
  burkina_faso: 'burkina_faso',
  bf: 'burkina_faso'
};

const normalizeCountryCode = (code = '') => {
  const value = String(code).toLowerCase().trim();
  return COUNTRY_CODE_ALIASES[value] || value;
};

// ---------------------------------------------------------------------------
// Base géographique chargée depuis le backend (source de vérité)
// ---------------------------------------------------------------------------
const DB_CACHE_KEY = 'kojo_geo_db';
const DB_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 jours

let geographicDatabase = null;
let databaseLoadPromise = null;

const hydrateDatabaseFromCache = () => {
  try {
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

const getDatabase = () => geographicDatabase || FALLBACK_COUNTRY_DATA;

const loadGeographicDatabase = async () => {
  if (databaseLoadPromise) return databaseLoadPromise;
  databaseLoadPromise = (async () => {
    try {
      // Client central api : cookies + CSRF gérés (GET public, aucune
      // authentification requise — la session cookie est envoyée quand elle
      // existe).
      const data = await api.get('/geolocation/cities');
      const countries = data?.countries || data?.database;
      if (countries && typeof countries === 'object' && Object.keys(countries).length > 0) {
        geographicDatabase = countries;
        try {
          localStorage.setItem(DB_CACHE_KEY, JSON.stringify({ data: countries, timestamp: Date.now() }));
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

// Services de géolocalisation IP — uniquement le backend Kojo (plus d'appels
// directs à ipapi.co / ipinfo.io depuis le navigateur → CSP réduite).
const IP_GEOLOCATION_SERVICES = [
  {
    name: 'KojoBackend',
    path: '/geolocation/detect',
    isBackend: true,
    parser: (data) => {
      // Ne jamais inventer un pays par défaut : si le backend n'a pas pu
      // détecter (detected: false / country: null), la détection a échoué
      // et l'utilisateur devra choisir son pays manuellement.
      if (!data.country || data.detected === false) return null;
      return {
        country: data.country.code?.toUpperCase(),
        countryName: data.country.name,
        city: data.country.capital || '',
        region: '',
        latitude: data.country.coordinates?.lat,
        longitude: data.country.coordinates?.lng,
        accuracy: data.detected ? 95 : 80,
        timezone: data.country.timezone
      };
    }
  }
];

// Objet localisation NEUTRE renvoyé quand une méthode de détection échoue
// (IP, reverse geocoding, GPS, contextuelle) : plus jamais null → aucune
// lecture de propriété ne peut lever de TypeError. Même convention que
// detectUserCountry : le flag `detected: false` signale aux appelants de ne
// PAS traiter le résultat comme une détection (l'utilisateur choisit
// manuellement), tout en restant lisible pour un affichage neutre.
const neutralLocation = (method = '', extra = {}) => ({
  detected: false,
  method,
  ...extra,
});

class PreciseGeolocationService {
  constructor() {
    this.isDetecting = false;
    this.lastKnownLocation = null;
    this.detectionAccuracy = 0;
    this.cachedLocation = null;
    this.cacheTimestamp = null;
    this.CACHE_DURATION = 60 * 1000; // 60 secondes pour éviter les localisations obsolètes
    this.TARGET_GPS_ACCURACY = 12;
    this.MIN_CACHEABLE_GPS_ACCURACY = 35;
    this.MAX_ACCEPTABLE_GPS_ACCURACY = 120;
    this.loadCachedLocation();
  }

  // Charger la dernière position depuis localStorage
  loadCachedLocation() {
    try {
      const cached = localStorage.getItem('kojo_precise_location');
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < this.CACHE_DURATION) {
          this.cachedLocation = data.location;
          this.cacheTimestamp = data.timestamp;
          devLog.info('📍 Position précise cachée chargée:', this.cachedLocation);
        } else {
          localStorage.removeItem('kojo_precise_location');
        }
      }
    } catch (e) {
      devLog.info('⚠️ Erreur chargement cache position précise:', e);
    }
  }

  // Sauvegarder la position dans le cache
  saveCachedLocation(location) {
    const gpsAccuracy = Number(location?.gpsAccuracy ?? location?.accuracy);
    const isCacheableGps = Boolean(
      location?.coordinates &&
      Number.isFinite(gpsAccuracy) &&
      gpsAccuracy > 0 &&
      gpsAccuracy <= this.MIN_CACHEABLE_GPS_ACCURACY &&
      !location?.isApproximate
    );

    if (!isCacheableGps) {
      devLog.info('ℹ️ Position non assez précise pour le cache persistant');
      return;
    }

    try {
      localStorage.setItem('kojo_precise_location', JSON.stringify({
        location,
        timestamp: Date.now()
      }));
      this.cachedLocation = location;
      this.cacheTimestamp = Date.now();
      devLog.info('✅ Position précise sauvegardée dans le cache');
    } catch (e) {
      devLog.info('⚠️ Erreur sauvegarde cache position précise:', e);
    }
  }

  /**
   * DÉTECTION ULTRA-PRÉCISE DE LA LOCALISATION
   * Utilise multiple méthodes pour une précision de 100%
   */
  async detectPreciseLocation(options = {}) {
    devLog.info('🎯 Démarrage détection géolocalisation ultra-précise...');

    const startTime = Date.now();

    // La base géographique (villes/quartiers) doit être disponible pour
    // identifier la localisation depuis les coordonnées GPS.
    await loadGeographicDatabase();

    if (this.isDetecting) {
      devLog.info('⏳ Détection déjà en cours...');
      return this.lastKnownLocation;
    }

    if (!options.forceRefresh && this.cachedLocation && this.cacheTimestamp) {
      const age = Date.now() - this.cacheTimestamp;
      const cachedGpsAccuracy = Number(this.cachedLocation?.gpsAccuracy ?? this.cachedLocation?.accuracy);
      const canReuseCache = (
        age < this.CACHE_DURATION &&
        this.cachedLocation?.coordinates &&
        Number.isFinite(cachedGpsAccuracy) &&
        cachedGpsAccuracy > 0 &&
        cachedGpsAccuracy <= this.MIN_CACHEABLE_GPS_ACCURACY
      );

      if (canReuseCache) {
        const detectionTime = Date.now() - startTime;
        devLog.info('📦 Utilisation position précise cachée (age: ' + Math.round(age / 1000) + 's)');

        const cachedResult = {
          detected: true,
          ...this.cachedLocation,
          method: 'cache',
          fromCache: true,
          isPrecise: true,
          isApproximate: false,
          confidence: this.calculateDetectionAccuracy(cachedGpsAccuracy, 'gps')
        };

        geolocationMonitor.recordDetection(cachedResult, detectionTime, true);
        devLog.info(`✅ Géolocalisation précise depuis cache en ${detectionTime}ms`);

        return cachedResult;
      }
    }

    this.isDetecting = true;

    try {
      const gpsLocation = await this.getHighPrecisionGPSLocation();
      if (gpsLocation?.detected === true) {
        devLog.info('✅ Localisation GPS obtenue:', gpsLocation);
        this.lastKnownLocation = gpsLocation;
        this.detectionAccuracy = gpsLocation.confidence || 0;
        this.saveCachedLocation(gpsLocation);
        this.isDetecting = false;

        const detectionTime = Date.now() - startTime;
        geolocationMonitor.recordDetection(gpsLocation, detectionTime, true);
        devLog.info(`✅ Géolocalisation GPS complétée en ${detectionTime}ms`);

        return gpsLocation;
      }

      const ipLocation = await this.getMultiIPGeolocation();
      if (ipLocation?.detected === true) {
        devLog.info('⚠️ Fallback localisation IP utilisé:', ipLocation);
        this.lastKnownLocation = ipLocation;
        this.detectionAccuracy = ipLocation.confidence || 0;
        this.isDetecting = false;

        const detectionTime = Date.now() - startTime;
        geolocationMonitor.recordDetection(ipLocation, detectionTime, true);
        devLog.info(`ℹ️ Géolocalisation IP complétée en ${detectionTime}ms`);

        return ipLocation;
      }

      const contextLocation = await this.getContextualLocation();
      if (contextLocation?.detected === true) {
        devLog.info('ℹ️ Localisation contextuelle approximative obtenue:', contextLocation);
        this.lastKnownLocation = contextLocation;
        this.detectionAccuracy = contextLocation.confidence || 0;
        this.isDetecting = false;

        const detectionTime = Date.now() - startTime;
        geolocationMonitor.recordDetection(contextLocation, detectionTime, true);
        devLog.info(`ℹ️ Géolocalisation contextuelle complétée en ${detectionTime}ms`);

        return contextLocation;
      }

      this.isDetecting = false;
      const detectionTime = Date.now() - startTime;
      geolocationMonitor.recordDetection(null, detectionTime, false);
      devLog.info('⚠️ Aucune localisation suffisamment fiable trouvée');
      return neutralLocation('detect');

    } catch (error) {
      safeLog.error('❌ Erreur détection géolocalisation:', error);
      this.isDetecting = false;

      const detectionTime = Date.now() - startTime;
      geolocationMonitor.recordDetection(null, detectionTime, false);

      return this.lastKnownLocation && !this.lastKnownLocation.isApproximate ? this.lastKnownLocation : neutralLocation('error');
    }
  }

  /**
   * GÉOLOCALISATION GPS HAUTE PRÉCISION
   */
  async getGeolocationPermissionState() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) {
        return 'unknown';
      }

      const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
      return permissionStatus?.state || 'unknown';
    } catch (error) {
      devLog.info('⚠️ Permissions API indisponible:', error.message);
      return 'unknown';
    }
  }

  async getCurrentPositionWithOptions(options = {}) {
    return await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  }

  async getBestAvailableGpsPosition() {
    const permissionState = await this.getGeolocationPermissionState();
    devLog.info(`🔐 Permission géolocalisation: ${permissionState}`);

    const baseOptions = {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    };

    const firstPosition = await this.getCurrentPositionWithOptions(baseOptions);
    const firstAccuracy = firstPosition?.coords?.accuracy ?? Number.POSITIVE_INFINITY;

    if (!navigator.geolocation?.watchPosition || firstAccuracy <= this.TARGET_GPS_ACCURACY) {
      return firstPosition;
    }

    devLog.info(`📡 Premier fix GPS à ${Math.round(firstAccuracy)}m, lancement d'un warm-up précision...`);

    const watchDurationMs = firstAccuracy <= 25 ? 6000 : 10000;

    return await new Promise((resolve) => {
      let bestPosition = firstPosition;
      let settled = false;
      let watchId = null;
      let timerId = null;

      const finalize = () => {
        if (settled) return;
        settled = true;

        if (timerId) {
          clearTimeout(timerId);
        }

        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
        }

        resolve(bestPosition);
      };

      const evaluatePosition = (position) => {
        if (!position?.coords) return;

        const candidateAccuracy = position.coords.accuracy ?? Number.POSITIVE_INFINITY;
        const currentBestAccuracy = bestPosition?.coords?.accuracy ?? Number.POSITIVE_INFINITY;

        if (candidateAccuracy < currentBestAccuracy) {
          bestPosition = position;
        }

        if (candidateAccuracy <= this.TARGET_GPS_ACCURACY) {
          finalize();
        }
      };

      timerId = setTimeout(finalize, watchDurationMs);

      try {
        watchId = navigator.geolocation.watchPosition(
          (position) => {
            evaluatePosition(position);
          },
          (error) => {
            devLog.info('⚠️ Warm-up GPS interrompu:', error.message);
            finalize();
          },
          {
            enableHighAccuracy: true,
            timeout: watchDurationMs,
            maximumAge: 0
          }
        );
      } catch (error) {
        devLog.info('⚠️ watchPosition indisponible:', error.message);
        finalize();
        return;
      }

      evaluatePosition(firstPosition);
    });
  }

  // Reverse geocoding via le backend Kojo (plus d'appel direct à Nominatim)
  async reverseGeocodePrecise(latitude, longitude) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 8000) : null;

    try {
      const data = await api.get('/geolocation/reverse', {
        params: { lat: latitude, lng: longitude },
        signal: controller ? controller.signal : undefined,
        headers: { 'Accept-Language': 'fr,en' },
      });
      return { detected: true, ...data };
    } catch (error) {
      devLog.info('⚠️ Reverse geocoding backend échoué:', error.message);
      // Neutre (jamais null) : buildPreciseAddressFromReverseData retombe sur
      // les coordonnées + la base locale sans rien casser (address lisible).
      return neutralLocation('reverse', { address: {}, display_name: '' });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  buildPreciseAddressFromReverseData(reverseData, fallbackLocationData, latitude, longitude) {
    const address = reverseData?.address || {};
    const countryCode = normalizeCountryCode(address.country_code || fallbackLocationData?.countryCode || '');
    const countryData = getDatabase()[countryCode];

    const streetName = address.road || address.pedestrian || address.footway || address.street || address.path || '';
    const houseNumber = address.house_number || '';
    const streetLine = [houseNumber, streetName].filter(Boolean).join(' ').trim();
    const district = address.suburb || address.neighbourhood || address.city_district || address.quarter || address.hamlet || fallbackLocationData?.district || '';
    const city = address.city || address.town || address.village || address.municipality || address.county || fallbackLocationData?.city || '';
    const state = address.state || address.region || '';
    const country = address.country || fallbackLocationData?.country || countryData?.nameFrench || '';

    const shortAddress = [streetLine, district || city].filter(Boolean).join(', ') || [district, city].filter(Boolean).join(', ') || fallbackLocationData?.address || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    const fullAddress = reverseData?.display_name || [streetLine, district, city, state, country].filter(Boolean).join(', ') || shortAddress;

    return {
      address: shortAddress,
      fullAddress,
      city,
      district,
      country,
      countryCode: countryCode || fallbackLocationData?.countryCode || '',
      postalCode: address.postcode || '',
      phonePrefix: countryData?.phonePrefix || fallbackLocationData?.phonePrefix || '',
      flag: countryData?.flag || fallbackLocationData?.flag || '📍'
    };
  }

  async getHighPrecisionGPSLocation() {
    if (!navigator.geolocation) {
      devLog.info('⚠️ Géolocalisation non supportée par le navigateur');
      return neutralLocation('gps');
    }

    try {
      devLog.info('📡 Tentative géolocalisation GPS haute précision...');

      const position = await this.getBestAvailableGpsPosition();
      const { latitude, longitude, accuracy } = position.coords;
      const roundedAccuracy = Math.round(accuracy || 0);
      devLog.info(`📍 Position GPS détectée: ${latitude}, ${longitude} (précision: ${roundedAccuracy}m)`);

      const fallbackLocationData = this.identifyLocationFromCoordinates(latitude, longitude) || {};
      const reverseData = await this.reverseGeocodePrecise(latitude, longitude);
      const preciseAddressData = this.buildPreciseAddressFromReverseData(reverseData, fallbackLocationData, latitude, longitude);
      const confidence = this.calculateDetectionAccuracy(roundedAccuracy, 'gps');

      return {
        detected: true,
        ...fallbackLocationData,
        ...preciseAddressData,
        coordinates: { lat: latitude, lng: longitude },
        latitude,
        longitude,
        accuracy: roundedAccuracy,
        gpsAccuracy: roundedAccuracy,
        confidence,
        method: 'gps',
        timestamp: new Date().toISOString(),
        isApproximate: roundedAccuracy > this.MAX_ACCEPTABLE_GPS_ACCURACY,
        isPrecise: roundedAccuracy <= this.MIN_CACHEABLE_GPS_ACCURACY,
        precisionTier: roundedAccuracy <= 10
          ? 'excellent'
          : roundedAccuracy <= 25
            ? 'high'
            : roundedAccuracy <= 50
              ? 'good'
              : roundedAccuracy <= 100
                ? 'fair'
                : 'low'
      };

    } catch (error) {
      devLog.info('⚠️ Géolocalisation GPS échouée:', error.message);
      return neutralLocation('gps');
    }
  }

  /**
   * GÉOLOCALISATION IP (backend Kojo uniquement)
   */
  async getMultiIPGeolocation() {
    devLog.info('🌐 Tentative géolocalisation IP via backend Kojo...');

    const results = [];

    // Tester tous les services IP en parallèle
    const promises = IP_GEOLOCATION_SERVICES.map(async (service) => {
      try {
        devLog.info(`📡 Test service ${service.name}...`);

        // Client central api (GET public). Note : l'ancien `timeout: 5000`
        // et le header User-Agent étaient ignorés par fetch (option invalide /
        // header interdit en navigateur) — le timeout réel de reverse geocoding
        // passe par AbortController via signal.
        const data = await api.get(service.path);
        const parsed = service.parser(data);

        devLog.info(`✅ ${service.name} réponse:`, parsed);

        // Accepter toute localisation valide (pas seulement Afrique de l'Ouest)
        if (parsed && parsed.latitude && parsed.longitude) {
          results.push({
            service: service.name,
            ...parsed
          });
        }

      } catch (error) {
        devLog.info(`⚠️ Service ${service.name} échoué:`, error.message);
      }
    });

    await Promise.allSettled(promises);

    if (results.length === 0) {
      devLog.info('❌ Aucun service IP n\'a fourni de localisation valide');
      return neutralLocation('ip');
    }

    // Validation croisée des résultats
    const validatedResult = this.crossValidateIPResults(results);

    if (!validatedResult) {
      devLog.info('❌ Validation croisée IP échouée');
      return neutralLocation('ip');
    }

    // Identifier la localisation précise
    const locationData = this.identifyLocationFromCoordinates(
      validatedResult.latitude,
      validatedResult.longitude
    );

    const detectionAccuracy = this.calculateDetectionAccuracy(100, 'ip', results.length);

    if (locationData) {
      return {
        detected: true,
        ...locationData,
        coordinates: { lat: validatedResult.latitude, lng: validatedResult.longitude },
        accuracy: 0,
        confidence: detectionAccuracy,
        method: 'ip',
        ipServices: results.length,
        consensus: validatedResult.consensus,
        timestamp: new Date().toISOString()
      };
    }

    // Hors Afrique de l'Ouest - retourner les vraies données IP
    devLog.info('📍 IP hors zone Afrique de l\'Ouest - position réelle retournée');
    const firstResult = results[0];
    return {
      detected: true,
      country: firstResult.countryName || firstResult.country || 'Détecté par IP',
      countryCode: (firstResult.country || '').toLowerCase(),
      city: firstResult.city || '',
      district: firstResult.region || '',
      fullAddress: `${firstResult.city || ''}${firstResult.region ? ', ' + firstResult.region : ''}, ${firstResult.countryName || firstResult.country || ''}`,
      phonePrefix: '',
      flag: '🌍',
      coordinates: { lat: validatedResult.latitude, lng: validatedResult.longitude },
      accuracy: 0,
      confidence: detectionAccuracy,
      method: 'ip',
      ipServices: results.length,
      consensus: validatedResult.consensus,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * GÉOLOCALISATION CONTEXTUELLE (fuseau horaire + langue)
   */
  async getContextualLocation() {
    devLog.info('🧠 Analyse contextuelle (fuseau horaire + langue)...');

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const userLanguages = navigator.languages || [navigator.language];

      devLog.info(`🕐 Fuseau horaire: ${timezone}`);
      devLog.info(`🗣️ Langues navigateur:`, userLanguages);

      const timezoneMapping = {
        'Africa/Bamako': 'mali',
        'Africa/Dakar': 'senegal',
        'Africa/Ouagadougou': 'burkina_faso',
        'Africa/Abidjan': 'cote_divoire'
      };

      const languageHints = {
        'wo': ['senegal'],
        'bm': ['mali']
      };

      let bestCountryGuess = timezoneMapping[timezone];

      if (!bestCountryGuess) {
        for (const lang of userLanguages) {
          const langCode = lang.split('-')[0].toLowerCase();
          if (languageHints[langCode]) {
            bestCountryGuess = languageHints[langCode][0];
            break;
          }
        }
      }

      if (!bestCountryGuess) {
        devLog.info('⚠️ Impossible de déterminer le pays par le contexte');
        return neutralLocation('contextual');
      }

      const countryData = getDatabase()[bestCountryGuess];
      if (!countryData || !countryData.majorCities?.length) {
        return neutralLocation('contextual');
      }

      const mainCity = countryData.majorCities[0];
      const detectionAccuracy = this.calculateDetectionAccuracy(50, 'contextual');

      return {
        detected: true,
        address: `${mainCity.name}, ${countryData.nameFrench}`,
        fullAddress: `${mainCity.name}, ${countryData.nameFrench}`,
        city: mainCity.name,
        district: '',
        country: countryData.nameFrench,
        countryCode: bestCountryGuess,
        phonePrefix: countryData.phonePrefix,
        coordinates: mainCity.coordinates,
        accuracy: 0,
        confidence: Math.min(detectionAccuracy, 45),
        method: 'contextual',
        timezone: timezone,
        languages: userLanguages,
        isApproximate: true,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      devLog.info('⚠️ Analyse contextuelle échouée:', error.message);
      return neutralLocation('contextual');
    }
  }

  /**
   * IDENTIFICATION PRÉCISE DE LOCALISATION À PARTIR DE COORDONNÉES
   */
  identifyLocationFromCoordinates(latitude, longitude) {
    devLog.info(`🎯 Identification précise pour: ${latitude}, ${longitude}`);

    // Vérifier d'abord si c'est en Afrique de l'Ouest
    if (!this.isWestAfricaCoordinates(latitude, longitude)) {
      devLog.info('⚠️ Coordonnées hors Afrique de l\'Ouest');
      return null;
    }

    const database = getDatabase();
    let bestMatch = null;
    let minDistance = Infinity;

    // Parcourir tous les pays et villes
    for (const [countryCode, countryData] of Object.entries(database)) {
      // Vérifier si dans les limites du pays
      if (countryData.bounds && this.isWithinCountryBounds(latitude, longitude, countryData.bounds)) {

        // Trouver la ville la plus proche
        for (const city of countryData.majorCities || []) {
          const distance = this.calculateDistance(
            latitude, longitude,
            city.coordinates.lat, city.coordinates.lng
          );

          if (distance < minDistance) {
            minDistance = distance;

            // Trouver le district le plus proche dans cette ville
            let closestDistrict = city.districts[0];
            let minDistrictDistance = Infinity;

            for (const district of city.districts) {
              const districtDistance = this.calculateDistance(
                latitude, longitude,
                district.coords.lat, district.coords.lng
              );

              if (districtDistance < minDistrictDistance) {
                minDistrictDistance = districtDistance;
                closestDistrict = district;
              }
            }

            bestMatch = {
              address: `${closestDistrict.name}, ${city.name}`,
              fullAddress: `${closestDistrict.name}, ${city.name}, ${countryData.nameFrench}`,
              city: city.name,
              district: closestDistrict.name,
              country: countryData.nameFrench,
              countryCode: countryCode,
              phonePrefix: countryData.phonePrefix,
              distance: minDistance,
              districtDistance: minDistrictDistance
            };
          }
        }
      }
    }

    if (bestMatch) {
      devLog.info(`✅ Localisation identifiée: ${bestMatch.fullAddress} (${bestMatch.distance.toFixed(2)}km)`);
    } else {
      devLog.info('❌ Aucune localisation précise trouvée');
    }

    return bestMatch;
  }

  /**
   * VALIDATION CROISÉE DES RÉSULTATS IP
   */
  crossValidateIPResults(results) {
    if (results.length === 0) return null;
    if (results.length === 1) return { ...results[0], consensus: 1 };

    devLog.info(`🔍 Validation croisée de ${results.length} résultats IP...`);

    // Grouper par pays
    const countryGroups = {};
    for (const result of results) {
      const country = result.country;
      if (!countryGroups[country]) {
        countryGroups[country] = [];
      }
      countryGroups[country].push(result);
    }

    // Trouver le consensus majoritaire
    let majorityCountry = null;
    let maxCount = 0;

    for (const [country, group] of Object.entries(countryGroups)) {
      if (group.length > maxCount) {
        maxCount = group.length;
        majorityCountry = country;
      }
    }

    if (!majorityCountry) {
      devLog.info('❌ Pas de consensus sur le pays');
      return null;
    }

    // Calculer la moyenne des coordonnées pour le pays majoritaire
    const majorityResults = countryGroups[majorityCountry];
    const avgLat = majorityResults.reduce((sum, r) => sum + r.latitude, 0) / majorityResults.length;
    const avgLng = majorityResults.reduce((sum, r) => sum + r.longitude, 0) / majorityResults.length;

    const consensus = majorityResults.length / results.length;

    devLog.info(`✅ Consensus ${(consensus * 100).toFixed(1)}% pour ${majorityCountry}`);

    return {
      country: majorityCountry,
      countryName: majorityResults[0].countryName,
      latitude: avgLat,
      longitude: avgLng,
      consensus: consensus,
      services: majorityResults.length
    };
  }

  /**
   * FALLBACK DÉSACTIVÉ POUR ÉVITER LES LOCALISATIONS FAUSSES
   */
  getIntelligentFallback() {
    return null;
  }

  /**
   * VÉRIFIER SI LES COORDONNÉES SONT EN AFRIQUE DE L'OUEST
   */
  isWestAfricaCoordinates(latitude, longitude) {
    // Zone géographique étendue de l'Afrique de l'Ouest
    return (
      latitude >= 4.0 && latitude <= 25.0 &&    // Latitude: du Golfe de Guinée au Sahara
      longitude >= -18.0 && longitude <= 5.0     // Longitude: de l'Atlantique au centre de l'Afrique
    );
  }

  /**
   * VÉRIFIER SI LES COORDONNÉES SONT DANS LES LIMITES D'UN PAYS
   */
  isWithinCountryBounds(latitude, longitude, bounds) {
    return (
      latitude >= bounds.south && latitude <= bounds.north &&
      longitude >= bounds.west && longitude <= bounds.east
    );
  }

  /**
   * CALCULER LA DISTANCE ENTRE DEUX POINTS (Haversine)
   */
  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /**
   * CALCULER LA PRÉCISION DE DÉTECTION
   */
  calculateDetectionAccuracy(baseAccuracy, method, extraFactor = 1) {
    if (method === 'gps') {
      const meters = Number(baseAccuracy);

      if (!Number.isFinite(meters) || meters <= 0) {
        return 0;
      }

      if (meters <= 5) return 100;
      if (meters <= 10) return 99;
      if (meters <= 20) return 96;
      if (meters <= 35) return 93;
      if (meters <= 50) return 88;
      if (meters <= 100) return 78;
      if (meters <= 200) return 65;
      return 50;
    }

    if (method === 'ip') {
      return Math.min(40 + Math.round(extraFactor * 8), 68);
    }

    if (method === 'contextual') {
      return 35;
    }

    return 0;
  }

  /**
   * OBTENIR SUGGESTIONS DE LOCALISATION POUR AUTOCOMPLÉTION
   */
  async getLocationSuggestions(countryCode, searchQuery = '') {
    await loadGeographicDatabase();
    const countryData = getDatabase()[countryCode];
    if (!countryData) {
      return [];
    }

    const suggestions = [];

    // Ajouter toutes les villes et districts
    for (const city of countryData.majorCities || []) {
      // Ajouter la ville elle-même
      if (!searchQuery || city.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        suggestions.push({
          id: `${countryCode}_${city.name}`,
          name: city.name,
          fullName: `${city.name}, ${countryData.nameFrench}`,
          type: 'city',
          country: countryData.nameFrench,
          countryCode: countryCode,
          coordinates: city.coordinates
        });
      }

      // Ajouter tous les districts
      for (const district of city.districts || []) {
        if (!searchQuery ||
            district.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            city.name.toLowerCase().includes(searchQuery.toLowerCase())) {
          suggestions.push({
            id: `${countryCode}_${city.name}_${district.name}`,
            name: district.name,
            fullName: `${district.name}, ${city.name}, ${countryData.nameFrench}`,
            type: 'district',
            city: city.name,
            country: countryData.nameFrench,
            countryCode: countryCode,
            coordinates: district.coords
          });
        }
      }
    }

    // Trier par pertinence
    return suggestions
      .sort((a, b) => {
        // Villes en premier, puis districts
        if (a.type !== b.type) {
          return a.type === 'city' ? -1 : 1;
        }
        // Puis par ordre alphabétique
        return a.name.localeCompare(b.name);
      })
      .slice(0, 20); // Limiter à 20 suggestions
  }

  /**
   * OBTENIR LA DERNIÈRE LOCALISATION CONNUE
   */
  getLastKnownLocation() {
    return this.lastKnownLocation;
  }

  /**
   * OBTENIR LA PRÉCISION DE LA DERNIÈRE DÉTECTION
   */
  getDetectionAccuracy() {
    return this.detectionAccuracy;
  }

  /**
   * OBTENIR TOUS LES PAYS SUPPORTÉS
   */
  getSupportedCountries() {
    return Object.entries(getDatabase()).map(([code, data]) => ({
      code,
      name: data.country,
      nameFrench: data.nameFrench,
      flag: data.flag,
      phonePrefix: data.phonePrefix,
      currency: data.currency,
      language: data.language
    }));
  }
}

// Export du service singleton
const preciseGeolocationService = new PreciseGeolocationService();
export default preciseGeolocationService;

// Objet pays NEUTRE renvoyé quand la détection échoue (IP/GPS indisponible,
// position approximative refusée) : detectUserCountry ne renvoie PLUS JAMAIS
// null → toute la classe de bugs « Cannot read properties of null (reading
// 'nameFrench') » disparaît à la source. Le flag `detected: false` et le code
// vide signalent aux appelants de NE PAS auto-sélectionner un pays (l'utilisateur
// choisit manuellement), tout en restant lisible pour un affichage neutre.
const NEUTRAL_DETECTED_COUNTRY = Object.freeze({
  detected: false,
  code: '',
  name: 'Detected country',
  nameFrench: 'Pays détecté',
  flag: '🌍',
  phonePrefix: '',
  currency: 'XOF',
  language: 'fr',
});

// Export des fonctions utilitaires pour compatibilité
export const detectUserCountry = async (options = {}) => {
  await loadGeographicDatabase();
  const location = await preciseGeolocationService.detectPreciseLocation(options);
  // Le pipeline renvoie désormais un objet neutre (detected: false) au lieu
  // de null quand toutes les méthodes échouent — on traite les deux cas.
  if (!location || location.detected === false) return { ...NEUTRAL_DETECTED_COUNTRY };
  if (location.isApproximate && !options.allowApproximate) return { ...NEUTRAL_DETECTED_COUNTRY };

  const normalizedCountryCode = normalizeCountryCode(location.countryCode || '');
  const countryData = getDatabase()[normalizedCountryCode];
  if (!countryData) {
    // Pays hors base de données - retourner des infos neutres sans biais Sénégal
    return {
      detected: true,
      code: normalizedCountryCode,
      name: location.country || 'Detected country',
      nameFrench: location.country || 'Pays détecté',
      flag: location.flag || '🌍',
      phonePrefix: location.phonePrefix || '',
      currency: 'XOF',
      language: 'fr'
    };
  }
  return {
    detected: true,
    code: normalizedCountryCode,
    name: countryData.country,
    nameFrench: countryData.nameFrench,
    flag: countryData.flag,
    phonePrefix: countryData.phonePrefix,
    currency: countryData.currency,
    language: countryData.language
  };
};

export const COUNTRIES = Object.entries(FALLBACK_COUNTRY_DATA).reduce((acc, [code, data]) => {
  acc[code.toUpperCase()] = {
    code,
    name: data.country,
    nameFrench: data.nameFrench,
    flag: data.flag,
    phonePrefix: data.phonePrefix,
    currency: data.currency,
    language: data.language
  };
  return acc;
}, {});

export const getCountriesList = () => {
  return Object.entries(getDatabase()).map(([code, data]) => ({
    code,
    name: data.country,
    nameFrench: data.nameFrench,
    flag: data.flag,
    phonePrefix: data.phonePrefix,
    currency: data.currency,
    language: data.language
  }));
};

// Construit l'objet pays à partir des données de la base — ou l'objet NEUTRE
// (detected: false, code vide) quand le pays est inconnu : jamais null, même
// convention que detectUserCountry. Les appelants ne doivent utiliser le
// résultat que si detected !== false (pas d'auto-sélection d'un code vide).
const buildCountryObject = (countryData, code) => {
  if (!countryData) return { ...NEUTRAL_DETECTED_COUNTRY };
  return {
    detected: true,
    code,
    name: countryData.country,
    nameFrench: countryData.nameFrench,
    flag: countryData.flag,
    phonePrefix: countryData.phonePrefix,
    currency: countryData.currency,
    language: countryData.language
  };
};

export const getCountryByCode = (code) => {
  const normalizedCode = normalizeCountryCode(code);
  const countryData = getDatabase()[normalizedCode];
  return buildCountryObject(countryData, normalizedCode);
};

export const getPhonePrefixByCountry = (countryCode) => {
  const country = getCountryByCode(countryCode);
  return country?.phonePrefix || '';
};

export const detectCountryFromPhone = (phoneNumber) => {
  if (!phoneNumber) return { ...NEUTRAL_DETECTED_COUNTRY };

  const cleanPhone = phoneNumber.replace(/\s+/g, '');

  for (const [code, data] of Object.entries(getDatabase())) {
    if (cleanPhone.startsWith(data.phonePrefix)) {
      return {
        detected: true,
        code,
        name: data.country,
        nameFrench: data.nameFrench,
        flag: data.flag,
        phonePrefix: data.phonePrefix,
        currency: data.currency,
        language: data.language
      };
    }
  }
  return { ...NEUTRAL_DETECTED_COUNTRY };
};

export const formatPhoneNumber = (phone, countryCode) => {
  if (!phone) return '';

  const country = getCountryByCode(countryCode);
  const cleanPhone = phone.replace(/[^\d]/g, '');
  const prefix = country?.phonePrefix || '';

  if (!prefix) {
    return phone.trim();
  }

  // Si le numéro commence déjà par le préfixe, on le retourne tel quel
  if (phone.startsWith(prefix)) {
    return phone;
  }

  // Si le numéro commence par 0, on le remplace par le préfixe
  if (cleanPhone.startsWith('0')) {
    return prefix + ' ' + cleanPhone.substring(1);
  }

  // Sinon on ajoute juste le préfixe
  return prefix + ' ' + cleanPhone;
};

export const getPhoneExampleForCountry = (country) => {
  const examples = {
    'mali': '+223 70 12 34 56',
    'senegal': '+221 70 12 34 56',
    'burkina_faso': '+226 70 12 34 56',
    'cote_divoire': '+225 07 12 34 56'
  };

  return examples[normalizeCountryCode(country?.code || country)] || '+000 XX XXX XX XX';
};

// ============================================================================
// Helpers pays/banques/langues (ex-geolocationService.js) — fusionnés ici pour
// éliminer la duplication de COUNTRIES et des méthodes de géolocalisation.
// ============================================================================
export const getPopularBanksByCountry = (country) => {
  const banks = {
    'mali': [
      'Banque de Développement du Mali (BDM)',
      'Bank of Africa Mali',
      'Banque Atlantique Mali',
      'Ecobank Mali',
      'UBA Mali'
    ],
    'senegal': [
      'Banque Atlantique Sénégal',
      'Société Générale Sénégal',
      'CBAO Groupe Attijariwafa Bank',
      'Ecobank Sénégal',
      'UBA Sénégal'
    ],
    'burkina_faso': [
      'Banque Atlantique Burkina Faso',
      'Ecobank Burkina Faso',
      'Bank of Africa Burkina Faso',
      'UBA Burkina Faso',
      'Coris Bank International'
    ],
    'cote_divoire': [
      'Société Générale Côte d\'Ivoire',
      'Banque Atlantique Côte d\'Ivoire',
      'Ecobank Côte d\'Ivoire', 
      'Bank of Africa Côte d\'Ivoire',
      'UBA Côte d\'Ivoire'
    ]
  };
  
  const countryCode = normalizeCountryCode(country?.code || country);
  // Inconnu → [] (jamais la liste Sénégal par défaut : biais silencieux qui
  // proposait des banques sénégalaises à un utilisateur d'un autre pays).
  return banks[countryCode] || [];
};

// Langues disponibles dans l'application
export const AVAILABLE_LANGUAGES = {
  'fr': {
    code: 'fr',
    name: 'Français',
    nativeName: 'Français',
    flag: '🇫🇷'
  },
  'en': {
    code: 'en', 
    name: 'English',
    nativeName: 'English',
    flag: '🇬🇧'
  },
  'wo': {
    code: 'wo',
    name: 'Wolof',
    nativeName: 'Wolof',
    flag: '🇸🇳'
  },
  'bm': {
    code: 'bm',
    name: 'Bambara',
    nativeName: 'Bamanankan',
    flag: '🇲🇱'
  },
  'mos': {
    code: 'mos',
    name: 'Mooré',
    nativeName: 'Mòoré',
    flag: '🇧🇫'
  }
};

const getLanguageConfigByCountry = (country) => {
  const countryCode = normalizeCountryCode(country?.code || country);

  const languageConfig = {
    mali: {
      ordered: ['fr', 'bm'],
      primary: 'fr',
      local: ['bm']
    },
    senegal: {
      ordered: ['fr', 'wo'],
      primary: 'fr',
      local: ['wo']
    },
    burkina_faso: {
      ordered: ['fr', 'mos'],
      primary: 'fr',
      local: ['mos']
    },
    cote_divoire: {
      ordered: ['fr', 'en'],
      primary: 'fr',
      local: []
    }
  };

  return languageConfig[countryCode] || {
    ordered: ['fr', 'en'],
    primary: 'fr',
    local: []
  };
};

// Obtenir les langues principales par pays (langues recommandées en priorité)
export const getLanguagesByCountry = (country) => {
  return getLanguageConfigByCountry(country).ordered;
};

// Obtenir la langue principale (première) d'un pays
export const getPrimaryLanguageForCountry = (country) => {
  return getLanguageConfigByCountry(country).primary;
};

// Obtenir la langue locale réellement supportée par l'application
export const getLocalLanguageForCountry = (country) => {
  return getLanguageConfigByCountry(country).local[0] || null;
};

// Organiser les langues selon le pays détecté (langues recommandées en premier, puis les autres)
export const getOrderedLanguagesForCountry = (detectedCountry) => {
  const countryConfig = getLanguageConfigByCountry(detectedCountry);
  const recommendedLanguages = countryConfig.ordered;

  const otherLanguages = Object.keys(AVAILABLE_LANGUAGES).filter(
    lang => !recommendedLanguages.includes(lang)
  );

  const orderedLanguageCodes = [...recommendedLanguages, ...otherLanguages];

  return orderedLanguageCodes.map(code => ({
    ...AVAILABLE_LANGUAGES[code],
    isPrimary: code === countryConfig.primary,
    isCountryLanguage: countryConfig.local.includes(code),
    isRecommended: recommendedLanguages.includes(code)
  }));
};

// Obtenir le message de suggestion de langue selon le pays
export const getLanguageSuggestionMessage = (detectedCountry) => {
  if (!detectedCountry) return null;

  const countryCode = normalizeCountryCode(detectedCountry.code || detectedCountry);

  const suggestions = {
    mali: {
      message: 'Au Mali, la plupart des utilisateurs préfèrent le Français ou le Bambara',
      primaryLang: 'Français',
      localLang: 'Bambara'
    },
    senegal: {
      message: 'Au Sénégal, la plupart des utilisateurs préfèrent le Français ou le Wolof',
      primaryLang: 'Français',
      localLang: 'Wolof'
    },
    burkina_faso: {
      message: 'Au Burkina Faso, la plupart des utilisateurs préfèrent le Français ou le Mooré',
      primaryLang: 'Français',
      localLang: 'Mooré'
    },
    cote_divoire: {
      message: "En Côte d'Ivoire, la plupart des utilisateurs préfèrent le Français. L'anglais reste disponible si besoin.",
      primaryLang: 'Français',
      localLang: null
    }
  };

  return suggestions[countryCode] || null;
};

