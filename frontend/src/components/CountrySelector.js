import { useState, useRef, useEffect } from 'react';
import { useCountry } from '../contexts/CountryContext';
import { useLanguage } from '../contexts/LanguageContext';

/**
 * CountrySelector
 * Sélecteur de pays compact pour la Navbar.
 * Affiche le drapeau + nom court du pays actuel, ouvre un dropdown
 * avec les 4 pays disponibles. Owner : lecture seule (tous les pays).
 */
export default function CountrySelector({ className = '' }) {
  const { currentCountry, currentCountryDetails, availableCountries, changeUserCountry, isOwner } = useCountry();
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  // Fermer en cliquant dehors
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        buttonRef.current && !buttonRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Fermer avec Échap
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  const handleSelect = async (countryId) => {
    if (countryId === currentCountry || isOwner) return;
    setSaving(true);
    setIsOpen(false);
    const success = await changeUserCountry(countryId);
    setSaving(false);
    if (success) {
      // Recharger pour que le filtre pays des jobs soit immédiatement appliqué
      window.location.reload();
    }
  };

  // Owner : affichage sans interaction
  if (isOwner) {
    return (
      <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm text-gray-500 ${className}`} title="Owner : accès tous pays">
        <span>🌍</span>
        <span className="hidden lg:inline text-xs">Tous pays</span>
      </div>
    );
  }

  const shortName = (country) => {
    const names = {
      senegal: 'Sénégal',
      mali: 'Mali',
      cote_divoire: "Côte d'Ivoire",
      burkina_faso: 'Burkina',
    };
    return names[country?.id] || country?.name || '';
  };

  return (
    <div className={`relative ${className}`}>
      {/* Bouton déclencheur */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((v) => !v)}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Pays actuel : ${currentCountryDetails?.name || currentCountry}. Cliquer pour changer.`}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-gray-200 bg-white hover:border-orange-400 hover:bg-orange-50 text-sm text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-60"
      >
        {saving ? (
          <span className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className="text-base leading-none" aria-hidden="true">
            {currentCountryDetails?.flag || '🌍'}
          </span>
        )}
        <span className="hidden lg:inline font-medium text-xs">
          {shortName(currentCountryDetails)}
        </span>
        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <ul
          ref={dropdownRef}
          role="listbox"
          aria-label="Choisir un pays"
          className="absolute right-0 mt-2 w-52 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden py-1"
        >
          <li className="px-3 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            Votre pays
          </li>
          {availableCountries.map((country) => {
            const isSelected = country.id === currentCountry;
            return (
              <li
                key={country.id}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(country.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelect(country.id); }}
                tabIndex={0}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors text-sm
                  ${isSelected
                    ? 'bg-orange-50 text-orange-700 font-semibold'
                    : 'text-gray-700 hover:bg-gray-50'
                  }`}
              >
                <span className="text-lg leading-none">{country.flag}</span>
                <span className="flex-1">{country.name}</span>
                {isSelected && (
                  <svg className="w-4 h-4 text-orange-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
