import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin, Loader2, Navigation } from 'lucide-react';
import preciseGeolocationService from '../services/preciseGeolocationService';
import { useLanguage } from '../contexts/LanguageContext';
import { safeLog } from '../utils/env';
import { normalizeLocationPayload } from '../utils/locationMaps';

const AUTO_RETRY_MAX_ATTEMPTS = 2;
const AUTO_RETRY_DELAY_MS = 1500;

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
  const autoRetryTimeoutRef = useRef(null);
  const autoRetryCountRef = useRef(0);
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
    if (!location) {
      return t('locationNotSpecified');
    }

    if (location.method === 'ip' || location.method === 'contextual' || location.method === 'context') {
      return 'Localisation auto';
    }

    const gpsAccuracy = Number(location?.gpsAccuracy ?? location?.accuracy);

    if (!Number.isFinite(gpsAccuracy) || gpsAccuracy <= 0) {
      return getMethodLabel(location?.method);
    }

    if (gpsAccuracy <= 10) return 'GPS validé';
    if (gpsAccuracy <= 25) return 'GPS très précis';
    if (gpsAccuracy <= 50) return 'GPS précis';
    if (gpsAccuracy <= 100) return 'GPS moyen';
    return 'GPS approximatif';
  };

  const handleDetectLocation = useCallback(async ({ forceRefresh = true, attempt = 0 } = {}) => {
    setDetecting(true);

    try {
      if (autoRetryTimeoutRef.current) {
        clearTimeout(autoRetryTimeoutRef.current);
        autoRetryTimeoutRef.current = null;
      }

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

      if (normalizedLocation && onLocationDetected) {
        onLocationDetected(normalizedLocation);
      }

      const shouldRetryForPrecision = autoDetect && attempt < AUTO_RETRY_MAX_ATTEMPTS && (!normalizedLocation || !isPreciseLocation(normalizedLocation));

      if (shouldRetryForPrecision) {
        autoRetryCountRef.current = attempt + 1;
        autoRetryTimeoutRef.current = setTimeout(() => {
          handleDetectLocation({ forceRefresh: true, attempt: attempt + 1 });
        }, AUTO_RETRY_DELAY_MS);
      }
    } catch (error) {
      safeLog.error('Erreur détection:', error);
    } finally {
      setDetecting(false);
    }
  }, [autoDetect, onLocationDetected, userCountry]);

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
    autoRetryCountRef.current = 0;
    handleDetectLocation({ forceRefresh: false, attempt: 0 });

    return () => {
      if (autoRetryTimeoutRef.current) {
        clearTimeout(autoRetryTimeoutRef.current);
        autoRetryTimeoutRef.current = null;
      }
    };
  }, [autoDetect, handleDetectLocation]);

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
              {!isPreciseLocation(currentLocation) && autoRetryCountRef.current < AUTO_RETRY_MAX_ATTEMPTS && (
                <p className="text-xs text-amber-700 mt-1">Amélioration GPS automatique en cours...</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LocationDetector;
