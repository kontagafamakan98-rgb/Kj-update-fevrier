import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import PaymentAccountService from '../services/paymentAccountService';
import PaymentAccountSetup from './PaymentAccountSetup';

const PaymentAccessGuard = ({ children, showSetupIfNeeded = true }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [accessStatus, setAccessStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    checkPaymentAccess();
  }, [user]);

  const checkPaymentAccess = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const result = await PaymentAccountService.verifyPaymentAccess();
      
      if (result.success) {
        setAccessStatus(result.data);
        
        if (!result.data.access_granted && showSetupIfNeeded) {
          setShowSetup(true);
        }
      } else {
        console.error('Erreur vérification accès:', result.error);
      }
    } catch (error) {
      console.error('Erreur accès paiement:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSetupComplete = async (result) => {
    if (result.success) {
      // Recharger le statut d'accès
      await checkPaymentAccess();
      setShowSetup(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500 mx-auto"></div>
          <div className="mt-4 text-orange-600 font-medium">Vérification des accès...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Connexion requise</h2>
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
          >
            Se connecter
          </button>
        </div>
      </div>
    );
  }

  if (accessStatus && !accessStatus.access_granted) {
    if (showSetup && showSetupIfNeeded) {
      return (
        <div className="min-h-screen bg-gray-50 py-8">
          <div className="max-w-4xl mx-auto px-4">
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-bold text-gray-900 mb-4">
                Configuration des Comptes de Paiement Requise
              </h1>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
                <div className="flex items-center justify-center mb-4">
                  <span className="text-4xl mr-4">⚠️</span>
                  <div>
                    <h3 className="text-lg font-semibold text-yellow-800">
                      Accès limité
                    </h3>
                    <p className="text-yellow-700">
                      {accessStatus.message}
                    </p>
                  </div>
                </div>
                
                <div className="text-sm text-yellow-800 space-y-1">
                  <p>• Type de compte: <span className="font-medium capitalize">{accessStatus.user_type}</span></p>
                  <p>• Comptes liés actuellement: <span className="font-medium">{accessStatus.current_count}</span></p>
                  <p>• Minimum requis: <span className="font-medium">{accessStatus.required_minimum}</span></p>
                </div>
              </div>
            </div>

            <PaymentAccountSetup
              userType={accessStatus.user_type}
              isRegistration={false}
              onComplete={handleSetupComplete}
            />

            <div className="mt-8 text-center">
              <button
                onClick={() => navigate('/dashboard')}
                className="text-orange-600 hover:text-orange-700 text-sm font-medium"
              >
                ← Retour au tableau de bord
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <div className="bg-red-50 border border-red-200 rounded-lg p-8">
            <div className="text-6xl mb-4">🚫</div>
            <h1 className="text-2xl font-bold text-red-800 mb-4">
              Comptes de Paiement Requis
            </h1>
            <p className="text-red-700 mb-6">
              {accessStatus.message}
            </p>
            
            <div className="bg-red-100 border border-red-300 rounded-lg p-4 mb-6">
              <div className="text-sm text-red-800 space-y-1">
                <p>• Type de compte: <span className="font-medium capitalize">{accessStatus.user_type}</span></p>
                <p>• Comptes liés actuellement: <span className="font-medium">{accessStatus.current_count}</span></p>
                <p>• Minimum requis: <span className="font-medium">{accessStatus.required_minimum}</span></p>
              </div>
            </div>

            <div className="space-y-4">
              <button
                onClick={() => navigate('/profile')}
                className="w-full px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Configurer mes Comptes de Paiement
              </button>
              
              <button
                onClick={() => navigate('/dashboard')}
                className="w-full px-6 py-3 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors"
              >
                Retour au Tableau de Bord
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Accès autorisé, afficher le contenu
  return children;
};

export default PaymentAccessGuard;