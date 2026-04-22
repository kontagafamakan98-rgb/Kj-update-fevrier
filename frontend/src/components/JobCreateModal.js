import { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { jobsAPI } from '../services/api';

export default function JobCreateModal({ onClose, onJobCreated }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'plumbing',
    budget_min: '',
    budget_max: '',
    location: {
      address: '',
      latitude: null,
      longitude: null
    },
    required_skills: [],
    estimated_duration: '',
    deadline: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [skillInput, setSkillInput] = useState('');

  const { t } = useLanguage();

  const categories = [
    { value: 'plumbing', label: t('plumbing') },
    { value: 'electrical', label: t('electrical') },
    { value: 'construction', label: t('construction') },
    { value: 'cleaning', label: t('cleaning') },
    { value: 'gardening', label: t('gardening') },
    { value: 'tutoring', label: t('tutoring') }
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (parseFloat(formData.budget_min) >= parseFloat(formData.budget_max)) {
        throw new Error(t('jobBudgetRangeError'));
      }
      const jobData = {
        ...formData,
        budget_min: parseFloat(formData.budget_min),
        budget_max: parseFloat(formData.budget_max),
        deadline: formData.deadline ? new Date(formData.deadline).toISOString() : null
      };
      await jobsAPI.create(jobData);
      onJobCreated();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || err.message || t('jobCreateError'));
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'address') {
      setFormData((prev) => ({ ...prev, location: { ...prev.location, address: value } }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const addSkill = () => {
    if (skillInput.trim() && !formData.required_skills.includes(skillInput.trim())) {
      setFormData((prev) => ({ ...prev, required_skills: [...prev.required_skills, skillInput.trim()] }));
      setSkillInput('');
    }
  };

  const removeSkill = (skillToRemove) => {
    setFormData((prev) => ({ ...prev, required_skills: prev.required_skills.filter((skill) => skill !== skillToRemove) }));
  };

  const handleSkillKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSkill();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">{t('postJob')}</h2>
          <button aria-label={t('close')} onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">{error}</div>}

          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">{t('jobTitle')}</label>
            <input type="text" id="title" name="title" required value={formData.title} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" placeholder={t('titlePlaceholder')} />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">{t('jobDescription')}</label>
            <textarea id="description" name="description" required rows={4} value={formData.description} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" placeholder={t('descriptionPlaceholder')} />
          </div>

          <div>
            <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-2">{t('category')}</label>
            <select id="category" name="category" value={formData.category} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500">
              {categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="budget_min" className="block text-sm font-medium text-gray-700 mb-2">{t('budgetMinLabel')}</label>
              <input type="number" id="budget_min" name="budget_min" required min="0" value={formData.budget_min} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
            </div>
            <div>
              <label htmlFor="budget_max" className="block text-sm font-medium text-gray-700 mb-2">{t('budgetMaxLabel')}</label>
              <input type="number" id="budget_max" name="budget_max" required min="0" value={formData.budget_max} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
            </div>
          </div>

          <div>
            <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-2">{t('location')}</label>
            <input type="text" id="address" name="address" required value={formData.location.address} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" placeholder={t('addressPlaceholder')} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('requiredSkills')}</label>
            <div className="flex space-x-2">
              <input id="job_skill_input" name="job_skill_input" type="text" value={skillInput} onChange={(e) => setSkillInput(e.target.value)} onKeyDown={handleSkillKeyPress} className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" placeholder={t('requiredSkillsPlaceholder')} />
              <button type="button" onClick={addSkill} className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700">{t('add')}</button>
            </div>
            {formData.required_skills.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">{formData.required_skills.map((skill) => <span key={skill} className="inline-flex items-center px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm">{skill}<button type="button" onClick={() => removeSkill(skill)} className="ml-2 text-orange-600 hover:text-orange-800">×</button></span>)}</div>
            )}
          </div>

          <div>
            <label htmlFor="estimated_duration" className="block text-sm font-medium text-gray-700 mb-2">{t('estimatedDuration')}</label>
            <input type="text" id="estimated_duration" name="estimated_duration" value={formData.estimated_duration} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" placeholder={t('durationPlaceholder')} />
          </div>

          <div>
            <label htmlFor="deadline" className="block text-sm font-medium text-gray-700 mb-2">{t('deadlineOptional')}</label>
            <input type="datetime-local" id="deadline" name="deadline" value={formData.deadline} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" />
          </div>

          <div className="flex justify-end space-x-4 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">{t('cancel')}</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-md disabled:opacity-50">{loading ? t('loading') : t('publishJobLabel')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
