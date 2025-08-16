import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { colors } from '../theme/theme';
import ImageService from '../services/imageService';

export default function CameraScreen({ route, navigation }) {
  const { onPhotoCapture, allowGallery = true } = route.params || {};
  
  const [photoUri, setPhotoUri] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [flashMode, setFlashMode] = useState('auto');

  // In a real app, you would use expo-camera here
  // const cameraRef = useRef(null);

  const handleTakePhoto = async () => {
    if (isCapturing) return;
    
    setIsCapturing(true);
    try {
      // In a real app, capture photo using expo-camera:
      // const photo = await cameraRef.current.takePictureAsync({
      //   quality: 0.8,
      //   base64: false,
      //   skipProcessing: false,
      // });
      
      // For demo purposes, we'll simulate photo capture
      setTimeout(() => {
        const mockPhotoUri = 'https://via.placeholder.com/400x600/EA580C/FFFFFF?text=Photo+Captured';
        setPhotoUri(mockPhotoUri);
        setIsCapturing(false);
      }, 1000);
      
    } catch (error) {
      setIsCapturing(false);
      Alert.alert('Erreur', 'Impossible de prendre la photo');
    }
  };

  const handleGallery = () => {
    // In a real app, use expo-image-picker:
    // const result = await ImagePicker.launchImageLibraryAsync({
    //   mediaTypes: ImagePicker.MediaTypeOptions.Images,
    //   allowsEditing: true,
    //   aspect: [4, 3],
    //   quality: 0.8,
    // });
    
    Alert.alert('Galerie', 'Sélection depuis la galerie (fonctionnalité en développement)');
  };

  const handleRetake = () => {
    setPhotoUri(null);
  };

  const handleConfirm = () => {
    if (photoUri && onPhotoCapture) {
      onPhotoCapture(photoUri);
    }
    navigation.goBack();
  };

  const toggleFlash = () => {
    const modes = ['auto', 'on', 'off'];
    const currentIndex = modes.indexOf(flashMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setFlashMode(modes[nextIndex]);
  };

  const getFlashIcon = () => {
    switch (flashMode) {
      case 'on': return 'flash-on';
      case 'off': return 'flash-off';
      default: return 'flash-auto';
    }
  };

  // If photo is captured and displayed
  if (photoUri) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.previewContainer}>
          <Image source={{ uri: photoUri }} style={styles.previewImage} />
          
          {/* Preview Header */}
          <View style={styles.previewHeader}>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => navigation.goBack()}
            >
              <MaterialIcons name="close" size={24} color={colors.background} />
            </TouchableOpacity>
          </View>

          {/* Preview Controls */}
          <View style={styles.previewControls}>
            <TouchableOpacity
              style={styles.previewButton}
              onPress={handleRetake}
            >
              <MaterialIcons name="refresh" size={24} color={colors.background} />
              <Text style={styles.previewButtonText}>Reprendre</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.previewButton, styles.confirmButton]}
              onPress={handleConfirm}
            >
              <MaterialIcons name="check" size={24} color={colors.background} />
              <Text style={styles.previewButtonText}>Confirmer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Camera View (simulated)
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.cameraContainer}>
        {/* Simulated Camera View */}
        <View style={styles.cameraPreview}>
          <View style={styles.cameraPlaceholder}>
            <MaterialIcons name="camera-alt" size={64} color={colors.textSecondary} />
            <Text style={styles.cameraPlaceholderText}>
              Caméra en mode simulation
            </Text>
            <Text style={styles.cameraPlaceholderSubtext}>
              En production, la caméra native sera utilisée
            </Text>
          </View>
          
          {/* Capture grid overlay */}
          <View style={styles.gridOverlay}>
            <View style={[styles.gridLine, styles.gridLineVertical, { left: '33%' }]} />
            <View style={[styles.gridLine, styles.gridLineVertical, { left: '66%' }]} />
            <View style={[styles.gridLine, styles.gridLineHorizontal, { top: '33%' }]} />
            <View style={[styles.gridLine, styles.gridLineHorizontal, { top: '66%' }]} />
          </View>
        </View>

        {/* Header Controls */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => navigation.goBack()}
          >
            <MaterialIcons name="close" size={24} color={colors.background} />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.headerButton}
            onPress={toggleFlash}
          >
            <MaterialIcons name={getFlashIcon()} size={24} color={colors.background} />
          </TouchableOpacity>
        </View>

        {/* Bottom Controls */}
        <View style={styles.controls}>
          {allowGallery && (
            <TouchableOpacity
              style={styles.galleryButton}
              onPress={handleGallery}
            >
              <MaterialIcons name="photo-library" size={24} color={colors.background} />
              <Text style={styles.controlText}>Galerie</Text>
            </TouchableOpacity>
          )}
          
          <TouchableOpacity
            style={[styles.captureButton, isCapturing && styles.captureButtonActive]}
            onPress={handleTakePhoto}
            disabled={isCapturing}
          >
            <View style={styles.captureButtonInner}>
              {isCapturing && (
                <MaterialIcons name="hourglass-empty" size={24} color={colors.primary} />
              )}
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.flipButton}
            onPress={() => Alert.alert('Retourner', 'Changer de caméra (fonctionnalité en développement)')}
          >
            <MaterialIcons name="flip-camera-android" size={24} color={colors.background} />
            <Text style={styles.controlText}>Retourner</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  cameraPreview: {
    flex: 1,
    position: 'relative',
  },
  cameraPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  cameraPlaceholderText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
    textAlign: 'center',
  },
  cameraPlaceholderSubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  gridOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  gridLineVertical: {
    width: 1,
    height: '100%',
  },
  gridLineHorizontal: {
    height: 1,
    width: '100%',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    zIndex: 10,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 40,
    zIndex: 10,
  },
  galleryButton: {
    alignItems: 'center',
    width: 60,
  },
  flipButton: {
    alignItems: 'center',
    width: 60,
  },
  controlText: {
    fontSize: 12,
    color: colors.background,
    marginTop: 4,
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  captureButtonActive: {
    backgroundColor: colors.primary,
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewImage: {
    flex: 1,
    resizeMode: 'contain',
  },
  previewHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    zIndex: 10,
  },
  previewControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 40,
    paddingVertical: 40,
    zIndex: 10,
  },
  previewButton: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  confirmButton: {
    backgroundColor: colors.primary,
  },
  previewButtonText: {
    fontSize: 14,
    color: colors.background,
    marginTop: 4,
    fontWeight: '500',
  },
});