import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { jobsAPI } from '../services/api';
import { buildJobCreatePayload, normalizeApiErrorMessage } from '../utils/jobCreateBridge';
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
  const [skillInput, setSkillInput] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    setError('');
  };

  const handleLocationInput = (e) => {
    const value = e.target.value;
    setFormData((prev) => ({ ...prev, location: mergeManualAddress(prev.location, value) }));
    setLocationError('');
    setError('');
  };

  const handleUseCurrentLocation = async () => {
    setLocating(true);
    setLocationError('');
    try {
      const detected = await detectCurrentJobLocation();
      setFormData((prev) => ({ ...prev, location: detected }));
    } catch (locError) {
      setLocationError(locError?.message || 'Impossible de récupérer votre position');
    } finally {
      setLocating(false);
    }
  };

  const addSkill = () => {
    const next = String(skillInput || '').trim();
    if (!next) return;
    if (formData.required_skills.includes(next)) return setSkillInput('');
    setFormData((prev) => ({ ...prev, required_skills: [...prev.required_skills, next] }));
    setSkillInput('');
  };

  const removeSkill = (skill) => {
    setFormData((prev) => ({ ...prev, required_skills: prev.required_skills.filter((item) => item !== skill) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const payload = buildJobCreatePayload(formData);
    if (!payload.title) return setError('Titre requis');
    if (!payload.location?.address && !payload.location?.fullAddress) return setError('Localisation requise');
    if (payload.budget_min === null && payload.budget_max === null) return setError('Prix requis');
    if (payload.budget_min > payload.budget_max) return setError('Le prix maximum doit être supérieur ou égal au prix minimum');

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

  const inputClass = 'w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100';
  const locationLabel = buildLocationLabel(formData.location);
  const mapUrl = buildMapEmbedUrl(formData.location);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Publier un job</h1>
        <p className="mt-2 text-gray-600">Seuls le titre, le prix et la localisation sont obligatoires.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Titre *</label>
          <input name="title" value={formData.title} onChange={handleChange} className={inputClass} placeholder="Titre" />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Description</label>
          <textarea name="description" rows="4" value={formData.description} onChange={handleChange} className={inputClass} placeholder="Optionnel" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <input name="location_text" value={locationLabel} onChange={handleLocationInput} className={inputClass} placeholder="Localisation *" />
          </div>
          <div>
            <select name="category" value={formData.category} onChange={handleChange} className={inputClass}>
              <option value="general">Général</option>
              <option value="plumbing">Plomberie</option>
              <option value="electrical">Électricité</option>
              <option value="construction">Construction</option>
              <option value="cleaning">Nettoyage</option>
              <option value="gardening">Jardinage</option>
              <option value="tutoring">Cours</option>
              <option value="mechanics">Mécanique</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button type="button" onClick={handleUseCurrentLocation} disabled={locating} className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-60">
            {locating ? 'Localisation...' : 'Utiliser ma position actuelle'}
          </button>
          {hasCoordinates(formData.location) && (
            <div className="flex items-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              GPS détecté
            </div>
          )}
        </div>

        {locationError && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{locationError}</div>}

        {locationLabel && (
          <div className="rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-sm text-gray-700">
              <div className="font-semibold">Adresse retenue</div>
              <div>{locationLabel}</div>
            </div>
            {mapUrl && (
              <iframe title="Aperçu de la localisation du job" src={mapUrl} className="h-72 w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Prix *</label>
            <input type="number" min="0" name="budget_min" value={formData.budget_min} onChange={handleChange} className={inputClass} placeholder="Prix" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Prix max</label>
            <input type="number" min="0" name="budget_max" value={formData.budget_max} onChange={handleChange} className={inputClass} placeholder="Optionnel" />
          </div>
        </div>
        <p className="text-sm text-gray-500">Si tu mets seulement le prix, il sera utilisé comme prix min et prix max.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input name="estimated_duration" value={formData.estimated_duration} onChange={handleChange} className={inputClass} placeholder="Durée estimée (optionnel)" />
          <input type="datetime-local" name="deadline" value={formData.deadline} onChange={handleChange} className={inputClass} />
        </div>
        <div className="flex gap-2">
          <input value={skillInput} onChange={(e) => setSkillInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }} className={inputClass} placeholder="Compétence demandée (optionnel)" />
          <button type="button" onClick={addSkill} className="rounded-xl bg-gray-900 px-4 py-3 font-semibold text-white">Ajouter</button>
        </div>
        {formData.required_skills.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {formData.required_skills.map((skill) => (
              <button key={skill} type="button" onClick={() => removeSkill(skill)} className="rounded-full bg-orange-50 border border-orange-200 px-3 py-1 text-sm text-orange-700">{skill} ×</button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3"><input type="checkbox" name="mechanic_must_bring_parts" checked={formData.mechanic_must_bring_parts} onChange={handleChange} /> Le travailleur doit apporter les pièces</label>
        <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3"><input type="checkbox" name="mechanic_must_bring_tools" checked={formData.mechanic_must_bring_tools} onChange={handleChange} /> Le travailleur doit apporter les outils</label>
        <textarea name="parts_and_tools_notes" rows="3" value={formData.parts_and_tools_notes} onChange={handleChange} className={inputClass} placeholder="Notes pièces / outils (optionnel)" />
        <div className="flex gap-3">
          <button type="button" onClick={() => navigate('/jobs')} className="rounded-xl border border-gray-200 px-5 py-3 font-semibold text-gray-700 hover:bg-gray-50">Annuler</button>
          <button type="submit" disabled={loading} className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700 disabled:opacity-60">{loading ? 'Publication...' : 'Publier le job'}</button>
        </div>
      </form>
    </div>
  );
}
