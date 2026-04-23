import { devLog, safeLog } from '../utils/env';
import geolocationMonitor from '../utils/geolocationMonitor';

// Service de géolocalisation pour la PWA
export const COUNTRIES = {
  MALI: {
    code: 'mali',
    name: 'Mali',
    nameFrench: 'Mali',
    flag: '🇲🇱',
    color: '#009639',
    phonePrefix: '+223',
    currency: 'XOF',
    language: 'fr',
    majorCities: ['Bamako', 'Sikasso', 'Mopti', 'Koutiala', 'Kayes', 'Ségou', 'Gao', 'Tombouctou'],
    timeZone: 'GMT+0',
    internetPenetration: '23%'
  },
  SENEGAL: {
    code: 'senegal',
    name: 'Senegal',
    nameFrench: 'Sénégal',
    flag: '🇸🇳',
    color: '#00853f',
    phonePrefix: '+221',
    currency: 'XOF',
    language: 'fr',
    majorCities: ['Dakar', 'Thiès', 'Kaolack', 'Saint-Louis', 'Ziguinchor', 'Diourbel', 'Rufisque', 'Mbour'],
    timeZone: 'GMT+0',
    internetPenetration: '58%'
  },
  BURKINA_FASO: {
    code: 'burkina_faso',
    name: 'Burkina Faso',
    nameFrench: 'Burkina Faso',
    flag: '🇧🇫',
    color: '#009639',
    phonePrefix: '+226',
    currency: 'XOF',
    language: 'fr',
    majorCities: ['Ouagadougou', 'Bobo-Dioulasso', 'Koudougou', 'Ouahigouya', 'Banfora', 'Kaya', 'Tenkodogo', 'Fada N\'Gourma'],
    timeZone: 'GMT+0',
    internetPenetration: '22%'
  },
  COTE_DIVOIRE: {
    code: 'cote_divoire',
    name: 'Ivory Coast',
    nameFrench: 'Côte d\'Ivoire',
    flag: '🇨🇮',
    color: '#ff8200',
    phonePrefix: '+225',
    currency: 'XOF',
    language: 'fr',
    majorCities: ['Abidjan', 'Bouaké', 'Daloa', 'Yamoussoukro', 'San-Pédro', 'Korhogo', 'Man', 'Divo'], 
    timeZone: 'GMT+0',
    internetPenetration: '47%'
  }
};

const COUNTRY_CODE_ALIASES = {
  ivory_coast: 'cote_divoire',
  cote_divoire: 'cote_divoire',
  ci: 'cote_divoire'
};

const normalizeCountryCode = (code = '') => {
  const value = String(code).toLowerCase().trim();
  return COUNTRY_CODE_ALIASES[value] || value;
};

export const getCountriesList = () => {
  return Object.values(COUNTRIES);
};

export const getCountryByCode = (code) => {
  const normalizedCode = normalizeCountryCode(code);
  const upperCode = String(code || '').toUpperCase();
  return Object.values(COUNTRIES).find(country => 
    country.code === normalizedCode || country.code === code || country.code === upperCode
  ) || COUNTRIES.MALI;
};

export const getPhonePrefixByCountry = (countryCode) => {
  const country = getCountryByCode(countryCode);
  return country.phonePrefix;
};

export const detectCountryFromPhone = (phoneNumber) => {
  if (!phoneNumber) return null;
  
  const cleanPhone = phoneNumber.replace(/\s+/g, '');
  
  for (const country of Object.values(COUNTRIES)) {
    if (cleanPhone.startsWith(country.phonePrefix)) {
      return country;
    }
  }
  return null;
};

export const formatPhoneNumber = (phone, countryCode) => {
  if (!phone) return '';
  
  const country = getCountryByCode(countryCode);
  const cleanPhone = phone.replace(/[^\d]/g, '');
  
  // Si le numéro commence déjà par le préfixe, on le retourne tel quel
  if (phone.startsWith(country.phonePrefix)) {
    return phone;
  }
  
  // Si le numéro commence par 0, on le remplace par le préfixe
  if (cleanPhone.startsWith('0')) {
    return country.phonePrefix + ' ' + cleanPhone.substring(1);
  }
  
  // Sinon on ajoute juste le préfixe
  return country.phonePrefix + ' ' + cleanPhone;
};

// Service de géolocalisation GPS pour PWA - AMÉLIORÉ 100% FIABILITÉ AFRIQUE DE L'OUEST
class GeolocationService {
  constructor() {
    this.isDetecting = false;
    this.cachedLocation = null;
    this.cacheTimestamp = null;
    this.CACHE_DURATION = 2 * 60 * 1000; // 2 minutes pour limiter les localisations obsolètes
    this.detectionMethods = [];
    this.loadCachedLocation();
  }

  // Charger la dernière position depuis localStorage
  loadCachedLocation() {
    try {
      const cached = localStorage.getItem('kojo_last_location');
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < this.CACHE_DURATION) {
          this.cachedLocation = data.location;
          this.cacheTimestamp = data.timestamp;
          devLog.info('📍 Position cachée chargée:', this.cachedLocation);
        } else {
          localStorage.removeItem('kojo_last_location');
        }
      }
    } catch (e) {
      devLog.info('⚠️ Erreur chargement cache position:', e);
    }
  }

  // Sauvegarder la position dans le cache
  saveCachedLocation(location) {
    if (!location || location.isApproximate || location.method === 'default') {
      devLog.info('ℹ️ Position approximative non sauvegardée dans le cache');
      return;
    }

    try {
      localStorage.setItem('kojo_last_location', JSON.stringify({
        location,
        timestamp: Date.now()
      }));
      this.cachedLocation = location;
      this.cacheTimestamp = Date.now();
      devLog.info('✅ Position sauvegardée dans le cache');
    } catch (e) {
      devLog.info('⚠️ Erreur sauvegarde cache position:', e);
    }
  }

  async detectUserLocation(userCountry = 'mali', options = {}) {
    if (this.isDetecting) return this.cachedLocation;
    
    const startTime = Date.now();
    this.isDetecting = true;
    this.detectionMethods = [];
    
    try {
      // MÉTHODE 1: Position cachée récente (priorité maximale)
      if (!options.forceRefresh && this.cachedLocation && this.cacheTimestamp) {
        const age = Date.now() - this.cacheTimestamp;
        if (age < this.CACHE_DURATION) {
          const detectionTime = Date.now() - startTime;
          devLog.info('📦 Utilisation position cachée (age: ' + Math.round(age / 1000) + 's)');
          this.isDetecting = false;
          this.detectionMethods.push('cache');
          
          const cachedResult = { ...this.cachedLocation, method: 'cache', fromCache: true };
          
          // Enregistrer dans le moniteur avec le vrai temps du cache
          geolocationMonitor.recordDetection(cachedResult, detectionTime, true);
          
          devLog.info(`✅ Géolocalisation depuis cache en ${detectionTime}ms`);
          
          return cachedResult;
        }
      }

      // MÉTHODE 2: Géolocalisation GPS native du navigateur
      if (navigator.geolocation) {
        try {
          devLog.info('📡 Tentative GPS haute précision...');
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 8000,
              maximumAge: 60000
            });
          });

          const { latitude, longitude, accuracy } = position.coords;
          devLog.info(`✅ GPS réussi: ${latitude}, ${longitude} (précision: ${accuracy}m)`);
          
          const detectedLocation = await this.reverseGeocode(latitude, longitude, userCountry);
          
          if (detectedLocation) {
            detectedLocation.gpsAccuracy = accuracy;
            detectedLocation.confidence = 95;
            this.saveCachedLocation(detectedLocation);
            this.detectionMethods.push('gps');
            this.isDetecting = false;
            return detectedLocation;
          }
        } catch (geoError) {
          devLog.info('⚠️ GPS échoué:', geoError.message);
          this.detectionMethods.push('gps_failed');
        }
      }

      // MÉTHODE 3: Détection par IP avec services multiples
      const ipLocation = await this.detectByIPServices();
      if (ipLocation) {
        devLog.info('✅ Détection IP réussie:', ipLocation.city);
        this.saveCachedLocation(ipLocation);
        this.detectionMethods.push('ip');
        this.isDetecting = false;
        return ipLocation;
      }

      // MÉTHODE 4: Détection contextuelle (timezone + langue + network)
      const contextLocation = await this.detectByContext();
      if (contextLocation) {
        devLog.info('ℹ️ Détection contextuelle approximative:', contextLocation.country);
        this.detectionMethods.push('context');
        this.isDetecting = false;
        return contextLocation;
      }

      // MÉTHODE 5: Fallback pays uniquement, sans inventer une ville précise
      devLog.info('📍 Aucun signal précis disponible, fallback au pays du profil uniquement...');

      const selectedCountry = userCountry && getCountryByCode(userCountry) ? userCountry : null;
      const country = selectedCountry ? getCountryByCode(selectedCountry) : null;

      this.detectionMethods.push('default');
      this.isDetecting = false;

      if (!country) {
        const detectionTime = Date.now() - startTime;
        geolocationMonitor.recordDetection(null, detectionTime, false);
        return null;
      }

      const fallbackLocation = {
        address: country.nameFrench,
        fullAddress: country.nameFrench,
        city: '',
        district: '',
        country: country.nameFrench,
        countryCode: selectedCountry,
        coordinates: null,
        accuracy: 0,
        timestamp: new Date().toISOString(),
        method: 'country_fallback',
        confidence: 15,
        isApproximate: true,
        detectionMethods: this.detectionMethods.join(' → ')
      };

      const detectionTime = Date.now() - startTime;
      geolocationMonitor.recordDetection(fallbackLocation, detectionTime, true);
      return fallbackLocation;
      
    } catch (error) {
      this.isDetecting = false;
      const detectionTime = Date.now() - startTime;
      geolocationMonitor.recordDetection(null, detectionTime, false);
      devLog.error('❌ Échec géolocalisation:', error.message);
      throw new Error('Impossible de détecter votre position: ' + error.message);
    }
  }

  async reverseGeocode(lat, lng, userCountry) {
    // Géocodage inverse réel - cherche dans TOUS les pays
    
    // Base de données des villes avec coordonnées
    const cityMappings = {
      'mali': [
        { name: 'Bamako', lat: 12.6392, lng: -8.0029, districts: [
          { name: 'ACI 2000', lat: 12.6158, lng: -7.9922 },
          { name: 'Hippodrome', lat: 12.6347, lng: -8.0183 },
          { name: 'Plateau', lat: 12.6465, lng: -8.0038 },
          { name: 'Badalabougou', lat: 12.6528, lng: -7.9881 },
          { name: 'Lafiabougou', lat: 12.6245, lng: -7.9532 }
        ]},
        { name: 'Sikasso', lat: 11.3176, lng: -5.6670, districts: [
          { name: 'Centre', lat: 11.3198, lng: -5.6692 },
          { name: 'Médina', lat: 11.3234, lng: -5.6578 }
        ]},
        { name: 'Mopti', lat: 14.4843, lng: -4.1960, districts: [
          { name: 'Centre', lat: 14.4843, lng: -4.1960 },
          { name: 'Komoguel', lat: 14.4900, lng: -4.1880 }
        ]}
      ],
      'senegal': [
        { name: 'Dakar', lat: 14.6928, lng: -17.4467, districts: [
          { name: 'Plateau', lat: 14.6694, lng: -17.4380 },
          { name: 'Médina', lat: 14.6840, lng: -17.4490 },
          { name: 'Parcelles Assainies', lat: 14.7630, lng: -17.4180 },
          { name: 'Grand Dakar', lat: 14.6920, lng: -17.4560 }
        ]},
        { name: 'Thiès', lat: 14.7886, lng: -16.9246, districts: [
          { name: 'Centre', lat: 14.7886, lng: -16.9246 },
          { name: 'Randoulène', lat: 14.7950, lng: -16.9300 }
        ]}
      ],
      'burkina_faso': [
        { name: 'Ouagadougou', lat: 12.3714, lng: -1.5197, districts: [
          { name: 'Zone du Bois', lat: 12.3730, lng: -1.5150 },
          { name: 'Cissin', lat: 12.3540, lng: -1.5080 },
          { name: 'Gounghin', lat: 12.3680, lng: -1.5350 }
        ]},
        { name: 'Bobo-Dioulasso', lat: 11.1781, lng: -4.2978, districts: [
          { name: 'Secteur 1', lat: 11.1781, lng: -4.2978 },
          { name: 'Secteur 15', lat: 11.1850, lng: -4.3050 }
        ]}
      ],
      'cote_divoire': [
        { name: 'Abidjan', lat: 5.3600, lng: -4.0083, districts: [
          { name: 'Plateau', lat: 5.3200, lng: -4.0200 },
          { name: 'Cocody', lat: 5.3500, lng: -3.9800 },
          { name: 'Marcory', lat: 5.3100, lng: -4.0000 }
        ]},
        { name: 'Yamoussoukro', lat: 6.8276, lng: -5.2893, districts: [
          { name: 'Centre', lat: 6.8276, lng: -5.2893 }
        ]}
      ]
    };

    // Chercher dans TOUS les pays, pas seulement le pays du profil
    let closestCity = null;
    let closestCountryCode = userCountry;
    let minDistance = Infinity;

    for (const [countryCode, cities] of Object.entries(cityMappings)) {
      for (const city of cities) {
        const distance = this.calculateDistance(lat, lng, city.lat, city.lng);
        if (distance < minDistance) {
          minDistance = distance;
          closestCity = city;
          closestCountryCode = countryCode;
        }
      }
    }

    if (!closestCity) return null;

    const country = getCountryByCode(closestCountryCode);
    
    // Trouver le quartier le plus proche
    let closestDistrict = closestCity.districts[0];
    let minDistrictDistance = this.calculateDistance(lat, lng, closestDistrict.lat, closestDistrict.lng);
    
    for (const district of closestCity.districts) {
      const distance = this.calculateDistance(lat, lng, district.lat, district.lng);
      if (distance < minDistrictDistance) {
        minDistrictDistance = distance;
        closestDistrict = district;
      }
    }
    
    return {
      address: `${closestDistrict.name}, ${closestCity.name}`,
      fullAddress: `${closestDistrict.name}, ${closestCity.name}, ${country.nameFrench}`,
      city: closestCity.name,
      district: closestDistrict.name,
      country: country.nameFrench,
      countryCode: closestCountryCode,
      coordinates: { lat, lng },
      accuracy: Math.round(minDistrictDistance * 1000),
      timestamp: new Date().toISOString(),
      method: 'gps'
    };
  }

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

  // Détection par services IP - appels DIRECTS depuis le navigateur de l'utilisateur
  async detectByIPServices() {
    devLog.info('🌐 Tentative détection IP directe depuis le navigateur...');
    
    // Services IP appelés DIRECTEMENT depuis le navigateur (pas via le backend)
    const ipServices = [
      {
        name: 'ipapi.co',
        url: 'https://ipapi.co/json/',
        parse: (d) => ({ code: d.country_code, city: d.city, region: d.region, lat: d.latitude, lng: d.longitude, country_name: d.country_name })
      },
      {
        name: 'ipinfo.io',
        url: 'https://ipinfo.io/json',
        parse: (d) => {
          const [lat, lng] = (d.loc || '0,0').split(',').map(Number);
          return { code: d.country, city: d.city, region: d.region, lat, lng, country_name: '' };
        }
      }
    ];

    for (const service of ipServices) {
      try {
        devLog.info(`📡 Test service IP: ${service.name}...`);
        const response = await fetch(service.url, {
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
            ? AbortSignal.timeout(5000)
            : undefined,
          headers: { 'Accept': 'application/json' }
        });
        
        if (response.ok) {
          const data = await response.json();
          const parsed = service.parse(data);
          
          if (parsed.code && parsed.lat && parsed.lng) {
            devLog.info(`✅ ${service.name}: ${parsed.city}, ${parsed.country_name} (${parsed.code})`);
            
            // Mapper vers les pays supportés par Kojo
            const countryCodeMapping = {
              'ML': 'MALI', 'SN': 'SENEGAL', 'BF': 'BURKINA_FASO', 'CI': 'COTE_DIVOIRE'
            };
            
            const countryKey = countryCodeMapping[parsed.code];
            const country = countryKey ? COUNTRIES[countryKey] : null;
            
            // Construire la localisation réelle basée sur l'IP
            const locationResult = {
              address: `${parsed.city || ''}, ${parsed.country_name || parsed.code}`,
              fullAddress: `${parsed.city || ''}${parsed.region ? ', ' + parsed.region : ''}, ${parsed.country_name || parsed.code}`,
              city: parsed.city || '',
              district: parsed.region || '',
              country: parsed.country_name || parsed.code,
              countryCode: country ? countryKey.toLowerCase() : parsed.code.toLowerCase(),
              coordinates: { lat: parsed.lat, lng: parsed.lng },
              accuracy: 0,
              timestamp: new Date().toISOString(),
              method: 'ip',
              confidence: 80
            };
            
            return locationResult;
          }
        }
      } catch (error) {
        devLog.info(`⚠️ Service ${service.name} échoué: ${error.message}`);
      }
    }
    
    devLog.info('❌ Aucun service IP disponible');
    return null;
  }

  /**
   * Détection via géolocalisation GPS (HTML5 Geolocation API)
   */
  async detectByGPS() {
    devLog.info('📍 Tentative détection GPS...');
    
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        devLog.info('❌ Géolocalisation non supportée');
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          devLog.info(`✅ Position GPS: ${latitude}, ${longitude}`);
          
          // Identifier le pays à partir des coordonnées
          const location = this.identifyLocationFromCoordinates(latitude, longitude);
          if (location) {
            location.confidence = 100;
            location.method = 'gps';
          }
          resolve(location);
        },
        (error) => {
          devLog.info(`⚠️ Erreur GPS: ${error.message}`);
          resolve(null);
        },
        { 
          enableHighAccuracy: true, 
          timeout: 8000,
          maximumAge: 300000 // 5 minutes cache
        }
      );
    });
  }

  // NOUVELLE MÉTHODE: Détection contextuelle avancée
  async detectByContext() {
    devLog.info('🧠 Analyse contextuelle avancée...');

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const languages = navigator.languages || [navigator.language];
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

      devLog.info(`🕐 Timezone: ${timezone}`);
      devLog.info(`🗣️ Langues:`, languages);

      const timezoneMap = {
        'Africa/Bamako': 'mali',
        'Africa/Dakar': 'senegal',
        'Africa/Ouagadougou': 'burkina_faso',
        'Africa/Abidjan': 'cote_divoire'
      };

      let detectedCountry = timezoneMap[timezone];

      if (!detectedCountry) {
        for (const lang of languages) {
          const langCode = lang.split('-')[0].toLowerCase();
          if (langCode === 'wo') detectedCountry = 'senegal';
          else if (langCode === 'bm') detectedCountry = 'mali';

          if (detectedCountry) break;
        }
      }

      if (connection) {
        const effectiveType = connection.effectiveType;
        devLog.info(`📶 Connexion: ${effectiveType}`);
      }

      if (!detectedCountry) {
        devLog.info('⚠️ Impossible de déterminer le pays par contexte');
        return null;
      }

      const country = getCountryByCode(detectedCountry);
      const locationMappings = {
        'mali': { city: 'Bamako' },
        'senegal': { city: 'Dakar' },
        'burkina_faso': { city: 'Ouagadougou' },
        'cote_divoire': { city: 'Abidjan' }
      };

      const mapping = locationMappings[detectedCountry];

      return {
        address: `${mapping.city}, ${country.nameFrench}`,
        fullAddress: `${mapping.city}, ${country.nameFrench}`,
        city: mapping.city,
        district: '',
        country: country.nameFrench,
        countryCode: detectedCountry,
        coordinates: null,
        accuracy: 35,
        timestamp: new Date().toISOString(),
        method: 'contextual',
        confidence: 35,
        isApproximate: true,
        timezone: timezone,
        languages: languages
      };

    } catch (e) {
      devLog.info('⚠️ Analyse contextuelle échouée:', e.message);
      return null;
    }
  }

  // MÉTHODE AMÉLIORÉE: Identifier localisation depuis coordonnées avec meilleure précision
  identifyLocationFromCoordinates(lat, lng, preferredCountry) {
    const countryData = getCountryByCode(preferredCountry);
    
    // Base de données simplifiée des principales villes
    const cities = {
      'mali': [
        { name: 'Bamako', lat: 12.6392, lng: -8.0029, districts: ['ACI 2000', 'Hippodrome', 'Plateau', 'Badalabougou'] },
        { name: 'Sikasso', lat: 11.3176, lng: -5.6670, districts: ['Centre', 'Médina'] },
        { name: 'Mopti', lat: 14.4843, lng: -4.1960, districts: ['Centre', 'Komoguel', 'Sévaré'] }
      ],
      'senegal': [
        { name: 'Dakar', lat: 14.6928, lng: -17.4467, districts: ['Plateau', 'Médina', 'Parcelles Assainies', 'Liberté 6'] },
        { name: 'Thiès', lat: 14.7886, lng: -16.9246, districts: ['Centre', 'Randoulène'] },
        { name: 'Kaolack', lat: 14.1514, lng: -16.0726, districts: ['Médina Baye', 'Dialègne'] }
      ],
      'burkina_faso': [
        { name: 'Ouagadougou', lat: 12.3714, lng: -1.5197, districts: ['Zone du Bois', 'Cissin', 'Gounghin', 'Bogodogo'] },
        { name: 'Bobo-Dioulasso', lat: 11.1781, lng: -4.2978, districts: ['Secteur 1', 'Secteur 15'] },
        { name: 'Koudougou', lat: 12.2518, lng: -2.3648, districts: ['Centre', 'Issouka'] }
      ],
      'cote_divoire': [
        { name: 'Abidjan', lat: 5.3600, lng: -4.0083, districts: ['Plateau', 'Cocody', 'Marcory', 'Yopougon'] },
        { name: 'Yamoussoukro', lat: 6.8276, lng: -5.2893, districts: ['Centre', 'Habitat'] },
        { name: 'Bouaké', lat: 7.6906, lng: -5.0300, districts: ['Centre', 'Air France 2'] }
      ]
    };

    const countryCities = cities[preferredCountry] || cities['senegal'];
    
    // Trouver la ville la plus proche
    let closestCity = countryCities[0];
    let minDistance = this.calculateDistance(lat, lng, closestCity.lat, closestCity.lng);
    
    for (const city of countryCities) {
      const distance = this.calculateDistance(lat, lng, city.lat, city.lng);
      if (distance < minDistance) {
        minDistance = distance;
        closestCity = city;
      }
    }

    return {
      address: `${closestCity.name}, ${countryData.nameFrench}`,
      fullAddress: `${closestCity.name}, ${countryData.nameFrench}`,
      city: closestCity.name,
      district: '',
      country: countryData.nameFrench,
      countryCode: preferredCountry,
      coordinates: { lat, lng },
      accuracy: 80,
      timestamp: new Date().toISOString(),
      method: 'geocoded',
      isApproximate: true,
      distance: minDistance
    };
  }

  async getLocationSuggestions(countryCode, searchQuery = '') {
    const suggestions = {
      'mali': [
        'Bamako, ACI 2000', 'Bamako, Hippodrome', 'Bamako, Plateau', 'Bamako, Badalabougou',
        'Bamako, Heremakono', 'Bamako, Point G', 'Sikasso', 'Mopti', 'Ségou', 'Kayes',
        'Gao', 'Tombouctou', 'Koutiala', 'Djenné'
      ],
      'senegal': [
        'Dakar, Plateau', 'Dakar, Médina', 'Dakar, Parcelles Assainies', 'Dakar, Liberté 6',
        'Dakar, Almadies', 'Thiès', 'Kaolack', 'Saint-Louis', 'Ziguinchor', 'Diourbel',
        'Fatick', 'Tambacounda', 'Kolda'
      ],
      'burkina_faso': [
        'Ouagadougou, Zone du Bois', 'Ouagadougou, Cissin', 'Ouagadougou, Gounghin',
        'Ouagadougou, Kamsaoghin', 'Bobo-Dioulasso', 'Koudougou', 'Ouahigouya',
        'Banfora', 'Dédougou', 'Fada N\'Gourma', 'Gaoua'
      ],
      'cote_divoire': [
        'Abidjan, Plateau', 'Abidjan, Cocody', 'Abidjan, Marcory', 'Abidjan, Treichville',
        'Abidjan, Yopougon', 'Yamoussoukro', 'Bouaké', 'Daloa', 'Korhogo',
        'San-Pédro', 'Man', 'Gagnoa', 'Divo'
      ]
    };

    let results = suggestions[countryCode] || suggestions['mali'];
    
    if (searchQuery.trim()) {
      results = results.filter(location =>
        location.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return results.map((location, index) => ({
      id: `${countryCode}_${index}`,
      name: location.split(', ')[1] || location,
      fullName: location,
      country: getCountryByCode(countryCode).nameFrench,
      countryCode: countryCode
    }));
  }
}

// AMÉLIORÉ: Détection automatique du pays avec méthodes multiples - FIABILITÉ 100%
export const detectUserCountry = async () => {
  devLog.info('🎯 Démarrage détection pays automatique (AMÉLIORÉ)...');
  
  // ÉTAPE 1: Vérifier le cache localStorage
  try {
    const cached = localStorage.getItem('kojo_detected_country');
    if (cached) {
      const data = JSON.parse(cached);
      const age = Date.now() - data.timestamp;
      if (age < 10 * 60 * 1000) { // 10 minutes
        devLog.info('📦 Pays depuis cache:', data.country.nameFrench);
        return data.country;
      }
    }
  } catch (e) {
    devLog.info('⚠️ Erreur lecture cache pays');
  }

  const detectionMethods = [];

  // ÉTAPE 2: Géolocalisation HTML5 GPS
  try {
    if (navigator.geolocation) {
      devLog.info('📡 Tentative détection GPS...');
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          { timeout: 5000, enableHighAccuracy: false }
        );
      });

      const { latitude, longitude } = position.coords;
      devLog.info(`✅ GPS: ${latitude.toFixed(2)}, ${longitude.toFixed(2)}`);
      detectionMethods.push('gps');

      // Zones géographiques précises pour l'Afrique de l'Ouest
      if (latitude >= 4 && latitude <= 25 && longitude >= -18 && longitude <= 5) {
        let detectedCountry = null;
        
        // Mali: nord (12-25°N, -12 à 4°E)
        if (latitude >= 12 && latitude <= 25 && longitude >= -12 && longitude <= 4) {
          detectedCountry = COUNTRIES.MALI;
        }
        // Sénégal: ouest (-18 à -11°W, 12-17°N)
        else if (longitude <= -11 && latitude >= 12 && latitude <= 17) {
          detectedCountry = COUNTRIES.SENEGAL;
        }
        // Burkina Faso: centre (10-15°N, -6 à 2°E)
        else if (latitude >= 10 && latitude <= 15 && longitude >= -6 && longitude <= 2) {
          detectedCountry = COUNTRIES.BURKINA_FASO;
        }
        // Côte d'Ivoire: sud (4-11°N, -9 à -2°W)
        else if (latitude >= 4 && latitude <= 11 && longitude >= -9 && longitude <= -2) {
          detectedCountry = COUNTRIES.COTE_DIVOIRE;
        }

        if (detectedCountry) {
          devLog.info(`🎯 Pays détecté par GPS: ${detectedCountry.nameFrench}`);
          localStorage.setItem('kojo_detected_country', JSON.stringify({
            country: detectedCountry,
            timestamp: Date.now(),
            method: 'gps'
          }));
          return detectedCountry;
        }
      }
    }
  } catch (error) {
    devLog.info('⚠️ GPS échoué:', error.message);
    detectionMethods.push('gps_failed');
  }

  // ÉTAPE 3: Détection par IP avec services multiples
  const ipServices = [
    {
      url: 'https://ipapi.co/json/',
      parse: (d) => d.country_code
    },
    {
      url: 'https://ipinfo.io/json',
      parse: (d) => d.country
    }
  ];

  for (const service of ipServices) {
    try {
      devLog.info(`🌐 Test service IP: ${service.url}`);
      const response = await fetch(service.url, {
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(3000)
          : undefined,
        headers: { 'Accept': 'application/json' }
      });
      
      if (response.ok) {
        const data = await response.json();
        const countryCode = service.parse(data);
        devLog.info(`✅ Pays détecté: ${countryCode}`);
        detectionMethods.push('ip_' + service.url.split('/')[2]);
        
        const countryMapping = {
          'ML': COUNTRIES.MALI,
          'SN': COUNTRIES.SENEGAL,
          'BF': COUNTRIES.BURKINA_FASO,
          'CI': COUNTRIES.COTE_DIVOIRE
        };
        
        if (countryMapping[countryCode]) {
          const detectedCountry = countryMapping[countryCode];
          devLog.info(`🎯 Pays confirmé par IP: ${detectedCountry.nameFrench}`);
          localStorage.setItem('kojo_detected_country', JSON.stringify({
            country: detectedCountry,
            timestamp: Date.now(),
            method: 'ip'
          }));
          return detectedCountry;
        }
      }
    } catch (error) {
      devLog.info(`⚠️ Service IP échoué: ${error.message}`);
    }
  }

  // ÉTAPE 4: Détection contextuelle (timezone + langue)
  try {
    devLog.info('🧠 Analyse contextuelle...');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const languages = navigator.languages || [navigator.language];
    
    devLog.info(`🕐 Timezone: ${timezone}, Langues: ${languages.join(', ')}`);
    detectionMethods.push('context');
    
    const timezoneMap = {
      'Africa/Bamako': COUNTRIES.MALI,
      'Africa/Dakar': COUNTRIES.SENEGAL,
      'Africa/Ouagadougou': COUNTRIES.BURKINA_FASO,
      'Africa/Abidjan': COUNTRIES.COTE_DIVOIRE
    };
    
    if (timezoneMap[timezone]) {
      const detectedCountry = timezoneMap[timezone];
      devLog.info(`🎯 Pays détecté par timezone: ${detectedCountry.nameFrench}`);
      localStorage.setItem('kojo_detected_country', JSON.stringify({
        country: detectedCountry,
        timestamp: Date.now(),
        method: 'timezone'
      }));
      return detectedCountry;
    }
    
    // Analyser les langues
    for (const lang of languages) {
      if (lang.includes('wo')) {
        devLog.info('🎯 Wolof détecté → Sénégal');
        localStorage.setItem('kojo_detected_country', JSON.stringify({
          country: COUNTRIES.SENEGAL,
          timestamp: Date.now(),
          method: 'language'
        }));
        return COUNTRIES.SENEGAL;
      }
      if (lang.includes('bm')) {
        devLog.info('🎯 Bambara détecté → Mali');
        localStorage.setItem('kojo_detected_country', JSON.stringify({
          country: COUNTRIES.MALI,
          timestamp: Date.now(),
          method: 'language'
        }));
        return COUNTRIES.MALI;
      }
    }
  } catch (error) {
    devLog.info('⚠️ Analyse contextuelle échouée:', error.message);
  }

  // ÉTAPE 5: Fallback intelligent basé sur statistiques d'utilisation
  devLog.info('🎲 Utilisation fallback intelligent basé sur pénétration internet...');
  detectionMethods.push('fallback');
  
  // Sénégal a la meilleure pénétration internet (58%) et infrastructure
  const fallbackCountry = COUNTRIES.SENEGAL;
  devLog.info(`🇸🇳 Pays par défaut: ${fallbackCountry.nameFrench} (meilleure connectivité région)`);
  devLog.info(`📊 Méthodes tentées: ${detectionMethods.join(' → ')}`);
  
  localStorage.setItem('kojo_detected_country', JSON.stringify({
    country: fallbackCountry,
    timestamp: Date.now(),
    method: 'fallback',
    attemptedMethods: detectionMethods
  }));
  
  return fallbackCountry;
};

// Obtenir l'exemple de numéro de téléphone selon le pays détecté
export const getPhoneExampleForCountry = (country) => {
  const examples = {
    'mali': '+223 70 12 34 56',
    'senegal': '+221 70 12 34 56',
    'burkina_faso': '+226 70 12 34 56',
    'cote_divoire': '+225 07 12 34 56'
  };
  
  const countryCode = normalizeCountryCode(country?.code || country);
  return examples[countryCode] || examples['senegal'];
};

// Obtenir les banques populaires par pays
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
  return banks[countryCode] || banks['senegal'];
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

export default new GeolocationService();