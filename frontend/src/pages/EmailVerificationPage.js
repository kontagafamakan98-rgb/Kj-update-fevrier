import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import { authAPI, handleApiError } from '../services/api';
import { makeScopedTranslator } from '../utils/pack2PageI18n/emailVerification';
import { clearRegistrationFlow, loadRegistrationFlow, mergeRegistrationFlow } from '../utils/registrationFlowStorage';
import { devLog, safeLog } from '../utils/env';
import { Mail, ShieldCheck, Lock, Hourglass, Check } from 'lucide-react';

const OTP_LENGTH = 6;

/** Le rayon du site pour un contrôle : 3 px, jamais une pilule. */
const RAYON = 'rounded-[3px]';

const EmailVerificationPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t);
  const toast = useToast();

  const persistedFlow = loadRegistrationFlow();
  const userData = location.state?.userData || persistedFlow?.userData || null;
  const paymentAccounts = location.state?.paymentAccounts || persistedFlow?.paymentAccounts || null;
  const emailVerificationToken = location.state?.emailVerificationToken || persistedFlow?.emailVerificationToken || null;

  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const initialSendTriggeredRef = useRef(false);
  const cooldownDeadlineRef = useRef(0);
  const expiryDeadlineRef = useRef(0);
  const countdownFrameRef = useRef(null);

  const formatTime = (totalSeconds) => {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const maskedDestination = useMemo(() => {
    if (maskedEmail) return maskedEmail;
    return userData?.email || '';
  }, [maskedEmail, userData?.email]);

  useEffect(() => {
    if (!userData) {
      navigate('/register');
      return;
    }

    mergeRegistrationFlow({
      userData,
      paymentAccounts,
      emailVerificationToken,
      currentStep: 'email-verification'
    });

    if (!emailVerificationToken && !initialSendTriggeredRef.current) {
      initialSendTriggeredRef.current = true;
      handleSendCode('send');
    }
  }, [emailVerificationToken, navigate, paymentAccounts, userData]);

  useEffect(() => {
    const hasActiveCountdown = cooldownSeconds > 0 || expiresInSeconds > 0;
    if (!hasActiveCountdown) {
      return undefined;
    }

    const updateCountdowns = () => {
      const now = Date.now();
      const nextCooldown = cooldownDeadlineRef.current ? Math.max(0, Math.ceil((cooldownDeadlineRef.current - now) / 1000)) : 0;
      const nextExpiry = expiryDeadlineRef.current ? Math.max(0, Math.ceil((expiryDeadlineRef.current - now) / 1000)) : 0;

      setCooldownSeconds((prev) => (prev === nextCooldown ? prev : nextCooldown));
      setExpiresInSeconds((prev) => (prev === nextExpiry ? prev : nextExpiry));

      if (nextCooldown > 0 || nextExpiry > 0) {
        countdownFrameRef.current = window.requestAnimationFrame(updateCountdowns);
      }
    };

    countdownFrameRef.current = window.requestAnimationFrame(updateCountdowns);

    return () => {
      if (countdownFrameRef.current !== null) {
        window.cancelAnimationFrame(countdownFrameRef.current);
        countdownFrameRef.current = null;
      }
    };
  }, [cooldownSeconds > 0, expiresInSeconds > 0]);

  const isEmailAlreadyUsedMessage = (message = '') => message.toLowerCase().includes('déjà utilisée') || message.toLowerCase().includes('already used');
  const translateApiMessage = (message = '') => isEmailAlreadyUsedMessage(message) ? pageT('duplicateEmailError') : message;
  const displayedError = errorKey ? pageT(errorKey) : error;

  const handleSendCode = async (mode = 'send') => {
    if (!userData?.email) {
      return;
    }

    setSendingCode(true);
    setError('');
    setErrorKey('');

    try {
      const payload = {
        email: userData.email,
        purpose: 'signup'
      };

      const response = mode === 'resend'
        ? await authAPI.resendEmailOtp(payload)
        : await authAPI.sendEmailOtp(payload);

      const nextCooldownSeconds = response.cooldown_seconds || 0;
      const nextExpiresInSeconds = response.expires_in_seconds || 0;

      setMaskedEmail(response.masked_email || userData.email);
      cooldownDeadlineRef.current = nextCooldownSeconds > 0 ? Date.now() + (nextCooldownSeconds * 1000) : 0;
      expiryDeadlineRef.current = nextExpiresInSeconds > 0 ? Date.now() + (nextExpiresInSeconds * 1000) : 0;
      setCooldownSeconds(nextCooldownSeconds);
      setExpiresInSeconds(nextExpiresInSeconds);
      setOtp('');

      toast.success(mode === 'resend' ? pageT('codeResentToast') : pageT('codeSentToast'));
      devLog.info(`📧 Code Gmail ${mode === 'resend' ? 'renvoyé' : 'envoyé'} avec succès`);
    } catch (apiError) {
      const rawMessage = handleApiError(apiError, pageT('genericError'));
      const message = translateApiMessage(rawMessage);
      const nextErrorKey = isEmailAlreadyUsedMessage(rawMessage) ? 'duplicateEmailError' : '';
      setError(message);
      setErrorKey(nextErrorKey);
      if (isEmailAlreadyUsedMessage(rawMessage)) {
        toast.error({ messageKey: 'duplicateEmailError', scope: 'emailVerification' });
      } else {
        toast.error(message);
      }
      safeLog.error('❌ Erreur envoi OTP Gmail:', apiError);

      if (isEmailAlreadyUsedMessage(rawMessage)) {
        clearRegistrationFlow();
        navigate('/register', { replace: true });
        return;
      }
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerify = async (event) => {
    event.preventDefault();

    if (otp.length !== OTP_LENGTH) {
      const message = pageT('invalidOtpLength');
      setError(message);
      setErrorKey('invalidOtpLength');
      toast.error(message);
      return;
    }

    setVerifying(true);
    setError('');
    setErrorKey('');

    try {
      const verificationResult = await authAPI.verifyEmailOtp({
        email: userData.email,
        otp,
        purpose: 'signup'
      });

      toast.success(pageT('emailVerified'));

      mergeRegistrationFlow({
        userData,
        paymentAccounts,
        emailVerificationToken: verificationResult.verification_token,
        currentStep: 'payment-verification'
      });

      navigate('/payment-verification', {
        state: {
          userData,
          paymentAccounts,
          emailVerificationToken: verificationResult.verification_token
        }
      });
    } catch (apiError) {
      const rawMessage = handleApiError(apiError, pageT('genericError'));
      const message = translateApiMessage(rawMessage);
      const nextErrorKey = isEmailAlreadyUsedMessage(rawMessage) ? 'duplicateEmailError' : '';
      setError(message);
      setErrorKey(nextErrorKey);
      if (isEmailAlreadyUsedMessage(rawMessage)) {
        toast.error({ messageKey: 'duplicateEmailError', scope: 'emailVerification' });
      } else {
        toast.error(message);
      }
      safeLog.error('❌ Erreur vérification email Gmail:', apiError);
    } finally {
      setVerifying(false);
    }
  };

  if (!userData) {
    return (
      <div className="min-h-full fond-sable flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500 mx-auto"></div>
          <div className="mt-4 text-orange-700 font-medium">{pageT('redirecting')}</div>
        </div>
      </div>
    );
  }

  return (      <div className="min-h-full fond-sable py-8">
      <div className="max-w-3xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="titre-page flex items-center gap-3"><Mail className="h-7 w-7 text-orange-600" aria-hidden="true" /> {pageT('title')}</h1>
          <p className="mt-3 max-w-2xl text-stone-600">{pageT('subtitle')}</p>
        </div>

        {/* Le parcours en trois temps : les pastilles rondes du site
            (`.pastille-rond`) au lieu de trois cercles de couleurs empruntées,
            et le filet qui les relie au lieu d'une barre de 4 px. */}
        <div className="mb-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
          <StepDot number="1" label={pageT('stepPersonal')} etat="fait" />
          <span className="hidden h-px w-12 bg-stone-300 sm:block" aria-hidden="true"></span>
          <StepDot number="2" label={pageT('stepEmail')} etat="courant" />
          <span className="hidden h-px w-12 bg-stone-300 sm:block" aria-hidden="true"></span>
          <StepDot number="3" label={pageT('stepPayments')} etat="a-venir" />
        </div>

        <div className="carte-editoriale overflow-hidden">
          <div className="bande-page p-6">
            <p className="sur-titre sur-titre-clair">{pageT('title')}</p>
            <h2 className="titre-page mt-3">{pageT('sentTo', { email: maskedDestination })}</h2>
            <p className="mt-2 text-sm text-orange-50">{pageT('otpHelp')}</p>
          </div>

          <div className="p-6 md:p-8">
            {displayedError && (
              <div className={`mb-6 ${RAYON} border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700`}>
                {displayedError}
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-6">
              <div>
                <label htmlFor="email-otp" className="block text-sm font-semibold text-stone-700 mb-3">{pageT('otpLabel')}</label>
                <input
                  id="email-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={OTP_LENGTH}
                  value={otp}
                  onChange={(event) => setOtp((event.target.value || '').replace(/\D/g, '').slice(0, OTP_LENGTH))}
                  disabled={sendingCode || verifying}
                  placeholder="123456"
                  className="w-full px-5 py-4 text-center text-3xl font-semibold tracking-[0.5em] disabled:cursor-not-allowed"
                />
              </div>

              {/* Deux notes en petit : le délai de renvoi (orange, c'est une
                  action possible) et la durée de validité (neutre, c'est une
                  information). Le bleu de la seconde n'appartenait à personne. */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className={`${RAYON} border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800`}>
                  <Hourglass className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" /> {cooldownSeconds > 0 ? pageT('resendIn', { time: formatTime(cooldownSeconds) }) : pageT('resend')}
                </div>
                <div className={`${RAYON} border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700`}>
                  <ShieldCheck className="inline h-4 w-4 mr-1 align-[-0.15em] text-orange-700" aria-hidden="true" /> {pageT('expiresIn', { time: formatTime(expiresInSeconds) })}
                </div>
              </div>

              <div className="flex flex-col gap-3 md:flex-row">
                <button
                  type="button"
                  onClick={() => handleSendCode('resend')}
                  disabled={sendingCode || verifying || cooldownSeconds > 0}
                  className="bouton bouton-clair flex-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingCode ? pageT('sendInProgress') : (cooldownSeconds > 0 ? pageT('resendIn', { time: formatTime(cooldownSeconds) }) : pageT('resend'))}
                </button>

                <button
                  type="submit"
                  disabled={sendingCode || verifying}
                  className="bouton bouton-encre flex-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {verifying ? pageT('verifying') : pageT('verifyButton')}
                </button>
              </div>
            </form>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  clearRegistrationFlow();
                  navigate('/register');
                }}
                className="bouton bouton-clair"
              >
                {pageT('backToRegister')}
              </button>
              {emailVerificationToken ? (
                <button
                  type="button"
                  onClick={() => navigate('/payment-verification', { state: { userData, paymentAccounts, emailVerificationToken } })}
                  className="bouton bouton-clair"
                >
                  {pageT('backToPayments')}
                </button>
              ) : <div />}
            </div>
          </div>
        </div>

        <div className="carte-editoriale mt-8 p-6">
          <h3 className="titre-entree mb-3 flex items-center gap-2"><Lock className="h-5 w-5 text-orange-700" aria-hidden="true" /> {pageT('securityTitle')}</h3>
          <div className="space-y-2 text-sm text-stone-600">
            <p>{pageT('security1')}</p>
            <p>{pageT('security2')}</p>
            <p>{pageT('security3')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Une étape du parcours, dans les pastilles du site : faite (sable, coche
 * dessinée), COURANTE (l'orange de la marque) ou à venir (creuse, sans fond).
 * Elle portait trois cercles de teintes empruntées (vert, orange, gris) : un
 * parcours ne décorait pas, il dit OÙ l'on est.
 */
function StepDot({ number, label, etat }) {
  const pastille =
    etat === 'courant'
      ? 'pastille-rond pastille-courante'
      : etat === 'fait'
        ? 'pastille-rond'
        : 'pastille-rond pastille-rond-creuse';
  const teinte = etat === 'courant' ? 'text-stone-700' : 'text-stone-500';
  return (
    <span className="flex items-center">
      <span className={`${pastille} text-sm font-semibold`} aria-hidden="true">
        {etat === 'fait' ? <Check className="h-4 w-4" /> : number}
      </span>
      <span className={`ml-2 text-sm font-medium ${teinte}`}>{label}</span>
    </span>
  );
}

export default EmailVerificationPage;
