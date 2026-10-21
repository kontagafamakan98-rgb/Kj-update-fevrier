import { useMemo, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { makeScopedTranslator } from '../utils/pack2PageI18n/jobDetails';

/**
 * Fin de mission — les DEUX temps, du côté qui les voit.
 *
 * ── Le défaut que ce panneau ferme ─────────────────────────────────────────
 * L'argent séquestré ne partait que sur un clic du CLIENT (« Travail terminé »).
 * Un client injoignable laissait donc le travailleur impayé indéfiniment. Ici,
 * le travailleur déclare la fin (note obligatoire + photos), le client valide,
 * et à défaut de validation le serveur libère à l'échéance — le panneau AFFICHE
 * cette échéance au lieu de la laisser deviner.
 *
 * ── Ce que le composant ne fait pas ────────────────────────────────────────
 * Aucun appel réseau : `onMark` et `onConfirm` viennent de la page, qui possède
 * le jeton, la gestion d'erreur et le rafraîchissement. Un composant qui
 * appellerait l'API lui-même serait intestable sans doublure réseau.
 *
 * ── Les trois états, et rien d'autre ───────────────────────────────────────
 *   • `marked`    : la déclaration attend le client (ou l'échéance) ;
 *   • `confirmed` / `auto_released` : le paiement est parti ;
 *   • `auto_release_blocked` : aucun séquestre trouvé — un humain doit regarder.
 * Le formulaire n'apparaît qu'au travailleur attribué, sur une mission en cours.
 */
const MAX_PHOTOS = 3;
const MIN_NOTE = 20;

const formatEcheance = (valeur) => {
  if (!valeur) return '';
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch (_err) {
    return '';
  }
};

export default function CompletionPanel({
  job,
  isOwner = false,
  isWorker = false,
  onMark,
  onConfirm,
  marking = false,
  confirming = false,
  error = '',
}) {
  const { currentLanguage, t } = useLanguage();
  const pageT = useMemo(
    () => makeScopedTranslator(currentLanguage, t),
    [currentLanguage, t],
  );
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]);

  const completion = job?.completion || null;
  const peutDeclarer = isWorker && !completion && job?.status === 'in_progress';
  if (!completion && !peutDeclarer) return null;

  const noteTropCourte = note.trim().length > 0 && note.trim().length < MIN_NOTE;
  const echeance = formatEcheance(completion?.auto_release_at);
  const etat = completion?.state;

  return (
    <section className="carte-editoriale carte-publique" aria-labelledby="completion-panel-title">
      <h2 id="completion-panel-title" className="titre-carte-app">
        {pageT('completionTitle')}
      </h2>

      {error ? (
        <p role="alert" className="mt-3 rounded-[3px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {/* ── Premier temps : le travailleur déclare ───────────────────────── */}
      {peutDeclarer ? (
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (note.trim().length < MIN_NOTE || marking) return;
            onMark?.({ note: note.trim(), files: photos });
          }}
        >
          <p className="text-sm text-stone-600">{pageT('completionIntro')}</p>

          <div>
            <label htmlFor="completion-note" className="block text-sm font-semibold text-stone-800">
              {pageT('completionNoteLabel')}
            </label>
            <textarea
              id="completion-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              maxLength={1000}
              placeholder={pageT('completionNotePlaceholder')}
              aria-describedby={noteTropCourte ? 'completion-note-help' : undefined}
              className="mt-1 w-full rounded-[3px] border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            {noteTropCourte ? (
              <p id="completion-note-help" className="mt-1 text-xs text-rose-600">
                {pageT('completionNoteTooShort')}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="completion-photos" className="block text-sm font-semibold text-stone-800">
              {pageT('completionPhotosLabel')}
            </label>
            <input
              id="completion-photos"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => setPhotos(Array.from(event.target.files || []).slice(0, MAX_PHOTOS))}
              className="mt-1 block w-full text-sm text-stone-600"
            />
            <p className="mt-1 text-xs text-stone-500">{pageT('completionPhotosHint')}</p>
            {photos.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-xs text-stone-600">
                {photos.map((photo) => (
                  <li key={`${photo.name}-${photo.size}`}>{photo.name}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={note.trim().length < MIN_NOTE || marking}
            className="rounded-[3px] bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {marking ? pageT('completionSubmitting') : pageT('completionSubmit')}
          </button>
        </form>
      ) : null}

      {/* ── Déclaration en attente, ou déjà tranchée ─────────────────────── */}
      {completion ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-stone-800">
            {etat === 'marked' ? pageT('completionMarkedTitle') : pageT('completionConfirmed')}
          </p>

          {completion.note ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {pageT('completionProofNote')}
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-stone-700">{completion.note}</p>
            </div>
          ) : null}

          {Array.isArray(completion.proofs) && completion.proofs.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {pageT('completionProofPhotos')}
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {completion.proofs.map((url) => (
                  <li key={url}>
                    <img
                      src={url}
                      alt=""
                      width="96"
                      height="96"
                      loading="lazy"
                      className="h-24 w-24 rounded-[3px] border border-stone-200 object-cover"
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {etat === 'marked' && echeance ? (
            <p className="text-sm text-stone-600">{pageT('completionDeadline', { date: echeance })}</p>
          ) : null}

          {etat === 'marked' && isOwner ? (
            <button
              type="button"
              onClick={() => onConfirm?.()}
              disabled={confirming}
              className="rounded-[3px] bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {confirming ? pageT('completionConfirming') : pageT('completionConfirm')}
            </button>
          ) : null}

          {etat === 'marked' && isWorker ? (
            <p className="text-sm text-stone-500">{pageT('completionWaitingClient')}</p>
          ) : null}

          {etat === 'auto_release_blocked' ? (
            <p className="rounded-[3px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {pageT('completionBlocked')}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
