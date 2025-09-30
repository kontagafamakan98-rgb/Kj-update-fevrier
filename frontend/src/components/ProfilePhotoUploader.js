import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { safeLog } from '../utils/env';

const ProfilePhotoUploader = ({ onUploadSuccess, currentPhotoUrl = null, className = '' }) => {
  const [photoData, setPhotoData] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  
  const { user, updateUser } = useAuth();
  const { t } = useLanguage();

  const handleFiles = async (files) => {
    const file = files[0];
    if (!file) return;

    // Vérifier le type
    if (!file.type.startsWith('image/')) {
      const errorMessage = t('pleaseSelectImage') || 'Veuillez sélectionner une image (JPG, PNG, etc.)';
      alert(errorMessage);
      return;
    }

    // Vérifier la taille
    if (file.size > 5 * 1024 * 1024) {
      const errorMessage = t('imageTooLarge') || 'L\'image doit faire moins de 5MB';
      alert(errorMessage);
      return;
    }

    setUploading(true);

    try {
      // ⚡ 1. Préparer les données pour l'aperçu local
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target.result;

        setPhotoData({
          file: file,
          base64: base64,
          name: file.name,
          size: file.size
        });

        // ⚡ 2. Préparer les données pour l'upload
        const formData = new FormData();
        formData.append("file", file);

        // ⚡ 3. Envoyer au backend en utilisant le service API centralisé
        const api = await import('../services/api');
        const response = await api.default.post('/users/profile-photo', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || "Erreur lors de l'upload");
        }

        const data = await response.json();
        safeLog.info('Photo uploaded successfully:', data);

        // ⚡ 4. Récupérer l'URL renvoyée par le backend
        const uploadedUrl = `${process.env.REACT_APP_BACKEND_URL}${data.photo_url}`;

        // ⚡ 5. Ajouter le timestamp pour éviter le cache
        const cacheBustedUrl = `${uploadedUrl}?t=${Date.now()}`;

        // Mettre à jour l'état avec l'URL finale
        setPhotoData({
          file: file,
          base64: cacheBustedUrl,
          name: file.name,
          size: file.size,
          uploadedUrl: uploadedUrl
        });

        // Mettre à jour le contexte utilisateur
        if (updateUser) {
          updateUser({
            ...user,
            profile_photo: data.photo_url
          });
        }

        // Callback de succès
        if (onUploadSuccess) {
          onUploadSuccess(data.photo_url, cacheBustedUrl);
        }

        alert(t('photoUploadedSuccessfully') || 'Photo de profil mise à jour avec succès !');
      };

      reader.onerror = (error) => {
        safeLog.error('Erreur lecture fichier:', error);
        alert(t('errorReadingFile') || 'Erreur lors de la lecture du fichier');
        setUploading(false);
      };

      reader.readAsDataURL(file);
    } catch (error) {
      safeLog.error('Erreur upload photo:', error);
      alert(error.message || "Impossible d'envoyer la photo, réessayez.");
      setUploading(false);
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
    if (photoData?.base64) {
      return photoData.base64;
    }
    if (currentPhotoUrl) {
      if (currentPhotoUrl.startsWith('http')) {
        return currentPhotoUrl;
      }
      return `${process.env.REACT_APP_BACKEND_URL}${currentPhotoUrl}?t=${Date.now()}`;
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
            {currentPhoto ? (
              <img
                src={currentPhoto}
                alt="Photo de profil"
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.parentNode.innerHTML = `
                    <div class="w-full h-full bg-orange-100 flex items-center justify-center">
                      <span class="text-orange-600 text-2xl font-bold">
                        ${user?.first_name?.charAt(0) || user?.email?.charAt(0) || '?'}
                      </span>
                    </div>
                  `;
                }}
              />
            ) : (
              <div className="w-full h-full bg-orange-100 flex items-center justify-center">
                <span className="text-orange-600 text-2xl font-bold">
                  {user?.first_name?.charAt(0) || user?.email?.charAt(0) || '?'}
                </span>
              </div>
            )}
          </div>
          
          {uploading && (
            <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
          )}
        </div>
      </div>

      {/* Upload Area */}
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
                Cliquez pour choisir
              </span> ou glissez une image ici
            </p>
            <p className="text-xs text-gray-500 mt-1">
              PNG, JPG, WEBP jusqu'à 5MB
            </p>
          </div>

          {photoData && (
            <div className="mt-3 text-xs text-gray-600">
              <p>📁 {photoData.name}</p>
              <p>📊 {(photoData.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={triggerFileSelect}
          disabled={uploading}
          className="mt-4 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? 'Upload en cours...' : 'Choisir une photo'}
        </button>
      </div>

      {/* Instructions */}
      <div className="mt-4 text-center">
        <p className="text-xs text-gray-500">
          Votre photo de profil sera visible par tous les utilisateurs de Kojo
        </p>
      </div>
    </div>
  );
};

export default ProfilePhotoUploader;