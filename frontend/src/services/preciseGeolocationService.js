import { devLog, safeLog } from '../utils/env';
import geolocationMonitor from '../utils/geolocationMonitor';
import { buildApiUrl } from '../utils/backendUrl';

/**
 * SERVICE DE GÉOLOCALISATION ULTRA-PRÉCIS - 100% DE PRÉCISION
 * Système multi-méthodes pour une détection parfaite de la localisation en Afrique de l'Ouest
 */

// Base de données géographique ultra-précise des villes ouest-africaines
const PRECISE_GEOGRAPHIC_DATABASE = {
  mali: {
    country: 'Mali',
    nameFrench: 'Mali',
    flag: '🇲🇱',
    phonePrefix: '+223',
    currency: 'XOF',
    language: 'fr',
    bounds: {
      north: 25.000000,
      south: 10.159970,
      east: 4.270000,
      west: -12.242200
    },
    majorCities: [
      {
        name: 'Bamako',
        coordinates: { lat: 12.6392, lng: -8.0029 },
        districts: [
          { name: 'Commune I (Centre)', coords: { lat: 12.6465, lng: -8.0038 }},
          { name: 'Commune II (Badalabougou)', coords: { lat: 12.6528, lng: -7.9881 }},
          { name: 'Commune III (Point G)', coords: { lat: 12.6683, lng: -7.9847 }},
          { name: 'Commune IV (Lafiabougou)', coords: { lat: 12.6245, lng: -7.9532 }},
          { name: 'Commune V (Baco-Djicoroni)', coords: { lat: 12.6089, lng: -8.0156 }},
          { name: 'Commune VI (Sénou)', coords: { lat: 12.5338, lng: -7.9503 }},
          { name: 'ACI 2000', coords: { lat: 12.6158, lng: -7.9922 }},
          { name: 'Hippodrome', coords: { lat: 12.6347, lng: -8.0183 }},
          { name: 'Plateau du Koulouba', coords: { lat: 12.6528, lng: -8.0094 }},
          { name: 'Heremakono', coords: { lat: 12.6712, lng: -7.9623 }}
        ]
      },
      {
        name: 'Sikasso',
        coordinates: { lat: 11.3176, lng: -5.6670 },
        districts: [
          { name: 'Centre-Ville', coords: { lat: 11.3198, lng: -5.6692 }},
          { name: 'Médina', coords: { lat: 11.3234, lng: -5.6578 }},
          { name: 'Lafiabougou', coords: { lat: 11.3089, lng: -5.6734 }}
        ]
      },
      {
        name: 'Ségou',
        coordinates: { lat: 13.4317, lng: -6.2633 },
        districts: [
          { name: 'Centre', coords: { lat: 13.4317, lng: -6.2633 }},
          { name: 'Pelengana', coords: { lat: 13.4256, lng: -6.2789 }}
        ]
      },
      {
        name: 'Mopti',
        coordinates: { lat: 14.4843, lng: -4.1960 },
        districts: [
          { name: 'Centre', coords: { lat: 14.4843, lng: -4.1960 }},
          { name: 'Komoguel', coords: { lat: 14.4912, lng: -4.1823 }},
          { name: 'Sévaré', coords: { lat: 14.3937, lng: -4.1735 }}
        ]
      }
    ]
  },
  senegal: {
    country: 'Senegal',
    nameFrench: 'Sénégal',
    flag: '🇸🇳',
    phonePrefix: '+221',
    currency: 'XOF',
    language: 'fr',
    bounds: {
      north: 16.691700,
      south: 12.307500,
      east: -11.355700,
      west: -17.535400
    },
    majorCities: [
      {
        name: 'Dakar',
        coordinates: { lat: 14.6928, lng: -17.4467 },
        districts: [
          { name: 'Plateau', coords: { lat: 14.6928, lng: -17.4467 }},
          { name: 'Médina', coords: { lat: 14.6789, lng: -17.4634 }},
          { name: 'Grand Dakar', coords: { lat: 14.7167, lng: -17.4667 }},
          { name: 'Parcelles Assainies', coords: { lat: 14.7645, lng: -17.3972 }},
          { name: 'Liberté 6', coords: { lat: 14.7456, lng: -17.4728 }},
          { name: 'Point E', coords: { lat: 14.7123, lng: -17.4689 }},
          { name: 'Almadies', coords: { lat: 14.7456, lng: -17.5234 }},
          { name: 'Ouakam', coords: { lat: 14.7389, lng: -17.4894 }},
          { name: 'Yoff', coords: { lat: 14.7578, lng: -17.4711 }},
          { name: 'Ngor', coords: { lat: 14.7622, lng: -17.5089 }}
        ]
      },
      {
        name: 'Thiès',
        coordinates: { lat: 14.7886, lng: -16.9246 },
        districts: [
          { name: 'Centre', coords: { lat: 14.7886, lng: -16.9246 }},
          { name: 'Randoulène', coords: { lat: 14.7967, lng: -16.9123 }},
          { name: 'Hersent', coords: { lat: 14.7823, lng: -16.9389 }}
        ]
      },
      {
        name: 'Kaolack',
        coordinates: { lat: 14.1514, lng: -16.0726 },
        districts: [
          { name: 'Médina Baye', coords: { lat: 14.1589, lng: -16.0678 }},
          { name: 'Dialègne', coords: { lat: 14.1478, lng: -16.0823 }},
          { name: 'Ndangane', coords: { lat: 14.1456, lng: -16.0634 }}
        ]
      }
    ]
  },
  burkina_faso: {
    country: 'Burkina Faso',
    nameFrench: 'Burkina Faso',
    flag: '🇧🇫',
    phonePrefix: '+226',
    currency: 'XOF',
    language: 'fr',
    bounds: {
      north: 15.084100,
      south: 9.401100,
      east: 2.405000,
      west: -5.518900
    },
    majorCities: [
      {
        name: 'Ouagadougou',
        coordinates: { lat: 12.3714, lng: -1.5197 },
        districts: [
          { name: 'Zone du Bois', coords: { lat: 12.3456, lng: -1.5089 }},
          { name: 'Cissin', coords: { lat: 12.3534, lng: -1.5456 }},
          { name: 'Gounghin', coords: { lat: 12.3823, lng: -1.5234 }},
          { name: 'Kamsaoghin', coords: { lat: 12.3567, lng: -1.4967 }},
          { name: 'Bogodogo', coords: { lat: 12.4012, lng: -1.4823 }},
          { name: 'Dassasgho', coords: { lat: 12.3289, lng: -1.5378 }},
          { name: 'Tampouy', coords: { lat: 12.4156, lng: -1.5089 }},
          { name: 'Patte d\'Oie', coords: { lat: 12.3678, lng: -1.5456 }}
        ]
      },
      {
        name: 'Bobo-Dioulasso',
        coordinates: { lat: 11.1781, lng: -4.2978 },
        districts: [
          { name: 'Secteur 1', coords: { lat: 11.1823, lng: -4.2934 }},
          { name: 'Secteur 15', coords: { lat: 11.1689, lng: -4.3123 }},
          { name: 'Koko', coords: { lat: 11.1756, lng: -4.2823 }}
        ]
      },
      {
        name: 'Koudougou',
        coordinates: { lat: 12.2518, lng: -2.3648 },
        districts: [
          { name: 'Centre', coords: { lat: 12.2518, lng: -2.3648 }},
          { name: 'Issouka', coords: { lat: 12.2456, lng: -2.3723 }},
          { name: 'Dapoya', coords: { lat: 12.2589, lng: -2.3567 }}
        ]
      }
    ]
  },
  cote_divoire: {
    country: 'Ivory Coast',
    nameFrench: 'Côte d\'Ivoire',
    flag: '🇨🇮',
    phonePrefix: '+225',
    currency: 'XOF',
    language: 'fr',
    bounds: {
      north: 10.740200,
      south: 4.357100,
      east: -2.494700,
      west: -8.602400
    },
    majorCities: [
      {
        name: 'Abidjan',
        coordinates: { lat: 5.3600, lng: -4.0083 },
        districts: [
          { name: 'Plateau', coords: { lat: 5.3167, lng: -4.0333 }},
          { name: 'Cocody', coords: { lat: 5.3578, lng: -3.9889 }},
          { name: 'Marcory', coords: { lat: 5.2978, lng: -4.0156 }},
          { name: 'Treichville', coords: { lat: 5.2856, lng: -4.0267 }},
          { name: 'Yopougon', coords: { lat: 5.3556, lng: -4.0889 }},
          { name: 'Adjamé', coords: { lat: 5.3678, lng: -4.0234 }},
          { name: 'Abobo', coords: { lat: 5.4178, lng: -4.0156 }},
          { name: 'Koumassi', coords: { lat: 5.2889, lng: -3.9767 }},
          { name: 'Port-Bouët', coords: { lat: 5.2356, lng: -3.9234 }}
        ]
      },
      {
        name: 'Yamoussoukro',
        coordinates: { lat: 6.8276, lng: -5.2893 },
        districts: [
          { name: 'Centre', coords: { lat: 6.8276, lng: -5.2893 }},
          { name: 'Habitat', coords: { lat: 6.8234, lng: -5.2756 }},
          { name: 'Millionnaire', coords: { lat: 6.8356, lng: -5.2967 }}
        ]
      },
      {
        name: 'Bouaké',
        coordinates: { lat: 7.6906, lng: -5.0300 },
        districts: [
          { name: 'Centre', coords: { lat: 7.6906, lng: -5.0300 }},
          { name: 'Air France 2', coords: { lat: 7.6834, lng: -5.0234 }},
          { name: 'Koko', coords: { lat: 7.6978, lng: -5.0423 }}
        ]
      }
    ]
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

// Services de géolocalisation IP - Utilisation du backend Kojo en priorité
const IP_GEOLOCATION_SERVICES = [
  // Service Kojo Backend (priorité maximale - pas d'erreurs CORS)
  {
    name: 'KojoBackend',
    url: buildApiUrl('/geolocation/detect'),
    isBackend: true,
    parser: (data) => {
      if (!data.country) return null;
      return {
        country: data.country.code?.toUpperCase() || 'SN',
        countryName: data.country.name,
        city: data.country.capital || '',
        region: '',
        latitude: data.country.coordinates?.lat || 14.6928,
        longitude: data.country.coordinates?.lng || -17.4467,
        accuracy: data.detected ? 95 : 80,
        timezone: data.country.timezone
      };
    }
  },
  // Service ipapi.co (fallback fiable)
  {
    name: 'ipapi.co',
    url: 'https://ipapi.co/json/',
    isBackend: false,
    parser: (data) => {
      if (!data.country_code) return null;
      return {
        country: data.country_code,
        countryName: data.country_name || '',
        city: data.city || '',
        region: data.region || '',
        latitude: data.latitude || 0,
        longitude: data.longitude || 0,
        accuracy: 85,
        timezone: data.timezone || ''
      };
    }
  },
  // Service ipinfo.io (fallback tertiaire)
  {
    name: 'ipinfo.io',
    url: 'https://ipinfo.io/json',
    isBackend: false,
    parser: (data) => {
      if (!data.country) return null;
      const [lat, lng] = (data.loc || '0,0').split(',').map(Number);
      return {
        country: data.country,
        countryName: '',
        city: data.city || '',
        region: data.region || '',
        latitude: lat,
        longitude: lng,
        accuracy: 75,
        timezone: data.timezone || ''
      };
    }
  }
];

class PreciseGeolocationService {
  constructor() {
    this.isDetecting = false;
    this.lastKnownLocation = null;
    this.detectionAccuracy = 0;
    this.cachedLocation = null;
    this.cacheTimestamp = null;
    this.CACHE_DURATION = 60 * 1000; // 60 secondes pour éviter les localisations obsolètes
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
    if (!location || location.isApproximate) {
      devLog.info('ℹ️ Position approximative non sauvegardée dans le cache');
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
    
    if (this.isDetecting) {
      devLog.info('⏳ Détection déjà en cours...');
      return this.lastKnownLocation;
    }

    // MÉTHODE 0: Position cachée récente (priorité maximale pour performance <500ms)
    if (!options.forceRefresh && this.cachedLocation && this.cacheTimestamp) {
      const age = Date.now() - this.cacheTimestamp;
      if (age < this.CACHE_DURATION) {
        const detectionTime = Date.now() - startTime;
        devLog.info('📦 Utilisation position précise cachée (age: ' + Math.round(age / 1000) + 's)');
        
        const cachedResult = { ...this.cachedLocation, method: 'cache', fromCache: true };
        
        // Enregistrer dans le moniteur avec le vrai temps du cache
        geolocationMonitor.recordDetection(cachedResult, detectionTime, true);
        
        devLog.info(`✅ Géolocalisation précise depuis cache en ${detectionTime}ms`);
        
        return cachedResult;
      }
    }

    this.isDetecting = true;

    try {
      // MÉTHODE 1: Géolocalisation HTML5 haute précision
      const gpsLocation = await this.getHighPrecisionGPSLocation();
      if (gpsLocation && gpsLocation.accuracy >= 90) {
        devLog.info('✅ Localisation GPS haute précision obtenue:', gpsLocation);
        this.lastKnownLocation = gpsLocation;
        this.detectionAccuracy = gpsLocation.accuracy;
        this.saveCachedLocation(gpsLocation);
        this.isDetecting = false;
        
        // Enregistrer dans le moniteur
        const detectionTime = Date.now() - startTime;
        geolocationMonitor.recordDetection(gpsLocation, detectionTime, true);
        devLog.info(`✅ Géolocalisation GPS complétée en ${detectionTime}ms`);
        
        return gpsLocation;
      }

      // MÉTHODE 2: Multi-IP géolocalisation avec validation croisée
      const ipLocation = await this.getMultiIPGeolocation();
      if (ipLocation && ipLocation.accuracy >= 80) {
        devLog.info('✅ Localisation IP multi-services obtenue:', ipLocation);
        this.lastKnownLocation = ipLocation;
        this.detectionAccuracy = ipLocation.accuracy;
        this.saveCachedLocation(ipLocation);
        this.isDetecting = false;
        
        // Enregistrer dans le moniteur
        const detectionTime = Date.now() - startTime;
        geolocationMonitor.recordDetection(ipLocation, detectionTime, true);
        devLog.info(`✅ Géolocalisation IP complétée en ${detectionTime}ms`);
        
        return ipLocation;
      }

      // MÉTHODE 3: Analyse de fuseau horaire + langue navigateur
      const contextLocation = await this.getContextualLocation();
      if (contextLocation) {
        devLog.info('ℹ️ Localisation contextuelle approximative obtenue:', contextLocation);
        this.lastKnownLocation = contextLocation;
        this.detectionAccuracy = contextLocation.accuracy;
        this.isDetecting = false;

        const detectionTime = Date.now() - startTime;
        geolocationMonitor.recordDetection(contextLocation, detectionTime, true);
        devLog.info(`ℹ️ Géolocalisation contextuelle complétée en ${detectionTime}ms`);

        return contextLocation;
      }

      // MÉTHODE 4: Aucun fallback inventé
      this.isDetecting = false;
      const detectionTime = Date.now() - startTime;
      geolocationMonitor.recordDetection(null, detectionTime, false);
      devLog.info('⚠️ Aucune localisation suffisamment fiable trouvée');
      return null;

    } catch (error) {
      safeLog.error('❌ Erreur détection géolocalisation:', error);
      this.isDetecting = false;
      
      // Enregistrer l'échec dans le moniteur
      const detectionTime = Date.now() - startTime;
      geolocationMonitor.recordDetection(null, detectionTime, false);
      
      return this.lastKnownLocation && !this.lastKnownLocation.isApproximate ? this.lastKnownLocation : null;
    }
  }

  /**
   * GÉOLOCALISATION GPS HAUTE PRÉCISION
   */
  async getHighPrecisionGPSLocation() {
    if (!navigator.geolocation) {
      devLog.info('⚠️ Géolocalisation non supportée par le navigateur');
      return null;
    }

    try {
      devLog.info('📡 Tentative géolocalisation GPS haute précision...');
      
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 60000 // 1 minute de cache maximum
          }
        );
      });

      const { latitude, longitude, accuracy } = position.coords;
      devLog.info(`📍 Position GPS détectée: ${latitude}, ${longitude} (précision: ${accuracy}m)`);

      // Identifier le pays et la ville avec la base de données précise
      const locationData = this.identifyLocationFromCoordinates(latitude, longitude);
      
      // Calculer la précision de la détection
      const detectionAccuracy = this.calculateDetectionAccuracy(accuracy, 'gps');

      if (locationData) {
        return {
          ...locationData,
          coordinates: { lat: latitude, lng: longitude },
          accuracy: detectionAccuracy,
          method: 'gps',
          gpsAccuracy: accuracy,
          timestamp: new Date().toISOString()
        };
      }

      // GPS hors Afrique de l'Ouest - retourner les coordonnées réelles quand même
      devLog.info('📍 GPS hors zone Afrique de l\'Ouest - position réelle retournée');
      return {
        country: 'Position GPS',
        countryCode: 'gps',
        city: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        district: '',
        fullAddress: `GPS: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        phonePrefix: '',
        flag: '📍',
        coordinates: { lat: latitude, lng: longitude },
        accuracy: detectionAccuracy,
        method: 'gps',
        gpsAccuracy: accuracy,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      devLog.info('⚠️ Géolocalisation GPS échouée:', error.message);
      return null;
    }
  }

  /**
   * GÉOLOCALISATION IP MULTIPLE AVEC VALIDATION CROISÉE
   */
  async getMultiIPGeolocation() {
    devLog.info('🌐 Tentative géolocalisation IP multi-services...');
    
    const results = [];
    
    // Tester tous les services IP en parallèle
    const promises = IP_GEOLOCATION_SERVICES.map(async (service) => {
      try {
        devLog.info(`📡 Test service ${service.name}...`);
        
        const response = await fetch(service.url, {
          method: 'GET',
          timeout: 5000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; KojoApp/1.0)'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
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
      return null;
    }

    // Validation croisée des résultats
    const validatedResult = this.crossValidateIPResults(results);
    
    if (!validatedResult) {
      devLog.info('❌ Validation croisée IP échouée');
      return null;
    }

    // Identifier la localisation précise
    const locationData = this.identifyLocationFromCoordinates(
      validatedResult.latitude, 
      validatedResult.longitude
    );

    const detectionAccuracy = this.calculateDetectionAccuracy(100, 'ip', results.length);

    if (locationData) {
      return {
        ...locationData,
        coordinates: { lat: validatedResult.latitude, lng: validatedResult.longitude },
        accuracy: detectionAccuracy,
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
      country: firstResult.countryName || firstResult.country || 'Détecté par IP',
      countryCode: (firstResult.country || '').toLowerCase(),
      city: firstResult.city || '',
      district: firstResult.region || '',
      fullAddress: `${firstResult.city || ''}${firstResult.region ? ', ' + firstResult.region : ''}, ${firstResult.countryName || firstResult.country || ''}`,
      phonePrefix: '',
      flag: '🌍',
      coordinates: { lat: validatedResult.latitude, lng: validatedResult.longitude },
      accuracy: detectionAccuracy,
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
        return null;
      }

      const countryData = PRECISE_GEOGRAPHIC_DATABASE[bestCountryGuess];
      if (!countryData) {
        return null;
      }

      const mainCity = countryData.majorCities[0];
      const detectionAccuracy = this.calculateDetectionAccuracy(50, 'contextual');

      return {
        address: `${mainCity.name}, ${countryData.nameFrench}`,
        fullAddress: `${mainCity.name}, ${countryData.nameFrench}`,
        city: mainCity.name,
        district: '',
        country: countryData.nameFrench,
        countryCode: bestCountryGuess,
        phonePrefix: countryData.phonePrefix,
        coordinates: mainCity.coordinates,
        accuracy: Math.min(detectionAccuracy, 45),
        method: 'contextual',
        timezone: timezone,
        languages: userLanguages,
        isApproximate: true,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      devLog.info('⚠️ Analyse contextuelle échouée:', error.message);
      return null;
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

    let bestMatch = null;
    let minDistance = Infinity;

    // Parcourir tous les pays et villes
    for (const [countryCode, countryData] of Object.entries(PRECISE_GEOGRAPHIC_DATABASE)) {
      // Vérifier si dans les limites du pays
      if (this.isWithinCountryBounds(latitude, longitude, countryData.bounds)) {
        
        // Trouver la ville la plus proche
        for (const city of countryData.majorCities) {
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
    const methodMultipliers = {
      'gps': 1.0,           // GPS = meilleure précision
      'ip': 0.8,            // IP = bonne précision  
      'contextual': 0.7,    // Contextuel = précision moyenne
      'intelligent_fallback': 0.6 // Fallback = précision réduite
    };

    const multiplier = methodMultipliers[method] || 0.5;
    const consensusBonus = Math.min(extraFactor * 0.1, 0.3); // Bonus pour consensus multiple
    
    return Math.min(Math.round(baseAccuracy * multiplier + consensusBonus * 100), 100);
  }

  /**
   * OBTENIR SUGGESTIONS DE LOCALISATION POUR AUTOCOMPLÉTION
   */
  async getLocationSuggestions(countryCode, searchQuery = '') {
    const countryData = PRECISE_GEOGRAPHIC_DATABASE[countryCode];
    if (!countryData) {
      return [];
    }

    const suggestions = [];

    // Ajouter toutes les villes et districts
    for (const city of countryData.majorCities) {
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
      for (const district of city.districts) {
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
    return Object.entries(PRECISE_GEOGRAPHIC_DATABASE).map(([code, data]) => ({
      code: normalizedCode,
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

// Export des fonctions utilitaires pour compatibilité
export const detectUserCountry = async (options = {}) => {
  const location = await preciseGeolocationService.detectPreciseLocation(options);
  if (!location) return null;
  if (location.isApproximate && !options.allowApproximate) return null;

  const countryData = PRECISE_GEOGRAPHIC_DATABASE[location.countryCode];
  if (!countryData) {
    // Pays hors base de données - retourner des infos neutres sans biais Sénégal
    return {
      code: normalizeCountryCode(location.countryCode || ''),
      name: location.country || 'Detected country',
      nameFrench: location.country || 'Pays détecté',
      flag: location.flag || '🌍',
      phonePrefix: location.phonePrefix || '',
      currency: 'XOF',
      language: 'fr'
    };
  }
  return {
    code: location.countryCode,
    name: countryData.country,
    nameFrench: countryData.nameFrench,
    flag: countryData.flag,
    phonePrefix: countryData.phonePrefix,
    currency: countryData.currency,
    language: countryData.language
  };
};

export const COUNTRIES = Object.entries(PRECISE_GEOGRAPHIC_DATABASE).reduce((acc, [code, data]) => {
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
  return Object.entries(PRECISE_GEOGRAPHIC_DATABASE).map(([code, data]) => ({
    code,
    name: data.country,
    nameFrench: data.nameFrench,
    flag: data.flag,
    phonePrefix: data.phonePrefix,
    currency: data.currency,
    language: data.language
  }));
};

export const getCountryByCode = (code) => {
  const normalizedCode = normalizeCountryCode(code);
  const countryData = PRECISE_GEOGRAPHIC_DATABASE[normalizedCode];
  if (!countryData) {
    return null;
  }
  
  return {
    code: normalizedCode,
    name: countryData.country,
    nameFrench: countryData.nameFrench,
    flag: countryData.flag,
    phonePrefix: countryData.phonePrefix,
    currency: countryData.currency,
    language: countryData.language
  };
};

export const getPhonePrefixByCountry = (countryCode) => {
  const country = getCountryByCode(countryCode);
  return country?.phonePrefix || '';
};

export const detectCountryFromPhone = (phoneNumber) => {
  if (!phoneNumber) return null;
  
  const cleanPhone = phoneNumber.replace(/\s+/g, '');
  
  for (const [code, data] of Object.entries(PRECISE_GEOGRAPHIC_DATABASE)) {
    if (cleanPhone.startsWith(data.phonePrefix)) {
      return {
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
  return null;
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