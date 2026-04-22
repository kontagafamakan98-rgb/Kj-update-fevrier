import React, { useMemo, useState } from 'react';

const MobilePhotoTest = () => {
  const [photos, setPhotos] = useState([]);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const simulatePhotoCapture = () => {
    const newPhoto = {
      id: Date.now(),
      uri: `https://picsum.photos/200/200?random=${Date.now()}`,
      name: `photo_${Date.now()}.jpg`,
      timestamp: new Date().toLocaleString('fr-FR')
    };
    
    setPhotos(prev => [newPhoto, ...prev]);
    setSelectedPhoto(newPhoto);
  };

  const simulatePhotoSelection = () => {
    const newPhoto = {
      id: Date.now(),
      uri: `https://picsum.photos/200/200?random=${Date.now() + 1000}`,
      name: `gallery_${Date.now()}.jpg`, 
      timestamp: new Date().toLocaleString('fr-FR')
    };
    
    setPhotos(prev => [newPhoto, ...prev]);
    setSelectedPhoto(newPhoto);
  };

  const deletePhoto = (photoId) => {
    setPhotos(prev => prev.filter(p => p.id !== photoId));
    if (selectedPhoto?.id === photoId) {
      setSelectedPhoto(null);
    }
  };

  return (
    <div style={{ 
      padding: '20px', 
      maxWidth: '600px', 
      margin: '0 auto',
      fontFamily: 'Arial, sans-serif' 
    }}>
      <h2 style={{ 
        color: '#EA580C', 
        textAlign: 'center',
        marginBottom: '30px' 
      }}>
        🎉 Test Photo de Profil Kojo Mobile
      </h2>
      
      <div style={{ 
        textAlign: 'center',
        marginBottom: '30px' 
      }}>
        <p style={{ 
          backgroundColor: '#f0f0f0',
          padding: '15px',
          borderRadius: '8px',
          color: '#666'
        }}>
          📱 Cette fonctionnalité sera pleinement disponible sur l'application mobile native.<br/>
          Voici une démonstration de la logique sur web.
        </p>
      </div>

      {/* Photo de profil actuelle */}
      <div style={{
        textAlign: 'center',
        marginBottom: '30px'
      }}>
        <h3>Photo de Profil Actuelle</h3>
        <div style={{
          width: '120px',
          height: '120px',
          margin: '0 auto',
          borderRadius: '50%',
          overflow: 'hidden',
          border: '3px solid #EA580C',
          backgroundColor: selectedPhoto ? 'transparent' : '#EA580C',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          {selectedPhoto ? (
            <img 
              src={selectedPhoto.uri} 
              alt="Profile"
              style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: 'cover' 
              }}
            />
          ) : (
            <span style={{ 
              color: 'white', 
              fontSize: '36px', 
              fontWeight: 'bold' 
            }}>
              U
            </span>
          )}
        </div>
        {selectedPhoto && (
          <p style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
            Ajoutée le {selectedPhoto.timestamp}
          </p>
        )}
      </div>

      {/* Boutons d'action */}
      <div style={{
        display: 'flex',
        gap: '10px',
        justifyContent: 'center',
        marginBottom: '30px'
      }}>
        <button
          onClick={simulatePhotoCapture}
          style={{
            backgroundColor: '#EA580C',
            color: 'white',
            border: 'none',
            padding: '12px 20px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          📷 Simuler Appareil Photo
        </button>
        
        <button
          onClick={simulatePhotoSelection}
          style={{
            backgroundColor: '#4ECDC4',
            color: 'white',
            border: 'none',
            padding: '12px 20px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          🖼️ Simuler Galerie
        </button>

        {selectedPhoto && (
          <button
            onClick={() => deletePhoto(selectedPhoto.id)}
            style={{
              backgroundColor: '#FF6B6B',
              color: 'white',
              border: 'none',
              padding: '12px 20px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            🗑️ Supprimer
          </button>
        )}
      </div>

      {/* Galerie des photos */}
      {photos.length > 0 && (
        <div>
          <h3>Historique des Photos</h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: '10px',
            marginTop: '15px'
          }}>
            {photos.slice(0, 6).map(photo => (
              <div
                key={photo.id}
                style={{
                  position: 'relative',
                  cursor: 'pointer'
                }}
                onClick={() => setSelectedPhoto(photo)}
              >
                <img
                  src={photo.uri}
                  alt={`Photo ${photo.id}`}
                  style={{
                    width: '100%',
                    height: '100px',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    border: selectedPhoto?.id === photo.id ? '3px solid #EA580C' : '1px solid #ddd'
                  }}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePhoto(photo.id);
                  }}
                  style={{
                    position: 'absolute',
                    top: '5px',
                    right: '5px',
                    background: 'rgba(255, 0, 0, 0.8)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '50%',
                    width: '20px',
                    height: '20px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fonctionnalités à venir */}
      <div style={{
        marginTop: '40px',
        padding: '20px',
        backgroundColor: '#f9f9f9',
        borderRadius: '8px'
      }}>
        <h3 style={{ color: '#EA580C' }}>🚀 Sur l'App Mobile Native :</h3>
        <ul style={{ color: '#666', lineHeight: '1.6' }}>
          <li>📱 Accès direct à l'appareil photo</li>
          <li>🖼️ Sélection depuis la galerie photos</li>
          <li>✂️ Recadrage automatique en carré</li>
          <li>💾 Sauvegarde persistante</li>
          <li>☁️ Upload vers serveur</li>
          <li>🔐 Gestion des permissions</li>
          <li>⚡ Compression automatique</li>
        </ul>
      </div>
    </div>
  );
};

export default MobilePhotoTest;