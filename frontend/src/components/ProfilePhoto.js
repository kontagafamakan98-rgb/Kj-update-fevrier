import React, { useState, useEffect } from 'react';
import { Camera, Edit2, X } from 'lucide-react';
import ProfilePhotoService from '../services/profilePhotoService';
import { devConsole } from '../utils/devLogger';
import { devLog, safeLog } from '../utils/env';


const ProfilePhoto = ({ 
  user, 
  size = 100, 
  editable = false, 
  onPhotoChange = null,
  className = '',
  showEditButton = true
}) => {
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [defaultAvatar, setDefaultAvatar] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showDeleteButton, setShowDeleteButton] = useState(false);

  // Debug logging (development only)
  useEffect(() => {
    devConsole.log('ProfilePhoto mounted with user:', user);
    devConsole.log('User ID available:', user?.id);
    devConsole.log('Editable mode:', editable);
  }, [user, editable]);

  useEffect(() => {
    if (user) {
      loadProfilePhoto();
      generateDefaultAvatar();
    }
  }, [user, size]);

  const loadProfilePhoto = async () => {
    const userId = user?.id || user?._id || user?.user_id;
    if (process.env.NODE_ENV === 'development') {
      devLog.info('Loading profile photo for user ID:', userId);
    }
    
    if (!userId) {
      safeLog.warn('No user ID found, cannot load profile photo');
      return;
    }
    
    try {
      // Charger directement depuis localStorage (clé cohérente)
      const photoKey = `kojo_profile_photo_${userId}`;
      const photoDataString = localStorage.getItem(photoKey);
      
      if (photoDataString) {
        const photoData = JSON.parse(photoDataString);
        devLog.info('Found photo in localStorage:', photoKey);
        
        // Afficher la photo base64 directement
        setProfilePhoto({ url: photoData.base64 });
        devLog.info('Photo loaded and set from localStorage');
      } else {
        devLog.info('No photo found in localStorage for user:', userId);
        setProfilePhoto(null);
      }
    } catch (error) {
      safeLog.error('Error loading profile photo from localStorage:', error);
      setProfilePhoto(null);
    }
  };

  const generateDefaultAvatar = () => {
    if (user?.first_name || user?.last_name) {
      const avatar = ProfilePhotoService.generateDefaultAvatar(
        user.first_name, 
        user.last_name,
        size
      );
      devLog.info('Generated default avatar:', avatar);
      setDefaultAvatar(avatar);
    }
  };

  const handlePhotoSelect = async () => {
    if (!editable) {
      devLog.info('Photo not editable, ignoring click');
      return;
    }

    const userId = user?.id || user?._id || user?.user_id;
    if (!userId) {
      alert('Erreur: ID utilisateur manquant');
      return;
    }

    devLog.info('Starting photo selection for user:', userId);
    setLoading(true);
    
    try {
      const imageData = await ProfilePhotoService.selectPhoto();
      devLog.info('Image selected:', imageData);
      
      // SOLUTION ULTRA SIMPLE: Convertir en base64 et stocker directement
      const reader = new FileReader();
      reader.onload = function(e) {
        const base64Image = e.target.result;
        devLog.info('Image converted to base64, length:', base64Image.length);
        
        // Stocker directement dans localStorage (clé cohérente)
        const photoKey = `kojo_profile_photo_${userId}`;
        const photoData = {
          base64: base64Image,
          timestamp: Date.now(),
          userId: userId
        };
        
        localStorage.setItem(photoKey, JSON.stringify(photoData));
        devLog.info('Photo saved in localStorage with key:', photoKey);
        
        // Afficher immédiatement
        setProfilePhoto({ url: base64Image });
        devLog.info('Photo set in component state');
        
        if (onPhotoChange) {
          onPhotoChange({ success: true, local: true, base64: base64Image });
        }
        
        setLoading(false);
      };
      
      reader.onerror = function(error) {
        safeLog.error('Error reading file:', error);
        alert('Erreur lors de la lecture du fichier');
        setLoading(false);
      };
      
      // Lire le fichier comme base64
      reader.readAsDataURL(imageData.file);
      
    } catch (error) {
      safeLog.error('Error in photo selection:', error);
      if (error.message !== 'Aucune image sélectionnée') {
        alert('Erreur lors de la sélection de l\'image: ' + error.message);
      }
      setLoading(false);
    }
  };

  const handlePhotoDelete = async () => {
    if (!editable || !profilePhoto) return;

    const userId = user?.id || user?._id || user?.user_id;
    if (!userId) {
      alert('Erreur: ID utilisateur manquant');
      return;
    }

    const confirmed = window.confirm('Êtes-vous sûr de vouloir supprimer votre photo de profil ?');
    if (!confirmed) return;

    devLog.info('Deleting photo for user:', userId);
    setLoading(true);
    
    try {
      // Supprimer du localStorage (clé cohérente)
      const photoKey = `kojo_profile_photo_${userId}`;
      localStorage.removeItem(photoKey);
      devLog.info('Photo removed from localStorage:', photoKey);
      
      // Réinitialiser l'état
      setProfilePhoto(null);
      
      if (onPhotoChange) {
        onPhotoChange({ success: true, deleted: true });
      }
      
    } catch (error) {
      safeLog.error('Error deleting photo:', error);
      alert('Erreur lors de la suppression de la photo');
    } finally {
      setLoading(false);
    }
  };

  const containerStyle = {
    width: `${size}px`,
    height: `${size}px`,
    position: 'relative',
    display: 'inline-block'
  };

  const photoStyle = {
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    objectFit: 'cover',
    border: '3px solid #EA580C',
    cursor: editable ? 'pointer' : 'default'
  };

  const defaultAvatarStyle = {
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: defaultAvatar?.backgroundColor || '#EA580C',
    border: '3px solid #EA580C',
    cursor: editable ? 'pointer' : 'default',
    color: 'white',
    fontWeight: 'bold',
    fontSize: `${size * 0.4}px`
  };

  const loadingStyle = {
    ...defaultAvatarStyle,
    backgroundColor: '#f3f4f6',
    color: '#6b7280'
  };

  const editButtonStyle = {
    position: 'absolute',
    bottom: '0',
    right: '0',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: '#EA580C',
    border: '2px solid white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  };

  const deleteButtonStyle = {
    position: 'absolute',
    top: '0',
    right: '0',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: '#ef4444',
    border: '2px solid white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  };

  // Debug render info (only in development)
  if (process.env.NODE_ENV === 'development') {
    devLog.info('ProfilePhoto render - Photo:', !!profilePhoto, 'DefaultAvatar:', !!defaultAvatar, 'Loading:', loading);
  }

  return (
    <div 
      className={`profile-photo-container ${className}`}
      style={containerStyle}
      onMouseEnter={() => setShowDeleteButton(true)}
      onMouseLeave={() => setShowDeleteButton(false)}
    >
      {/* Photo de profil */}
      <div 
        onClick={editable ? handlePhotoSelect : undefined}
        style={{ position: 'relative' }}
      >
        {loading ? (
          <div style={loadingStyle}>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
          </div>
        ) : profilePhoto?.url ? (
          <img 
            src={profilePhoto.url} 
            alt="Photo de profil"
            style={photoStyle}
            onError={(e) => {
              safeLog.error('Image load error:', e);
              setProfilePhoto(null);
            }}
          />
        ) : defaultAvatar?.dataUrl ? (
          <img 
            src={defaultAvatar.dataUrl} 
            alt="Avatar par défaut"
            style={photoStyle}
            onError={(e) => {
              safeLog.error('Default avatar load error:', e);
            }}
          />
        ) : (
          <div style={defaultAvatarStyle}>
            {defaultAvatar?.initials || (user?.first_name?.charAt(0) || user?.last_name?.charAt(0) || '?').toUpperCase()}
          </div>
        )}
      </div>

      {/* Bouton d'édition */}
      {editable && showEditButton && !loading && (
        <button
          onClick={handlePhotoSelect}
          style={editButtonStyle}
          title={profilePhoto ? "Changer la photo" : "Ajouter une photo"}
        >
          {profilePhoto ? (
            <Edit2 size={16} color="white" />
          ) : (
            <Camera size={16} color="white" />
          )}
        </button>
      )}

      {/* Bouton de suppression */}
      {editable && profilePhoto && showDeleteButton && !loading && (
        <button
          onClick={handlePhotoDelete}
          style={deleteButtonStyle}
          title="Supprimer la photo"
        >
          <X size={12} color="white" />
        </button>
      )}
    </div>
  );
};

export default ProfilePhoto;