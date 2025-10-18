import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import PaymentAccountService from '../services/paymentAccountService';
import { detectUserCountry, getPhoneExampleForCountry, getPopularBanksByCountry } from '../services/geolocationService';
import { devLog, safeLog } from '../utils/env';

const PaymentAccountsManager = ({ onSuccess }) => {
  const { user } = useAuth();
  const { t } = useLanguage();
  
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
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [validationErrors, setValidationErrors] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [detectedCountry, setDetectedCountry] = useState(null);
  const [phoneExample, setPhoneExample] = useState('+221 70 12 34 56');
  const [popularBanks, setPopularBanks] = useState([]);

  useEffect(() => {
    loadPaymentAccounts();
    detectUserCountryAsync();
  }, []);

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

  const loadPaymentAccounts = async () => {
    setLoading(true);
    setError('');
    
    try {
      const result = await PaymentAccountService.getUserPaymentAccounts();
      
      if (result.success && result.data) {
        setAccounts({
          orange_money: result.data.orange_money || '',
          wave: result.data.wave || '',
          bank_account: result.data.bank_account || {
            account_number: '',
            bank_name: '',
            account_holder: '',
            bank_code: '',
            branch: ''
          }
        });
      }
    } catch (error) {
      safeLog.error('Erreur chargement comptes:', error);
      setError('Erreur lors du chargement des comptes de paiement');
    } finally {
      setLoading(false);
    }
  };

  const validateOrangeMoneyNumber = (number) => {
    const cleanNumber = number.replace(/[\s\-\+]/g, '');
    const validPrefixes = ['223', '221', '226', '225']; // Mali, Sénégal, Burkina Faso, Côte d'Ivoire
    
    if (!number.trim()) return true; // Empty is valid
    if (cleanNumber.length < 11) return false;
    
    const prefix = cleanNumber.substring(0, 3);
    return validPrefixes.includes(prefix) && cleanNumber.length <= 12;
  };

  const validateWaveNumber = (number) => {
    const cleanNumber = number.replace(/[\s\-\+]/g, '');
    // Wave disponible partout en Afrique de l'Ouest maintenant
    const validPrefixes = ['221', '223', '224', '225', '226', '227', '228', '229'];
    
    if (!number.trim()) return true; // Empty is valid
    if (cleanNumber.length < 11) return false;
    
    const prefix = cleanNumber.substring(0, 3);
    return validPrefixes.includes(prefix) && cleanNumber.length <= 12;
  };

  const validateBankAccount = (bankAccount) => {
    if (!bankAccount.account_number && !bankAccount.bank_name && !bankAccount.account_holder) {
      return true; // All empty is valid
    }
    
    if (!bankAccount.account_number || !bankAccount.bank_name || !bankAccount.account_holder) {
      return false; // Partial completion is invalid
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

  const maskAccountNumber = (accountNumber) => {
    if (!accountNumber || accountNumber.length < 8) return accountNumber;
    return '****' + accountNumber.slice(-4);
  };

  const validateForm = () => {
    const errors = {};
    
    // Validate Orange Money
    if (accounts.orange_money && !validateOrangeMoneyNumber(accounts.orange_money)) {
      errors.orange_money = 'Numéro Orange Money invalide';
    }
    
    // Validate Wave
    if (accounts.wave && !validateWaveNumber(accounts.wave)) {
      errors.wave = 'Numéro Wave invalide';
    }
    
    // Validate Bank Account
    if (!validateBankAccount(accounts.bank_account)) {
      if (accounts.bank_account.account_number || accounts.bank_account.bank_name || accounts.bank_account.account_holder) {
        errors.bank_account = 'Veuillez remplir tous les champs obligatoires du compte bancaire';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      setError('Veuillez corriger les erreurs de validation');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Format phone numbers
      const formattedAccounts = {
        orange_money: accounts.orange_money ? formatPhoneNumber(accounts.orange_money) : '',
        wave: accounts.wave ? formatPhoneNumber(accounts.wave) : '',
        bank_account: accounts.bank_account.account_number ? accounts.bank_account : null
      };

      const result = await PaymentAccountService.updatePaymentAccounts(formattedAccounts);
      
      if (result.success) {
        setSuccess('Comptes de paiement mis à jour avec succès');
        setIsEditing(false);
        if (onSuccess) onSuccess();
        
        // Reload to get updated data
        setTimeout(() => {
          loadPaymentAccounts();
          setSuccess('');
        }, 2000);
      } else {
        setError(result.error || 'Erreur lors de la mise à jour');
      }
    } catch (error) {
      safeLog.error('Erreur sauvegarde comptes:', error);
      setError('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setError('');
    setSuccess('');
    setValidationErrors({});
    loadPaymentAccounts(); // Reload original data
  };

  const getLinkedAccountsCount = () => {
    let count = 0;
    if (accounts.orange_money?.trim()) count++;
    if (accounts.wave?.trim()) count++;
    if (accounts.bank_account?.account_number?.trim()) count++;
    return count;
  };

  const getRequiredMinimum = () => {
    return user?.user_type === 'worker' ? 2 : 1;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t('paymentAccounts')}</h2>
          <p className="text-sm text-gray-600 mt-1">
            {user?.user_type === 'worker' 
              ? `Minimum requis: ${getRequiredMinimum()} comptes (pour recevoir les paiements)`
              : `Minimum requis: ${getRequiredMinimum()} compte (pour effectuer les paiements)`
            }
          </p>
        </div>
        
        <div className="flex items-center space-x-3">
          {/* Status Badge */}
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            getLinkedAccountsCount() >= getRequiredMinimum()
              ? 'bg-green-100 text-green-800'
              : 'bg-yellow-100 text-yellow-800'
          }`}>
            {getLinkedAccountsCount()}/{getRequiredMinimum()} comptes liés
          </div>
          
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
            >
              Modifier
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md mb-4">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md mb-4">
          {success}
        </div>
      )}

      <div className="space-y-6">
        {/* Orange Money */}
        <div className="border rounded-lg p-4">
          <div className="flex items-center mb-3">
            <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center mr-3">
              <span className="text-white text-sm font-bold">OM</span>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Orange Money</h3>
          </div>
          
          {isEditing ? (
            <div>
              <input
                type="tel"
                value={accounts.orange_money}
                onChange={(e) => setAccounts({...accounts, orange_money: e.target.value})}
                placeholder={`Ex: ${phoneExample}`}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                  validationErrors.orange_money ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {validationErrors.orange_money && (
                <p className="text-red-500 text-sm mt-1">{validationErrors.orange_money}</p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Disponible: Mali, Sénégal, Burkina Faso, Côte d'Ivoire
              </p>
            </div>
          ) : (
            <div>
              {accounts.orange_money ? (
                <p className="text-gray-700 font-mono">{accounts.orange_money}</p>
              ) : (
                <p className="text-gray-500 italic">Non configuré</p>
              )}
            </div>
          )}
        </div>

        {/* Wave */}
        <div className="border rounded-lg p-4">
          <div className="flex items-center mb-3">
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center mr-3">
              <span className="text-white text-sm font-bold">W</span>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Wave</h3>
          </div>
          
          {isEditing ? (
            <div>
              <input
                type="tel"
                value={accounts.wave}
                onChange={(e) => setAccounts({...accounts, wave: e.target.value})}
                placeholder={`Ex: ${phoneExample}`}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  validationErrors.wave ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {validationErrors.wave && (
                <p className="text-red-500 text-sm mt-1">{validationErrors.wave}</p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Disponible dans toute l'Afrique de l'Ouest
              </p>
            </div>
          ) : (
            <div>
              {accounts.wave ? (
                <p className="text-gray-700 font-mono">{accounts.wave}</p>
              ) : (
                <p className="text-gray-500 italic">Non configuré</p>
              )}
            </div>
          )}
        </div>

        {/* Bank Account */}
        <div className="border rounded-lg p-4">
          <div className="flex items-center mb-3">
            <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center mr-3">
              <span className="text-white text-sm font-bold">🏦</span>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Compte Bancaire</h3>
          </div>
          
          {isEditing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Numéro de compte *
                </label>
                <input
                  type="text"
                  value={accounts.bank_account.account_number}
                  onChange={(e) => setAccounts({
                    ...accounts, 
                    bank_account: {...accounts.bank_account, account_number: e.target.value}
                  })}
                  placeholder="123456789012"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom de la banque *
                </label>
                <select
                  value={accounts.bank_account.bank_name}
                  onChange={(e) => setAccounts({
                    ...accounts, 
                    bank_account: {...accounts.bank_account, bank_name: e.target.value}
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
                >
                  <option value="">Sélectionner une banque</option>
                  {popularBanks.map((bank, index) => (
                    <option key={index} value={bank}>{bank}</option>
                  ))}
                  <option value="Autre">Autre banque</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nom du titulaire *
                </label>
                <input
                  type="text"
                  value={accounts.bank_account.account_holder}
                  onChange={(e) => setAccounts({
                    ...accounts, 
                    bank_account: {...accounts.bank_account, account_holder: e.target.value}
                  })}
                  placeholder="Nom complet du titulaire"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Code banque (optionnel)
                  </label>
                  <input
                    type="text"
                    value={accounts.bank_account.bank_code}
                    onChange={(e) => setAccounts({
                      ...accounts, 
                      bank_account: {...accounts.bank_account, bank_code: e.target.value}
                    })}
                    placeholder="Code"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Agence (optionnel)
                  </label>
                  <input
                    type="text"
                    value={accounts.bank_account.branch}
                    onChange={(e) => setAccounts({
                      ...accounts, 
                      bank_account: {...accounts.bank_account, branch: e.target.value}
                    })}
                    placeholder="Nom de l'agence"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
                  />
                </div>
              </div>
              
              {validationErrors.bank_account && (
                <p className="text-red-500 text-sm">{validationErrors.bank_account}</p>
              )}
            </div>
          ) : (
            <div>
              {accounts.bank_account?.account_number ? (
                <div className="space-y-2">
                  <p className="text-gray-700">
                    <span className="text-sm text-gray-500">Compte:</span> {maskAccountNumber(accounts.bank_account.account_number)}
                  </p>
                  <p className="text-gray-700">
                    <span className="text-sm text-gray-500">Banque:</span> {accounts.bank_account.bank_name}
                  </p>
                  <p className="text-gray-700">
                    <span className="text-sm text-gray-500">Titulaire:</span> {accounts.bank_account.account_holder}
                  </p>
                  {accounts.bank_account.branch && (
                    <p className="text-gray-700">
                      <span className="text-sm text-gray-500">Agence:</span> {accounts.bank_account.branch}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-gray-500 italic">Non configuré</p>
              )}
            </div>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="flex justify-end space-x-4 mt-6 pt-6 border-t">
          <button
            onClick={handleCancel}
            disabled={saving}
            className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Enregistrement...
              </>
            ) : (
              'Enregistrer'
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default PaymentAccountsManager;