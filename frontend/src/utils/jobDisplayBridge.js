const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') return value;
  }
  return '';
};

const normalizeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

const extractLocationText = (location) => {
  if (!location) return 'Localisation non précisée';
  if (typeof location === 'string') return location.trim() || 'Localisation non précisée';
  if (typeof location === 'object') {
    return firstNonEmpty(
      location.fullAddress,
      location.address,
      location.label,
      location.city && location.country ? `${location.city}, ${location.country}` : '',
      location.city,
      location.district,
      location.country
    ) || 'Localisation non précisée';
  }
  return 'Localisation non précisée';
};

const extractClientName = (job) => {
  return firstNonEmpty(
    job.client_name,
    job.clientName,
    job.client?.full_name,
    [job.client?.first_name, job.client?.last_name].filter(Boolean).join(' ').trim(),
    [job.client_first_name, job.client_last_name].filter(Boolean).join(' ').trim(),
    job.owner_name,
    job.user_name,
    'Client anonyme'
  );
};

const extractClientEmail = (job) => firstNonEmpty(job.client_email, job.client?.email, job.owner_email, '');

export const normalizeJobRecord = (raw) => {
  const job = raw && raw.data ? raw.data : raw;
  if (!job || typeof job !== 'object') {
    return {
      id: '',
      title: 'Job sans titre',
      description: 'Description non renseignée',
      status: 'pending',
      posted_at: null,
      created_at: null,
      budget_min: null,
      budget_max: null,
      location_text: 'Localisation non précisée',
      location_precision: '',
      client_name: 'Client anonyme',
      client_email: '',
      category: '',
    };
  }

  return {
    ...job,
    id: firstNonEmpty(job.id, job._id, job.job_id, job.jobId),
    title: firstNonEmpty(job.title, job.service_title, job.name, 'Job sans titre'),
    description: firstNonEmpty(job.description, job.details, job.summary, 'Description non renseignée'),
    status: asText(firstNonEmpty(job.status, job.job_status, job.state, 'pending')).toLowerCase() || 'pending',
    posted_at: firstNonEmpty(job.posted_at, job.created_at, job.updated_at, ''),
    created_at: firstNonEmpty(job.created_at, job.posted_at, job.updated_at, ''),
    budget_min: normalizeNumber(firstNonEmpty(job.budget_min, job.min_budget, job.budget?.min, null)),
    budget_max: normalizeNumber(firstNonEmpty(job.budget_max, job.max_budget, job.budget?.max, null)),
    estimated_duration: firstNonEmpty(job.estimated_duration, job.duration, job.estimated_time, ''),
    location_text: extractLocationText(firstNonEmpty(job.location, job.address, job.full_address, job.city, '')),
    location_precision: asText(firstNonEmpty(job.location_precision, job.location?.precision, '')),
    client_name: extractClientName(job),
    client_email: extractClientEmail(job),
    category: asText(firstNonEmpty(job.category, job.service_category, 'general')) || 'general',
  };
};

export const normalizeJobList = (items) => Array.isArray(items) ? items.map(normalizeJobRecord).filter((item) => item.id) : [];

/**
 * Nombre de missions publié par `GET /jobs` (`X-Total-Count`), ou `null`.
 *
 * Il est lu sur la RÉPONSE (en-tête), pas déduit de la liste : une page
 * pleine ne prouve pas qu'il en reste, une page incomplète ne prouve pas
 * qu'il n'en reste plus. `null` n'est pas `0` — un compte absent n'est pas un
 * compte nul, et l'écran n'en affiche alors aucun.
 *
 * @param {object|Array} response Réponse de `jobsAPI.getAll(..., { withHeaders: true })`
 *   (`{ data, headers }`), ou la liste seule (serveur/appelant sans en-têtes).
 * @returns {number|null}
 */
export const totalPublie = (response) => {
  const brut = response?.headers?.get?.('X-Total-Count');
  const nombre = Number.parseInt(String(brut ?? ''), 10);
  return Number.isFinite(nombre) && nombre >= 0 ? nombre : null;
};
