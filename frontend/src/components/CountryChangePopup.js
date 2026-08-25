import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCountry } from '../contexts/CountryContext';
import { useLanguage } from '../contexts/LanguageContext';
import { geolocationAPI } from '../services/api';
import { safeLog } from '../utils/env';

const CountryChangePopup = () => {
  const { user } = useAuth();
  const { currentCountry, availableCountries, changeUserCountry, isOwner } = useCountry();
  const { t } = useLanguage();
  const [showPopup, setShowPopup] = useState(false);
  const [detectedCountry, setDetectedCountry] = useState(null);

  useEffect(() => {
    if (!user || isOwner) return;

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
          // Mémorisations de refus PAR PAYS : « Plus tard » = silencieux
          // pour cette session et ce pays ; « Ne plus demander » = définitif
          // pour ce pays. Un voyageur qui alterne Mali ↔ Sénégal n'est pas
          // bloqué à jamais sur un seul refus — chaque pays est indépendant.
          const sessionDismissed = sessionStorage.getItem('country_popup_dismissed');
          const permanentDismissed = localStorage.getItem('country_popup_never_show');
          const permanentForCountry = localStorage.getItem(`country_popup_never_show_${response.country.id}`);
          if (sessionDismissed === response.country.id || permanentDismissed || permanentForCountry) {
            return;
          }
          setDetectedCountry(response.country);
          setShowPopup(true);
        }
      } catch (error) {
        safeLog.error('Erreur lors de la détection du pays:', error);
      }
    };

    detectLocation();
  }, [user, currentCountry, availableCountries, isOwner]);

  if (!showPopup || !detectedCountry) return null;

  const handleAccept = async () => {
    // changeUserCountry rafraîchit déjà le contexte (loadUser) : pas de
    // window.location.reload() qui écraserait l'état React en cours.
    await changeUserCountry(detectedCountry.id);
    setShowPopup(false);
  };

  const handleDecline = () => {
    // Refus mémorisé PAR PAYS pour la session : si l'utilisateur se déplace
    // vers un autre pays, la question se reposera (une fois), pour ce pays.
    sessionStorage.setItem('country_popup_dismissed', detectedCountry.id);
    setShowPopup(false);
  };

  const handleNeverShow = () => {
    // Refus définitif PAR PAYS (et compat avec l'ancienne clé globale).
    localStorage.setItem('country_popup_never_show', 'true');
    localStorage.setItem(`country_popup_never_show_${detectedCountry.id}`, 'true');
    setShowPopup(false);
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.popup}>
        <h3 style={styles.title}>
          {t('detectedViaGeolocation') || 'Nouveau pays détecté'}
        </h3>
        <p style={styles.text}>
          {t('popupDetectedIn')} <strong>{detectedCountry.name}</strong> {detectedCountry.flag}.
          {t('popupSwitchQuestion')}
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
          {t('neverAskAgain')}
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
    color: '#666',
    fontSize: '12px',
    width: '100%',
    textAlign: 'center',
    cursor: 'pointer',
    padding: '5px',
    textDecoration: 'underline',
  }
};

export default CountryChangePopup;
