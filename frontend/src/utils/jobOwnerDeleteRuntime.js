import { jobsAPI } from '../services/apiEndpoints';

const normalizeComparableId = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value._id) return String(value._id).trim();
    if (value.id) return String(value.id).trim();
  }
  return String(value).trim();
};

export const getPrimaryJobId = (job) => {
  if (!job) return '';
  return normalizeComparableId(job.id || job.job_id || job.jobId || job._id || job.slug);
};

export const deleteJobWithFallbacks = async (job) => {
  const jobId = getPrimaryJobId(job);
  if (!jobId) {
    throw new Error('Identifiant du job introuvable');
  }

  try {
    return await jobsAPI.delete(jobId);
  } catch (error) {
    const detail = error?.response?.data?.detail || error?.message || 'Suppression impossible pour le moment';
    throw new Error(detail);
  }
};
