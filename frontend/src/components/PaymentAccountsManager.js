import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import PaymentAccountService from '../services/paymentAccountService';
import { detectUserCountry, getPhoneExampleForCountry, getPhonePrefixByCountry, getPopularBanksByCountry } from '../services/geolocationService';
import { mapPaymentAccountErrorToField } from '../utils/paymentAccountErrors';
import { devLog, safeLog } from '../utils/env';
import { CHAMP } from '../config/classes-champ';
import { Landmark } from 'lucide-react';

const PaymentAccountsManager = ({ onSuccess }) => {
  const { user } = useAuth();
  const { t } = useLanguage();
  
  const [accounts, setAccounts] = useState({
    orange_money: '',
    wave: '',
    // NOM DU TITULAIRE du wallet (25/10/2026) : sans lui, rien ne prouve que le
    // numéro déclaré est celui de la personne — un versement pouvait partir sur
    // le compte d’un tiers. Il vit à côté des numéros, et il est OBLIGATOIRE
    // pour que le décaissement soit vérifiable (`kojo_kyc`).
    holder_name: '',
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
  // L’ÉTAT du titulaire, calculé par le serveur (`kojo_kyc`) : l’écran affiche
  // un fait — il ne devine pas si un versement est possible.
  const [walletVerification, setWalletVerification] = useState(null);
  const supportedOrangeMoneyCountries = [t('mali'), t('senegal'), t('burkina_faso'), t('ivory_coast')].join(', ');

  // Wave n'est opéré que par PayDunya au Sénégal et en Côte d'Ivoire : un
  // compte Wave lié au Mali/Burkina serait refusé au moment du paiement.
  const WAVE_UNAVAILABLE_COUNTRIES = ['mali', 'burkina_faso'];
  const isWaveUnavailable = Boolean(
    detectedCountry && WAVE_UNAVAILABLE_COUNTRIES.includes(detectedCountry.code)
  );

  useEffect(() => {
    loadPaymentAccounts();
    detectUserCountryAsync();
  }, []);

  const detectUserCountryAsync = async () => {
    try {
      const country = await detectUserCountry();
      if (!country || country.detected === false) {
        // Détection impossible (IP/GPS indisponible — detectUserCountry renvoie
        // un objet neutre `detected:false`, jamais null) : l'utilisateur
        // choisira son pays manuellement — ne pas réinitialiser un pays déjà
        // choisi ni utiliser un code vide.
        setDetectedCountry(null);
        return;
      }
      setDetectedCountry(country);
      setPhoneExample(getPhoneExampleForCountry(country));
      setPopularBanks(getPopularBanksByCountry(country));
      devLog.info(`🌍 Pays détecté: ${country.nameFrench}`);
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
        const savedAccounts = result.data.payment_accounts || {};
        setWalletVerification(result.data.wallet_verification || null);
        setAccounts({
          orange_money: savedAccounts.orange_money || '',
          wave: savedAccounts.wave || '',
          holder_name: savedAccounts.holder_name || '',
          bank_account: savedAccounts.bank_account || {
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
      setError(t('paymentAccountsLoadError'));
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
    // Numéro local sans indicatif (8-9 chiffres, zéro initial éventuel) :
    // on ajoute automatiquement l'indicatif du pays détecté pour correspondre
    // au format international exigé par le backend (ex: 771234567 → +221771234567).
    const local = cleanNumber.startsWith('0') ? cleanNumber.slice(1) : cleanNumber;
    if (local.length >= 8 && local.length <= 9 && detectedCountry?.code) {
      return `${getPhonePrefixByCountry(detectedCountry.code)}${local}`;
    }
    return number;
  };

  // Un état, une phrase : l’écran dit ce qui est BLOQUÉ et par qui ça se
  // débloque, au lieu de laisser la personne découvrir le refus au moment du
  // versement.
  const walletStateLabel = (etat) => {
    if (etat === 'verifie') return t('walletStateVerified');
    if (etat === 'en_attente') return t('walletStatePending');
    if (etat === 'refuse') return t('walletStateRefused');
    return t('walletStateNotDeclared');
  };

  const maskAccountNumber = (accountNumber) => {
    if (!accountNumber || accountNumber.length < 8) return accountNumber;
    return '****' + accountNumber.slice(-4);
  };

  const validateForm = () => {
    const errors = {};
    
    // Validate Orange Money
    if (accounts.orange_money && !validateOrangeMoneyNumber(accounts.orange_money)) {
      errors.orange_money = t('invalidOrangeMoneyNumber');
    }
    
    // Validate Wave
    if (accounts.wave && isWaveUnavailable) {
      errors.wave = t('waveUnavailableInYourCountry');
    } else if (accounts.wave && !validateWaveNumber(accounts.wave)) {
      errors.wave = t('invalidWaveNumber');
    }
    
    // Validate Bank Account
    if (!validateBankAccount(accounts.bank_account)) {
      if (accounts.bank_account.account_number || accounts.bank_account.bank_name || accounts.bank_account.account_holder) {
        errors.bank_account = t('completeRequiredBankFields');
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      setError(t('correctValidationErrors'));
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Format phone numbers
      const formattedAccounts = {
        orange_money: accounts.orange_money ? formatPhoneNumber(accounts.orange_money) : '',
        wave: !isWaveUnavailable && accounts.wave ? formatPhoneNumber(accounts.wave) : '',
        // Le titulaire part avec les numéros : il ne sert à rien sans eux, et
        // le serveur le compare au nom du compte à chaque écriture.
        holder_name: accounts.holder_name.trim(),
        bank_account: accounts.bank_account.account_number ? accounts.bank_account : null
      };

      const result = await PaymentAccountService.updatePaymentAccounts(formattedAccounts);
      
      if (result.success) {
        setSuccess(t('paymentAccountsUpdated'));
        setIsEditing(false);
        if (onSuccess) onSuccess();
        
        // Reload to get updated data immediately without timer noise
        await loadPaymentAccounts();
      } else {
        // Erreur backend avec un champ précis (ex: « Numéro Wave invalide ») :
        // affichée sous le champ concerné au lieu d'une erreur générale.
        const fieldError = mapPaymentAccountErrorToField(result.error);
        if (fieldError) {
          setValidationErrors({ [fieldError.field]: fieldError.message });
          setError('');
        } else {
          setError(result.error || t('updateError'));
        }
      }
    } catch (error) {
      safeLog.error('Erreur sauvegarde comptes:', error);
      setError(t('saveError'));
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
    // Compter UNIQUEMENT les numéros valides au format international (indicatif
    // pays requis, aligné sur la validation backend). Un numéro incomplet ou
    // sans indicatif ne doit pas être compté comme un compte lié.
    let count = 0;
    if (accounts.orange_money?.trim() && validateOrangeMoneyNumber(accounts.orange_money)) count++;
    if (!isWaveUnavailable && accounts.wave?.trim() && validateWaveNumber(accounts.wave)) count++;
    if (accounts.bank_account?.account_number?.trim() && validateBankAccount(accounts.bank_account)) count++;
    return count;
  };

  const getRequiredMinimum = () => {
    return user?.user_type === 'worker' ? 2 : 1;
  };

  if (loading) {
    return (
      <div className="rounded-[3px] border border-stone-200 bg-white p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-stone-200 rounded-sm w-1/4 mb-4"></div>
          <div className="h-4 bg-stone-200 rounded-sm w-full mb-2"></div>
          <div className="h-4 bg-stone-200 rounded-sm w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div data-section="comptes-paiement" className="rounded-[3px] border border-stone-200 bg-white p-6">
      {/* L'EN-TÊTE SE REPLIE : sur 412 px, un titre, un compte d'étapes et le
          bouton ne tiennent pas sur une rangée — le bouton sortait de la carte.
          Le repli est une décision de CARTE (elle sait sa largeur), pas une
          media query : il se règle donc sur la largeur de son conteneur. */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="titre-carte-app">{t('paymentAccounts')}</h2>
          <p className="text-sm text-stone-600 mt-1">
            {user?.user_type === 'worker' 
              ? `${t('minimumRequired')}: ${getRequiredMinimum()} ${t('accountsLinked').toLowerCase()} (${t('workerPaymentRequirement').toLowerCase()})`
              : `${t('minimumRequired')}: ${getRequiredMinimum()} ${t('accountRequired')}`
            }
          </p>
        </div>
        
        <div className="flex shrink-0 items-center gap-3">
          {/* Status Badge */}
          <div className={`whitespace-nowrap rounded-[3px] border px-2.5 py-1 text-xs font-semibold ${
            getLinkedAccountsCount() >= getRequiredMinimum()
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-orange-200 bg-orange-50 text-orange-800'
          }`}>
            {getLinkedAccountsCount()}/{getRequiredMinimum()} {t('accountsLinked').toLowerCase()}
          </div>
          
          {!isEditing && (
            // L'action d'entrée du bloc, au vocabulaire de bouton du site :
            // elle ouvre la paire Annuler/Enregistrer ci-dessous, et une
            // pastille `rounded-md` à côté d'elles peindrait deux boutons.
            <button
              onClick={() => setIsEditing(true)}
              className="bouton bouton-encre"
            >
              {t('modify')}
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
        <div className="rounded-[3px] border border-stone-200 p-4">
          <div className="flex items-center mb-3">
            <div className="w-8 h-8 bg-orange-700 rounded-full flex items-center justify-center mr-3">
              <span className="text-white text-sm font-bold">OM</span>
            </div>
            <h3 className="text-lg font-semibold text-stone-900">{t('orangeMoney')}</h3>
          </div>
          
          {isEditing ? (
            <div>
              <label htmlFor="payment_accounts_orange_money" className="sr-only">{t('orangeMoney')}</label>
              <input
                id="payment_accounts_orange_money"
                name="payment_accounts_orange_money"
                autoComplete="tel"
                type="tel"
                value={accounts.orange_money}
                onChange={(e) => setAccounts({...accounts, orange_money: e.target.value})}
                placeholder={`${t('examplePrefix')} ${phoneExample}`}
                className={`${CHAMP}${validationErrors.orange_money ? ' border-red-500' : ''}`}
              />
              {validationErrors.orange_money && (
                <p className="mt-1 text-sm text-red-600">{validationErrors.orange_money}</p>
              )}
              <p className="mt-1 text-sm text-stone-500">
                {supportedOrangeMoneyCountries}
              </p>
            </div>
          ) : (
            <div>
              {accounts.orange_money ? (
                <p className="text-stone-700 font-mono">{accounts.orange_money}</p>
              ) : (
                <p className="text-stone-500 italic">{t('notConfigured')}</p>
              )}
            </div>
          )}
        </div>

        {/* Wave */}
        <div className="rounded-[3px] border border-stone-200 p-4">
          <div className="flex items-center mb-3">
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center mr-3">
              <span className="text-white text-sm font-bold">W</span>
            </div>
            <h3 className="text-lg font-semibold text-stone-900">{t('wave')}</h3>
          </div>
          
          {isEditing && isWaveUnavailable ? (
            <p className="rounded-[3px] border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
              {t('waveUnavailableInYourCountry')}
            </p>
          ) : isEditing ? (
            <div>
              <label htmlFor="payment_accounts_wave" className="sr-only">{t('wave')}</label>
              <input
                id="payment_accounts_wave"
                name="payment_accounts_wave"
                autoComplete="tel"
                type="tel"
                value={accounts.wave}
                onChange={(e) => setAccounts({...accounts, wave: e.target.value})}
                placeholder={`${t('examplePrefix')} ${phoneExample}`}
                className={`${CHAMP}${validationErrors.wave ? ' border-red-500' : ''}`}
              />
              {validationErrors.wave && (
                <p className="mt-1 text-sm text-red-600">{validationErrors.wave}</p>
              )}
              <p className="mt-1 text-sm text-stone-500">
                {t('availableAcrossWestAfrica')}
              </p>
            </div>
          ) : (
            <div>
              {accounts.wave ? (
                <p className="text-stone-700 font-mono">{accounts.wave}</p>
              ) : (
                <p className="text-stone-500 italic">{t('notConfigured')}</p>
              )}
            </div>
          )}
        </div>

        {/* Titulaire du wallet : la pièce qui rend le versement vérifiable */}
        <div className="rounded-[3px] border border-stone-200 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-stone-900">{t('walletHolderTitle')}</h3>
            {!isEditing && walletVerification && (
              <span
                className={`whitespace-nowrap rounded-[3px] border px-2.5 py-1 text-xs font-semibold ${
                  walletVerification.etat === 'verifie'
                    ? 'border-green-200 bg-green-50 text-green-800'
                    : 'border-orange-200 bg-orange-50 text-orange-800'
                }`}
              >
                {walletStateLabel(walletVerification.etat)}
              </span>
            )}
          </div>

          {isEditing ? (
            <div>
              <label
                htmlFor="payment_accounts_holder_name"
                className="block text-sm font-semibold text-stone-800"
              >
                {t('walletHolderLabel')}
              </label>
              <input
                id="payment_accounts_holder_name"
                name="payment_accounts_holder_name"
                autoComplete="name"
                type="text"
                maxLength={80}
                value={accounts.holder_name}
                onChange={(e) => setAccounts({ ...accounts, holder_name: e.target.value })}
                placeholder={t('walletHolderPlaceholder')}
                className={`mt-1 ${CHAMP}`}
              />
              <p className="mt-1 text-sm text-stone-500">{t('walletHolderHelp')}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-stone-700">
                {accounts.holder_name || <span className="italic text-stone-500">{t('notConfigured')}</span>}
              </p>
              {walletVerification && (
                <p className="text-sm text-stone-500">{walletStateLabel(walletVerification.etat)}</p>
              )}
            </div>
          )}
        </div>

        {/* Bank Account */}
        <div className="rounded-[3px] border border-stone-200 p-4">
          <div className="flex items-center mb-3">
            <div className="w-8 h-8 bg-stone-600 rounded-full flex items-center justify-center mr-3">
              <Landmark className="h-4 w-4 text-white" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-stone-900">{t('bankAccount')}</h3>
          </div>
          
          {isEditing ? (
            <div className="space-y-3">
              <div>
                <label htmlFor="payment_accounts_bank_account_number" className="block text-sm font-semibold text-stone-800">
                  {t('accountNumberLabel')} *
                </label>
                <input
                  id="payment_accounts_bank_account_number"
                  name="payment_accounts_bank_account_number"
                  autoComplete="off"
                  type="text"
                  value={accounts.bank_account.account_number}
                  onChange={(e) => setAccounts({
                    ...accounts, 
                    bank_account: {...accounts.bank_account, account_number: e.target.value}
                  })}
                  placeholder="123456789012"
                  className={CHAMP}
                />
              </div>
              
              <div>
                <label htmlFor="payment_accounts_bank_name" className="block text-sm font-semibold text-stone-800">
                  {t('bankNameLabel')} *
                </label>
                <select
                  id="payment_accounts_bank_name"
                  name="payment_accounts_bank_name"
                  autoComplete="organization"
                  value={accounts.bank_account.bank_name}
                  onChange={(e) => setAccounts({
                    ...accounts, 
                    bank_account: {...accounts.bank_account, bank_name: e.target.value}
                  })}
                  className={CHAMP}
                >
                  <option value="">{t('selectBank')}</option>
                  {popularBanks.map((bank, index) => (
                    <option key={index} value={bank}>{bank}</option>
                  ))}
                  <option value="other">{t('otherBank')}</option>
                </select>
              </div>
              
              <div>
                <label htmlFor="payment_accounts_bank_account_holder" className="block text-sm font-semibold text-stone-800">
                  {t('accountHolderLabel')} *
                </label>
                <input
                  id="payment_accounts_bank_account_holder"
                  name="payment_accounts_bank_account_holder"
                  autoComplete="name"
                  type="text"
                  value={accounts.bank_account.account_holder}
                  onChange={(e) => setAccounts({
                    ...accounts, 
                    bank_account: {...accounts.bank_account, account_holder: e.target.value}
                  })}
                  placeholder={t('fullHolderName')}
                  className={CHAMP}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="payment_accounts_bank_code" className="block text-sm font-semibold text-stone-800">
                    {t('bankCodeOptional')}
                  </label>
                  <input
                    id="payment_accounts_bank_code"
                    name="payment_accounts_bank_code"
                    autoComplete="off"
                    type="text"
                    value={accounts.bank_account.bank_code}
                    onChange={(e) => setAccounts({
                      ...accounts, 
                      bank_account: {...accounts.bank_account, bank_code: e.target.value}
                    })}
                    placeholder={t('bankCodeOptional')}
                    className={CHAMP}
                  />
                </div>
                
                <div>
                  <label htmlFor="payment_accounts_bank_branch" className="block text-sm font-semibold text-stone-800">
                    {t('branchOptional')}
                  </label>
                  <input
                    id="payment_accounts_bank_branch"
                    name="payment_accounts_bank_branch"
                    autoComplete="off"
                    type="text"
                    value={accounts.bank_account.branch}
                    onChange={(e) => setAccounts({
                      ...accounts, 
                      bank_account: {...accounts.bank_account, branch: e.target.value}
                    })}
                    placeholder={t('branchLabel')}
                    className={CHAMP}
                  />
                </div>
              </div>
              
              {validationErrors.bank_account && (
                <p className="mt-1 text-sm text-red-600">{validationErrors.bank_account}</p>
              )}
            </div>
          ) : (
            <div>
              {accounts.bank_account?.account_number ? (
                <div className="space-y-2">
                  <p className="text-stone-700">
                    <span className="text-sm text-stone-500">{t('accountLabel')}:</span> {maskAccountNumber(accounts.bank_account.account_number)}
                  </p>
                  <p className="text-stone-700">
                    <span className="text-sm text-stone-500">{t('bankLabel')}:</span> {accounts.bank_account.bank_name}
                  </p>
                  <p className="text-stone-700">
                    <span className="text-sm text-stone-500">{t('holderLabel')}:</span> {accounts.bank_account.account_holder}
                  </p>
                  {accounts.bank_account.branch && (
                    <p className="text-stone-700">
                      <span className="text-sm text-stone-500">{t('branchLabel')}:</span> {accounts.bank_account.branch}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-stone-500 italic">{t('notConfigured')}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="mt-6 flex flex-wrap justify-end gap-3 border-t pt-6">
          <button
            onClick={handleCancel}
            disabled={saving}
            className="bouton bouton-clair disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bouton bouton-encre disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" aria-hidden="true"></div>
                {t('loading')}
              </>
            ) : (
              t('save')
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default PaymentAccountsManager;