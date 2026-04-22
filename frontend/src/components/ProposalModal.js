import { useState } from 'react';
import axios from 'axios';
import { useLanguage } from '../contexts/LanguageContext';

export default function ProposalModal({ jobId, onClose, onProposalSubmitted }) {
  const [formData, setFormData] = useState({
    proposed_amount: '',
    estimated_completion_time: '',
    message: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { t } = useLanguage();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const proposalData = {
        ...formData,
        proposed_amount: parseFloat(formData.proposed_amount)
      };

      await axios.post(`/jobs/${jobId}/proposals`, proposalData);
      onProposalSubmitted();
    } catch (err) {
      setError(err.response?.data?.detail || t('proposalSubmitError'));
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">{t('makeProposal')}</h2>
          <button aria-label={t('close')} onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">{error}</div>}

          <div>
            <label htmlFor="proposed_amount" className="block text-sm font-medium text-gray-700 mb-2">{t('proposedAmount')}</label>
            <input type="number" id="proposed_amount" name="proposed_amount" autoComplete="off" required min="0" value={formData.proposed_amount} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" placeholder="10000" />
          </div>

          <div>
            <label htmlFor="estimated_completion_time" className="block text-sm font-medium text-gray-700 mb-2">{t('estimatedCompletionTime')}</label>
            <input type="text" id="estimated_completion_time" name="estimated_completion_time" autoComplete="off" required value={formData.estimated_completion_time} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" placeholder={t('proposalTimePlaceholder')} />
          </div>

          <div>
            <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">{t('messageToClient')}</label>
            <textarea id="message" name="message" autoComplete="off" required rows={4} value={formData.message} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500" placeholder={t('proposalMessagePlaceholder')} />
          </div>

          <div className="flex justify-end space-x-4 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">{t('cancel')}</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-md disabled:opacity-50">{loading ? t('loading') : t('sendProposal')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
