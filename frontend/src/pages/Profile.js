import axios from 'axios';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
import CountryDisplay, { CountrySelect } from '../components/CountryDisplay';
import PaymentAccountsManager from '../components/PaymentAccountsManager';
import { usersAPI, reviewAPI, getAuthToken } from '../services/api';
import { makeScopedTranslator } from '../utils/pack2PageI18n';
import { devLog, safeLog } from '../utils/env';
import { buildApiUrl } from '../utils/backendUrl';
import { WorkerTrustBadge, VerifiedBadge } from '../utils/workerTrustLevel';
import { usePageTitle } from '../utils/seo';

const getLanguageLabel = (languageCode, t) => {
  const languageMap = {
    fr: t('french'),
    en: t('english'),
    wo: t('wolof'),
    bm: t('bambara'),
    mos: t('moore')
  };

  return languageMap[languageCode] || languageCode;
};

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [workerProfile, setWorkerProfile] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  const [reviews, setReviews] = useState([]);
  const [referral, setReferral] = useState(null);
  const [filleuls, setFilleuls] = useState([]);
  const [portfolioImages, setPortfolioImages] = useState([]);
  const [portfolioUploading, setPortfolioUploading] = useState(false);

  const { user, loadUser } = useAuth();
  const { t, currentLanguage, getAvailableLanguagesForCountry } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'profile');
  const toast = useToast();
  usePageTitle('Mon profil — Kojo');

  useEffect(() => {
    loadProfile();
  }, []);

  // Avis reçus (reviews) : alimente la section « Mes avis »
  useEffect(() => {
    if (!user?.id) return;
    reviewAPI.getUserReviews(user.id)
      .then((data) => setReviews(Array.isArray(data?.reviews) ? data.reviews : []))
      .catch(() => setReviews([]));
  }, [user?.id]);

  // Parrainage : le code d'invitation est généré à la demande par le backend
  useEffect(() => {
    if (!user?.id) return;
    usersAPI.getReferral()
      .then((data) => setReferral(data))
      .catch(() => setReferral(null));
  }, [user?.id]);

  // Filleuls : comptes créés via mon code de parrainage
  useEffect(() => {
    if (!user?.id) return;
    usersAPI.getReferralFilleuls()
      .then((data) => setFilleuls(Array.isArray(data?.filleuls) ? data.filleuls : []))
      .catch(() => setFilleuls([]));
  }, [user?.id]);

  // Portfolio travailleur : photos de réalisations (preuve sociale)
  useEffect(() => {
    if (user?.user_type !== 'worker') return;
    usersAPI.getPortfolio()
      .then((data) => setPortfolioImages(Array.isArray(data?.portfolio_images) ? data.portfolio_images : []))
      .catch(() => setPortfolioImages([]));
  }, [user?.user_type, user?.id]);

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

      setPhotoRefreshKey((prev) => prev + 1);
      await loadUser();
      requestAnimationFrame(() => setPhotoRefreshKey((prev) => prev + 1));
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
      const response = await fetch(buildApiUrl('/workers/profile'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify(workerData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || t('profileCreateError'));
      }

      setSuccess(t('profileCreated'));
      await loadProfile();
    } catch (createError) {
      safeLog.error('Worker profile creation error:', createError);
      setError(createError.message || t('profileCreateError'));
    }
  };

  const handlePortfolioUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPortfolioUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await usersAPI.addPortfolioImage(formData);
      setPortfolioImages(Array.isArray(data?.portfolio_images) ? data.portfolio_images : []);
      setSuccess(t('portfolioAdded'));
    } catch (uploadError) {
      safeLog.error('Portfolio upload error:', uploadError);
      setError(uploadError?.response?.data?.detail || uploadError?.message || t('portfolioAddError'));
    } finally {
      setPortfolioUploading(false);
      if (event.target) event.target.value = '';
    }
  };

  const handlePortfolioRemove = async (index) => {
    if (!window.confirm(t('portfolioRemoveConfirm'))) return;
    try {
      const data = await usersAPI.removePortfolioImage(index);
      setPortfolioImages(Array.isArray(data?.portfolio_images) ? data.portfolio_images : []);
      setSuccess(t('portfolioRemoved'));
    } catch (removeError) {
      safeLog.error('Portfolio remove error:', removeError);
      setError(removeError?.response?.data?.detail || removeError?.message || t('portfolioRemoveError'));
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
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-white">{user.first_name} {user.last_name}</h1>
                <VerifiedBadge verified={user.is_verified} />
                {user.user_type === 'worker' && <WorkerTrustBadge person={user} />}
              </div>
              <p className="text-orange-100">
                {user.user_type === 'client' ? t('client') : t('worker')} • <CountryDisplay countryCode={user.country} className="inline-flex align-middle" />
              </p>
              <div className="flex items-center mt-2">
                <span className="text-yellow-300">{'★'.repeat(Math.round(user.rating || 0))}{'☆'.repeat(Math.max(0, 5 - Math.round(user.rating || 0)))}</span>
                <span className="text-orange-100 ml-2">{user.rating || 0}/5 ({t('reviewsCount').replace('{count}', user.total_reviews || 0)})</span>
              </div>
            </div>
          </div>
        </div>

        {error && <div className="mx-6 mt-6 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">{error}</div>}
        {success && <div className="mx-6 mt-6 bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md">{success}</div>}

        <div className="px-6 py-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('myReviewsTitle')}</h2>
          {reviews.length === 0 ? (
            <p className="text-sm text-gray-500">{t('noReviewsYet')}</p>
          ) : (
            <div className="space-y-3">
              {reviews.map((review) => (
                <div key={review.id} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-gray-900 truncate">
                      {review.reviewer_name || t('anonymousReviewer')}
                    </span>
                    <span className="text-yellow-400 text-sm">
                      {'★'.repeat(Math.max(0, Math.min(5, review.rating)))}{'☆'.repeat(Math.max(0, 5 - Math.min(5, review.rating)))}
                    </span>
                  </div>
                  {review.comment && (
                    <p className="mt-1 text-sm text-gray-600 whitespace-pre-line">{review.comment}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

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

        {user.user_type === 'worker' && (
          <div className="px-6 py-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">{t('portfolioTitle')}</h2>
            <p className="text-sm text-gray-500 mb-4">{t('portfolioHelp')}</p>
            <PortfolioManager
              images={portfolioImages}
              uploading={portfolioUploading}
              onUpload={handlePortfolioUpload}
              onRemove={handlePortfolioRemove}
              t={t}
            />
          </div>
        )}

        <div className="px-6 py-6 border-b border-gray-200">
          <ReferralCard referral={referral} t={t} />
          <FilleulsCard filleuls={filleuls} t={t} />
        </div>

        <div className="px-6 py-6">
          <PaymentAccountsManager
            onSuccess={() => {
              setSuccess(t('paymentAccountsUpdated'));
            }}
          />
        </div>

        <div className="px-6 pb-6">
          <Link
            to="/support"
            className="flex items-center justify-between rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <span>{t('supportHelp')}</span>
            <span className="text-orange-600">→</span>
          </Link>
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
        <p className="mt-1 text-gray-900">{getLanguageLabel(profile.preferred_language, t)}</p>
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

export function ProfileEditForm({ profile, user, onSave, onCancel, pageT, t }) {
  // getAvailableLanguagesForCountry vient du contexte de langue : il était
  // référencé ici sans être importé ni reçu en prop, ce qui faisait planter
  // le formulaire d'édition du profil (ReferenceError) à chaque clic sur
  // « Modifier » — corrigé en le récupérant directement depuis useLanguage().
  const { getAvailableLanguagesForCountry } = useLanguage();
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
          newData.country = detectedCountry.code;
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
          }}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="first_name" className="block text-sm font-medium text-gray-700">{pageT('firstName')}</label>
          <input type="text" id="first_name" name="first_name" autoComplete="given-name" value={formData.first_name} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
        </div>

        <div>
          <label htmlFor="last_name" className="block text-sm font-medium text-gray-700">{pageT('lastName')}</label>
          <input type="text" id="last_name" name="last_name" autoComplete="family-name" value={formData.last_name} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
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
              autoComplete="tel-national"
              value={formData.phone.replace(getPhonePrefixByCountry(formData.country.toLowerCase()), '').trim()}
              onChange={(e) => {
                const prefix = getPhonePrefixByCountry(formData.country.toLowerCase());
                updateFormData('phone', `${prefix} ${e.target.value.replace(/[^\d\s]/g, '')}`);
              }}
              placeholder={pageT('phonePlaceholder')}
              className="flex-1 block w-full px-3 py-2 border border-gray-300 rounded-r-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
            />
          </div>
          <p className="mt-1 text-sm text-gray-500">{t('phoneFormat')}: {getPhonePrefixByCountry(formData.country.toLowerCase())} XX XXX XX XX</p>
        </div>

        <div>
          <label htmlFor="preferred_language" className="block text-sm font-medium text-gray-700">{t('preferredLanguage')}</label>
          <select id="preferred_language" name="preferred_language" autoComplete="off" value={formData.preferred_language} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500">
            {getAvailableLanguagesForCountry(formData.country).map(lang => (
              <option key={lang} value={lang}>{getLanguageLabel(lang, t)}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="country" className="block text-sm font-medium text-gray-700">{pageT('country')}</label>
          <div className="mt-1">
            <CountrySelect
              id="country"
              name="country"
              autoComplete="country-name"
              value={formData.country}
              onChange={(e) => updateFormData('country', e.target.value)}
            />
          </div>
        </div>
      </div>

      {profile?.user_type === 'worker' && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">{pageT('professionalInfo')}</h3>
          <div>
            <label htmlFor="bio" className="block text-sm font-medium text-gray-700">{pageT('bio')}</label>
            <textarea id="bio" name="bio" autoComplete="off" rows={4} value={formData.bio} onChange={handleChange} placeholder={pageT('bioPlaceholder')} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
            <p className="mt-1 text-sm text-gray-500">{pageT('bioHelp')}</p>
          </div>

          <div>
            <label htmlFor="skills" className="block text-sm font-medium text-gray-700">{pageT('skills')}</label>
            <input id="skills" name="skills" autoComplete="off" value={formData.skills} onChange={handleChange} placeholder={pageT('skillsPlaceholder')} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
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
          <label htmlFor="profile_specialty_input" className="block text-sm font-medium text-gray-700 mb-2">{pageT('specialties')}</label>
          <div className="flex space-x-2">
            <input id="profile_specialty_input" name="profile_specialty_input" type="text" autoComplete="off" value={specialtyInput} onChange={(e) => setSpecialtyInput(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" placeholder={pageT('specialtyPlaceholder')} />
            <button type="button" onClick={addSpecialty} className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md">{pageT('add')}</button>
          </div>
          {formData.specialties.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {formData.specialties.map((specialty, index) => (
                <span key={index} className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm flex items-center">
                  {specialty}
                  <button type="button" aria-label={`${pageT('remove')} ${specialty}`} onClick={() => removeSpecialty(specialty)} className="ml-2 text-orange-600 hover:text-orange-800">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="experience_years" className="block text-sm font-medium text-gray-700">{pageT('yearsExperience')}</label>
          <input type="number" id="experience_years" name="experience_years" autoComplete="off" min="0" required value={formData.experience_years} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">{pageT('descriptionOptional')}</label>
          <textarea id="description" name="description" autoComplete="off" rows={3} value={formData.description} onChange={handleChange} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500" placeholder={pageT('descriptionPlaceholder')} />
        </div>

        <div className="flex items-center">
          <input type="checkbox" id="availability" name="availability" autoComplete="off" checked={formData.availability} onChange={handleChange} className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded" />
          <label htmlFor="availability" className="ml-2 text-sm text-gray-700">{pageT('availableForProjects')}</label>
        </div>

        <button type="submit" className="w-full bg-orange-600 hover:bg-orange-700 text-white py-2 px-4 rounded-md">{pageT('createWorkerProfile')}</button>
      </form>
    </div>
  );
}

function PortfolioManager({ images, uploading, onUpload, onRemove, t }) {
  const inputRef = useRef(null);
  return (
    <div>
      {images.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-4">
          {images.map((url, index) => (
            <div key={`${url}-${index}`} className="relative aspect-square overflow-hidden rounded-xl border border-gray-200 group">
              <img src={url} alt={`${t('portfolioPhotoAlt')} ${index + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label={`${t('portfolioDeleteAria')} ${index + 1}`}
                onClick={() => onRemove(index)}
                className="absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 mb-4">{t('portfolioEmpty')}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onUpload}
      />
      <button
        type="button"
        disabled={uploading || images.length >= 10}
        onClick={() => inputRef.current?.click()}
        className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-50"
      >
        {uploading ? t('portfolioUploading') : (images.length >= 10 ? t('portfolioFull') : t('portfolioAddPhoto'))}
      </button>
    </div>
  );
}

function ReferralCard({ referral, t }) {
  const [copied, setCopied] = useState(false);
  if (!referral?.referral_code) return null;

  // t() ne fait pas d'interpolation — on remplace {amount} à la main.
  const interpolate = (template, vars = {}) => String(template || '').replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(referral.referral_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_error) {
      // Presse-papiers indisponible : l'utilisateur peut copier à la main.
    }
  };

  const balance = Number(referral.reward_balance || 0);
  const history = Array.isArray(referral.reward_history) ? referral.reward_history : [];
  const sponsorReward = Number(referral.sponsor_reward || 500);
  const filleulReward = Number(referral.filleul_reward || 500);
  const welcomeSponsorReward = Number(referral.welcome_sponsor_reward || 250);
  const welcomeFilleulReward = Number(referral.welcome_filleul_reward || 250);

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-2">{t('referralTitle')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('referralText')}</p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <code className="rounded-xl border border-dashed border-orange-300 bg-orange-50 px-4 py-2 font-mono text-lg font-bold tracking-widest text-orange-700">
          {referral.referral_code}
        </code>
        <button
          type="button"
          onClick={copyCode}
          className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
        >
          {copied ? t('referralCopied') : t('referralCopy')}
        </button>
        {referral.invite_url && (
          <a
            href={referral.invite_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            {t('referralInviteLink')}
          </a>
        )}
      </div>

      {/* Récompense de parrainage : solde + historique */}
      <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-green-800">{t('referralRewardTitle')}</p>
          <p className="text-sm font-bold text-green-700">{balance.toLocaleString('fr-FR')} FCFA</p>
        </div>
        <p className="text-xs text-green-700 mt-1">{t('referralRewardBalance')}</p>
        <p className="text-xs text-green-600 mt-2">
          {interpolate(t('referralWelcomeHint'), { welcomeSponsor: welcomeSponsorReward, welcomeFilleul: welcomeFilleulReward })}
        </p>
        <p className="text-xs text-green-600 mt-1">{interpolate(t('referralRewardHint'), { amount: sponsorReward })}</p>
        {history.length > 0 && (
          <div className="mt-3 border-t border-green-200 pt-3">
            <p className="text-xs font-semibold text-green-800 mb-2">{t('referralRewardHistory')}</p>
            <ul className="space-y-1">
              {history.slice(-5).reverse().map((reward, idx) => (
                <li key={idx} className="text-xs text-green-700 flex items-center justify-between">
                  <span className="truncate mr-2">
                    {reward.type === 'welcome'
                      ? (reward.role === 'parrain' ? t('referralWelcomeSponsorLabel') : t('referralWelcomeFilleulLabel'))
                      : (reward.job_title || '—')}
                  </span>
                  <span className="font-semibold whitespace-nowrap">+{Number(reward.amount || 0).toLocaleString('fr-FR')} FCFA</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function FilleulsCard({ filleuls, t }) {
  if (!Array.isArray(filleuls) || filleuls.length === 0) return null;

  const formatDate = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_error) {
      return '';
    }
  };

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center">
        <span className="mr-2">👥</span>
        {t('filleulsTitle')}
        <span className="ml-2 rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-xs font-semibold">
          {filleuls.length}
        </span>
      </h3>
      <ul className="space-y-2">
        {filleuls.map((filleul) => (
          <li
            key={filleul.id}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3"
          >
            <div className="flex items-center min-w-0">
              {filleul.profile_photo ? (
                <img
                  src={filleul.profile_photo}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover mr-3"
                />
              ) : (
                <div className="h-9 w-9 rounded-full bg-orange-100 flex items-center justify-center mr-3 text-orange-600 font-bold">
                  {(filleul.first_name || '?')[0]?.toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {`${filleul.first_name || ''} ${filleul.last_name || ''}`.trim() || t('filleulAnonymous')}
                </p>
                {formatDate(filleul.created_at) && (
                  <p className="text-xs text-gray-500">{formatDate(filleul.created_at)}</p>
                )}
              </div>
            </div>
            <div className="text-right shrink-0 ml-3">
              {filleul.completed_first_job ? (
                <span className="inline-flex items-center text-xs font-semibold text-green-700">
                  ✅ {t('filleulFirstJobDone')}
                </span>
              ) : (
                <span className="inline-flex items-center text-xs text-gray-400">
                  {t('filleulFirstJobPending')}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
