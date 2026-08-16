import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { reviewAPI, handleApiError } from '../services/api';
import { makeScopedTranslator } from '../utils/pack2PageI18n';
import { safeLog } from '../utils/env';

/**
 * Avis / notes d'une mission terminée.
 * - Affiche les avis déjà publiés (nom + étoiles + commentaire).
 * - Formulaire (étoiles cliquables + commentaire) si l'utilisateur connecté
 *   n'a pas encore noté l'autre partie.
 * - Suppression possible par l'auteur de l'avis.
 */
export default function JobReviews({ jobId }) {
  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'jobReviews');

  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const myReview = reviews.find((r) => r.reviewer_id === user?.id);

  const loadReviews = useCallback(async () => {
    try {
      const data = await reviewAPI.getJobReviews(jobId);
      setReviews(Array.isArray(data) ? data : []);
    } catch (err) {
      safeLog.error('Erreur chargement avis:', err);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const submit = async () => {
    if (!rating) {
      setError(pageT('ratingRequired'));
      return;
    }
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await reviewAPI.create(jobId, { rating, comment: comment.trim() || null });
      setSuccess(pageT('success'));
      setRating(0);
      setComment('');
      await loadReviews();
    } catch (err) {
      setError(handleApiError(err, pageT('error')));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (reviewId) => {
    setError('');
    setSuccess('');
    try {
      await reviewAPI.remove(reviewId);
      await loadReviews();
    } catch (err) {
      setError(handleApiError(err, pageT('error')));
    }
  };

  const renderStars = (value) => (
    <span className="inline-flex text-yellow-400 text-base leading-none">
      {'★'.repeat(Math.max(0, Math.min(5, Math.round(value))))}
      {'☆'.repeat(Math.max(0, 5 - Math.round(value)))}
    </span>
  );

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <p className="text-sm text-gray-500">{pageT('loading')}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">{pageT('title')}</h2>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      )}

      {reviews.length === 0 ? (
        <p className="text-sm text-gray-500">{pageT('noReviews')}</p>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <div key={review.id} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-semibold text-gray-900 truncate">
                    {review.reviewer_name || pageT('anonymous')}
                  </span>
                  {renderStars(review.rating)}
                </div>
                {review.reviewer_id === user?.id && (
                  <button
                    type="button"
                    onClick={() => remove(review.id)}
                    className="text-xs font-medium text-red-500 hover:text-red-700"
                  >
                    {pageT('delete')}
                  </button>
                )}
              </div>
              {review.comment && (
                <p className="mt-1 text-sm text-gray-600 whitespace-pre-line">{review.comment}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {!myReview && (
        <div className="mt-5 border-t border-gray-100 pt-5">
          <p className="text-sm font-medium text-gray-700 mb-2">{pageT('yourRating')}</p>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`${value} étoiles`}
                onClick={() => {
                  setRating(value);
                  setError('');
                }}
                className={`text-2xl leading-none transition-colors ${value <= rating ? 'text-yellow-400' : 'text-gray-300 hover:text-yellow-300'}`}
              >
                ★
              </button>
            ))}
            {rating > 0 && <span className="ml-2 text-sm text-gray-500">{rating}/5</span>}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            placeholder={pageT('commentPlaceholder')}
            rows={3}
            className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="mt-3 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
          >
            {submitting ? pageT('submitting') : pageT('submit')}
          </button>
        </div>
      )}
    </div>
  );
}
