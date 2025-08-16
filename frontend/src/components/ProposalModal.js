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
    } catch (error) {
      setError(error.response?.data?.detail || 'Erreur lors de la soumission');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">Faire une proposition</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="proposed_amount" className="block text-sm font-medium text-gray-700 mb-2">
              Montant proposé (FCFA)
            </label>
            <input
              type="number"
              id="proposed_amount"
              name="proposed_amount"
              required
              min="0"
              value={formData.proposed_amount}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500"
              placeholder="10000"
            />
          </div>

          <div>
            <label htmlFor="estimated_completion_time" className="block text-sm font-medium text-gray-700 mb-2">
              Temps d'exécution estimé
            </label>
            <input
              type="text"
              id="estimated_completion_time"
              name="estimated_completion_time"
              required
              value={formData.estimated_completion_time}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500"
              placeholder="2 heures, 1 jour, etc."
            />
          </div>

          <div>
            <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
              Message au client
            </label>
            <textarea
              id="message"
              name="message"
              required
              rows={4}
              value={formData.message}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-orange-500 focus:border-orange-500"
              placeholder="Expliquez pourquoi vous êtes le bon choix pour ce travail..."
            />
          </div>

          <div className="flex justify-end space-x-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-md disabled:opacity-50"
            >
              {loading ? t('loading') : 'Envoyer la proposition'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}