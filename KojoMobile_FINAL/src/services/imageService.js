import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

class ImageService {
  constructor() {
    this.maxImageSize = 5 * 1024 * 1024; // 5MB max
    this.allowedFormats = ['image/jpeg', 'image/png', 'image/jpg'];
  }

  // Request permissions for camera and gallery
  async requestPermissions() {
    try {
      console.log('Requesting camera and gallery permissions...');
      
      // Request camera permissions
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      console.log('Camera permission status:', cameraPermission.status);
      
      // Request media library permissions
      const galleryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      console.log('Gallery permission status:', galleryPermission.status);
      
      const permissions = {
        camera: cameraPermission.status === 'granted',
        gallery: galleryPermission.status === 'granted'
      };
      
      console.log('Final permissions:', permissions);
      return permissions;
    } catch (error) {
      console.error('Error requesting permissions:', error);
      Alert.alert(
        'Erreur de permissions',
        'Impossible de demander les permissions. Veuillez vérifier les paramètres de l\'application.',
        [{ text: 'OK' }]
      );
      return { camera: false, gallery: false };
    }
  }

  // Show option picker for image source
  showImageSourcePicker(onImageSelected, onCancel) {
    Alert.alert(
      'Choisir une photo',
      'Sélectionnez la source de votre photo de profil',
      [
        {
          text: 'Appareil photo',
          onPress: () => this.openCamera(onImageSelected)
        },
        {
          text: 'Galerie',
          onPress: () => this.openGallery(onImageSelected)
        },
        {
          text: 'Annuler',
          style: 'cancel',
          onPress: onCancel
        }
      ]
    );
  }

  // Open camera to take a photo
  async openCamera(onImageSelected) {
    try {
      const permissions = await this.requestPermissions();
      
      if (!permissions.camera) {
        Alert.alert(
          'Permission requise',
          'L\'accès à l\'appareil photo est requis pour prendre une photo.',
          [{ text: 'OK' }]
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1], // Square aspect ratio for profile photos
        quality: 0.8,
        base64: false
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        
        if (await this.validateImage(asset)) {
          onImageSelected({
            uri: asset.uri,
            type: asset.type || 'image/jpeg',
            name: `profile_photo_${Date.now()}.jpg`,
            size: asset.fileSize || 0,
            width: asset.width,
            height: asset.height
          });
        }
      }
    } catch (error) {
      console.error('Error opening camera:', error);
      Alert.alert('Erreur', 'Impossible d\'ouvrir l\'appareil photo');
    }
  }

  // Open gallery to select a photo
  async openGallery(onImageSelected) {
    try {
      const permissions = await this.requestPermissions();
      
      if (!permissions.gallery) {
        Alert.alert(
          'Permission requise',
          'L\'accès à la galerie est requis pour sélectionner une photo.',
          [{ text: 'OK' }]
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1], // Square aspect ratio for profile photos
        quality: 0.8,
        base64: false
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        
        if (await this.validateImage(asset)) {
          onImageSelected({
            uri: asset.uri,
            type: asset.type || 'image/jpeg',
            name: `profile_photo_${Date.now()}.jpg`,
            size: asset.fileSize || 0,
            width: asset.width,
            height: asset.height
          });
        }
      }
    } catch (error) {
      console.error('Error opening gallery:', error);
      Alert.alert('Erreur', 'Impossible d\'ouvrir la galerie');
    }
  }

  // Validate selected image
  async validateImage(asset) {
    // Check file size
    if (asset.fileSize && asset.fileSize > this.maxImageSize) {
      Alert.alert(
        'Image trop grande',
        'La taille de l\'image ne doit pas dépasser 5MB',
        [{ text: 'OK' }]
      );
      return false;
    }

    // Check image dimensions (optional - ensure reasonable size)
    if (asset.width && asset.height) {
      const minSize = 100;
      const maxSize = 4000;
      
      if (asset.width < minSize || asset.height < minSize) {
        Alert.alert(
          'Image trop petite',
          'L\'image doit faire au moins 100x100 pixels',
          [{ text: 'OK' }]
        );
        return false;
      }
      
      if (asset.width > maxSize || asset.height > maxSize) {
        Alert.alert(
          'Image trop grande',
          'L\'image ne doit pas dépasser 4000x4000 pixels',
          [{ text: 'OK' }]
        );
        return false;
      }
    }

    return true;
  }

  // Save profile photo to local storage
  async saveProfilePhoto(userId, imageUri) {
    try {
      const profilePhotoData = {
        uri: imageUri,
        userId: userId,
        timestamp: new Date().toISOString()
      };
      
      await AsyncStorage.setItem(
        `profile_photo_${userId}`,
        JSON.stringify(profilePhotoData)
      );
      
      return profilePhotoData;
    } catch (error) {
      console.error('Error saving profile photo:', error);
      throw new Error('Impossible de sauvegarder la photo');
    }
  }

  // Load profile photo from local storage
  async loadProfilePhoto(userId) {
    try {
      const photoData = await AsyncStorage.getItem(`profile_photo_${userId}`);
      return photoData ? JSON.parse(photoData) : null;
    } catch (error) {
      console.error('Error loading profile photo:', error);
      return null;
    }
  }

  // Delete profile photo
  async deleteProfilePhoto(userId) {
    try {
      await AsyncStorage.removeItem(`profile_photo_${userId}`);
      return true;
    } catch (error) {
      console.error('Error deleting profile photo:', error);
      return false;
    }
  }

  // Upload photo to server (placeholder - in real app would upload to backend)
  async uploadProfilePhoto(imageData, userId) {
    try {
      // In a real application, you would upload to your backend server
      // const formData = new FormData();
      // formData.append('profile_photo', {
      //   uri: imageData.uri,
      //   type: imageData.type,
      //   name: imageData.name,
      // });
      // formData.append('user_id', userId);
      
      // const response = await api.post('/users/upload-profile-photo', formData, {
      //   headers: { 'Content-Type': 'multipart/form-data' }
      // });
      
      // For now, we simulate the upload and return a mock URL
      const mockUploadedUrl = `https://api.kojo.app/uploads/profiles/${userId}/${imageData.name}`;
      
      // Save locally as well
      await this.saveProfilePhoto(userId, imageData.uri);
      
      return {
        success: true,
        url: mockUploadedUrl,
        local_uri: imageData.uri
      };
    } catch (error) {
      console.error('Error uploading profile photo:', error);
      return {
        success: false,
        error: 'Échec du téléchargement de la photo'
      };
    }
  }

  // Generate default avatar with user initials
  generateDefaultAvatar(firstName, lastName) {
    const initials = `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase();
    return {
      initials,
      backgroundColor: this.getAvatarColor(initials)
    };
  }

  // Get consistent color for avatar based on initials
  getAvatarColor(initials) {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
    ];
    
    let hash = 0;
    for (let i = 0; i < initials.length; i++) {
      hash = initials.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    return colors[Math.abs(hash) % colors.length];
  }

  // Show confirmation dialog for photo deletion
  showDeleteConfirmation(onConfirm, onCancel) {
    Alert.alert(
      'Supprimer la photo',
      'Êtes-vous sûr de vouloir supprimer votre photo de profil ?',
      [
        {
          text: 'Annuler',
          style: 'cancel',
          onPress: onCancel
        },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: onConfirm
        }
      ]
    );
  }
}

export default new ImageService();