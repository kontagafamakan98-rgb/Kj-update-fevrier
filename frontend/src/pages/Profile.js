import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { getCountriesList, getPhonePrefixByCountry, formatPhoneNumber, detectCountryFromPhone } from '../services/geolocationService';
import ProfilePhoto from '../components/ProfilePhoto';
import SimplePhotoUpload from '../components/SimplePhotoUpload';
import ProfilePhotoUploader from '../components/ProfilePhotoUploader';
import { CountrySelect, getCountry } from '../components/CountryDisplay';
import PaymentAccountsManager from '../components/PaymentAccountsManager';
import { authAPI, usersAPI } from '../services/api';
import { devLog, safeLog } from '../utils/env';

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [workerProfile, setWorkerProfile] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  
  const { user, loadUser, updateUser } = useAuth();
  const { t, changeLanguage } = useLanguage();

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      setProfile(user);
      
      // If user is a worker, try to load worker profile
      if (user.user_type === 'worker') {
        try {
          const workerResponse = await axios.get('/workers/profile');
          setWorkerProfile(workerResponse.data);
        } catch (error) {
          // Worker profile doesn't exist yet
          devLog.info('No worker profile found');
        }
      }
    } catch (error) {
      safeLog.error('Error loading profile:', error);
      setError('Erreur lors du chargement du profil');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileUpdate = async (updatedData) => {
    try {
      setError('');
      
      // Sauvegarder le profil avec les nouvelles données (y compris photo)
      await usersAPI.updateProfile(updatedData);
      
      // Mettre à jour le profil local
      setProfile(prev => ({...prev, ...updatedData}));
      
      // Toujours mettre à jour le contexte global et forcer le refresh
      if (updateUser && user) {
        updateUser({
          ...user,
          ...updatedData
        });
      }
      
      // Forcer le rafraîchissement du ProfilePhoto dans l'header
      setPhotoRefreshKey(prev => prev + 1);
      
      // Recharger les données utilisateur depuis le backend pour être sûr
      await loadUser();
      
      // Forcer un re-render complet après une petite pause
      setTimeout(() => {
        setPhotoRefreshKey(prev => prev + 1);
      }, 500);
      
      // Sortir du mode édition
      setIsEditing(false);
      
      // Message de succès
      setSuccess('Profil mis à jour avec succès');
      setTimeout(() => setSuccess(''), 3000);
      
    } catch (error) {
      safeLog.error('Profile update error:', error);
      setError(error.response?.data?.detail || error.message || 'Erreur lors de la mise à jour');
    }
  };

  const handleWorkerProfileCreate = async (workerData) => {
    try {
      setError('');
      // Note: Need to add workersAPI if this endpoint is used
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/workers/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(workerData)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Erreur lors de la création');
      }
      
      setSuccess('Profil travailleur créé avec succès');
      await loadProfile();
      
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      safeLog.error('Worker profile creation error:', error);
      setError(error.message || 'Erreur lors de la création');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {/* Header */}
        <div className="bg-orange-600 px-6 py-8">
          <div className="flex items-center">
            <ProfilePhoto 
              key={photoRefreshKey}
              user={user}
              size={80}
              editable={false}
              showEditButton={false}
              className="border-2 border-white"
            />
            <div className="ml-6">
              <h1 className="text-2xl font-bold text-white">
                {user.first_name} {user.last_name}
              </h1>
              <p className="text-orange-100">
                {user.user_type === 'client' ? t('client') : t('worker')} • {getCountry(user.country)?.fullName || user.country}
              </p>
              <div className="flex items-center mt-2">
                <span className="text-yellow-300">★★★★☆</span>
                <span className="text-orange-100 ml-2">{user.rating || 0}/5 ({user.total_reviews || 0} avis)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mx-6 mt-6 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
            {error}
          </div>
        )}
        {success && (
          <div className="mx-6 mt-6 bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md">
            {success}
          </div>
        )}

        {/* Basic Profile */}
        <div className="px-6 py-6 border-b border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{t('personalInformation')}</h2>
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="text-orange-600 hover:text-orange-700 font-medium"
            >
              {isEditing ? t('cancel') : t('edit')}
            </button>
          </div>

          {isEditing ? (
            <ProfileEditForm 
              profile={profile}
              user={user}
              onSave={handleProfileUpdate}
              onCancel={() => setIsEditing(false)}
              setProfile={setProfile}
              updateUser={updateUser}
              loadUser={loadUser}
              setPhotoRefreshKey={setPhotoRefreshKey}
              t={t}
            />
          ) : (
            <ProfileView profile={profile} user={user} />
          )}
        </div>

        {/* Worker Profile Section */}
        {user.user_type === 'worker' && (
          <div className="px-6 py-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Profil travailleur</h2>
            
            {workerProfile ? (
              <WorkerProfileView profile={workerProfile} />
            ) : (
              <WorkerProfileCreate onCreate={handleWorkerProfileCreate} />
            )}
          </div>
        )}

        {/* Payment Accounts Section */}
        <div className="px-6 py-6">
          <PaymentAccountsManager 
            onSuccess={() => {
              setSuccess('Comptes de paiement mis à jour avec succès');
              setTimeout(() => setSuccess(''), 3000);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ProfileView({ profile }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
        <label className="block text-sm font-medium text-gray-700">Email</label>
        <p className="mt-1 text-gray-900">{profile.email}</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">{t('phone')}</label>
        <p className="mt-1 text-gray-900">{profile.phone}</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">{t('preferredLanguage')}</label>
        <p className="mt-1 text-gray-900">{profile.preferred_language}</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">{t('verified')}</label>
        <p className="mt-1">
          <span className={`px-2 py-1 text-xs rounded-full ${
            profile.is_verified ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {profile.is_verified ? t('verified') : `${t('no')} ${t('verified').toLowerCase()}`}
          </span>
        </p>
      </div>
    </div>
  );
}

function ProfileEditForm({ profile, user, onSave, onCancel, setProfile, updateUser, loadUser, setPhotoRefreshKey, t }) {
  const [formData, setFormData] = useState({
    first_name: profile.first_name || '',
    last_name: profile.last_name || '',
    phone: profile.phone || '',
    preferred_language: profile.preferred_language || 'fr',
    country: profile.country || 'senegal',
    bio: profile.bio || '',
    skills: profile.skills || ''
  });
  
  const [success, setSuccess] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const updateFormData = (key, value) => {
    setFormData(prev => {
      const newData = { ...prev, [key]: value };
      
      // Auto-update phone prefix when country changes
      if (key === 'country') {
        const phonePrefix = getPhonePrefixByCountry(value.toLowerCase());
        
        // Format existing phone number with new country prefix
        if (newData.phone && !newData.phone.startsWith(phonePrefix)) {
          newData.phone = formatPhoneNumber(newData.phone, value.toLowerCase());
        } else if (!newData.phone) {
          newData.phone = phonePrefix + ' ';
        }
      }
      
      // Auto-detect country when phone number changes
      if (key === 'phone') {
        const detectedCountry = detectCountryFromPhone(value);
        if (detectedCountry && detectedCountry.code !== newData.country.toLowerCase()) {
          newData.country = detectedCountry.name;
        }
      }
      
      return newData;
    });
  };

  const handlePhotoChange = (result) => {
    devLog.info('Profile page received photo change result:', result);
    
    if (result.success) {
      setSuccess('Photo de profil mise à jour avec succès !');
      setTimeout(() => setSuccess(''), 3000);
    } else if (result.deleted) {
      setSuccess('Photo de profil supprimée !');
      setTimeout(() => setSuccess(''), 3000);
    } else if (result.error) {
      safeLog.error('Photo change error:', result.error);
      alert('Erreur: ' + result.error);
    }
  };

  const handleChange = (e) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Message de succès */}
      {success && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative">
          {success}
        </div>
      )}

      {/* Photo de Profil */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Photo de profil</h3>
        <ProfilePhotoUploader
          targetUserId={user?.id}
          onUploadSuccess={(photoUrl, cacheBustedUrl) => {
            // Seulement mettre à jour le formData pour le preview (pas de sauvegarde définitive)
            setFormData(prev => ({...prev, profile_photo: photoUrl}));
            
            // Montrer un message temporaire que la photo est prête
            setSuccess('Photo prête - cliquez "Enregistrer" pour confirmer');
            setTimeout(() => setSuccess(''), 3000);
          }}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="first_name" className="block text-sm font-medium text-gray-700">
            Prénom
          </label>
          <input
            type="text"
            id="first_name"
            name="first_name"
            value={formData.first_name}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
          />
        </div>

        <div>
          <label htmlFor="last_name" className="block text-sm font-medium text-gray-700">
            Nom
          </label>
          <input
            type="text"
            id="last_name"
            name="last_name"
            value={formData.last_name}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
          />
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
            {t('phone')}
          </label>
          <div className="mt-1 flex rounded-md shadow-sm">
            <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
              {getPhonePrefixByCountry(formData.country.toLowerCase())}
            </span>
            <input
              type="tel"
              id="phone"
              name="phone"
              value={formData.phone.replace(getPhonePrefixByCountry(formData.country.toLowerCase()), '').trim()}
              onChange={(e) => {
                const prefix = getPhonePrefixByCountry(formData.country.toLowerCase());
                updateFormData('phone', prefix + ' ' + e.target.value.replace(/[^\d\s]/g, ''));
              }}
              placeholder="77 123 45 67"
              className="flex-1 block w-full px-3 py-2 border border-gray-300 rounded-r-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
            />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Format: {getPhonePrefixByCountry(formData.country.toLowerCase())} XX XXX XX XX
          </p>
        </div>

        <div>
          <label htmlFor="preferred_language" className="block text-sm font-medium text-gray-700">
            {t('preferredLanguage')}
          </label>
          <select
            id="preferred_language"
            name="preferred_language"
            value={formData.preferred_language}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
          >
            <option value="fr">Français</option>
            <option value="wo">Wolof</option>
            <option value="bm">Bambara</option>
          </select>
        </div>

        <div>
          <label htmlFor="country" className="block text-sm font-medium text-gray-700">
            Pays
          </label>
          <select
            id="country"
            name="country"
            value={formData.country}
            onChange={(e) => updateFormData('country', e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
          >
            {getCountriesList().map(country => (
              <option key={country.code} value={country.name}>
                {country.flag} {country.nameFrench}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Champs supplémentaires pour les travailleurs */}
      {profile?.user_type === 'worker' && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Informations professionnelles</h3>
          
          <div>
            <label htmlFor="bio" className="block text-sm font-medium text-gray-700">
              Biographie professionnelle
            </label>
            <textarea
              id="bio"
              name="bio"
              rows={4}
              value={formData.bio}
              onChange={handleChange}
              placeholder="Décrivez votre expérience, vos qualifications et ce qui vous distingue..."
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              Une bonne biographie attire plus de clients
            </p>
          </div>

          <div>
            <label htmlFor="skills" className="block text-sm font-medium text-gray-700">
              Compétences
            </label>
            <input
              type="text"
              id="skills"
              name="skills"
              value={formData.skills}
              onChange={handleChange}
              placeholder="Ex: Plomberie, Électricité, Peinture, Menuiserie..."
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              Séparez les compétences par des virgules
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end space-x-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-md"
        >
          Enregistrer
        </button>
      </div>
    </form>
  );
}

function WorkerProfileView({ profile }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700">Spécialités</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {profile.specialties.map((specialty, index) => (
              <span key={index} className="bg-orange-100 text-orange-800 px-2 py-1 rounded-full text-sm">
                {specialty}
              </span>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Années d'expérience</label>
          <p className="mt-1 text-gray-900">{profile.experience_years} ans</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Disponibilité</label>
          <p className="mt-1">
            <span className={`px-2 py-1 text-xs rounded-full ${
              profile.availability ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {profile.availability ? 'Disponible' : 'Non disponible'}
            </span>
          </p>
        </div>
      </div>
      
      {profile.description && (
        <div>
          <label className="block text-sm font-medium text-gray-700">Description</label>
          <p className="mt-1 text-gray-900">{profile.description}</p>
        </div>
      )}
    </div>
  );
}

function WorkerProfileCreate({ onCreate }) {
  const [formData, setFormData] = useState({
    specialties: [],
    experience_years: '',

    description: '',
    availability: true
  });
  const [specialtyInput, setSpecialtyInput] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreate({
      ...formData,
      experience_years: parseInt(formData.experience_years),

    });
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const addSpecialty = () => {
    if (specialtyInput.trim() && !formData.specialties.includes(specialtyInput.trim())) {
      setFormData(prev => ({
        ...prev,
        specialties: [...prev.specialties, specialtyInput.trim()]
      }));
      setSpecialtyInput('');
    }
  };

  const removeSpecialty = (specialty) => {
    setFormData(prev => ({
      ...prev,
      specialties: prev.specialties.filter(s => s !== specialty)
    }));
  };

  return (
    <div className="bg-gray-50 p-6 rounded-lg">
      <p className="text-gray-600 mb-4">
        Créez votre profil travailleur pour recevoir des propositions d'emploi.
      </p>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Spécialités
          </label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={specialtyInput}
              onChange={(e) => setSpecialtyInput(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500"
              placeholder="Ex: Plomberie, Électricité..."
            />
            <button
              type="button"
              onClick={addSpecialty}
              className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md"
            >
              Ajouter
            </button>
          </div>
          {formData.specialties.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {formData.specialties.map((specialty, index) => (
                <span
                  key={index}
                  className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm flex items-center"
                >
                  {specialty}
                  <button
                    type="button"
                    onClick={() => removeSpecialty(specialty)}
                    className="ml-2 text-orange-600 hover:text-orange-800"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="experience_years" className="block text-sm font-medium text-gray-700">
              Années d'expérience
            </label>
            <input
              type="number"
              id="experience_years"
              name="experience_years"
              min="0"
              required
              value={formData.experience_years}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
            />
          </div>

        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">
            Description (optionnelle)
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            value={formData.description}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
            placeholder="Parlez de vos compétences et expérience..."
          />
        </div>

        <div className="flex items-center">
          <input
            type="checkbox"
            id="availability"
            name="availability"
            checked={formData.availability}
            onChange={handleChange}
            className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
          />
          <label htmlFor="availability" className="ml-2 text-sm text-gray-700">
            Je suis disponible pour de nouveaux projets
          </label>
        </div>

        <button
          type="submit"
          className="w-full bg-orange-600 hover:bg-orange-700 text-white py-2 px-4 rounded-md"
        >
          Créer le profil travailleur
        </button>
      </form>
    </div>
  );
}