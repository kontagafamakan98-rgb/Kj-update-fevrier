import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import ProposalModal from '../components/ProposalModal';
import { getLocaleForLanguage, makeScopedTranslator } from '../utils/pack2PageI18n';
import { safeLog } from '../utils/env';
import {
  buildAppleMapsDirectionsUrl,
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsPlaceUrl,
  buildOpenStreetMapEmbedUrl,
  buildOpenStreetMapPageUrl,
  getLocationAddress,
  getLocationCoordinates,
  normalizeLocationPayload
} from '../utils/locationMaps';

export default function JobDetails() {
  const [job, setJob] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [error, setError] = useState('');

  const { id } = useParams();
  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'jobDetails');
  const navigate = useNavigate();

  useEffect(() => {
    loadJobDetails();
  }, [id]);

  const loadJobDetails = async () => {
    try {
      const jobResponse = await axios.get(`/jobs/${id}`);
      setJob(jobResponse.data);

      if (user.user_type === 'client' && jobResponse.data.client_id === user.id) {
        try {
          const proposalsResponse = await axios.get(`/jobs/${id}/proposals`);
          setProposals(proposalsResponse.data);
        } catch (proposalError) {
          safeLog.error('Error loading proposals:', proposalError);
        }
      }
    } catch (jobError) {
      safeLog.error('Error loading job details:', jobError);
      setError(pageT('loadError'));
    } finally {
      setLoading(false);
    }
  };

  const locale = getLocaleForLanguage(currentLanguage);
  const formatDate = (dateString) =>
    new Date(dateString).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

  const translateStatus = (status) => pageT(`status_${status}`) || status;

  const getStatusColor = (status) => {
    switch (status) {
      case 'open':
        return 'bg-green-100 text-green-800';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return 'bg-blue-100 text-blue-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
          {error || pageT('notFound')}
        </div>
      </div>
    );
  }

  const isJobOwner = user.user_type === 'client' && job.client_id === user.id;
  const canApply = user.user_type === 'worker' && job.status === 'open';
  const normalizedLocation = normalizeLocationPayload(job.location || {});
  const locationLabel = getLocationAddress(normalizedLocation) || t('locationNotSpecified');
  const locationCoordinates = getLocationCoordinates(normalizedLocation);
  const googleDirectionsUrl = buildGoogleMapsDirectionsUrl(normalizedLocation);
  const appleDirectionsUrl = buildAppleMapsDirectionsUrl(normalizedLocation);
  const mapViewUrl = locationCoordinates
    ? buildOpenStreetMapPageUrl(normalizedLocation)
    : buildGoogleMapsPlaceUrl(normalizedLocation);
  const embeddedMapUrl = locationCoordinates ? buildOpenStreetMapEmbedUrl(normalizedLocation) : '';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button aria-label={pageT('backButtonAria')} onClick={() => navigate(-1)} className="mb-6 flex items-center text-orange-600 hover:text-orange-700">
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
        </svg>
        {pageT('back')}
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start mb-4 gap-4 flex-wrap">
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">{job.title}</h1>
                <div className="flex items-center space-x-4 flex-wrap">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(job.status)}`}>
                    {translateStatus(job.status)}
                  </span>
                  <span className="text-sm text-gray-500">
                    {pageT('publishedOn', { date: formatDate(job.posted_at) })}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-orange-600">{job.budget_min} - {job.budget_max} FCFA</div>
                {job.estimated_duration && (
                  <div className="text-sm text-gray-500 mt-1">{pageT('estimatedDuration', { value: job.estimated_duration })}</div>
                )}
              </div>
            </div>

            <div className="flex space-x-4">
              {canApply && (
                <button onClick={() => setShowProposalModal(true)} className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-2 rounded-lg font-medium">
                  {pageT('submitProposal')}
                </button>
              )}
              <button className="border border-gray-300 text-gray-700 hover:bg-gray-50 px-6 py-2 rounded-lg font-medium">
                {pageT('contactClient')}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{pageT('description')}</h2>
            <p className="text-gray-700 whitespace-pre-wrap">{job.description}</p>
          </div>

          {job.required_skills && job.required_skills.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{pageT('requiredSkills')}</h2>
              <div className="flex flex-wrap gap-2">
                {job.required_skills.map((skill, index) => (
                  <span key={index} className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {isJobOwner && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{pageT('proposals', { count: proposals.length })}</h2>
              {proposals.length > 0 ? (
                <div className="space-y-4">
                  {proposals.map((proposal) => (
                    <ProposalCard key={proposal.id} proposal={proposal} pageT={pageT} currentLanguage={currentLanguage} />
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">{pageT('noProposals')}</p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{pageT('information')}</h3>
            <div className="space-y-3">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path>
                </svg>
                <span className="text-gray-700">{job.category}</span>
              </div>

              <div className="flex items-center">
                <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
                <span className="text-gray-700">{locationLabel || t('locationNotSpecified')}</span>
              </div>

              {job.deadline && (
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3a2 2 0 012-2h4a2 2 0 012 2v4m-6 0v1m6-1v1m-6 0H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2h-2m-6 0V7"></path>
                  </svg>
                  <span className="text-gray-700">{pageT('deadline', { date: formatDate(job.deadline) })}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">{pageT('mapTitle')}</h3>
                <p className="text-sm text-gray-600">
                  {locationCoordinates ? pageT('mapSubtitlePrecise') : pageT('mapSubtitleApproximate')}
                </p>
              </div>
              {locationCoordinates && (
                <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                  GPS
                </span>
              )}
            </div>

            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-900">{locationLabel || t('locationNotSpecified')}</p>
              {locationCoordinates ? (
                <p className="mt-1 text-xs text-gray-500">
                  {pageT('coordinatesValue', {
                    lat: locationCoordinates.lat.toFixed(6),
                    lng: locationCoordinates.lng.toFixed(6)
                  })}
                </p>
              ) : (
                <p className="mt-1 text-xs text-gray-500">{pageT('mapFallbackHelp')}</p>
              )}
            </div>

            {locationCoordinates && embeddedMapUrl && (
              <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 h-64">
                <iframe
                  title={pageT('mapPreviewTitle')}
                  src={embeddedMapUrl}
                  className="w-full h-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <a href={googleDirectionsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-lg bg-orange-600 px-4 py-3 text-sm font-medium text-white hover:bg-orange-700">
                {pageT('openGoogleMaps')}
              </a>
              <a href={appleDirectionsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {pageT('openAppleMaps')}
              </a>
              <a href={mapViewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {pageT('viewMap')}
              </a>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{pageT('client')}</h3>
            <div className="flex items-center">
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                <span className="text-orange-600 font-semibold">{job.client_name ? job.client_name.charAt(0) : 'C'}</span>
              </div>
              <div className="ml-3">
                <p className="font-medium text-gray-900">{job.client_name || pageT('anonymousClient')}</p>
                <p className="text-sm text-gray-500">★★★★☆ (4.2)</p>
              </div>
            </div>
            <button className="w-full mt-4 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg">{pageT('viewProfile')}</button>
          </div>
        </div>
      </div>

      {showProposalModal && <ProposalModal jobId={job.id} onClose={() => setShowProposalModal(false)} onProposalSubmitted={() => setShowProposalModal(false)} />}
    </div>
  );
}

function ProposalCard({ proposal, pageT, currentLanguage }) {
  const locale = getLocaleForLanguage(currentLanguage);
  const formatDate = (dateString) =>
    new Date(dateString).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'accepted':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex justify-between items-start mb-3 gap-3 flex-wrap">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
            <span className="text-blue-600 font-semibold">T</span>
          </div>
          <div className="ml-3">
            <p className="font-medium text-gray-900">{pageT('worker')}</p>
            <p className="text-sm text-gray-500">{formatDate(proposal.created_at)}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-gray-900">{proposal.proposed_amount} FCFA</div>
          <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(proposal.status)}`}>
            {pageT(`status_${proposal.status}`)}
          </span>
        </div>
      </div>

      <p className="text-gray-700 mb-2">{proposal.message}</p>
      <p className="text-sm text-gray-500">{pageT('duration', { value: proposal.estimated_completion_time })}</p>

      {proposal.status === 'pending' && (
        <div className="flex space-x-2 mt-3">
          <button className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm">{pageT('accept')}</button>
          <button className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm">{pageT('reject')}</button>
        </div>
      )}
    </div>
  );
}
