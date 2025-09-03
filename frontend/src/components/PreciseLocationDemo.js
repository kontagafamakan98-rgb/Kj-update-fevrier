import React, { useState, useEffect } from 'react';
import preciseGeolocationService from '../services/preciseGeolocationService';
import { devLog } from '../utils/env';

const PreciseLocationDemo = () => {
  const [location, setLocation] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [accuracy, setAccuracy] = useState(0);
  const [detectionMethod, setDetectionMethod] = useState('');
  const [detectionTime, setDetectionTime] = useState(0);

  const detectLocation = async () => {
    setIsDetecting(true);
    setLocation(null);
    setAccuracy(0);
    setDetectionMethod('');
    
    const startTime = Date.now();
    
    try {
      devLog.info('🎯 Démarrage détection géolocalisation ultra-précise...');
      
      const detectedLocation = await preciseGeolocationService.detectPreciseLocation();
      const endTime = Date.now();
      
      if (detectedLocation) {
        setLocation(detectedLocation);
        setAccuracy(detectedLocation.accuracy);
        setDetectionMethod(detectedLocation.method);
        setDetectionTime(endTime - startTime);
        
        devLog.info('✅ Localisation ultra-précise détectée:', detectedLocation);
      } else {
        devLog.error('❌ Détection de localisation échouée');
      }
    } catch (error) {
      devLog.error('❌ Erreur détection géolocalisation:', error);
    } finally {
      setIsDetecting(false);
    }
  };

  const getAccuracyColor = (accuracy) => {
    if (accuracy >= 90) return '#22c55e'; // Vert - Excellent
    if (accuracy >= 80) return '#3b82f6'; // Bleu - Très bon
    if (accuracy >= 70) return '#f59e0b'; // Orange - Bon
    if (accuracy >= 60) return '#ef4444'; // Rouge - Moyen
    return '#6b7280'; // Gris - Faible
  };

  const getMethodIcon = (method) => {
    const icons = {
      'gps': '📡',
      'ip': '🌐',
      'contextual': '🧠',
      'intelligent_fallback': '🎲'
    };
    return icons[method] || '📍';
  };

  const getMethodName = (method) => {
    const names = {
      'gps': 'GPS Haute Précision',
      'ip': 'Multi-IP Géolocalisation',
      'contextual': 'Analyse Contextuelle',
      'intelligent_fallback': 'Fallback Intelligent'
    };
    return names[method] || 'Inconnu';
  };

  return (
    <div style={{
      maxWidth: '600px',
      margin: '20px auto',
      padding: '20px',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      backgroundColor: '#ffffff',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
    }}>
      <div style={{
        textAlign: 'center',
        marginBottom: '20px'
      }}>
        <h2 style={{
          fontSize: '24px',
          fontWeight: 'bold',
          color: '#1f2937',
          marginBottom: '8px'
        }}>
          🎯 Géolocalisation Ultra-Précise
        </h2>
        <p style={{
          color: '#6b7280',
          fontSize: '14px'
        }}>
          Système multi-méthodes pour une précision de 100%
        </p>
      </div>

      <div style={{
        textAlign: 'center',
        marginBottom: '20px'
      }}>
        <button
          onClick={detectLocation}
          disabled={isDetecting}
          style={{
            backgroundColor: isDetecting ? '#9ca3af' : '#3b82f6',
            color: 'white',
            padding: '12px 24px',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: isDetecting ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s'
          }}
        >
          {isDetecting ? '🔍 Détection en cours...' : '📍 Détecter ma localisation précise'}
        </button>
      </div>

      {location && (
        <div style={{
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          padding: '16px',
          backgroundColor: '#f9fafb'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '12px'
          }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: '600',
              color: '#1f2937',
              margin: '0'
            }}>
              📍 Localisation Détectée
            </h3>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: getAccuracyColor(accuracy)
              }}></div>
              <span style={{
                fontSize: '14px',
                fontWeight: '600',
                color: getAccuracyColor(accuracy)
              }}>
                {accuracy}% précis
              </span>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gap: '12px'
          }}>
            <div>
              <strong style={{ color: '#374151' }}>📍 Adresse complète:</strong>
              <div style={{
                marginTop: '4px',
                padding: '8px',
                backgroundColor: '#ffffff',
                borderRadius: '4px',
                fontSize: '14px'
              }}>
                {location.fullAddress}
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px'
            }}>
              <div>
                <strong style={{ color: '#374151' }}>🏙️ Ville:</strong>
                <div style={{ fontSize: '14px', marginTop: '2px' }}>
                  {location.city}
                </div>
              </div>
              <div>
                <strong style={{ color: '#374151' }}>🏘️ Quartier:</strong>
                <div style={{ fontSize: '14px', marginTop: '2px' }}>
                  {location.district}
                </div>
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px'
            }}>
              <div>
                <strong style={{ color: '#374151' }}>🌍 Pays:</strong>
                <div style={{ fontSize: '14px', marginTop: '2px' }}>
                  {location.country}
                </div>
              </div>
              <div>
                <strong style={{ color: '#374151' }}>📞 Préfixe:</strong>
                <div style={{ fontSize: '14px', marginTop: '2px' }}>
                  {location.phonePrefix}
                </div>
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px'
            }}>
              <div>
                <strong style={{ color: '#374151' }}>🗺️ Coordonnées:</strong>
                <div style={{ fontSize: '12px', marginTop: '2px', fontFamily: 'monospace' }}>
                  {location.coordinates.lat.toFixed(4)}, {location.coordinates.lng.toFixed(4)}
                </div>
              </div>
              <div>
                <strong style={{ color: '#374151' }}>⏱️ Temps:</strong>
                <div style={{ fontSize: '14px', marginTop: '2px' }}>
                  {detectionTime}ms
                </div>
              </div>
            </div>

            <div style={{
              backgroundColor: '#ffffff',
              padding: '12px',
              borderRadius: '4px',
              border: '1px solid #e5e7eb'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px'
              }}>
                <span style={{ fontSize: '20px' }}>
                  {getMethodIcon(detectionMethod)}
                </span>
                <strong style={{ color: '#374151' }}>
                  Méthode: {getMethodName(detectionMethod)}
                </strong>
              </div>
              
              {location.method === 'gps' && location.gpsAccuracy && (
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  Précision GPS: {Math.round(location.gpsAccuracy)}m
                </div>
              )}
              
              {location.method === 'ip' && location.ipServices && (
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  Services IP consultés: {location.ipServices}
                  {location.consensus && ` (consensus: ${Math.round(location.consensus * 100)}%)`}
                </div>
              )}
              
              {location.method === 'contextual' && (
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  Fuseau horaire: {location.timezone}
                  <br />
                  Langues: {location.languages?.join(', ')}
                </div>
              )}
              
              {location.method === 'intelligent_fallback' && location.probability && (
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  Probabilité statistique: {Math.round(location.probability * 100)}%
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{
        marginTop: '20px',
        padding: '12px',
        backgroundColor: '#f0f9ff',
        border: '1px solid #0ea5e9',
        borderRadius: '6px',
        fontSize: '12px',
        color: '#0c4a6e'
      }}>
        <strong>🔬 Méthodes de détection :</strong><br />
        1. GPS haute précision (90-100%)<br />
        2. Multi-IP géolocalisation (80-90%)<br />
        3. Analyse contextuelle (70-80%)<br />
        4. Fallback intelligent (60-70%)
      </div>
    </div>
  );
};

export default PreciseLocationDemo;