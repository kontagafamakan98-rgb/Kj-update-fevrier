const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getLocationCoordinates = (location = {}) => {
  const latitude = toFiniteNumber(location?.coordinates?.lat ?? location?.latitude ?? location?.lat);
  const longitude = toFiniteNumber(location?.coordinates?.lng ?? location?.longitude ?? location?.lng);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { lat: latitude, lng: longitude };
};

export const getLocationAddress = (location = {}) => {
  const fullAddress = String(location?.fullAddress || '').trim();
  const address = String(location?.address || '').trim();
  return fullAddress || address || '';
};

export const hasPreciseLocation = (location = {}) => Boolean(getLocationCoordinates(location));

export const normalizeLocationPayload = (location = {}) => {
  const coordinates = getLocationCoordinates(location);
  const city = String(location?.city || '').trim();
  const district = String(location?.district || '').trim();
  const country = String(location?.country || '').trim();
  const countryCode = String(location?.countryCode || '').trim();
  const addressParts = [district, city].filter(Boolean).join(', ');
  const fallbackAddress = addressParts || [city, country].filter(Boolean).join(', ') || country;
  const suppliedAddress = String(location?.address || '').trim();
  const suppliedFullAddress = String(location?.fullAddress || '').trim();
  const address = suppliedAddress || suppliedFullAddress || fallbackAddress;
  const fullAddress = suppliedFullAddress || suppliedAddress || [addressParts, country].filter(Boolean).join(', ') || address;

  return {
    ...location,
    address,
    fullAddress,
    latitude: coordinates?.lat ?? null,
    longitude: coordinates?.lng ?? null,
    coordinates: coordinates || null,
    city,
    district,
    country,
    countryCode,
    accuracy: toFiniteNumber(location?.accuracy) ?? 0,
    method: location?.method || '',
    isPrecise: Boolean(coordinates)
  };
};

export const buildGoogleMapsDirectionsUrl = (location = {}, travelMode = 'driving') => {
  const normalizedLocation = normalizeLocationPayload(location);
  const coordinates = normalizedLocation.coordinates;
  const baseUrl = 'https://www.google.com/maps/dir/?api=1';

  if (coordinates) {
    return `${baseUrl}&destination=${coordinates.lat},${coordinates.lng}&travelmode=${encodeURIComponent(travelMode)}`;
  }

  const address = normalizedLocation.fullAddress || normalizedLocation.address;
  return `${baseUrl}&destination=${encodeURIComponent(address)}`;
};

export const buildGoogleMapsPlaceUrl = (location = {}) => {
  const normalizedLocation = normalizeLocationPayload(location);
  const coordinates = normalizedLocation.coordinates;
  const baseUrl = 'https://www.google.com/maps/search/?api=1';

  if (coordinates) {
    return `${baseUrl}&query=${coordinates.lat},${coordinates.lng}`;
  }

  return `${baseUrl}&query=${encodeURIComponent(normalizedLocation.fullAddress || normalizedLocation.address)}`;
};

export const buildAppleMapsDirectionsUrl = (location = {}, transportFlag = 'd') => {
  const normalizedLocation = normalizeLocationPayload(location);
  const coordinates = normalizedLocation.coordinates;

  if (coordinates) {
    return `https://maps.apple.com/?daddr=${coordinates.lat},${coordinates.lng}&dirflg=${encodeURIComponent(transportFlag)}`;
  }

  return `https://maps.apple.com/?daddr=${encodeURIComponent(normalizedLocation.fullAddress || normalizedLocation.address)}&dirflg=${encodeURIComponent(transportFlag)}`;
};

export const buildAppleMapsPlaceUrl = (location = {}) => {
  const normalizedLocation = normalizeLocationPayload(location);
  const coordinates = normalizedLocation.coordinates;
  const label = normalizedLocation.fullAddress || normalizedLocation.address || 'Job location';

  if (coordinates) {
    return `https://maps.apple.com/?ll=${coordinates.lat},${coordinates.lng}&q=${encodeURIComponent(label)}`;
  }

  return `https://maps.apple.com/?q=${encodeURIComponent(label)}`;
};

export const buildOpenStreetMapEmbedUrl = (location = {}, zoom = 16) => {
  const normalizedLocation = normalizeLocationPayload(location);
  const coordinates = normalizedLocation.coordinates;

  if (!coordinates) {
    return '';
  }

  const delta = 0.006;
  const left = coordinates.lng - delta;
  const right = coordinates.lng + delta;
  const top = coordinates.lat + delta;
  const bottom = coordinates.lat - delta;

  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${coordinates.lat}%2C${coordinates.lng}`;
};

export const buildOpenStreetMapPageUrl = (location = {}, zoom = 17) => {
  const normalizedLocation = normalizeLocationPayload(location);
  const coordinates = normalizedLocation.coordinates;

  if (!coordinates) {
    return '';
  }

  return `https://www.openstreetmap.org/?mlat=${coordinates.lat}&mlon=${coordinates.lng}#map=${zoom}/${coordinates.lat}/${coordinates.lng}`;
};


const LOCATION_PRECISION_LABELS = {
  fr: {
    gpsValidated: 'GPS validé',
    gpsVeryPrecise: 'GPS très précis',
    gpsPrecise: 'GPS précis',
    gpsApproximate: 'GPS approximatif',
    autoLocation: 'Localisation auto',
    mapCoordinates: 'Position carte',
    manualLocation: 'Adresse manuelle',
    unconfirmed: 'Position non confirmée'
  },
  en: {
    gpsValidated: 'GPS validated',
    gpsVeryPrecise: 'Very precise GPS',
    gpsPrecise: 'Precise GPS',
    gpsApproximate: 'Approximate GPS',
    autoLocation: 'Auto location',
    mapCoordinates: 'Map position',
    manualLocation: 'Manual address',
    unconfirmed: 'Unconfirmed location'
  }
};

const getPrecisionLanguage = (language = 'fr') => {
  const value = String(language || 'fr').toLowerCase();
  return value.startsWith('en') ? 'en' : 'fr';
};

export const getLocationPrecisionMeta = (location = {}, language = 'fr') => {
  const normalizedLocation = normalizeLocationPayload(location);
  const labels = LOCATION_PRECISION_LABELS[getPrecisionLanguage(language)];
  const method = String(normalizedLocation?.method || '').toLowerCase();
  const gpsAccuracy = toFiniteNumber(normalizedLocation?.gpsAccuracy ?? normalizedLocation?.accuracy);
  const hasCoordinates = Boolean(normalizedLocation?.coordinates);

  if ((method === 'gps' || method === 'cache') && Number.isFinite(gpsAccuracy) && gpsAccuracy > 0) {
    if (gpsAccuracy <= 10) {
      return { label: labels.gpsValidated, tone: 'green', isPrecise: true, hasCoordinates, isGpsBased: true };
    }

    if (gpsAccuracy <= 25) {
      return { label: labels.gpsVeryPrecise, tone: 'green', isPrecise: true, hasCoordinates, isGpsBased: true };
    }

    if (gpsAccuracy <= 50) {
      return { label: labels.gpsPrecise, tone: 'green', isPrecise: true, hasCoordinates, isGpsBased: true };
    }

    return { label: labels.gpsApproximate, tone: 'amber', isPrecise: false, hasCoordinates, isGpsBased: true };
  }

  if (method === 'ip' || method === 'contextual' || method === 'context' || method === 'backend_api') {
    return { label: labels.autoLocation, tone: 'amber', isPrecise: false, hasCoordinates, isGpsBased: false };
  }

  if (hasCoordinates) {
    return { label: labels.mapCoordinates, tone: 'blue', isPrecise: false, hasCoordinates, isGpsBased: false };
  }

  if (normalizedLocation?.fullAddress || normalizedLocation?.address) {
    return { label: labels.manualLocation, tone: 'gray', isPrecise: false, hasCoordinates: false, isGpsBased: false };
  }

  return { label: labels.unconfirmed, tone: 'gray', isPrecise: false, hasCoordinates: false, isGpsBased: false };
};
