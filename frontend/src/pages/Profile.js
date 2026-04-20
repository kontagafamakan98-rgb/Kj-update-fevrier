import axios from 'axios';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import {
  detectCountryFromPhone,
  formatPhoneNumber,
  getCountriesList,
  getPhonePrefixByCountry
} from '../services/geolocationService';
import ProfilePhoto from '../components/ProfilePhoto';
import ProfilePhotoUploader from '../components/ProfilePhotoUploader';
import { getCountry } from '../components/CountryDisplay';
import PaymentAccountsManager from '../components/PaymentAccountsManager';
import { usersAPI } from '../services/api';
import { makeScopedTranslator } from '../utils/pack2PageI18n';
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
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'profile');
  const toast = useToast();

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      setProfile(user);

      if (user?.user_type === 'worker') {
        try {
          const workerResponse = await axios.get('/workers/profile');
          setWorkerProfile(workerResponse.data);
        } catch {
          devLog.info('No worker profile found');
        }
      }
    } catch (loadError) {
      safeLog.error('Error loading profile:', loadError);
      setError(t('profileLoadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleProfileUpdate = async (updatedData) => {
    try {
      setError('');
      await usersAPI.updateProfile(updatedData);
      setProfile((prev) => ({ ...prev, ...updatedData }));

      if (updateUser && user) {
        updateUser({ ...user, ...updatedData });
      }

      setPhotoRefreshKey((prev) => prev + 1);
      await loadUser();
      setTimeout(() => setPhotoRefreshKey((prev) => prev + 1), 500);
      setIsEditing(false);
      toast.success(`${t('profileUpdated')} ✅`);
    } catch (updateError) {
      safeLog.error('Profile update error:', updateError);
      const errorMsg = updateError.response?.data?.detail || updateError.message || t('error');
      setError(errorMsg);
      toast.error(errorMsg);
    }
  };

  const handleWorkerProfileCreate = async (workerData) => {
    try {
      setError('');
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/workers/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(workerData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || t('profileCreateError'));
      }

      setSuccess(t('profileCreated'));
      await loadProfile();
      setTimeout(() => setSuccess(''), 3000);
    } catch (createError) {
      safeLog.error('Worker profile creation error:', createError);
      setError(createError.message || t('profileCreateError'));
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
              <h1 className="text-2xl font-bold text-white">{user.first_name} {user.last_name}</h1>
              <p className="text-orange-100">
                {user.user_type === 'client' ? t('client') : t('worker')} • {getCountry(user.country)?.fullName || user.country}
              </p>
              <div className="flex items-center mt-2">
                <span className="text-yellow-300">★★★★☆</span>
                <span className="text-orange-100 ml-2">{user.rating || 0}/5 ({user.total_reviews || 0})</span>
              </div>
            </div>
          </div>
        </div>

        {error && <div className="mx-6 mt-6 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">{error}</div>}
        {success && <div className="mx-6 mt-6 bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md">{success}</div>}

        <div className="px-6 py-6 border-b border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{t('personalInformation')}</h2>
            <button onClick={() => setIsEditing(!isEditing)} className="text-orange-600 hover:text-orange-700 font-medium">
              {isEditing ? t('cancel') : t('edit')}
            </button>
          </div>

          {isEditing ? (
            <ProfileEditForm
              profile={profile}
              user={user}
              onSave={handleProfileUpdate}
              onCancel={() => setIsEditing(false)}
              pageT={pageT}
              t={t}
            />
          ) : (
            <ProfileView profile={profile} t={t} />
          )}
        </div>

        {user.user_type === 'worker' && (
          <div className="px-6 py-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{pageT('workerProfileSection')}</h2>
            {workerProfile ? (
              <WorkerProfileView profile={workerProfile} pageT={pageT} t={t} />
            ) : (
              <WorkerProfileCreate onCreate={handleWorkerProfileCreate} pageT={pageT} />
            )}
          </div>
        )}

        <div className="px-6 py-6">
          <PaymentAccountsManager
            onSuccess={() => {
              setSuccess(t('paymentAccountsUpdated'));
              setTimeout(() => setSuccess(''), 3000);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ProfileView({ profile, t }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <label className="block text-sm font-medium text-gray-700">{t('email')}</label>
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
          <span className={`px-2 py-1 text-xs rounded-full ${profile.is_verified ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {profile.is_verified ? t('verified') : `${t('no')} ${t('verified').toLowerCase()}`}
          </span>
        </p>
      </div>
    </div>
  );
}

function ProfileEditForm({ profile, user, onSave, onCancel, pageT, t }) {
  const [formData, setFormData] = useState({
    first_name: profile.first_name || '',
    last_name: profile.last_name || '',
    phone: profile.phone || '',
    preferred_language: profile.preferred_language || 'fr',
    country: profile.country || 'senegal',
    bio: profile.bio || '',
    skills: profile.skills || '',
    profile_photo: profile.profile_photo || ''
  });
  const [success, setSuccess] = useState('');

  const updateFormData = (key, value) => {
    setFormData((prev) => {
      const newData = { ...prev, [key]: value };

      if (key === 'country') {
        const phonePrefix = getPhonePrefixByCountry(value.toLowerCase());
        if (newData.phone && !newData.phone.startsWith(phonePrefix)) {
          newData.phone = formatPhoneNumber(newData.phone, value.toLowerCase());
        } else if (!newData.phone) {
          newData.phone = `${phonePrefix} `;
        }
      }

      if (key === 'phone') {
        const detectedCountry = detectCountryFromPhone(value);
        if (detectedCountry && detectedCountry.code !== newData.country.toLowerCase()) {
          newData.country = detectedCountry.name;
        }
      }

      return newData;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {success && <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative">{success}</div>}

      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{pageT('photoTitle')}</h3>
        <ProfilePhotoUploader
          targetUserId={user?.id}
          onUploadSuccess={(photoUrl) => {
            setFormData((prev) => ({ ...prev, profile_photo: photoUrl }));
            setSuccess(t('photoReadySave'));
            setTimeout(() => setSuccess(''), 3000);
          }}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="first_name" className="block text-sm font-medium text-gray-700">{pageT('firstName')}</label>
          <input type="text" id="first_name" name="first_name" value={formData.first_name} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
        </div>

        <div>
          <label htmlFor="last_name" className="block text-sm font-medium text-gray-700">{pageT('lastName')}</label>
          <input type="text" id="last_name" name="last_name" value={formData.last_name} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700">{t('phone')}</label>
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
                updateFormData('phone', `${prefix} ${e.target.value.replace(/[^\d\s]/g, '')}`);
              }}
              placeholder={pageT('description').includes('') ? '77 123 45 67' : '77 123 45 67'}
              className="flex-1 block w-full px-3 py-2 border border-gray-300 rounded-r-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
            />
          </div>
          <p className="mt-1 text-sm text-gray-500">{t('phoneFormat')}: {getPhonePrefixByCountry(formData.country.toLowerCase())} XX XXX XX XX</p>
        </div>

        <div>
          <label htmlFor="preferred_language" className="block text-sm font-medium text-gray-700">{t('selectLanguageLabel')}</label>
          <select id="preferred_language" name="preferred_language" value={formData.preferred_language} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500">
            <option value="fr">{t('french')}</option>
            <option value="en">{t('english')}</option>
            <option value="wo">{t('wolof')}</option>
            <option value="bm">{t('bambara')}</option>
            <option value="mos">{t('moore')}</option>
          </select>
        </div>

        <div>
          <label htmlFor="country" className="block text-sm font-medium text-gray-700">{pageT('country')}</label>
          <select id="country" name="country" value={formData.country} onChange={(e) => updateFormData('country', e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500">
            {getCountriesList().map((country) => (
              <option key={country.code} value={country.name}>{t(country.code)}</option>
            ))}
          </select>
        </div>
      </div>

      {profile?.user_type === 'worker' && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">{pageT('professionalInfo')}</h3>
          <div>
            <label htmlFor="bio" className="block text-sm font-medium text-gray-700">{pageT('bio')}</label>
            <textarea id="bio" name="bio" rows={4} value={formData.bio} onChange={handleChange} placeholder={pageT('bioPlaceholder')} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
            <p className="mt-1 text-sm text-gray-500">{pageT('bioHelp')}</p>
          </div>

          <div>
            <label htmlFor="skills" className="block text-sm font-medium text-gray-700">{pageT('skills')}</label>
            <input id="skills" name="skills" value={formData.skills} onChange={handleChange} placeholder={pageT('skillsPlaceholder')} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
            <p className="mt-1 text-sm text-gray-500">{pageT('skillsHelp')}</p>
          </div>
        </div>
      )}

      <div className="flex justify-end space-x-4">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">{pageT('cancel')}</button>
        <button type="submit" className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-md">{pageT('save')}</button>
      </div>
    </form>
  );
}

function WorkerProfileView({ profile, pageT, t }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700">{pageT('specialties')}</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {profile.specialties?.map((specialty, index) => (
              <span key={index} className="bg-orange-100 text-orange-800 px-2 py-1 rounded-full text-sm">{specialty}</span>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">{pageT('yearsExperience')}</label>
          <p className="mt-1 text-gray-900">{pageT('years', { count: profile.experience_years })}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">{pageT('availability')}</label>
          <p className="mt-1">
            <span className={`px-2 py-1 text-xs rounded-full ${profile.availability ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {profile.availability ? t('availableStatus') : t('unavailableStatus')}
            </span>
          </p>
        </div>
      </div>

      {profile.description && (
        <div>
          <label className="block text-sm font-medium text-gray-700">{pageT('description')}</label>
          <p className="mt-1 text-gray-900">{profile.description}</p>
        </div>
      )}
    </div>
  );
}

function WorkerProfileCreate({ onCreate, pageT }) {
  const [formData, setFormData] = useState({
    specialties: [],
    experience_years: '',
    description: '',
    availability: true
  });
  const [specialtyInput, setSpecialtyInput] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreate({ ...formData, experience_years: parseInt(formData.experience_years, 10) });
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const addSpecialty = () => {
    if (specialtyInput.trim() && !formData.specialties.includes(specialtyInput.trim())) {
      setFormData((prev) => ({ ...prev, specialties: [...prev.specialties, specialtyInput.trim()] }));
      setSpecialtyInput('');
    }
  };

  const removeSpecialty = (specialty) => {
    setFormData((prev) => ({ ...prev, specialties: prev.specialties.filter((item) => item !== specialty) }));
  };

  return (
    <div className="bg-gray-50 p-6 rounded-lg">
      <p className="text-gray-600 mb-4">{pageT('createWorkerProfileHelp')}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{pageT('specialties')}</label>
          <div className="flex space-x-2">
            <input type="text" value={specialtyInput} onChange={(e) => setSpecialtyInput(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" placeholder={pageT('specialtyPlaceholder')} />
            <button type="button" onClick={addSpecialty} className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md">{pageT('add')}</button>
          </div>
          {formData.specialties.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {formData.specialties.map((specialty, index) => (
                <span key={index} className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm flex items-center">
                  {specialty}
                  <button type="button" onClick={() => removeSpecialty(specialty)} className="ml-2 text-orange-600 hover:text-orange-800">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="experience_years" className="block text-sm font-medium text-gray-700">{pageT('yearsExperience')}</label>
          <input type="number" id="experience_years" name="experience_years" min="0" required value={formData.experience_years} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">{pageT('descriptionOptional')}</label>
          <textarea id="description" name="description" rows={3} value={formData.description} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500" placeholder={pageT('descriptionPlaceholder')} />
        </div>

        <div className="flex items-center">
          <input type="checkbox" id="availability" name="availability" checked={formData.availability} onChange={handleChange} className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded" />
          <label htmlFor="availability" className="ml-2 text-sm text-gray-700">{pageT('availableForProjects')}</label>
        </div>

        <button type="submit" className="w-full bg-orange-600 hover:bg-orange-700 text-white py-2 px-4 rounded-md">{pageT('createWorkerProfile')}</button>
      </form>
    </div>
  );
}
