import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import LocationDetector from '../components/LocationDetector';
import { getCountryByCode } from '../services/geolocationService';
import { makeScopedTranslator } from '../utils/pack2PageI18n';
import { safeLog } from '../utils/env';

export default function CreateJob() {
  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'createJob');

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'general',
    location: '',
    budget_min: '',
    budget_max: '',
    requirements: '',
    deadline: '',
    urgency: 'normal',
    mechanic_must_bring_parts: false,
    mechanic_must_bring_tools: false,
    parts_and_tools_notes: ''
  });

  const [errors, setErrors] = useState(() => ({}));
  const [loading, setLoading] = useState(false);

  const categories = [
    { value: 'general', label: pageT('categoryGeneral') },
    { value: 'plumbing', label: pageT('categoryPlumbing') },
    { value: 'electrical', label: pageT('categoryElectrical') },
    { value: 'painting', label: pageT('categoryPainting') },
    { value: 'cleaning', label: pageT('categoryCleaning') },
    { value: 'construction', label: pageT('categoryConstruction') },
    { value: 'gardening', label: pageT('categoryGardening') },
    { value: 'mechanics', label: pageT('categoryMechanics') }
  ];

  const urgencyOptions = [
    { value: 'low', label: pageT('urgencyLow'), emoji: '😊', color: 'bg-green-50 border-green-200 text-green-700' },
    { value: 'normal', label: pageT('urgencyNormal'), emoji: '🕐', color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
    { value: 'high', label: pageT('urgencyHigh'), emoji: '⚡', color: 'bg-red-50 border-red-200 text-red-700' }
  ];

  const handleLocationDetected = (location) => {
    if (!location?.fullAddress) return;

    setFormData((prev) => ({
      ...prev,
      location: location.fullAddress
    }));

    setErrors((prev) => ({
      ...prev,
      location: ''
    }));
  };


  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleBooleanChange = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const newErrors = {};
      if (!formData.title.trim()) newErrors.title = pageT('titleRequired');
      if (!formData.description.trim()) newErrors.description = pageT('descriptionRequired');
      if (!formData.location.trim()) newErrors.location = pageT('locationRequired');
      if (!formData.budget_min) newErrors.budget_min = pageT('budgetMinRequired');
      if (!formData.budget_max) newErrors.budget_max = pageT('budgetMaxRequired');

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        setLoading(false);
        return;
      }

      alert(pageT('successCreated'));

      setFormData({
        title: '',
        description: '',
        category: 'general',
        location: '',
        budget_min: '',
        budget_max: '',
        requirements: '',
        deadline: '',
        urgency: 'normal',
        mechanic_must_bring_parts: false,
        mechanic_must_bring_tools: false,
        parts_and_tools_notes: ''
      });
    } catch (error) {
      safeLog.error('Erreur création job:', error);
      alert(pageT('errorCreated'));
    } finally {
      setLoading(false);
    }
  };

  const userCountry = getCountryByCode(user?.country);
  const showMechanicBlock = ['general', 'plumbing', 'electrical', 'mechanics'].includes(formData.category);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{pageT('pageTitle')}</h1>
          <p className="text-gray-600">
            {pageT('pageSubtitle', { country: userCountry?.nameFrench || 'Mali' })}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                {pageT('titleLabel')}
              </label>
              <input
                type="text"
                id="title"
                name="title"
                autoComplete="off"
                value={formData.title}
                onChange={handleChange}
                placeholder={pageT('titlePlaceholder')}
                className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                  errors.title ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-orange-500'
                }`}
              />
              {errors.title && <p className="mt-1 text-sm text-red-600">{errors.title}</p>}
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                {pageT('descriptionLabel')}
              </label>
              <textarea
                id="description"
                name="description"
                autoComplete="off"
                rows={4}
                value={formData.description}
                onChange={handleChange}
                placeholder={pageT('descriptionPlaceholder')}
                className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                  errors.description ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-orange-500'
                }`}
              />
              {errors.description && <p className="mt-1 text-sm text-red-600">{errors.description}</p>}
            </div>

            <div>
              <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-2">
                {pageT('categoryLabel')}
              </label>
              <select
                id="category"
                name="category"
                autoComplete="off"
                value={formData.category}
                onChange={handleChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              >
                {categories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-2">
                {pageT('locationLabel')}
              </label>
              <div className="space-y-3">
                <input
                  type="text"
                  id="location"
                  name="location"
                  autoComplete="street-address"
                  value={formData.location}
                  onChange={handleChange}
                  placeholder={pageT('locationPlaceholder')}
                  className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                    errors.location ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-orange-500'
                  }`}
                />

                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <LocationDetector
                    onLocationDetected={handleLocationDetected}
                    userCountry={user?.country?.toLowerCase() || 'senegal'}
                    size="medium"
                    autoDetect
                  />
                  <p className="text-sm text-gray-500">{pageT('locationHelp')}</p>
                </div>
              </div>
              {errors.location && <p className="mt-1 text-sm text-red-600">{errors.location}</p>}
            </div>

            <div>
              <p className="block text-sm font-medium text-gray-700 mb-2">{pageT('budgetLabel')}</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="budget_min" className="sr-only">{pageT('budgetMinPlaceholder')}</label>
                  <input
                    type="number"
                    id="budget_min"
                    name="budget_min"
                    autoComplete="off"
                    value={formData.budget_min}
                    onChange={handleChange}
                    placeholder={pageT('budgetMinPlaceholder')}
                    className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                      errors.budget_min ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-orange-500'
                    }`}
                  />
                  {errors.budget_min && <p className="mt-1 text-sm text-red-600">{errors.budget_min}</p>}
                </div>
                <div>
                  <label htmlFor="budget_max" className="sr-only">{pageT('budgetMaxPlaceholder')}</label>
                  <input
                    type="number"
                    id="budget_max"
                    name="budget_max"
                    autoComplete="off"
                    value={formData.budget_max}
                    onChange={handleChange}
                    placeholder={pageT('budgetMaxPlaceholder')}
                    className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                      errors.budget_max ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-orange-500'
                    }`}
                  />
                  {errors.budget_max && <p className="mt-1 text-sm text-red-600">{errors.budget_max}</p>}
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="requirements" className="block text-sm font-medium text-gray-700 mb-2">
                {pageT('requirementsLabel')}
              </label>
              <textarea
                id="requirements"
                name="requirements"
                autoComplete="off"
                rows={3}
                value={formData.requirements}
                onChange={handleChange}
                placeholder={pageT('requirementsPlaceholder')}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>

            <div>
              <label htmlFor="deadline" className="block text-sm font-medium text-gray-700 mb-2">
                {pageT('deadlineLabel')}
              </label>
              <input
                type="date"
                id="deadline"
                name="deadline"
                autoComplete="off"
                value={formData.deadline}
                onChange={handleChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>

            <div>
              <p className="block text-sm font-medium text-gray-700 mb-2">{pageT('urgencyLabel')}</p>
              <div className="grid grid-cols-3 gap-3">
                {urgencyOptions.map((urgency) => (
                  <label
                    key={urgency.value}
                    className={`relative flex items-center justify-center p-3 border-2 rounded-lg cursor-pointer transition-all ${
                      formData.urgency === urgency.value
                        ? `${urgency.color} ring-2 ring-orange-500`
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      id={`urgency_${urgency.value}`}
                      name="urgency"
                      autoComplete="off"
                      value={urgency.value}
                      checked={formData.urgency === urgency.value}
                      onChange={handleChange}
                      className="sr-only"
                    />
                    <div className="text-center">
                      <div className="text-xl mb-1">{urgency.emoji}</div>
                      <div className="text-sm font-medium">{urgency.label}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {showMechanicBlock && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <div className="flex items-center mb-4">
                  <span className="text-2xl mr-3">🔧</span>
                  <h3 className="text-lg font-semibold text-blue-900">{pageT('mechanicInfoTitle')}</h3>
                </div>

                <div className="space-y-4">
                  <BooleanQuestion
                    fieldKey="mechanic_must_bring_parts"
                    emoji="🔩"
                    title={pageT('partsQuestion')}
                    description={pageT('partsDescription')}
                    value={formData.mechanic_must_bring_parts}
                    onChange={(value) => handleBooleanChange('mechanic_must_bring_parts', value)}
                    yesLabel={pageT('yes')}
                    noLabel={pageT('no')}
                  />

                  <BooleanQuestion
                    fieldKey="mechanic_must_bring_tools"
                    emoji="🛠️"
                    title={pageT('toolsQuestion')}
                    description={pageT('toolsDescription')}
                    value={formData.mechanic_must_bring_tools}
                    onChange={(value) => handleBooleanChange('mechanic_must_bring_tools', value)}
                    yesLabel={pageT('yes')}
                    noLabel={pageT('no')}
                  />

                  <div>
                    <label htmlFor="parts_and_tools_notes" className="block text-sm font-medium text-blue-900 mb-2">
                      {pageT('extraNotes')}
                    </label>
                    <textarea
                      id="parts_and_tools_notes"
                      name="parts_and_tools_notes"
                      autoComplete="off"
                      rows={3}
                      value={formData.parts_and_tools_notes}
                      onChange={handleChange}
                      placeholder={pageT('extraNotesPlaceholder')}
                      className="block w-full px-4 py-3 border border-blue-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    />
                    <p className="mt-1 text-xs text-blue-600">{pageT('extraNotesHelp')}</p>
                  </div>

                  <div className="mt-4 p-3 bg-blue-100 border border-blue-300 rounded-lg">
                    <h4 className="font-medium text-blue-900 mb-2">{pageT('mechanicSummary')}</h4>
                    <div className="text-sm text-blue-800 space-y-1">
                      <p>
                        🔩 <strong>{pageT('partsSummary')} :</strong>{' '}
                        <span className={formData.mechanic_must_bring_parts ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                          {formData.mechanic_must_bring_parts ? pageT('byMechanic') : pageT('byClient')}
                        </span>
                      </p>
                      <p>
                        🛠️ <strong>{pageT('toolsSummary')} :</strong>{' '}
                        <span className={formData.mechanic_must_bring_tools ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                          {formData.mechanic_must_bring_tools ? pageT('byMechanic') : pageT('byClient')}
                        </span>
                      </p>
                      {formData.parts_and_tools_notes && (
                        <p>
                          📝 <strong>{pageT('notesSummary')} :</strong> {formData.parts_and_tools_notes}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-6">
              <button
                type="submit"
                disabled={loading}
                className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white ${
                  loading
                    ? 'bg-orange-400 cursor-not-allowed'
                    : 'bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500'
                } transition-colors`}
              >
                {loading ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    {pageT('creating')}
                  </div>
                ) : (
                  pageT('publishButton')
                )}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-medium text-blue-900 mb-3">{pageT('tipsTitle')}</h3>
          <ul className="text-blue-800 space-y-2 text-sm">
            <li>{pageT('tip1')}</li>
            <li>{pageT('tip2')}</li>
            <li>{pageT('tip3')}</li>
            <li>{pageT('tip4')}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function BooleanQuestion({ fieldKey, emoji, title, description, value, onChange, yesLabel, noLabel }) {
  return (
    <div className="flex items-center justify-between p-4 bg-white border border-blue-200 rounded-lg gap-4 flex-wrap">
      <div className="flex items-center">
        <span className="text-xl mr-3">{emoji}</span>
        <div>
          <h4 className="font-medium text-gray-900">{title}</h4>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
      </div>
      <div className="flex items-center space-x-3">
        <label className="flex items-center">
          <input
            id={`${fieldKey}_yes`}
            name={fieldKey}
            type="radio"
            autoComplete="off"
            checked={value === true}
            onChange={() => onChange(true)}
            className="w-4 h-4 text-orange-600 focus:ring-orange-500"
          />
          <span className="ml-2 text-sm font-medium text-green-700">{yesLabel}</span>
        </label>
        <label className="flex items-center">
          <input
            id={`${fieldKey}_no`}
            name={fieldKey}
            type="radio"
            autoComplete="off"
            checked={value === false}
            onChange={() => onChange(false)}
            className="w-4 h-4 text-orange-600 focus:ring-orange-500"
          />
          <span className="ml-2 text-sm font-medium text-red-700">{noLabel}</span>
        </label>
      </div>
    </div>
  );
}
