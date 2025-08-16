// Service de gestion des photos de profil pour PWA
class ProfilePhotoService {
  constructor() {
    this.maxImageSize = 5 * 1024 * 1024; // 5MB max
    this.allowedFormats = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
  }

  // Demander à l'utilisateur de sélectionner une photo
  async selectPhoto() {
    console.log('ProfilePhotoService: Starting photo selection');
    
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      
      input.onchange = async (event) => {
        console.log('File input change event triggered');
        const file = event.target.files[0];
        
        if (!file) {
          console.log('No file selected');
          reject(new Error('Aucune image sélectionnée'));
          return;
        }

        console.log('Selected file:', file.name, file.size, file.type);

        try {
          const processedImage = await this.processImage(file);
          console.log('Image processed successfully:', processedImage);
          resolve(processedImage);
        } catch (error) {
          console.error('Error processing image:', error);
          reject(error);
        } finally {
          // Clean up
          document.body.removeChild(input);
        }
      };

      input.onerror = (error) => {
        console.error('File input error:', error);
        document.body.removeChild(input);
        reject(new Error('Erreur lors de la sélection de l\'image'));
      };

      input.oncancel = () => {
        console.log('File selection cancelled');
        document.body.removeChild(input);
        reject(new Error('Sélection annulée'));
      };

      // Trigger file picker
      console.log('Adding input to DOM and triggering click');
      document.body.appendChild(input);
      
      // Delay click to ensure DOM is ready
      setTimeout(() => {
        try {
          input.click();
          console.log('File input clicked');
        } catch (error) {
          console.error('Error clicking file input:', error);
          document.body.removeChild(input);
          reject(new Error('Impossible d\'ouvrir le sélecteur de fichiers'));
        }
      }, 100);
    });
  }

  // Traiter l'image sélectionnée
  async processImage(file) {
    console.log('Processing image:', file.name, file.size, file.type);
    
    // Valider le fichier
    if (!this.validateFile(file)) {
      throw new Error('Fichier image invalide');
    }

    console.log('File validation passed');

    // Redimensionner et convertir
    const processedBlob = await this.resizeImage(file, 400, 400);
    console.log('Image resized, blob size:', processedBlob.size);
    
    // Créer l'URL de l'image
    const imageUrl = URL.createObjectURL(processedBlob);
    console.log('Created blob URL:', imageUrl);
    
    const result = {
      file: processedBlob,
      url: imageUrl,
      name: `profile_photo_${Date.now()}.jpg`,
      size: processedBlob.size,
      type: 'image/jpeg',
      timestamp: new Date().toISOString()
    };
    
    console.log('Image processing completed:', result);
    return result;
  }

  // Valider le fichier image
  validateFile(file) {
    console.log('Validating file:', file.name, file.type, file.size);
    
    // Vérifier le type
    if (!this.allowedFormats.includes(file.type)) {
      const errorMsg = `Format non supporté: ${file.type}. Utilisez JPG, PNG ou WebP.`;
      console.error(errorMsg);
      alert(errorMsg);
      return false;
    }

    // Vérifier la taille
    if (file.size > this.maxImageSize) {
      const errorMsg = `Image trop grande: ${Math.round(file.size / 1024 / 1024)}MB. Maximum 5MB autorisé.`;
      console.error(errorMsg);
      alert(errorMsg);
      return false;
    }

    // Vérifier que le fichier n'est pas vide
    if (file.size === 0) {
      const errorMsg = 'Fichier vide détecté';
      console.error(errorMsg);
      alert(errorMsg);
      return false;
    }

    console.log('File validation successful');
    return true;
  }

  // Redimensionner l'image
  async resizeImage(file, maxWidth, maxHeight, quality = 0.8) {
    console.log('Starting image resize:', maxWidth, maxHeight, quality);
    
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        console.log('Image loaded for resize. Original size:', img.width, 'x', img.height);
        
        try {
          // Calculer les nouvelles dimensions (carré)
          const size = Math.min(img.width, img.height);
          const startX = (img.width - size) / 2;
          const startY = (img.height - size) / 2;

          console.log('Crop dimensions:', { size, startX, startY });

          // Configurer le canvas
          canvas.width = maxWidth;
          canvas.height = maxHeight;

          // Dessiner l'image redimensionnée et recadrée
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, maxWidth, maxHeight);
          ctx.drawImage(img, startX, startY, size, size, 0, 0, maxWidth, maxHeight);

          console.log('Image drawn on canvas');

          // Convertir en blob
          canvas.toBlob((blob) => {
            if (blob) {
              console.log('Canvas converted to blob, size:', blob.size);
              resolve(blob);
            } else {
              console.error('Failed to convert canvas to blob');
              reject(new Error('Impossible de traiter l\'image'));
            }
          }, 'image/jpeg', quality);
        } catch (error) {
          console.error('Error during image processing:', error);
          reject(new Error('Erreur lors du traitement de l\'image'));
        }
      };

      img.onerror = (error) => {
        console.error('Image load error:', error);
        reject(new Error('Impossible de charger l\'image'));
      };

      // Charger l'image
      console.log('Loading image for resize');
      img.src = URL.createObjectURL(file);
    });
  }

  // Sauvegarder la photo de profil localement
  async saveProfilePhoto(userId, imageData) {
    try {
      const photoData = {
        url: imageData.url,
        name: imageData.name,
        size: imageData.size,
        type: imageData.type,
        timestamp: imageData.timestamp,
        userId: userId
      };

      localStorage.setItem(`kojo_profile_photo_${userId}`, JSON.stringify(photoData));
      
      return photoData;
    } catch (error) {
      console.error('Erreur sauvegarde photo:', error);
      throw new Error('Impossible de sauvegarder la photo');
    }
  }

  // Charger la photo de profil depuis le stockage local et serveur
  async loadProfilePhoto(userId) {
    try {
      // D'abord essayer de récupérer depuis l'API
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/users/profile-photo`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const serverData = await response.json();
        console.log('Loaded profile photo from server:', serverData);
        
        const photoData = {
          url: `${process.env.REACT_APP_BACKEND_URL}${serverData.photo_url}`,
          server_url: serverData.photo_url,
          userId: serverData.user_id,
          loaded_from: 'server',
          timestamp: new Date().toISOString()
        };
        
        // Sauvegarder en local pour cache
        localStorage.setItem(`kojo_profile_photo_${userId}`, JSON.stringify(photoData));
        return photoData;
      }
    } catch (error) {
      console.log('Could not load from server, trying local storage:', error.message);
    }

    // Fallback vers stockage local
    try {
      const photoData = localStorage.getItem(`kojo_profile_photo_${userId}`);
      if (photoData) {
        const parsed = JSON.parse(photoData);
        console.log('Loaded profile photo from local storage:', parsed);
        return parsed;
      }
    } catch (error) {
      console.error('Erreur chargement photo local:', error);
    }

    return null;
  }

  // Supprimer la photo de profil
  deleteProfilePhoto(userId) {
    try {
      const photoData = this.loadProfilePhoto(userId);
      if (photoData && photoData.url) {
        // Libérer l'URL blob
        URL.revokeObjectURL(photoData.url);
      }
      
      localStorage.removeItem(`kojo_profile_photo_${userId}`);
      return true;
    } catch (error) {
      console.error('Erreur suppression photo:', error);
      return false;
    }
  }

  // Upload vers le serveur (API réelle)
  async uploadProfilePhoto(imageData, userId) {
    try {
      console.log('Starting real API upload for user:', userId);
      
      // Créer FormData pour l'upload
      const formData = new FormData();
      formData.append('file', imageData.file, imageData.name);

      // Utiliser la configuration axios déjà configurée dans App.js
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/users/profile-photo`, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Erreur lors de l\'upload');
      }

      const result = await response.json();
      console.log('Real API upload successful:', result);
      
      // Sauvegarder localement avec la vraie URL du serveur
      const serverImageData = {
        ...imageData,
        url: `${process.env.REACT_APP_BACKEND_URL}${result.photo_url}`,
        server_url: result.photo_url,
        uploaded: true
      };
      
      await this.saveProfilePhoto(userId, serverImageData);
      
      return {
        success: true,
        url: serverImageData.url,
        server_url: result.photo_url,
        uploaded: true,
        filename: result.filename
      };
    } catch (error) {
      console.error('Erreur upload photo vers API:', error);
      
      // En cas d'erreur, sauvegarder quand même localement
      try {
        await this.saveProfilePhoto(userId, imageData);
        return {
          success: false,
          error: error.message,
          local_fallback: true,
          local_url: imageData.url
        };
      } catch (localError) {
        return {
          success: false,
          error: `API: ${error.message}, Local: ${localError.message}`
        };
      }
    }
  }

  // Générer avatar par défaut avec initiales
  generateDefaultAvatar(firstName, lastName, size = 100) {
    const initials = `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = size;
    canvas.height = size;
    
    // Couleur de fond basée sur les initiales
    const backgroundColor = this.getAvatarColor(initials);
    
    // Dessiner le fond
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, size, size);
    
    // Dessiner les initiales
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${size * 0.4}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, size / 2, size / 2);
    
    return {
      initials,
      backgroundColor,
      dataUrl: canvas.toDataURL('image/png')
    };
  }

  // Couleur cohérente pour avatar
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

  // Prévisualiser l'image avant upload
  previewImage(imageData, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    const img = document.createElement('img');
    img.src = imageData.url;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '50%';
    
    container.appendChild(img);
  }

  // Nettoyer les URLs blob pour éviter les fuites mémoire
  cleanup() {
    // Cette fonction peut être appelée lors de la déconnexion
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('kojo_profile_photo_')) {
        try {
          const photoData = JSON.parse(localStorage.getItem(key));
          if (photoData && photoData.url && photoData.url.startsWith('blob:')) {
            URL.revokeObjectURL(photoData.url);
          }
        } catch (e) {
          console.error('Erreur nettoyage:', e);
        }
      }
    });
  }
}

export default new ProfilePhotoService();