import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Phone, Mail, MapPin, MessageCircle, Bot, Send, CheckCircle, ArrowLeft } from 'lucide-react';
import { supportAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';

const CONTACT = {
  phone: '+18193003507',
  phoneDisplay: '+1 819 300 3507',
  email: 'Kojoapp98@gmail.com',
  address: 'Hamdallaye ACI 2000, Bamako, Mali',
  whatsappUrl: 'https://wa.me/18193003507',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-.]{6,20}$/;

const COPY = {
  fr: {
    title: 'Support',
    subtitle: 'Une question, un problème ? Nous sommes là pour vous aider.',
    robotTitle: 'Parler avec le robot',
    robotSubtitle: "L'assistant vous guide en quelques questions",
    directTitle: 'Contacter directement le support',
    directSubtitle: 'Appel, e-mail ou WhatsApp',
    back: 'Retour',
    assistantName: 'Assistant Kojo',
    step: 'Étape',
    questions: [
      "Bonjour 👋 Je suis l'assistant Kojo. Pour commencer, quel est votre nom complet ?",
      'Merci ! Quel est votre numéro de téléphone ?',
      'Et votre adresse e-mail ?',
      'Quelle est la raison de votre demande ?',
      'Décrivez votre problème ou votre besoin en détail, nous ferons de notre mieux pour vous aider.',
    ],
    placeholders: ['Votre nom complet', 'Ex : +223 70 12 34 56', 'Ex : nom@exemple.com', 'Choisissez ou décrivez en un mot', 'Décrivez votre demande ici...'],
    reasons: ['Problème de paiement', 'Problème avec un travailleur', 'Problème avec un client', 'Compte / connexion', 'Signaler un bug', 'Autre'],
    errors: {
      full_name: 'Merci d’indiquer votre nom complet.',
      phone: 'Ce numéro ne semble pas valide.',
      email: 'Cette adresse e-mail ne semble pas valide.',
      reason: 'Merci d’indiquer la raison de votre demande.',
      message: 'Merci de décrire votre demande un peu plus (au moins 5 caractères).',
    },
    sending: 'Envoi en cours...',
    genericError: "Une erreur est survenue, merci de réessayer ou d'utiliser un moyen de contact direct.",
    confirmTitle: 'Demande envoyée',
    confirmMessage: 'Merci, votre demande a bien été envoyée. Notre équipe vous répondra dans les meilleurs délais.',
    yourTicketId: 'Votre n° de ticket',
    trackMyTicket: 'Suivre mon ticket',
    trackTitle: 'Suivre une demande existante',
    trackSubtitle: 'Entrez votre n° de ticket et l\'e-mail utilisé pour voir où en est votre demande.',
    ticketIdPlaceholder: 'N° de ticket (ex : 3fa85f64…)',
    ticketEmailPlaceholder: 'Votre e-mail',
    trackCta: 'Vérifier le statut',
    tracking: 'Vérification en cours…',
    trackNotFound: 'Aucun ticket trouvé avec ces informations.',
    ticketReason: 'Motif',
    ticketStatusLabel: 'Statut actuel',
    ticketSentOn: 'Envoyé le',
    directCardTitle: 'Contacter directement le support',
    directCardSubtitle: 'Nous sommes joignables aux coordonnées ci-dessous.',
    call: 'Appeler',
    whatsapp: 'WhatsApp',
    sendEmail: 'Envoyer un e-mail',
    address: 'Adresse',
  },
  en: {
    title: 'Support',
    subtitle: 'A question, a problem? We are here to help you.',
    robotTitle: 'Talk to the assistant',
    robotSubtitle: 'The assistant guides you through a few questions',
    directTitle: 'Contact support directly',
    directSubtitle: 'Call, email, or WhatsApp',
    back: 'Back',
    assistantName: 'Kojo Assistant',
    step: 'Step',
    questions: [
      "Hello 👋 I'm the Kojo assistant. To start, what is your full name?",
      'Thanks! What is your phone number?',
      'And your email address?',
      'What is the reason for your request?',
      'Please describe your problem or need in detail, we will do our best to help.',
    ],
    placeholders: ['Your full name', 'e.g. +223 70 12 34 56', 'e.g. name@example.com', 'Choose or describe in a few words', 'Describe your request here...'],
    reasons: ['Payment issue', 'Issue with a worker', 'Issue with a client', 'Account / login', 'Report a bug', 'Other'],
    errors: {
      full_name: 'Please enter your full name.',
      phone: 'This number does not look valid.',
      email: 'This email address does not look valid.',
      reason: 'Please indicate the reason for your request.',
      message: 'Please describe your request a bit more (at least 5 characters).',
    },
    sending: 'Sending...',
    genericError: 'Something went wrong, please try again or use a direct contact method.',
    confirmTitle: 'Request sent',
    confirmMessage: 'Thank you, your request has been sent. Our team will get back to you as soon as possible.',
    yourTicketId: 'Your ticket number',
    trackMyTicket: 'Track my ticket',
    trackTitle: 'Track an existing request',
    trackSubtitle: 'Enter your ticket number and the email you used to see the current status.',
    ticketIdPlaceholder: 'Ticket number (e.g. 123fa85f…)',
    ticketEmailPlaceholder: 'Your email',
    trackCta: 'Check status',
    tracking: 'Checking…',
    trackNotFound: 'No ticket found with these details.',
    ticketReason: 'Reason',
    ticketStatusLabel: 'Current status',
    ticketSentOn: 'Sent on',
    directCardTitle: 'Contact support directly',
    directCardSubtitle: 'You can reach us using the details below.',
    call: 'Call',
    whatsapp: 'WhatsApp',
    sendEmail: 'Send an email',
    address: 'Address',
  },
  wo: {
    title: 'Ndimbal',
    subtitle: 'Am nga laaj walla problem? Nun nekk ngir dimbali la.',
    robotTitle: 'Wax ak robot bi',
    robotSubtitle: 'Robot bi dina la topp ci ay laaj yu néew',
    directTitle: 'Jokkoo direkte ak ndimbal bi',
    directSubtitle: 'Woote, email walla WhatsApp',
    back: 'Delloo ginnaaw',
    assistantName: 'Robot Kojo',
    step: 'Tegtal',
    questions: [
      'Salaam 👋 Man robot Kojo la. Ci njëkk, naka la tudd (turu la wolewaale)?',
      'Jërëjëf! Lan mooy limero telefon bi?',
      'Naka email bi?',
      'Lu tax nga di jokkoo ak nun?',
      'Wax nu ci lu wér seen problem walla soxla, dinaa jéem jub la.',
    ],
    placeholders: ['Sa turu wolewaale', 'Ci misaal: +223 70 12 34 56', 'Ci misaal: tur@misaal.com', 'Tann walla wax ci ay baat', 'Wax fii sa laaj...'],
    reasons: ['Problem ci fey', 'Problem ak liggéeykat', 'Problem ak client', 'Kont / dugg', 'Wone bug', 'Lenn lu wéy'],
    errors: {
      full_name: 'Wax nu sa turu wolewaale.',
      phone: 'Limero bii du dëgg.',
      email: 'Email bii du dëgg.',
      reason: 'Wax nu lu tax nga di jokkoo.',
      message: 'Wax nu ci lu gën a wér (ñeenti (5) sarf yu ndaw).',
    },
    sending: 'Diñu koy yónnee...',
    genericError: 'Am na njumte, jéemaatal walla jokkoosi direkte.',
    confirmTitle: 'Laaj bi yónnee na',
    confirmMessage: 'Jërëjëf, sa laaj yónnee na. Ekip bi dina la tontu ci diirub léegi léegi.',
    yourTicketId: 'Sa limero ticket',
    trackMyTicket: 'Topp sa ticket',
    trackTitle: 'Topp laaj bi nu yónnee',
    trackSubtitle: 'Duggal limero laaj bi ak email bi ñu jëfandikoo ngir xam ni laaj biy dugg.',
    ticketIdPlaceholder: 'Limero ticket (misal: 3fa85f64…)',
    ticketEmailPlaceholder: 'Sa email',
    trackCta: 'Xamal statu bi',
    tracking: 'Diin koy xamal...',
    trackNotFound: 'Amul ticket yu bari ci xibaar yii.',
    ticketReason: 'Taxawu',
    ticketStatusLabel: 'Statu bu leegi',
    ticketSentOn: 'Yónnee ci',
    directCardTitle: 'Jokkoo direkte ak ndimbal bi',
    directCardSubtitle: 'Man ngeen a jokkoosi ci ay xibaar yii.',
    call: 'Woote',
    whatsapp: 'WhatsApp',
    sendEmail: 'Yónnee email',
    address: 'Adrese',
  },
  bm: {
    title: 'Dɛmɛni',
    subtitle: 'Ɲininkali wala gɛlɛya bɛ i bolo wa? An bɛ yan walisa ka i dɛmɛ.',
    robotTitle: 'Kuma ni robot ye',
    robotSubtitle: 'Robot bɛna i ɲɛminɛ ɲininkali damadɔ la',
    directTitle: 'Dɛmɛni jɔyɔrɔ minɛ ka a ɲɛ',
    directSubtitle: 'Weele, email walima WhatsApp',
    back: 'Kɔsegin',
    assistantName: 'Kojo dɛmɛbaga',
    step: 'Fɛɛrɛ',
    questions: [
      'Aw ni ce 👋 Ne ye Kojo dɛmɛbaga ye. Fɔlɔ la, i tɔgɔ dafalen ye mun ye?',
      'I ni ce! I telefɔni nimɔrɔ ye jumɛn ye?',
      'I email ladɛrɛsi fana?',
      'Mun na i bɛ dɛmɛni ɲini?',
      'I ka i ka gɛlɛya walima wajibi ɲɛfɔ ka ɲɛ, an bɛna cɛsiri ka i dɛmɛ.',
    ],
    placeholders: ['I tɔgɔ dafalen', "Misali la: +223 70 12 34 56", 'Misali la: tɔgɔ@misali.com', 'Sugandi walima a ɲɛfɔ kuma damadɔ la', 'I ka ɲinini ɲɛfɔ yan...'],
    reasons: ['Sara ko gɛlɛya', 'Baarakɛla ko gɛlɛya', 'Kiliyan ko gɛlɛya', 'Jatebɔ / dondon', 'Bug bɔfɔ', 'Wɛrɛ'],
    errors: {
      full_name: 'I tɔgɔ dafalen fɔ an ye.',
      phone: 'Nimɔrɔ in tɛ bɛn.',
      email: 'Email ladɛrɛsi in tɛ bɛn.',
      reason: 'I ka dɛmɛni kunfɛ fɔ an ye.',
      message: 'I ka ɲinini ɲɛfɔ ka caya (bɔgɔdaba (5) fɛnw la duguma).',
    },
    sending: 'A bɛ ci kan...',
    genericError: 'Fili dɔ kɛra, i k’a lajɛ tugun walima i ka jɔyɔrɔ wɛrɛ minɛ.',
    confirmTitle: 'Ɲinini cira',
    confirmMessage: 'I ni ce, i ka ɲinini cira. An ka jama bɛna i jaabi joona joona.',
    yourTicketId: 'I ka ɲinini nimɔrɔ',
    trackMyTicket: 'Kɔdɔmɔ i ka ɲinini',
    trackTitle: 'Ɲinini min cira ka a ɲɛ',
    trackSubtitle: 'I ka ɲinini nimɔrɔ ani email min i ka a kɛ, ka a lajɛ.',
    ticketIdPlaceholder: 'Nimɔrɔ (misali: 3fa85f64…)',
    ticketEmailPlaceholder: 'I email',
    trackCta: 'Lajɛ cogo',
    tracking: 'Lajɛ a ka tɛmɛ…',
    trackNotFound: 'Ɲinini si tɛ sɔrɔ nin kunnafoniw na.',
    ticketReason: 'Kunfɛ',
    ticketStatusLabel: 'Jɔyɔrɔ sisen',
    ticketSentOn: 'Cira',
    directCardTitle: 'Dɛmɛni jɔyɔrɔ minɛ ka a ɲɛ',
    directCardSubtitle: 'Aw bɛ se ka an sɔrɔ kunnafoni ninnu fɛ.',
    call: 'Weele',
    whatsapp: 'WhatsApp',
    sendEmail: 'Email ci',
    address: 'Ladɛrɛsi',
  },
  mos: {
    title: 'Sõngre',
    subtitle: 'Sokre wall zu-zɛka bee ne yãmb sɛba? Tõnd bee ka n na sõng yãmba.',
    robotTitle: 'Gom ne robɛto',
    robotSubtitle: 'Robɛto na n dɩl yãmb ne sok-sokã',
    directTitle: 'Loe ne sõngre pʋgẽ tao-tao',
    directSubtitle: 'Boole, email walla WhatsApp',
    back: 'Lebg n kul',
    assistantName: 'Kojo sõngda',
    step: 'Naoore',
    questions: [
      'Ne y sõngr 👋 Mam yaa Kojo sõngda. Pipi wã, yãmb yʋʋr sɩngre yaa bõe?',
      'Barka! Yãmb telefonã nomboore yaa bõe?',
      'La yãmb email-a?',
      'Bõe yĩng la y sẽn dat n loee?',
      'Wilg-y d yamb zu-zɛkã walla y sẽn dat n paam bũmbã sõma, tõnd na modg n sõng yãmba.',
    ],
    placeholders: ['Y yʋʋr sɩngre', 'Wala: +223 70 12 34 56', 'Wala: yʋʋr@misali.com', 'Yãk bɩ y wilg ne gom-bila', 'Wilg y sokre ka...'],
    reasons: ['Yaood zu-zɛka', 'Tʋm-tʋmd zu-zɛka', 'Ra-kũun zu-zɛka', 'Kont / kẽesg', 'Bug wilgre', 'Toore'],
    errors: {
      full_name: 'Wilg-y y yʋʋr sɩngre.',
      phone: 'Nomboorã ka tɩrga ye.',
      email: 'Email-ã ka tɩrg ye.',
      reason: 'Wilg-y bõe yĩng la y sẽn dat n loee.',
      message: 'Wilg-y y sokre n paase (b sẽn boond tɩ (5) gũusg-bɩ).',
    },
    sending: 'A bee n tʋmda...',
    genericError: 'Zu-zɛka n zĩnda, y modg n lebs bɩ y loe ne sõngre pʋgẽ tao-tao.',
    confirmTitle: 'Sokrã tʋme',
    confirmMessage: 'Barka, y sokrã tʋme. Tõnd sull na n leok yãmb tao-tao.',
    yourTicketId: 'Y sokrã nomboore',
    trackMyTicket: 'Perg y sokrã',
    trackTitle: 'Sokr sẽn tʋmã perg',
    trackSubtitle: 'Dɩng-y y sokrã nomboore la email ning y sẽn dɩk wã n gese a sẽn beẽ.',
    ticketIdPlaceholder: 'Sokrã nomboore (wala: 3fa85f64…)',
    ticketEmailPlaceholder: 'Y email',
    trackCta: 'Gese status',
    tracking: 'Bɛ nin gẽese…',
    trackNotFound: 'Sokr baa ka yẽ ne kibay nins ba.',
    ticketReason: 'Yĩnga',
    ticketStatusLabel: 'Status sẽn be sᴐ',
    ticketSentOn: 'Tʋm b',
    directCardTitle: 'Loe ne sõngre pʋgẽ tao-tao',
    directCardSubtitle: 'Y tõe n loe ne tõnd ne kibay nins sẽn be ka.',
    call: 'Boole',
    whatsapp: 'WhatsApp',
    sendEmail: 'Tʋm email',
    address: 'Zĩig',
  },
};

const getCopy = (lang) => COPY[lang] || COPY.fr;

function validateField(key, value, copy) {
  const trimmed = (value || '').trim();
  if (key === 'full_name' && trimmed.length < 2) return copy.errors.full_name;
  if (key === 'phone' && !PHONE_RE.test(trimmed)) return copy.errors.phone;
  if (key === 'email' && !EMAIL_RE.test(trimmed)) return copy.errors.email;
  if (key === 'reason' && trimmed.length < 2) return copy.errors.reason;
  if (key === 'message' && trimmed.length < 5) return copy.errors.message;
  return '';
}

function DirectContactCard({ copy }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-1">{copy.directCardTitle}</h2>
      <p className="text-sm text-gray-500 mb-5">{copy.directCardSubtitle}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <a href={`tel:${CONTACT.phone}`} className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Phone size={18} /></span>
          <div>
            <div className="text-sm font-semibold text-gray-900">{copy.call}</div>
            <div className="text-xs text-gray-500">{CONTACT.phoneDisplay}</div>
          </div>
        </a>

        <a href={CONTACT.whatsappUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><MessageCircle size={18} /></span>
          <div>
            <div className="text-sm font-semibold text-gray-900">{copy.whatsapp}</div>
            <div className="text-xs text-gray-500">{CONTACT.phoneDisplay}</div>
          </div>
        </a>

        <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent('Contact KOJO')}`} className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600"><Mail size={18} /></span>
          <div>
            <div className="text-sm font-semibold text-gray-900">{copy.sendEmail}</div>
            <div className="text-xs text-gray-500 break-all">{CONTACT.email}</div>
          </div>
        </a>

        <div className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600"><MapPin size={18} /></span>
          <div>
            <div className="text-sm font-semibold text-gray-900">{copy.address}</div>
            <div className="text-xs text-gray-500">{CONTACT.address}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RobotChat({ onBack, copy }) {
  const { user } = useAuth();

  const STEPS = useMemo(() => ([
    { key: 'full_name', question: copy.questions[0], placeholder: copy.placeholders[0] },
    { key: 'phone', question: copy.questions[1], placeholder: copy.placeholders[1] },
    { key: 'email', question: copy.questions[2], placeholder: copy.placeholders[2] },
    { key: 'reason', question: copy.questions[3], placeholder: copy.placeholders[3], isReason: true },
    { key: 'message', question: copy.questions[4], placeholder: copy.placeholders[4], isTextarea: true },
  ]), [copy]);

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
    const err = validateField(currentStep.key, inputValue, copy);
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
      const response = await supportAPI.createTicket({ ...finalAnswers, channel: 'robot' });
      const ticketId = response?.data?.ticket_id || response?.ticket_id || '';
      setLastTicketId(ticketId);
      if (ticketId) {
        // Mémorisation locale (cet appareil) : permet de proposer « Suivre
        // mon ticket » pré-rempli sans demander l'ID à l'utilisateur.
        try {
          localStorage.setItem('kojo_last_ticket', JSON.stringify({
            id: ticketId,
            email: finalAnswers.email,
          }));
        } catch (_e) {
          // stockage local indisponible : on garde juste l'ID en mémoire
        }
      }
      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err?.response?.data?.detail ? String(err.response.data.detail) : copy.genericError
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <CheckCircle size={28} />
      </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">{copy.confirmTitle}</h2>
        <p className="text-gray-600">{copy.confirmMessage}</p>
        {lastTicketId && (
          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-sm">
            <span className="text-gray-500">{copy.yourTicketId} : </span>
            <span className="font-mono font-semibold text-gray-900">{lastTicketId}</span>
          </div>
        )}
        <button onClick={onBack} className="mt-6 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          {copy.back}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600" aria-label={copy.back}>
          <ArrowLeft size={18} />
        </button>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Bot size={18} /></span>
        <span className="text-sm font-semibold text-gray-900">{copy.assistantName}</span>
        <span className="ml-auto text-xs text-gray-400">{copy.step} {stepIndex + 1}/{STEPS.length}</span>
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
          {copy.reasons.map((r) => (
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
          aria-label="Send"
        >
          <Send size={18} />
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {submitting && <p className="mt-2 text-sm text-gray-500">{copy.sending}</p>}
      {submitError && <p className="mt-2 text-sm text-red-600">{submitError}</p>}
    </div>
  );
}

// Suivi de ticket : le créateur peut vérifier le statut de sa demande avec
// l'identifiant renvoyé à la création + l'e-mail saisi (le backend exige la
// correspondance — un ticket ne peut pas être interrogé par un tiers).
// Pré-remplit le suivi avec le dernier ticket créé sur CET appareil (stocké
// par RobotChat à la création) : l'utilisateur n'a pas à retaper l'ID ni
// l'e-mail pour vérifier le statut de sa dernière demande.
const getLastStoredTicket = () => {
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

function TicketTracker({ copy }) {
  const lastTicket = getLastStoredTicket();
  const [ticketId, setTicketId] = useState(lastTicket?.id || '');
  const [ticketEmail, setTicketEmail] = useState(lastTicket?.email || '');
  const [tracking, setTracking] = useState(false);
  const [trackResult, setTrackResult] = useState(null); // null | {…} | 'not_found'
  const [trackError, setTrackError] = useState('');

  const trackTicket = async () => {
    if (!ticketId.trim() || !ticketEmail.trim()) return;
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
        setTrackError(copy.genericError);
      }
    } finally {
      setTracking(false);
    }
  };

  const statusBadgeColor = (status) => {
    if (/résolu|resolved/i.test(status || '')) return 'bg-emerald-100 text-emerald-700';
    if (/en cours|progress/i.test(status || '')) return 'bg-amber-100 text-amber-700';
    return 'bg-blue-100 text-blue-700';
  };

  return (
    <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">{copy.trackTitle}</h2>
      <p className="text-sm text-gray-500 mb-4">{copy.trackSubtitle}</p>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={ticketId}
          onChange={(e) => setTicketId(e.target.value)}
          placeholder={copy.ticketIdPlaceholder}
          aria-label={copy.ticketIdPlaceholder}
          className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        <input
          type="email"
          value={ticketEmail}
          onChange={(e) => setTicketEmail(e.target.value)}
          placeholder={copy.ticketEmailPlaceholder}
          aria-label={copy.ticketEmailPlaceholder}
          className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        <button
          onClick={trackTicket}
          disabled={tracking || !ticketId.trim() || !ticketEmail.trim()}
          className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
        >
          {tracking ? copy.tracking : copy.trackCta}
        </button>
      </div>

      {trackError && <p className="mt-3 text-sm text-red-600">{trackError}</p>}

      {trackResult === 'not_found' && (
        <p className="mt-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {copy.trackNotFound}
        </p>
      )}

      {trackResult && trackResult !== 'not_found' && (
        <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 line-clamp-1">{trackResult.reason}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {copy.ticketSentOn}{' '}
                {trackResult.created_at ? new Date(trackResult.created_at).toLocaleDateString() : ''}
                {' • '}{copy.ticketIdLabel || 'ID'}: {String(trackResult.ticket_id || trackResult.id || '').slice(0, 8)}…
              </p>
            </div>
            <span className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold ${statusBadgeColor(trackResult.status)}`}>
              {copy.ticketStatusLabel}: {trackResult.status}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

const Support = () => {
  const { currentLanguage } = useLanguage();
  const copy = useMemo(() => getCopy(currentLanguage), [currentLanguage]);
  const [mode, setMode] = useState(null); // null | 'robot' | 'direct'

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{copy.title}</h1>
        <p className="text-gray-600">{copy.subtitle}</p>
      </div>

      <TicketTracker copy={copy} />

      {mode === null && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <button
            onClick={() => setMode('robot')}
            className="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm hover:border-orange-300 hover:shadow-md transition-all"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 text-orange-600"><Bot size={24} /></span>
            <span className="font-semibold text-gray-900">{copy.robotTitle}</span>
            <span className="text-xs text-gray-500">{copy.robotSubtitle}</span>
          </button>
          <button
            onClick={() => setMode('direct')}
            className="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm hover:border-orange-300 hover:shadow-md transition-all"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><Phone size={24} /></span>
            <span className="font-semibold text-gray-900">{copy.directTitle}</span>
            <span className="text-xs text-gray-500">{copy.directSubtitle}</span>
          </button>
        </div>
      )}

      {mode === 'robot' && (
        <div className="mb-6">
          <RobotChat onBack={() => setMode(null)} copy={copy} />
        </div>
      )}

      {mode === 'direct' && (
        <div className="mb-4">
          <button onClick={() => setMode(null)} className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft size={16} /> {copy.back}
          </button>
        </div>
      )}

      <DirectContactCard copy={copy} />
    </div>
  );
};

export default Support;
