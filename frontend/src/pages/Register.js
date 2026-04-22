import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getCountriesList, getPhonePrefixByCountry, formatPhoneNumber, detectCountryFromPhone, detectUserCountry, getPhoneExampleForCountry } from '../services/preciseGeolocationService';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import WorkerRegistrationFields from '../components/WorkerRegistrationFields';
import ProfilePhotoUpload from '../components/ProfilePhotoUpload';
import RegistrationLanguageSelector from '../components/RegistrationLanguageSelector';
import LoadingButton from '../components/LoadingButton';
import CountryDisplay, { CountrySelect } from '../components/CountryDisplay';
import { makeScopedTranslator, normalizeCountryCode } from '../utils/pack2PageI18n';
import { clearRegistrationFlow, saveRegistrationFlow } from '../utils/registrationFlowStorage';
import { devLog, safeLog } from '../utils/env';
import { authAPI } from '../services/api';

export default function Register() {
  const [searchParams] = useSearchParams();
  const initialUserType = searchParams.get('type') || 'client';
  const { t, currentLanguage } = useLanguage();
  const defaultLanguage = currentLanguage || 'fr';
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    first_name: '',
    last_name: '',
    phone: '', // Défini après détection ou choix manuel
    user_type: initialUserType,
    country: '', // Défini après détection ou choix manuel
    preferred_language: defaultLanguage, // Langue courante par défaut, peut être modifiée
    // Champs spécifiques aux travailleurs
    worker_specialties: [],
    worker_experience_years: null,

  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailChecking, setEmailChecking] = useState(false);
  const [emailAvailability, setEmailAvailability] = useState(null);
  const [geoLoading, setGeoLoading] = useState(true);
  const [detectedCountry, setDetectedCountry] = useState(null);
  const [manualCountrySelection, setManualCountrySelection] = useState(false);
  const manualCountrySelectionRef = useRef(false);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [userSelectedLanguage, setUserSelectedLanguage] = useState(defaultLanguage); // Choix utilisateur pour profil
  
  const { register } = useAuth();
  const pageT = makeScopedTranslator(currentLanguage, t, 'register');
  const toast = useToast();
  const navigate = useNavigate();

  const countries = getCountriesList();

  const isEmailAlreadyUsedMessage = (message = '') => message.toLowerCase().includes('déjà utilisée') || message.toLowerCase().includes('already used');

  const checkEmailAvailability = async (rawEmail, { silent = false } = {}) => {
    const emailToCheck = String(rawEmail || '').trim().toLowerCase();

    if (!emailToCheck) {
      setEmailAvailability(null);
      return true;
    }

    setEmailChecking(true);

    try {
      const result = await authAPI.checkEmailAvailability({
        email: emailToCheck,
        purpose: 'signup'
      });

      setEmailAvailability(result);

      if (!result.available) {
        setError(result.message || 'Cette adresse email est déjà utilisée');
        if (!silent) {
          toast.error(result.message || 'Cette adresse email est déjà utilisée');
        }
        return false;
      }

      return true;
    } catch (apiError) {
      const message = apiError?.response?.data?.detail || apiError?.message || 'Impossible de vérifier cette adresse email';

      if (isEmailAlreadyUsedMessage(message)) {
        setEmailAvailability({ available: false, message });
        setError(message);
        if (!silent) {
          toast.error(message);
        }
        return false;
      }

      safeLog.error('❌ Erreur vérification disponibilité email:', apiError);
      setEmailAvailability(null);
      if (!silent) {
        toast.error(message);
      }
      return false;
    } finally {
      setEmailChecking(false);
    }
  };

  const findCountryData = (value) => countries.find((country) => {
    const normalizedValue = normalizeCountryCode((value || '').toLowerCase());
    const normalizedCode = normalizeCountryCode((country.code || '').toLowerCase());
    const normalizedName = normalizeCountryCode((country.name || '').toLowerCase());
    return normalizedCode === normalizedValue || normalizedName === normalizedValue;
  });

  const getCountryDisplayName = (country) => {
    if (!country) return '';
    const normalizedCode = normalizeCountryCode(country.code || country.name?.toLowerCase());
    const translationKey = normalizedCode === 'cote_divoire' ? 'ivory_coast' : normalizedCode;
    const translated = t(translationKey);

    if (typeof translated === 'string' && translated.trim() && translated !== translationKey) {
      return translated.replace(/^\p{Extended_Pictographic}\s*/u, '').trim();
    }

    return country.nameFrench || country.name || '';
  };

  const stripPhonePrefix = (phoneValue, prefix = '') => {
    const value = String(phoneValue || '');
    if (!value) return '';
    if (prefix && value.startsWith(prefix)) {
      return value.slice(prefix.length).trimStart();
    }
    return value.replace(/^\+\d+\s*/, '').trimStart();
  };

  const activeCountry = findCountryData(formData.country) || detectedCountry;
  const activePhonePrefix = activeCountry?.phonePrefix || '';
  const activePhoneExample = activeCountry ? stripPhonePrefix(getPhoneExampleForCountry(activeCountry), activePhonePrefix) : pageT('phonePlaceholder');

  // Géolocalisation automatique au chargement
  useEffect(() => {
    detectUserLocationAndSetDefaults();
  }, []);


  const detectUserLocationAndSetDefaults = async () => {
    try {
      devLog.info('🌍 Détection automatique du pays de l\'utilisateur...');
      const country = await detectUserCountry();
      
      if (country) {
        if (manualCountrySelectionRef.current) {
          devLog.info('🛑 Sélection manuelle détectée, la géolocalisation ne remplace pas le pays choisi');
          return;
        }

        setDetectedCountry(country);
        devLog.info(`📍 Pays détecté: ${country.nameFrench} ${country.flag}`);
        
        // Mettre à jour automatiquement le pays et le préfixe téléphonique
        setFormData(prev => ({
          ...prev,
          country: country.code,
          phone: country.phonePrefix ? country.phonePrefix + ' ' : prev.phone
        }));
        
        devLog.info(`📱 Préfixe ajusté: ${country.phonePrefix}`);
      }
    } catch (error) {
      safeLog.error('❌ Erreur géolocalisation:', error);
    } finally {
      setGeoLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validation de base
    if (formData.password !== formData.confirmPassword) {
      const errorMsg = t('passwordsDontMatch');
      setError(errorMsg);
      toast.error(errorMsg);
      setLoading(false);
      return;
    }

    if (formData.password.length < 6) {
      const errorMsg = t('passwordTooShort');
      setError(errorMsg);
      toast.error(errorMsg);
      setLoading(false);
      return;
    }

    // Validation spécifique aux travailleurs
    if (formData.user_type === 'worker') {
      if (!formData.worker_specialties || formData.worker_specialties.length === 0) {
        const errorMsg = t('workersMustSelectSkills');
        setError(errorMsg);
        toast.error(errorMsg);
        setLoading(false);
        return;
      }

      if (!formData.worker_experience_years) {
        const errorMsg = t('pleaseIndicateExperience');
        setError(errorMsg);
        toast.error(errorMsg);
        setLoading(false);
        return;
      }

    }

    const emailAvailable = await checkEmailAvailability(formData.email);
    if (!emailAvailable) {
      setLoading(false);
      return;
    }

    // Préparer les données utilisateur
    const userData = {
      ...formData,
      preferred_language: userSelectedLanguage, // Utiliser la langue choisie par l'utilisateur
      // Ajouter la photo si sélectionnée
      profile_photo_base64: profilePhoto?.base64 || null
    };
    delete userData.confirmPassword;

    // Rediriger d'abord vers la vérification email
    devLog.info('📝 Redirection vers la vérification email...');

    toast.success(t('registerStepSuccess') + ' ✅');

    clearRegistrationFlow();
    saveRegistrationFlow({
      userData,
      paymentAccounts: null,
      emailVerificationToken: null,
      currentStep: 'email-verification'
    });

    navigate('/email-verification', {
      state: {
        userData
      }
    });
    
    setLoading(false);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === 'email') {
      setEmailAvailability(null);
      if (error && isEmailAlreadyUsedMessage(error)) {
        setError('');
      }
    }

    updateFormData(name, value);
  };

  const updateFormData = (key, value) => {
    setFormData(prev => {
      const newData = { ...prev, [key]: value };

      if (key === 'country') {
        const countryData = findCountryData(value);
        const phonePrefix = countryData ? countryData.phonePrefix : '';
        const previousPrefix = findCountryData(prev.country)?.phonePrefix || '';
        const localNumber = stripPhonePrefix(newData.phone, previousPrefix);

        if (!localNumber) {
          newData.phone = phonePrefix ? phonePrefix + ' ' : '';
        } else {
          newData.phone = phonePrefix ? phonePrefix + ' ' + localNumber : localNumber;
        }
      }

      return newData;
    });
  };

  const handleCountrySelect = (countryCode) => {
    setManualCountrySelection(true);
    manualCountrySelectionRef.current = true;
    setDetectedCountry(null);
    updateFormData('country', countryCode);
  };

  const handleCountryChange = (event) => {
    handleCountrySelect(event.target.value);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center mb-8">
          <div className="mx-auto h-16 w-16 bg-orange-600 rounded-full flex items-center justify-center shadow-lg">
            <span className="text-white text-2xl font-bold">K</span>
          </div>
          <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
            {pageT('title')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {pageT('subtitle')}
          </p>
          
          {/* Information sur le processus avec géolocalisation */}
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            {geoLoading ? (
              <div className="flex items-center justify-center py-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
                <span className="text-xs text-blue-700">{t('detectingLocation')}</span>
              </div>
            ) : detectedCountry ? (
              <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded text-center">
                <p className="text-sm text-green-800">
                  <span className="font-medium">📍 {pageT('positionDetected')}:</span> <CountryDisplay countryCode={detectedCountry.code} className="inline-flex align-middle" />
                </p>
                <p className="text-xs text-green-600 mt-1">
                  {pageT('adjustedAutomatically')}
                </p>
              </div>
            ) : (
              <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-center">
                <p className="text-xs text-yellow-700">
                  📍 {pageT('positionNotDetected')}
                </p>
              </div>
            )}
            
            <div className="flex items-center justify-center space-x-4 text-sm">
              <div className="flex items-center">
                <div className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-medium">
                  1
                </div>
                <span className="ml-2 text-orange-600 font-medium">{t('personalInformation')}</span>
              </div>

              <div className="w-12 h-1 bg-gray-200"></div>

              <div className="flex items-center">
                <div className="w-6 h-6 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-xs font-medium">
                  2
                </div>
                <span className="ml-2 text-gray-500 font-medium">{pageT('stepEmail')}</span>
              </div>

              <div className="w-12 h-1 bg-gray-200"></div>

              <div className="flex items-center">
                <div className="w-6 h-6 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-xs font-medium">
                  3
                </div>
                <span className="ml-2 text-gray-500 font-medium">{pageT('stepPayments')}</span>
              </div>
            </div>
            
            <p className="text-xs text-blue-700 mt-3">
              {formData.user_type === 'worker' 
                ? `⚠️ ${pageT('workerStepNotice')}`
                : `⚠️ ${pageT('clientStepNotice')}`
              }
            </p>
          </div>
        </div>
        
        <form className="mt-8 space-y-6 bg-white p-8 rounded-xl shadow-md" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}
          
          <div className="space-y-6">
            {/* User Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                {t('userType')}
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label className={`relative flex items-center justify-center p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  formData.user_type === 'client' 
                    ? 'border-orange-500 bg-orange-50' 
                    : 'border-gray-300 hover:border-gray-400'
                }`}>
                  <input
                    type="radio"
                    name="user_type"
                    value="client"
                    checked={formData.user_type === 'client'}
                    onChange={handleChange}
                    className="sr-only"
                  />
                  <div className="text-center">
                    <div className="text-2xl mb-2">👤</div>
                    <span className="text-sm font-medium text-gray-700">{t('client')}</span>
                    <p className="text-xs text-gray-500 mt-1">{t('iAmClient')}</p>
                  </div>
                </label>
                
                <label className={`relative flex items-center justify-center p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  formData.user_type === 'worker' 
                    ? 'border-orange-500 bg-orange-50' 
                    : 'border-gray-300 hover:border-gray-400'
                }`}>
                  <input
                    type="radio"
                    name="user_type"
                    value="worker"
                    checked={formData.user_type === 'worker'}
                    onChange={handleChange}
                    className="sr-only"
                  />
                  <div className="text-center">
                    <div className="text-2xl mb-2">🔧</div>
                    <span className="text-sm font-medium text-gray-700">{t('worker')}</span>
                    <p className="text-xs text-gray-500 mt-1">{t('iAmWorker')}</p>
                  </div>
                </label>
              </div>
            </div>

            {/* Country Selection */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <label htmlFor="country" className="block text-sm font-medium text-gray-700">
                  {t('country')}
                  {detectedCountry && (
                    <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                      📍 {t('detectedAutomatically')}
                    </span>
                  )}
                </label>
                {activeCountry && (
                  <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium whitespace-nowrap ${
                    detectedCountry ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-700'
                  }`}>
                    <CountryDisplay countryCode={activeCountry.code} className="inline-flex align-middle" />
                  </span>
                )}
              </div>
              <CountrySelect
                id="country"
                name="country"
                value={formData.country}
                onChange={handleCountryChange}
                required
                className="mt-1"
              />
              {detectedCountry && (
                <p className="mt-1 text-xs text-green-600">
                  🌍 {t('detectedViaGeolocation')}
                </p>
              )}
            </div>

            {/* Names */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="first_name" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('firstName')}
                </label>
                <input
                  id="first_name"
                  name="first_name"
                  type="text"
                  autoComplete="given-name"
                  required
                  className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder={`${t('firstName')}...`}
                  value={formData.first_name}
                  onChange={handleChange}
                />
              </div>
              
              <div>
                <label htmlFor="last_name" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('lastName')}
                </label>
                <input
                  id="last_name"
                  name="last_name"
                  type="text"
                  autoComplete="family-name"
                  required
                  className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder={`${t('lastName')}...`}
                  value={formData.last_name}
                  onChange={handleChange}
                />
              </div>
            </div>
            
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                {t('email')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder={pageT('emailPlaceholder')}
                value={formData.email}
                onChange={handleChange}
                onBlur={() => {
                  if (formData.email?.trim()) {
                    checkEmailAvailability(formData.email, { silent: true });
                  }
                }}
              />
              {emailChecking && (
                <p className="mt-1 text-sm text-blue-600">Vérification de cette adresse email...</p>
              )}
              {!emailChecking && emailAvailability?.available === false && (
                <p className="mt-1 text-sm text-red-600">{emailAvailability.message || 'Cette adresse email est déjà utilisée'}</p>
              )}
              {!emailChecking && emailAvailability?.available === true && formData.email?.trim() && (
                <p className="mt-1 text-sm text-green-600">Adresse email disponible</p>
              )}
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                {t('phone')}
              </label>
              <div className="flex rounded-lg shadow-sm">
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                  {activePhonePrefix || '—'}
                </span>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  required
                  className="flex-1 block w-full px-4 py-3 border border-gray-300 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder={activePhoneExample}
                  value={stripPhonePrefix(formData.phone, activePhonePrefix)}
                  onChange={(e) => {
                    const currentCountry = activeCountry;
                    const prefix = currentCountry ? currentCountry.phonePrefix : '';
                    const cleanValue = e.target.value.replace(/[^\d\s]/g, '');
                    updateFormData('phone', prefix ? prefix + ' ' + cleanValue : cleanValue);
                  }}
                />
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {pageT('phoneFormatHint')}: {activePhonePrefix || '---'} XX XXX XX XX
              </p>
            </div>
            
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                {t('password')}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder={t('passwordMasked')}
                value={formData.password}
                onChange={handleChange}
              />
              <p className="mt-1 text-xs text-gray-500">{t('atLeast6Characters')}</p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                {t('confirmPassword')}
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder={t('passwordMasked')}
                value={formData.confirmPassword}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Photo de profil pour tous les utilisateurs */}
          <ProfilePhotoUpload 
            photoData={profilePhoto}
            setPhotoData={setProfilePhoto}
            userType={formData.user_type}
          />

          {/* Sélecteur de langue géolocalisé */}
          <RegistrationLanguageSelector
            detectedCountry={detectedCountry}
            selectedLanguage={userSelectedLanguage}
            onLanguageSelect={setUserSelectedLanguage}
            isLoading={geoLoading}
          />

          {/* Champs spécifiques aux travailleurs */}
          {formData.user_type === 'worker' && (
            <WorkerRegistrationFields
              formData={formData}
              setFormData={setFormData}
              errors={{}}
              setErrors={() => {}}
            />
          )}

          <div>
            <LoadingButton
              type="submit"
              loading={loading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {pageT('continueButton')}
            </LoadingButton>
          </div>

          <div className="text-center">
            <span className="text-sm text-gray-600">
              {pageT('signInPrompt')}{' '}
              <Link to="/login" className="font-medium text-orange-600 hover:text-orange-500 transition-colors">
                {t('signIn')}
              </Link>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}