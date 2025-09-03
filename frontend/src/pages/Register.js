import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getCountriesList, getPhonePrefixByCountry, formatPhoneNumber, detectCountryFromPhone, detectUserCountry, getPhoneExampleForCountry } from '../services/geolocationService';
import { useLanguage } from '../contexts/LanguageContext';
import { CountrySelect, getAllCountries } from '../components/CountryDisplay';
import WorkerRegistrationFields from '../components/WorkerRegistrationFields';
import ProfilePhotoUpload from '../components/ProfilePhotoUpload';
import RegistrationLanguageSelector from '../components/RegistrationLanguageSelector';

export default function Register() {
  const [searchParams] = useSearchParams();
  const initialUserType = searchParams.get('type') || 'client';
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    first_name: '',
    last_name: '',
    phone: '+221 ', // Sera mis à jour par la géolocalisation
    user_type: initialUserType,
    country: 'senegal', // Sera mis à jour par la géolocalisation
    preferred_language: 'fr', // Français par défaut, mais sera mis à jour par le choix utilisateur
    // Champs spécifiques aux travailleurs
    worker_specialties: [],
    worker_experience_years: null,
    worker_hourly_rate: null
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [geoLoading, setGeoLoading] = useState(true);
  const [detectedCountry, setDetectedCountry] = useState(null);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [userSelectedLanguage, setUserSelectedLanguage] = useState('fr'); // Choix utilisateur pour profil
  
  const { register } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const navigate = useNavigate();

  const countries = getCountriesList();

  // Géolocalisation automatique au chargement
  useEffect(() => {
    detectUserLocationAndSetDefaults();
  }, []);

  const detectUserLocationAndSetDefaults = async () => {
    try {
      console.log('🌍 Détection automatique du pays de l\'utilisateur...');
      const country = await detectUserCountry();
      
      if (country) {
        setDetectedCountry(country);
        console.log(`📍 Pays détecté: ${country.nameFrench} ${country.flag}`);
        
        // Mettre à jour automatiquement le pays et le préfixe téléphonique
        setFormData(prev => ({
          ...prev,
          country: country.code,
          phone: country.phonePrefix + ' '
        }));
        
        console.log(`📱 Préfixe ajusté: ${country.phonePrefix}`);
      }
    } catch (error) {
      console.error('❌ Erreur géolocalisation:', error);
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
      setError('Les mots de passe ne correspondent pas');
      setLoading(false);
      return;
    }

    if (formData.password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères');
      setLoading(false);
      return;
    }

    // Validation spécifique aux travailleurs
    if (formData.user_type === 'worker') {
      if (!formData.worker_specialties || formData.worker_specialties.length === 0) {
        setError('Les travailleurs doivent sélectionner au moins une compétence');
        setLoading(false);
        return;
      }

      if (!formData.worker_experience_years) {
        setError('Veuillez indiquer vos années d\'expérience');
        setLoading(false);
        return;
      }

      if (!formData.worker_hourly_rate || formData.worker_hourly_rate < 500) {
        setError('Veuillez indiquer un tarif horaire valide (minimum 500 FCFA)');
        setLoading(false);
        return;
      }
    }

    // Préparer les données utilisateur
    const userData = {
      ...formData,
      preferred_language: userSelectedLanguage, // Utiliser la langue choisie par l'utilisateur
      // Ajouter la photo si sélectionnée
      profile_photo_base64: profilePhoto?.base64 || null
    };
    delete userData.confirmPassword;

    // Rediriger vers la vérification des comptes de paiement
    console.log('📝 Redirection vers vérification des comptes de paiement...');
    
    // Passer les données à la page de vérification
    navigate('/payment-verification', {
      state: {
        userData: userData
      }
    });
    
    setLoading(false);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    updateFormData(name, value);
  };

  const updateFormData = (key, value) => {
    setFormData(prev => {
      const newData = { ...prev, [key]: value };
      
      // Auto-update phone prefix when country changes
      if (key === 'country') {
        const countryData = countries.find(c => c.name.toLowerCase() === value.toLowerCase());
        const phonePrefix = countryData ? countryData.phonePrefix : '+221';
        
        // If phone field is empty or only has old prefix, set new prefix
        if (!newData.phone || newData.phone.match(/^\+\d{3}\s*$/)) {
          newData.phone = phonePrefix + ' ';
        } else {
          // Format existing phone number with new country prefix
          const cleanPhone = newData.phone.replace(/^\+\d{3}\s*/, '');
          newData.phone = phonePrefix + ' ' + cleanPhone;
        }
      }
      
      // Auto-detect country when phone number changes
      if (key === 'phone') {
        const detectedCountry = detectCountryFromPhone(value);
        if (detectedCountry && detectedCountry.name.toLowerCase() !== newData.country.toLowerCase()) {
          newData.country = detectedCountry.name.toLowerCase();
        }
      }
      
      return newData;
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center mb-8">
          <div className="mx-auto h-16 w-16 bg-orange-600 rounded-full flex items-center justify-center shadow-lg">
            <span className="text-white text-2xl font-bold">K</span>
          </div>
          <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
            {t('createAccount') || 'Créer un compte'}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {t('joinKojoCommunity') || 'Rejoignez la communauté Kojo'}
          </p>
          
          {/* Information sur le processus avec géolocalisation */}
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            {geoLoading ? (
              <div className="flex items-center justify-center py-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
                <span className="text-xs text-blue-700">Détection de votre position...</span>
              </div>
            ) : detectedCountry ? (
              <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded text-center">
                <p className="text-sm text-green-800">
                  <span className="font-medium">📍 Position détectée:</span> {detectedCountry.flag} {detectedCountry.nameFrench}
                </p>
                <p className="text-xs text-green-600 mt-1">
                  Exemples et informations ajustés automatiquement
                </p>
              </div>
            ) : (
              <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-center">
                <p className="text-xs text-yellow-700">
                  📍 Position non détectée - Utilisation des paramètres par défaut (Sénégal)
                </p>
              </div>
            )}
            
            <div className="flex items-center justify-center space-x-4 text-sm">
              <div className="flex items-center">
                <div className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-medium">
                  1
                </div>
                <span className="ml-2 text-orange-600 font-medium">Informations personnelles</span>
              </div>
              
              <div className="w-12 h-1 bg-gray-200"></div>
              
              <div className="flex items-center">
                <div className="w-6 h-6 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-xs font-medium">
                  2
                </div>
                <span className="ml-2 text-gray-500 font-medium">Comptes de paiement</span>
              </div>
            </div>
            
            <p className="text-xs text-blue-700 mt-3">
              {formData.user_type === 'worker' 
                ? '⚠️ Prochaine étape : Vous devrez lier au minimum 2 moyens de paiement (Orange Money, Wave, Compte bancaire)'
                : '⚠️ Prochaine étape : Vous devrez lier au moins 1 moyen de paiement (Orange Money, Wave, Compte bancaire)'
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
              <label htmlFor="country" className="block text-sm font-medium text-gray-700 mb-2">
                {t('country')}
                {detectedCountry && (
                  <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    📍 {t('detectedAutomatically')}
                  </span>
                )}
              </label>
              <select
                id="country"
                name="country"
                value={formData.country}
                onChange={(e) => updateFormData('country', e.target.value)}
                required
                className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent ${
                  detectedCountry ? 'border-green-300 bg-green-50' : 'border-gray-300'
                }`}
              >
                {countries.map(country => (
                  <option key={country.code} value={country.name.toLowerCase()}>
                    {country.flag} {country.nameFrench}
                  </option>
                ))}
              </select>
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
                  required
                  className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder="Votre prénom"
                  value={formData.first_name}
                  onChange={handleChange}
                />
              </div>
              
              <div>
                <label htmlFor="last_name" className="block text-sm font-medium text-gray-700 mb-2">
                  Nom
                </label>
                <input
                  id="last_name"
                  name="last_name"
                  type="text"
                  required
                  className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder="Votre nom"
                  value={formData.last_name}
                  onChange={handleChange}
                />
              </div>
            </div>
            
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                E-mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="exemple@email.com"
                value={formData.email}
                onChange={handleChange}
              />
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                Téléphone
              </label>
              <div className="flex rounded-lg shadow-sm">
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                  {countries.find(c => c.name.toLowerCase() === formData.country.toLowerCase())?.phonePrefix || '+221'}
                </span>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  required
                  className="flex-1 block w-full px-4 py-3 border border-gray-300 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder={detectedCountry ? 
                    getPhoneExampleForCountry(detectedCountry).replace(/^\+\d{3}\s*/, '') : 
                    "77 123 45 67"
                  }
                  value={formData.phone.replace(/^\+\d{3}\s*/, '')}
                  onChange={(e) => {
                    const currentCountry = countries.find(c => c.name.toLowerCase() === formData.country.toLowerCase());
                    const prefix = currentCountry ? currentCountry.phonePrefix : '+221';
                    const cleanValue = e.target.value.replace(/[^\d\s]/g, '');
                    updateFormData('phone', prefix + ' ' + cleanValue);
                  }}
                />
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Format: {countries.find(c => c.name.toLowerCase() === formData.country.toLowerCase())?.phonePrefix || '+221'} XX XXX XX XX
              </p>
            </div>
            
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Mot de passe
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="••••••••"
                value={formData.password}
                onChange={handleChange}
              />
              <p className="mt-1 text-xs text-gray-500">Au moins 6 caractères</p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                Confirmer le mot de passe
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="••••••••"
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
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Préparation...
                </div>
              ) : (
                'Continuer → Vérification des comptes'
              )}
            </button>
          </div>

          <div className="text-center">
            <span className="text-sm text-gray-600">
              Déjà un compte?{' '}
              <Link to="/login" className="font-medium text-orange-600 hover:text-orange-500 transition-colors">
                Se connecter
              </Link>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}