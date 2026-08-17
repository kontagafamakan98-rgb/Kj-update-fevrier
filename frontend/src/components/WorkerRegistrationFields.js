import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const WorkerRegistrationFields = ({ formData, setFormData, errors }) => {
  const [showSkillInput, setShowSkillInput] = useState(false);
  const [newSkill, setNewSkill] = useState('');
  const { t } = useLanguage();

  // Chaque spécialité est référencée par une clé i18n (skill*) pour être
  // traduite dans les 5 langues. La valeur STOCKÉE reste le libellé FR
  // (source de vérité backend) : on garde une correspondance clé → libellé FR.
  const SKILL_KEY_TO_FR = {
    skillReparationMoteur: 'Réparation moteur',
    skillDiagnosticAuto: 'Diagnostic automobile',
    skillCarrosserie: 'Carrosserie',
    skillElectriciteAuto: 'Électricité auto',
    skillClimatisationAuto: 'Climatisation auto',
    skillInstallationSanitaire: 'Installation sanitaire',
    skillReparationFuites: 'Réparation fuites',
    skillSoudure: 'Soudure',
    skillDebouchage: 'Débouchage canalisations',
    skillChauffeEau: 'Installation chauffe-eau',
    skillInstallationElectrique: 'Installation électrique',
    skillDepannageElectrique: 'Dépannage électrique',
    skillCablage: 'Câblage',
    skillTableauElectrique: 'Tableau électrique',
    skillEclairage: 'Éclairage',
    skillMaconnerie: 'Maçonnerie',
    skillCarrelage: 'Carrelage',
    skillPeinture: 'Peinture',
    skillToiture: 'Toiture',
    skillCoffrage: 'Coffrage',
    skillFabricationMeubles: 'Fabrication de meubles',
    skillPosePortes: 'Pose de portes',
    skillPoseFenetres: 'Pose de fenêtres',
    skillMenuiserieAlu: 'Menuiserie aluminium',
    skillMenuiserieBois: 'Menuiserie bois',
    skillPlacards: 'Placards et dressings',
    skillCuisineSurMesure: 'Cuisine sur mesure',
    skillEscaliersBois: 'Escaliers en bois',
    skillFinitionVernissage: 'Finition et vernissage',
    skillReparationMeubles: 'Réparation de meubles',
    skillReparationPC: 'Réparation PC',
    skillInstallationLogiciels: 'Installation logiciels',
    skillReseaux: 'Réseaux',
    skillMaintenance: 'Maintenance',
    skillFormation: 'Formation',
    skillReparationAndroid: 'Réparation téléphone Android',
    skillReparationIphone: 'Réparation iPhone',
    skillChangementEcran: 'Changement écran téléphone',
    skillEntretienJardin: 'Entretien jardin',
    skillElagage: 'Élagage',
    skillPlantation: 'Plantation',
    skillArrosageAuto: 'Arrosage automatique',
    skillPaysagisme: 'Paysagisme',
    skillMathematiques: 'Mathématiques',
    skillFrancais: 'Français',
    skillAnglais: 'Anglais',
    skillSciences: 'Sciences',
    skillHistoireGeo: 'Histoire-Géographie',
    skillPhysiqueChimie: 'Physique-Chimie',
    skillInformatiqueScolaire: 'Informatique scolaire',
    skillAideDevoirs: 'Aide aux devoirs',
    skillPreparationExamens: 'Préparation examens',
    skillSoutienScolaire: 'Soutien scolaire',
  };

  // Libellé affiché (traduit) pour une clé de spécialité.
  const translateSkill = (key) => {
    const translated = t(key);
    return typeof translated === 'string' && translated.trim() && translated !== key ? translated : (SKILL_KEY_TO_FR[key] || key);
  };

  // Libellé FR stocké (envoyé au backend) pour une clé de spécialité.
  const skillKeyToStored = (key) => SKILL_KEY_TO_FR[key] || key;

  // Mapping inverse libellé FR → clé i18n (pour traduire les chips déjà
  // sélectionnées, qui stockent le libellé FR).
  const SKILL_FR_TO_KEY = Object.fromEntries(
    Object.entries(SKILL_KEY_TO_FR).map(([key, fr]) => [fr, key])
  );

  // Un libellé FR stocké peut provenir d'une liste prédéfinie (traduite à
  // l'affichage) ou d'une compétence personnalisée : on affiche tel quel
  // si ce n'est pas une clé i18n.
  const displaySkill = (skill) => {
    if (SKILL_KEY_TO_FR[skill]) return translateSkill(skill);
    const key = SKILL_FR_TO_KEY[skill];
    if (key) return translateSkill(key);
    return skill;
  };

  const predefinedSkillsData = {
    mechanics: ['skillReparationMoteur', 'skillDiagnosticAuto', 'skillCarrosserie', 'skillElectriciteAuto', 'skillClimatisationAuto'],
    plumbing: ['skillInstallationSanitaire', 'skillReparationFuites', 'skillSoudure', 'skillDebouchage', 'skillChauffeEau'],
    electrical: ['skillInstallationElectrique', 'skillDepannageElectrique', 'skillCablage', 'skillTableauElectrique', 'skillEclairage'],
    construction: ['skillMaconnerie', 'skillCarrelage', 'skillPeinture', 'skillToiture', 'skillCoffrage'],
    carpentry: ['skillFabricationMeubles', 'skillPosePortes', 'skillPoseFenetres', 'skillMenuiserieAlu', 'skillMenuiserieBois', 'skillPlacards', 'skillCuisineSurMesure', 'skillEscaliersBois', 'skillFinitionVernissage', 'skillReparationMeubles'],
    computing: ['skillReparationPC', 'skillInstallationLogiciels', 'skillReseaux', 'skillMaintenance', 'skillFormation', 'skillReparationAndroid', 'skillReparationIphone', 'skillChangementEcran'],
    gardening: ['skillEntretienJardin', 'skillElagage', 'skillPlantation', 'skillArrosageAuto', 'skillPaysagisme'],
    tutoring: ['skillMathematiques', 'skillFrancais', 'skillAnglais', 'skillSciences', 'skillHistoireGeo', 'skillPhysiqueChimie', 'skillInformatiqueScolaire', 'skillAideDevoirs', 'skillPreparationExamens', 'skillSoutienScolaire']
  };

  const predefinedSkills = {};
  Object.keys(predefinedSkillsData).forEach((categoryKey) => {
    const translatedCategory = t(categoryKey);
    predefinedSkills[translatedCategory] = predefinedSkillsData[categoryKey];
  });

  const handleSpecialtyAdd = (skill) => {
    const currentSpecialties = formData.worker_specialties || [];
    if (!currentSpecialties.includes(skill)) {
      setFormData((prev) => ({
        ...prev,
        worker_specialties: [...currentSpecialties, skill]
      }));
    }
  };

  const handleSpecialtyRemove = (skill) => {
    const currentSpecialities = formData.worker_specialties || [];
    setFormData((prev) => ({
      ...prev,
      worker_specialties: currentSpecialities.filter((s) => s !== skill)
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
        <h3 className="text-lg font-semibold text-blue-900">{t('professionalInformationWorker')}</h3>
      </div>

      <div className="space-y-6">
        <div>
          <p className="block text-sm font-medium text-blue-900 mb-3">🔧 {t('skillsAndSpecialties')} *</p>

          {formData.worker_specialties && formData.worker_specialties.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-blue-700 mb-2">{t('selectedSkills')}</p>
              <div className="flex flex-wrap gap-2">
                {formData.worker_specialties.map((skill, index) => (
                  <span key={index} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    {displaySkill(skill)}
                    <button type="button" aria-label={`${t('remove')} ${displaySkill(skill)}`} onClick={() => handleSpecialtyRemove(skill)} className="ml-2 text-green-600 hover:text-green-800">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {Object.entries(predefinedSkills).map(([category, skills]) => (
              <div key={category} className="bg-white border border-blue-200 rounded-lg p-3">
                <h4 className="font-medium text-blue-800 mb-2">{category}</h4>
                <div className="flex flex-wrap gap-2">
                  {skills.map((skillKey) => {
                    const storedValue = skillKeyToStored(skillKey);
                    const isSelected = formData.worker_specialties?.includes(storedValue);
                    return (
                      <button
                        key={skillKey}
                        type="button"
                        onClick={() => (isSelected ? handleSpecialtyRemove(storedValue) : handleSpecialtyAdd(storedValue))}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${isSelected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-blue-100'}`}
                      >
                        {isSelected ? '✓ ' : ''}{translateSkill(skillKey)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3">
            {showSkillInput ? (
              <div className="flex gap-2">
                <label htmlFor="worker_custom_skill" className="sr-only">{t('addCustomSkill')}</label>
                <input
                  id="worker_custom_skill"
                  name="worker_custom_skill"
                  type="text"
                  autoComplete="off"
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  placeholder={t('customSkillPlaceholder')}
                  className="flex-1 px-3 py-2 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddCustomSkill()}
                />
                <button type="button" onClick={handleAddCustomSkill} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{t('add')}</button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSkillInput(false);
                    setNewSkill('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  {t('cancel')}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setShowSkillInput(true)} className="text-sm text-blue-600 hover:text-blue-700 flex items-center">+ {t('addCustomSkill')}</button>
            )}
          </div>

          {errors.worker_specialties && <p className="text-red-500 text-sm mt-1">{errors.worker_specialties}</p>}
        </div>

        <div>
          <label htmlFor="worker_experience_years" className="block text-sm font-medium text-blue-900 mb-2">📅 {t('yearsExperience')}</label>
          <select
            id="worker_experience_years"
            name="worker_experience_years"
            autoComplete="off"
            value={formData.worker_experience_years ?? ''}
            onChange={(e) => {
              const nextValue = e.target.value;
              setFormData((prev) => ({
                ...prev,
                worker_experience_years: nextValue === '' ? null : parseInt(nextValue, 10)
              }));
            }}
            className={`block w-full px-4 py-3 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.worker_experience_years ? 'border-red-300 focus:border-red-500' : 'border-blue-300 focus:border-blue-500'}`}
          >
            <option value="">{t('selectExperience')}</option>
            <option value="0">{t('beginner')}</option>
            <option value="1">{t('experience1to2')}</option>
            <option value="3">{t('experience3to5')}</option>
            <option value="6">{t('experience6to10')}</option>
            <option value="11">{t('experience11to15')}</option>
            <option value="16">{t('experience16to20')}</option>
            <option value="21">{t('experience20plus')}</option>
          </select>
          <p className="text-blue-700 text-xs mt-2">{t('canEditProfileLater')}</p>
          {errors.worker_experience_years && <p className="text-red-500 text-sm mt-1">{errors.worker_experience_years}</p>}
        </div>

        <div className="bg-blue-100 border border-blue-300 rounded-lg p-4">
          <div className="flex items-start">
            <span className="text-blue-500 text-lg mr-3">ℹ️</span>
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">{t('profileInfoNote')}</p>
              <ul className="text-xs space-y-1">
                <li>• {t('skillsHelpClientsFindYou')}</li>
                <li>• {t('experienceReassuresClients')}</li>
                <li>• {t('canEditProfileLater')}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkerRegistrationFields;
