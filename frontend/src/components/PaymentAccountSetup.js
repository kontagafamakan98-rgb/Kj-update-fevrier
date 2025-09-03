import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { detectUserCountry, getPhoneExampleForCountry, getPopularBanksByCountry } from '../services/geolocationService';

const PaymentAccountSetup = ({ onComplete, userType = 'client', isRegistration = false }) => {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState({
    orange_money: '',
    wave: '',
    bank_account: {
      account_number: '',
      bank_name: '',
      account_holder: '',
      bank_code: '',
      branch: ''
    }
  });
  
  const [validationErrors, setValidationErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [linkedAccountsCount, setLinkedAccountsCount] = useState(0);
  const [detectedCountry, setDetectedCountry] = useState(null);
  const [phoneExample, setPhoneExample] = useState('+221 70 12 34 56');
  const [popularBanks, setPopularBanks] = useState([]);

  const requiredMinimum = userType === 'worker' ? 2 : 1;

  useEffect(() => {
    // Détecter automatiquement le pays de l'utilisateur
    detectUserCountryAsync();
  }, []);

  const detectUserCountryAsync = async () => {
    try {
      const country = await detectUserCountry();
      setDetectedCountry(country);
      setPhoneExample(getPhoneExampleForCountry(country));
      setPopularBanks(getPopularBanksByCountry(country));
      console.log(`🌍 Pays détecté: ${country.nameFrench} ${country.flag}`);
    } catch (error) {
      console.error('Erreur détection pays:', error);
    }
  };

  useEffect(() => {
    // Compter les comptes liés
    let count = 0;
    if (accounts.orange_money.trim()) count++;
    if (accounts.wave.trim()) count++;
    if (accounts.bank_account && accounts.bank_account.account_number.trim() && 
        accounts.bank_account.bank_name.trim() && accounts.bank_account.account_holder.trim()) count++;
    setLinkedAccountsCount(count);
  }, [accounts]);

  const validateOrangeMoneyNumber = (number) => {
    const cleanNumber = number.replace(/[\s\-\+]/g, '');
    const validPrefixes = ['223', '221', '226', '225']; // Mali, Sénégal, Burkina Faso, Côte d'Ivoire
    
    if (cleanNumber.length < 11) return false;
    
    const prefix = cleanNumber.substring(0, 3);
    return validPrefixes.includes(prefix) && cleanNumber.length <= 12;
  };

  const validateWaveNumber = (number) => {
    const cleanNumber = number.replace(/[\s\-\+]/g, '');
    // Wave disponible partout en Afrique de l'Ouest
    const validPrefixes = ['221', '223', '224', '225', '226', '227', '228', '229'];
    
    if (cleanNumber.length < 11) return false;
    
    const prefix = cleanNumber.substring(0, 3);
    return validPrefixes.includes(prefix) && cleanNumber.length <= 12;
  };

  const validateBankAccount = (bankAccount) => {
    if (!bankAccount.account_number || !bankAccount.bank_name || !bankAccount.account_holder) {
      return false;
    }
    
    const accountNumber = bankAccount.account_number.replace(/[\s\-]/g, '');
    return accountNumber.length >= 8 && 
           bankAccount.bank_name.trim().length >= 3 && 
           bankAccount.account_holder.trim().length >= 2;
  };

  const formatPhoneNumber = (number) => {
    const cleanNumber = number.replace(/[\s\-]/g, '');
    if (cleanNumber.startsWith('+')) return cleanNumber;
    if (cleanNumber.length >= 11) {
      const prefix = cleanNumber.substring(0, 3);
      return `+${prefix}${cleanNumber.substring(3)}`;
    }
    return number;
  };

  const formatBankCard = (cardNumber) => {
    const cleanCard = cardNumber.replace(/[\s\-]/g, '');
    return cleanCard.replace(/(.{4})/g, '$1-').slice(0, -1);
  };

  const handleInputChange = (field, value) => {
    if (field === 'orange_money' || field === 'wave') {
      value = formatPhoneNumber(value);
      setAccounts(prev => ({
        ...prev,
        [field]: value
      }));
    } else if (field.startsWith('bank_account.')) {
      const bankField = field.split('.')[1];
      setAccounts(prev => ({
        ...prev,
        bank_account: {
          ...prev.bank_account,
          [bankField]: value
        }
      }));
    }

    // Clear validation error for this field
    if (validationErrors[field]) {
      setValidationErrors(prev => ({
        ...prev,
        [field]: null
      }));
    }
  };

  const validateForm = () => {
    const errors = {};

    if (accounts.orange_money && !validateOrangeMoneyNumber(accounts.orange_money)) {
      errors.orange_money = 'Numéro Orange Money invalide (format: +223XXXXXXXX)';
    }

    if (accounts.wave && !validateWaveNumber(accounts.wave)) {
      errors.wave = 'Numéro Wave invalide (disponible partout en Afrique de l\'Ouest)';
    }

    if (accounts.bank_account && accounts.bank_account.account_number && !validateBankAccount(accounts.bank_account)) {
      errors.bank_account = 'Informations de compte bancaire incomplètes ou invalides';
    }

    if (linkedAccountsCount < requiredMinimum) {
      errors.general = `${userType === 'worker' ? 'Les travailleurs' : 'Les clients'} doivent lier au moins ${requiredMinimum} moyen${requiredMinimum > 1 ? 's' : ''} de paiement`;
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const paymentData = {
        orange_money: accounts.orange_money || null,
        wave: accounts.wave || null,
        bank_card: accounts.bank_card || null,
        bank_name: accounts.bank_name || null
      };

      if (isRegistration) {
        // Pour l'inscription, retourner les données au parent
        onComplete && onComplete(paymentData);
      } else {
        // Pour la mise à jour, appeler l'API
        const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/users/payment-accounts`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(paymentData)
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Erreur lors de la mise à jour');
        }

        const result = await response.json();
        onComplete && onComplete(result);
      }

    } catch (error) {
      console.error('Erreur validation comptes:', error);
      setValidationErrors({ general: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          🏦 Vérification des Comptes de Paiement
        </h2>
        <p className="text-gray-600">
          {userType === 'worker' 
            ? 'Les travailleurs doivent lier au minimum 2 moyens de paiement pour recevoir leurs paiements'
            : 'Les clients doivent lier au moins 1 moyen de paiement pour effectuer des paiements'
          }
        </p>
        
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-blue-900">
              Comptes liés: {linkedAccountsCount}/{requiredMinimum} minimum requis
            </span>
            <div className={`px-3 py-1 rounded-full text-xs font-medium ${
              linkedAccountsCount >= requiredMinimum 
                ? 'bg-green-100 text-green-800' 
                : 'bg-red-100 text-red-800'
            }`}>
              {linkedAccountsCount >= requiredMinimum ? '✅ Valide' : '❌ Insuffisant'}
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Orange Money */}
        <div className="border border-orange-200 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <span className="text-2xl mr-3">🧡</span>
            <h3 className="text-lg font-semibold text-gray-900">Orange Money</h3>
            <span className="ml-2 text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
              Mali, Sénégal, Burkina Faso, Côte d'Ivoire
            </span>
          </div>
          
          <input
            type="text"
            value={accounts.orange_money}
            onChange={(e) => handleInputChange('orange_money', e.target.value)}
            placeholder="+221701234567"
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 ${
              validationErrors.orange_money ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {validationErrors.orange_money && (
            <p className="text-red-500 text-sm mt-1">{validationErrors.orange_money}</p>
          )}
        </div>

        {/* Wave */}
        <div className="border border-blue-200 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <span className="text-2xl mr-3">🌊</span>
            <h3 className="text-lg font-semibold text-gray-900">Wave</h3>
            <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
              Sénégal, Côte d'Ivoire
            </span>
          </div>
          
          <input
            type="text"
            value={accounts.wave}
            onChange={(e) => handleInputChange('wave', e.target.value)}
            placeholder="+221701234567"
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
              validationErrors.wave ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {validationErrors.wave && (
            <p className="text-red-500 text-sm mt-1">{validationErrors.wave}</p>
          )}
        </div>

        {/* Carte Bancaire */}
        <div className="border border-green-200 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <span className="text-2xl mr-3">💳</span>
            <h3 className="text-lg font-semibold text-gray-900">Carte Bancaire</h3>
            <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
              Visa, Mastercard
            </span>
          </div>
          
          <div className="space-y-3">
            <input
              type="text"
              value={accounts.bank_card}
              onChange={(e) => handleInputChange('bank_card', e.target.value)}
              placeholder="1234-5678-9012-3456"
              maxLength="19"
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 ${
                validationErrors.bank_card ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {validationErrors.bank_card && (
              <p className="text-red-500 text-sm mt-1">{validationErrors.bank_card}</p>
            )}
            
            {accounts.bank_card && (
              <input
                type="text"
                value={accounts.bank_name}
                onChange={(e) => handleInputChange('bank_name', e.target.value)}
                placeholder="Nom de la banque (ex: Banque Atlantique)"
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 ${
                  validationErrors.bank_name ? 'border-red-500' : 'border-gray-300'
                }`}
              />
            )}
            {validationErrors.bank_name && (
              <p className="text-red-500 text-sm mt-1">{validationErrors.bank_name}</p>
            )}
          </div>
        </div>

        {validationErrors.general && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 text-sm">{validationErrors.general}</p>
          </div>
        )}

        <div className="flex justify-between items-center pt-6">
          <div className="text-sm text-gray-600">
            <p>🔐 Vos informations de paiement sont sécurisées</p>
            <p>📱 Nécessaire pour {userType === 'worker' ? 'recevoir' : 'effectuer'} les paiements</p>
          </div>
          
          <button
            type="submit"
            disabled={loading || linkedAccountsCount < requiredMinimum}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              loading || linkedAccountsCount < requiredMinimum
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-orange-600 text-white hover:bg-orange-700'
            }`}
          >
            {loading ? 'Validation...' : (isRegistration ? 'Continuer' : 'Mettre à jour')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PaymentAccountSetup;