import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import { safeLog } from '../utils/env';
import { buildBackendUrl } from '../utils/backendUrl';
import profilePhotoService from '../services/ProfilePhotoService';
import { compressImage, validateImageFile, formatFileSize } from '../utils/imageOptimization';

const ProfilePhotoUploader = ({ onUploadSuccess, targetUserId = null, className = '' }) => {
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const { user, updateUser } = useAuth();
  const { t } = useLanguage();
  const toast = useToast();
  
  // Determine if this is for current user or another user
  const isCurrentUser = !targetUserId || targetUserId === user?.id;
  
  // Load current photo on component mount
  useEffect(() => {
    loadCurrentPhoto();
  }, [targetUserId, user?.id]);

  // Clean up preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        profilePhotoService.revokePreviewUrl(previewUrl);
      }
    };
  }, [previewUrl]);

  const loadCurrentPhoto = async () => {
    setLoading(true);
    try {
      let photoUrl;
      if (isCurrentUser) {
        photoUrl = await profilePhotoService.getCurrentUserPhotoUrl();
      } else {
        photoUrl = await profilePhotoService.getPhotoUrl(targetUserId);
      }
      setCurrentPhotoUrl(photoUrl);
    } catch (error) {
      safeLog.error('Error loading current photo:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFiles = async (files) => {
    if (!isCurrentUser && targetUserId) {
      alert(t('photoVisibleAllUsers'));
      return;
    }

    const file = files[0];
    if (!file) return;

    // Valider le fichier avant la compression
    const validation = validateImageFile(file);
    if (!validation.valid) {
      validation.errors.forEach(error => toast.error(error));
      return;
    }

    setUploading(true);

    try {
      // 1. Afficher la taille originale dans la console (pour debug)
      const originalSize = file.size;
      safeLog.info(`📷 Image originale: ${formatFileSize(originalSize)}`);

      // 2. Compresser l'image avant l'upload (optimisation pour l'Afrique de l'Ouest)
      const compressedBlob = await compressImage(file, {
        maxWidth: 800,
        maxHeight: 800,
        quality: 0.7,
        format: 'image/jpeg'
      });

      // 3. Créer un File à partir du Blob compressé
      const compressedFile = new File(
        [compressedBlob], 
        file.name.replace(/\.\w+$/, '.jpg'), // Forcer l'extension .jpg
        { type: 'image/jpeg' }
      );

      const compressedSize = compressedFile.size;
      const reduction = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
      safeLog.info(`✅ Image compressée: ${formatFileSize(compressedSize)} (réduction de ${reduction}%)`);

      // 4. Generate instant preview for user feedback
      const preview = profilePhotoService.generatePreviewUrl(compressedFile);
      setPreviewUrl(preview);

      // 5. Upload to backend using centralized service avec l'image compressée
      const result = await profilePhotoService.uploadPhoto(compressedFile);

      // 3. Update current photo URL from backend response
      const photoUrl = result.photo_url;
      const fullUrl = photoUrl.startsWith('http') 
        ? photoUrl 
        : buildBackendUrl(photoUrl);
      
      setCurrentPhotoUrl(`${fullUrl}?t=${Date.now()}`);

      // 4. Clean up preview
      if (preview) {
        profilePhotoService.revokePreviewUrl(preview);
        setPreviewUrl(null);
      }

      // 5. Success callback
      if (onUploadSuccess) {
        onUploadSuccess(photoUrl, fullUrl);
      }

      // Show success toast
      toast.success(t('photoUploadedSuccessfully'));

      // Photo uploaded - waiting for user to click "Save" to confirm
    } catch (error) {
      safeLog.error('Error uploading photo:', error);
      
      // Clean up preview on error
      if (previewUrl) {
        profilePhotoService.revokePreviewUrl(previewUrl);
        setPreviewUrl(null);
      }
      
      const errorMessage = error.message || t('error');
      toast.error(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e) => {
    e.preventDefault();
    const files = Array.from(e.target.files);
    handleFiles(files);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const triggerFileSelect = () => {
    document.getElementById('profilePhotoInput').click();
  };

  const getCurrentPhotoUrl = () => {
    // Show preview URL during upload for instant feedback
    if (previewUrl) {
      return previewUrl;
    }
    // Show current photo URL from backend
    if (currentPhotoUrl) {
      return currentPhotoUrl;
    }
    // Generate default avatar if no photo
    if (user) {
      return profilePhotoService.generateDefaultAvatar(user);
    }
    return null;
  };

  const currentPhoto = getCurrentPhotoUrl();

  return (
    <div className={`profile-photo-uploader ${className}`}>
      {/* Photo Preview */}
      <div className="mb-4 text-center">
        <div className="relative inline-block">
          <div className="w-32 h-32 rounded-full bg-gray-200 overflow-hidden border-4 border-white shadow-lg">
            {loading ? (
              <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
              </div>
            ) : currentPhoto ? (
              <img
                src={currentPhoto}
                alt={isCurrentUser ? t('yourProfilePhoto') : t('profilePhotoOptional')}
                className="w-full h-full object-cover"
                onError={(e) => {
                  // Fallback to default avatar on error
                  e.target.src = profilePhotoService.generateDefaultAvatar(user);
                }}
              />
            ) : (
              <div className="w-full h-full bg-orange-100 flex items-center justify-center">
                <span className="text-orange-600 text-2xl font-bold">
                  {profilePhotoService.getUserInitials(user)}
                </span>
              </div>
            )}
          </div>
          
          {(uploading || loading) && (
            <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
          )}
        </div>
      </div>

      {/* Upload Area - Show for current user OR if no target specified */}
      {(isCurrentUser || !targetUserId) && (
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragOver 
              ? 'border-orange-500 bg-orange-50' 
              : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
        <input
          id="profilePhotoInput"
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading}
        />

        <div className="space-y-2">
          <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
            <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          
          <div className="text-gray-600">
            <p className="text-sm">
              <span className="font-medium text-orange-600 hover:text-orange-500 cursor-pointer" onClick={triggerFileSelect}>
                {t('clickToChooseSimple')}
              </span> {t('or')} {t('dragImageHere').toLowerCase()}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {t('imageFormatsLimit')}
            </p>
            <p className="text-xs text-orange-600 mt-1">
              ✨ {t('autoOptimizedFastConnection')}
            </p>
          </div>

        </div>

        <button
          type="button"
          onClick={triggerFileSelect}
          disabled={uploading || loading}
          className="mt-4 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? t('uploadInProgress') : t('choosePhoto')}
        </button>
        </div>
      )}

      {/* Instructions */}
      {(isCurrentUser || !targetUserId) && (
        <div className="mt-4 text-center">
          <p className="text-xs text-gray-500">
            {t('photoVisibleAllUsers')}
          </p>
        </div>
      )}
    </div>
  );
};

export default ProfilePhotoUploader;