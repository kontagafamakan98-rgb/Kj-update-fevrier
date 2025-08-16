import React from 'react';

// SVG Flag Components for better rendering
const MaliFlag = ({ className = "w-12 h-8" }) => (
  <svg className={className} viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg">
    <rect width="900" height="600" fill="#14B53A"/>
    <rect width="600" height="600" fill="#FFCD00"/>
    <rect width="300" height="600" fill="#CE1126"/>
  </svg>
);

const SenegalFlag = ({ className = "w-12 h-8" }) => (
  <svg className={className} viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg">
    <rect width="900" height="600" fill="#00853F"/>
    <rect width="600" height="600" fill="#FDEF42"/>
    <rect width="300" height="600" fill="#E31B23"/>
    <g transform="translate(450,300)">
      <polygon points="0,-60 17.6,-18.5 58.8,-18.5 25.2,15 40.8,56.5 0,23 -40.8,56.5 -25.2,15 -58.8,-18.5 -17.6,-18.5" fill="#00853F"/>
    </g>
  </svg>
);

const BurkinaFasoFlag = ({ className = "w-12 h-8" }) => (
  <svg className={className} viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg">
    <rect width="900" height="300" fill="#EF2B2D"/>
    <rect y="300" width="900" height="300" fill="#00853F"/>
    <g transform="translate(450,300)">
      <polygon points="0,-50 14.7,-15.5 49,-15.5 21,12.5 34,47.5 0,19 -34,47.5 -21,12.5 -49,-15.5 -14.7,-15.5" fill="#FDEF42"/>
    </g>
  </svg>
);

const IvoryCoastFlag = ({ className = "w-12 h-8" }) => (
  <svg className={className} viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg">
    <rect width="300" height="600" fill="#F77F00"/>
    <rect x="300" width="300" height="600" fill="#FCFCFC"/>
    <rect x="600" width="300" height="600" fill="#009639"/>
  </svg>
);

// Main Flag Icon component
export default function FlagIcon({ country, className = "w-12 h-8", showEmoji = true }) {
  // If showEmoji is true, use emoji flags for better compatibility
  if (showEmoji) {
    const flagEmojis = {
      mali: '🇲🇱',
      senegal: '🇸🇳', 
      burkina_faso: '🇧🇫',
      ivory_coast: '🇨🇮'
    };
    
    return (
      <div className={`${className} flex items-center justify-center text-4xl`}>
        {flagEmojis[country] || '🏳️'}
      </div>
    );
  }

  // Use SVG flags for more control
  const flagComponents = {
    mali: MaliFlag,
    senegal: SenegalFlag,
    burkina_faso: BurkinaFasoFlag,
    ivory_coast: IvoryCoastFlag
  };

  const FlagComponent = flagComponents[country];
  
  if (!FlagComponent) {
    return (
      <div className={`${className} bg-gray-200 rounded flex items-center justify-center`}>
        <span className="text-gray-400">🏳️</span>
      </div>
    );
  }

  return <FlagComponent className={`${className} rounded shadow-sm`} />;
}

// Individual flag exports for direct use
export { MaliFlag, SenegalFlag, BurkinaFasoFlag, IvoryCoastFlag };