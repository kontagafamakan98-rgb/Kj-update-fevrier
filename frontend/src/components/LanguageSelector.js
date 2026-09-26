import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { LANGUAGES } from '../config/languages';
import FlagIcon from './FlagIcon';

const LanguageSelector = ({ 
  showDropdown = true, 
  showFlags = true,
  className = "",
  buttonClassName = "",
  dropdownClassName = ""
}) => {
  const { currentLanguage, changeLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const conteneurRef = useRef(null);

  const currentLang = LANGUAGES.find(lang => lang.code === currentLanguage) || LANGUAGES[0];

  // ── Fermer en appuyant dehors — SANS avaler l'appui ──────────────────────
  // Ce menu s'ouvre DANS la barre de navigation, à côté de ses autres
  // commandes. La fermeture se faisait par une surface plein écran
  // (`fixed inset-0 z-10`) posée au-dessus d'elles : MESURÉ (Chromium, 25/09/2026),
  // elle intercepte l'appui — Playwright a retenté 55 fois le clic sur le lien
  // « Emplois » de la même barre, chaque fois arrêté par ce `<div>`. Autrement
  // dit, tant que le menu de langue était ouvert, le PREMIER appui sur
  // n'importe quelle commande de la barre — lien, cloche de notifications, mot
  // de passe oublié, déconnexion — était perdu : il ne fermait le menu que pour
  // lui-même. C'est le même défaut de fond que le panneau de notifications, par
  // un autre chemin : un appui visant une commande n'atteint pas cette commande.
  //
  // L'écouteur sur `document` ne capture rien : l'appui continue vers sa cible,
  // et celle-ci agit (le menu se ferme par effet de bord, comme le ferait un
  // menu natif du navigateur). « Dedans » se lit sur le conteneur du composant,
  // donc le déclencheur et la liste sont tous deux exclus — un appui sur le
  // déclencheur ne doit pas fermer ici, sinon le `click` qui suit le
  // ROUVRIRAIT.
  useEffect(() => {
    if (!isOpen) return;
    const fermerSiDehors = (e) => {
      if (conteneurRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', fermerSiDehors);
    document.addEventListener('touchstart', fermerSiDehors);
    return () => {
      document.removeEventListener('mousedown', fermerSiDehors);
      document.removeEventListener('touchstart', fermerSiDehors);
    };
  }, [isOpen]);

  const handleLanguageChange = (langCode) => {
    changeLanguage(langCode);
    setIsOpen(false);
  };

  if (showDropdown) {
    return (
      <div ref={conteneurRef} className={`relative ${className}`}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`
            flex items-center space-x-2 px-3 py-2 rounded-lg border border-gray-300 
            bg-white hover:bg-gray-50 transition-colors ${buttonClassName}
          `}
        >
          {showFlags && <FlagIcon country={currentLang.code} className="w-5 h-4" showEmoji={false} />}
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
                  {showFlags && <FlagIcon country={lang.code} className="w-5 h-4" showEmoji={false} />}
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
          <span className="inline-flex items-center gap-2">
            {showFlags && <FlagIcon country={lang.code} className="w-5 h-4" showEmoji={false} />}
            <span>{lang.code.toUpperCase()}</span>
          </span>
        </button>
      ))}
    </div>
  );
};

export default LanguageSelector;