import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { colors } from '../theme/theme';
import { COUNTRIES } from '../constants/countries';

export default function LocationPickerScreen({ route, navigation }) {
  const { onLocationSelect } = route.params;
  
  const [searchQuery, setSearchQuery] = useState('');
  const [locations, setLocations] = useState([]);
  const [filteredLocations, setFilteredLocations] = useState([]);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(false);

  // Sample locations data for West Africa
  const sampleLocations = [
    // Mali
    { id: '1', name: 'Bamako', country: 'Mali', type: 'city', countryCode: 'mali' },
    { id: '2', name: 'Sikasso', country: 'Mali', type: 'city', countryCode: 'mali' },
    { id: '3', name: 'Mopti', country: 'Mali', type: 'city', countryCode: 'mali' },
    { id: '4', name: 'Ségou', country: 'Mali', type: 'city', countryCode: 'mali' },
    { id: '5', name: 'Kayes', country: 'Mali', type: 'city', countryCode: 'mali' },
    
    // Senegal
    { id: '6', name: 'Dakar', country: 'Sénégal', type: 'city', countryCode: 'senegal' },
    { id: '7', name: 'Thiès', country: 'Sénégal', type: 'city', countryCode: 'senegal' },
    { id: '8', name: 'Kaolack', country: 'Sénégal', type: 'city', countryCode: 'senegal' },
    { id: '9', name: 'Saint-Louis', country: 'Sénégal', type: 'city', countryCode: 'senegal' },
    { id: '10', name: 'Ziguinchor', country: 'Sénégal', type: 'city', countryCode: 'senegal' },
    
    // Burkina Faso
    { id: '11', name: 'Ouagadougou', country: 'Burkina Faso', type: 'city', countryCode: 'burkina_faso' },
    { id: '12', name: 'Bobo-Dioulasso', country: 'Burkina Faso', type: 'city', countryCode: 'burkina_faso' },
    { id: '13', name: 'Koudougou', country: 'Burkina Faso', type: 'city', countryCode: 'burkina_faso' },
    { id: '14', name: 'Ouahigouya', country: 'Burkina Faso', type: 'city', countryCode: 'burkina_faso' },
    
    // Côte d'Ivoire
    { id: '15', name: 'Abidjan', country: 'Côte d\'Ivoire', type: 'city', countryCode: 'cote_divoire' },
    { id: '16', name: 'Yamoussoukro', country: 'Côte d\'Ivoire', type: 'city', countryCode: 'cote_divoire' },
    { id: '17', name: 'Bouaké', country: 'Côte d\'Ivoire', type: 'city', countryCode: 'cote_divoire' },
    { id: '18', name: 'Daloa', country: 'Côte d\'Ivoire', type: 'city', countryCode: 'cote_divoire' },
    { id: '19', name: 'Korhogo', country: 'Côte d\'Ivoire', type: 'city', countryCode: 'cote_divoire' },
  ];

  useEffect(() => {
    setLocations(sampleLocations);
    setFilteredLocations(sampleLocations);
  }, []);

  useEffect(() => {
    if (searchQuery.trim()) {
      const filtered = locations.filter(location =>
        location.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        location.country.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredLocations(filtered);
    } else {
      setFilteredLocations(locations);
    }
  }, [searchQuery, locations]);

  const handleCurrentLocation = async () => {
    setIsLocating(true);
    try {
      // In a real app, use Expo Location API here
      // const { status } = await Location.requestForegroundPermissionsAsync();
      // if (status !== 'granted') {
      //   Alert.alert('Permission refusée', 'L\'accès à la localisation est requis');
      //   return;
      // }
      // const location = await Location.getCurrentPositionAsync({});
      // const geocoded = await Location.reverseGeocodeAsync(location.coords);
      
      // For demo purposes, simulate location detection
      setTimeout(() => {
        const mockLocation = {
          name: 'Bamako',
          country: 'Mali',
          type: 'current',
          coordinates: { lat: 12.6392, lng: -8.0029 }
        };
        setCurrentLocation(mockLocation);
        setIsLocating(false);
        Alert.alert('Localisation détectée', `Vous êtes à ${mockLocation.name}, ${mockLocation.country}`);
      }, 2000);
      
    } catch (error) {
      setIsLocating(false);
      Alert.alert('Erreur', 'Impossible de détecter votre localisation');
    }
  };

  const handleLocationSelect = (location) => {
    const selectedLocation = {
      name: location.name,
      country: location.country,
      fullName: `${location.name}, ${location.country}`,
      coordinates: location.coordinates
    };
    
    if (onLocationSelect) {
      onLocationSelect(selectedLocation);
    }
    navigation.goBack();
  };

  const renderLocationItem = ({ item: location }) => {
    const country = COUNTRIES[location.countryCode?.toUpperCase()];
    
    return (
      <TouchableOpacity
        style={styles.locationItem}
        onPress={() => handleLocationSelect(location)}
        activeOpacity={0.8}
      >
        <View style={styles.locationIcon}>
          {location.type === 'current' ? (
            <MaterialIcons name="my-location" size={20} color={colors.primary} />
          ) : (
            <Text style={styles.countryFlag}>{country?.flag || '📍'}</Text>
          )}
        </View>
        
        <View style={styles.locationInfo}>
          <Text style={styles.locationName}>{location.name}</Text>
          <Text style={styles.locationCountry}>{location.country}</Text>
        </View>
        
        <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choisir la localisation</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <MaterialIcons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher une ville..."
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => setSearchQuery('')}
          >
            <MaterialIcons name="clear" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Current Location */}
      <TouchableOpacity
        style={styles.currentLocationButton}
        onPress={handleCurrentLocation}
        disabled={isLocating}
        activeOpacity={0.8}
      >
        <MaterialIcons 
          name={isLocating ? "hourglass-empty" : "my-location"} 
          size={20} 
          color={colors.primary} 
        />
        <Text style={styles.currentLocationText}>
          {isLocating ? 'Localisation en cours...' : 'Utiliser ma position actuelle'}
        </Text>
      </TouchableOpacity>

      {/* Current Location Result */}
      {currentLocation && (
        <View style={styles.currentLocationResult}>
          {renderLocationItem({ item: currentLocation })}
        </View>
      )}

      {/* Popular Locations Header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Villes populaires</Text>
      </View>

      {/* Locations List */}
      <FlatList
        data={filteredLocations}
        renderItem={renderLocationItem}
        keyExtractor={(item) => item.id}
        style={styles.locationsList}
        showsVerticalScrollIndicator={false}
        ListEmptyState={
          <View style={styles.emptyState}>
            <MaterialIcons name="location-off" size={64} color={colors.textSecondary} />
            <Text style={styles.emptyStateTitle}>Aucune ville trouvée</Text>
            <Text style={styles.emptyStateText}>
              Essayez de modifier votre recherche
            </Text>
          </View>
        }
      />

      {/* Manual Entry */}
      <View style={styles.manualEntryContainer}>
        <TouchableOpacity
          style={styles.manualEntryButton}
          onPress={() => {
            Alert.prompt(
              'Localisation personnalisée',
              'Entrez votre localisation manuellement:',
              [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Valider',
                  onPress: (text) => {
                    if (text && text.trim()) {
                      const customLocation = {
                        name: text.trim(),
                        country: 'Personnalisé',
                        type: 'custom',
                        fullName: text.trim()
                      };
                      handleLocationSelect(customLocation);
                    }
                  }
                }
              ],
              'plain-text',
              'Ex: Quartier Hippodrome, Bamako'
            );
          }}
        >
          <MaterialIcons name="edit-location" size={20} color={colors.primary} />
          <Text style={styles.manualEntryText}>Entrer manuellement</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  headerRight: {
    width: 40,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 20,
    marginVertical: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 16,
  },
  clearButton: {
    padding: 4,
  },
  currentLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '10',
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary + '20',
  },
  currentLocationText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '500',
    marginLeft: 12,
  },
  currentLocationResult: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: colors.success + '10',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.success + '20',
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  locationsList: {
    flex: 1,
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  locationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  countryFlag: {
    fontSize: 18,
  },
  locationInfo: {
    flex: 1,
  },
  locationName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 2,
  },
  locationCountry: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  manualEntryContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.surface,
  },
  manualEntryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  manualEntryText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '500',
    marginLeft: 8,
  },
});