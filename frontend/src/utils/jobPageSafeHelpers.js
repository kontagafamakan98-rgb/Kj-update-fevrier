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

const JOB_STATUS_KEYS = {
  open: 'open',
  published: 'published',
  active: 'active',
  pending: 'pending',
  assigned: 'assigned',
  in_progress: 'inProgress',
  completed: 'completed',
  closed: 'closed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  draft: 'draft',
};

const JOB_STATUS_FR = {
  open: 'Ouvert',
  published: 'Publié',
  active: 'Actif',
  pending: 'En attente',
  assigned: 'Attribué',
  inProgress: 'En cours',
  completed: 'Terminé',
  closed: 'Fermé',
  cancelled: 'Annulé',
  draft: 'Brouillon',
};

// Clé i18n du statut (ou null si inconnu) — pour l'affichage via t().
export const jobStatusKey = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  return JOB_STATUS_KEYS[normalized] || null;
};

// Libellé du statut : traduit si un translateur est fourni, sinon repli français.
export const formatJobStatus = (status, t) => {
  const key = jobStatusKey(status);
  if (typeof t === 'function') {
    return t(key || 'statusUnknown');
  }
  return (key && JOB_STATUS_FR[key]) || 'Non précisé';
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

  // Le compte owner a une mainmise sur toute la plateforme : il est
  // toujours considere comme "proprietaire" d'un job pour les actions
  // (ex: suppression), meme s'il ne l'a pas cree lui-meme.
  // is_owner est calcule cote backend par email (voir server.py), plus
  // fiable que user_type qui peut etre absent/obsolete sur les comptes
  // crees avant l'introduction du systeme owner.
  if (sessionUser.is_owner === true) return true;

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
