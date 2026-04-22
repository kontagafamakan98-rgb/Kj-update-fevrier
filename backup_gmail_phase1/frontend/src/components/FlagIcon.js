import React from 'react';
import { normalizeCountryCode } from '../utils/countryAliases';

// SVG Flag Components

const FranceFlag = ({ className = "w-12 h-8" }) => (
  <svg className={className} viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg">
    <rect width="300" height="600" fill="#0055A4"/>
    <rect x="300" width="300" height="600" fill="#FFFFFF"/>
    <rect x="600" width="300" height="600" fill="#EF4135"/>
  </svg>
);

const UKFlag = ({ className = "w-12 h-8" }) => (
  <svg className={className} viewBox="0 0 60 30" xmlns="http://www.w3.org/2000/svg">
    <clipPath id="uk-clip"><path d="M0,0 v30 h60 v-30 z"/></clipPath>
    <path d="M0,0 v30 h60 v-30 z" fill="#012169"/>
    <path d="M0,0 60,30 M60,0 0,30" stroke="#FFF" strokeWidth="6" clipPath="url(#uk-clip)"/>
    <path d="M0,0 60,30 M60,0 0,30" stroke="#C8102E" strokeWidth="4" clipPath="url(#uk-clip)"/>
    <path d="M30,0 v30 M0,15 h60" stroke="#FFF" strokeWidth="10"/>
    <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6"/>
  </svg>
);

const MaliFlag = ({ className = "w-12 h-8" }) => (
  <svg className={className} viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg">
    <rect width="300" height="600" fill="#14B53A"/>
    <rect x="300" width="300" height="600" fill="#FFCD00"/>
    <rect x="600" width="300" height="600" fill="#CE1126"/>
  </svg>
);

const SenegalFlag = ({ className = "w-12 h-8" }) => (
  <svg className={className} viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg">
    <rect width="300" height="600" fill="#00853F"/>
    <rect x="300" width="300" height="600" fill="#FDEF42"/>
    <rect x="600" width="300" height="600" fill="#E31B23"/>
    <g transform="translate(450,300)">
      <polygon points="0,-60 17.6,-18.5 58.8,-18.5 25.2,15 40.8,56.5 0,23 -40.8,56.5 -25.2,15 -58.8,-18.5 -17.6,-18.5" fill="#00853F"/>
    </g>
  </svg>
);

const BurkinaFasoFlag = ({ className = "w-12 h-8" }) => (
  <svg className={className} viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg">
    <rect width="900" height="300" fill="#EF2B2D"/>
    <rect y="300" width="900" height="300" fill="#009E49"/>
    <g transform="translate(450,300)">
      <polygon points="0,-50 14.7,-15.5 49,-15.5 21,12.5 34,47.5 0,19 -34,47.5 -21,12.5 -49,-15.5 -14.7,-15.5" fill="#FCD116"/>
    </g>
  </svg>
);

const IvoryCoastFlag = ({ className = "w-12 h-8" }) => (
  <svg className={className} viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg">
    <rect width="300" height="600" fill="#F77F00"/>
    <rect x="300" width="300" height="600" fill="#FFFFFF"/>
    <rect x="600" width="300" height="600" fill="#009E60"/>
  </svg>
);

export default function FlagIcon({ country, className = "w-12 h-8", showEmoji = false }) {
  const normalizedCountry = normalizeCountryCode(country);

  if (showEmoji) {
    const flagEmojis = {
      mali: '🇲🇱',
      senegal: '🇸🇳',
      burkina_faso: '🇧🇫',
      ivory_coast: '🇨🇮',
      ml: '🇲🇱',
      sn: '🇸🇳',
      bf: '🇧🇫',
      ci: '🇨🇮',
      fr: '🇫🇷',
      en: '🇬🇧',
      gb: '🇬🇧',
      wo: '🇸🇳',
      bm: '🇲🇱',
      mos: '🇧🇫'
    };

    return (
      <div className={`${className} flex items-center justify-center text-4xl`}>
        {flagEmojis[normalizedCountry] || flagEmojis[country] || '🏳️'}
      </div>
    );
  }

  const flagComponents = {
    mali: MaliFlag,
    senegal: SenegalFlag,
    burkina_faso: BurkinaFasoFlag,
    ivory_coast: IvoryCoastFlag,
    ml: MaliFlag,
    sn: SenegalFlag,
    bf: BurkinaFasoFlag,
    ci: IvoryCoastFlag,
    fr: FranceFlag,
    en: UKFlag,
    gb: UKFlag,
    wo: SenegalFlag,
    bm: MaliFlag,
    mos: BurkinaFasoFlag
  };

  const FlagComponent = flagComponents[normalizedCountry] || flagComponents[String(country || '').toLowerCase()];

  if (!FlagComponent) {
    return (
      <div className={`${className} bg-gray-200 rounded flex items-center justify-center`}>
        <span className="text-gray-400">🏳️</span>
      </div>
    );
  }

  return <FlagComponent className={`${className} rounded shadow-sm`} />;
}

export { MaliFlag, SenegalFlag, BurkinaFasoFlag, IvoryCoastFlag, FranceFlag, UKFlag };
