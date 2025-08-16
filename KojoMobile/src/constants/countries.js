export const COUNTRIES = {
  MALI: {
    code: 'mali',
    name: 'Mali',
    nameFrench: 'Mali',
    nameLocal: 'Mali',
    flag: '🇲🇱',
    currency: 'XOF',
    languages: ['fr', 'bm'],
    primaryColor: '#009639',
    flagUrl: 'https://flagcdn.com/w320/ml.png'
  },
  SENEGAL: {
    code: 'senegal',
    name: 'Senegal',
    nameFrench: 'Sénégal',
    nameLocal: 'Sénégal',
    flag: '🇸🇳',
    currency: 'XOF',
    languages: ['fr', 'wo'],
    primaryColor: '#00853f',
    flagUrl: 'https://flagcdn.com/w320/sn.png'
  },
  BURKINA_FASO: {
    code: 'burkina_faso',
    name: 'Burkina Faso',
    nameFrench: 'Burkina Faso',
    nameLocal: 'Burkina Faso',
    flag: '🇧🇫',
    currency: 'XOF',
    languages: ['fr'],
    primaryColor: '#009639',
    flagUrl: 'https://flagcdn.com/w320/bf.png'
  },
  IVORY_COAST: {
    code: 'ivory_coast',
    name: 'Ivory Coast',
    nameFrench: 'Côte d\'Ivoire',
    nameLocal: 'Côte d\'Ivoire',
    flag: '🇨🇮',
    currency: 'XOF',
    languages: ['fr'],
    primaryColor: '#ff8200',
    flagUrl: 'https://flagcdn.com/w320/ci.png'
  }
};

export const getCountryByCode = (code) => {
  return Object.values(COUNTRIES).find(country => country.code === code);
};

export const getCountriesList = () => {
  return Object.values(COUNTRIES);
};