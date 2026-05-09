const text = (value) => (typeof value === 'string' ? value.trim() : '');

export const emptyJobLocation = () => ({
  address: '',
  fullAddress: '',
  city: '',
  district: '',
  country: '',
  countryCode: '',
  latitude: null,
  longitude: null,
  coordinates: null,
  precision: 'manual',
  source: 'manual',
});

export const hasCoordinates = (location) => {
  const lat = Number(location?.latitude);
  const lng = Number(location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
};

export const buildLocationLabel = (location) => {
  if (!location) return '';
  return text(location.fullAddress) || text(location.address) || [location?.district, location?.city, location?.country].filter(Boolean).join(', ');
};

export const buildMapEmbedUrl = (location) => {
  if (!location) return '';
  if (hasCoordinates(location)) {
    return `https://www.google.com/maps?q=${Number(location.latitude)},${Number(location.longitude)}&z=15&output=embed`;
  }
  const label = buildLocationLabel(location);
  if (!label) return '';
  return `https://www.google.com/maps?q=${encodeURIComponent(label)}&output=embed`;
};

export const mergeManualAddress = (currentLocation, value) => {
  const nextText = text(value);
  return {
    ...(currentLocation || emptyJobLocation()),
    address: nextText,
    fullAddress: nextText,
    source: currentLocation?.source || 'manual',
  };
};

const reverseGeocode = async (latitude, longitude) => {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Reverse geocoding failed');
  }

  const data = await response.json();
  const addr = data?.address || {};
  const label = text(data?.display_name);

  return {
    address: label,
    fullAddress: label,
    city: text(addr.city || addr.town || addr.village || addr.county),
    district: text(addr.suburb || addr.neighbourhood || addr.state_district),
    country: text(addr.country),
    countryCode: text(addr.country_code).toUpperCase(),
    latitude,
    longitude,
    coordinates: [longitude, latitude],
    precision: 'gps',
    source: 'auto',
  };
};

export const detectCurrentJobLocation = async () => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('La géolocalisation n’est pas disponible sur cet appareil');
  }

  const position = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });

  const latitude = Number(position?.coords?.latitude);
  const longitude = Number(position?.coords?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Coordonnées GPS invalides');
  }

  try {
    return await reverseGeocode(latitude, longitude);
  } catch (_error) {
    return {
      ...emptyJobLocation(),
      address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      fullAddress: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      latitude,
      longitude,
      coordinates: [longitude, latitude],
      precision: 'gps',
      source: 'auto',
    };
  }
};
