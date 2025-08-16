import { useState, useEffect } from 'react';
import { isPWA, isPWASupported } from '../utils/pwa';

export default function PWABadge() {
  const [showBadge, setShowBadge] = useState(false);

  useEffect(() => {
    // Show PWA badge if running as PWA
    if (isPWA() && isPWASupported()) {
      setShowBadge(true);
    }
  }, []);

  if (!showBadge) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 hidden md:block">
      <div className="bg-orange-600 text-white px-3 py-1 rounded-full shadow-lg flex items-center space-x-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
        </svg>
        <span className="text-xs font-medium">App installée</span>
      </div>
    </div>
  );
}