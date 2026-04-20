import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

// Country data with flags and proper names
export const COUNTRIES = {
  mali: {
    code: 'mali',
    name: 'Mali',
    flag: '🇲🇱',
    fullName: '🇲🇱 Mali',
    iso: 'ML'
  },
  senegal: {
    code: 'senegal',
    name: 'Sénégal',
    flag: '🇸🇳',
    fullName: '🇸🇳 Sénégal',
    iso: 'SN'
  },
  burkina_faso: {
    code: 'burkina_faso',
    name: 'Burkina Faso',
    flag: '🇧🇫',
    fullName: '🇧🇫 Burkina Faso',
    iso: 'BF'
  },
  ivory_coast: {
    code: 'ivory_coast',
    name: 'Côte d\'Ivoire',
    flag: '🇨🇮',
    fullName: '🇨🇮 Côte d\'Ivoire',
    iso: 'CI'
  },
  cote_divoire: {
    code: 'cote_divoire',
    name: 'Côte d\'Ivoire',
    flag: '🇨🇮',
    fullName: '🇨🇮 Côte d\'Ivoire',
    iso: 'CI'
  }
};

export const getCountry = (countryCode) => {
  if (!countryCode) return null;
  const normalized = String(countryCode).toLowerCase();
  const alias = normalized === 'cote_divoire' ? 'ivory_coast' : normalized;
  return COUNTRIES[alias] || COUNTRIES[normalized] || null;
};

export const getAllCountries = () => {
  return Object.values(COUNTRIES);
};

const getTranslatedCountryLabel = (country, t) => {
  const translated = t(country.code);
  return typeof translated === 'string' ? translated : country.fullName;
};

export default function CountryDisplay({
  countryCode,
  showFlag = true,
  showName = true,
  className = '',
  flagSize = 'text-base'
}) {
  const { t } = useLanguage();
  const country = getCountry(countryCode);

  if (!country) {
    return <span className={className}>{t('unknownCountry')}</span>;
  }

  const translatedLabel = getTranslatedCountryLabel(country, t);
  const translatedName = translatedLabel.replace(/^\S+\s+/, '').trim() || country.name;

  return (
    <span className={`flex items-center space-x-2 ${className}`}>
      {showFlag && <span className={flagSize}>{country.flag}</span>}
      {showName && <span>{translatedName}</span>}
    </span>
  );
}

export function CountrySelect({
  value,
  onChange,
  name = 'country',
  id = 'country',
  className = '',
  required = false
}) {
  const { t } = useLanguage();

  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={onChange}
      required={required}
      className={`appearance-none block w-full px-4 py-3 pr-10 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900 ${className}`}
    >
      {getAllCountries().map((country) => (
        <option key={country.code} value={country.code}>
          {getTranslatedCountryLabel(country, t)}
        </option>
      ))}
    </select>
  );
}
