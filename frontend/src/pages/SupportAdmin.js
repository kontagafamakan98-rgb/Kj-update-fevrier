import React, { useEffect, useState, useCallback } from 'react';
import { MessageSquareText, RefreshCcw, Phone, Mail } from 'lucide-react';
import { supportAPI } from '../services/apiEndpoints';
import { useLanguage } from '../contexts/LanguageContext';

const STATUS_OPTIONS = ['Nouveau', 'En cours', 'Résolu'];

const STATUS_STYLES = {
  'Nouveau': 'bg-orange-50 text-orange-700 border-orange-200',
  'En cours': 'bg-blue-50 text-blue-700 border-blue-200',
  'Résolu': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const statusLabel = (status, t) => {
  const map = {
    'Nouveau': 'statusNew',
    'En cours': 'statusInProgress',
    'Résolu': 'statusResolved',
  };
  const key = map[status];
  return key ? t(key) : status;
};

const formatDate = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(value);
  }
};

const SupportAdmin = () => {
  const { t } = useLanguage();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [updatingId, setUpdatingId] = useState(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await supportAPI.listTickets(statusFilter || undefined);
      setTickets(response.data || []);
    } catch (err) {
      setError(err?.response?.data?.detail || t('loadSupportError'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const handleStatusChange = async (ticketId, newStatus) => {
    setUpdatingId(ticketId);
    try {
      await supportAPI.updateTicketStatus(ticketId, newStatus);
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, status: newStatus } : t)));
    } catch (err) {
      setError(err?.response?.data?.detail || t('updateStatusError'));
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquareText size={24} className="text-orange-600" />
            {t('supportRequestsTitle')}
          </h1>
          <p className="text-sm text-gray-500">{tickets.length} {tickets.length > 1 ? t('requestsPlural') : t('requestsSingular')}{statusFilter ? ` · ${statusLabel(statusFilter, t)}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="">{t('allStatuses')}</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s, t)}</option>)}
          </select>
          <button onClick={loadTickets} className="rounded-xl border border-gray-200 p-2 text-gray-600 hover:bg-gray-50" aria-label={t('refresh')}>
            <RefreshCcw size={16} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">{t('loading')}</div>
      ) : tickets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-12 text-center text-sm text-gray-500">
          {t('noSupportRequests')}
        </div>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => (
            <div key={ticket.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <div className="font-semibold text-gray-900">{ticket.full_name}</div>
                  <div className="text-xs text-gray-500">{formatDate(ticket.created_at)} · {ticket.channel === 'direct' ? t('directContact') : t('robotAssistant')}</div>
                </div>
                <select
                  value={ticket.status}
                  disabled={updatingId === ticket.id}
                  onChange={(e) => handleStatusChange(ticket.id, e.target.value)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500 ${STATUS_STYLES[ticket.status] || 'bg-gray-50 text-gray-700 border-gray-200'}`}
                >
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s, t)}</option>)}
                </select>
              </div>

              <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-3">
                <a href={`tel:${ticket.phone}`} className="flex items-center gap-1 hover:text-orange-600">
                  <Phone size={14} /> {ticket.phone}
                </a>
                <a href={`mailto:${ticket.email}`} className="flex items-center gap-1 hover:text-orange-600">
                  <Mail size={14} /> {ticket.email}
                </a>
              </div>

              <div className="mb-2">
                <span className="text-xs font-semibold uppercase text-gray-400">{t('reason')}</span>
                <p className="text-sm text-gray-800">{ticket.reason}</p>
              </div>
              <div>
                <span className="text-xs font-semibold uppercase text-gray-400">{t('message')}</span>
                <p className="text-sm text-gray-800 whitespace-pre-line">{ticket.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SupportAdmin;
