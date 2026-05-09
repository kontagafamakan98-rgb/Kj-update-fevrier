import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { jobsAPI } from '../services/api';
import { makeScopedTranslator } from '../utils/pack2PageI18n';

export default function CreateJob() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'createJob');

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'plumbing',
    location: '',
    budget_min: '',
    budget_max: '',
    estimated_duration: '',
    deadline: ''
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const categories = [
    { value: 'plumbing', label: pageT('categoryPlumbing') || 'Plomberie' },
    { value: 'electrical', label: pageT('categoryElectrical') || 'Électricité' },
    { value: 'construction', label: pageT('categoryConstruction') || 'Construction' },
    { value: 'cleaning', label: pageT('categoryCleaning') || 'Nettoyage' },
    { value: 'gardening', label: pageT('categoryGardening') || 'Jardinage' },
    { value: 'tutoring', label: pageT('categoryTutoring') || 'Cours' },
    { value: 'mechanics', label: pageT('categoryMechanics') || 'Mécanique' },
    { value: 'general', label: pageT('categoryGeneral') || 'Général' }
  ];

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const nextErrors = {};
    if (!formData.title.trim()) nextErrors.title = pageT('titleRequired') || 'Titre requis';
    if (!formData.description.trim()) nextErrors.description = pageT('descriptionRequired') || 'Description requise';
    if (!formData.location.trim()) nextErrors.location = pageT('locationRequired') || 'Localisation requise';
    if (!formData.budget_min) nextErrors.budget_min = pageT('budgetMinRequired') || 'Budget minimum requis';
    if (!formData.budget_max) nextErrors.budget_max = pageT('budgetMaxRequired') || 'Budget maximum requis';

    const min = Number(formData.budget_min);
    const max = Number(formData.budget_max);
    if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
      nextErrors.budget_max = pageT('jobBudgetRangeError') || 'Le budget max doit être supérieur ou égal au budget min';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');
    if (!validate()) return;

    setLoading(true);
    try {
      await jobsAPI.create({
        title: formData.title.trim(),
        description: formData.description.trim(),
        category: formData.category,
        location: formData.location.trim(),
        budget_min: Number(formData.budget_min),
        budget_max: Number(formData.budget_max),
        estimated_duration: formData.estimated_duration?.trim() || null,
        deadline: formData.deadline ? new Date(formData.deadline).toISOString() : null,
      });
      navigate('/jobs');
    } catch (error) {
      setSubmitError(error?.response?.data?.detail || error?.message || pageT('jobCreateError') || 'Création du job impossible');
    } finally {
      setLoading(false);
    }
  };

  if (!user || user.user_type !== 'client') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          {pageT('clientOnly') || 'Seuls les clients peuvent publier un job.'}
        </div>
      </div>
    );
  }

  const inputClass = 'w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100';

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">{pageT('title') || 'Publier un job'}</h1>
        <p className="mt-2 text-gray-600">{pageT('subtitle') || 'Décris ton besoin clairement pour recevoir les bonnes propositions.'}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
        {submitError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">{submitError}</div>
        )}

        <div>
          <label className="mb-2 block font-medium text-gray-700">{pageT('titleLabel') || 'Titre'}</label>
          <input name="title" value={formData.title} onChange={handleChange} className={inputClass} placeholder={pageT('titlePlaceholder') || 'Ex: Réparation de tuyauterie'} />
          {errors.title && <p className="mt-1 text-sm text-red-600">{errors.title}</p>}
        </div>

        <div>
          <label className="mb-2 block font-medium text-gray-700">{pageT('descriptionLabel') || 'Description'}</label>
          <textarea name="description" value={formData.description} onChange={handleChange} rows="5" className={inputClass} placeholder={pageT('descriptionPlaceholder') || 'Explique clairement le travail à faire'} />
          {errors.description && <p className="mt-1 text-sm text-red-600">{errors.description}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="mb-2 block font-medium text-gray-700">{pageT('categoryLabel') || 'Catégorie'}</label>
            <select name="category" value={formData.category} onChange={handleChange} className={inputClass}>
              {categories.map((category) => (
                <option key={category.value} value={category.value}>{category.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block font-medium text-gray-700">{pageT('locationLabel') || 'Localisation'}</label>
            <input name="location" value={formData.location} onChange={handleChange} className={inputClass} placeholder={pageT('locationPlaceholder') || 'Quartier, ville, adresse utile'} />
            {errors.location && <p className="mt-1 text-sm text-red-600">{errors.location}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="mb-2 block font-medium text-gray-700">{pageT('budgetMinLabel') || 'Budget min'}</label>
            <input type="number" min="0" name="budget_min" value={formData.budget_min} onChange={handleChange} className={inputClass} placeholder="1000" />
            {errors.budget_min && <p className="mt-1 text-sm text-red-600">{errors.budget_min}</p>}
          </div>
          <div>
            <label className="mb-2 block font-medium text-gray-700">{pageT('budgetMaxLabel') || 'Budget max'}</label>
            <input type="number" min="0" name="budget_max" value={formData.budget_max} onChange={handleChange} className={inputClass} placeholder="5000" />
            {errors.budget_max && <p className="mt-1 text-sm text-red-600">{errors.budget_max}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="mb-2 block font-medium text-gray-700">{pageT('durationLabel') || 'Durée estimée'}</label>
            <input name="estimated_duration" value={formData.estimated_duration} onChange={handleChange} className={inputClass} placeholder={pageT('durationPlaceholder') || 'Ex: 2 heures'} />
          </div>
          <div>
            <label className="mb-2 block font-medium text-gray-700">{pageT('deadlineLabel') || 'Deadline'}</label>
            <input type="datetime-local" name="deadline" value={formData.deadline} onChange={handleChange} className={inputClass} />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button type="button" onClick={() => navigate('/jobs')} className="rounded-xl border border-gray-200 px-5 py-3 font-semibold text-gray-700 hover:bg-gray-50">
            {pageT('cancel') || 'Annuler'}
          </button>
          <button type="submit" disabled={loading} className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
            {loading ? (pageT('creating') || 'Publication...') : (pageT('submit') || 'Publier le job')}
          </button>
        </div>
      </form>
    </div>
  );
}
