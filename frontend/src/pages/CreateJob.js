import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import TagInput from '../components/TagInput';
import { jobsAPI } from '../services/apiEndpoints';
import { buildJobCreatePayload, normalizeApiErrorMessage } from '../utils/jobCreateBridge';
import { getJobUiLabel } from '../utils/jobUiLocale';
import {
  emptyJobLocation,
  mergeManualAddress,
  detectCurrentJobLocation,
  buildMapEmbedUrl,
  buildLocationLabel,
  hasCoordinates,
} from '../utils/jobLocationRuntime';

export default function CreateJob() {
  const navigate = useNavigate();
  const { currentLanguage, t } = useLanguage();
  const ui = getJobUiLabel(currentLanguage);
  const manualLocationEditedRef = useRef(false);
  const [autoLocationTried, setAutoLocationTried] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'general',
    location: emptyJobLocation(),
    budget_min: '',
    budget_max: '',
    required_skills: [],
    estimated_duration: '',
    deadline: '',
    urgency: 'normal',
    mechanic_must_bring_parts: false,
    mechanic_must_bring_tools: false,
    parts_and_tools_notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  const autoDetectLocation = async ({ silent = false } = {}) => {
    setLocating(true);
    if (!silent) setLocationError('');
    try {
      const detected = await detectCurrentJobLocation();
      if (!manualLocationEditedRef.current) {
        setFormData((prev) => ({ ...prev, location: detected }));
      }
    } catch (locError) {
      if (!silent) {
        setLocationError(locError?.message || 'Impossible de récupérer votre position');
      }
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    if (autoLocationTried) return;
    setAutoLocationTried(true);
    autoDetectLocation({ silent: true });
  }, [autoLocationTried]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    setError('');
  };

  const handleLocationInput = (e) => {
    const value = e.target.value;
    manualLocationEditedRef.current = true;
    setFormData((prev) => ({ ...prev, location: mergeManualAddress(prev.location, value) }));
    setLocationError('');
    setError('');
  };

  const handleUseCurrentLocation = async () => {
    manualLocationEditedRef.current = false;
    setLocationError('');
    await autoDetectLocation({ silent: false });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const payload = buildJobCreatePayload(formData);
    if (!payload.title) return setError(ui.titleRequired);
    if (payload.title.length < 5) return setError(ui.titleTooShort);
    if (!payload.location?.address && !payload.location?.fullAddress) return setError(ui.locationRequired);
    if (payload.budget_min === null && payload.budget_max === null) return setError(ui.budgetRequired);
    if (payload.budget_min > payload.budget_max) return setError(ui.budgetMaxInvalid);

    setLoading(true);
    try {
      await jobsAPI.create(payload);
      navigate('/jobs');
    } catch (submitError) {
      setError(normalizeApiErrorMessage(submitError));
    } finally {
      setLoading(false);
    }
  };

  // Le dessin du champ (papier, filet, rayon) appartient à la feuille :
  // `form :is(input, select, textarea)` le pose. Seule la mesure se dit ici.
  const inputClass = 'w-full px-4 py-3 outline-none';
  const locationLabel = buildLocationLabel(formData.location);
  const mapUrl = buildMapEmbedUrl(formData.location);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="titre-page">{ui.createJobTitle}</h1>
        <p className="mt-2 text-stone-600">{ui.createJobSubtitle}</p>
      </div>
      <form onSubmit={handleSubmit} className="carte-editoriale space-y-5 p-6">
        {error && <div className="rounded-[3px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div>
          <label className="mb-2 block text-sm font-medium">{ui.title} *</label>
          <input name="title" value={formData.title} onChange={handleChange} className={inputClass} placeholder={ui.title} />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">{ui.description}</label>
          <textarea name="description" rows="4" value={formData.description} onChange={handleChange} className={inputClass} placeholder={ui.optional} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <input name="location_text" value={locationLabel} onChange={handleLocationInput} className={inputClass} placeholder={`${ui.location} *`} />
          </div>
          <div>
            <select name="category" value={formData.category} onChange={handleChange} className={inputClass}>
              <option value="general">{t('general')}</option>
              <option value="plumbing">{t('plumbing')}</option>
              <option value="electrical">{t('electrical')}</option>
              <option value="construction">{t('construction')}</option>
              <option value="cleaning">{t('cleaning')}</option>
              <option value="gardening">{t('gardening')}</option>
              <option value="tutoring">{t('tutoring')}</option>
              <option value="mechanics">{t('mechanics')}</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button type="button" onClick={handleUseCurrentLocation} disabled={locating} className="bouton bouton-clair disabled:cursor-not-allowed disabled:opacity-60">
            {locating ? ui.locating : ui.useCurrentLocation}
          </button>
          {hasCoordinates(formData.location) && (
            <div className="flex items-center rounded-[3px] border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
              {ui.gpsDetected}
            </div>
          )}
        </div>

        {locationError && <div className="rounded-[3px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{locationError}</div>}

        {locationLabel && (
          <div className="carte-editoriale overflow-hidden">
            <div className="border-b border-stone-200 fond-sable px-4 py-3 text-sm text-stone-700">
              <div className="font-semibold">{ui.selectedAddress}</div>
              <div>{locationLabel}</div>
            </div>
            {mapUrl && (                <iframe title={ui.mapPreviewTitle} src={mapUrl} className="h-72 w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="mb-2 block text-sm font-medium">{ui.price} *</label>
            <input type="number" min="0" name="budget_min" value={formData.budget_min} onChange={handleChange} className={inputClass} placeholder={ui.price} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">{ui.priceMax}</label>
            <input type="number" min="0" name="budget_max" value={formData.budget_max} onChange={handleChange} className={inputClass} placeholder={ui.optional} />
          </div>
        </div>
        <p className="text-sm text-stone-500">{ui.priceHint}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input name="estimated_duration" value={formData.estimated_duration} onChange={handleChange} className={inputClass} placeholder={`${ui.estimatedDuration} (${ui.optional.toLowerCase?.() || ui.optional})`} />
          <input type="datetime-local" name="deadline" value={formData.deadline} onChange={handleChange} className={inputClass} />
        </div>
        <TagInput
          value={formData.required_skills}
          onChange={(next) => setFormData((prev) => ({ ...prev, required_skills: next }))}
          placeholder={ui.skillPlaceholder}
          addLabel={ui.add}
          removeAriaPrefix={t('remove')}
          max={20}
          inputClassName={inputClass}
        />
        <label className="flex items-center gap-3 rounded-[3px] border border-stone-200 px-4 py-3"><input type="checkbox" name="mechanic_must_bring_parts" checked={formData.mechanic_must_bring_parts} onChange={handleChange} /> {ui.workerBringsParts}</label>
        <label className="flex items-center gap-3 rounded-[3px] border border-stone-200 px-4 py-3"><input type="checkbox" name="mechanic_must_bring_tools" checked={formData.mechanic_must_bring_tools} onChange={handleChange} /> {ui.workerBringsTools}</label>
        <textarea name="parts_and_tools_notes" rows="3" value={formData.parts_and_tools_notes} onChange={handleChange} className={inputClass} placeholder={`${ui.partsNotes} (${ui.optional.toLowerCase?.() || ui.optional})`} />
        <div className="flex gap-3">
          <button type="button" onClick={() => navigate('/jobs')} className="bouton bouton-clair">{ui.cancel}</button>
          <button type="submit" disabled={loading} className="bouton bouton-encre disabled:cursor-not-allowed disabled:opacity-60">{loading ? ui.publishing : ui.createJob}</button>
        </div>
      </form>
    </div>
  );
}
