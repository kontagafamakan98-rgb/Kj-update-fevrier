import React, { useState } from 'react';
import { supportAPI } from '../services/apiEndpoints';
import { useLanguage } from '../contexts/LanguageContext';

// Les textes de ce bloc vivent dans les dictionnaires du dépôt
// (src/i18n/*.json, clés `supportTicket…`) : ils étaient auparavant reçus par
// une prop `copy` reconstruite par la page, et cinq d'entre eux étaient
// recopiés en français dans la coquille pré-rendue.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Suivi de ticket : le créateur peut vérifier le statut de sa demande avec
// l'identifiant renvoyé à la création + l'e-mail saisi (le backend exige la
// correspondance — un ticket ne peut pas être interrogé par un tiers).
export const getLastStoredTicket = () => {
  try {
    const raw = localStorage.getItem('kojo_last_ticket');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.id) {
      return { id: String(parsed.id), email: String(parsed.email || '') };
    }
    return null;
  } catch (_e) {
    return null;
  }
};

export default function TicketTracker() {
  const { t } = useLanguage();
  const lastTicket = getLastStoredTicket();
  const [ticketId, setTicketId] = useState(lastTicket?.id || '');
  const [ticketEmail, setTicketEmail] = useState(lastTicket?.email || '');
  const [tracking, setTracking] = useState(false);
  const [trackResult, setTrackResult] = useState(null); // null | {…} | 'not_found'
  const [trackError, setTrackError] = useState('');

  const trackTicket = async () => {
    if (!ticketId.trim() || !ticketEmail.trim()) return;
    if (!EMAIL_RE.test(ticketEmail.trim())) {
      setTrackError(t('supportErrorEmail'));
      setTrackResult(null);
      return;
    }
    setTracking(true);
    setTrackError('');
    try {
      const response = await supportAPI.getTicketStatus(ticketId.trim(), ticketEmail.trim());
      setTrackResult(response?.data || response || null);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        setTrackResult('not_found');
      } else {
        setTrackError(t('supportGenericError'));
      }
    } finally {
      setTracking(false);
    }
  };

  const statusBadgeColor = (status) => {
    if (/résolu|resolved/i.test(status || '')) return 'bg-emerald-100 text-emerald-700';
    if (/en cours|progress/i.test(status || '')) return 'bg-amber-100 text-amber-700';
    return 'bg-blue-100 text-blue-700';
  };

  return (
    <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">{t('supportTrackTitle')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('supportTrackSubtitle')}</p>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={ticketId}
          onChange={(e) => setTicketId(e.target.value)}
          placeholder={t('supportTicketIdPlaceholder')}
          aria-label={t('supportTicketIdPlaceholder')}
          className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        <input
          type="email"
          value={ticketEmail}
          onChange={(e) => setTicketEmail(e.target.value)}
          placeholder={t('supportTicketEmailPlaceholder')}
          aria-label={t('supportTicketEmailPlaceholder')}
          className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        <button
          onClick={trackTicket}
          disabled={tracking || !ticketId.trim() || !ticketEmail.trim()}
          className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
        >
          {tracking ? t('supportTracking') : t('supportTrackCta')}
        </button>
      </div>

      {trackError && <p className="mt-3 text-sm text-red-600">{trackError}</p>}

      {trackResult === 'not_found' && (
        <p className="mt-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {t('supportTrackNotFound')}
        </p>
      )}

      {trackResult && trackResult !== 'not_found' && (
        <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 line-clamp-1">{trackResult.reason}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('supportTicketSentOn')}{' '}
                {trackResult.created_at ? new Date(trackResult.created_at).toLocaleDateString() : ''}
                {' • '}{t('supportTicketIdLabel')}: {String(trackResult.ticket_id || trackResult.id || '').slice(0, 8)}…
              </p>
            </div>
            <span className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold ${statusBadgeColor(trackResult.status)}`}>
              {t('supportTicketStatusLabel')}: {trackResult.status}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
