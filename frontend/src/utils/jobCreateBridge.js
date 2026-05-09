import { normalizeLocationPayload } from './locationMaps';

const cleanText = (value) => (typeof value === 'string' ? value.trim() : '');

const cleanNumber = (value) => {
  if (value === '' || value === null || typeof value === 'undefined') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildStringLocationFallback = (value) => {
  const text = cleanText(value);
  return {
    address: text,
    fullAddress: text,
    city: '',
    district: '',
    country: '',
    countryCode: '',
    latitude: null,
    longitude: null,
    coordinates: null,
  };
};

export const buildJobCreatePayload = (formData) => {
  const rawLocation = formData?.location;
  let normalizedLocation;

  try {
    if (typeof rawLocation === 'object' && rawLocation !== null) {
      normalizedLocation = normalizeLocationPayload(rawLocation);
    } else {
      normalizedLocation = normalizeLocationPayload(buildStringLocationFallback(rawLocation));
    }
  } catch (_error) {
    normalizedLocation = buildStringLocationFallback(rawLocation);
  }

  const payload = {
    title: cleanText(formData?.title),
    description: cleanText(formData?.description),
    category: cleanText(formData?.category) || 'general',
    location: normalizedLocation,
    budget_min: cleanNumber(formData?.budget_min),
    budget_max: cleanNumber(formData?.budget_max),
    required_skills: Array.isArray(formData?.required_skills)
      ? formData.required_skills.map((item) => cleanText(item)).filter(Boolean)
      : [],
    estimated_duration: cleanText(formData?.estimated_duration) || null,
    deadline: formData?.deadline ? new Date(formData.deadline).toISOString() : null,
    urgency: cleanText(formData?.urgency) || 'normal',
    mechanic_must_bring_parts: Boolean(formData?.mechanic_must_bring_parts),
    mechanic_must_bring_tools: Boolean(formData?.mechanic_must_bring_tools),
    parts_and_tools_notes: cleanText(formData?.parts_and_tools_notes) || '',
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  return payload;
};

export const normalizeApiErrorMessage = (error) => {
  const detail = error?.response?.data?.detail;

  if (Array.isArray(detail)) {
    return detail.map((item) => {
      if (!item || typeof item !== 'object') return String(item);
      const loc = Array.isArray(item.loc) ? item.loc.join(' > ') : 'champ';
      const msg = item.msg || 'valeur invalide';
      return `${loc}: ${msg}`;
    }).join(' | ');
  }

  if (detail && typeof detail === 'object') {
    if (detail.msg) return detail.msg;
    if (detail.detail) return String(detail.detail);
    try {
      return JSON.stringify(detail);
    } catch (_error) {
      return 'Erreur de validation';
    }
  }

  if (typeof detail === 'string' && detail.trim()) return detail;
  if (typeof error?.response?.data?.message === 'string' && error.response.data.message.trim()) return error.response.data.message;
  if (typeof error?.message === 'string' && error.message.trim()) return error.message;
  return 'Opération impossible pour le moment';
};
