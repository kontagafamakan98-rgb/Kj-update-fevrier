// Version web du service d'images pour tester la logique sur navigateur
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

class ImageServiceWeb {
  constructor() {
    this.maxImageSize = 5 * 1024 * 1024; // 5MB max
    this.allowedFormats = ['image/jpeg', 'image/png', 'image/jpg'];
  }

  // Simuler la sélection d'image pour le web
  showImageSourcePicker(onImageSelected, onCancel) {
    Alert.alert(
      'Choisir une photo (Mode Test Web)',
      'En mode test, nous simulons la sélection d\'image',
      [
        {
          text: 'Simuler Appareil photo',
          onPress: () => this.simulateCamera(onImageSelected)
        },
        {
          text: 'Simuler Galerie', 
          onPress: () => this.simulateGallery(onImageSelected)
        },
        {
          text: 'Annuler',
          style: 'cancel',
          onPress: onCancel
        }
      ]
    );
  }

  // Simuler la prise de photo
  async simulateCamera(onImageSelected) {
    try {
      // Simuler un délai de prise de photo
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Créer une image simulée
      const mockImage = {
        uri: `https://picsum.photos/400/400?random=${Date.now()}`,
        type: 'image/jpeg',
        name: `camera_photo_${Date.now()}.jpg`,
        size: Math.floor(Math.random() * 1000000) + 100000,
        width: 400,
        height: 400
      };
      
      onImageSelected(mockImage);
    } catch (error) {
      console.error('Erreur simulation caméra:', error);
      Alert.alert('Erreur', 'Impossible de simuler la prise de photo');
    }
  }

  // Simuler la sélection depuis la galerie
  async simulateGallery(onImageSelected) {
    try {
      // Simuler un délai de sélection
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Créer une image simulée différente
      const mockImage = {
        uri: `https://picsum.photos/400/400?random=${Date.now() + 1000}`,
        type: 'image/jpeg', 
        name: `gallery_photo_${Date.now()}.jpg`,
        size: Math.floor(Math.random() * 2000000) + 200000,
        width: 400,
        height: 400
      };
      
      onImageSelected(mockImage);
    } catch (error) {
      console.error('Erreur simulation galerie:', error);
      Alert.alert('Erreur', 'Impossible de simuler la sélection depuis la galerie');
    }
  }

  // Validation d'image (identique au service natif)
  async validateImage(asset) {
    if (asset.size && asset.size > this.maxImageSize) {
      Alert.alert(
        'Image trop grande',
        'La taille de l\'image ne doit pas dépasser 5MB',
        [{ text: 'OK' }]
      );
      return false;
    }

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

  // Sauvegarder la photo de profil
  async saveProfilePhoto(userId, imageUri) {
    try {
      const profilePhotoData = {
        uri: imageUri,
        userId: userId,
        timestamp: new Date().toISOString(),
        isSimulated: true
      };
      
      await AsyncStorage.setItem(
        `profile_photo_${userId}`,
        JSON.stringify(profilePhotoData)
      );
      
      return profilePhotoData;
    } catch (error) {
      console.error('Erreur sauvegarde photo:', error);
      throw new Error('Impossible de sauvegarder la photo');
    }
  }

  // Charger la photo de profil
  async loadProfilePhoto(userId) {
    try {
      const photoData = await AsyncStorage.getItem(`profile_photo_${userId}`);
      return photoData ? JSON.parse(photoData) : null;
    } catch (error) {
      console.error('Erreur chargement photo:', error);
      return null;
    }
  }

  // Supprimer la photo de profil
  async deleteProfilePhoto(userId) {
    try {
      await AsyncStorage.removeItem(`profile_photo_${userId}`);
      return true;
    } catch (error) {
      console.error('Erreur suppression photo:', error);
      return false;
    }
  }

  // Simuler l'upload vers le serveur
  async uploadProfilePhoto(imageData, userId) {
    try {
      // Simuler l'upload avec délai
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const mockUploadedUrl = `https://api.kojo.app/uploads/profiles/${userId}/${imageData.name}`;
      
      await this.saveProfilePhoto(userId, imageData.uri);
      
      return {
        success: true,
        url: mockUploadedUrl,
        local_uri: imageData.uri,
        simulated: true
      };
    } catch (error) {
      console.error('Erreur upload photo:', error);
      return {
        success: false,
        error: 'Échec du téléchargement de la photo (mode test)'
      };
    }
  }

  // Générer avatar par défaut
  generateDefaultAvatar(firstName, lastName) {
    const initials = `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase();
    return {
      initials,
      backgroundColor: this.getAvatarColor(initials)
    };
  }

  // Couleur cohérente pour l'avatar
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

  // Confirmation de suppression
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

export default new ImageServiceWeb();