// Niveau de confiance d'un travailleur — badge visible pour renforcer la
// confiance client (preuve sociale). Calcul purement dérivé des données
// déjà renvoyées par le backend (rating / total_reviews / is_verified) :
// aucune donnée supplémentaire, aucun appel réseau.
//
// Barème :
//   - Expert    : vérifié + note >= 4.5 + >= 10 avis
//   - Confirmé  : vérifié + note >= 4.0
//   - Fiable    : note >= 3.5
//   - Nouveau   : tout le reste (peu/pas d'avis)

import { useLanguage } from '../contexts/LanguageContext';

export const WORKER_LEVELS = {
  expert: { key: 'levelExpert', rank: 4, badgeClass: 'bg-purple-100 text-purple-700 border-purple-200' },
  confirmed: { key: 'levelConfirmed', rank: 3, badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  reliable: { key: 'levelReliable', rank: 2, badgeClass: 'bg-blue-100 text-blue-700 border-blue-200' },
  beginner: { key: 'levelBeginner', rank: 1, badgeClass: 'bg-gray-100 text-gray-600 border-gray-200' },
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getWorkerLevel = (person = {}) => {
  const rating = toNumber(person?.rating);
  const totalReviews = toNumber(person?.total_reviews || person?.reviews_count || person?.review_count);
  const isVerified = Boolean(person?.is_verified);

  if (isVerified && rating >= 4.5 && totalReviews >= 10) return WORKER_LEVELS.expert;
  if (isVerified && rating >= 4.0) return WORKER_LEVELS.confirmed;
  if (rating >= 3.5) return WORKER_LEVELS.reliable;
  return WORKER_LEVELS.beginner;
};

// Étiquette lisible d'un niveau (sans hook) — utilisée par les tests et les
// contextes hors React. Retourne le libellé de la langue courante via
// useLanguage quand disponible, sinon le français par défaut.
export const getWorkerLevelLabel = (person = {}, lang = 'fr') => {
  const level = getWorkerLevel(person);
  const labels = {
    levelExpert: { fr: 'Expert', en: 'Expert', wo: 'Expert', bm: 'Expert', mos: 'Expert' },
    levelConfirmed: { fr: 'Confirmé', en: 'Confirmed', wo: 'Dëggal nañu ko', bm: 'Dafalila', mos: 'Yõg-m-meng' },
    levelReliable: { fr: 'Fiable', en: 'Reliable', wo: 'Muy wóor', bm: 'Bɛ se ka dɛmɛ', mos: 'Sẽn tõe n dɩk' },
    levelBeginner: { fr: 'Nouveau', en: 'New', wo: 'Bees', bm: 'Kura', mos: 'Pɑɑlɑ' },
  };
  return (labels[level.key] || {})[lang] || labels[level.key]?.fr || level.key;
};

// Badge réutilisable (JSX) — petits composants de présentation pur fonction :
// à utiliser directement dans les cartes/propositions.
export const WorkerTrustBadge = ({ person, className = '' }) => {
  const { t } = useLanguage();
  const level = getWorkerLevel(person);
  const label = t(level.key);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${level.badgeClass} ${className}`}
      title={t('trustLevelTitle').replace('{level}', label)}
    >
      {label}
    </span>
  );
};

export const VerifiedBadge = ({ verified, className = '' }) => {
  const { t } = useLanguage();
  if (!verified) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ${className}`}
      title={t('verifiedBadgeTitle')}
    >
      ✓ {t('verifiedBadge')}
    </span>
  );
};

// Distance haversine (km) entre deux points — utilisée par la recherche par
// rayon côté client (les jobs portent parfois lat/lng dans location).
export const haversineKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

// Extrait les coordonnées d'un job (location dict ou shared_location).
export const getJobCoordinates = (job = {}) => {
  const loc = job?.location || {};
  const lat = toNumber(loc?.latitude);
  const lng = toNumber(loc?.longitude);
  if (lat && lng) return { latitude: lat, longitude: lng };
  const shared = job?.shared_location || {};
  const sharedLat = toNumber(shared?.latitude);
  const sharedLng = toNumber(shared?.longitude);
  if (sharedLat && sharedLng) return { latitude: sharedLat, longitude: sharedLng };
  return null;
};
