import { useMemo, useState } from 'react';
import { jobsAPI } from '../services/api';

export default function ProposalModal({ job, onClose, onProposalSubmitted }) {
  const [formData, setFormData] = useState({
    proposed_amount: '',
    estimated_duration: '',
    cover_letter: '',
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
    const message = String(formData.cover_letter || '').trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Entre un montant valide.');
      return;
    }

    if (!message) {
      setError('Explique ta proposition en quelques lignes.');
      return;
    }

    const jobId = job?.id || job?._id || job?.job_id || job?.jobId;
    if (!jobId) {
      setError('Identifiant du job introuvable.');
      return;
    }

    setLoading(true);
    try {
      await jobsAPI.apply(jobId, {
        proposed_amount: amount,
        amount,
        cover_letter: message,
        message,
        description: message,
        estimated_duration: formData.estimated_duration?.trim() || null,
      });

      if (typeof onProposalSubmitted === 'function') {
        onProposalSubmitted();
      }
    } catch (submitError) {
      setError(submitError?.response?.data?.detail || submitError?.message || 'Envoi de la proposition impossible');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-gray-100">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Postuler</h2>
            <p className="text-sm text-gray-500">Envoie ta proposition pour {title}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-gray-500 hover:bg-gray-100">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Montant proposé</label>
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
              <label className="mb-2 block text-sm font-medium text-gray-700">Durée estimée</label>
              <input
                type="text"
                name="estimated_duration"
                value={formData.estimated_duration}
                onChange={handleChange}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                placeholder="Ex: 2 heures"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Message</label>
            <textarea
              name="cover_letter"
              rows="6"
              value={formData.cover_letter}
              onChange={handleChange}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              placeholder="Présente ton offre, ton expérience et comment tu vas faire le travail"
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-3 font-semibold text-gray-700 hover:bg-gray-50">
              Annuler
            </button>
            <button type="submit" disabled={loading} className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
              {loading ? 'Envoi...' : 'Envoyer la proposition'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
