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
    language: 'fr'
  },
  SENEGAL: {
    code: 'senegal',
    name: 'Senegal',
    nameFrench: 'Sénégal',
    flag: '🇸🇳',
    color: '#00853f',
    phonePrefix: '+221',
    currency: 'XOF',
    language: 'fr'
  },
  BURKINA_FASO: {
    code: 'burkina_faso',
    name: 'Burkina Faso',
    nameFrench: 'Burkina Faso',
    flag: '🇧🇫',
    color: '#009639',
    phonePrefix: '+226',
    currency: 'XOF',
    language: 'fr'
  },
  COTE_DIVOIRE: {
    code: 'cote_divoire',
    name: 'Ivory Coast',
    nameFrench: 'Côte d\'Ivoire',
    flag: '🇨🇮',
    color: '#ff8200',
    phonePrefix: '+225',
    currency: 'XOF',
    language: 'fr'
  }
};

export const getCountriesList = () => {
  return Object.values(COUNTRIES);
};

export const getCountryByCode = (code) => {
  const upperCode = code?.toUpperCase();
  return Object.values(COUNTRIES).find(country => 
    country.code === code || country.code === upperCode
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

// Service de géolocalisation GPS pour PWA
class GeolocationService {
  constructor() {
    this.isDetecting = false;
  }

  async detectUserLocation(userCountry = 'mali') {
    if (this.isDetecting) return null;
    
    this.isDetecting = true;
    
    try {
      // Essayer d'abord la géolocalisation native du navigateur
      if (navigator.geolocation) {
        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 300000
            });
          });

          // Géocodage inverse simulé basé sur les coordonnées
          const { latitude, longitude } = position.coords;
          const detectedLocation = await this.reverseGeocode(latitude, longitude, userCountry);
          
          this.isDetecting = false;
          return detectedLocation;
        } catch (geoError) {
          console.log('Géolocalisation GPS échouée, utilisation simulation:', geoError);
          // Fallback vers simulation
        }
      }
      
      // Simulation réaliste pour l'Afrique de l'Ouest
      const locationMappings = {
        'mali': {
          cities: [
            { name: 'Bamako', districts: ['ACI 2000', 'Hippodrome', 'Plateau', 'Badalabougou', 'Heremakono'] },
            { name: 'Sikasso', districts: ['Centre', 'Médina', 'Lafiabougou'] },
            { name: 'Mopti', districts: ['Centre', 'Komoguel', 'Sévaré'] }
          ],
          coordinates: { lat: 12.6392, lng: -8.0029 }
        },
        'senegal': {
          cities: [
            { name: 'Dakar', districts: ['Plateau', 'Médina', 'Grand Dakar', 'Parcelles Assainies', 'Liberté 6'] },
            { name: 'Thiès', districts: ['Centre', 'Randoulène', 'Hersent'] },
            { name: 'Kaolack', districts: ['Médina Baye', 'Dialègne', 'Ndangane'] }
          ],
          coordinates: { lat: 14.6928, lng: -17.4467 }
        },
        'burkina_faso': {
          cities: [
            { name: 'Ouagadougou', districts: ['Zone du Bois', 'Cissin', 'Gounghin', 'Kamsaoghin', 'Bogodogo'] },
            { name: 'Bobo-Dioulasso', districts: ['Secteur 1', 'Secteur 15', 'Koko'] },
            { name: 'Koudougou', districts: ['Centre', 'Issouka', 'Dapoya'] }
          ],
          coordinates: { lat: 12.3714, lng: -1.5197 }
        },
        'cote_divoire': {
          cities: [
            { name: 'Abidjan', districts: ['Plateau', 'Cocody', 'Marcory', 'Treichville', 'Yopougon'] },
            { name: 'Yamoussoukro', districts: ['Centre', 'Habitat', 'Millionnaire'] },
            { name: 'Bouaké', districts: ['Centre', 'Air France 2', 'Koko'] }
          ],
          coordinates: { lat: 5.3600, lng: -4.0083 }
        }
      };

      const countryData = locationMappings[userCountry] || locationMappings['mali'];
      const randomCity = countryData.cities[Math.floor(Math.random() * countryData.cities.length)];
      const randomDistrict = randomCity.districts[Math.floor(Math.random() * randomCity.districts.length)];
      const country = getCountryByCode(userCountry);

      // Simuler temps de détection réaliste
      await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
      
      this.isDetecting = false;
      
      return {
        address: `${randomDistrict}, ${randomCity.name}`,
        fullAddress: `${randomDistrict}, ${randomCity.name}, ${country.nameFrench}`,
        city: randomCity.name,
        district: randomDistrict,
        country: country.nameFrench,
        countryCode: userCountry,
        coordinates: {
          ...countryData.coordinates,
          lat: countryData.coordinates.lat + (Math.random() - 0.5) * 0.1,
          lng: countryData.coordinates.lng + (Math.random() - 0.5) * 0.1
        },
        accuracy: Math.floor(50 + Math.random() * 100),
        timestamp: new Date().toISOString(),
        method: 'simulation'
      };
      
    } catch (error) {
      this.isDetecting = false;
      throw new Error('Impossible de détecter votre position: ' + error.message);
    }
  }

  async reverseGeocode(lat, lng, userCountry) {
    // Simulation de géocodage inverse pour l'Afrique de l'Ouest
    const country = getCountryByCode(userCountry);
    
    // Déterminer la ville la plus proche basée sur les coordonnées
    const cityMappings = {
      'mali': [
        { name: 'Bamako', lat: 12.6392, lng: -8.0029, districts: ['ACI 2000', 'Hippodrome', 'Plateau'] },
        { name: 'Sikasso', lat: 11.3176, lng: -5.6670, districts: ['Centre', 'Médina'] },
        { name: 'Mopti', lat: 14.4843, lng: -4.1960, districts: ['Centre', 'Komoguel'] }
      ],
      'senegal': [
        { name: 'Dakar', lat: 14.6928, lng: -17.4467, districts: ['Plateau', 'Médina', 'Parcelles Assainies'] },
        { name: 'Thiès', lat: 14.7886, lng: -16.9246, districts: ['Centre', 'Randoulène'] }
      ],
      'burkina_faso': [
        { name: 'Ouagadougou', lat: 12.3714, lng: -1.5197, districts: ['Zone du Bois', 'Cissin', 'Gounghin'] },
        { name: 'Bobo-Dioulasso', lat: 11.1781, lng: -4.2978, districts: ['Secteur 1', 'Secteur 15'] }
      ],
      'cote_divoire': [
        { name: 'Abidjan', lat: 5.3600, lng: -4.0083, districts: ['Plateau', 'Cocody', 'Marcory'] },
        { name: 'Yamoussoukro', lat: 6.8276, lng: -5.2893, districts: ['Centre', 'Habitat'] }
      ]
    };

    const cities = cityMappings[userCountry] || cityMappings['mali'];
    
    // Trouver la ville la plus proche
    let closestCity = cities[0];
    let minDistance = this.calculateDistance(lat, lng, closestCity.lat, closestCity.lng);
    
    for (const city of cities) {
      const distance = this.calculateDistance(lat, lng, city.lat, city.lng);
      if (distance < minDistance) {
        minDistance = distance;
        closestCity = city;
      }
    }
    
    const randomDistrict = closestCity.districts[Math.floor(Math.random() * closestCity.districts.length)];
    
    return {
      address: `${randomDistrict}, ${closestCity.name}`,
      fullAddress: `${randomDistrict}, ${closestCity.name}, ${country.nameFrench}`,
      city: closestCity.name,
      district: randomDistrict,
      country: country.nameFrench,
      countryCode: userCountry,
      coordinates: { lat, lng },
      accuracy: Math.floor(10 + Math.random() * 50),
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

// Détection automatique du pays basée sur la géolocalisation
export const detectUserCountry = async () => {
  try {
    // Essayer d'abord la géolocalisation HTML5
    if (navigator.geolocation) {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 5000,
          enableHighAccuracy: false
        });
      });

      const { latitude, longitude } = position.coords;
      console.log(`📍 Position détectée: ${latitude}, ${longitude}`);

      // Approximation géographique pour l'Afrique de l'Ouest
      // Mali: environ 17°N, 4°W
      // Sénégal: environ 14°N, 14°W  
      // Burkina Faso: environ 13°N, 2°W
      // Côte d'Ivoire: environ 8°N, 5°W

      if (latitude >= 10 && latitude <= 25 && longitude >= -18 && longitude <= 5) {
        // Zone géographique Afrique de l'Ouest
        if (longitude <= -10) {
          return COUNTRIES.SENEGAL; // Plus à l'ouest
        } else if (latitude >= 15) {
          return COUNTRIES.MALI; // Plus au nord
        } else if (longitude <= -2) {
          return COUNTRIES.BURKINA_FASO; // Centre-ouest
        } else {
          return COUNTRIES.COTE_DIVOIRE; // Sud-est
        }
      }
    }
  } catch (error) {
    console.log('⚠️ Géolocalisation non disponible:', error.message);
  }

  try {
    // Fallback: détection par IP avec API externe
    const response = await fetch('https://ipapi.co/json/', {
      timeout: 3000
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('🌍 Pays détecté par IP:', data.country_name);
      
      // Mapper les codes pays vers nos constantes
      const countryMapping = {
        'ML': COUNTRIES.MALI,
        'SN': COUNTRIES.SENEGAL, 
        'BF': COUNTRIES.BURKINA_FASO,
        'CI': COUNTRIES.COTE_DIVOIRE
      };
      
      if (countryMapping[data.country_code]) {
        return countryMapping[data.country_code];
      }
    }
  } catch (error) {
    console.log('⚠️ Détection par IP échouée:', error.message);
  }

  // Fallback par défaut: Sénégal (pays le plus connecté de la région)
  console.log('🇸🇳 Utilisation du pays par défaut: Sénégal');
  return COUNTRIES.SENEGAL;
};

// Obtenir l'exemple de numéro de téléphone selon le pays détecté
export const getPhoneExampleForCountry = (country) => {
  const examples = {
    'mali': '+223 70 12 34 56',
    'senegal': '+221 70 12 34 56',
    'burkina_faso': '+226 70 12 34 56',
    'cote_divoire': '+225 07 12 34 56'
  };
  
  return examples[country?.code] || examples['senegal'];
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
  
  return banks[country?.code] || banks['senegal'];
};

export default new GeolocationService();