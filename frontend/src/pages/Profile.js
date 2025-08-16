import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { CountrySelect, getCountry } from '../components/CountryDisplay';

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [workerProfile, setWorkerProfile] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const { user, loadUser } = useAuth();
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
          console.log('No worker profile found');
        }
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      setError('Erreur lors du chargement du profil');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileUpdate = async (updatedData) => {
    try {
      setError('');
      await axios.put('/users/profile', updatedData);
      setSuccess('Profil mis à jour avec succès');
      await loadUser(); // Refresh user data
      setIsEditing(false);
      
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError(error.response?.data?.detail || 'Erreur lors de la mise à jour');
    }
  };

  const handleWorkerProfileCreate = async (workerData) => {
    try {
      setError('');
      await axios.post('/workers/profile', workerData);
      setSuccess('Profil travailleur créé avec succès');
      await loadProfile();
      
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError(error.response?.data?.detail || 'Erreur lors de la création');
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
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center">
              <span className="text-2xl font-bold text-orange-600">
                {user.first_name?.charAt(0)}{user.last_name?.charAt(0)}
              </span>
            </div>
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
            <h2 className="text-lg font-semibold text-gray-900">Informations personnelles</h2>
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="text-orange-600 hover:text-orange-700 font-medium"
            >
              {isEditing ? 'Annuler' : 'Modifier'}
            </button>
          </div>

          {isEditing ? (
            <ProfileEditForm 
              profile={profile} 
              onSave={handleProfileUpdate}
              onCancel={() => setIsEditing(false)}
            />
          ) : (
            <ProfileView profile={profile} />
          )}
        </div>

        {/* Worker Profile Section */}
        {user.user_type === 'worker' && (
          <div className="px-6 py-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Profil travailleur</h2>
            
            {workerProfile ? (
              <WorkerProfileView profile={workerProfile} />
            ) : (
              <WorkerProfileCreate onCreate={handleWorkerProfileCreate} />
            )}
          </div>
        )}
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
        <label className="block text-sm font-medium text-gray-700">Téléphone</label>
        <p className="mt-1 text-gray-900">{profile.phone}</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Langue préférée</label>
        <p className="mt-1 text-gray-900">{profile.preferred_language}</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Vérifié</label>
        <p className="mt-1">
          <span className={`px-2 py-1 text-xs rounded-full ${
            profile.is_verified ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {profile.is_verified ? 'Vérifié' : 'Non vérifié'}
          </span>
        </p>
      </div>
    </div>
  );
}

function ProfileEditForm({ profile, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    first_name: profile.first_name || '',
    last_name: profile.last_name || '',
    phone: profile.phone || '',
    preferred_language: profile.preferred_language || 'fr',
    country: profile.country || 'senegal'
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const handleChange = (e) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
            Téléphone
          </label>
          <input
            type="tel"
            id="phone"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
          />
        </div>

        <div>
          <label htmlFor="preferred_language" className="block text-sm font-medium text-gray-700">
            Langue préférée
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
          <CountrySelect
            id="country"
            name="country"
            value={formData.country}
            onChange={handleChange}
            className="mt-1"
          />
        </div>
      </div>

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
          <label className="block text-sm font-medium text-gray-700">Tarif horaire</label>
          <p className="mt-1 text-gray-900">{profile.hourly_rate} FCFA/heure</p>
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
    hourly_rate: '',
    description: '',
    availability: true
  });
  const [specialtyInput, setSpecialtyInput] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreate({
      ...formData,
      experience_years: parseInt(formData.experience_years),
      hourly_rate: parseFloat(formData.hourly_rate)
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

          <div>
            <label htmlFor="hourly_rate" className="block text-sm font-medium text-gray-700">
              Tarif horaire (FCFA)
            </label>
            <input
              type="number"
              id="hourly_rate"
              name="hourly_rate"
              min="0"
              required
              value={formData.hourly_rate}
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