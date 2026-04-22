import React, { useState, useEffect } from 'react';
import { devLog, safeLog } from '../utils/env';

const SimplePhotoUpload = ({ userId, size = 100 }) => {
  const [photo, setPhoto] = useState(null);

  // Charger la photo au montage
  useEffect(() => {
    if (userId) {
      const savedPhoto = localStorage.getItem(`photo_${userId}`);
      if (savedPhoto) {
        setPhoto(savedPhoto);
        devLog.info('Photo chargée depuis localStorage');
      }
    }
  }, [userId]);

  // Sélectionner et sauver la photo
  const handlePhotoSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target.result;
          
          // Sauver dans localStorage
          localStorage.setItem(`photo_${userId}`, base64);
          
          // Afficher immédiatement
          setPhoto(base64);
          
          devLog.info('Photo sauvée et affichée !');
        };
        reader.readAsDataURL(file);
      }
    };
    
    input.click();
  };

  // Supprimer la photo
  const handlePhotoDelete = () => {
    if (confirm('Supprimer la photo ?')) {
      localStorage.removeItem(`photo_${userId}`);
      setPhoto(null);
      devLog.info('Photo supprimée');
    }
  };

  // Générer initiales
  const getInitials = () => {
    return userId ? userId.substring(0, 2).toUpperCase() : '??';
  };

  const containerStyle = {
    width: size,
    height: size,
    borderRadius: '50%',
    overflow: 'hidden',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ea580c',
    color: 'white',
    fontSize: size * 0.3,
    fontWeight: 'bold',
    position: 'relative',
    border: '2px solid #ccc'
  };

  const imageStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  };

  const deleteButtonStyle = {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: 'red',
    color: 'white',
    border: 'none',
    borderRadius: '50%',
    width: 20,
    height: 20,
    fontSize: 12,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  return (
    <div style={containerStyle} onClick={handlePhotoSelect}>
      {photo ? (
        <>
          <img src={photo} alt="Profile" style={imageStyle} />
          {photo && (
            <button
              style={deleteButtonStyle}
              onClick={(e) => {
                e.stopPropagation();
                handlePhotoDelete();
              }}
            >
              ×
            </button>
          )}
        </>
      ) : (
        <div>{getInitials()}</div>
      )}
    </div>
  );
};

export default SimplePhotoUpload;