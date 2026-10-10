import React, { useState } from 'react';
import { supportAPI } from '../services/apiEndpoints';
import { useLanguage } from '../contexts/LanguageContext';
import { PAGE_SECTIONS } from '../config/page-sections';

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
  // Les classes de la carte de suivi sont celles du plan de /support, lues aussi
  // par la coquille pré-rendue : les deux canaux peignent la même carte.
  const plan = PAGE_SECTIONS['/support'];
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

  // Trois états, trois couleurs : elles disent quelque chose (résolu, en cours,
  // reçu) et ne sont peintes qu'APRÈS une réponse du serveur — la coquille ne
  // les publie jamais. Le défaut est passé du bleu au gris chaud du site : le
  // bleu ne portait aucun sens, il était la couleur « par défaut » d'un tableau
  // de bord.
  const statusBadgeColor = (status) => {
    if (/résolu|resolved/i.test(status || '')) return 'bg-emerald-100 text-emerald-700';
    if (/en cours|progress/i.test(status || '')) return 'bg-amber-100 text-amber-700';
    return 'bg-stone-100 text-stone-700';
  };

  return (
    // La carte à FILET du site, comme les deux cartes de /support qui la
    // suivent : ce bloc était la dernière carte à ombre (`shadow-xs`) de la
    // page, et ses deux champs sont les seuls du site qui vivent HORS d'un
    // `<form>` — donc les seuls que le socle `form :is(input…)` ne dessine pas.
    // Ils portent maintenant le même rayon (0,5 rem) que ce socle, en clair.
    <div className={plan.suiviCarteClass}>
      <h2 className={plan.suiviTitreClass}>{t('supportTrackTitle')}</h2>
      <p className={plan.suiviSousTitreClass}>{t('supportTrackSubtitle')}</p>

      <div className={plan.suiviRangeeClass}>
        <input
          type="text"
          value={ticketId}
          onChange={(e) => setTicketId(e.target.value)}
          placeholder={t('supportTicketIdPlaceholder')}
          aria-label={t('supportTicketIdPlaceholder')}
          className={plan.suiviChampClass}
        />
        <input
          type="email"
          value={ticketEmail}
          onChange={(e) => setTicketEmail(e.target.value)}
          placeholder={t('supportTicketEmailPlaceholder')}
          aria-label={t('supportTicketEmailPlaceholder')}
          className={plan.suiviChampClass}
        />
        <button
          onClick={trackTicket}
          disabled={tracking || !ticketId.trim() || !ticketEmail.trim()}
          className={plan.suiviBoutonClass}
        >
          {tracking ? t('supportTracking') : t('supportTrackCta')}
        </button>
      </div>

      {trackError && <p className="mt-3 text-sm text-red-600">{trackError}</p>}

      {trackResult === 'not_found' && (
        <p className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {t('supportTrackNotFound')}
        </p>
      )}

      {trackResult && trackResult !== 'not_found' && (
        <div className="mt-4 rounded-lg bg-stone-50 border border-stone-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-900 line-clamp-1">{trackResult.reason}</p>
              <p className="text-xs text-stone-500 mt-0.5">
                {t('supportTicketSentOn')}{' '}
                {trackResult.created_at ? new Date(trackResult.created_at).toLocaleDateString() : ''}
                {' • '}{t('supportTicketIdLabel')}: {String(trackResult.ticket_id || trackResult.id || '').slice(0, 8)}…
              </p>
            </div>
            {/* Un badge d'ÉTAT, pas un bouton — mais le site a retiré la forme
                pilule partout, y compris ici : rayon des cartes (0,5 rem). */}
            <span className={`inline-flex items-center rounded-lg px-4 py-1.5 text-sm font-semibold ${statusBadgeColor(trackResult.status)}`}>
              {t('supportTicketStatusLabel')}: {trackResult.status}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
