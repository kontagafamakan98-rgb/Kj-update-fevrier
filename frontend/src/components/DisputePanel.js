import { useMemo, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { makeScopedTranslator } from '../utils/pack2PageI18n/jobDetails';

/**
 * Litige tracé — le désaccord, du côté des PARTIES.
 *
 * ── Le défaut que ce panneau ferme ────────────────────────────────────────
 * Le séquestre à deux temps réglait le client SILENCIEUX. Il ne réglait pas le
 * client qui CONTESTE : la seule voie était un ticket support, sans état, sans
 * échéance et sans trace — et l'échéance de libération automatique payait le
 * travailleur sans qu'aucun arbitre ait lu le désaccord. Un litige déclaré et
 * un client injoignable produisaient donc le même geste.
 *
 * ── Ce que le composant ne fait PAS ───────────────────────────────────────
 * Aucun appel réseau : `onOpen` et `onWithdraw` viennent de la page, qui
 * possède le jeton, la gestion d'erreur et le rafraîchissement de la mission.
 * Le litige n'est pas lu par une route dédiée non plus : il voyage avec la
 * mission (`job.dispute`), que la page a déjà chargée — deux sources pour un
 * même fait obligeraient l'écran à décider laquelle croire.
 *
 * ── Les DEUX versions ────────────────────────────────────────────────────
 * Celui qui ouvre écrit le motif ; l'AUTRE partie répond UNE fois (position +
 * note bornée), et les deux textes se lisent ici. Sans cette réponse, l'arbitre
 * ne lisait qu'un son de cloche, et l'autre partie n'avait aucun moyen de dire
 * sa version avant que l'argent bouge. Le formulaire n'est proposé qu'à celui
 * qui n'a pas ouvert, et disparaît une fois la réponse envoyée : une réponse
 * qu'on peut réécrire transformerait l'arbitrage en négociation.
 *
 * ── Ce qui n'est pas un geste de partie ──────────────────────────────────
 * Trancher appartient au PROPRIÉTAIRE (`/owner/litiges`) : le panneau dit qui
 * décide et jusqu'à quand, il ne propose jamais de décider soi-même.
 */
const MIN_REASON = 20;
const MIN_RESPONSE = 20;

const formatDate = (valeur) => {
  if (!valeur) return '';
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch (_err) {
    return '';
  }
};

// Les libellés d'état sont résolus par un `switch` de LITTÉRAUX : le garde
// d'hygiène des dictionnaires (`scripts/check-pack2-i18n-hygiene.js`) ne voit
// que les appels statiques, et un `pageT(MAP[etat])` ferait passer ces quatre
// clés pour inutilisées.
const libelleEtat = (etat, pageT) => {
  switch (etat) {
    case 'withdrawn':
      return pageT('disputeStateWithdrawn');
    case 'resolved':
      return pageT('disputeStateResolved');
    case 'expired':
      return pageT('disputeStateExpired');
    default:
      return pageT('disputeStateOpen');
  }
};

// Même raison que `libelleEtat` : les libellés d'une POSITION se résolvent par
// un `switch` de LITTÉRAUX, jamais par une table indexée — le garde d'hygiène
// des dictionnaires ne voit que les appels statiques, et une table ferait
// passer ces deux clés pour inutilisées.
const libellePosition = (position, pageT) => {
  switch (position) {
    case 'refund_client':
      return pageT('disputeResponsePositionRefund');
    default:
      return pageT('disputeResponsePositionRelease');
  }
};

export default function DisputePanel({
  job,
  isOwner = false,
  isWorker = false,
  currentUserId = '',
  onOpen,
  onRespond,
  onWithdraw,
  opening = false,
  responding = false,
  withdrawing = false,
  error = '',
  notice = '',
}) {
  const { currentLanguage, t } = useLanguage();
  const pageT = useMemo(
    () => makeScopedTranslator(currentLanguage, t),
    [currentLanguage, t],
  );
  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [position, setPosition] = useState('');
  const [reponse, setReponse] = useState('');

  const dispute = job?.dispute || null;
  const partie = Boolean(isOwner || isWorker);
  const missionEnCours = job?.status === 'in_progress';
  const peutOuvrir = partie && missionEnCours && !dispute && Boolean(job?.assigned_worker_id);
  if (!dispute && !peutOuvrir) return null;

  const raisonTropCourte = reason.trim().length > 0 && reason.trim().length < MIN_REASON;
  const reponseTropCourte = reponse.trim().length > 0 && reponse.trim().length < MIN_RESPONSE;
  const ouvert = dispute?.state === 'open';
  const ouvreurEstMoi = Boolean(currentUserId)
    && String(dispute?.opened_by || '') === String(currentUserId);
  const autreReponse = dispute?.response || null;
  // Une seule réponse, et seulement par la partie qui n'a pas ouvert : celle
  // qui a ouvert s'est déjà exprimée par son motif.
  const peutRepondre = partie && ouvert && !ouvreurEstMoi && !autreReponse;
  const echeance = formatDate(dispute?.decision_deadline_at);

  return (
    <section className="carte-editoriale carte-publique" aria-labelledby="dispute-panel-title">
      <h2 id="dispute-panel-title" className="titre-carte-app">
        {pageT('disputeTitle')}
      </h2>

      {error ? (
        <p role="alert" className="mt-3 rounded-[3px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-[3px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}

      {/* ── Aucun litige : la partie peut ouvrir un désaccord ────────────── */}
      {peutOuvrir ? (
        formOpen ? (
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (reason.trim().length < MIN_REASON || opening) return;
              onOpen?.(reason.trim());
            }}
          >
            <p className="text-sm text-stone-600">{pageT('disputeIntro')}</p>
            <div>
              <label htmlFor="dispute-reason" className="block text-sm font-semibold text-stone-800">
                {pageT('disputeReasonLabel')}
              </label>
              <textarea
                id="dispute-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                maxLength={1000}
                placeholder={pageT('disputeReasonPlaceholder')}
                aria-describedby={raisonTropCourte ? 'dispute-reason-help' : undefined}
                className="mt-1 w-full rounded-[3px] border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
              />
              {raisonTropCourte ? (
                <p id="dispute-reason-help" className="mt-1 text-xs text-rose-600">
                  {pageT('disputeReasonTooShort')}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={reason.trim().length < MIN_REASON || opening}
                className="rounded-[3px] bg-rose-600 px-4 py-3 font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {opening ? pageT('disputeSubmitting') : pageT('disputeSubmit')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  setReason('');
                }}
                className="rounded-[3px] border border-stone-200 px-4 py-3 font-semibold text-stone-700 hover:bg-stone-50"
              >
                {pageT('disputeCancel')}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-stone-600">{pageT('disputePrompt')}</p>
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="rounded-[3px] border border-rose-200 bg-rose-50 px-4 py-3 font-semibold text-rose-700 hover:bg-rose-100"
            >
              {pageT('disputeOpenButton')}
            </button>
          </div>
        )
      ) : null}

      {/* ── Un litige existe : son ÉTAT, son motif, son échéance ─────────── */}
      {dispute ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-[3px] border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-semibold text-stone-700">
              {libelleEtat(dispute.state, pageT)}
            </span>
            <span className="text-xs text-stone-500">
              {dispute.opened_by_role === 'worker'
                ? pageT('disputeOpenedByWorker')
                : pageT('disputeOpenedByClient')}
            </span>
          </div>

          {ouvert ? (
            <p className="rounded-[3px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {echeance
                ? pageT('disputeFrozen', { date: echeance })
                : pageT('disputeFrozenNoDate')}
            </p>
          ) : null}

          {dispute.reason ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {pageT('disputeReasonShow')}
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-stone-700">{dispute.reason}</p>
            </div>
          ) : null}

          {/* ── La version de l'AUTRE partie ─────────────────────────────── */}
          {autreReponse ? (
            <div className="rounded-[3px] border border-stone-200 bg-stone-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {pageT('disputeResponseTitle')}
              </p>
              <p className="mt-1 text-sm font-semibold text-stone-800">
                {pageT('disputeResponsePositionShow', {
                  position: libellePosition(autreReponse.position, pageT),
                })}
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-stone-700">{autreReponse.note}</p>
            </div>
          ) : null}

          {/* ── La réponse manquante : le formulaire est à l'autre partie ── */}
          {peutRepondre ? (
            <form
              className="space-y-4 rounded-[3px] border border-stone-200 px-3 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!position || reponse.trim().length < MIN_RESPONSE || responding) return;
                onRespond?.({ position, note: reponse.trim() });
              }}
            >
              <fieldset>
                <legend className="text-sm font-semibold text-stone-800">
                  {pageT('disputeResponsePositionLabel')}
                </legend>
                <div className="mt-2 space-y-2">
                  <label
                    htmlFor={`dispute-position-release-${job?.id || ''}`}
                    className="flex items-center gap-2 text-sm text-stone-700"
                  >
                    <input
                      id={`dispute-position-release-${job?.id || ''}`}
                      type="radio"
                      name={`dispute-position-${job?.id || ''}`}
                      value="release_worker"
                      checked={position === 'release_worker'}
                      onChange={() => setPosition('release_worker')}
                    />
                    {pageT('disputeResponsePositionRelease')}
                  </label>
                  <label
                    htmlFor={`dispute-position-refund-${job?.id || ''}`}
                    className="flex items-center gap-2 text-sm text-stone-700"
                  >
                    <input
                      id={`dispute-position-refund-${job?.id || ''}`}
                      type="radio"
                      name={`dispute-position-${job?.id || ''}`}
                      value="refund_client"
                      checked={position === 'refund_client'}
                      onChange={() => setPosition('refund_client')}
                    />
                    {pageT('disputeResponsePositionRefund')}
                  </label>
                </div>
              </fieldset>

              <div>
                <label htmlFor="dispute-response-note" className="block text-sm font-semibold text-stone-800">
                  {pageT('disputeResponseNoteLabel')}
                </label>
                <textarea
                  id="dispute-response-note"
                  value={reponse}
                  onChange={(event) => setReponse(event.target.value)}
                  rows={4}
                  maxLength={1000}
                  placeholder={pageT('disputeResponseNotePlaceholder')}
                  aria-describedby={reponseTropCourte ? 'dispute-response-help' : undefined}
                  className="mt-1 w-full rounded-[3px] border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
                {reponseTropCourte ? (
                  <p id="dispute-response-help" className="mt-1 text-xs text-rose-600">
                    {pageT('disputeResponseTooShort')}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-stone-500">{pageT('disputeResponseOneShot')}</p>
              </div>

              <button
                type="submit"
                disabled={!position || reponse.trim().length < MIN_RESPONSE || responding}
                className="rounded-[3px] bg-stone-800 px-4 py-3 font-semibold text-white hover:bg-stone-900 disabled:opacity-60"
              >
                {responding ? pageT('disputeResponseSubmitting') : pageT('disputeResponseSubmit')}
              </button>
            </form>
          ) : null}

          {ouvert && ouvreurEstMoi && !autreReponse ? (
            <p className="text-sm text-stone-500">{pageT('disputeResponseOpenerHint')}</p>
          ) : null}

          {dispute.state === 'resolved' ? (
            <p className="text-sm text-stone-700">
              {dispute.decision === 'release_worker'
                ? pageT('disputeDecisionRelease')
                : pageT('disputeDecisionRefund')}
            </p>
          ) : null}

          {dispute.state === 'open' && ouvreurEstMoi ? (
            <button
              type="button"
              onClick={() => onWithdraw?.()}
              disabled={withdrawing}
              className="rounded-[3px] border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-60"
            >
              {withdrawing ? pageT('disputeWithdrawing') : pageT('disputeWithdrawButton')}
            </button>
          ) : null}

          {dispute.state === 'open' && !ouvreurEstMoi && autreReponse ? (
            <p className="text-sm text-stone-500">{pageT('disputeWaitingOwner')}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
