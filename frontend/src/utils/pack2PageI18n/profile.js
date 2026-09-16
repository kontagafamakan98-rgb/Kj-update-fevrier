// Auto-généré depuis pack2PageI18n.js — dictionnaire du scope 'profile'.
import { createScopedTranslator } from './core';
const withBase = (base, overrides) => ({ ...base, ...overrides });
const dict = {
fr: {
  workerProfileSection: 'Profil travailleur',
  photoTitle: 'Photo de profil',
  firstName: 'Prénom',
  lastName: 'Nom',
  country: 'Pays',
  professionalInfo: 'Informations professionnelles',
  bio: 'Biographie professionnelle',
  bioPlaceholder: 'Décrivez votre expérience, vos qualifications et ce qui vous distingue...',
  bioHelp: 'Une bonne biographie attire plus de clients',
  skills: 'Compétences',
  skillsPlaceholder: 'Ex: Plomberie, Électricité, Peinture...',
  skillsHelp: 'Appuyez sur Entrée (ou sur Ajouter) pour ajouter une compétence. Maximum 20.',
  specialties: 'Spécialités',
  yearsExperience: 'Années d\'expérience',
  years: '{count} ans',
  availability: 'Disponibilité',
  descriptionOptional: 'Description (optionnelle)',
  descriptionPlaceholder: 'Parlez de vos compétences et expérience...',
  availableForProjects: 'Je suis disponible pour de nouveaux projets',
  createWorkerProfileHelp: 'Créez votre profil travailleur pour recevoir des propositions d\'emploi.',
  createWorkerProfile: 'Créer le profil travailleur',
  add: 'Ajouter',
  specialtyPlaceholder: 'Ex: Plomberie, Électricité...',
  save: 'Enregistrer',
  cancel: 'Annuler',
  description: 'Description'
},
en: {
  workerProfileSection: 'Worker profile',
  photoTitle: 'Profile photo',
  firstName: 'First name',
  lastName: 'Last name',
  country: 'Country',
  professionalInfo: 'Professional information',
  bio: 'Professional bio',
  bioPlaceholder: 'Describe your experience, qualifications and what makes you stand out...',
  bioHelp: 'A good bio attracts more clients',
  skills: 'Skills',
  skillsPlaceholder: 'Example: Plumbing, Electrical, Painting...',
  skillsHelp: 'Press Enter (or click Add) to add a skill. Max 20.',
  specialties: 'Specialties',
  yearsExperience: 'Years of experience',
  years: '{count} years',
  availability: 'Availability',
  descriptionOptional: 'Description (optional)',
  descriptionPlaceholder: 'Talk about your skills and experience...',
  availableForProjects: 'I am available for new projects',
  createWorkerProfileHelp: 'Create your worker profile to receive job proposals.',
  createWorkerProfile: 'Create worker profile',
  add: 'Add',
  specialtyPlaceholder: 'Example: Plumbing, Electrical...',
  save: 'Save',
  cancel: 'Cancel',
  description: 'Description'
}
};
dict.wo = withBase(dict.fr, {
workerProfileSection: 'Profil liggéeykat',
  photoTitle: 'Nataalu profil',
  professionalInfo: 'Xibaar yu jëm ci liggéey',
  bio: 'Bio bu liggéey',
  skills: 'Mën-mën',
  availability: 'Jàppandikoo',
  createWorkerProfile: 'Sos profil bu liggéeykat'
});
dict.bm = withBase(dict.fr, {
workerProfileSection: 'Baarakɛla profil',
  photoTitle: 'Profil foto',
  professionalInfo: 'Baara kibaru',
  bio: 'Baara ko fɔli',
  skills: 'Se ka kɛw',
  availability: 'A bɛ se',
  createWorkerProfile: 'Baarakɛla profil da'
});
dict.mos = withBase(dict.fr, {
workerProfileSection: 'Tʋʋm-neda profil',
  photoTitle: 'Profil pɩture',
  professionalInfo: 'Tʋʋm kibare',
  bio: 'Tʋʋm goama',
  skills: 'Minimã',
  availability: 'Beoogre',
  createWorkerProfile: 'Ning tʋʋm-neda profil'
});

export const makeScopedTranslator = (currentLanguage, fallbackT) =>
  createScopedTranslator(dict, currentLanguage, fallbackT);
