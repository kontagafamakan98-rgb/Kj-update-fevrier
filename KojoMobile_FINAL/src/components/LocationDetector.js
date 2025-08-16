import React, { useState } from 'react';
import { Alert } from 'react-native';
import { COUNTRIES, getCountryByCode } from '../constants/countries';

export const useLocationDetector = (userCountry = 'mali') => {
  const [isDetecting, setIsDetecting] = useState(false);

  const detectCurrentLocation = async () => {
    setIsDetecting(true);
    
    try {
      // In a real app, you would use expo-location here:
      // const { status } = await Location.requestForegroundPermissionsAsync();
      // if (status !== 'granted') {
      //   Alert.alert('Permission refusée', 'L\'accès à la localisation est requis');
      //   return null;
      // }
      // const location = await Location.getCurrentPositionAsync({});
      // const geocoded = await Location.reverseGeocodeAsync(location.coords);
      
      // For demo purposes, simulate GPS detection based on user's country
      const country = getCountryByCode(userCountry);
      const cityMappings = {
        'mali': { 
          city: 'Bamako', 
          country: 'Mali',
          coordinates: { lat: 12.6392, lng: -8.0029 },
          districts: ['ACI 2000', 'Hippodrome', 'Plateau', 'Badalabougou']
        },
        'senegal': { 
          city: 'Dakar', 
          country: 'Sénégal',
          coordinates: { lat: 14.6928, lng: -17.4467 },
          districts: ['Plateau', 'Médina', 'Grand Dakar', 'Parcelles Assainies']
        },
        'burkina_faso': { 
          city: 'Ouagadougou', 
          country: 'Burkina Faso',
          coordinates: { lat: 12.3714, lng: -1.5197 },
          districts: ['Zone du Bois', 'Cissin', 'Gounghin', 'Kamsaoghin']
        },
        'cote_divoire': { 
          city: 'Abidjan', 
          country: 'Côte d\'Ivoire',
          coordinates: { lat: 5.3600, lng: -4.0083 },
          districts: ['Plateau', 'Cocody', 'Marcory', 'Treichville']
        }
      };

      const locationData = cityMappings[userCountry] || cityMappings['mali'];
      const randomDistrict = locationData.districts[Math.floor(Math.random() * locationData.districts.length)];
      
      // Simulate detection delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const detectedLocation = {
        fullAddress: `${randomDistrict}, ${locationData.city}, ${locationData.country}`,
        city: locationData.city,
        country: locationData.country,
        district: randomDistrict,
        coordinates: locationData.coordinates,
        countryCode: userCountry
      };

      setIsDetecting(false);
      return detectedLocation;
      
    } catch (error) {
      setIsDetecting(false);
      Alert.alert('Erreur', 'Impossible de détecter votre position');
      return null;
    }
  };

  const showLocationPicker = (onLocationSelect) => {
    const country = getCountryByCode(userCountry);
    const cities = {
      'mali': ['Bamako', 'Sikasso', 'Mopti', 'Ségou', 'Kayes'],
      'senegal': ['Dakar', 'Thiès', 'Kaolack', 'Saint-Louis', 'Ziguinchor'],
      'burkina_faso': ['Ouagadougou', 'Bobo-Dioulasso', 'Koudougou', 'Ouahigouya', 'Banfora'],
      'cote_divoire': ['Abidjan', 'Yamoussoukro', 'Bouaké', 'Daloa', 'Korhogo']
    };

    const countrysCities = cities[userCountry] || cities['mali'];
    
    Alert.alert(
      'Choisir une ville',
      `Sélectionnez votre ville au ${country.nameFrench}`,
      [
        ...countrysCities.map(city => ({
          text: city,
          onPress: () => onLocationSelect(`${city}, ${country.nameFrench}`)
        })),
        { text: 'Annuler', style: 'cancel' }
      ]
    );
  };

  return {
    detectCurrentLocation,
    showLocationPicker,
    isDetecting
  };
};

export const getLocationSuggestions = (countryCode) => {
  const suggestions = {
    'mali': [
      'Bamako, Commune I', 'Bamako, Commune II', 'Bamako, Commune III',
      'Bamako, Commune IV', 'Bamako, Commune V', 'Bamako, Commune VI',
      'Sikasso', 'Mopti', 'Ségou', 'Kayes', 'Gao', 'Tombouctou'
    ],
    'senegal': [
      'Dakar, Plateau', 'Dakar, Médina', 'Dakar, Grand Dakar',
      'Thiès', 'Kaolack', 'Saint-Louis', 'Ziguinchor', 'Diourbel', 'Fatick'
    ],
    'burkina_faso': [
      'Ouagadougou, Zone du Bois', 'Ouagadougou, Cissin', 'Ouagadougou, Gounghin',
      'Bobo-Dioulasso', 'Koudougou', 'Ouahigouya', 'Banfora', 'Dédougou'
    ],
    'cote_divoire': [
      'Abidjan, Plateau', 'Abidjan, Cocody', 'Abidjan, Marcory', 'Abidjan, Treichville',
      'Yamoussoukro', 'Bouaké', 'Daloa', 'Korhogo', 'San-Pédro'
    ]
  };

  return suggestions[countryCode] || suggestions['mali'];
};

export default useLocationDetector;