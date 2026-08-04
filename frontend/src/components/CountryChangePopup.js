import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCountry } from '../contexts/CountryContext';
import { useLanguage } from '../contexts/LanguageContext';
import { geolocationAPI } from '../services/api';

const CountryChangePopup = () => {
  const { user } = useAuth();
  const { currentCountry, availableCountries, changeUserCountry, isOwner } = useCountry();
  const { t } = useLanguage();
  const [showPopup, setShowPopup] = useState(false);
  const [detectedCountry, setDetectedCountry] = useState(null);

  useEffect(() => {
    if (!user || isOwner) return;

    // Check if user already dismissed the popup this session or permanently
    const sessionDismissed = sessionStorage.getItem('country_popup_dismissed');
    const permanentDismissed = localStorage.getItem('country_popup_never_show');
    if (sessionDismissed || permanentDismissed) return;

    const detectLocation = async () => {
      try {
        const response = await geolocationAPI.detect({});
        // Use detected country if it differs from current user country and is in available list
        if (
          response.detected && 
          response.country && 
          response.country.id !== currentCountry &&
          availableCountries.some(c => c.id === response.country.id)
        ) {
          setDetectedCountry(response.country);
          setShowPopup(true);
        }
      } catch (error) {
        console.error('Erreur lors de la détection du pays:', error);
      }
    };

    detectLocation();
  }, [user, currentCountry, availableCountries, isOwner]);

  if (!showPopup || !detectedCountry) return null;

  const handleAccept = async () => {
    const success = await changeUserCountry(detectedCountry.id);
    if (success) {
      setShowPopup(false);
      window.location.reload();
    }
  };

  const handleDecline = () => {
    sessionStorage.setItem('country_popup_dismissed', 'true');
    setShowPopup(false);
  };

  const handleNeverShow = () => {
    localStorage.setItem('country_popup_never_show', 'true');
    setShowPopup(false);
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.popup}>
        <h3 style={styles.title}>
          {t('detectedViaGeolocation') || 'Nouveau pays détecté'}
        </h3>
        <p style={styles.text}>
          Il semble que vous soyez en <strong>{detectedCountry.name}</strong> {detectedCountry.flag}.
          Voulez-vous basculer vers Kojo {detectedCountry.name} pour voir les annonces locales ?
        </p>
        <div style={styles.buttons}>
          <button style={styles.acceptButton} onClick={handleAccept}>
            {t('save') || 'Accepter'}
          </button>
          <button style={styles.declineButton} onClick={handleDecline}>
            {t('cancel') || 'Plus tard'}
          </button>
        </div>
        <button style={styles.neverShowButton} onClick={handleNeverShow}>
          Ne plus me demander
        </button>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: 9999,
    width: '300px',
    maxWidth: 'calc(100% - 40px)',
  },
  popup: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: '16px',
    padding: '20px',
    boxShadow: '0 10px 25px rgba(0,0,0,0.1), 0 4px 10px rgba(0,0,0,0.05)',
    border: '1px solid rgba(255,255,255,0.2)',
    fontFamily: "'Inter', sans-serif",
  },
  title: {
    marginTop: 0,
    marginBottom: '10px',
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
  },
  text: {
    fontSize: '14px',
    color: '#555',
    marginBottom: '15px',
    lineHeight: 1.5,
  },
  buttons: {
    display: 'flex',
    gap: '10px',
    marginBottom: '10px',
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    color: 'white',
    border: 'none',
    padding: '8px 12px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '14px',
  },
  declineButton: {
    flex: 1,
    backgroundColor: '#f1f1f1',
    color: '#333',
    border: 'none',
    padding: '8px 12px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '14px',
  },
  neverShowButton: {
    background: 'none',
    border: 'none',
    color: '#888',
    fontSize: '12px',
    width: '100%',
    textAlign: 'center',
    cursor: 'pointer',
    padding: '5px',
    textDecoration: 'underline',
  }
};

export default CountryChangePopup;
