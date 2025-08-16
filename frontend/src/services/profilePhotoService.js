// Service de gestion des photos de profil pour PWA
class ProfilePhotoService {
  constructor() {
    this.maxImageSize = 5 * 1024 * 1024; // 5MB max
    this.allowedFormats = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
  }

  // Demander à l'utilisateur de sélectionner une photo
  async selectPhoto() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      
      input.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) {
          reject(new Error('Aucune image sélectionnée'));
          return;
        }

        try {
          const processedImage = await this.processImage(file);
          resolve(processedImage);
        } catch (error) {
          reject(error);
        }
      };

      input.onerror = () => {
        reject(new Error('Erreur lors de la sélection de l\'image'));
      };

      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    });
  }

  // Traiter l'image sélectionnée
  async processImage(file) {
    // Valider le fichier
    if (!this.validateFile(file)) {
      throw new Error('Fichier image invalide');
    }

    // Redimensionner et convertir
    const processedBlob = await this.resizeImage(file, 400, 400);
    
    // Créer l'URL de l'image
    const imageUrl = URL.createObjectURL(processedBlob);
    
    return {
      file: processedBlob,
      url: imageUrl,
      name: `profile_photo_${Date.now()}.jpg`,
      size: processedBlob.size,
      type: 'image/jpeg',
      timestamp: new Date().toISOString()
    };
  }

  // Valider le fichier image
  validateFile(file) {
    // Vérifier le type
    if (!this.allowedFormats.includes(file.type)) {
      alert('Format non supporté. Utilisez JPG, PNG ou WebP.');
      return false;
    }

    // Vérifier la taille
    if (file.size > this.maxImageSize) {
      alert('Image trop grande. Maximum 5MB autorisé.');
      return false;
    }

    return true;
  }

  // Redimensionner l'image
  async resizeImage(file, maxWidth, maxHeight, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        // Calculer les nouvelles dimensions (carré)
        const size = Math.min(img.width, img.height);
        const startX = (img.width - size) / 2;
        const startY = (img.height - size) / 2;

        // Configurer le canvas
        canvas.width = maxWidth;
        canvas.height = maxHeight;

        // Dessiner l'image redimensionnée et recadrée
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, maxWidth, maxHeight);
        ctx.drawImage(img, startX, startY, size, size, 0, 0, maxWidth, maxHeight);

        // Convertir en blob
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Impossible de traiter l\'image'));
          }
        }, 'image/jpeg', quality);
      };

      img.onerror = () => {
        reject(new Error('Impossible de charger l\'image'));
      };

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

  // Charger la photo de profil depuis le stockage local
  loadProfilePhoto(userId) {
    try {
      const photoData = localStorage.getItem(`kojo_profile_photo_${userId}`);
      return photoData ? JSON.parse(photoData) : null;
    } catch (error) {
      console.error('Erreur chargement photo:', error);
      return null;
    }
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

  // Upload vers le serveur (simulation)
  async uploadProfilePhoto(imageData, userId) {
    try {
      // Simuler l'upload avec délai
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // En vrai, on ferait quelque chose comme :
      // const formData = new FormData();
      // formData.append('profile_photo', imageData.file, imageData.name);
      // const response = await fetch('/api/users/upload-profile-photo', {
      //   method: 'POST',
      //   body: formData,
      //   headers: { 'Authorization': `Bearer ${token}` }
      // });
      
      const mockUploadedUrl = `https://api.kojo.app/uploads/profiles/${userId}/${imageData.name}`;
      
      // Sauvegarder localement
      await this.saveProfilePhoto(userId, imageData);
      
      return {
        success: true,
        url: mockUploadedUrl,
        local_url: imageData.url,
        uploaded: true
      };
    } catch (error) {
      console.error('Erreur upload photo:', error);
      return {
        success: false,
        error: 'Échec du téléchargement de la photo'
      };
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