import React, { useState, useRef, useEffect } from 'react';
import { Phone, Mail, MapPin, MessageCircle, Bot, Send, CheckCircle, ArrowLeft } from 'lucide-react';
import { supportAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const CONTACT = {
  name: 'Kojo',
  phone: '+18193003507',
  phoneDisplay: '+1 819 300 3507',
  email: 'Kojoapp98@gmail.com',
  address: 'Hamdallaye ACI 2000, Bamako, Mali',
  whatsappUrl: 'https://wa.me/18193003507',
};

const REASONS = [
  'Problème de paiement',
  'Problème avec un travailleur',
  'Problème avec un client',
  'Compte / connexion',
  'Signaler un bug',
  'Autre',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-.]{6,20}$/;

const STEPS = [
  { key: 'full_name', question: "Bonjour 👋 Je suis l'assistant Kojo. Pour commencer, quel est votre nom complet ?", placeholder: 'Votre nom complet' },
  { key: 'phone', question: 'Merci ! Quel est votre numéro de téléphone ?', placeholder: 'Ex : +223 70 12 34 56' },
  { key: 'email', question: 'Et votre adresse e-mail ?', placeholder: 'Ex : nom@exemple.com' },
  { key: 'reason', question: 'Quelle est la raison de votre demande ?', placeholder: 'Choisissez ou décrivez en un mot', isReason: true },
  { key: 'message', question: 'Décrivez votre problème ou votre besoin en détail, nous ferons de notre mieux pour vous aider.', placeholder: 'Décrivez votre demande ici...', isTextarea: true },
];

function validateField(key, value) {
  const trimmed = (value || '').trim();
  if (key === 'full_name') {
    if (trimmed.length < 2) return 'Merci d’indiquer votre nom complet.';
  }
  if (key === 'phone') {
    if (!PHONE_RE.test(trimmed)) return 'Ce numéro ne semble pas valide.';
  }
  if (key === 'email') {
    if (!EMAIL_RE.test(trimmed)) return 'Cette adresse e-mail ne semble pas valide.';
  }
  if (key === 'reason') {
    if (trimmed.length < 2) return 'Merci d’indiquer la raison de votre demande.';
  }
  if (key === 'message') {
    if (trimmed.length < 5) return 'Merci de décrire votre demande un peu plus (au moins 5 caractères).';
  }
  return '';
}

function DirectContactCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-1">Contacter directement le support</h2>
      <p className="text-sm text-gray-500 mb-5">Nous sommes joignables aux coordonnées ci-dessous.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <a href={`tel:${CONTACT.phone}`} className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Phone size={18} /></span>
          <div>
            <div className="text-sm font-semibold text-gray-900">Appeler</div>
            <div className="text-xs text-gray-500">{CONTACT.phoneDisplay}</div>
          </div>
        </a>

        <a href={CONTACT.whatsappUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><MessageCircle size={18} /></span>
          <div>
            <div className="text-sm font-semibold text-gray-900">WhatsApp</div>
            <div className="text-xs text-gray-500">{CONTACT.phoneDisplay}</div>
          </div>
        </a>

        <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent('Contact KOJO')}`} className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600"><Mail size={18} /></span>
          <div>
            <div className="text-sm font-semibold text-gray-900">Envoyer un e-mail</div>
            <div className="text-xs text-gray-500 break-all">{CONTACT.email}</div>
          </div>
        </a>

        <div className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600"><MapPin size={18} /></span>
          <div>
            <div className="text-sm font-semibold text-gray-900">Adresse</div>
            <div className="text-xs text-gray-500">{CONTACT.address}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RobotChat({ onBack }) {
  const { user } = useAuth();
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
  const [submitError, setSubmitError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [stepIndex, submitted]);

  const currentStep = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  const handleNext = () => {
    const err = validateField(currentStep.key, inputValue);
    if (err) {
      setError(err);
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
      await supportAPI.createTicket({ ...finalAnswers, channel: 'robot' });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err?.response?.data?.detail
          ? String(err.response.data.detail)
          : "Une erreur est survenue, merci de réessayer ou d'utiliser un moyen de contact direct."
      );
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
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Demande envoyée</h2>
        <p className="text-gray-600">Merci, votre demande a bien été envoyée. Notre équipe vous répondra dans les meilleurs délais.</p>
        <button onClick={onBack} className="mt-6 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          Retour
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600" aria-label="Retour">
          <ArrowLeft size={18} />
        </button>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Bot size={18} /></span>
        <span className="text-sm font-semibold text-gray-900">Assistant Kojo</span>
        <span className="ml-auto text-xs text-gray-400">Étape {stepIndex + 1}/{STEPS.length}</span>
      </div>

      {/* Historique des questions/reponses deja donnees */}
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
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setInputValue(r)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${inputValue === r ? 'border-orange-600 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {r}
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
          aria-label="Envoyer"
        >
          <Send size={18} />
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {submitting && <p className="mt-2 text-sm text-gray-500">Envoi en cours...</p>}
      {submitError && <p className="mt-2 text-sm text-red-600">{submitError}</p>}
    </div>
  );
}

const Support = () => {
  const [mode, setMode] = useState(null); // null | 'robot' | 'direct'

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Support</h1>
        <p className="text-gray-600">Une question, un problème ? Nous sommes là pour vous aider.</p>
      </div>

      {mode === null && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <button
            onClick={() => setMode('robot')}
            className="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm hover:border-orange-300 hover:shadow-md transition-all"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Bot size={24} /></span>
            <span className="font-semibold text-gray-900">Parler avec le robot</span>
            <span className="text-xs text-gray-500">L’assistant vous guide en quelques questions</span>
          </button>
          <button
            onClick={() => setMode('direct')}
            className="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm hover:border-orange-300 hover:shadow-md transition-all"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><Phone size={24} /></span>
            <span className="font-semibold text-gray-900">Contacter directement le support</span>
            <span className="text-xs text-gray-500">Appel, e-mail ou WhatsApp</span>
          </button>
        </div>
      )}

      {mode === 'robot' && (
        <div className="mb-6">
          <RobotChat onBack={() => setMode(null)} />
        </div>
      )}

      {mode === 'direct' && (
        <div className="mb-4">
          <button onClick={() => setMode(null)} className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft size={16} /> Retour
          </button>
        </div>
      )}

      {/* Les coordonnées directes restent toujours visibles, meme apres avoir choisi le robot */}
      <DirectContactCard />
    </div>
  );
};

export default Support;
