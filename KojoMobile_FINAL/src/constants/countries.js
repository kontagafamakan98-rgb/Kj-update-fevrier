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

export const getCountryByCode = (code) => {
  return Object.values(COUNTRIES).find(country => country.code === code);
};

export const getCountriesList = () => {
  return Object.values(COUNTRIES);
};