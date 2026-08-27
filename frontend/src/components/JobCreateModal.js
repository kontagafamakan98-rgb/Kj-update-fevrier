import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import TagInput from './TagInput';
import { jobsAPI } from '../services/api';
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

export default function JobCreateModal({ onClose, onJobCreated }) {
  const { currentLanguage, t } = useLanguage();
  const ui = getJobUiLabel(currentLanguage);
  const manualLocationEditedRef = useRef(false);
  const dialogRef = useRef(null);

  // Accessibilité : focus initial dans la modale (conteneur tabindex=-1),
  // fermeture à Échap, et restauration du focus sur l'élément déclencheur à
  // la fermeture — le pattern attendu pour un dialogue modal.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    dialogRef.current?.focus();
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
      const created = await jobsAPI.create(payload);
      if (typeof onJobCreated === 'function') onJobCreated(created);
      if (typeof onClose === 'function') onClose();
    } catch (submitError) {
      setError(normalizeApiErrorMessage(submitError));
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100';
  const locationLabel = buildLocationLabel(formData.location);
  const mapUrl = buildMapEmbedUrl(formData.location);

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="job-create-modal-title" tabIndex={-1} className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-gray-100 max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 sticky top-0 bg-white">
          <div>
            <h2 id="job-create-modal-title" className="text-xl font-bold text-gray-900">{ui.createJobTitle}</h2>
            <p className="text-sm text-gray-500">{ui.createJobSubtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('close')} className="rounded-lg px-3 py-2 text-gray-500 hover:bg-gray-100">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6">
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">{ui.title} *</label>
            <input name="title" value={formData.title} onChange={handleChange} className={inputClass} placeholder={ui.title} />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">{ui.description}</label>
            <textarea name="description" rows="4" value={formData.description} onChange={handleChange} className={inputClass} placeholder={ui.optional} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">{ui.category}</label>
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
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">{ui.location} *</label>
              <input name="location_text" value={locationLabel} onChange={handleLocationInput} className={inputClass} placeholder={ui.location} />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button type="button" onClick={handleUseCurrentLocation} disabled={locating} className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-60">
              {locating ? ui.locating : ui.useCurrentLocation}
            </button>
            {hasCoordinates(formData.location) && (
              <div className="flex items-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {ui.gpsDetected}
              </div>
            )}
          </div>

          {locationError && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{locationError}</div>}

          {locationLabel && (
            <div className="rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-sm text-gray-700">
                <div className="font-semibold">{ui.selectedAddress}</div>
                <div>{locationLabel}</div>
              </div>
              {mapUrl && (
                <iframe title={ui.mapPreviewTitle} src={mapUrl} className="h-72 w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">{ui.price} *</label>
              <input type="number" min="0" name="budget_min" value={formData.budget_min} onChange={handleChange} className={inputClass} placeholder={ui.price} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">{ui.priceMax}</label>
              <input type="number" min="0" name="budget_max" value={formData.budget_max} onChange={handleChange} className={inputClass} placeholder={ui.optional} />
            </div>
          </div>
          <p className="text-sm text-gray-500">{ui.priceHint}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">{ui.estimatedDuration}</label>
              <input name="estimated_duration" value={formData.estimated_duration} onChange={handleChange} className={inputClass} placeholder={ui.optional} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">{ui.deadline}</label>
              <input type="datetime-local" name="deadline" value={formData.deadline} onChange={handleChange} className={inputClass} />
            </div>
          </div>

          <div>
            <TagInput
              value={formData.required_skills}
              onChange={(next) => setFormData((prev) => ({ ...prev, required_skills: next }))}
              placeholder={ui.skillPlaceholder}
              addLabel={ui.add}
              removeAriaPrefix={t('remove')}
              max={20}
              inputClassName={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
              <input type="checkbox" name="mechanic_must_bring_parts" checked={formData.mechanic_must_bring_parts} onChange={handleChange} />
              <span>{ui.workerBringsParts}</span>
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
              <input type="checkbox" name="mechanic_must_bring_tools" checked={formData.mechanic_must_bring_tools} onChange={handleChange} />
              <span>{ui.workerBringsTools}</span>
            </label>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">{ui.partsNotes}</label>
            <textarea name="parts_and_tools_notes" rows="3" value={formData.parts_and_tools_notes} onChange={handleChange} className={inputClass} placeholder={ui.optional} />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-3 font-semibold text-gray-700 hover:bg-gray-50">{ui.cancel}</button>
            <button type="submit" disabled={loading} className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
              {loading ? ui.publishing : ui.createJob}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
