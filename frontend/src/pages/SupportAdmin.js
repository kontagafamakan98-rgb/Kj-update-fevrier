import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MessageSquareText, RefreshCcw, Phone, Mail } from 'lucide-react';
import { supportAPI } from '../services/apiEndpoints';
import { handleApiError } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';

const STATUS_OPTIONS = ['Nouveau', 'En cours', 'Résolu'];

// Les trois états d'une demande GARDENT leur teinte : elles ne décorent pas,
// elles disent quelque chose (à traiter / en cours / clos), comme les statuts
// de /jobs/:id et du tableau de bord. Ce qui change avec la refonte, c'est le
// DESSIN : le badge était une PILULE (`rounded-full`, la forme interdite du
// site), il prend le rayon des boutons et des puces.
const STATUS_STYLES = {
  'Nouveau': 'bg-orange-50 text-orange-700 border-orange-200',
  'En cours': 'bg-blue-50 text-blue-700 border-blue-200',
  'Résolu': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

/** Le rayon du site pour un contrôle : 3 px, jamais une pilule. */
const RAYON = 'rounded-[3px]';

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
  // Une requête partie avant le démontage ne doit plus écrire d'état : c'est
  // ce qui faisait remonter « window is not defined » (React lit `window`
  // pour choisir la priorité d'une mise à jour) quand la réponse arrivait
  // après la fin de la page.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await supportAPI.listTickets(statusFilter || undefined);
      if (!aliveRef.current) return;
      setTickets(response.data || []);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(handleApiError(err, t('loadSupportError')));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const handleStatusChange = async (ticketId, newStatus) => {
    setUpdatingId(ticketId);
    try {
      await supportAPI.updateTicketStatus(ticketId, newStatus);
      if (!aliveRef.current) return;
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, status: newStatus } : t)));
    } catch (err) {
      if (!aliveRef.current) return;
      setError(handleApiError(err, t('updateStatusError')));
    } finally {
      if (aliveRef.current) setUpdatingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <span className="sur-titre">{t('supportRequestsTitle')}</span>
          <h1 className="titre-page mt-3 flex items-center gap-3">
            <MessageSquareText size={26} className="text-orange-600" aria-hidden="true" />
            {t('supportRequestsTitle')}
          </h1>
          <p className="mt-3 text-sm text-stone-500">{tickets.length} {tickets.length > 1 ? t('requestsPlural') : t('requestsSingular')}{statusFilter ? ` · ${statusLabel(statusFilter, t)}` : ''}</p>
        </div>
        <button onClick={loadTickets} className={`${RAYON} border border-stone-200 p-2 text-stone-600 transition-colors hover:border-orange-600 hover:text-orange-700`} aria-label={t('refresh')}>
          <RefreshCcw size={16} />
        </button>
      </div>

      {/* Le filtre d'état était un `<select>` nu à côté d'une pastille : il
          devient la rangée de PUCES CARRÉES de /jobs (`.puce-filtre`), qui dit
          l'état courant sans qu'on ait à ouvrir un menu — et qui se replie en
          desktop au lieu de défiler (`puces-defilantes`). */}
      <div className="puces-defilantes mb-6">
        <button
          type="button"
          onClick={() => setStatusFilter('')}
          className={`puce-filtre ${statusFilter === '' ? 'puce-filtre-active' : ''}`}
        >
          {t('allStatuses')}
        </button>
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`puce-filtre ${statusFilter === s ? 'puce-filtre-active' : ''}`}
          >
            {statusLabel(s, t)}
          </button>
        ))}
      </div>

      {error && (
        <div className={`mb-4 ${RAYON} border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700`}>{error}</div>
      )}

      {loading ? (
        <div className="py-12 text-center text-stone-500">{t('loading')}</div>
      ) : tickets.length === 0 ? (
        <div className={`${RAYON} border border-dashed border-stone-300 px-4 py-12 text-center text-sm text-stone-500`}>
          {t('noSupportRequests')}
        </div>
      ) : (
        <div className="liste-editoriale">
          {tickets.map((ticket) => (
            <div key={ticket.id} className="ligne-editoriale py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="titre-entree">{ticket.full_name}</div>
                  <div className="mt-1 text-xs text-stone-500">{formatDate(ticket.created_at)} · {ticket.channel === 'direct' ? t('directContact') : t('robotAssistant')}</div>
                </div>
                <select
                  value={ticket.status}
                  disabled={updatingId === ticket.id}
                  onChange={(e) => handleStatusChange(ticket.id, e.target.value)}
                  className={`${RAYON} border px-3 py-1.5 text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${STATUS_STYLES[ticket.status] || 'bg-stone-50 text-stone-700 border-stone-200'}`}
                >
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s, t)}</option>)}
                </select>
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-sm text-stone-600">
                <a href={`tel:${ticket.phone}`} className="flex items-center gap-1.5 transition-colors hover:text-orange-700">
                  <Phone size={14} aria-hidden="true" /> {ticket.phone}
                </a>
                <a href={`mailto:${ticket.email}`} className="flex items-center gap-1.5 transition-colors hover:text-orange-700">
                  <Mail size={14} aria-hidden="true" /> {ticket.email}
                </a>
              </div>

              <div className="mt-4">
                <span className="sur-titre">{t('reason')}</span>
                <p className="mt-2 text-sm text-stone-700">{ticket.reason}</p>
              </div>
              <div className="mt-3">
                <span className="sur-titre">{t('message')}</span>
                <p className="mt-2 whitespace-pre-line text-sm text-stone-700">{ticket.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SupportAdmin;
