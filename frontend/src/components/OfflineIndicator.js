import { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Icone } from './chrome-icons';

export default function OfflineIndicator() {
  const { t } = useLanguage();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showOfflineMessage, setShowOfflineMessage] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowOfflineMessage(false);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowOfflineMessage(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (!navigator.onLine) {
      setShowOfflineMessage(true);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!showOfflineMessage && isOnline) return null;

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 transition-transform duration-300 ${showOfflineMessage ? 'translate-y-0' : '-translate-y-full'}`}>
      {!isOnline ? (
        <div className="bg-red-600 text-white text-center py-2 px-4">
          <div className="flex items-center justify-center space-x-2">
            <Icone nom="croix" classe="w-4 h-4" />
            <span className="text-sm font-medium">{t('networkOffline')}</span>
          </div>
        </div>
      ) : (
        <div className="bg-green-600 text-white text-center py-2 px-4">
          <div className="flex items-center justify-center space-x-2">
            <Icone nom="coche" classe="w-4 h-4" />
            <span className="text-sm font-medium">{t('connectionRestored')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
