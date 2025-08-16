import React from 'react';

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

// Get country by code
export const getCountry = (countryCode) => {
  return COUNTRIES[countryCode] || null;
};

// Get all countries as array
export const getAllCountries = () => {
  return Object.values(COUNTRIES);
};

// Component to display country with flag
export default function CountryDisplay({ 
  countryCode, 
  showFlag = true, 
  showName = true,
  className = "",
  flagSize = "text-base"
}) {
  const country = getCountry(countryCode);
  
  if (!country) {
    return <span className={className}>Pays inconnu</span>;
  }

  return (
    <span className={`flex items-center space-x-2 ${className}`}>
      {showFlag && (
        <span className={flagSize}>{country.flag}</span>
      )}
      {showName && (
        <span>{country.name}</span>
      )}
    </span>
  );
}

// Component for country selection in forms
export function CountrySelect({ 
  value, 
  onChange, 
  name = "country",
  id = "country",
  className = "",
  required = false 
}) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={onChange}
      required={required}
      className={`appearance-none block w-full px-4 py-3 pr-10 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900 ${className}`}
    >
      {getAllCountries().map(country => (
        <option key={country.code} value={country.code}>
          {country.fullName}
        </option>
      ))}
    </select>
  );
}