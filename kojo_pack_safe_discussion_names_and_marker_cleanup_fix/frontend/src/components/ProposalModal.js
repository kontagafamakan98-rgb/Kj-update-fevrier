import { useMemo, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { jobsAPI } from '../services/api';
import { getJobProposalUiLabel } from '../utils/jobProposalLocale';
import {
  buildInitialProposalConversationMessage,
  getCounterpartForWorker,
  rememberAppliedJob,
  sendProposalConversationMessage,
} from '../utils/jobProposalWorkflow';

const normalizeProposalApiError = (submitError, ui) => {
  const detail = submitError?.response?.data?.detail;

  if (Array.isArray(detail) && detail.length > 0) {
    const messages = detail.map((item) => {
      const field = Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : '';
      if (field === 'proposed_amount') return ui.invalidAmount;
      if (field === 'estimated_completion_time') return ui.estimatedCompletionTimeRequired;
      if (field === 'message') {
        return String(item?.msg || '').includes('10') ? ui.messageTooShort : ui.messageRequired;
      }
      return item?.msg || ui.submitError;
    }).filter(Boolean);

    return messages.join(' ');
  }

  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }

  if (detail && typeof detail === 'object') {
    return detail.msg || detail.message || ui.submitError;
  }

  return submitError?.message || ui.submitError;
};

export default function ProposalModal({ job, onClose, onProposalSubmitted }) {
  const { currentLanguage } = useLanguage();
  const ui = getJobProposalUiLabel(currentLanguage);
  const [formData, setFormData] = useState({
    proposed_amount: '',
    estimated_completion_time: '',
    message: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const title = useMemo(() => job?.title || 'ce job', [job]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const amount = Number(formData.proposed_amount);
    const estimatedCompletionTime = String(formData.estimated_completion_time || '').trim() || ui.toBeAgreed;
    const message = String(formData.message || '').trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      setError(ui.invalidAmount);
      return;
    }

    if (!estimatedCompletionTime) {
      setError(ui.estimatedCompletionTimeRequired);
      return;
    }

    if (!message) {
      setError(ui.messageRequired);
      return;
    }

    if (message.length < 10) {
      setError(ui.messageTooShort);
      return;
    }

    const jobId = job?.id || job?._id || job?.job_id || job?.jobId;
    if (!jobId) {
      setError(ui.missingJobId);
      return;
    }

    setLoading(true);
    try {
      const payload = {
        proposed_amount: amount,
        estimated_completion_time: estimatedCompletionTime,
        message,
        amount,
        estimated_duration: estimatedCompletionTime,
        cover_letter: message,
        description: message,
      };

      const createdProposal = await jobsAPI.apply(jobId, payload);
      const normalizedCreatedProposal = {
        ...(createdProposal && typeof createdProposal === 'object' ? createdProposal : {}),
        ...payload,
        job_id: jobId,
        created_at: createdProposal?.created_at || new Date().toISOString(),
      };

      rememberAppliedJob({
        jobId,
        proposal: normalizedCreatedProposal,
        job,
      });

      try {
        const counterpart = getCounterpartForWorker(job);
        if (counterpart?.id) {
          await sendProposalConversationMessage({
            receiverId: counterpart.id,
            receiverName: counterpart.name,
            jobId,
            content: buildInitialProposalConversationMessage({
              job,
              amount,
              estimatedCompletionTime,
              message,
            }),
          });
        }
      } catch (_messageError) {
        // The proposal should still succeed even if automatic discussion bootstrap fails.
      }

      if (typeof onProposalSubmitted === 'function') {
        onProposalSubmitted(normalizedCreatedProposal);
      }
    } catch (submitError) {
      setError(normalizeProposalApiError(submitError, ui));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-gray-100">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{ui.applyTitle}</h2>
            <p className="text-sm text-gray-500">{ui.applySubtitlePrefix} {title}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-gray-500 hover:bg-gray-100">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">{ui.proposedAmount}</label>
              <input
                type="number"
                min="0"
                step="1"
                name="proposed_amount"
                value={formData.proposed_amount}
                onChange={handleChange}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                placeholder="5000"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">{ui.estimatedCompletionTime}</label>
              <input
                type="text"
                name="estimated_completion_time"
                value={formData.estimated_completion_time}
                onChange={handleChange}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                placeholder={ui.estimatedCompletionPlaceholder}
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">{ui.message}</label>
            <textarea
              name="message"
              rows="6"
              value={formData.message}
              onChange={handleChange}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              placeholder={ui.messagePlaceholder}
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-3 font-semibold text-gray-700 hover:bg-gray-50">
              {ui.cancel}
            </button>
            <button type="submit" disabled={loading} className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
              {loading ? ui.sending : ui.submitProposal}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
