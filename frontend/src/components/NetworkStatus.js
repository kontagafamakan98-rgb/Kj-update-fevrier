/**
 * Network Status Component - Real-time network quality indicator for West African users
 */

import React, { useState, useEffect } from 'react';
import networkOptimizer from '../utils/networkOptimizer';
import { useLanguage } from '../contexts/LanguageContext';

const NetworkStatus = ({ showDetails = false, className = '' }) => {
  const [networkStatus, setNetworkStatus] = useState(networkOptimizer.getStatusDisplay());
  const [isVisible, setIsVisible] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    // Subscribe to network changes
    const unsubscribe = networkOptimizer.addListener((quality, isOnline) => {
      const statusDisplay = networkOptimizer.getStatusDisplay();
      setNetworkStatus(statusDisplay);
      
      // Show indicator for poor networks or offline
      setIsVisible(!isOnline || quality === 'poor' || quality === 'moderate');
    });

    // Initial check
    const initialStatus = networkOptimizer.getStatusDisplay();
    setNetworkStatus(initialStatus);
    setIsVisible(!networkOptimizer.isNetworkOnline() || initialStatus.quality === 'poor' || initialStatus.quality === 'moderate');

    return unsubscribe;
  }, []);

  // Don't render if network is excellent
  if (!isVisible && !showDetails) {
    return null;
  }

  const getNetworkMessage = () => {
    switch (networkStatus.quality) {
      case 'offline':
        return t('networkOffline') || 'Vous êtes hors ligne. Certaines fonctionnalités peuvent être limitées.';
      case 'poor':
        return t('networkPoor') || 'Connexion lente détectée. Optimisation automatique activée.';
      case 'moderate':
        return t('networkModerate') || 'Connexion modérée. Économie de données activée.';
      case 'good':
        return t('networkGood') || 'Bonne connexion';
      case 'excellent':
        return t('networkExcellent') || 'Excellente connexion';
      default:
        return t('networkUnknown') || 'État du réseau inconnu';
    }
  };

  const getNetworkTips = () => {
    switch (networkStatus.quality) {
      case 'offline':
        return t('networkTipsOffline') || '• Les actions seront synchronisées au retour de la connexion\n• Les données en cache restent disponibles';
      case 'poor':
        return t('networkTipsPoor') || '• Images optimisées pour économiser la bande passante\n• Fonctionnalités temps-réel désactivées\n• Cache étendu pour éviter les rechargements';
      case 'moderate':
        return t('networkTipsModerate') || '• Qualité des images réduite\n• Synchronisation moins fréquente\n• Priorité aux fonctionnalités essentielles';
      default:
        return '';
    }
  };

  const getBackgroundColor = () => {
    switch (networkStatus.quality) {
      case 'offline':
        return 'bg-red-50 border-red-200';
      case 'poor':
        return 'bg-orange-50 border-orange-200';
      case 'moderate':
        return 'bg-yellow-50 border-yellow-200';
      case 'good':
        return 'bg-green-50 border-green-200';
      case 'excellent':
        return 'bg-blue-50 border-blue-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getTextColor = () => {
    switch (networkStatus.quality) {
      case 'offline':
        return 'text-red-700';
      case 'poor':
        return 'text-orange-700';
      case 'moderate':
        return 'text-yellow-700';
      case 'good':
        return 'text-green-700';
      case 'excellent':
        return 'text-blue-700';
      default:
        return 'text-gray-700';
    }
  };

  if (showDetails) {
    return (
      <div className={`rounded-lg border p-4 ${getBackgroundColor()} ${className}`}>
        <div className="flex items-start space-x-3">
          <div className="text-2xl">{networkStatus.emoji}</div>
          <div className="flex-1">
            <h3 className={`font-medium ${getTextColor()}`}>
              {t('networkStatusLabel')} : {networkStatus.text}
            </h3>
            <p className={`text-sm mt-1 ${getTextColor()}`}>
              {getNetworkMessage()}
            </p>
            {getNetworkTips() && (
              <div className={`text-xs mt-2 ${getTextColor()} bg-white bg-opacity-50 rounded p-2`}>
                <strong>{t('activeOptimizations')} :</strong>
                <pre className="whitespace-pre-wrap mt-1">{getNetworkTips()}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Compact version for mobile
  return (
    <div className={`fixed top-16 right-4 z-50 ${className}`}>
      <div className={`rounded-lg border px-3 py-2 shadow-lg ${getBackgroundColor()}`}>
        <div className="flex items-center space-x-2">
          <span className="text-lg">{networkStatus.emoji}</span>
          <span className={`text-sm font-medium ${getTextColor()}`}>
            {networkStatus.text}
          </span>
        </div>
      </div>
    </div>
  );
};

export default NetworkStatus;