import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const WorkerRegistrationFields = ({ formData, setFormData, errors, setErrors }) => {
  const [showSkillInput, setShowSkillInput] = useState(false);
  const [newSkill, setNewSkill] = useState('');
  const { t } = useLanguage();

  // Compétences prédéfinies par catégorie avec traductions
  const predefinedSkillsData = {
    mechanics: ['Réparation moteur', 'Diagnostic automobile', 'Carrosserie', 'Électricité auto', 'Climatisation auto'],
    plumbing: ['Installation sanitaire', 'Réparation fuites', 'Soudure', 'Débouchage canalisations', 'Installation chauffe-eau'],
    electrical: ['Installation électrique', 'Dépannage électrique', 'Câblage', 'Tableau électrique', 'Éclairage'],
    construction: ['Maçonnerie', 'Carrelage', 'Peinture', 'Menuiserie', 'Toiture'],
    computing: ['Réparation PC', 'Installation logiciels', 'Réseaux', 'Maintenance', 'Formation'],
    gardening: ['Entretien jardin', 'Élagage', 'Plantation', 'Arrosage automatique', 'Paysagisme'],
    tutoring: ['Mathématiques', 'Français', 'Anglais', 'Sciences', 'Histoire-Géographie', 'Physique-Chimie', 'Informatique scolaire', 'Aide aux devoirs', 'Préparation examens', 'Soutien scolaire']
  };

  // Construire les compétences avec les traductions des catégories
  const predefinedSkills = {};
  Object.keys(predefinedSkillsData).forEach(categoryKey => {
    const translatedCategory = t(categoryKey);
    predefinedSkills[translatedCategory] = predefinedSkillsData[categoryKey];
  });

  const handleSpecialtyAdd = (skill) => {
    const currentSpecialties = formData.worker_specialties || [];
    if (!currentSpecialties.includes(skill)) {
      setFormData(prev => ({
        ...prev,
        worker_specialties: [...currentSpecialties, skill]
      }));
    }
  };

  const handleSpecialtyRemove = (skill) => {
    const currentSpecialities = formData.worker_specialties || [];
    setFormData(prev => ({
      ...prev,
      worker_specialties: currentSpecialities.filter(s => s !== skill)
    }));
  };

  const handleAddCustomSkill = () => {
    if (newSkill.trim()) {
      handleSpecialtyAdd(newSkill.trim());
      setNewSkill('');
      setShowSkillInput(false);
    }
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
      <div className="flex items-center mb-4">
        <span className="text-2xl mr-3">👷</span>
        <h3 className="text-lg font-semibold text-blue-900">
          {t('professionalInformationWorker')}
        </h3>
      </div>
      
      <div className="space-y-6">
        {/* Compétences et Spécialités */}
        <div>
          <label className="block text-sm font-medium text-blue-900 mb-3">
            🔧 {t('skillsAndSpecialties')} *
          </label>
          
          {/* Compétences sélectionnées */}
          {formData.worker_specialties && formData.worker_specialties.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-blue-700 mb-2">{t('selectedSkills')}</p>
              <div className="flex flex-wrap gap-2">
                {formData.worker_specialties.map((skill, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => handleSpecialtyRemove(skill)}
                      className="ml-2 text-green-600 hover:text-green-800"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Compétences prédéfinies par catégorie */}
          <div className="space-y-3">
            {Object.entries(predefinedSkills).map(([category, skills]) => (
              <div key={category} className="bg-white border border-blue-200 rounded-lg p-3">
                <h4 className="font-medium text-blue-800 mb-2">{category}</h4>
                <div className="flex flex-wrap gap-2">
                  {skills.map((skill) => {
                    const isSelected = formData.worker_specialties?.includes(skill);
                    return (
                      <button
                        key={skill}
                        type="button"
                        onClick={() => isSelected ? handleSpecialtyRemove(skill) : handleSpecialtyAdd(skill)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-blue-100'
                        }`}
                      >
                        {isSelected ? '✓ ' : ''}{skill}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Ajouter compétence personnalisée */}
          <div className="mt-3">
            {showSkillInput ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  placeholder="Votre compétence personnalisée"
                  className="flex-1 px-3 py-2 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyPress={(e) => e.key === 'Enter' && handleAddCustomSkill()}
                />
                <button
                  type="button"
                  onClick={handleAddCustomSkill}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Ajouter
                </button>
                <button
                  type="button"
                  onClick={() => {setShowSkillInput(false); setNewSkill('');}}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSkillInput(true)}
                className="text-sm text-blue-600 hover:text-blue-700 flex items-center"
              >
                + Ajouter une compétence personnalisée
              </button>
            )}
          </div>

          {errors.worker_specialties && (
            <p className="text-red-500 text-sm mt-1">{errors.worker_specialties}</p>
          )}
        </div>

        {/* Années d'expérience */}
        <div>
          <label htmlFor="worker_experience_years" className="block text-sm font-medium text-blue-900 mb-2">
            📅 Années d'expérience *
          </label>
          <select
            id="worker_experience_years"
            value={formData.worker_experience_years || ''}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              worker_experience_years: parseInt(e.target.value) || 0
            }))}
            className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.worker_experience_years ? 'border-red-300 focus:border-red-500' : 'border-blue-300 focus:border-blue-500'
            }`}
          >
            <option value="">Sélectionnez votre expérience</option>
            <option value="0">Débutant (0-1 an)</option>
            <option value="1">1-2 ans</option>
            <option value="3">3-5 ans</option>
            <option value="6">6-10 ans</option>
            <option value="11">11-15 ans</option>
            <option value="16">16-20 ans</option>
            <option value="21">Plus de 20 ans</option>
          </select>
          {errors.worker_experience_years && (
            <p className="text-red-500 text-sm mt-1">{errors.worker_experience_years}</p>
          )}
        </div>

        {/* Tarif horaire */}
        <div>
          <label htmlFor="worker_hourly_rate" className="block text-sm font-medium text-blue-900 mb-2">
            💰 Tarif horaire (FCFA) *
          </label>
          <div className="relative">
            <input
              type="number"
              id="worker_hourly_rate"
              value={formData.worker_hourly_rate || ''}
              onChange={(e) => setFormData(prev => ({
                ...prev,
                worker_hourly_rate: parseFloat(e.target.value) || 0
              }))}
              placeholder="Ex: 2500"
              min="500"
              step="250"
              className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.worker_hourly_rate ? 'border-red-300 focus:border-red-500' : 'border-blue-300 focus:border-blue-500'
              }`}
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="text-gray-500 text-sm">FCFA/h</span>
            </div>
          </div>
          {errors.worker_hourly_rate && (
            <p className="text-red-500 text-sm mt-1">{errors.worker_hourly_rate}</p>
          )}
          
          {/* Exemples de tarifs */}
          <div className="mt-2 text-xs text-blue-600">
            <p>💡 Exemples de tarifs par heure :</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {[
                { job: 'Électricien', rate: '3000-5000' },
                { job: 'Plombier', rate: '2500-4000' },
                { job: 'Mécanicien', rate: '2000-3500' },
                { job: 'Maçon', rate: '1500-2500' },
                { job: 'Tuteur', rate: '1000-2500' }
              ].map((example) => (
                <span key={example.job} className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">
                  {example.job}: {example.rate} FCFA
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Message d'information */}
        <div className="bg-blue-100 border border-blue-300 rounded-lg p-4">
          <div className="flex items-start">
            <span className="text-blue-500 text-lg mr-3">ℹ️</span>
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">Ces informations apparaîtront sur votre profil public</p>
              <ul className="text-xs space-y-1">
                <li>• Vos compétences aideront les clients à vous trouver</li>
                <li>• Votre expérience rassure sur vos qualifications</li>
                <li>• Votre tarif aide les clients à estimer le coût</li>
                <li>• Vous pourrez modifier ces informations dans votre profil</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkerRegistrationFields;