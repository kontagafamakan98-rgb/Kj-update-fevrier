import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Phone, Mail, MapPin, MessageCircle, Bot } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { usePageMeta } from '../utils/seo';
import TicketTracker from '../components/TicketTracker';
import RobotChat from '../components/RobotChat';
// Contact (N.A.P.) partagé avec le footer et le shell statique de l'accueil :
// une seule source (src/config/contact.json) pour ne jamais publier deux
// adresses ou deux numéros différents selon le canal.
import { CONTACT, mailtoHref, telHref } from '../config/contact';
// Les douze libellés que la coquille pré-rendue publie sont DÉCLARÉS une fois
// (src/config/page-sections.js) : le build écrit le shell avec eux, et cette
// page les lit pour son dictionnaire français.
import { SUPPORT_COPY_FR } from '../config/page-sections';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-.]{6,20}$/;

const COPY = {
  fr: {
    ...SUPPORT_COPY_FR,
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
        <a href={telHref} className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
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

        <a href={mailtoHref} className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors">
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


const Support = () => {
  const { currentLanguage, t } = useLanguage();
  const copy = useMemo(() => getCopy(currentLanguage), [currentLanguage]);
  usePageMeta();
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

      {/* Maillage interne : le support mène au fonctionnement du service et à
          la liste des missions. Le shell statique (vite.config.js) rend
          EXACTEMENT ce bloc — sinon la ligne disparaîtrait au montage React. */}
      <p className="mt-6 text-center text-sm text-gray-500">
        <Link to="/how-it-works" className="text-orange-600 underline underline-offset-2">
          {t('howItWorksTitle')}
        </Link>
        {' · '}
        <Link to="/jobs" className="text-orange-600 underline underline-offset-2">
          {t('viewJobs')}
        </Link>
      </p>
    </div>
  );
};

export default Support;
