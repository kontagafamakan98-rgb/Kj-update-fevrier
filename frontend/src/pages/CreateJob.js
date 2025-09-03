import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import LocationDetector from '../components/LocationDetector';
import { getCountryByCode } from '../services/geolocationService';
import { devLog, safeLog } from '../utils/env';


export default function CreateJob() {
  const { user } = useAuth();
  
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
    // Nouvelles informations pour mécaniciens
    mechanic_must_bring_parts: false,
    mechanic_must_bring_tools: false,
    parts_and_tools_notes: ''
  });

  const [errors, setErrors] = useState(() => ({}));
  const [loading, setLoading] = useState(false);

  const handleLocationDetected = (location) => {
    setFormData(prev => ({
      ...prev,
      location: location.fullAddress
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // Validation
      const newErrors = {};
      if (!formData.title.trim()) newErrors.title = 'Le titre est requis';
      if (!formData.description.trim()) newErrors.description = 'La description est requise';
      if (!formData.location.trim()) newErrors.location = 'La localisation est requise';
      if (!formData.budget_min) newErrors.budget_min = 'Budget minimum requis';
      if (!formData.budget_max) newErrors.budget_max = 'Budget maximum requis';
      
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        setLoading(false);
        return;
      }

      // En vrai, on ferait un appel API
      // const response = await api.post('/jobs', formData);
      
      alert('Job créé avec succès !');
      
      // Réinitialiser le formulaire
      setFormData({
        title: '',
        description: '',
        category: 'general',
        location: '',
        budget_min: '',
        budget_max: '',
        requirements: '',
        deadline: '',
        urgency: 'normal'
      });
      
    } catch (error) {
      safeLog.error('Erreur création job:', error);
      alert('Erreur lors de la création du job');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const userCountry = getCountryByCode(user?.country);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Créer un nouveau job
          </h1>
          <p className="text-gray-600">
            Trouvez le travailleur parfait pour votre projet au {userCountry?.nameFrench || 'Mali'}
          </p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Title */}
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                Titre du job *
              </label>
              <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder="Ex: Réparation plomberie urgente"
                className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                  errors.title ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-orange-500'
                }`}
              />
              {errors.title && <p className="mt-1 text-sm text-red-600">{errors.title}</p>}
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Description *
              </label>
              <textarea
                id="description"
                name="description"
                rows={4}
                value={formData.description}
                onChange={handleChange}
                placeholder="Décrivez en détail le travail à effectuer..."
                className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                  errors.description ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-orange-500'
                }`}
              />
              {errors.description && <p className="mt-1 text-sm text-red-600">{errors.description}</p>}
            </div>

            {/* Category */}
            <div>
              <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-2">
                Catégorie
              </label>
              <select
                id="category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              >
                <option value="general">🔧 Général</option>
                <option value="plumbing">🚿 Plomberie</option>
                <option value="electrical">⚡ Électricité</option>
                <option value="painting">🎨 Peinture</option>
                <option value="cleaning">🧹 Ménage</option>
                <option value="construction">🏗️ Construction</option>
                <option value="gardening">🌿 Jardinage</option>
                <option value="mechanics">🔩 Mécanique</option>
              </select>
            </div>

            {/* Location with GPS detection */}
            <div>
              <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-2">
                Localisation *
              </label>
              <div className="space-y-3">
                <input
                  type="text"
                  id="location"
                  name="location"
                  value={formData.location}
                  onChange={handleChange}
                  placeholder="Ex: Plateau, Dakar, Sénégal"
                  className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                    errors.location ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-orange-500'
                  }`}
                />
                
                {/* GPS Detection Button */}
                <div className="flex items-center justify-between">
                  <LocationDetector 
                    onLocationDetected={handleLocationDetected}
                    userCountry={user?.country?.toLowerCase() || 'senegal'}
                    size="medium"
                  />
                  <p className="text-sm text-gray-500">
                    ou utilisez le bouton GPS pour détecter automatiquement
                  </p>
                </div>
              </div>
              {errors.location && <p className="mt-1 text-sm text-red-600">{errors.location}</p>}
            </div>

            {/* Budget */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Budget (XOF) *
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <input
                    type="number"
                    name="budget_min"
                    value={formData.budget_min}
                    onChange={handleChange}
                    placeholder="Min (ex: 10000)"
                    className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                      errors.budget_min ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-orange-500'
                    }`}
                  />
                  {errors.budget_min && <p className="mt-1 text-sm text-red-600">{errors.budget_min}</p>}
                </div>
                <div>
                  <input
                    type="number"
                    name="budget_max"
                    value={formData.budget_max}
                    onChange={handleChange}
                    placeholder="Max (ex: 25000)"
                    className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                      errors.budget_max ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-orange-500'
                    }`}
                  />
                  {errors.budget_max && <p className="mt-1 text-sm text-red-600">{errors.budget_max}</p>}
                </div>
              </div>
            </div>

            {/* Requirements */}
            <div>
              <label htmlFor="requirements" className="block text-sm font-medium text-gray-700 mb-2">
                Exigences particulières
              </label>
              <textarea
                id="requirements"
                name="requirements"
                rows={3}
                value={formData.requirements}
                onChange={handleChange}
                placeholder="Ex: Expérience minimum 3 ans, outils fournis..."
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>

            {/* Deadline */}
            <div>
              <label htmlFor="deadline" className="block text-sm font-medium text-gray-700 mb-2">
                Date limite souhaitée
              </label>
              <input
                type="date"
                id="deadline"
                name="deadline"
                value={formData.deadline}
                onChange={handleChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>

            {/* Urgency */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Niveau d'urgence
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'low', label: 'Pas urgent', emoji: '😊', color: 'bg-green-50 border-green-200 text-green-700' },
                  { value: 'normal', label: 'Normal', emoji: '🕐', color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
                  { value: 'high', label: 'Urgent', emoji: '⚡', color: 'bg-red-50 border-red-200 text-red-700' }
                ].map(urgency => (
                  <label
                    key={urgency.value}
                    className={`relative flex items-center justify-center p-3 border-2 rounded-lg cursor-pointer transition-all ${
                      formData.urgency === urgency.value 
                        ? urgency.color + ' ring-2 ring-orange-500' 
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="urgency"
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

            {/* Section Pièces et Outils - Spécial Mécaniciens */}
            {(formData.category === 'mecanique' || formData.category === 'plomberie' || 
              formData.category === 'electricite' || formData.category === 'general') && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <div className="flex items-center mb-4">
                  <span className="text-2xl mr-3">🔧</span>
                  <h3 className="text-lg font-semibold text-blue-900">
                    Informations Importantes pour le Mécanicien
                  </h3>
                </div>
                
                <div className="space-y-4">
                  {/* Pièces */}
                  <div className="flex items-center justify-between p-4 bg-white border border-blue-200 rounded-lg">
                    <div className="flex items-center">
                      <span className="text-xl mr-3">🔩</span>
                      <div>
                        <h4 className="font-medium text-gray-900">Le mécanicien doit-il apporter les pièces ?</h4>
                        <p className="text-sm text-gray-600">Pièces de rechange, composants, etc.</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name="mechanic_must_bring_parts"
                          value="true"
                          checked={formData.mechanic_must_bring_parts === true}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            mechanic_must_bring_parts: e.target.value === 'true'
                          }))}
                          className="w-4 h-4 text-orange-600 focus:ring-orange-500"
                        />
                        <span className="ml-2 text-sm font-medium text-green-700">✅ Oui</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name="mechanic_must_bring_parts"
                          value="false"
                          checked={formData.mechanic_must_bring_parts === false}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            mechanic_must_bring_parts: e.target.value === 'true'
                          }))}
                          className="w-4 h-4 text-orange-600 focus:ring-orange-500"
                        />
                        <span className="ml-2 text-sm font-medium text-red-700">❌ Non</span>
                      </label>
                    </div>
                  </div>

                  {/* Outils */}
                  <div className="flex items-center justify-between p-4 bg-white border border-blue-200 rounded-lg">
                    <div className="flex items-center">
                      <span className="text-xl mr-3">🛠️</span>
                      <div>
                        <h4 className="font-medium text-gray-900">Le mécanicien doit-il apporter les outils ?</h4>
                        <p className="text-sm text-gray-600">Outils spécialisés, équipements, etc.</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name="mechanic_must_bring_tools"
                          value="true"
                          checked={formData.mechanic_must_bring_tools === true}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            mechanic_must_bring_tools: e.target.value === 'true'
                          }))}
                          className="w-4 h-4 text-orange-600 focus:ring-orange-500"
                        />
                        <span className="ml-2 text-sm font-medium text-green-700">✅ Oui</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name="mechanic_must_bring_tools"
                          value="false"
                          checked={formData.mechanic_must_bring_tools === false}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            mechanic_must_bring_tools: e.target.value === 'true'
                          }))}
                          className="w-4 h-4 text-orange-600 focus:ring-orange-500"
                        />
                        <span className="ml-2 text-sm font-medium text-red-700">❌ Non</span>
                      </label>
                    </div>
                  </div>

                  {/* Notes supplémentaires */}
                  <div>
                    <label htmlFor="parts_and_tools_notes" className="block text-sm font-medium text-blue-900 mb-2">
                      📝 Notes supplémentaires (optionnel)
                    </label>
                    <textarea
                      id="parts_and_tools_notes"
                      name="parts_and_tools_notes"
                      rows={3}
                      value={formData.parts_and_tools_notes}
                      onChange={handleChange}
                      placeholder="Ex: Pièces spécifiques nécessaires, modèle du véhicule, marque des outils requis..."
                      className="block w-full px-4 py-3 border border-blue-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    />
                    <p className="mt-1 text-xs text-blue-600">
                      💡 Ces informations aideront le mécanicien à mieux se préparer pour votre intervention
                    </p>
                  </div>

                  {/* Résumé */}
                  <div className="mt-4 p-3 bg-blue-100 border border-blue-300 rounded-lg">
                    <h4 className="font-medium text-blue-900 mb-2">📋 Résumé pour le mécanicien :</h4>
                    <div className="text-sm text-blue-800 space-y-1">
                      <p>
                        🔩 <strong>Pièces :</strong> 
                        <span className={formData.mechanic_must_bring_parts ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                          {formData.mechanic_must_bring_parts ? ' À apporter par le mécanicien' : ' Fournies par le client'}
                        </span>
                      </p>
                      <p>
                        🛠️ <strong>Outils :</strong> 
                        <span className={formData.mechanic_must_bring_tools ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                          {formData.mechanic_must_bring_tools ? ' À apporter par le mécanicien' : ' Fournis par le client'}
                        </span>
                      </p>
                      {formData.parts_and_tools_notes && (
                        <p>📝 <strong>Notes :</strong> {formData.parts_and_tools_notes}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Submit Button */}
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
                    Création en cours...
                  </div>
                ) : (
                  '🚀 Publier le job'
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Tips */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-medium text-blue-900 mb-3">
            💡 Conseils pour un bon job
          </h3>
          <ul className="text-blue-800 space-y-2 text-sm">
            <li>• Soyez précis dans la description du travail</li>
            <li>• Proposez un budget réaliste pour attirer des candidats qualifiés</li>
            <li>• Mentionnez si vous fournissez les outils ou matériaux</li>
            <li>• Répondez rapidement aux candidatures</li>
          </ul>
        </div>
      </div>
    </div>
  );
}