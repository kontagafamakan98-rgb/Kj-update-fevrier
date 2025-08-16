export const COUNTRIES = {
  MALI: {
    code: 'mali',
    name: 'Mali',
    nameFrench: 'Mali',
    flag: '🇲🇱',
    currency: 'XOF',
    color: '#22c55e'
  },
  SENEGAL: {
    code: 'senegal', 
    name: 'Senegal',
    nameFrench: 'Sénégal',
    flag: '🇸🇳',
    currency: 'XOF',
    color: '#eab308'
  },
  BURKINA_FASO: {
    code: 'burkina_faso',
    name: 'Burkina Faso', 
    nameFrench: 'Burkina Faso',
    flag: '🇧🇫',
    currency: 'XOF',
    color: '#ef4444'
  },
  IVORY_COAST: {
    code: 'ivory_coast',
    name: 'Ivory Coast',
    nameFrench: 'Côte d\'Ivoire', 
    flag: '🇨🇮',
    currency: 'XOF',
    color: '#f97316'
  }
};

export const getCountryByCode = (code) => {
  return Object.values(COUNTRIES).find(country => country.code === code);
};

export const getCountriesList = () => {
  return Object.values(COUNTRIES);
};