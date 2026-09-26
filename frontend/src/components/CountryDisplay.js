import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { normalizeCountryCode } from '../utils/countryAliases';
import FlagIcon from './FlagIcon';
// Le référentiel vit dans src/config/countries.js : le build (vite.config.js)
// le lit AUSSI pour écrire la coquille pré-rendue de l'accueil. C'est ce qui
// empêche un pays d'exister pour React et pas pour un crawler sans JavaScript.
import { COUNTRIES as COUNTRY_LIST } from '../config/countries';
import { COUNTRY_PLACEHOLDER } from '../config/country-placeholder';

// Carte indexée par code canonique : `getCountry()` normalise un code (alias,
// ISO, ancien nom) puis cherche ici. DÉRIVÉE de la liste partagée, jamais une
// seconde déclaration.
export const COUNTRIES = Object.fromEntries(
  COUNTRY_LIST.map((country) => [country.code, country])
);

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
  return value
    .replace(/^(?:[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic})(?:\uFE0F)?\s*/u, '')
    .replace(/^(ML|SN|BF|CI)\s+/i, '')
    .trim();
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
      {showFlag && <FlagIcon country={country.code} className="w-5 h-4" showEmoji={false} />}
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
  required = false,
  placeholder,
  searchable = true
}) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef(null);

  const countries = useMemo(() => getAllCountries(), []);
  const activeCountry = getCountry(value);
  const resolvedPlaceholder = placeholder || COUNTRY_PLACEHOLDER(t('country'));

  const filteredCountries = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return countries;

    return countries.filter((country) => {
      const label = getTranslatedCountryName(country, t).toLowerCase();
      const code = String(country.code || '').toLowerCase();
      const iso = String(country.iso || '').toLowerCase();
      return label.includes(query) || code.includes(query) || iso.includes(query);
    });
  }, [countries, searchTerm, t]);

  // Fermer en appuyant dehors : un écouteur sur `document` — jamais une surface
  // plein écran, qui capturerait l'appui au lieu de le laisser atteindre sa
  // cible — et SEULEMENT tant que la liste est ouverte (elle seule a quelque
  // chose à fermer). Enregistré en permanence (`[]`), il faisait tourner ce
  // contrôle à CHAQUE appui de la page sur /register et /profile, où le
  // composant est monté, pour ne jamais rien fermer : la condition d'entrée
  // donnait déjà le comportement voulu, elle ne dispensait pas du travail.
  // « Dedans » se lit sur le conteneur du composant, donc l'appui sur le
  // déclencheur ou dans la liste ne ferme pas ici — le `click` qui suit le
  // ROUVRIRAIT ou n'atteindrait plus son option.
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setHighlightedIndex(-1);
      return;
    }

    const selectedIndex = filteredCountries.findIndex((country) => country.code === value);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : (filteredCountries.length ? 0 : -1));
  }, [isOpen, value, filteredCountries]);

  const emitChange = (countryCode) => {
    onChange?.({ target: { name, value: countryCode } });
    setIsOpen(false);
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsOpen(true);
    }
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev < filteredCountries.length - 1 ? prev + 1 : 0));
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredCountries.length - 1));
    }

    if (event.key === 'Enter' && highlightedIndex >= 0 && filteredCountries[highlightedIndex]) {
      event.preventDefault();
      emitChange(filteredCountries[highlightedIndex].code);
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        className="w-full flex items-center justify-between px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-left"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-required={required}
      >
        <span className="flex items-center gap-3 min-w-0">
          {activeCountry ? <FlagIcon country={activeCountry.code} className="w-6 h-4" showEmoji={false} /> : <span className="text-lg leading-none">🌍</span>}
          <span className={`truncate ${activeCountry ? 'text-gray-900' : 'text-gray-400'}`}>
            {activeCountry ? getTranslatedCountryName(activeCountry, t) : resolvedPlaceholder}
          </span>
        </span>
        <span className={`text-xs text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
      </button>

      <input type="hidden" name={name} value={value || ''} required={required} />

      {isOpen && (
        <div className="absolute z-30 mt-2 w-full bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
          {searchable && (
            <div className="p-3 border-b border-gray-100 bg-gray-50">
              <input
                id={`${id}-search`}
                name={`${name || 'country'}_search`}
                type="text"
                autoComplete="off"
                aria-label={t('searchCountry')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('searchCountry')}
                autoFocus
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>
          )}

          <div className="max-h-64 overflow-y-auto" role="listbox" aria-labelledby={id}>
            {filteredCountries.length > 0 ? filteredCountries.map((country, index) => {
              const isSelected = value === country.code;
              const isHighlighted = index === highlightedIndex;
              return (
                <button
                  key={country.code}
                  type="button"
                  onClick={() => emitChange(country.code)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                    isSelected ? 'bg-orange-50 text-orange-700' : isHighlighted ? 'bg-gray-100 text-gray-900' : 'hover:bg-gray-50 text-gray-800'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <FlagIcon country={country.code} className="w-6 h-4" showEmoji={false} />
                    <span className="truncate">{getTranslatedCountryName(country, t)}</span>
                  </span>
                  {isSelected && <span className="text-sm font-semibold">✓</span>}
                </button>
              );
            }) : (
              <div className="px-4 py-3 text-sm text-gray-500">{t('noCountryFound')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
