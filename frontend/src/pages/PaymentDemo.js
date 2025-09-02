import React, { useState } from 'react';
import PaymentSelector, { PaymentSummary, PaymentProcess } from '../components/PaymentSelector';
import LanguageSelector from '../components/LanguageSelector';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

const PaymentDemo = () => {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const [paymentAmount, setPaymentAmount] = useState(5000);
  const [selectedCountry, setSelectedCountry] = useState('senegal');

  const handlePaymentSuccess = (result) => {
    alert(`Paiement réussi! Transaction: ${result.transactionId}`);
  };

  const handlePaymentError = (error) => {
    alert(`Erreur de paiement: ${error}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        
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
              <li>✅ Traductions complètes en 4 langues (FR, EN, WO, BM)</li>
              <li>✅ Sélecteur de pays automatique</li>
            </ul>
          </div>
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
            💰 Simulation de Paiement
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
            <p><strong>Note:</strong> Ceci est une démonstration - les paiements sont simulés</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentDemo;