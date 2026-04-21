import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { normalizeCountryCode } from '../utils/countryAliases';

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
  }
};

export const getCountry = (countryCode) => {
  if (!countryCode) return null;
  const normalized = normalizeCountryCode(countryCode);
  return COUNTRIES[normalized] || null;
};

export const getAllCountries = () => {
  const canonicalCodes = new Set();

  return Object.values(COUNTRIES).filter((country) => {
    const canonicalCode = getCountry(country.code)?.code || country.code;

    if (canonicalCodes.has(canonicalCode)) {
      return false;
    }

    canonicalCodes.add(canonicalCode);
    return true;
  });
};

const COUNTRY_TRANSLATION_KEYS = {
  mali: 'mali',
  senegal: 'senegal',
  burkina_faso: 'burkina_faso',
  ivory_coast: 'ivory_coast'
};

const stripLeadingFlag = (value) => {
  if (typeof value !== 'string') return '';
  return value.replace(/^\p{Extended_Pictographic}\s*/u, '').trim();
};

const getTranslatedCountryName = (country, t) => {
  const translationKey = COUNTRY_TRANSLATION_KEYS[country.code] || country.code;
  const translated = t(translationKey);
  if (typeof translated === 'string' && translated.trim() && translated !== translationKey) {
    return stripLeadingFlag(translated);
  }
  return country.name;
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

  const translatedName = getTranslatedCountryName(country, t);

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
          {getTranslatedCountryName(country, t)}
        </option>
      ))}
    </select>
  );
}
