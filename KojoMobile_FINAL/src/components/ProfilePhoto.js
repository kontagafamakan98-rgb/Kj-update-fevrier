import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/theme';
// Import conditionnel pour web/mobile
let ImageService;
if (typeof window !== 'undefined') {
  // Environnement web
  ImageService = require('../services/imageServiceWeb').default;
} else {
  // Environnement mobile natif
  ImageService = require('../services/imageService').default;
}

export default function ProfilePhoto({
  user,
  size = 100,
  editable = false,
  onPhotoChange = null,
  showChangeButton = true
}) {
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [defaultAvatar, setDefaultAvatar] = useState(null);

  useEffect(() => {
    if (user) {
      loadProfilePhoto();
      generateDefaultAvatar();
    }
  }, [user]);

  const loadProfilePhoto = async () => {
    if (!user?.id) return;
    
    try {
      const savedPhoto = await ImageService.loadProfilePhoto(user.id);
      if (savedPhoto) {
        setProfilePhoto(savedPhoto);
      }
    } catch (error) {
      console.error('Error loading profile photo:', error);
    }
  };

  const generateDefaultAvatar = () => {
    if (user?.first_name || user?.last_name) {
      const avatar = ImageService.generateDefaultAvatar(
        user.first_name, 
        user.last_name
      );
      setDefaultAvatar(avatar);
    }
  };

  const handlePhotoSelect = () => {
    if (!editable) return;

    ImageService.showImageSourcePicker(
      async (imageData) => {
        setLoading(true);
        try {
          // Save photo locally
          const savedPhoto = await ImageService.saveProfilePhoto(user.id, imageData.uri);
          setProfilePhoto(savedPhoto);
          
          // Upload to server (optional)
          const uploadResult = await ImageService.uploadProfilePhoto(imageData, user.id);
          
          if (onPhotoChange) {
            onPhotoChange(uploadResult);
          }
          
        } catch (error) {
          console.error('Error handling photo:', error);
        } finally {
          setLoading(false);
        }
      },
      () => {
        // User cancelled
      }
    );
  };

  const handlePhotoDelete = () => {
    if (!editable || !profilePhoto) return;

    ImageService.showDeleteConfirmation(
      async () => {
        setLoading(true);
        try {
          await ImageService.deleteProfilePhoto(user.id);
          setProfilePhoto(null);
          
          if (onPhotoChange) {
            onPhotoChange({ success: true, deleted: true });
          }
        } catch (error) {
          console.error('Error deleting photo:', error);
        } finally {
          setLoading(false);
        }
      },
      () => {
        // User cancelled
      }
    );
  };

  const photoSize = {
    width: size,
    height: size,
    borderRadius: size / 2
  };

  const renderPhotoContent = () => {
    if (loading) {
      return (
        <View style={[styles.photoContainer, photoSize, styles.loadingContainer]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    if (profilePhoto?.uri) {
      return (
        <View style={styles.photoWrapper}>
          <Image
            source={{ uri: profilePhoto.uri }}
            style={[styles.photo, photoSize]}
            resizeMode="cover"
          />
          {editable && (
            <TouchableOpacity
              style={[styles.deleteButton, { top: size * 0.1, right: size * 0.1 }]}
              onPress={handlePhotoDelete}
            >
              <MaterialIcons name="close" size={16} color={colors.background} />
            </TouchableOpacity>
          )}
        </View>
      );
    }

    // Default avatar with initials
    return (
      <View style={[
        styles.photoContainer, 
        photoSize, 
        { backgroundColor: defaultAvatar?.backgroundColor || colors.primary }
      ]}>
        <Text style={[
          styles.initialsText, 
          { fontSize: size * 0.4 }
        ]}>
          {defaultAvatar?.initials || '?'}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.photoTouchable}
        onPress={editable ? handlePhotoSelect : null}
        activeOpacity={editable ? 0.8 : 1}
      >
        {renderPhotoContent()}
        
        {editable && showChangeButton && (
          <View style={[styles.changeButton, { bottom: size * 0.05, right: size * 0.05 }]}>
            <MaterialIcons 
              name={profilePhoto ? "edit" : "camera-alt"} 
              size={size * 0.2} 
              color={colors.background} 
            />
          </View>
        )}
      </TouchableOpacity>
      
      {editable && !showChangeButton && (
        <TouchableOpacity
          style={styles.changeTextButton}
          onPress={handlePhotoSelect}
        >
          <Text style={styles.changeText}>
            {profilePhoto ? 'Changer la photo' : 'Ajouter une photo'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  photoTouchable: {
    position: 'relative',
  },
  photoWrapper: {
    position: 'relative',
  },
  photo: {
    backgroundColor: colors.surface,
  },
  photoContainer: {
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  loadingContainer: {
    backgroundColor: colors.surface,
  },
  initialsText: {
    color: colors.background,
    fontWeight: 'bold',
  },
  changeButton: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.background,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  deleteButton: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  changeTextButton: {
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  changeText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
});