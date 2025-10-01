/**
 * ProfilePhoto - Backend-based profile photo component
 * Always uses backend for shared storage, no localStorage dependency
 */

import React, { useState, useEffect } from 'react';
import { Camera, Edit2, X } from 'lucide-react';
import profilePhotoService from '../services/ProfilePhotoService';
import { devConsole } from '../utils/devLogger';
import { devLog, safeLog } from '../utils/env';

const ProfilePhoto = ({ 
  user, 
  size = 100, 
  editable = false, 
  onPhotoChange = null,
  className = '',
  showEditButton = true,
  targetUserId = null // Allow viewing other users' photos
}) => {
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showDeleteButton, setShowDeleteButton] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  const userId = targetUserId || user?.id || user?._id || user?.user_id;
  const isCurrentUser = !targetUserId || targetUserId === user?.id;

  // Debug logging (development only)
  useEffect(() => {
    devConsole.log('ProfilePhoto mounted with user:', user);
    devConsole.log('User ID available:', userId);
    devConsole.log('Editable mode:', editable);
    devConsole.log('Is current user:', isCurrentUser);
  }, [user, editable, userId, isCurrentUser]);

  useEffect(() => {
    if (userId) {
      loadProfilePhoto();
    }
  }, [userId]);

  // Clean up preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        profilePhotoService.revokePreviewUrl(previewUrl);
      }
    };
  }, [previewUrl]);

  const loadProfilePhoto = async () => {
    if (process.env.NODE_ENV === 'development') {
      devLog.info('Loading profile photo for user ID:', userId);
    }
    
    if (!userId) {
      safeLog.warn('No user ID found, cannot load profile photo');
      return;
    }
    
    setLoading(true);
    try {
      // Load from backend using centralized service
      let photoUrl;
      if (isCurrentUser) {
        photoUrl = await profilePhotoService.getCurrentUserPhotoUrl();
      } else {
        photoUrl = await profilePhotoService.getPhotoUrl(userId);
      }
      
      if (photoUrl) {
        devLog.info('Photo loaded from backend:', photoUrl);
        setProfilePhoto({ url: photoUrl });
      } else {
        devLog.info('No photo found in backend for user:', userId);
        setProfilePhoto(null);
      }
    } catch (error) {
      safeLog.error('Error loading profile photo from backend:', error);
      setProfilePhoto(null);
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoSelect = async () => {
    if (!editable || !isCurrentUser) {
      devLog.info('Photo not editable or not current user, ignoring click');
      return;
    }

    if (!userId) {
      alert('Erreur: ID utilisateur manquant');
      return;
    }

    // Create file input for photo selection
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      devLog.info('Starting photo upload for user:', userId);
      setLoading(true);
      
      try {
        // Generate preview for instant feedback
        const preview = profilePhotoService.generatePreviewUrl(file);
        setPreviewUrl(preview);

        // Upload to backend
        const result = await profilePhotoService.uploadPhoto(file);
        devLog.info('Photo uploaded successfully:', result);
        
        // Update photo URL from backend response
        const photoUrl = result.photo_url;
        const fullUrl = photoUrl.startsWith('http') 
          ? photoUrl 
          : `${process.env.REACT_APP_BACKEND_URL}${photoUrl}`;
        
        const cacheBustedUrl = `${fullUrl}?t=${Date.now()}`;
        setProfilePhoto({ url: cacheBustedUrl });
        
        // Clean up preview
        if (preview) {
          profilePhotoService.revokePreviewUrl(preview);
          setPreviewUrl(null);
        }
        
        if (onPhotoChange) {
          onPhotoChange({ 
            success: true, 
            backend: true, 
            photo_url: photoUrl,
            full_url: cacheBustedUrl 
          });
        }
        
      } catch (error) {
        safeLog.error('Error uploading photo:', error);
        
        // Clean up preview on error
        if (previewUrl) {
          profilePhotoService.revokePreviewUrl(previewUrl);
          setPreviewUrl(null);
        }
        
        const errorMessage = error.message || 'Erreur lors de la sélection de l\'image';
        alert(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    input.click();
  };

  const handlePhotoDelete = async () => {
    if (!editable || !profilePhoto || !isCurrentUser) return;

    if (!userId) {
      alert('Erreur: ID utilisateur manquant');
      return;
    }

    const confirmed = window.confirm('Êtes-vous sûr de vouloir supprimer votre photo de profil ?');
    if (!confirmed) return;

    devLog.info('Deleting photo for user:', userId);
    setLoading(true);
    
    try {
      // Delete from backend
      await profilePhotoService.deletePhoto();
      devLog.info('Photo deleted from backend');
      
      // Reset state
      setProfilePhoto(null);
      
      if (onPhotoChange) {
        onPhotoChange({ success: true, deleted: true, backend: true });
      }
      
    } catch (error) {
      safeLog.error('Error deleting photo:', error);
      alert('Erreur lors de la suppression de la photo');
    } finally {
      setLoading(false);
    }
  };

  const getDisplayPhoto = () => {
    // Show preview during upload
    if (previewUrl) {
      return previewUrl;
    }
    // Show current photo
    if (profilePhoto?.url) {
      return profilePhoto.url;
    }
    // Generate default avatar
    if (user) {
      return profilePhotoService.generateDefaultAvatar(user);
    }
    return null;
  };

  const getUserInitials = () => {
    if (user) {
      return profilePhotoService.getUserInitials(user);
    }
    return '?';
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
    cursor: (editable && isCurrentUser) ? 'pointer' : 'default'
  };

  const defaultAvatarStyle = {
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EA580C',
    border: '3px solid #EA580C',
    cursor: (editable && isCurrentUser) ? 'pointer' : 'default',
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

  const displayPhoto = getDisplayPhoto();

  // Debug render info (only in development)
  if (process.env.NODE_ENV === 'development') {
    devLog.info('ProfilePhoto render - Photo:', !!profilePhoto, 'DisplayPhoto:', !!displayPhoto, 'Loading:', loading);
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
        onClick={(editable && isCurrentUser) ? handlePhotoSelect : undefined}
        style={{ position: 'relative' }}
      >
        {loading ? (
          <div style={loadingStyle}>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
          </div>
        ) : displayPhoto ? (
          <img 
            src={displayPhoto} 
            alt={isCurrentUser ? "Votre photo de profil" : "Photo de profil"}
            style={photoStyle}
            onError={(e) => {
              safeLog.error('Image load error:', e);
              // Fallback to default avatar
              e.target.src = profilePhotoService.generateDefaultAvatar(user);
            }}
          />
        ) : (
          <div style={defaultAvatarStyle}>
            {getUserInitials()}
          </div>
        )}
      </div>

      {/* Bouton d'édition - Only for current user */}
      {editable && isCurrentUser && showEditButton && !loading && (
        <button
          onClick={handlePhotoSelect}
          style={editButtonStyle}
          title={profilePhoto ? "Changer la photo" : "Ajouter une photo"}
        >
          <Camera size={16} color="white" />
        </button>
      )}

      {/* Bouton de suppression - Only for current user */}
      {editable && isCurrentUser && showDeleteButton && profilePhoto && !loading && (
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