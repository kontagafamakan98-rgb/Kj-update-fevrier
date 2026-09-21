import { Link } from 'react-router-dom';
import { formatBudgetRange, formatJobDate, formatJobStatus } from '../utils/jobPageSafeHelpers';
import { getRememberedApplication } from '../utils/jobProposalWorkflow';
import { DEMO_JOBS } from '../config/demoJobs';

export function DemoJobsEmptyState({ t }) {
  return (
    <section className="space-y-5" aria-labelledby="demo-jobs-title">
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6">
        <h2 id="demo-jobs-title" className="text-xl font-semibold text-gray-900">Découvrez le type de missions publiées sur Kojo</h2>
        <p className="mt-2 max-w-2xl text-sm text-gray-600">Ces exemples montrent le fonctionnement de la plateforme. Créez un compte pour consulter les missions actuellement disponibles et proposer vos services.</p>
        <Link to="/register" className="mt-4 inline-flex rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700">
          {t('getStarted')}
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {DEMO_JOBS.map((job) => (
          <article key={job.id} className="block rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="min-w-[240px] flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-semibold text-gray-900">{job.title}</h3>
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700">Exemple</span>
                </div>
                <p className="mb-4 line-clamp-2 text-gray-600">{job.description}</p>
                <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                  <span>{job.location_text}</span><span>{job.category}</span><span>{job.estimated_duration}</span>
                </div>
              </div>
              <div className="ml-0 min-w-[170px] text-right md:ml-6">
                <div className="text-2xl font-bold text-orange-600">{formatBudgetRange(job.budget_min, job.budget_max)}</div>
                <div className="mt-2 text-xs text-gray-500">{formatJobStatus(job.status, t)}</div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function JobCard({ job, user, userType, appliedJobIds, t }) {
  const locationText = job.location_text || t('locationNotSpecified');
  const jobId = job.id || job._id || job.job_id || job.jobId;
  const hasApplied = userType === 'worker' && (
    appliedJobIds ? appliedJobIds.has(String(jobId)) : Boolean(getRememberedApplication(jobId, user))
  );

  return (
    <Link to={`/jobs/${job.id}`} className="block rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-[240px] flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold text-gray-900">{job.title}</h3>
            <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-1 text-xs text-orange-700">{formatJobStatus(job.status, t)}</span>
          </div>
          <p className="mb-4 line-clamp-2 text-gray-600">{job.description}</p>
          <div className="flex flex-wrap gap-4 text-sm text-gray-500">
            <span>{formatJobDate(job.posted_at || job.created_at)}</span><span>{locationText}</span>{job.category && <span>{job.category}</span>}
          </div>
        </div>
        <div className="ml-0 min-w-[170px] text-right md:ml-6">
          <div className="text-2xl font-bold text-orange-600">{formatBudgetRange(job.budget_min, job.budget_max)}</div>
          {job.estimated_duration && <div className="mt-1 text-sm text-gray-500">{job.estimated_duration}</div>}
          {userType === 'worker' && job.status === 'open' && !hasApplied && <div className="mt-2 inline-flex rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">{t('applyAvailable')}</div>}
          {hasApplied && <div className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{t('proposalSent')}</div>}
        </div>
      </div>
    </Link>
  );
}
