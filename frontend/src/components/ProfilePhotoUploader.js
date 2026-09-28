import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import { safeLog } from '../utils/env';
import { buildBackendUrl } from '../utils/backendUrl';
import profilePhotoService from '../services/ProfilePhotoService';
import { handleApiError } from '../services/api';
import { compressImage, validateImageFile, formatFileSize } from '../utils/imageOptimization';
import { Zap } from 'lucide-react';
import { Icone } from './chrome-icons';

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
      toast.error(t('photoVisibleAllUsers'));
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
      
      const errorMessage = handleApiError(error, t('error'));
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
          <div className="h-32 w-32 overflow-hidden rounded-full border-4 border-white bg-stone-200">
            {loading ? (
              <div className="flex h-full w-full items-center justify-center bg-stone-100">
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
              <div className="flex h-full w-full items-center justify-center bg-orange-100">
                <span className="text-2xl font-bold text-orange-800">
                  {profilePhotoService.getUserInitials(user)}
                </span>
              </div>
            )}
          </div>
          
          {(uploading || loading) && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
          )}
        </div>
      </div>

      {/* Upload Area - Show for current user OR if no target specified */}
      {(isCurrentUser || !targetUserId) && (
        <div
          className={`rounded-[3px] border-2 border-dashed p-6 text-center transition-colors ${
            dragOver
              ? 'border-orange-500 bg-orange-50'
              : 'border-stone-300 bg-stone-50 hover:bg-stone-100'
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
          {/* Le dessin vient du registre du chrome : il partage donc sa grille de
              24 et son épaisseur avec la barre de navigation et les toasts, au
              lieu d'un tracé emprunté à une autre famille et redimensionné à la
              main sur une grille de 48. h-12 = 48 px, donc épaisseur 1,75. */}
          <Icone nom="photo" classe="mx-auto h-12 w-12 text-stone-400" epaisseur={1.75} />
          
          <div className="text-stone-600">
            <p className="text-sm">
              <span className="cursor-pointer font-medium text-orange-700 hover:text-orange-600" onClick={triggerFileSelect}>
                {t('clickToChooseSimple')}
              </span> {t('or')} {t('dragImageHere').toLowerCase()}
            </p>
            <p className="mt-1 text-xs text-stone-500">
              {t('imageFormatsLimit')}
            </p>
            {/* L'éclair dit ce dont il s'agit (la compression) ; l'étincelle
                décorait. La même taille et le même alignement qu'avant : c'est
                le dessin qui change, pas la ligne sur laquelle il se pose. */}
            <p className="mt-1 text-xs text-orange-700">
              <Zap className="mr-1 inline h-4 w-4 align-[-0.15em]" aria-hidden="true" /> {t('autoOptimizedFastConnection')}
            </p>
          </div>

        </div>

        <button
          type="button"
          onClick={triggerFileSelect}
          disabled={uploading || loading}
          className="bouton bouton-encre mt-4 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? t('uploadInProgress') : t('choosePhoto')}
        </button>
        </div>
      )}

      {/* Instructions */}
      {(isCurrentUser || !targetUserId) && (
        <div className="mt-4 text-center">
          <p className="text-xs text-stone-500">
            {t('photoVisibleAllUsers')}
          </p>
        </div>
      )}
    </div>
  );
};

export default ProfilePhotoUploader;