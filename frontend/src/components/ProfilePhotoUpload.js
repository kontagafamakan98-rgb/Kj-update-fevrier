import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import { devLog, safeLog } from '../utils/env';
import { photoFormatsLine } from '../config/photo-formats';
import { IconePage, CLASSES_ICONE } from '../config/page-icons';
import { Image, Camera, Check } from 'lucide-react';

// Les deux glyphes sont DESSINÉS (icônes SVG) : leur nom est passé par la page,
// qui le lit de son plan (`PAGE_SECTIONS['/register'].photoIcon` / `.photoTipsIcon`),
// pour que les deux canaux publient le MÊME dessin. Les valeurs par défaut
// couvrent un montage hors de /register.
const ProfilePhotoUpload = ({
  photoData,
  setPhotoData,
  userType = 'client',
  iconePhoto = 'profilePhoto',
  iconeConseils = 'photoTips',
  // La classe du BLOC, posée par la page au lieu d'être décidée ici : c'est une
  // décision de mise en page (ce bloc est sous la ligne de flottaison de
  // /register, donc différé — voir `bloc-differe-photo` dans src/App.css), et le
  // composant sert aussi ailleurs. Vide par défaut : aucun effet hors de là.
  classeBloc = '',
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [showCameraOptions, setShowCameraOptions] = useState(false);
  
  const inputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const { t } = useLanguage();
  const toast = useToast();

  const handleFiles = (files) => {
    const file = files[0];
    if (!file) return;

    // Vérifier le type de fichier
    if (!file.type.startsWith('image/')) {
      const errorMessage = t('pleaseSelectImage') || 'Veuillez sélectionner une image (JPG, PNG, etc.)';
      toast.error(errorMessage);
      return;
    }

    // Vérifier la taille (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      const errorMessage = t('imageTooLarge') || 'L’image doit faire moins de 5MB';
      toast.error(errorMessage);
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
    reader.onerror = (error) => {
      safeLog.error('Error reading file:', error);
      const errorMessage = t('errorReadingFile') || 'Erreur lors de la lecture du fichier';
      toast.error(errorMessage);
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
    <div className={`carte-editoriale carte-publique mb-6${classeBloc ? ` ${classeBloc}` : ''}`}>
      <div className="mb-4 flex items-center gap-3">
        <IconePage nom={iconePhoto} classe={CLASSES_ICONE.photoTitre} />
        <h3 className="titre-entree">
          {t('profilePhotoOptional')}
        </h3>
      </div>
      
      <p className="mb-4 text-sm text-stone-600">
        {userType === 'worker' 
          ? t('professionalPhotoHelps') || 'Une photo de profil professionnelle augmente la confiance des clients et améliore vos chances d’être sélectionné.'
          : t('profilePhotoHelps')
        }
      </p>

      {!photoData ? (
        <>
          {!showCameraOptions ? (
            <div
              className={`relative cursor-pointer rounded-[3px] border-2 border-dashed p-6 transition-colors ${
                dragActive
                  ? 'border-orange-500 bg-orange-50'
                  : 'border-stone-300 hover:border-stone-400 hover:bg-stone-50'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={showPhotoOptions}
            >
              <div className="text-center">
                <div className="mb-3 flex justify-center"><IconePage nom={iconePhoto} classe={CLASSES_ICONE.photoZone} /></div>
                <div className="text-sm text-stone-600">
                  <p className="font-medium">{t('addProfilePhoto')}</p>
                  <p>{t('clickToChooseOption')}</p>
                </div>
                <div className="mt-2 text-xs text-stone-500">
                  {photoFormatsLine(t('upTo') || 'jusqu’à')}
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
                  className="flex flex-col items-center justify-center gap-1 rounded-[3px] border-2 border-dashed border-stone-300 p-6 text-center transition-colors hover:border-orange-400 hover:bg-orange-50"
                >
                  <Image className="h-8 w-8 text-orange-700" aria-hidden="true" />
                  <div className="text-sm font-medium text-stone-800">{t('chooseFromGallery')}</div>
                  <div className="text-xs text-stone-500">{t('selectExistingPhoto')}</div>
                </button>

                {/* Option Caméra */}
                <button
                  type="button"
                  onClick={handleCameraClick}
                  className="flex flex-col items-center justify-center gap-1 rounded-[3px] border-2 border-dashed border-stone-300 p-6 text-center transition-colors hover:border-orange-400 hover:bg-orange-50"
                >
                  <Camera className="h-8 w-8 text-orange-700" aria-hidden="true" />
                  <div className="text-sm font-medium text-stone-800">{t('takePhoto')}</div>
                  <div className="text-xs text-stone-500">{t('useCamera')}</div>
                </button>
              </div>

              {/* Bouton Annuler */}
              <button
                type="button"
                onClick={() => setShowCameraOptions(false)}
                className="w-full px-4 py-2 text-sm text-stone-600 transition-colors hover:text-orange-700"
              >
                {t('back')}
              </button>

              {/* Inputs cachés */}
              <input
                id="profile_photo_file_picker_mobile"
                name="profile_photo_file_picker_mobile"
                ref={inputRef}
                type="file"
                className="hidden"
                accept="image/*"
                onChange={handleFileInput}
              />
              
              <input
                id="profile_photo_camera_picker_mobile"
                name="profile_photo_camera_picker_mobile"
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
          <div className="flex items-start gap-4 rounded-[3px] border border-stone-200 fond-sable p-4">
            <div className="flex-shrink-0">
              <img
                src={photoData.base64}
                alt={t('preview')}
                className="w-20 h-20 object-cover rounded-full border border-stone-300"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="truncate font-medium text-stone-900">
                    {photoData.name}
                  </h4>
                  <p className="text-sm text-stone-500">
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
              
              <div className="mt-2 flex items-center gap-2 text-sm text-orange-700">
                <Check className="h-4 w-4" aria-hidden="true" />
                {t('photoReadyForRegistration')}
              </div>
            </div>
          </div>

          {/* Options pour changer la photo */}
          {!showCameraOptions ? (
            <button
              type="button"
              onClick={showPhotoOptions}
              className="bouton bouton-clair w-full"
            >
              <Camera className="h-4 w-4" aria-hidden="true" /> {t('changePhoto')}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleGalleryClick}
                  className="bouton bouton-encre"
                >
                  <Image className="h-4 w-4" aria-hidden="true" /> {t('gallery')}
                </button>
                <button
                  type="button"
                  onClick={handleCameraClick}
                  className="bouton bouton-clair"
                >
                  <Camera className="h-4 w-4" aria-hidden="true" /> {t('camera')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowCameraOptions(false)}
                className="w-full px-4 py-2 text-sm text-stone-600 transition-colors hover:text-orange-700"
              >
                {t('cancel')}
              </button>
            </div>
          )}
          
          {/* Inputs cachés */}
          <input
            id="profile_photo_file_picker"
            name="profile_photo_file_picker"
            ref={inputRef}
            type="file"
            className="hidden"
            accept="image/*"
            onChange={handleFileInput}
          />
          
          <input
            id="profile_photo_camera_picker"
            name="profile_photo_camera_picker"
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
      {/* Les conseils sont une NOTICE : la note orange du site, au lieu d'un
          jaune qui n'appartenait à personne. Elle garde la mesure de `p-3` —
          le vocabulaire change la TEINTE, pas la boîte : ce bloc est mesuré par
          le budget de /register, et une notice plus haute déplaçait tout ce qui
          le suit. */}
      <div className="mt-4 rounded-[3px] border border-orange-200 bg-orange-50 p-3">
        <h4 className="mb-1 font-medium text-orange-900"><IconePage nom={iconeConseils} classe={CLASSES_ICONE.notice} /> {t('tipsGoodPhoto')}</h4>
        <ul className="space-y-1 text-xs text-orange-800">
          <li>• {t('useRecentPhoto')}</li>
          <li>• {t('lookCamera')}</li>
          <li>• {t('avoidGroup')}</li>
          <li>• {t('neutralBackground')}</li>
          {userType === 'worker' && (
            <li>• {t('professionalOutfit') || 'Une tenue professionnelle inspire confiance aux clients'}</li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default ProfilePhotoUpload;