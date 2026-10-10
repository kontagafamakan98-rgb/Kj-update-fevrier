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
import { IconePage } from '../config/page-icons';

// 28/09/2026 : l'échelle de teintes quitte l'émeraude et le BLEU — les deux
// dernières teintes du produit qui n'appartenaient à personne — pour la gamme
// CHAUDE du site (orange, ambre, sable, gris chaud de Tailwind, redirigé vers
// `stone` par tailwind.config.cjs). L'ordre reste lisible (marque, ambre, sable,
// sable sourd) et aucune teinte ne sert deux rangs — c'est ce que l'ancienne
// échelle faisait déjà, avec des couleurs que le reste du site n'employait pas.
export const WORKER_LEVELS = {
  // Le niveau le plus haut porte la COULEUR DE MARQUE : c'est le seul endroit du
  // produit où l'orange dit « ce travailleur est le meilleur ».
  expert: { key: 'levelExpert', rank: 4, badgeClass: 'bg-orange-100 text-orange-700 border-orange-200' },
  confirmed: { key: 'levelConfirmed', rank: 3, badgeClass: 'bg-amber-100 text-amber-800 border-amber-200' },
  reliable: { key: 'levelReliable', rank: 2, badgeClass: 'bg-stone-100 text-stone-700 border-stone-200' },
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
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-semibold ${level.badgeClass} ${className}`}
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
      className={`inline-flex items-center gap-1 rounded-sm border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700 ${className}`}
      title={t('verifiedBadgeTitle')}
    >
      {/* Le repère du badge est DESSINÉ (`check`) : c'était un caractère `✓`,
          c'est-à-dire un glyphe qui dépend de la police du poste — la règle du
          site est qu'une icône se dessine (src/config/page-icons.js).
          SA CLASSE SE DEMANDE AU DOMICILE PAR SON RÔLE (09/10/2026). Elle a été
          écrite ici en clair du 07/10 au 09/10, et cette forme est fermée : la
          raison de l'écrire alors était que le corpus de
          `check-css-selecteurs-morts.js` ne lisait AUCUNE valeur de
          `CLASSES_ICONE` (mesuré : 0 valeur), donc la classe d'un badge que seule
          la PAGE peint — aucune coquille ne publie ce repère, il dépend de
          données du travailleur — n'avait aucun porteur lisible. C'est le
          DOMICILE qui a été rendu lisible (`IconePage` y nomme le registre dans
          une position de classe, `className: CLASSES_ICONE[role]`), et pas
          l'appelant qui a gardé sa classe : un emplacement d'icône dit un rôle,
          jamais une classe, et un rôle inconnu lève. */}
      <IconePage nom="check" role="badgeRepere" /> {t('verifiedBadge')}
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
