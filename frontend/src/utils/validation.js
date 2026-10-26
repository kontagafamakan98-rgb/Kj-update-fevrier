/**
 * Client-side validation utilities for Kojo application
 * Provides consistent validation across all forms
 */

export const ValidationRules = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    message: 'Adresse email invalide'
  },
  
  password: {
    // Aligné sur le backend (kojo_models : min_length=8) pour éviter qu'un
    // mot de passe accepté côté client soit refusé côté serveur.
    minLength: 8,
    pattern: /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/,
    message: 'Le mot de passe doit contenir au moins 8 caractères avec des lettres et des chiffres'
  },
  
  phone: {
    pattern: /^\+[1-9]\d{1,14}$/,
    message: 'Numéro de téléphone invalide (format international requis)'
  },
  
  name: {
    minLength: 2,
    // Le NOM COMPLET (26/10/2026) : le formulaire ne demande plus deux champs
    // (prénom + nom), donc la borne haute couvre les deux — 50 caractères
    // n'étaient déjà pas assez pour certains noms composés d'Afrique de
    // l'Ouest. Le serveur tronque chaque partie à 50
    // (`kojo_models._noms_resolus`).
    maxLength: 101,
    pattern: /^[a-zA-ZÀ-ÿ\s\-']+$/,
    message: 'Le nom doit contenir entre 2 et 101 caractères (lettres uniquement)'
  },

};

/**
 * Validates an email address
 */
export function validateEmail(email) {
  if (!email || email.trim() === '') {
    return { isValid: false, message: 'Email requis' };
  }
  
  if (!ValidationRules.email.pattern.test(email)) {
    return { isValid: false, message: ValidationRules.email.message };
  }
  
  return { isValid: true };
}

/**
 * Validates a password
 */
export function validatePassword(password) {
  if (!password || password.length === 0) {
    return { isValid: false, message: 'Mot de passe requis' };
  }
  
  if (password.length < ValidationRules.password.minLength) {
    return { isValid: false, message: `Le mot de passe doit contenir au moins ${ValidationRules.password.minLength} caractères` };
  }
  
  return { isValid: true };
}

/**
 * Validates password confirmation
 */
export function validatePasswordConfirmation(password, confirmPassword) {
  if (password !== confirmPassword) {
    return { isValid: false, message: 'Les mots de passe ne correspondent pas' };
  }
  
  return { isValid: true };
}

/**
 * Validates a name (first name or last name)
 */
export function validateName(name, fieldName = 'nom') {
  if (!name || name.trim() === '') {
    return { isValid: false, message: `${fieldName} requis` };
  }
  
  const trimmedName = name.trim();
  
  if (trimmedName.length < ValidationRules.name.minLength) {
    return { isValid: false, message: `${fieldName} doit contenir au moins ${ValidationRules.name.minLength} caractères` };
  }
  
  if (trimmedName.length > ValidationRules.name.maxLength) {
    return { isValid: false, message: `${fieldName} ne peut pas dépasser ${ValidationRules.name.maxLength} caractères` };
  }
  
  if (!ValidationRules.name.pattern.test(trimmedName)) {
    return { isValid: false, message: `${fieldName} ne peut contenir que des lettres, espaces, tirets et apostrophes` };
  }
  
  return { isValid: true };
}

/**
 * Validates phone number
 */
export function validatePhone(phone) {
  if (!phone || phone.trim() === '') {
    return { isValid: false, message: 'Numéro de téléphone requis' };
  }
  
  // Remove spaces and formatting
  const cleanPhone = phone.replace(/\s+/g, '');
  
  if (!ValidationRules.phone.pattern.test(cleanPhone)) {
    return { isValid: false, message: ValidationRules.phone.message };
  }
  
  return { isValid: true };
}

/**
 * Validates hourly rate for workers
 */  

/**
 * Validates worker specialties
 */
export function validateWorkerSpecialties(specialties) {
  if (!specialties || !Array.isArray(specialties) || specialties.length === 0) {
    return { isValid: false, message: 'Au moins une compétence doit être sélectionnée' };
  }
  
  return { isValid: true };
}

/**
 * Validates worker experience years
 */
export function validateExperienceYears(years) {
  if (years === null || typeof years === "undefined" || years === '') {
    return { isValid: true };
  }
  
  const numericYears = parseInt(years, 10);
  
  if (isNaN(numericYears) || numericYears < 0 || numericYears > 50) {
    return { isValid: false, message: 'Les années d’expérience doivent être entre 0 et 50' };
  }
  
  return { isValid: true };
}

/**
 * Comprehensive form validation
 */
export function validateRegistrationForm(formData) {
  const errors = {};
  
  // Email validation
  const emailResult = validateEmail(formData.email);
  if (!emailResult.isValid) {
    errors.email = emailResult.message;
  }
  
  // Password validation
  const passwordResult = validatePassword(formData.password);
  if (!passwordResult.isValid) {
    errors.password = passwordResult.message;
  }
  
  // Pas de confirmation de mot de passe : le champ a été retiré de
  // l'inscription (26/10/2026) — une seconde saisie du MÊME mot de passe ne
  // prouve rien de plus que la première, et elle coûtait un champ obligatoire.

  // Le NOM, en un champ : le serveur le répartit en prénom/nom.
  const nameResult = validateName(formData.name, 'Nom complet');
  if (!nameResult.isValid) {
    errors.name = nameResult.message;
  }

  // Le TÉLÉPHONE est FACULTATIF : vide n'est pas une erreur, un numéro
  // renseigné l'est s'il est illisible.
  if (formData.phone && formData.phone.trim() !== '') {
    const phoneResult = validatePhone(formData.phone);
    if (!phoneResult.isValid) {
      errors.phone = phoneResult.message;
    }
  }
  
  // Worker-specific validation
  if (formData.user_type === 'worker') {
    const specialtiesResult = validateWorkerSpecialties(formData.worker_specialties);
    if (!specialtiesResult.isValid) {
      errors.worker_specialties = specialtiesResult.message;
    }
    
    const experienceResult = validateExperienceYears(formData.worker_experience_years);
    if (!experienceResult.isValid) {
      errors.worker_experience_years = experienceResult.message;
    }

  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}