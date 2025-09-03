import React, { useMemo }, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/theme';
import ProfilePhoto from '../components/ProfilePhoto';
import ImageService from '../services/imageService';

export default function ProfilePhotoTestScreen({ navigation }) {
  const [testUser] = useState({
    id: 'test_user_profile',
    first_name: 'Marie',
    last_name: 'Diallo',
    email: 'marie.diallo@test.com',
    user_type: 'client'
  });
  
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [storedPhotos, setStoredPhotos] = useState([]);
  const [testResults, setTestResults] = useState([]);

  useEffect(() => {
    loadStoredPhotos();
  }, [refreshTrigger]);

  const addTestResult = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const result = { timestamp, message, type };
    setTestResults(prev => [result, ...prev.slice(0, 9)]);
    console.log(`[${timestamp}] ${message}`);
  };

  const loadStoredPhotos = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const photoKeys = keys.filter(key => key.startsWith('profile_photo_'));
      const photos = [];
      
      for (const key of photoKeys) {
        const photoData = await AsyncStorage.getItem(key);
        if (photoData) {
          photos.push({
            key,
            data: JSON.parse(photoData)
          });
        }
      }
      
      setStoredPhotos(photos);
      addTestResult(`Trouvé ${photos.length} photos stockées`, 'info');
    } catch (error) {
      addTestResult(`Erreur chargement photos: ${error.message}`, 'error');
    }
  };

  const testPhotoCapture = async () => {
    try {
      addTestResult('Test capture photo avec sauvegarde...', 'info');
      
      await ImageService.openCamera(async (imageData) => {
        addTestResult('Photo capturée, sauvegarde en cours...', 'info');
        
        try {
          // Sauvegarder la photo
          const savedPhoto = await ImageService.saveProfilePhoto(testUser.id, imageData.uri);
          addTestResult('✅ Photo sauvegardée localement', 'success');
          
          // Forcer le rechargement du composant
          setRefreshTrigger(prev => prev + 1);
          
          // Recharger la liste des photos stockées
          await loadStoredPhotos();
          
          addTestResult('✅ Composant ProfilePhoto rechargé', 'success');
        } catch (error) {
          addTestResult(`❌ Erreur sauvegarde: ${error.message}`, 'error');
        }
      });
    } catch (error) {
      addTestResult(`❌ Erreur capture: ${error.message}`, 'error');
    }
  };

  const testManualLoad = async () => {
    try {
      addTestResult('Test chargement manuel...', 'info');
      const photoData = await ImageService.loadProfilePhoto(testUser.id);
      
      if (photoData) {
        addTestResult('✅ Photo trouvée dans le stockage', 'success');
        addTestResult(`URI: ${photoData.uri}`, 'info');
        addTestResult(`Timestamp: ${photoData.timestamp}`, 'info');
      } else {
        addTestResult('⚠️ Aucune photo trouvée pour cet utilisateur', 'warning');
      }
      
      // Forcer le rechargement
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      addTestResult(`❌ Erreur chargement: ${error.message}`, 'error');
    }
  };

  const clearAllPhotos = async () => {
    Alert.alert(
      'Confirmer',
      'Supprimer toutes les photos stockées ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              const keys = await AsyncStorage.getAllKeys();
              const photoKeys = keys.filter(key => key.startsWith('profile_photo_'));
              
              for (const key of photoKeys) {
                await AsyncStorage.removeItem(key);
              }
              
              addTestResult(`✅ ${photoKeys.length} photos supprimées`, 'success');
              setRefreshTrigger(prev => prev + 1);
              await loadStoredPhotos();
            } catch (error) {
              addTestResult(`❌ Erreur suppression: ${error.message}`, 'error');
            }
          }
        }
      ]
    );
  };

  const handlePhotoChange = (result) => {
    addTestResult('📸 Callback onPhotoChange appelé', 'info');
    if (result.success) {
      addTestResult('✅ Changement de photo réussi', 'success');
    } else {
      addTestResult(`❌ Échec changement: ${result.error}`, 'error');
    }
  };

  const clearResults = () => {
    setTestResults([]);
    addTestResult('Résultats effacés', 'info');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <MaterialIcons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Test Photo Profil</Text>
        </View>

        {/* User Test Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Utilisateur de Test</Text>
          <Text style={styles.userInfo}>
            {testUser.first_name} {testUser.last_name} (ID: {testUser.id})
          </Text>
        </View>

        {/* Profile Photo Display */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Affichage Photo Profil</Text>
          
          <View style={styles.photoRow}>
            <View style={styles.photoItem}>
              <Text style={styles.photoLabel}>Modifiable</Text>
              <ProfilePhoto
                user={testUser}
                size={120}
                editable={true}
                onPhotoChange={handlePhotoChange}
                refreshTrigger={refreshTrigger}
              />
            </View>
            
            <View style={styles.photoItem}>
              <Text style={styles.photoLabel}>Lecture seule</Text>
              <ProfilePhoto
                user={testUser}
                size={80}
                editable={false}
                refreshTrigger={refreshTrigger}
              />
            </View>
          </View>
        </View>

        {/* Test Controls */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contrôles de Test</Text>
          
          <TouchableOpacity style={styles.testButton} onPress={testPhotoCapture}>
            <MaterialIcons name="camera-alt" size={20} color="#fff" />
            <Text style={styles.testButtonText}>Capturer & Sauvegarder</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.testButton} onPress={testManualLoad}>
            <MaterialIcons name="refresh" size={20} color="#fff" />
            <Text style={styles.testButtonText}>Charger Manuellement</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.clearButton} onPress={clearAllPhotos}>
            <MaterialIcons name="delete" size={20} color="#ef4444" />
            <Text style={styles.clearButtonText}>Supprimer Toutes Photos</Text>
          </TouchableOpacity>
        </View>

        {/* Stored Photos Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos Stockées ({storedPhotos.length})</Text>
          
          {storedPhotos.length === 0 ? (
            <Text style={styles.noPhotos}>
              Aucune photo stockée. Capturez une photo pour tester.
            </Text>
          ) : (
            storedPhotos.map((photo, index) => (
              <View key={index} style={styles.photoInfo}>
                <Text style={styles.photoKey}>{photo.key}</Text>
                <Text style={styles.photoUri} numberOfLines={1}>
                  URI: {photo.data.uri}
                </Text>
                <Text style={styles.photoTimestamp}>
                  {new Date(photo.data.timestamp).toLocaleString()}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Test Results */}
        <View style={styles.section}>
          <View style={styles.resultsHeader}>
            <Text style={styles.sectionTitle}>Résultats des Tests</Text>
            <TouchableOpacity onPress={clearResults}>
              <MaterialIcons name="clear" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
          
          {testResults.length === 0 ? (
            <Text style={styles.noResults}>
              Aucun test effectué.
            </Text>
          ) : (
            testResults.map((result, index) => (
              <View
                key={index}
                style={[
                  styles.resultItem,
                  result.type === 'error' 
                    ? styles.resultError
                    : result.type === 'success'
                    ? styles.resultSuccess
                    : result.type === 'warning'
                    ? styles.resultWarning
                    : styles.resultInfo
                ]}
              >
                <Text style={styles.resultTimestamp}>{result.timestamp}</Text>
                <Text style={styles.resultMessage}>{result.message}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  section: {
    backgroundColor: '#fff',
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 16,
  },
  userInfo: {
    fontSize: 14,
    color: '#6b7280',
    fontFamily: 'monospace',
  },
  photoRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  photoItem: {
    alignItems: 'center',
  },
  photoLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 8,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  testButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  clearButtonText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  noPhotos: {
    textAlign: 'center',
    color: '#9ca3af',
    fontStyle: 'italic',
    paddingVertical: 20,
  },
  photoInfo: {
    backgroundColor: '#f9fafb',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  photoKey: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#374151',
    fontFamily: 'monospace',
  },
  photoUri: {
    fontSize: 10,
    color: '#6b7280',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  photoTimestamp: {
    fontSize: 10,
    color: '#9ca3af',
    marginTop: 4,
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  noResults: {
    textAlign: 'center',
    color: '#9ca3af',
    fontStyle: 'italic',
    paddingVertical: 20,
  },
  resultItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 8,
  },
  resultInfo: {
    backgroundColor: '#f3f4f6',
  },
  resultSuccess: {
    backgroundColor: '#d1fae5',
  },
  resultError: {
    backgroundColor: '#fee2e2',
  },
  resultWarning: {
    backgroundColor: '#fef3c7',
  },
  resultTimestamp: {
    fontSize: 10,
    color: '#6b7280',
    fontFamily: 'monospace',
  },
  resultMessage: {
    fontSize: 14,
    color: '#374151',
    marginTop: 2,
  },
});