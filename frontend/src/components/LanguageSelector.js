import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const LANGUAGES = [
  {
    code: 'fr',
    name: 'Français',
    flag: '🇫🇷',
    nativeName: 'Français'
  },
  {
    code: 'en',
    name: 'English',
    flag: '🇬🇧',
    nativeName: 'English'
  },
  {
    code: 'wo',
    name: 'Wolof',
    flag: '🇸🇳',
    nativeName: 'Wolof'
  },
  {
    code: 'bm',
    name: 'Bambara',
    flag: '🇲🇱',
    nativeName: 'Bamanankan'
  },
  {
    code: 'mos',
    name: 'Mooré',
    flag: '🇧🇫',
    nativeName: 'Mòoré'
  }
];

const LanguageSelector = ({ 
  showDropdown = true, 
  showFlags = true,
  className = "",
  buttonClassName = "",
  dropdownClassName = ""
}) => {
  const { currentLanguage, changeLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);

  const currentLang = LANGUAGES.find(lang => lang.code === currentLanguage) || LANGUAGES[0];

  const handleLanguageChange = (langCode) => {
    changeLanguage(langCode);
    setIsOpen(false);
  };

  if (showDropdown) {
    return (
      <div className={`relative ${className}`}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`
            flex items-center space-x-2 px-3 py-2 rounded-lg border border-gray-300 
            bg-white hover:bg-gray-50 transition-colors ${buttonClassName}
          `}
        >
          {showFlags && <span>{currentLang.flag}</span>}
          <span className="text-sm font-medium">{currentLang.nativeName}</span>
          <svg 
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <>
            {/* Overlay pour fermer le dropdown */}
            <div 
              className="fixed inset-0 z-10"
              onClick={() => setIsOpen(false)}
            ></div>
            
            <div className={`
              absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-20
              ${dropdownClassName}
            `}>
              <div className="py-1">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => handleLanguageChange(lang.code)}
                    className={`
                      w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center space-x-3
                      ${currentLanguage === lang.code ? 'bg-orange-50 text-orange-600' : 'text-gray-700'}
                    `}
                  >
                    {showFlags && <span>{lang.flag}</span>}
                    <div>
                      <div className="font-medium">{lang.nativeName}</div>
                      <div className="text-xs text-gray-500">{lang.name}</div>
                    </div>
                    {currentLanguage === lang.code && (
                      <span className="ml-auto text-orange-600">✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Version simple avec boutons inline
  return (
    <div className={`flex space-x-1 ${className}`}>
      {LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          onClick={() => handleLanguageChange(lang.code)}
          className={`
            px-3 py-1 rounded-md text-sm font-medium transition-colors
            ${currentLanguage === lang.code
              ? 'bg-orange-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }
          `}
        >
          {showFlags ? `${lang.flag} ${lang.code.toUpperCase()}` : lang.code.toUpperCase()}
        </button>
      ))}
    </div>
  );
};

export default LanguageSelector;