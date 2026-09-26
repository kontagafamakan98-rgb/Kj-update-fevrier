import { useState, useRef, useEffect } from 'react';
import { useCountry } from '../contexts/CountryContext';
import { useLanguage } from '../contexts/LanguageContext';
import FlagIcon from './FlagIcon';

const COUNTRIES = [
  { id: 'senegal',      name: 'Sénégal' },
  { id: 'mali',         name: 'Mali' },
  { id: 'cote_divoire', name: "Côte d’Ivoire" },
  { id: 'burkina_faso', name: 'Burkina Faso' },
];

export default function CountrySelector({ className = '' }) {
  const { currentCountry, changeUserCountry, isOwner } = useCountry();
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving]  = useState(false);
  const wrapperRef           = useRef(null);

  const current = COUNTRIES.find(c => c.id === currentCountry) || COUNTRIES[0];

  // Fermer en appuyant dehors — par un écouteur sur `document`, et par LUI SEUL.
  //
  // Une surface plein écran (`fixed inset-0 z-10`) faisait le même travail, et
  // elle CAPTURAIT l'appui : tant que le menu était ouvert, le premier appui sur
  // la page — un filtre, une bascule liste/carte, une carte de mission —
  // n'atteignait pas sa cible, il ne fermait le menu que pour lui-même. Même
  // défaut de fond que le panneau de notifications : un appui visant une
  // commande doit atteindre cette commande. Un écouteur ne capture rien :
  // l'appui poursuit vers sa cible, et le menu se ferme par effet de bord — le
  // comportement d'un menu natif du navigateur. « Dedans » se lit sur le
  // conteneur du composant (le déclencheur et la liste y sont tous deux), donc
  // un appui sur le déclencheur ne ferme pas ici : le `click` qui suit le
  // ROUVRIRAIT (c'est le second défaut que cette lecture évite).
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
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
    if (countryId === currentCountry) { setIsOpen(false); return; }
    setSaving(true);
    setIsOpen(false);
    // changeUserCountry met déjà à jour le contexte (loadUser) — un
    // window.location.reload() écraserait tout l'état React (notifications,
    // navigation) inutilement.
    await changeUserCountry(countryId);
    setSaving(false);
  };

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      {/* Bouton déclencheur — même style que LanguageSelector */}
      <button
        onClick={() => !isOwner && setIsOpen(v => !v)}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex items-center space-x-2 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-60"
      >
        {saving ? (
          <span className="w-5 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin inline-block" />
        ) : (
          <FlagIcon country={current.id} className="w-5 h-4" showEmoji={false} />
        )}
        <span className="text-sm font-medium">{isOwner ? t('allCountries') : current.name}</span>
        {!isOwner && (
          <svg
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Dropdown — même structure que LanguageSelector */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
          <div className="py-1">
            {COUNTRIES.map((country) => (
              <button
                key={country.id}
                onClick={() => handleSelect(country.id)}
                className={`
                  w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center space-x-3
                  ${currentCountry === country.id ? 'bg-orange-50 text-orange-600' : 'text-gray-700'}
                `}
              >
                <FlagIcon country={country.id} className="w-5 h-4" showEmoji={false} />
                <span className="font-medium">{country.name}</span>
                {currentCountry === country.id && (
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
