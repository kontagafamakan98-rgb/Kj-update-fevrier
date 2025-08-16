import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

import { useAuth } from '../../contexts/AuthContext';
import { useLocation } from '../../contexts/LocationContext';
import { colors } from '../../theme/theme';
import { JOB_CATEGORIES } from '../../constants/jobCategories';
import { jobsAPI } from '../../services/api';

export default function CreateJobScreen({ navigation }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'plumbing',
    budgetMin: '',
    budgetMax: '',
    estimatedDuration: '',
    requiredSkills: '',
  });
  const [loading, setLoading] = useState(false);

  const { user } = useAuth();
  const { location, getCurrentLocation } = useLocation();

  const updateFormData = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const validateForm = () => {
    if (!formData.title.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Erreur',
        text2: 'Titre du job requis',
      });
      return false;
    }

    if (!formData.description.trim()) {
      Toast.show({
        type: 'error',
        text1: 'Erreur',
        text2: 'Description requise',
      });
      return false;
    }

    if (!formData.budgetMin || !formData.budgetMax) {
      Toast.show({
        type: 'error',
        text1: 'Erreur',
        text2: 'Budget min et max requis',
      });
      return false;
    }

    if (parseFloat(formData.budgetMin) >= parseFloat(formData.budgetMax)) {
      Toast.show({
        type: 'error',
        text1: 'Erreur',
        text2: 'Le budget minimum doit être inférieur au maximum',
      });
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const jobData = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        category: formData.category,
        budget_min: parseFloat(formData.budgetMin),
        budget_max: parseFloat(formData.budgetMax),
        location: {
          address: location ? 'Localisation actuelle' : 'Non spécifiée',
          latitude: location?.latitude || 0,
          longitude: location?.longitude || 0,
        },
        required_skills: formData.requiredSkills.split(',').map(s => s.trim()).filter(s => s),
        estimated_duration: formData.estimatedDuration || null,
      };

      const response = await jobsAPI.createJob(jobData);
      
      Toast.show({
        type: 'success',
        text1: 'Succès',
        text2: 'Job créé avec succès!',
      });
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (error) {
      console.error('Error creating job:', error);
      Toast.show({
        type: 'error',
        text1: 'Erreur',
        text2: 'Erreur lors de la création du job',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLocationPress = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await getCurrentLocation();
    if (result.success) {
      Toast.show({
        type: 'success',
        text1: 'Succès',
        text2: 'Localisation mise à jour',
      });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <MaterialIcons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Créer un job</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Form */}
          <View style={styles.form}>
            {/* Title */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Titre du job *</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: Réparation de plomberie"
                value={formData.title}
                onChangeText={(value) => updateFormData('title', value)}
              />
            </View>

            {/* Category */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Catégorie *</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={formData.category}
                  onValueChange={(value) => updateFormData('category', value)}
                  style={styles.picker}
                >
                  {JOB_CATEGORIES.map(category => (
                    <Picker.Item
                      key={category.id}
                      label={`${category.icon} ${category.name}`}
                      value={category.id}
                    />
                  ))}
                </Picker>
              </View>
            </View>

            {/* Description */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Description *</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Décrivez le travail à effectuer..."
                value={formData.description}
                onChangeText={(value) => updateFormData('description', value)}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            {/* Budget */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Budget (€) *</Text>
              <View style={styles.row}>
                <View style={styles.halfWidth}>
                  <TextInput
                    style={styles.input}
                    placeholder="Min"
                    value={formData.budgetMin}
                    onChangeText={(value) => updateFormData('budgetMin', value)}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.halfWidth}>
                  <TextInput
                    style={styles.input}
                    placeholder="Max"
                    value={formData.budgetMax}
                    onChangeText={(value) => updateFormData('budgetMax', value)}
                    keyboardType="numeric"
                  />
                </View>
              </View>
            </View>

            {/* Duration */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Durée estimée</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: 2 heures, 1 jour, 1 semaine"
                value={formData.estimatedDuration}
                onChangeText={(value) => updateFormData('estimatedDuration', value)}
              />
            </View>

            {/* Skills */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Compétences requises</Text>
              <TextInput
                style={styles.input}
                placeholder="Séparez par des virgules"
                value={formData.requiredSkills}
                onChangeText={(value) => updateFormData('requiredSkills', value)}
              />
            </View>

            {/* Location */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Localisation</Text>
              <TouchableOpacity
                style={styles.locationButton}
                onPress={handleLocationPress}
              >
                <MaterialIcons name="location-on" size={20} color={colors.primary} />
                <Text style={styles.locationText}>
                  {location ? 'Localisation actuelle' : 'Ajouter une localisation'}
                </Text>
                <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>

        {/* Submit Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.submitButtonText}>
              {loading ? 'Création...' : 'Publier le job'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
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
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  form: {
    flex: 1,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
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
  pickerContainer: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  picker: {
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationText: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    marginLeft: 12,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  submitButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: colors.background,
    fontSize: 18,
    fontWeight: '600',
  },
});