import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/theme';
import ImageService from '../services/imageService';

export default function CameraTestScreen({ navigation }) {
  const [capturedImage, setCapturedImage] = useState(null);
  const [testResults, setTestResults] = useState([]);

  const addTestResult = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const result = { timestamp, message, type };
    setTestResults(prev => [result, ...prev.slice(0, 9)]); // Keep last 10 results
    console.log(`[${timestamp}] ${message}`);
  };

  const testCameraPermissions = async () => {
    try {
      addTestResult('Test des permissions caméra...', 'info');
      const permissions = await ImageService.requestPermissions();
      
      if (permissions.camera) {
        addTestResult('✅ Permission caméra accordée', 'success');
      } else {
        addTestResult('❌ Permission caméra refusée', 'error');
      }
      
      if (permissions.gallery) {
        addTestResult('✅ Permission galerie accordée', 'success');
      } else {
        addTestResult('❌ Permission galerie refusée', 'error');
      }
    } catch (error) {
      addTestResult(`❌ Erreur permissions: ${error.message}`, 'error');
    }
  };

  const testCameraCapture = async () => {
    try {
      addTestResult('Ouverture de la caméra...', 'info');
      
      await ImageService.openCamera((imageData) => {
        addTestResult('✅ Photo capturée avec succès!', 'success');
        addTestResult(`Détails: ${imageData.width}x${imageData.height}, ${Math.round(imageData.size/1024)}KB`, 'info');
        setCapturedImage(imageData);
      });
    } catch (error) {
      addTestResult(`❌ Erreur capture: ${error.message}`, 'error');
    }
  };

  const testGalleryAccess = async () => {
    try {
      addTestResult('Ouverture de la galerie...', 'info');
      
      await ImageService.openGallery((imageData) => {
        addTestResult('✅ Image sélectionnée depuis la galerie!', 'success');
        addTestResult(`Détails: ${imageData.width}x${imageData.height}, ${Math.round(imageData.size/1024)}KB`, 'info');
        setCapturedImage(imageData);
      });
    } catch (error) {
      addTestResult(`❌ Erreur galerie: ${error.message}`, 'error');
    }
  };

  const testImagePicker = async () => {
    try {
      addTestResult('Ouverture du sélecteur d\'image...', 'info');
      
      await ImageService.selectImage((imageData) => {
        addTestResult('✅ Image sélectionnée!', 'success');
        addTestResult(`Détails: ${imageData.width}x${imageData.height}, ${Math.round(imageData.size/1024)}KB`, 'info');
        setCapturedImage(imageData);
      });
    } catch (error) {
      addTestResult(`❌ Erreur sélecteur: ${error.message}`, 'error');
    }
  };

  const clearResults = () => {
    setTestResults([]);
    setCapturedImage(null);
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
          <Text style={styles.title}>Test Caméra</Text>
        </View>

        {/* Captured Image */}
        {capturedImage && (
          <View style={styles.imageContainer}>
            <Text style={styles.sectionTitle}>Image Capturée</Text>
            <Image source={{ uri: capturedImage.uri }} style={styles.capturedImage} />
            <Text style={styles.imageInfo}>
              {capturedImage.width}x{capturedImage.height} - {Math.round(capturedImage.size/1024)}KB
            </Text>
          </View>
        )}

        {/* Test Buttons */}
        <View style={styles.testSection}>
          <Text style={styles.sectionTitle}>Tests Disponibles</Text>
          
          <TouchableOpacity style={styles.testButton} onPress={testCameraPermissions}>
            <MaterialIcons name="security" size={20} color="#fff" />
            <Text style={styles.testButtonText}>Tester Permissions</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.testButton} onPress={testCameraCapture}>
            <MaterialIcons name="camera-alt" size={20} color="#fff" />
            <Text style={styles.testButtonText}>Tester Caméra</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.testButton} onPress={testGalleryAccess}>
            <MaterialIcons name="photo-library" size={20} color="#fff" />
            <Text style={styles.testButtonText}>Tester Galerie</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.testButton} onPress={testImagePicker}>
            <MaterialIcons name="add-a-photo" size={20} color="#fff" />
            <Text style={styles.testButtonText}>Sélecteur d'Image</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.clearButton} onPress={clearResults}>
            <MaterialIcons name="clear" size={20} color="#ea580c" />
            <Text style={styles.clearButtonText}>Effacer Résultats</Text>
          </TouchableOpacity>
        </View>

        {/* Test Results */}
        <View style={styles.resultsSection}>
          <Text style={styles.sectionTitle}>Résultats des Tests</Text>
          
          {testResults.length === 0 ? (
            <Text style={styles.noResults}>
              Aucun test effectué. Utilisez les boutons ci-dessus pour tester.
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
                    : styles.resultInfo
                ]}
              >
                <Text style={styles.resultTimestamp}>{result.timestamp}</Text>
                <Text style={styles.resultMessage}>{result.message}</Text>
              </View>
            ))
          )}
        </View>

        {/* Instructions */}
        <View style={styles.instructionsSection}>
          <Text style={styles.sectionTitle}>Instructions</Text>
          <Text style={styles.instructionText}>
            1. Commencez par tester les permissions{'\n'}
            2. Si les permissions sont accordées, testez la caméra{'\n'}
            3. Vérifiez que l'image s'affiche correctement{'\n'}
            4. Testez aussi la galerie pour comparer
          </Text>
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
  imageContainer: {
    backgroundColor: '#fff',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  capturedImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    marginVertical: 12,
  },
  imageInfo: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  testSection: {
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
    borderColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  clearButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  resultsSection: {
    backgroundColor: '#fff',
    margin: 16,
    padding: 16,
    borderRadius: 12,
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
  instructionsSection: {
    backgroundColor: '#fff',
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  instructionText: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
  },
});