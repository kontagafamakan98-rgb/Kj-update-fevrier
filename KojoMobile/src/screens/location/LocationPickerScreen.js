import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useLocation } from '../../contexts/LocationContext';
import { colors } from '../../theme/theme';

export default function LocationPickerScreen({ navigation }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const { getCurrentLocation, location, address } = useLocation();

  // Suggestions d'exemple pour les pays supportés
  const defaultSuggestions = [
    { id: '1', name: 'Bamako, Mali', subtitle: 'Capitale du Mali', coordinates: { latitude: 12.6392, longitude: -8.0029 } },
    { id: '2', name: 'Dakar, Sénégal', subtitle: 'Capitale du Sénégal', coordinates: { latitude: 14.6928, longitude: -17.4467 } },
    { id: '3', name: 'Ouagadougou, Burkina Faso', subtitle: 'Capitale du Burkina Faso', coordinates: { latitude: 12.3714, longitude: -1.5197 } },
    { id: '4', name: 'Abidjan, Côte d\'Ivoire', subtitle: 'Centre économique', coordinates: { latitude: 5.3600, longitude: -4.0083 } },
  ];

  useEffect(() => {
    setSuggestions(defaultSuggestions);
  }, []);

  const handleCurrentLocation = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await getCurrentLocation();
    if (result.success) {
      navigation.goBack();
    }
  };

  const handleLocationSelect = (selectedLocation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Dans une vraie app, on sauvegarderait la location sélectionnée
    navigation.goBack();
  };

  const renderLocationItem = ({ item }) => (
    <TouchableOpacity
      style={styles.locationItem}
      onPress={() => handleLocationSelect(item)}
      activeOpacity={0.8}
    >
      <MaterialIcons name="location-on" size={24} color={colors.primary} />
      <View style={styles.locationInfo}>
        <Text style={styles.locationName}>{item.name}</Text>
        <Text style={styles.locationSubtitle}>{item.subtitle}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );

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
        <Text style={styles.title}>Choisir une localisation</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <MaterialIcons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher une ville..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor={colors.textSecondary}
        />
      </View>

      {/* Current Location Button */}
      <TouchableOpacity
        style={styles.currentLocationButton}
        onPress={handleCurrentLocation}
        activeOpacity={0.8}
      >
        <MaterialIcons name="my-location" size={24} color={colors.primary} />
        <View style={styles.currentLocationInfo}>
          <Text style={styles.currentLocationText}>Utiliser ma position actuelle</Text>
          {address && (
            <Text style={styles.currentLocationSubtext}>{address.formatted}</Text>
          )}
        </View>
      </TouchableOpacity>

      {/* Suggestions */}
      <Text style={styles.sectionTitle}>Villes suggérées</Text>
      <FlatList
        data={suggestions}
        renderItem={renderLocationItem}
        keyExtractor={(item) => item.id}
        style={styles.suggestionsList}
        showsVerticalScrollIndicator={false}
      />
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
    borderBottomColor: colors.borderLight,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
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
  currentLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  currentLocationInfo: {
    flex: 1,
    marginLeft: 12,
  },
  currentLocationText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  currentLocationSubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  suggestionsList: {
    flex: 1,
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  locationInfo: {
    flex: 1,
    marginLeft: 12,
  },
  locationName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  locationSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
});