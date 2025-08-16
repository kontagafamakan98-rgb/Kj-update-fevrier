import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import { useAuth } from '../../contexts/AuthContext';
import { colors } from '../../theme/theme';
import { JOB_CATEGORIES } from '../../constants/jobCategories';
import { workerAPI } from '../../services/api';

export default function WorkerProfileScreen({ navigation }) {
  const { user } = useAuth();
  
  const [profile, setProfile] = useState({
    specialties: [],
    experienceYears: '1',
    hourlyRate: '',
    description: '',
    availability: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user?.user_type === 'worker') {
      loadWorkerProfile();
    } else {
      setLoading(false);
    }
  }, []);

  const loadWorkerProfile = async () => {
    try {
      const response = await workerAPI.getProfile();
      if (response.data) {
        setProfile({
          specialties: response.data.specialties || [],
          experienceYears: response.data.experience_years?.toString() || '1',
          hourlyRate: response.data.hourly_rate?.toString() || '',
          description: response.data.description || '',
          availability: response.data.availability !== false,
        });
      }
    } catch (error) {
      console.log('No worker profile found, creating new one');
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = (key, value) => {
    setProfile(prev => ({ ...prev, [key]: value }));
  };

  const toggleSpecialty = (specialtyId) => {
    setProfile(prev => ({
      ...prev,
      specialties: prev.specialties.includes(specialtyId)
        ? prev.specialties.filter(id => id !== specialtyId)
        : [...prev.specialties, specialtyId]
    }));
  };

  const handleSave = async () => {
    if (profile.specialties.length === 0) {
      Toast.show({
        type: 'error',
        text1: 'Erreur',
        text2: 'Veuillez sélectionner au moins une spécialité',
      });
      return;
    }

    if (!profile.hourlyRate.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Erreur',
        text2: 'Tarif horaire requis',
      });
      return;
    }

    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const profileData = {
        specialties: profile.specialties,
        experience_years: parseInt(profile.experienceYears),
        hourly_rate: parseFloat(profile.hourlyRate),
        description: profile.description.trim(),
        availability: profile.availability,
      };

      await workerAPI.createProfile(profileData);
      
      Toast.show({
        type: 'success',
        text1: 'Succès',
        text2: 'Profil travailleur mis à jour!',
      });
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Erreur',
        text2: error.response?.data?.detail || 'Erreur lors de la sauvegarde',
      });
    } finally {
      setSaving(false);
    }
  };

  if (user?.user_type !== 'worker') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <MaterialIcons name="work-off" size={64} color={colors.textSecondary} />
          <Text style={styles.errorTitle}>Accès restreint</Text>
          <Text style={styles.errorText}>
            Cette section est réservée aux travailleurs
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>Retour</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text>Chargement du profil...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Profil Travailleur</Text>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={[styles.saveButtonText, saving && { opacity: 0.5 }]}>
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Specialties */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Spécialités *</Text>
          <Text style={styles.sectionSubtitle}>Sélectionnez vos domaines d'expertise</Text>
          <View style={styles.specialtiesGrid}>
            {JOB_CATEGORIES.map(category => (
              <TouchableOpacity
                key={category.id}
                style={[
                  styles.specialtyChip,
                  profile.specialties.includes(category.id) && styles.specialtyChipSelected
                ]}
                onPress={() => toggleSpecialty(category.id)}
              >
                <Text style={styles.specialtyIcon}>{category.icon}</Text>
                <Text style={[
                  styles.specialtyText,
                  profile.specialties.includes(category.id) && styles.specialtyTextSelected
                ]}>
                  {category.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Experience */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Années d'expérience</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={profile.experienceYears}
              onValueChange={(value) => updateProfile('experienceYears', value)}
              style={styles.picker}
            >
              <Picker.Item label="Moins d'1 an" value="0" />
              <Picker.Item label="1 année" value="1" />
              <Picker.Item label="2 années" value="2" />
              <Picker.Item label="3-5 années" value="4" />
              <Picker.Item label="5-10 années" value="7" />
              <Picker.Item label="Plus de 10 ans" value="15" />
            </Picker>
          </View>
        </View>

        {/* Rate */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tarif horaire (€) *</Text>
          <TextInput
            style={styles.input}
            value={profile.hourlyRate}
            onChangeText={(value) => updateProfile('hourlyRate', value)}
            placeholder="Ex: 15"
            keyboardType="numeric"
          />
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.sectionSubtitle}>Présentez vos compétences et expériences</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={profile.description}
            onChangeText={(value) => updateProfile('description', value)}
            placeholder="Décrivez votre expertise, vos réalisations, vos certifications..."
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Availability */}
        <View style={styles.section}>
          <View style={styles.availabilityContainer}>
            <View style={styles.availabilityInfo}>
              <Text style={styles.sectionTitle}>Disponibilité</Text>
              <Text style={styles.sectionSubtitle}>
                {profile.availability ? 'Vous êtes disponible pour de nouveaux projets' : 'Vous n\'êtes pas disponible actuellement'}
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.availabilityToggle,
                profile.availability && styles.availabilityToggleActive
              ]}
              onPress={() => updateProfile('availability', !profile.availability)}
            >
              <View style={[
                styles.availabilitySlider,
                profile.availability && styles.availabilitySliderActive
              ]} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Portfolio placeholder */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Portfolio</Text>
          <TouchableOpacity style={styles.uploadButton}>
            <MaterialIcons name="add-photo-alternate" size={24} color={colors.textSecondary} />
            <Text style={styles.uploadButtonText}>Ajouter des photos de vos réalisations</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  backButtonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '600',
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
  headerButton: {
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
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  content: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  specialtiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  specialtyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  specialtyChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  specialtyIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  specialtyText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  specialtyTextSelected: {
    color: colors.background,
  },
  pickerContainer: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  picker: {
    color: colors.text,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textArea: {
    height: 120,
    textAlignVertical: 'top',
  },
  availabilityContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  availabilityInfo: {
    flex: 1,
    marginRight: 16,
  },
  availabilityToggle: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  availabilityToggleActive: {
    backgroundColor: colors.primary,
  },
  availabilitySlider: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.background,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  availabilitySliderActive: {
    transform: [{ translateX: 20 }],
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  uploadButtonText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginLeft: 8,
  },
});