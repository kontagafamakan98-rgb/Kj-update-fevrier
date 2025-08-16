import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getCountriesList, getPhonePrefixByCountry, formatPhoneNumber, detectCountryFromPhone } from '../services/geolocationService';
import { useLanguage } from '../contexts/LanguageContext';
import { CountrySelect, getAllCountries } from '../components/CountryDisplay';

export default function Register() {
  const [searchParams] = useSearchParams();
  const initialUserType = searchParams.get('type') || 'client';
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    first_name: '',
    last_name: '',
    phone: '+221 ', // Start with Senegal prefix
    user_type: initialUserType,
    country: 'senegal',
    preferred_language: 'fr'
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { register } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const navigate = useNavigate();

  const countries = getCountriesList();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validation
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

    const userData = {
      ...formData,
      preferred_language: currentLanguage
    };
    delete userData.confirmPassword;

    const result = await register(userData);
    
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.error);
    }
    
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
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-orange-600 rounded-full flex items-center justify-center shadow-lg">
            <span className="text-white text-2xl font-bold">K</span>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Créer un compte
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Rejoignez la communauté Kojo en Afrique de l'Ouest
          </p>
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
                Type d'utilisateur
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
                    <span className="text-sm font-medium text-gray-700">Client</span>
                    <p className="text-xs text-gray-500 mt-1">Je cherche des services</p>
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
                    <span className="text-sm font-medium text-gray-700">Travailleur</span>
                    <p className="text-xs text-gray-500 mt-1">Je propose mes services</p>
                  </div>
                </label>
              </div>
            </div>

            {/* Country Selection */}
            <div>
              <label htmlFor="country" className="block text-sm font-medium text-gray-700 mb-2">
                Pays
              </label>
              <select
                id="country"
                name="country"
                value={formData.country}
                onChange={(e) => updateFormData('country', e.target.value)}
                required
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              >
                {countries.map(country => (
                  <option key={country.code} value={country.name.toLowerCase()}>
                    {country.flag} {country.nameFrench}
                  </option>
                ))}
              </select>
            </div>

            {/* Names */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="first_name" className="block text-sm font-medium text-gray-700 mb-2">
                  Prénom
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
                  placeholder="77 123 45 67"
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

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Création en cours...
                </div>
              ) : (
                'Créer mon compte'
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