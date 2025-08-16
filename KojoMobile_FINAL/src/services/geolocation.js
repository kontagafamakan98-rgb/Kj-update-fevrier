import { Alert } from 'react-native';
import { COUNTRIES, getCountryByCode } from '../constants/countries';

class GeolocationService {
  constructor() {
    this.isDetecting = false;
  }

  async detectUserLocation(userCountry = 'mali') {
    if (this.isDetecting) return null;
    
    this.isDetecting = true;
    
    try {
      // In production, use expo-location:
      // const { status } = await Location.requestForegroundPermissionsAsync();
      // if (status !== 'granted') {
      //   throw new Error('Permission refusée');
      // }
      // const location = await Location.getCurrentPositionAsync({});
      // const geocoded = await Location.reverseGeocodeAsync(location.coords);
      
      // Simulate GPS detection with realistic West African locations
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

      // Simulate realistic detection time
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
          // Add small random offset for district-level precision
          lat: countryData.coordinates.lat + (Math.random() - 0.5) * 0.1,
          lng: countryData.coordinates.lng + (Math.random() - 0.5) * 0.1
        },
        accuracy: Math.floor(50 + Math.random() * 100), // meters
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.isDetecting = false;
      throw new Error('Impossible de détecter votre position: ' + error.message);
    }
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

  formatPhoneWithLocation(phone, detectedLocation) {
    if (!detectedLocation || !phone) return phone;
    
    const country = getCountryByCode(detectedLocation.countryCode);
    if (!country) return phone;

    const cleanPhone = phone.replace(/[^\d]/g, '');
    
    // If phone already has country prefix, return as is
    if (phone.includes(country.phonePrefix)) {
      return phone;
    }

    // If phone starts with 0, replace with country prefix
    if (cleanPhone.startsWith('0')) {
      return country.phonePrefix + ' ' + cleanPhone.substring(1);
    }

    // Add country prefix
    return country.phonePrefix + ' ' + cleanPhone;
  }

  showLocationAlert(detectedLocation, onConfirm, onCancel) {
    Alert.alert(
      '📍 Localisation détectée',
      `Nous avons détecté que vous êtes à:\n\n${detectedLocation.fullAddress}\n\nPrécision: ±${detectedLocation.accuracy}m`,
      [
        {
          text: 'Modifier',
          style: 'cancel',
          onPress: onCancel
        },
        {
          text: 'Utiliser cette position',
          onPress: () => onConfirm(detectedLocation)
        }
      ]
    );
  }
}

export default new GeolocationService();