import React, { useState, useEffect } from 'react';
import { Camera, Edit2, X } from 'lucide-react';
import ProfilePhotoService from '../services/profilePhotoService';

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

  // Debug logging
  useEffect(() => {
    console.log('ProfilePhoto mounted with user:', user);
    console.log('User ID available:', user?.id);
    console.log('Editable mode:', editable);
  }, [user, editable]);

  useEffect(() => {
    if (user) {
      loadProfilePhoto();
      generateDefaultAvatar();
    }
  }, [user, size]);

  const loadProfilePhoto = async () => {
    const userId = user?.id || user?._id || user?.user_id;
    console.log('Loading profile photo for user ID:', userId);
    
    if (!userId) {
      console.warn('No user ID found, cannot load profile photo');
      return;
    }
    
    try {
      const savedPhoto = await ProfilePhotoService.loadProfilePhoto(userId);
      console.log('Loaded profile photo:', savedPhoto);
      if (savedPhoto) {
        setProfilePhoto(savedPhoto);
      }
    } catch (error) {
      console.error('Error loading profile photo:', error);
    }
  };

  const generateDefaultAvatar = () => {
    if (user?.first_name || user?.last_name) {
      const avatar = ProfilePhotoService.generateDefaultAvatar(
        user.first_name, 
        user.last_name,
        size
      );
      console.log('Generated default avatar:', avatar);
      setDefaultAvatar(avatar);
    }
  };

  const handlePhotoSelect = async () => {
    if (!editable) {
      console.log('Photo not editable, ignoring click');
      return;
    }

    const userId = user?.id || user?._id || user?.user_id;
    if (!userId) {
      alert('Erreur: ID utilisateur manquant');
      return;
    }

    console.log('Starting photo selection for user:', userId);
    setLoading(true);
    
    try {
      const imageData = await ProfilePhotoService.selectPhoto();
      console.log('Image selected:', imageData);
      
      // Sauvegarder localement
      const savedPhoto = await ProfilePhotoService.saveProfilePhoto(userId, imageData);
      console.log('Photo saved locally:', savedPhoto);
      setProfilePhoto(savedPhoto);
      
      // Upload vers serveur (simulation)
      const uploadResult = await ProfilePhotoService.uploadProfilePhoto(imageData, userId);
      console.log('Upload result:', uploadResult);
      
      // IMPORTANT: Mettre à jour avec l'URL du serveur après upload réussi
      if (uploadResult.success && uploadResult.url) {
        console.log('Updating ProfilePhoto with server URL:', uploadResult.url);
        const serverPhoto = {
          ...savedPhoto,
          url: uploadResult.url,
          server_url: uploadResult.server_url,
          uploaded: true
        };
        setProfilePhoto(serverPhoto);
        
        // Sauvegarder la version serveur localement aussi
        await ProfilePhotoService.saveProfilePhoto(userId, serverPhoto);
      }
      
      if (onPhotoChange) {
        onPhotoChange(uploadResult);
      }
      
    } catch (error) {
      console.error('Error in photo selection:', error);
      if (error.message !== 'Aucune image sélectionnée') {
        alert('Erreur lors de la sélection de l\'image: ' + error.message);
      }
    } finally {
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

    console.log('Deleting photo for user:', userId);
    setLoading(true);
    
    try {
      const success = await ProfilePhotoService.deleteProfilePhoto(userId);
      console.log('Photo deletion result:', success);
      
      if (success) {
        setProfilePhoto(null);
        
        if (onPhotoChange) {
          onPhotoChange({ success: true, deleted: true });
        }
      } else {
        throw new Error('Failed to delete photo');
      }
    } catch (error) {
      console.error('Error deleting photo:', error);
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

  // Debug render info
  console.log('ProfilePhoto render - Photo:', !!profilePhoto, 'DefaultAvatar:', !!defaultAvatar, 'Loading:', loading);

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
              console.error('Image load error:', e);
              setProfilePhoto(null);
            }}
          />
        ) : defaultAvatar?.dataUrl ? (
          <img 
            src={defaultAvatar.dataUrl} 
            alt="Avatar par défaut"
            style={photoStyle}
            onError={(e) => {
              console.error('Default avatar load error:', e);
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