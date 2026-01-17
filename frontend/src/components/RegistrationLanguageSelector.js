import React, { useState, useEffect } from 'react';
import { devLog, safeLog } from '../utils/env';
import { 
  AVAILABLE_LANGUAGES, 
  getOrderedLanguagesForCountry, 
  getLanguageSuggestionMessage, 
  getPrimaryLanguageForCountry,
  getLocalLanguageForCountry 
} from '../services/geolocationService';
import { useLanguage } from '../contexts/LanguageContext';

const RegistrationLanguageSelector = ({ 
  detectedCountry, 
  selectedLanguage, 
  onLanguageSelect, 
  isLoading = false 
}) => {
  const [orderedLanguages, setOrderedLanguages] = useState([]);
  const [suggestionMessage, setSuggestionMessage] = useState(null);
  const { changeLanguage, t } = useLanguage(); // Utiliser le contexte de langue

  useEffect(() => {
    if (detectedCountry) {
      // Organiser les langues selon le pays détecté
      const languages = getOrderedLanguagesForCountry(detectedCountry);
      setOrderedLanguages(languages);
      
      // Obtenir le message de suggestion
      const suggestion = getLanguageSuggestionMessage(detectedCountry);
      setSuggestionMessage(suggestion);
      
      // Si aucune langue n'est sélectionnée, suggérer la langue locale du pays
      if (!selectedLanguage) {
        const localLang = getLocalLanguageForCountry(detectedCountry);
        devLog.info(`💬 Suggestion de langue pour ${detectedCountry.nameFrench}: ${localLang}`);
      }
    } else {
      // Ordre par défaut sans géolocalisation
      setOrderedLanguages([
        AVAILABLE_LANGUAGES['fr'],
        AVAILABLE_LANGUAGES['en'],
        AVAILABLE_LANGUAGES['wo'], 
        AVAILABLE_LANGUAGES['bm'],
        AVAILABLE_LANGUAGES['mos']
      ]);
    }
  }, [detectedCountry, selectedLanguage]);

  const handleLanguageSelect = (languageCode) => {
    devLog.info(`🔄 Changement de langue: ${languageCode}`);
    
    // Mettre à jour la langue de l'interface immédiatement
    changeLanguage(languageCode);
    
    // Notifier le parent du changement pour le profil
    onLanguageSelect(languageCode);
  };

  if (isLoading) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-500 mr-3"></div>
          <span className="text-gray-600">{t('detectingLanguage') || 'Détection de votre langue préférée...'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-lg p-6">
      <div className="flex items-center mb-4">
        <span className="text-2xl mr-3">🗣️</span>
        <h3 className="text-lg font-semibold text-orange-900">
          {t('choosePreferredLanguage') || 'Choisissez votre langue préférée'}
        </h3>
      </div>

      {/* Message de suggestion basé sur la géolocalisation */}
      {detectedCountry && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start">
            <span className="text-blue-500 text-lg mr-2">💡</span>
            <div className="flex-1">
              <p className="text-sm text-blue-800 font-medium">
                📍 {t('basedOnLocation')} ({detectedCountry.flag} {t(detectedCountry.code === 'mali' ? 'mali' : detectedCountry.code === 'senegal' ? 'senegal' : detectedCountry.code === 'burkina_faso' ? 'burkina_faso' : 'ivory_coast')})
              </p>
              <p className="text-xs text-blue-700 mt-1">
                {detectedCountry.code === 'mali' && t('maliLanguagePreference')}
                {detectedCountry.code === 'senegal' && t('senegalLanguagePreference')}
                {detectedCountry.code === 'burkina_faso' && t('burkinaLanguagePreference')}
                {detectedCountry.code === 'cote_divoire' && t('ivoryCoastLanguagePreference')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sélection des langues */}
      <div>
        <p className="text-sm text-gray-700 mb-3">
          <strong>{t('languageNote') || 'Note :'}</strong> {t('interfaceWillChange') || 'L\'interface changera selon votre choix et cette langue s\'affichera sur votre profil.'}
        </p>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {orderedLanguages.map((language) => {
            const isSelected = selectedLanguage === language.code;
            const isCountryLanguage = language.isCountryLanguage;
            
            return (
              <button
                key={language.code}
                type="button"
                onClick={() => handleLanguageSelect(language.code)}
                className={`relative p-4 border-2 rounded-lg transition-all hover:scale-105 ${
                  isSelected
                    ? 'border-orange-500 bg-orange-100 shadow-md'
                    : isCountryLanguage
                    ? 'border-blue-300 bg-blue-50 hover:border-blue-400'
                    : 'border-gray-300 bg-white hover:border-gray-400'
                }`}
              >
                {/* Badge pour les langues du pays */}
                {isCountryLanguage && !isSelected && (
                  <div className="absolute -top-2 -right-2 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                    📍
                  </div>
                )}
                
                {/* Badge sélection */}
                {isSelected && (
                  <div className="absolute -top-2 -right-2 bg-orange-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                    ✓
                  </div>
                )}

                <div className="text-center">
                  <div className="text-2xl mb-2">{language.flag}</div>
                  <div className="font-medium text-gray-900 text-sm">
                    {language.name}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {language.nativeName}
                  </div>
                  
                  {/* Indicateur pour les langues du pays */}
                  {isCountryLanguage && (
                    <div className="mt-2 text-xs font-medium text-blue-600">
                      {t('localLanguage') || 'Langue locale'}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Langue sélectionnée */}
      {selectedLanguage && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center">
            <span className="text-green-500 text-lg mr-2">✓</span>
            <div>
              <p className="text-sm font-medium text-green-800">
                {t('selectedLanguage') || 'Langue sélectionnée'} : {AVAILABLE_LANGUAGES[selectedLanguage]?.flag} {AVAILABLE_LANGUAGES[selectedLanguage]?.name}
              </p>
              <p className="text-xs text-green-700">
                {t('interfaceAndProfileUpdated') || 'Interface et profil mis à jour'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Information importante */}
      <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
        <div className="flex items-start">
          <span className="text-yellow-600 text-lg mr-2">ℹ️</span>
          <div className="text-xs text-yellow-800">
            <p className="font-medium mb-1">{t('aboutSelection') || 'À propos de votre sélection :'}</p>
            <ul className="space-y-1">
              <li>• {t('interfaceWillChangeNote') || 'L\'interface Kojo changera selon votre langue choisie'}</li>
              <li>• {t('languageOnProfile') || 'Votre langue apparaîtra sur votre profil public'}</li>
              <li>• {t('clientsCanSee') || 'Les clients pourront voir quelle langue vous parlez couramment'}</li>
              <li>• {t('canModifyLater') || 'Vous pourrez modifier ce choix plus tard dans vos paramètres'}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegistrationLanguageSelector;