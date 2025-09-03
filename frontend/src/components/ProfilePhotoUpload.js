import React, { useState, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const ProfilePhotoUpload = ({ photoData, setPhotoData, userType = 'client' }) => {
  const [dragActive, setDragActive] = useState(false);
  const [showCameraOptions, setShowCameraOptions] = useState(false);
  const inputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const { t } = useLanguage();

  const handleFiles = (files) => {
    const file = files[0];
    if (!file) return;

    // Vérifier le type de fichier
    if (!file.type.startsWith('image/')) {
      alert('Veuillez sélectionner une image (JPG, PNG, etc.)');
      return;
    }

    // Vérifier la taille (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('L\'image doit faire moins de 5MB');
      return;
    }

    // Lire le fichier et le convertir en base64
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result;
      setPhotoData({
        file: file,
        base64: base64,
        name: file.name,
        size: file.size
      });
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleGalleryClick = () => {
    inputRef.current?.click();
  };

  const handleCameraClick = () => {
    cameraInputRef.current?.click();
  };

  const showPhotoOptions = () => {
    setShowCameraOptions(true);
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  };

  const removePhoto = () => {
    setPhotoData(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6">
      <div className="flex items-center mb-4">
        <span className="text-2xl mr-3">📸</span>
        <h3 className="text-lg font-semibold text-gray-900">
          {t('profilePhotoOptional')}
        </h3>
      </div>
      
      <p className="text-sm text-gray-600 mb-4">
        {userType === 'worker' 
          ? 'Une photo de profil professionnelle augmente la confiance des clients et améliore vos chances d\'être sélectionné.'
          : 'Une photo de profil aide à personnaliser votre expérience sur Kojo.'
        }
      </p>

      {!photoData ? (
        <>
          {!showCameraOptions ? (
            <div
              className={`relative border-2 border-dashed rounded-lg p-6 transition-colors cursor-pointer ${
                dragActive 
                  ? 'border-blue-500 bg-blue-50' 
                  : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={showPhotoOptions}
            >
              <div className="text-center">
                <div className="text-4xl mb-3">📸</div>
                <div className="text-sm text-gray-600">
                  <p className="font-medium">{t('addProfilePhoto')}</p>
                  <p>{t('clickToChooseOption')}</p>
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  JPG, PNG jusqu'à 5MB
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Options de sélection de photo */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Option Galerie */}
                <button
                  type="button"
                  onClick={handleGalleryClick}
                  className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-blue-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
                >
                  <div className="text-3xl mb-2">🖼️</div>
                  <div className="text-sm font-medium text-blue-900">{t('chooseFromGallery')}</div>
                  <div className="text-xs text-blue-600 mt-1">{t('selectExistingPhoto')}</div>
                </button>

                {/* Option Caméra */}
                <button
                  type="button"
                  onClick={handleCameraClick}
                  className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-green-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors"
                >
                  <div className="text-3xl mb-2">📷</div>
                  <div className="text-sm font-medium text-green-900">{t('takePhoto')}</div>
                  <div className="text-xs text-green-600 mt-1">{t('useCamera')}</div>
                </button>
              </div>

              {/* Bouton Annuler */}
              <button
                type="button"
                onClick={() => setShowCameraOptions(false)}
                className="w-full px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                ← {t('back')}
              </button>

              {/* Inputs cachés */}
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept="image/*"
                onChange={handleFileInput}
              />
              
              <input
                ref={cameraInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                capture="environment"
                onChange={handleFileInput}
              />
            </div>
          )}
        </>
      ) : (
        <div className="space-y-4">
          {/* Aperçu de la photo */}
          <div className="flex items-start space-x-4 p-4 bg-white border border-gray-200 rounded-lg">
            <div className="flex-shrink-0">
              <img
                src={photoData.base64}
                alt="Aperçu"
                className="w-20 h-20 object-cover rounded-full border-2 border-gray-300"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-gray-900 truncate">
                    {photoData.name}
                  </h4>
                  <p className="text-sm text-gray-500">
                    {(photoData.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <button
                  type="button"
                  onClick={removePhoto}
                  className="text-red-600 hover:text-red-700 text-sm font-medium"
                >
                  {t('remove')}
                </button>
              </div>
              
              <div className="mt-2 flex items-center text-sm text-green-600">
                <span className="mr-2">✓</span>
                {t('photoReadyForRegistration')}
              </div>
            </div>
          </div>

          {/* Options pour changer la photo */}
          {!showCameraOptions ? (
            <button
              type="button"
              onClick={showPhotoOptions}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              📷 {t('changePhoto')}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleGalleryClick}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  🖼️ {t('gallery')}
                </button>
                <button
                  type="button"
                  onClick={handleCameraClick}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                >
                  📷 {t('camera')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowCameraOptions(false)}
                className="w-full px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                {t('cancel')}
              </button>
            </div>
          )}
          
          {/* Inputs cachés */}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept="image/*"
            onChange={handleFileInput}
          />
          
          <input
            ref={cameraInputRef}
            type="file"
            className="hidden"
            accept="image/*"
            capture="environment"
            onChange={handleFileInput}
          />
        </div>
      )}

      {/* Conseils pour une bonne photo */}
      <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
        <h4 className="font-medium text-yellow-800 mb-1">💡 {t('tipsGoodPhoto')}</h4>
        <ul className="text-xs text-yellow-700 space-y-1">
          <li>• Utilisez une photo récente et claire</li>
          <li>• Regardez l'objectif et souriez naturellement</li>
          <li>• Évitez les photos de groupe ou avec des lunettes de soleil</li>
          <li>• Un arrière-plan neutre est préférable</li>
          {userType === 'worker' && (
            <li>• Une tenue professionnelle inspire confiance aux clients</li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default ProfilePhotoUpload;