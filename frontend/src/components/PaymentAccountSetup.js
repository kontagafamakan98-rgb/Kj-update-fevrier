import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { detectUserCountry, getPhoneExampleForCountry, getPopularBanksByCountry } from '../services/geolocationService';
import { devLog, safeLog } from '../utils/env';
import { buildApiUrl } from '../utils/backendUrl';
import CountryDisplay from './CountryDisplay';

const createDefaultAccounts = (initialAccounts = null) => ({
  orange_money: initialAccounts?.orange_money || '',
  wave: initialAccounts?.wave || '',
  bank_account: {
    account_number: initialAccounts?.bank_account?.account_number || '',
    bank_name: initialAccounts?.bank_account?.bank_name || '',
    account_holder: initialAccounts?.bank_account?.account_holder || '',
    bank_code: initialAccounts?.bank_account?.bank_code || '',
    branch: initialAccounts?.bank_account?.branch || ''
  }
});

const PaymentAccountSetup = ({ onComplete, userType = 'client', isRegistration = false, initialAccounts = null }) => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [accounts, setAccounts] = useState(() => createDefaultAccounts(initialAccounts));
  
  const [validationErrors, setValidationErrors] = useState(() => ({}));
  const [loading, setLoading] = useState(false);
  const [linkedAccountsCount, setLinkedAccountsCount] = useState(0);
  const [detectedCountry, setDetectedCountry] = useState(null);
  const [phoneExample, setPhoneExample] = useState('+221 70 12 34 56');
  const [popularBanks, setPopularBanks] = useState([]);

  const requiredMinimum = userType === 'worker' ? 2 : 1;
  const supportedOrangeMoneyCountries = [t('mali'), t('senegal'), t('burkina_faso'), t('ivory_coast')].join(', ');

  useEffect(() => {
    // Détecter automatiquement le pays de l'utilisateur
    detectUserCountryAsync();
  }, []);

  useEffect(() => {
    if (initialAccounts) {
      setAccounts(createDefaultAccounts(initialAccounts));
    }
  }, [initialAccounts]);

  const detectUserCountryAsync = async () => {
    try {
      const country = await detectUserCountry();
      setDetectedCountry(country);
      setPhoneExample(getPhoneExampleForCountry(country));
      setPopularBanks(getPopularBanksByCountry(country));
      devLog.info(`🌍 Pays détecté: ${country.nameFrench} ${country.flag}`);
    } catch (error) {
      safeLog.error('Erreur détection pays:', error);
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
      errors.orange_money = t('invalidOrangeMoneyNumber');
    }

    if (accounts.wave && !validateWaveNumber(accounts.wave)) {
      errors.wave = t('invalidWaveNumber');
    }

    if (accounts.bank_account && accounts.bank_account.account_number && !validateBankAccount(accounts.bank_account)) {
      errors.bank_account = t('completeRequiredBankFields');
    }

    if (linkedAccountsCount < requiredMinimum) {
      errors.general = userType === 'worker' ? t('workerPaymentRequirement') : t('clientPaymentRequirement');
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
        bank_account: (accounts.bank_account && accounts.bank_account.account_number) ? accounts.bank_account : null
      };

      if (isRegistration) {
        // Pour l'inscription, retourner les données au parent
        onComplete && onComplete(paymentData);
      } else {
        // Pour la mise à jour, appeler l'API
        const response = await fetch(buildApiUrl('/users/payment-accounts'), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(paymentData)
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || t('error'));
        }

        const result = await response.json();
        onComplete && onComplete(result);
      }

    } catch (error) {
      safeLog.error('Erreur validation comptes:', error);
      setValidationErrors({ general: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          🏦 {t('paymentVerification')}
        </h2>
        <p className="text-gray-600">
          {userType === 'worker' ? t('workerPaymentRequirement') : t('clientPaymentRequirement')}
        </p>
        
        {detectedCountry && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <span className="font-medium">{t('positionDetected')}:</span> <CountryDisplay countryCode={detectedCountry.code} className="inline-flex align-middle" />
              <span className="text-xs text-blue-600 ml-2">({t('adjustedAutomatically')})</span>
            </p>
          </div>
        )}
        
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-blue-900">
              {t('accountsLinked')}: {linkedAccountsCount}/{requiredMinimum} {t('minimumRequired').toLowerCase()}
            </span>
            <div className={`px-3 py-1 rounded-full text-xs font-medium ${
              linkedAccountsCount >= requiredMinimum 
                ? 'bg-green-100 text-green-800' 
                : 'bg-red-100 text-red-800'
            }`}>
              {linkedAccountsCount >= requiredMinimum ? `✅ ${t('validStatus')}` : `❌ ${t('insufficientStatus')}`}
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Orange Money */}
        <div className="border border-orange-200 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <span className="text-2xl mr-3">🧡</span>
            <h3 className="text-lg font-semibold text-gray-900">{t('orangeMoney')}</h3>
            <span className="ml-2 text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
              {supportedOrangeMoneyCountries}
            </span>
          </div>
          
          <input
            id="payment_setup_orange_money"
            name="payment_setup_orange_money"
            type="text"
            value={accounts.orange_money}
            onChange={(e) => handleInputChange('orange_money', e.target.value)}
            placeholder={phoneExample}
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
            <h3 className="text-lg font-semibold text-gray-900">{t('wave')}</h3>
            <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
              {t('availableAcrossWestAfrica')}
            </span>
          </div>
          
          <input
            id="payment_setup_wave"
            name="payment_setup_wave"
            type="text"
            value={accounts.wave}
            onChange={(e) => handleInputChange('wave', e.target.value)}
            placeholder={phoneExample}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
              validationErrors.wave ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {validationErrors.wave && (
            <p className="text-red-500 text-sm mt-1">{validationErrors.wave}</p>
          )}
        </div>

        {/* Compte Bancaire */}
        <div className="border border-green-200 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <span className="text-2xl mr-3">🏦</span>
            <h3 className="text-lg font-semibold text-gray-900">{t('bankAccount')}</h3>
            <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
              {t('forBankTransfers')}
            </span>
          </div>
          
          <div className="space-y-3">
            <input
              id="payment_setup_bank_account_number"
              name="payment_setup_bank_account_number"
              type="text"
              value={accounts.bank_account.account_number}
              onChange={(e) => handleInputChange('bank_account.account_number', e.target.value)}
              placeholder={t('bankAccountNumber')}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 ${
                validationErrors.bank_account ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                id="payment_setup_bank_account_holder"
                name="payment_setup_bank_account_holder"
                type="text"
                value={accounts.bank_account.account_holder}
                onChange={(e) => handleInputChange('bank_account.account_holder', e.target.value)}
                placeholder={t('accountHolderName')}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 ${
                  validationErrors.bank_account ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              
              <select
                id="payment_setup_bank_name"
                name="payment_setup_bank_name"
                value={accounts.bank_account.bank_name}
                onChange={(e) => handleInputChange('bank_account.bank_name', e.target.value)}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 ${
                  validationErrors.bank_account ? 'border-red-500' : 'border-gray-300'
                }`}
              >
                <option value="">{t('selectBank')}</option>
                {popularBanks.map((bank, index) => (
                  <option key={index} value={bank}>{bank}</option>
                ))}
                <option value="other">{t('otherBank')}</option>
              </select>
            </div>
            
            {accounts.bank_account.bank_name === 'other' && (
              <input
                id="payment_setup_other_bank_name"
                name="payment_setup_other_bank_name"
                type="text"
                onChange={(e) => handleInputChange('bank_account.bank_name', e.target.value)}
                placeholder={t('yourBankName')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              />
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                id="payment_setup_bank_code"
                name="payment_setup_bank_code"
                type="text"
                value={accounts.bank_account.bank_code}
                onChange={(e) => handleInputChange('bank_account.bank_code', e.target.value)}
                placeholder={t('bankCodeOptional')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              />
              
              <input
                id="payment_setup_bank_branch"
                name="payment_setup_bank_branch"
                type="text"
                value={accounts.bank_account.branch}
                onChange={(e) => handleInputChange('bank_account.branch', e.target.value)}
                placeholder={t('branchOptional')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          
          {validationErrors.bank_account && (
            <p className="text-red-500 text-sm mt-1">{validationErrors.bank_account}</p>
          )}
          
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded text-xs text-green-800">
            <p><strong>💡 {t('whyTheseInfo')}</strong></p>
            <p>• {t('bankRequiredFieldsInfo')}</p>
            <p>• {t('bankOptionalFieldsInfo')}</p>
            <p>• {t('bankTransferDirectInfo')}</p>
          </div>
        </div>

        {validationErrors.general && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 text-sm">{validationErrors.general}</p>
          </div>
        )}

        <div className="flex justify-between items-center pt-6">
          <div className="text-sm text-gray-600">
            <p>🔐 {t('paymentInfoSecure')}</p>
            <p>📱 {userType === 'worker' ? t('requiredToReceivePayments') : t('requiredToMakePayments')}</p>
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
            {loading ? t('loading') : (isRegistration ? t('submit') : t('save'))}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PaymentAccountSetup;