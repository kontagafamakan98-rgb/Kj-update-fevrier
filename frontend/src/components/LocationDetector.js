import React, { useState } from 'react';
import { MapPin, Loader2, Navigation } from 'lucide-react';
import GeolocationService from '../services/geolocationService';
import { useLanguage } from '../contexts/LanguageContext';
import { devLog, safeLog } from '../utils/env';

const LocationDetector = ({ 
  onLocationDetected, 
  userCountry = 'senegal',
  size = 'medium',
  className = '' 
}) => {
  const [detecting, setDetecting] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const { t } = useLanguage();
  
  const getMethodLabel = (method) => {
    const labels = {
      'gps': 'GPS',
      'ip': 'IP',
      'cache': 'Cache',
      'backend_api': 'API',
      'context': 'Auto',
      'default': t('locationNotSpecified')
    };
    return labels[method] || method;
  };

  const handleDetectLocation = async () => {
    setDetecting(true);
    
    try {
      // Vider le cache pour forcer une nouvelle détection réelle
      localStorage.removeItem('kojo_last_location');
      localStorage.removeItem('kojo_precise_location');
      localStorage.removeItem('kojo_detected_country');
      GeolocationService.cachedLocation = null;
      GeolocationService.cacheTimestamp = null;
      
      const location = await GeolocationService.detectUserLocation(userCountry);
      setCurrentLocation(location);
      
      if (onLocationDetected) {
        onLocationDetected(location);
      }
      
    } catch (error) {
      safeLog.error('Erreur détection:', error);
    } finally {
      setDetecting(false);
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'small':
        return 'px-3 py-2 text-sm';
      case 'large':
        return 'px-6 py-4 text-lg';
      default:
        return 'px-4 py-3 text-base';
    }
  };

  const getIconSize = () => {
    switch (size) {
      case 'small': return 16;
      case 'large': return 24;
      default: return 20;
    }
  };

  return (
    <div className={`location-detector ${className}`}>
      <button
        type="button"
        onClick={handleDetectLocation}
        disabled={detecting}
        className={`
          inline-flex items-center justify-center
          ${getSizeClasses()}
          bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400
          text-white font-medium
          border border-transparent rounded-lg
          shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2
          transition-colors duration-200
          ${detecting ? 'cursor-not-allowed' : 'cursor-pointer'}
        `}
        title={detecting ? t('detecting') : t('detectMyLocation')}
      >
        {detecting ? (
          <>
            <Loader2 size={getIconSize()} className="animate-spin mr-2" />
            {t('detecting')}
          </>
        ) : (
          <>
            <Navigation size={getIconSize()} className="mr-2" />
            {t('detectMyLocation')}
          </>
        )}
      </button>
      
      {currentLocation && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-start">
            <MapPin size={16} className="text-green-600 mt-0.5 mr-2 flex-shrink-0" />
            <div className="text-sm">
              <p className="text-green-800 font-medium">{t('detectMyLocation')}</p>
              <p className="text-green-700">{currentLocation.fullAddress}</p>
              <p className="text-green-600 text-xs mt-1">
                {currentLocation.accuracy > 0 ? `±${currentLocation.accuracy}m • ` : ''}{getMethodLabel(currentLocation.method)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LocationDetector;