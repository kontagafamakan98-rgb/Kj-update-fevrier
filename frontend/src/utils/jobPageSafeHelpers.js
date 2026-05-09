export const formatBudgetRange = (minValue, maxValue, currency = 'FCFA') => {
  const min = Number(minValue);
  const max = Number(maxValue);
  const hasMin = Number.isFinite(min) && min > 0;
  const hasMax = Number.isFinite(max) && max > 0;

  if (hasMin && hasMax) return `${min} - ${max} ${currency}`;
  if (hasMin) return `${min} ${currency}`;
  if (hasMax) return `${max} ${currency}`;
  return 'Budget non renseigné';
};

export const getLocationPrecisionMeta = (precision) => {
  const normalized = String(precision || '').toLowerCase().trim();
  if (['exact', 'precise', 'gps', 'house', 'full'].includes(normalized)) {
    return { label: 'Position précise', color: 'success' };
  }
  if (['area', 'approximate', 'approx', 'quarter', 'district', 'zone'].includes(normalized)) {
    return { label: 'Zone approximative', color: 'warning' };
  }
  if (['city', 'region', 'country'].includes(normalized)) {
    return { label: 'Zone large', color: 'muted' };
  }
  return { label: 'Localisation non précisée', color: 'muted' };
};

export const formatJobStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  const map = {
    open: 'Ouvert',
    published: 'Publié',
    active: 'Actif',
    pending: 'En attente',
    assigned: 'Attribué',
    in_progress: 'En cours',
    completed: 'Terminé',
    closed: 'Fermé',
    cancelled: 'Annulé',
    canceled: 'Annulé',
    draft: 'Brouillon',
  };
  return map[normalized] || 'Non précisé';
};

export const formatJobDate = (value) => {
  if (!value) return 'Date non renseignée';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date non renseignée';
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch (_err) {
    return 'Date non renseignée';
  }
};

export const getStoredSessionUser = () => {
  if (typeof window === 'undefined') return null;
  const keys = [
    'kojo_user',
    'user',
    'auth_user',
    'session_user',
    'currentUser',
  ];
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_err) {}
  }
  return null;
};

export const normalizeComparableId = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value._id) return String(value._id).trim();
    if (value.id) return String(value.id).trim();
  }
  return String(value).trim();
};

export const isOwnedByCurrentUser = (job, currentUser) => {
  const sessionUser = currentUser || getStoredSessionUser();
  if (!job || !sessionUser) return false;

  const currentIds = new Set([
    normalizeComparableId(sessionUser._id),
    normalizeComparableId(sessionUser.id),
    normalizeComparableId(sessionUser.user_id),
    normalizeComparableId(sessionUser.userId),
  ].filter(Boolean));

  const ownerCandidates = [
    job.owner_id,
    job.ownerId,
    job.client_id,
    job.clientId,
    job.user_id,
    job.userId,
    job.created_by,
    job.createdBy,
    job.poster_id,
    job.posterId,
    job.customer_id,
    job.customerId,
    job?.owner?._id,
    job?.owner?.id,
    job?.client?._id,
    job?.client?.id,
    job?.user?._id,
    job?.user?.id,
  ].map(normalizeComparableId).filter(Boolean);

  return ownerCandidates.some((id) => currentIds.has(id));
};
