import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2, Navigation } from 'lucide-react';
import preciseGeolocationService from '../services/preciseGeolocationService';
import { useLanguage } from '../contexts/LanguageContext';
import { safeLog } from '../utils/env';
import { normalizeLocationPayload } from '../utils/locationMaps';

const LocationDetector = ({
  onLocationDetected,
  userCountry = 'senegal',
  size = 'medium',
  className = '',
  autoDetect = false
}) => {
  const [detecting, setDetecting] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const autoDetectTriggeredRef = useRef(false);
  const { t } = useLanguage();

  const getMethodLabel = (method) => {
    const labels = {
      gps: 'GPS',
      ip: 'IP',
      cache: 'Cache GPS',
      backend_api: 'API',
      contextual: 'Auto',
      context: 'Auto',
      default: t('locationNotSpecified')
    };
    return labels[method] || method;
  };

  const isPreciseLocation = (location) => {
    const gpsAccuracy = Number(location?.gpsAccuracy ?? location?.accuracy);
    return Boolean(
      location &&
      (location.method === 'gps' || location.method === 'cache') &&
      Number.isFinite(gpsAccuracy) &&
      gpsAccuracy > 0 &&
      gpsAccuracy <= 35
    );
  };

  const getPrecisionLabel = (location) => {
    const gpsAccuracy = Number(location?.gpsAccuracy ?? location?.accuracy);

    if (!Number.isFinite(gpsAccuracy) || gpsAccuracy <= 0) {
      return getMethodLabel(location?.method);
    }

    if (gpsAccuracy <= 10) return 'GPS ultra précis';
    if (gpsAccuracy <= 25) return 'GPS très précis';
    if (gpsAccuracy <= 50) return 'GPS précis';
    if (gpsAccuracy <= 100) return 'GPS moyen';
    return 'GPS faible';
  };

  const handleDetectLocation = async ({ forceRefresh = true } = {}) => {
    setDetecting(true);

    try {
      if (forceRefresh) {
        localStorage.removeItem('kojo_last_location');
        localStorage.removeItem('kojo_precise_location');
        localStorage.removeItem('kojo_detected_country');
        preciseGeolocationService.cachedLocation = null;
        preciseGeolocationService.cacheTimestamp = null;
      }

      const location = await preciseGeolocationService.detectPreciseLocation({ forceRefresh, userCountry });
      const normalizedLocation = location ? normalizeLocationPayload(location) : null;
      setCurrentLocation(normalizedLocation);

      const shouldAutoPopulate = forceRefresh || isPreciseLocation(normalizedLocation);

      if (normalizedLocation && shouldAutoPopulate && onLocationDetected) {
        onLocationDetected(normalizedLocation);
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
      case 'small':
        return 16;
      case 'large':
        return 24;
      default:
        return 20;
    }
  };

  useEffect(() => {
    if (!autoDetect || autoDetectTriggeredRef.current) return;

    autoDetectTriggeredRef.current = true;
    handleDetectLocation({ forceRefresh: false });
  }, [autoDetect, userCountry]);

  return (
    <div className={`location-detector ${className}`}>
      <button
        type="button"
        onClick={() => handleDetectLocation({ forceRefresh: true })}
        disabled={detecting}
        aria-label={detecting ? t('detecting') : t('detectMyLocation')}
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
        <div className={`mt-3 p-3 border rounded-lg ${isPreciseLocation(currentLocation) ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-start">
            <MapPin size={16} className={`${isPreciseLocation(currentLocation) ? 'text-green-600' : 'text-amber-600'} mt-0.5 mr-2 flex-shrink-0`} />
            <div className="text-sm">
              <p className={`font-medium ${isPreciseLocation(currentLocation) ? 'text-green-800' : 'text-amber-800'}`}>
                {getPrecisionLabel(currentLocation)}
              </p>
              <p className={isPreciseLocation(currentLocation) ? 'text-green-700' : 'text-amber-700'}>{currentLocation.fullAddress}</p>
              <p className={`${isPreciseLocation(currentLocation) ? 'text-green-600' : 'text-amber-600'} text-xs mt-1`}>
                {currentLocation.accuracy > 0 ? `±${currentLocation.accuracy}m • ` : ''}
                {getMethodLabel(currentLocation.method)}
                {currentLocation.confidence ? ` • ${currentLocation.confidence}%` : ''}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LocationDetector;
