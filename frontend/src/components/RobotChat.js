import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, CheckCircle, ArrowLeft, MessageSquarePlus } from 'lucide-react';
import { supportAPI } from '../services/apiEndpoints';
import { handleApiError } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';

// DEUX MODES, DEUX CANAUX POUR LA MÊME DEMANDE.
//
//   * `chat` (défaut) : l'assistant répond aux questions, dans la langue du
//     visiteur, via /api/support/robot/chat. C'est le gateway IA du backend —
//     le navigateur ne voit ni modèle, ni jeton. Quand l'assistant estime
//     qu'une demande doit être déposée (ou quand le gateway est indisponible),
//     on bascule sur le questionnaire.
//   * `form` : le questionnaire historique, INCHANGÉ (mêmes clés de
//     dictionnaire, même validation, même `POST /support/tickets` avec
//     `channel: 'robot'`). Il reste accessible à tout moment, parce que
//     déposer une demande ne dépend jamais d'un tiers qui répond.
//
// Les textes viennent des dictionnaires du dépôt (src/i18n/*.json). Ce
// composant n'écrit AUCUN libellé en dur.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-.]{6,20}$/;

// Miroir de la borne serveur (`RobotChatRequest` : 16 tours maximum) : on
// n'envoie jamais plus que ce que le backend accepte, sinon la conversation
// se mettrait à répondre 422 après quelques échanges.
const MAX_TOURS = 16;

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
  const { t, currentLanguage } = useLanguage();

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

  const [mode, setMode] = useState('chat'); // 'chat' | 'form'
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

  // État du chat : l'historique est la SEULE source de vérité envoyée au
  // backend (rôles `user`/`assistant` uniquement — le prompt système vit côté
  // serveur, donc il ne peut pas être réécrit ici).
  const [conversation, setConversation] = useState([]);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [chatError, setChatError] = useState('');
  const [ticketSuggested, setTicketSuggested] = useState(false);

  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [stepIndex, submitted, mode, conversation.length, asking]);

  const currentStep = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  // ── Mode chat ─────────────────────────────────────────────────────────────

  const envoyerQuestion = async () => {
    const question = draft.trim();
    if (!question || asking) return;

    const historique = [...conversation, { role: 'user', content: question }].slice(-MAX_TOURS);
    setConversation(historique);
    setDraft('');
    setChatError('');
    setTicketSuggested(false);
    setAsking(true);
    try {
      const reponse = await supportAPI.robotChat({ messages: historique, language: currentLanguage });
      // axios rend `response.data` ; un éventuel client déjà aplati rend l'objet
      // tel quel — les deux formes sont acceptées, comme pour createTicket.
      const corps = reponse?.data || reponse || {};
      const texte = typeof corps.reply === 'string' ? corps.reply.trim() : '';
      if (!texte) throw new Error('réponse vide');
      setConversation((precedent) => [...precedent, { role: 'assistant', content: texte }]);
      setTicketSuggested(Boolean(corps.ticket_suggested));
    } catch (err) {
      // L'assistant indisponible n'est pas une impasse : le message d'erreur
      // nomme le repli, et le bouton de dépôt reste à l'écran.
      setChatError(handleApiError(err, t('supportGenericError')));
    } finally {
      setAsking(false);
    }
  };

  // ── Mode questionnaire (inchangé) ─────────────────────────────────────────

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
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs p-8 text-center">
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

  const enTete = (sousTitre) => (
    <div className="flex items-center gap-2 mb-5">
      <button onClick={onBack} className="text-gray-400 hover:text-gray-600" aria-label={t('supportBack')}>
        <ArrowLeft size={18} />
      </button>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Bot size={18} /></span>
      <span className="text-sm font-semibold text-gray-900">{t('supportAssistantName')}</span>
      <span className="ml-auto text-xs text-gray-400">{sousTitre}</span>
    </div>
  );

  if (mode === 'chat') {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-xs p-6">
        {enTete('')}

        <div className="space-y-3 mb-4 max-h-[40vh] overflow-y-auto pr-1">
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-2 text-sm text-gray-700">{t('robotChatIntro')}</div>
          </div>
          {conversation.map((tour, index) => (
            <div key={`${tour.role}-${index}`} className={tour.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  tour.role === 'user'
                    ? 'max-w-[85%] rounded-2xl rounded-tr-sm bg-orange-600 px-4 py-2 text-sm text-white whitespace-pre-line'
                    : 'max-w-[85%] rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-2 text-sm text-gray-700 whitespace-pre-line'
                }
              >
                {tour.content}
              </div>
            </div>
          ))}
          {asking && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-2 text-sm text-gray-500">{t('supportSending')}</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {ticketSuggested && (
          <div className="mb-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
            <p>{t('robotChatTicketHint')}</p>
            <button
              type="button"
              onClick={() => setMode('form')}
              className="mt-2 inline-flex items-center gap-1 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700"
            >
              <MessageSquarePlus size={14} /> {t('robotChatStartTicket')}
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                envoyerQuestion();
              }
            }}
            placeholder={t('robotChatPlaceholder')}
            rows={2}
            className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
          />
          <button
            onClick={envoyerQuestion}
            disabled={asking || !draft.trim()}
            className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-60"
            aria-label={t('robotChatSend')}
          >
            <Send size={18} />
          </button>
        </div>

        {chatError && <p className="mt-2 text-sm text-red-600">{chatError}</p>}

        {/* Le questionnaire n'est jamais derrière l'IA : ce bouton existe même
            quand le gateway est indisponible, et c'est ce qui rend le dépôt
            d'une demande possible sans dépendre d'un tiers. */}
        {!ticketSuggested && (
          <button
            type="button"
            onClick={() => setMode('form')}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:text-orange-900"
          >
            <MessageSquarePlus size={14} /> {t('robotChatStartTicket')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-xs p-6">
      {enTete(`${t('supportStep')} ${stepIndex + 1}/${STEPS.length}`)}

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
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${inputValue === motif ? 'border-orange-600 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
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
            className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
          />
        ) : (
          <input
            type={currentStep.key === 'email' ? 'email' : 'text'}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNext(); }}
            placeholder={currentStep.placeholder}
            className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
          />
        )}
        <button
          onClick={handleNext}
          disabled={submitting}
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-60"
          aria-label={t('robotChatSend')}
        >
          <Send size={18} />
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {submitting && <p className="mt-2 text-sm text-gray-500">{t('supportSending')}</p>}
      {submitError && <p className="mt-2 text-sm text-red-600">{submitError}</p>}

      <button
        type="button"
        onClick={() => setMode('chat')}
        className="mt-3 text-xs font-semibold text-orange-700 hover:text-orange-900"
      >
        {t('robotChatBackToChat')}
      </button>
    </div>
  );
}
