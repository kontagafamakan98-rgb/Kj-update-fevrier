import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, CheckCircle, ArrowLeft } from 'lucide-react';
import { supportAPI } from '../services/apiEndpoints';
import { handleApiError } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';

// Les textes de l'assistant vivent dans les dictionnaires du dépôt
// (src/i18n/*.json, clés `supportQuestion…` / `supportError…`) : ils étaient
// auparavant construits par la page dans une prop `copy`, elle-même alimentée
// par un dictionnaire local de cinq langues.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-.]{6,20}$/;

// Renvoie la CLÉ i18n du message d'erreur (ou une chaîne vide) : la validation
// ne connaît donc aucun texte, et un champ invalide ne peut pas afficher autre
// chose que ce que le dictionnaire publie.
const validateField = (key, value) => {
  const v = (value || '').trim();
  if (key === 'full_name' && v.length < 2) return 'supportErrorFullName';
  if (key === 'phone' && !PHONE_RE.test(v)) return 'supportErrorPhone';
  if (key === 'email' && !EMAIL_RE.test(v)) return 'supportErrorEmail';
  if (key === 'reason' && !v) return 'supportErrorReason';
  if (key === 'message' && v.length < 5) return 'supportErrorMessage';
  return '';
};

export default function RobotChat({ onBack }) {
  const { user } = useAuth();
  const { t } = useLanguage();

  const STEPS = [
    { key: 'full_name', question: t('supportQuestion1'), placeholder: t('supportPlaceholder1') },
    { key: 'phone', question: t('supportQuestion2'), placeholder: t('supportPlaceholder2') },
    { key: 'email', question: t('supportQuestion3'), placeholder: t('supportPlaceholder3') },
    { key: 'reason', question: t('supportQuestion4'), placeholder: t('supportPlaceholder4'), isReason: true },
    { key: 'message', question: t('supportQuestion5'), placeholder: t('supportPlaceholder5'), isTextarea: true },
  ];

  // Les six motifs proposés : chaque clé est écrite EN CLAIR dans un appel
  // t('…') (jamais construite), donc le garde de couverture i18n les vérifie
  // une par une — une clé mal orthographiée rougit au lieu d'afficher son nom
  // à l'utilisateur.
  const MOTIFS = [
    t('supportReason1'),
    t('supportReason2'),
    t('supportReason3'),
    t('supportReason4'),
    t('supportReason5'),
    t('supportReason6'),
  ];

  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState({
    full_name: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '',
    phone: user?.phone || '',
    email: user?.email || '',
    reason: '',
    message: '',
  });
  const [inputValue, setInputValue] = useState(answers[STEPS[0].key] || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [lastTicketId, setLastTicketId] = useState('');
  const [submitError, setSubmitError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [stepIndex, submitted]);

  const currentStep = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  const handleNext = () => {
    const errKey = validateField(currentStep.key, inputValue);
    if (errKey) {
      setError(t(errKey));
      return;
    }
    const nextAnswers = { ...answers, [currentStep.key]: inputValue.trim() };
    setAnswers(nextAnswers);
    setError('');

    if (isLastStep) {
      submitTicket(nextAnswers);
      return;
    }
    const nextIndex = stepIndex + 1;
    setStepIndex(nextIndex);
    setInputValue(nextAnswers[STEPS[nextIndex].key] || '');
  };

  const submitTicket = async (finalAnswers) => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const response = await supportAPI.createTicket({ ...finalAnswers, channel: 'robot' });
      const ticketId = response?.data?.ticket_id || response?.ticket_id || '';
      setLastTicketId(ticketId);
      if (ticketId) {
        try {
          localStorage.setItem('kojo_last_ticket', JSON.stringify({
            id: ticketId,
            email: finalAnswers.email,
          }));
        } catch (_e) {
          // localStorage non disponible
        }
      }
      setSubmitted(true);
    } catch (err) {
      setSubmitError(handleApiError(err, t('supportGenericError')));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle size={28} />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">{t('supportConfirmTitle')}</h2>
        <p className="text-gray-600">{t('supportConfirmMessage')}</p>
        {lastTicketId && (
          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-sm">
            <span className="text-gray-500">{t('supportYourTicketId')} : </span>
            <span className="font-mono font-semibold text-gray-900">{lastTicketId}</span>
          </div>
        )}
        <button onClick={onBack} className="mt-6 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          {t('supportBack')}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600" aria-label={t('supportBack')}>
          <ArrowLeft size={18} />
        </button>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Bot size={18} /></span>
        <span className="text-sm font-semibold text-gray-900">{t('supportAssistantName')}</span>
        <span className="ml-auto text-xs text-gray-400">{t('supportStep')} {stepIndex + 1}/{STEPS.length}</span>
      </div>

      <div className="space-y-3 mb-4 max-h-[40vh] overflow-y-auto pr-1">
        {STEPS.slice(0, stepIndex).map((step) => (
          <React.Fragment key={step.key}>
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-2 text-sm text-gray-700">{step.question}</div>
            </div>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-orange-600 px-4 py-2 text-sm text-white">{answers[step.key]}</div>
            </div>
          </React.Fragment>
        ))}
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-2 text-sm text-gray-700">{currentStep.question}</div>
        </div>
        <div ref={bottomRef} />
      </div>

      {currentStep.isReason ? (
        <div className="flex flex-wrap gap-2 mb-3">
          {MOTIFS.map((motif) => (
            <button
              key={motif}
              type="button"
              onClick={() => setInputValue(motif)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${inputValue === motif ? 'border-orange-600 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {motif}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        {currentStep.isTextarea ? (
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={currentStep.placeholder}
            rows={3}
            className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        ) : (
          <input
            type={currentStep.key === 'email' ? 'email' : 'text'}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNext(); }}
            placeholder={currentStep.placeholder}
            className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        )}
        <button
          onClick={handleNext}
          disabled={submitting}
          className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-60"
          aria-label="Send"
        >
          <Send size={18} />
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {submitting && <p className="mt-2 text-sm text-gray-500">{t('supportSending')}</p>}
      {submitError && <p className="mt-2 text-sm text-red-600">{submitError}</p>}
    </div>
  );
}
