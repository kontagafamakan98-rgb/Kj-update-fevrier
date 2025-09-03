import React, { useMemo }, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/theme';
import ImageService from '../services/imageService';

export default function SimpleProfilePhoto({
  user,
  size = 100,
  editable = false,
  onPhotoChange,
  refreshTrigger = 0,
}) {
  const [photoUri, setPhotoUri] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadPhoto();
  }, [user, refreshTrigger]);

  const loadPhoto = async () => {
    if (!user?.id) return;
    
    console.log('SimpleProfilePhoto: Loading photo for user:', user.id);
    
    try {
      const key = `profile_photo_${user.id}`;
      const photoData = await AsyncStorage.getItem(key);
      
      if (photoData) {
        const parsed = JSON.parse(photoData);
        console.log('SimpleProfilePhoto: Found photo data:', parsed);
        setPhotoUri(parsed.uri);
      } else {
        console.log('SimpleProfilePhoto: No photo found');
        setPhotoUri(null);
      }
    } catch (error) {
      console.error('SimpleProfilePhoto: Load error:', error);
      setPhotoUri(null);
    }
  };

  const capturePhoto = async () => {
    if (!editable) return;
    
    setLoading(true);
    try {
      await ImageService.openCamera(async (imageData) => {
        console.log('SimpleProfilePhoto: Photo captured:', imageData);
        
        // Save to AsyncStorage
        const photoData = {
          uri: imageData.uri,
          userId: user.id,
          timestamp: new Date().toISOString()
        };
        
        const key = `profile_photo_${user.id}`;
        await AsyncStorage.setItem(key, JSON.stringify(photoData));
        console.log('SimpleProfilePhoto: Photo saved to AsyncStorage');
        
        // Update display immediately
        setPhotoUri(imageData.uri);
        
        // Notify parent
        if (onPhotoChange) {
          onPhotoChange({ success: true, uri: imageData.uri, local: true });
        }
        
        Alert.alert('✅ Succès', 'Photo sauvegardée !');
      });
    } catch (error) {
      console.error('SimpleProfilePhoto: Capture error:', error);
      Alert.alert('❌ Erreur', 'Impossible de capturer la photo');
    } finally {
      setLoading(false);
    }
  };

  const generateInitials = () => {
    const firstName = user?.first_name || '';
    const lastName = user?.last_name || '';
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || '?';
  };

  const photoSize = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  const renderContent = () => {
    if (loading) {
      return (
        <View style={[styles.container, photoSize, styles.loading]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }

    if (photoUri) {
      console.log('SimpleProfilePhoto: Rendering image with URI:', photoUri);
      return (
        <Image
          source={{ uri: photoUri }}
          style={[styles.photo, photoSize]}
          resizeMode="cover"
          onLoad={() => console.log('✅ SimpleProfilePhoto: Image loaded')}
          onError={(e) => {
            console.error('❌ SimpleProfilePhoto: Image error:', e.nativeEvent);
            setPhotoUri(null); // Reset on error
          }}
        />
      );
    }

    // Default avatar
    return (
      <View style={[styles.container, photoSize, styles.defaultAvatar]}>
        <Text style={[styles.initials, { fontSize: size * 0.4 }]}>
          {generateInitials()}
        </Text>
      </View>
    );
  };

  return (
    <TouchableOpacity
      style={styles.wrapper}
      onPress={capturePhoto}
      disabled={!editable}
      activeOpacity={editable ? 0.8 : 1}
    >
      {renderContent()}
      
      {editable && (
        <View style={[styles.cameraButton, { width: size * 0.3, height: size * 0.3, right: size * 0.05, bottom: size * 0.05 }]}>
          <MaterialIcons name="camera-alt" size={size * 0.15} color="white" />
        </View>
      )}
      
      {/* Debug info */}
      <Text style={styles.debug}>
        URI: {photoUri ? '✅' : '❌'} | User: {user?.id || 'N/A'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  photo: {
    backgroundColor: '#f3f4f6',
  },
  loading: {
    backgroundColor: '#f3f4f6',
  },
  defaultAvatar: {
    backgroundColor: colors.primary,
  },
  initials: {
    color: 'white',
    fontWeight: 'bold',
  },
  cameraButton: {
    position: 'absolute',
    backgroundColor: colors.primary,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  debug: {
    fontSize: 8,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
  },
});