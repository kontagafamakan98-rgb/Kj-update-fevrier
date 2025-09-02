import React, { useState } from 'react';
import PaymentSelector, { PaymentSummary, PaymentProcess } from '../components/PaymentSelector';
import LanguageSelector from '../components/LanguageSelector';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { usePayment } from '../contexts/PaymentContext';

const PaymentDemo = () => {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const { processPaymentWithCommission } = usePayment();
  const [paymentAmount, setPaymentAmount] = useState(25000); // Increased for better demonstration
  const [selectedCountry, setSelectedCountry] = useState('senegal');
  const [showCommissionDemo, setShowCommissionDemo] = useState(false);
  const [commissionResult, setCommissionResult] = useState(null);
  const [processing, setProcessing] = useState(false);

  const handlePaymentSuccess = (result) => {
    alert(`Paiement réussi! Transaction: ${result.transactionId}`);
  };

  const handlePaymentError = (error) => {
    alert(`Erreur de paiement: ${error}`);
  };

  // Démo commission style Uber
  const simulateUberStylePayment = async () => {
    setProcessing(true);
    setCommissionResult(null);
    
    try {
      // Simuler un paiement avec commission automatique
      const result = await processPaymentWithCommission(
        paymentAmount,
        'XOF',
        'worker_123',
        'job_uber_demo_456'
      );
      
      setCommissionResult(result);
    } catch (error) {
      setCommissionResult({
        success: false,
        error: error.message
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        
        {/* Header avec sélecteur de langue */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-3xl font-bold text-gray-900">
              🌍 Démonstration Langues & Paiements
            </h1>
            <LanguageSelector showDropdown={true} showFlags={true} />
          </div>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h2 className="font-medium text-blue-900 mb-2">
              🎯 Nouvelles Fonctionnalités Ajoutées
            </h2>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>✅ Support de l'anglais (English) ajouté</li>
              <li>✅ Méthodes de paiement: Carte bancaire, Orange Money, Wave</li>
              <li>✅ Système de commission automatique (modèle Uber: 14% propriétaire, 86% travailleur)</li>
              <li>✅ Traductions complètes en 4 langues (FR, EN, WO, BM)</li>
              <li>✅ Sélecteur de pays automatique</li>
            </ul>
          </div>
        </div>

        {/* Section Commission Uber Style */}
        <div className="mb-8 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-green-900">
              🚗 Commission Automatique (Modèle Uber)
            </h2>
            <button
              onClick={() => setShowCommissionDemo(!showCommissionDemo)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              {showCommissionDemo ? 'Masquer' : 'Tester Commission'}
            </button>
          </div>
          
          <div className="text-sm text-green-800 mb-4">
            <p><strong>Comment ça marche:</strong> Comme chez Uber, chaque paiement est automatiquement divisé:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li><strong>14%</strong> vers Propriétaire de l'application (vous)</li>
              <li><strong>86%</strong> vers Travailleur qui réalise la mission</li>
              <li>Les transferts sont automatiques vers les comptes préférés</li>
            </ul>
          </div>

          {showCommissionDemo && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Configuration montant */}
                <div className="bg-white p-4 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Montant du service (XOF):
                  </label>
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    min="1000"
                    step="1000"
                  />
                </div>

                {/* Calcul automatique */}
                <div className="bg-white p-4 rounded-lg">
                  <div className="text-sm">
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-600">Montant total:</span>
                      <span className="font-semibold">{paymentAmount.toLocaleString()} XOF</span>
                    </div>
                    <div className="flex justify-between mb-2 text-green-600">
                      <span>Votre commission (14%):</span>
                      <span className="font-semibold">{Math.round(paymentAmount * 0.14).toLocaleString()} XOF</span>
                    </div>
                    <div className="flex justify-between text-blue-600">
                      <span>Vers travailleur (86%):</span>
                      <span className="font-semibold">{Math.round(paymentAmount * 0.86).toLocaleString()} XOF</span>
                    </div>
                  </div>
                </div>

                {/* Bouton test */}
                <div className="bg-white p-4 rounded-lg flex items-center">
                  <button
                    onClick={simulateUberStylePayment}
                    disabled={processing}
                    className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {processing ? '⏳ Traitement...' : '🚀 Simuler Paiement'}
                  </button>
                </div>
              </div>

              {/* Résultat de la commission */}
              {commissionResult && (
                <div className={`p-4 rounded-lg ${
                  commissionResult.success 
                    ? 'bg-green-100 border border-green-200' 
                    : 'bg-red-100 border border-red-200'
                }`}>
                  {commissionResult.success ? (
                    <div>
                      <h3 className="font-semibold text-green-800 mb-2">
                        ✅ Paiement et Commission Réussis!
                      </h3>
                      <div className="text-sm text-green-700 space-y-1">
                        <p><strong>Transaction ID:</strong> {commissionResult.transactionId}</p>
                        <p><strong>Message:</strong> {commissionResult.message}</p>
                        {commissionResult.commission && (
                          <div className="mt-2 p-2 bg-white rounded">
                            <p><strong>Détails commission:</strong></p>
                            <p>• Total: {commissionResult.commission.totalAmount.toLocaleString()} XOF</p>
                            <p>• Votre part: {commissionResult.commission.ownerCommission.toLocaleString()} XOF (14%)</p>
                            <p>• Travailleur: {commissionResult.commission.workerAmount.toLocaleString()} XOF (86%)</p>
                          </div>
                        )}
                        <p className="mt-3 text-xs">
                          🔗 <a href="/commission-dashboard" className="text-green-600 hover:underline">
                            Voir le tableau de bord des commissions
                          </a>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <h3 className="font-semibold text-red-800 mb-2">❌ Erreur de paiement</h3>
                      <p className="text-sm text-red-700">{commissionResult.error}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Section Langues */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              🗣️ Sélecteur de Langues
            </h2>
            
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Version Dropdown:
                </h3>
                <LanguageSelector showDropdown={true} />
              </div>
              
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Version Boutons:
                </h3>
                <LanguageSelector showDropdown={false} />
              </div>
              
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-medium text-gray-900 mb-2">
                  Exemples de traductions:
                </h4>
                <div className="text-sm space-y-1">
                  <div><strong>{t('home')}:</strong> Accueil</div>
                  <div><strong>{t('jobs')}:</strong> Emplois</div>
                  <div><strong>{t('payment')}:</strong> {t('payment')}</div>
                  <div><strong>{t('bankCard')}:</strong> {t('bankCard')}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Section Paiements */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              💳 Méthodes de Paiement
            </h2>
            
            <div className="space-y-4">
              {/* Sélecteur de pays */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pays / Country:
                </label>
                <select
                  value={selectedCountry}
                  onChange={(e) => setSelectedCountry(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="senegal">🇸🇳 Sénégal</option>
                  <option value="mali">🇲🇱 Mali</option>
                  <option value="burkina_faso">🇧🇫 Burkina Faso</option>
                  <option value="ivory_coast">🇨🇮 Côte d'Ivoire</option>
                </select>
              </div>

              {/* Montant */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Montant (XOF):
                </label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  min="500"
                  step="500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section principale de démonstration paiement */}
        <div className="mt-8 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">
            💰 Simulation de Paiement (Sans Commission)
          </h2>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Sélection méthode */}
            <div>
              <PaymentSelector 
                userCountry={selectedCountry}
                onMethodSelected={(method) => {
                  console.log('Méthode sélectionnée:', method);
                }}
              />
            </div>
            
            {/* Résumé et traitement */}
            <div className="space-y-4">
              <PaymentSummary 
                amount={paymentAmount}
                currency="XOF"
              />
              
              <PaymentProcess
                amount={paymentAmount}
                currency="XOF"
                jobId="demo_job_123"
                onSuccess={handlePaymentSuccess}
                onError={handlePaymentError}
              />
            </div>
          </div>
        </div>

        {/* Informations techniques */}
        <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-yellow-800 mb-3">
            🔧 Informations Techniques
          </h2>
          <div className="text-sm text-yellow-700 space-y-2">
            <p><strong>Langues supportées:</strong> Français, English, Wolof, Bambara</p>
            <p><strong>Méthodes de paiement:</strong> Carte bancaire (2.5%), Orange Money (1%), Wave (gratuit)</p>
            <p><strong>Pays supportés:</strong> Mali, Sénégal, Burkina Faso, Côte d'Ivoire</p>
            <p><strong>Monnaie:</strong> Franc CFA (XOF)</p>
            <p><strong>Commission automatique:</strong> 14% propriétaire, 86% travailleur (modèle Uber)</p>
            <p><strong>Note:</strong> Ceci est une démonstration - les paiements sont simulés</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentDemo;