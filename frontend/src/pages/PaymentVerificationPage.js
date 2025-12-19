import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import PaymentAccountSetup from '../components/PaymentAccountSetup';
import PaymentAccountService from '../services/paymentAccountService';
import { detectUserCountry, getPhoneExampleForCountry } from '../services/geolocationService';
import { devLog, safeLog } from '../utils/env';

const PaymentVerificationPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { autoLoginAfterRegistration } = useAuth(); // Ajout de la fonction d'auto-login
  const { t } = useLanguage(); // Ajout de la fonction de traduction
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detectedCountry, setDetectedCountry] = useState(null);
  const [geoLoading, setGeoLoading] = useState(true);

  // Données utilisateur passées depuis la page d'inscription
  const userData = location.state?.userData;

  useEffect(() => {
    // Rediriger si pas de données utilisateur
    if (!userData) {
      navigate('/register');
      return;
    }
    
    // Détecter le pays de l'utilisateur
    detectUserLocationForPayments();
  }, [userData, navigate]);

  const detectUserLocationForPayments = async () => {
    try {
      const country = await detectUserCountry();
      if (country) {
        setDetectedCountry(country);
        devLog.info(`📍 Pays détecté pour paiements: ${country.nameFrench} ${country.flag}`);
      }
    } catch (error) {
      safeLog.error('Erreur détection pays pour paiements:', error);
    } finally {
      setGeoLoading(false);
    }
  };

  const handlePaymentAccountsComplete = async (paymentAccounts) => {
    setLoading(true);
    setError(null);

    try {
      devLog.info('📝 Finalisation inscription avec comptes de paiement...');
      
      // Inscription avec vérification des comptes de paiement
      const result = await PaymentAccountService.registerWithPaymentVerification(
        userData,
        paymentAccounts
      );

      if (result.success) {
        // Connexion automatique après inscription réussie
        const autoLoginResult = autoLoginAfterRegistration(result.data.user, result.data.access_token);
        
        if (autoLoginResult.success) {
          devLog.info('🎉 Inscription réussie avec connexion automatique!');
          
          // Sauvegarder le statut de vérification
          PaymentAccountService.storeVerificationStatus({
            is_verified: result.data.user.is_verified,
            payment_accounts_count: result.data.user.payment_accounts_count,
            user_type: result.data.user.user_type
          });

          // Rediriger vers le dashboard avec message de succès
          navigate('/dashboard', {
            state: {
              message: `Bienvenue ${result.data.user.first_name}! Votre compte est vérifié avec ${result.data.payment_verification.linked_accounts} moyen(s) de paiement.`,
              type: 'success'
            }
          });
        } else {
          throw new Error('Erreur lors de la connexion automatique');
        }

      } else {
        throw new Error(result.error);
      }

    } catch (error) {
      safeLog.error('❌ Erreur inscription avec paiement:', error);
      setError(error.message || 'Erreur lors de l\'inscription avec vérification paiement');
    } finally {
      setLoading(false);
    }
  };

  if (!userData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500 mx-auto"></div>
          <div className="mt-4 text-orange-600 font-medium">Redirection...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            {t('paymentVerification')}
          </h1>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 max-w-2xl mx-auto">
            <div className="flex items-center justify-center mb-4">
              <span className="text-4xl mr-4">👋</span>
              <div className="text-left">
                <p className="text-lg font-semibold text-blue-900">
                  Bienvenue {userData.first_name} {userData.last_name}!
                </p>
                <p className="text-blue-700">
                  Type de compte: <span className="font-medium capitalize">{userData.user_type}</span>
                </p>
              </div>
            </div>
            
            {/* Affichage du pays détecté */}
            {geoLoading ? (
              <div className="mb-4 p-3 bg-blue-100 border border-blue-300 rounded text-center">
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
                  <span className="text-sm text-blue-800">Détection de votre position pour ajuster les exemples...</span>
                </div>
              </div>
            ) : detectedCountry ? (
              <div className="mb-4 p-3 bg-green-100 border border-green-300 rounded text-center">
                <p className="text-sm text-green-800">
                  <span className="font-medium">📍 Position:</span> {detectedCountry.flag} {detectedCountry.nameFrench}
                </p>
                <p className="text-xs text-green-600 mt-1">
                  Exemples de numéros et banques ajustés automatiquement
                </p>
              </div>
            ) : (
              <div className="mb-4 p-3 bg-yellow-100 border border-yellow-300 rounded text-center">
                <p className="text-xs text-yellow-700">
                  📍 Position non détectée - Exemples par défaut utilisés
                </p>
              </div>
            )}
            
            <div className="text-sm text-blue-800 space-y-2">
              <p>
                <strong>{t('lastStep')}:</strong> {t('linkAccountsToComplete')}
              </p>
              <p>
                {userData.user_type === 'worker' 
                  ? `🎯 ${t('workerPaymentRequirement')}`
                  : `🎯 ${t('clientPaymentRequirement')}`
                }
              </p>
            </div>
          </div>
        </div>

        {/* Étapes du processus */}
        <div className="mb-8">
          <div className="flex items-center justify-center space-x-4">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-green-500 text-white rounded-full flex items-center justify-center text-sm font-medium">
                ✓
              </div>
              <span className="ml-2 text-sm text-green-600 font-medium">Informations personnelles</span>
            </div>
            
            <div className="w-16 h-1 bg-orange-200"></div>
            
            <div className="flex items-center">
              <div className="w-8 h-8 bg-orange-500 text-white rounded-full flex items-center justify-center text-sm font-medium">
                2
              </div>
              <span className="ml-2 text-sm text-orange-600 font-medium">Comptes de paiement</span>
            </div>
            
            <div className="w-16 h-1 bg-gray-200"></div>
            
            <div className="flex items-center">
              <div className="w-8 h-8 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-sm font-medium">
                3
              </div>
              <span className="ml-2 text-sm text-gray-500 font-medium">Accès à l'application</span>
            </div>
          </div>
        </div>

        {/* Erreur */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center">
              <span className="text-red-500 text-xl mr-3">❌</span>
              <div>
                <h3 className="font-semibold text-red-800">Erreur d'inscription</h3>
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {loading && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-lg text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto"></div>
              <div className="mt-4 text-gray-700 font-medium">Finalisation de l'inscription...</div>
              <div className="text-sm text-gray-500 mt-2">Vérification des comptes de paiement en cours</div>
            </div>
          </div>
        )}

        {/* Composant de configuration des comptes */}
        <PaymentAccountSetup
          userType={userData.user_type}
          isRegistration={true}
          onComplete={handlePaymentAccountsComplete}
        />

        {/* Bouton retour */}
        <div className="mt-8 text-center">
          <button
            onClick={() => navigate('/register')}
            disabled={loading}
            className="text-orange-600 hover:text-orange-700 text-sm font-medium disabled:opacity-50"
          >
            ← Retour à l'inscription
          </button>
        </div>

        {/* Informations de sécurité */}
        <div className="mt-12 bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
            <span className="text-xl mr-2">🔐</span>
            Sécurité et Confidentialité
          </h3>
          <div className="text-sm text-gray-700 space-y-2">
            <p>• Vos informations de paiement sont chiffrées et sécurisées</p>
            <p>• Nous ne stockons jamais vos codes PIN ou mots de passe</p>
            <p>• Les numéros de cartes bancaires sont masqués après validation</p>
            <p>• Seuls les numéros de téléphone des portefeuilles mobiles sont conservés</p>
            <p>• Ces informations servent uniquement aux transferts de paiement Kojo</p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default PaymentVerificationPage;