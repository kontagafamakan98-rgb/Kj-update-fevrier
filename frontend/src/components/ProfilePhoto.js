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

  useEffect(() => {
    if (user) {
      loadProfilePhoto();
      generateDefaultAvatar();
    }
  }, [user, size]);

  const loadProfilePhoto = () => {
    if (!user?.id) return;
    
    try {
      const savedPhoto = ProfilePhotoService.loadProfilePhoto(user.id);
      if (savedPhoto) {
        setProfilePhoto(savedPhoto);
      }
    } catch (error) {
      console.error('Erreur chargement photo:', error);
    }
  };

  const generateDefaultAvatar = () => {
    if (user?.first_name || user?.last_name) {
      const avatar = ProfilePhotoService.generateDefaultAvatar(
        user.first_name, 
        user.last_name,
        size
      );
      setDefaultAvatar(avatar);
    }
  };

  const handlePhotoSelect = async () => {
    if (!editable) return;

    setLoading(true);
    try {
      const imageData = await ProfilePhotoService.selectPhoto();
      
      // Sauvegarder localement
      const savedPhoto = await ProfilePhotoService.saveProfilePhoto(user.id, imageData);
      setProfilePhoto(savedPhoto);
      
      // Upload vers serveur (simulation)
      const uploadResult = await ProfilePhotoService.uploadProfilePhoto(imageData, user.id);
      
      if (onPhotoChange) {
        onPhotoChange(uploadResult);
      }
      
    } catch (error) {
      console.error('Erreur sélection photo:', error);
      if (error.message !== 'Aucune image sélectionnée') {
        alert('Erreur lors de la sélection de l\'image: ' + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoDelete = async () => {
    if (!editable || !profilePhoto) return;

    const confirmed = window.confirm('Êtes-vous sûr de vouloir supprimer votre photo de profil ?');
    if (!confirmed) return;

    setLoading(true);
    try {
      ProfilePhotoService.deleteProfilePhoto(user.id);
      setProfilePhoto(null);
      
      if (onPhotoChange) {
        onPhotoChange({ success: true, deleted: true });
      }
    } catch (error) {
      console.error('Erreur suppression photo:', error);
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
          />
        ) : defaultAvatar?.dataUrl ? (
          <img 
            src={defaultAvatar.dataUrl} 
            alt="Avatar par défaut"
            style={photoStyle}
          />
        ) : (
          <div style={defaultAvatarStyle}>
            {defaultAvatar?.initials || '?'}
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