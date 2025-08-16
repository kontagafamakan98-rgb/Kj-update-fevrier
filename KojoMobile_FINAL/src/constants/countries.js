export const COUNTRIES = {
  MALI: {
    code: 'mali',
    name: 'Mali',
    nameFrench: 'Mali',
    flag: '🇲🇱',
    color: '#009639',
    phonePrefix: '+223',
    currency: 'XOF',
    language: 'fr'
  },
  SENEGAL: {
    code: 'senegal',
    name: 'Senegal',
    nameFrench: 'Sénégal',
    flag: '🇸🇳',
    color: '#00853f',
    phonePrefix: '+221',
    currency: 'XOF',
    language: 'fr'
  },
  BURKINA_FASO: {
    code: 'burkina_faso',
    name: 'Burkina Faso',
    nameFrench: 'Burkina Faso',
    flag: '🇧🇫',
    color: '#009639',
    phonePrefix: '+226',
    currency: 'XOF',
    language: 'fr'
  },
  COTE_DIVOIRE: {
    code: 'cote_divoire',
    name: 'Ivory Coast',
    nameFrench: 'Côte d\'Ivoire',
    flag: '🇨🇮',
    color: '#ff8200',
    phonePrefix: '+225',
    currency: 'XOF',
    language: 'fr'
  }
};

export const getCountriesList = () => {
  return Object.values(COUNTRIES);
};

export const getCountryByCode = (code) => {
  const upperCode = code?.toUpperCase();
  return Object.values(COUNTRIES).find(country => 
    country.code === code || country.code === upperCode
  ) || COUNTRIES.MALI;
};

export const getPhonePrefixByCountry = (countryCode) => {
  const country = getCountryByCode(countryCode);
  return country.phonePrefix;
};

export const detectCountryFromPhone = (phoneNumber) => {
  if (!phoneNumber) return null;
  
  const cleanPhone = phoneNumber.replace(/\s+/g, '');
  
  for (const country of Object.values(COUNTRIES)) {
    if (cleanPhone.startsWith(country.phonePrefix)) {
      return country;
    }
  }
  return null;
};

export const formatPhoneNumber = (phone, countryCode) => {
  if (!phone) return '';
  
  const country = getCountryByCode(countryCode);
  const cleanPhone = phone.replace(/[^\d]/g, '');
  
  // Si le numéro commence déjà par le préfixe, on le retourne tel quel
  if (phone.startsWith(country.phonePrefix)) {
    return phone;
  }
  
  // Si le numéro commence par 0, on le remplace par le préfixe
  if (cleanPhone.startsWith('0')) {
    return country.phonePrefix + ' ' + cleanPhone.substring(1);
  }
  
  // Sinon on ajoute juste le préfixe
  return country.phonePrefix + ' ' + cleanPhone;
};