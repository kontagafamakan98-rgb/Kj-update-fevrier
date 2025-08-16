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
import { COUNTRIES, getPhonePrefixByCountry, formatPhoneNumber } from '../constants/countries';
import ProfilePhoto from '../components/ProfilePhoto';

export default function EditProfileScreen({ navigation }) {
  const { user, updateProfilePhoto } = useAuth();
  
  const [formData, setFormData] = useState({
    firstName: user?.first_name || '',
    lastName: user?.last_name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    country: user?.country || 'mali',
    bio: user?.bio || '',
    skills: user?.skills || '',
    hourlyRate: user?.hourly_rate?.toString() || '',
  });
  
  const [loading, setLoading] = useState(false);

  const handlePhotoChange = async (result) => {
    if (result.success) {
      Alert.alert('Succès', 'Photo de profil mise à jour avec succès');
    } else if (result.deleted) {
      Alert.alert('Succès', 'Photo de profil supprimée');
    } else {
      Alert.alert('Erreur', result.error || 'Impossible de mettre à jour la photo');
    }
  };

  const updateFormData = (key, value) => {
    setFormData(prev => {
      const newData = { ...prev, [key]: value };
      
      // Auto-update phone prefix when country changes
      if (key === 'country') {
        const phonePrefix = getPhonePrefixByCountry(value);
        
        // Format existing phone number with new country prefix
        if (newData.phone && !newData.phone.startsWith(phonePrefix)) {
          newData.phone = formatPhoneNumber(newData.phone, value);
        }
      }
      
      return newData;
    });
  };

  const handleSave = async () => {
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      Alert.alert('Erreur', 'Le nom et prénom sont requis');
      return;
    }

    setLoading(true);
    try {
      // In a real app, make API call to update profile
      // const response = await api.put('/users/profile', formData);
      
      Alert.alert('Succès', 'Profil mis à jour avec succès', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de mettre à jour le profil');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Supprimer le compte',
      'Êtes-vous sûr de vouloir supprimer définitivement votre compte ? Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Compte supprimé', 'Votre compte a été supprimé avec succès');
            // In real app: await api.delete('/users/account') then logout
          }
        }
      ]
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
        <Text style={styles.headerTitle}>Modifier le profil</Text>
        <TouchableOpacity
          style={styles.saveButton}
          onPress={handleSave}
          disabled={loading}
        >
          <Text style={[styles.saveButtonText, loading && styles.saveButtonTextDisabled]}>
            {loading ? 'Sauvegarde...' : 'Sauvegarder'}
          </Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* Profile Photo Section */}
          <View style={styles.photoSection}>
            <View style={styles.photoContainer}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {formData.firstName.charAt(0).toUpperCase()}
                </Text>
              </View>
              <TouchableOpacity style={styles.cameraButton}>
                <MaterialIcons name="camera-alt" size={20} color={colors.background} />
              </TouchableOpacity>
            </View>
            <Text style={styles.photoText}>Changer la photo de profil</Text>
          </View>

          {/* Personal Information */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Informations personnelles</Text>
            
            <View style={styles.row}>
              <View style={[styles.inputContainer, styles.halfWidth]}>
                <Text style={styles.inputLabel}>Prénom *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.firstName}
                  onChangeText={(value) => updateFormData('firstName', value)}
                  placeholder="Prénom"
                  autoCapitalize="words"
                />
              </View>
              <View style={[styles.inputContainer, styles.halfWidth]}>
                <Text style={styles.inputLabel}>Nom *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.lastName}
                  onChangeText={(value) => updateFormData('lastName', value)}
                  placeholder="Nom"
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                style={[styles.input, styles.inputDisabled]}
                value={formData.email}
                editable={false}
                placeholder="Email"
              />
              <Text style={styles.inputHelper}>L'email ne peut pas être modifié</Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Téléphone</Text>
              <View style={styles.phoneInputContainer}>
                <View style={styles.phonePrefixContainer}>
                  <Text style={styles.phonePrefix}>
                    {getPhonePrefixByCountry(formData.country)}
                  </Text>
                </View>
                <TextInput
                  style={[styles.input, styles.phoneNumberInput]}
                  placeholder="77 123 45 67"
                  placeholderTextColor={colors.textSecondary}
                  value={formData.phone.replace(getPhonePrefixByCountry(formData.country), '').trim()}
                  onChangeText={(value) => {
                    const prefix = getPhonePrefixByCountry(formData.country);
                    const cleanValue = value.replace(/[^\d\s]/g, '');
                    updateFormData('phone', prefix + ' ' + cleanValue);
                  }}
                  keyboardType="phone-pad"
                  maxLength={15}
                />
              </View>
              <Text style={styles.inputHelper}>
                Format: {getPhonePrefixByCountry(formData.country)} XX XXX XX XX
              </Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Pays</Text>
              <View style={styles.pickerWrapper}>
                <Picker
                  selectedValue={formData.country}
                  onValueChange={(value) => updateFormData('country', value)}
                  style={styles.picker}
                >
                  {Object.values(COUNTRIES).map(country => (
                    <Picker.Item
                      key={country.code}
                      label={`${country.flag} ${country.nameFrench}`}
                      value={country.code}
                    />
                  ))}
                </Picker>
              </View>
            </View>
          </View>

          {/* Professional Information (for workers) */}
          {user?.user_type === 'worker' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Informations professionnelles</Text>
              
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Biographie</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={formData.bio}
                  onChangeText={(value) => updateFormData('bio', value)}
                  placeholder="Décrivez votre expérience et vos compétences..."
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Compétences</Text>
                <TextInput
                  style={styles.input}
                  value={formData.skills}
                  onChangeText={(value) => updateFormData('skills', value)}
                  placeholder="Ex: Plomberie, Électricité, Peinture..."
                />
                <Text style={styles.inputHelper}>Séparez les compétences par des virgules</Text>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Tarif horaire (XOF)</Text>
                <TextInput
                  style={styles.input}
                  value={formData.hourlyRate}
                  onChangeText={(value) => updateFormData('hourlyRate', value)}
                  placeholder="1000"
                  keyboardType="numeric"
                />
              </View>
            </View>
          )}

          {/* Account Settings */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Paramètres du compte</Text>
            
            <TouchableOpacity style={styles.settingItem}>
              <MaterialIcons name="lock" size={24} color={colors.text} />
              <Text style={styles.settingText}>Changer le mot de passe</Text>
              <MaterialIcons name="chevron-right" size={24} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingItem}>
              <MaterialIcons name="notifications" size={24} color={colors.text} />
              <Text style={styles.settingText}>Préférences de notifications</Text>
              <MaterialIcons name="chevron-right" size={24} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingItem}>
              <MaterialIcons name="privacy-tip" size={24} color={colors.text} />
              <Text style={styles.settingText}>Paramètres de confidentialité</Text>
              <MaterialIcons name="chevron-right" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Danger Zone */}
          <View style={styles.section}>
            <Text style={styles.dangerSectionTitle}>Zone de danger</Text>
            
            <TouchableOpacity
              style={styles.dangerButton}
              onPress={handleDeleteAccount}
            >
              <MaterialIcons name="delete" size={24} color={colors.error} />
              <Text style={styles.dangerButtonText}>Supprimer le compte</Text>
            </TouchableOpacity>
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
  saveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  saveButtonTextDisabled: {
    color: colors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  photoSection: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  photoContainer: {
    position: 'relative',
    marginBottom: 12,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: colors.background,
  },
  cameraButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.background,
  },
  photoText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
  },
  dangerSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.error,
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
  inputDisabled: {
    backgroundColor: colors.surface,
    opacity: 0.6,
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
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  settingText: {
    fontSize: 16,
    color: colors.text,
    marginLeft: 12,
    flex: 1,
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.error + '10',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error + '20',
  },
  dangerButtonText: {
    fontSize: 16,
    color: colors.error,
    marginLeft: 12,
    fontWeight: '500',
  },
  phoneInputContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  phonePrefixContainer: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    justifyContent: 'center',
  },
  phonePrefix: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '600',
  },
  phoneNumberInput: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 0,
    marginBottom: 0,
    backgroundColor: colors.surface,
  },
});