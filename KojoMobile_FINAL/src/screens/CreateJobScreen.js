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

import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme/theme';
import { JOB_CATEGORIES } from '../constants/categories';
import { COUNTRIES, getCountryByCode } from '../constants/countries';

export default function CreateJobScreen({ navigation }) {
  const { user } = useAuth();
  
  // Get user's country info for auto-location
  const userCountry = getCountryByCode(user?.country);
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'general',
    budget_min: '',
    budget_max: '',
    location: `${userCountry?.nameFrench || 'Mali'}`, // Auto-fill with user's country
    deadline: '',
    requirements: '',
    urgency: 'normal',
  });
  
  const [loading, setLoading] = useState(false);

  const updateFormData = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const validateForm = () => {
    if (!formData.title.trim()) {
      Alert.alert('Erreur', 'Le titre est requis');
      return false;
    }
    if (!formData.description.trim()) {
      Alert.alert('Erreur', 'La description est requise');
      return false;
    }
    if (!formData.budget_min || !formData.budget_max) {
      Alert.alert('Erreur', 'Le budget est requis');
      return false;
    }
    if (parseInt(formData.budget_min) >= parseInt(formData.budget_max)) {
      Alert.alert('Erreur', 'Le budget minimum doit être inférieur au maximum');
      return false;
    }
    if (!formData.location.trim()) {
      Alert.alert('Erreur', 'La localisation est requise');
      return false;
    }
    return true;
  };

  const handlePublish = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const jobData = {
        ...formData,
        budget_min: parseInt(formData.budget_min),
        budget_max: parseInt(formData.budget_max),
        client_id: user?.id,
        status: 'open',
        created_at: new Date().toISOString(),
      };

      // In a real app, make API call to create job
      // const response = await api.post('/jobs', jobData);
      
      Alert.alert(
        'Succès',
        'Votre job a été publié avec succès !',
        [
          {
            text: 'Voir le job',
            onPress: () => {
              navigation.navigate('Jobs');
              navigation.navigate('JobDetails', { jobId: 'new', job: jobData });
            }
          },
          {
            text: 'Retour au tableau de bord',
            onPress: () => navigation.navigate('Dashboard')
          }
        ]
      );
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de publier le job');
    } finally {
      setLoading(false);
    }
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
        <Text style={styles.headerTitle}>Créer un job</Text>
        <TouchableOpacity
          style={styles.publishButton}
          onPress={handlePublish}
          disabled={loading}
        >
          <Text style={[styles.publishButtonText, loading && styles.publishButtonTextDisabled]}>
            {loading ? 'Publication...' : 'Publier'}
          </Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* Job Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Détails du job</Text>
            
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Titre du job *</Text>
              <TextInput
                style={styles.input}
                value={formData.title}
                onChangeText={(value) => updateFormData('title', value)}
                placeholder="Ex: Réparation plomberie urgent"
                maxLength={100}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Description *</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={formData.description}
                onChangeText={(value) => updateFormData('description', value)}
                placeholder="Décrivez en détail le travail à effectuer..."
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                maxLength={500}
              />
              <Text style={styles.inputHelper}>
                {formData.description.length}/500 caractères
              </Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Catégorie *</Text>
              <View style={styles.pickerWrapper}>
                <Picker
                  selectedValue={formData.category}
                  onValueChange={(value) => updateFormData('category', value)}
                  style={styles.picker}
                >
                  {JOB_CATEGORIES.map(category => (
                    <Picker.Item
                      key={category.key}
                      label={`${category.icon} ${category.name}`}
                      value={category.key}
                    />
                  ))}
                </Picker>
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Localisation *</Text>
              <View style={styles.locationInputContainer}>
                <TextInput
                  style={[styles.input, styles.locationInput]}
                  value={formData.location}
                  onChangeText={(value) => updateFormData('location', value)}
                  placeholder="Ex: Bamako, Mali"
                />
                <TouchableOpacity style={styles.locationButton}>
                  <MaterialIcons name="my-location" size={20} color={colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Budget */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Budget</Text>
            
            <View style={styles.row}>
              <View style={[styles.inputContainer, styles.halfWidth]}>
                <Text style={styles.inputLabel}>Budget min (XOF) *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.budget_min}
                  onChangeText={(value) => updateFormData('budget_min', value)}
                  placeholder="10000"
                  keyboardType="numeric"
                />
              </View>
              <View style={[styles.inputContainer, styles.halfWidth]}>
                <Text style={styles.inputLabel}>Budget max (XOF) *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.budget_max}
                  onChangeText={(value) => updateFormData('budget_max', value)}
                  placeholder="20000"
                  keyboardType="numeric"
                />
              </View>
            </View>
            
            <Text style={styles.budgetHelper}>
              💡 Un budget réaliste attire plus de candidats qualifiés
            </Text>
          </View>

          {/* Requirements & Timeline */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Exigences et délais</Text>
            
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Exigences particulières</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={formData.requirements}
                onChangeText={(value) => updateFormData('requirements', value)}
                placeholder="Ex: Expérience minimum 3 ans, outils fournis, disponible le weekend..."
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                maxLength={300}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Date limite souhaitée</Text>
              <TouchableOpacity style={styles.dateInput}>
                <TextInput
                  style={[styles.input, styles.dateInputText]}
                  value={formData.deadline}
                  onChangeText={(value) => updateFormData('deadline', value)}
                  placeholder="JJ/MM/AAAA"
                  editable={false}
                />
                <MaterialIcons name="calendar-today" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.inputHelper}>Laissez vide si pas de deadline</Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Urgence</Text>
              <View style={styles.urgencyContainer}>
                {[
                  { key: 'low', label: 'Pas urgent', icon: 'schedule', color: colors.success },
                  { key: 'normal', label: 'Normal', icon: 'access-time', color: colors.warning },
                  { key: 'high', label: 'Urgent', icon: 'priority-high', color: colors.error }
                ].map(urgency => (
                  <TouchableOpacity
                    key={urgency.key}
                    style={[
                      styles.urgencyOption,
                      formData.urgency === urgency.key && styles.urgencyOptionActive
                    ]}
                    onPress={() => updateFormData('urgency', urgency.key)}
                  >
                    <MaterialIcons
                      name={urgency.icon}
                      size={20}
                      color={formData.urgency === urgency.key ? colors.background : urgency.color}
                    />
                    <Text style={[
                      styles.urgencyText,
                      formData.urgency === urgency.key && styles.urgencyTextActive
                    ]}>
                      {urgency.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* Tips */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>💡 Conseils pour un bon job</Text>
            <View style={styles.tipsContainer}>
              <View style={styles.tipItem}>
                <MaterialIcons name="check-circle" size={16} color={colors.success} />
                <Text style={styles.tipText}>Soyez précis dans la description</Text>
              </View>
              <View style={styles.tipItem}>
                <MaterialIcons name="check-circle" size={16} color={colors.success} />
                <Text style={styles.tipText}>Proposez un budget réaliste</Text>
              </View>
              <View style={styles.tipItem}>
                <MaterialIcons name="check-circle" size={16} color={colors.success} />
                <Text style={styles.tipText}>Répondez rapidement aux candidatures</Text>
              </View>
              <View style={styles.tipItem}>
                <MaterialIcons name="check-circle" size={16} color={colors.success} />
                <Text style={styles.tipText}>Ajoutez des photos si nécessaire</Text>
              </View>
            </View>
          </View>
        </ScrollView>
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
  publishButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  publishButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  publishButtonTextDisabled: {
    color: colors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
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
    height: 100,
    textAlignVertical: 'top',
  },
  inputHelper: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  pickerWrapper: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  picker: {
    color: colors.text,
  },
  locationInputContainer: {
    position: 'relative',
  },
  locationInput: {
    paddingRight: 50,
  },
  locationButton: {
    position: 'absolute',
    right: 16,
    top: 16,
    padding: 4,
  },
  budgetHelper: {
    fontSize: 14,
    color: colors.primary,
    backgroundColor: colors.primary + '10',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  dateInput: {
    position: 'relative',
  },
  dateInputText: {
    paddingRight: 50,
  },
  urgencyContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  urgencyOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  urgencyOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  urgencyText: {
    fontSize: 12,
    color: colors.text,
    marginLeft: 4,
    fontWeight: '500',
  },
  urgencyTextActive: {
    color: colors.background,
  },
  tipsContainer: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 12,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  tipText: {
    fontSize: 14,
    color: colors.text,
    marginLeft: 8,
    flex: 1,
  },
});