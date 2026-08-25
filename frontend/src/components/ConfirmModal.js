import { useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

/**
 * ConfirmModal — dialogue de confirmation accessible (remplace window.confirm).
 *
 * Suit le design Kojo (overlay noir, carte rounded-2xl, même gestion du focus
 * que JobCreateModal/ProposalModal) : focus initial dans la modale, fermeture
 * à Échap, restauration du focus sur l'élément déclencheur à la fermeture.
 *
 * Props :
 * - open        : booléen — affiche la modale
 * - title       : titre (annoncé par aria-labelledby)
 * - message     : texte d'explication de l'action
 * - confirmLabel: libellé du bouton de confirmation
 * - cancelLabel : libellé du bouton d'annulation
 * - variant     : 'danger' (bouton rouge, défaut) | 'primary' (orange)
 * - loading     : désactive le bouton et affiche un état « en cours »
 * - loadingLabel: texte affiché pendant loading (ex. « Suppression... »)
 * - onConfirm   : callback de confirmation
 * - onCancel    : callback d'annulation
 */
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  loading = false,
  loadingLabel,
  onConfirm,
  onCancel,
}) {
  const { t } = useLanguage();
  const dialogRef = useRef(null);
  const idRef = useRef(`confirm-modal-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;
    dialogRef.current?.focus();

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !loading) onCancel?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [open, loading, onCancel]);

  if (!open) return null;

  const confirmClass =
    variant === 'primary'
      ? 'bg-orange-600 hover:bg-orange-700'
      : 'bg-red-600 hover:bg-red-700';

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${idRef.current}-title`}
      tabIndex={-1}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4 py-6"
      onMouseDown={(e) => {
        // Clic sur le fond (pas sur la carte) → annule, sauf pendant loading.
        if (e.target === e.currentTarget && !loading) onCancel?.();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 pt-6">
          <h2
            id={`${idRef.current}-title`}
            className="text-lg font-bold text-gray-900"
          >
            {title}
          </h2>
        </div>

        <div className="px-6 py-4">
          <p className="text-sm text-gray-600 leading-relaxed">{message}</p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 px-6 pb-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl border border-gray-200 px-5 py-3 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {cancelLabel || t('cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-xl px-5 py-3 font-semibold text-white disabled:opacity-60 ${confirmClass}`}
          >
            {loading && loadingLabel ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
