export const getStoredSessionUser = () => {
  if (typeof window === 'undefined') return null;
  const buckets = [window.localStorage, window.sessionStorage].filter(Boolean);
  const keys = ['kojo_user', 'user', 'auth_user', 'session_user', 'currentUser'];
  for (const bucket of buckets) {
    for (const key of keys) {
      try {
        const raw = bucket.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (_err) {}
    }
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
  const ownerIds = [
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
  return ownerIds.some((id) => currentIds.has(id));
};

export const getPrimaryJobId = (job) => {
  if (!job) return '';
  return normalizeComparableId(job._id || job.id || job.job_id || job.jobId || job.slug);
};

const getAuthToken = () => {
  if (typeof window === 'undefined') return '';
  const buckets = [window.localStorage, window.sessionStorage].filter(Boolean);
  const keys = ['token', 'authToken', 'accessToken', 'kojo_token', 'jwt'];
  for (const bucket of buckets) {
    for (const key of keys) {
      const raw = bucket.getItem(key);
      if (!raw) continue;
      if (raw.startsWith('{')) {
        try {
          const parsed = JSON.parse(raw);
          for (const nested of ['token', 'accessToken', 'authToken', 'jwt']) {
            if (parsed && parsed[nested]) return String(parsed[nested]);
          }
        } catch (_err) {}
      }
      return String(raw);
    }
  }
  return '';
};

const unique = (items) => Array.from(new Set(items.filter(Boolean)));

const getBaseCandidates = () => {
  const envs = [];
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      envs.push(import.meta.env.VITE_API_BASE_URL);
      envs.push(import.meta.env.VITE_API_URL);
    }
  } catch (_err) {}
  if (typeof window !== 'undefined') {
    envs.push(window.__API_BASE_URL__);
    envs.push(window.location?.origin || '');
  }
  envs.push('');
  envs.push('/api');
  return unique(envs.map((value) => String(value || '').replace(/\/$/, '')));
};

const buildDeleteCandidates = (jobId) => {
  const bases = getBaseCandidates();
  const urls = [];
  for (const base of bases) {
    urls.push({ method: 'DELETE', url: `${base}/jobs/${jobId}` });
    urls.push({ method: 'POST', url: `${base}/jobs/${jobId}/delete` });
    urls.push({ method: 'DELETE', url: `${base}/api/jobs/${jobId}` });
    urls.push({ method: 'POST', url: `${base}/api/jobs/${jobId}/delete` });
    urls.push({ method: 'DELETE', url: `${base}/job/${jobId}` });
    urls.push({ method: 'POST', url: `${base}/job/${jobId}/delete` });
  }
  const seen = new Set();
  return urls.filter((item) => {
    const key = `${item.method}:${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const deleteJobWithFallbacks = async (job) => {
  const jobId = getPrimaryJobId(job);
  if (!jobId) {
    throw new Error('Identifiant du job introuvable');
  }
  const token = getAuthToken();
  const attempts = [];
  for (const candidate of buildDeleteCandidates(jobId)) {
    try {
      const response = await fetch(candidate.url, {
        method: candidate.method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: candidate.method === 'POST' ? JSON.stringify({}) : undefined,
      });
      attempts.push(`${candidate.method} ${candidate.url} -> ${response.status}`);
      if (response.ok) {
        return { ok: true, status: response.status, attempts };
      }
    } catch (error) {
      attempts.push(`${candidate.method} ${candidate.url} -> NETWORK_ERROR:${error?.message || 'unknown'}`);
    }
  }
  const detail = attempts.join(' | ');
  throw new Error(`Suppression impossible pour le moment. Essais: ${detail}`);
};

export const ensureJobOwnerActionBar = (job) => {
  if (typeof document === 'undefined') return () => {};
  const previous = document.getElementById('kojo-job-owner-action-bar');
  if (previous) previous.remove();

  if (!job || !isOwnedByCurrentUser(job)) return () => {};
  const jobId = getPrimaryJobId(job);
  if (!jobId) return () => {};

  const bar = document.createElement('div');
  bar.id = 'kojo-job-owner-action-bar';
  bar.style.position = 'fixed';
  bar.style.right = '16px';
  bar.style.bottom = '16px';
  bar.style.zIndex = '9999';
  bar.style.display = 'flex';
  bar.style.gap = '10px';
  bar.style.padding = '12px';
  bar.style.borderRadius = '16px';
  bar.style.background = 'rgba(17,24,39,0.96)';
  bar.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';
  bar.style.backdropFilter = 'blur(8px)';

  const listBtn = document.createElement('button');
  listBtn.type = 'button';
  listBtn.textContent = 'Mes jobs';
  listBtn.style.border = '0';
  listBtn.style.borderRadius = '12px';
  listBtn.style.padding = '10px 14px';
  listBtn.style.cursor = 'pointer';
  listBtn.style.fontWeight = '700';
  listBtn.onclick = () => {
    window.location.href = '/jobs';
  };

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Supprimer ce job';
  deleteBtn.style.border = '0';
  deleteBtn.style.borderRadius = '12px';
  deleteBtn.style.padding = '10px 14px';
  deleteBtn.style.cursor = 'pointer';
  deleteBtn.style.fontWeight = '700';
  deleteBtn.style.background = '#dc2626';
  deleteBtn.style.color = '#fff';
  deleteBtn.onclick = async () => {
    const confirmed = window.confirm('Veux-tu vraiment supprimer ce job ?');
    if (!confirmed) return;
    const oldLabel = deleteBtn.textContent;
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Suppression...';
    try {
      await deleteJobWithFallbacks(job);
      window.alert('Job supprimé avec succès');
      window.location.href = '/jobs';
    } catch (error) {
      window.alert(error?.message || 'Suppression impossible');
      deleteBtn.disabled = false;
      deleteBtn.textContent = oldLabel;
    }
  };

  bar.appendChild(listBtn);
  bar.appendChild(deleteBtn);
  document.body.appendChild(bar);
  return () => {
    const el = document.getElementById('kojo-job-owner-action-bar');
    if (el) el.remove();
  };
};
