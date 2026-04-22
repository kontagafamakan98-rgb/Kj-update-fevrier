import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import { authAPI } from '../services/api';
import { makeScopedTranslator } from '../utils/pack2PageI18n';
import { clearRegistrationFlow, loadRegistrationFlow, mergeRegistrationFlow } from '../utils/registrationFlowStorage';
import { devLog, safeLog } from '../utils/env';

const OTP_LENGTH = 6;

const EmailVerificationPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'emailVerification');
  const toast = useToast();

  const persistedFlow = loadRegistrationFlow();
  const userData = location.state?.userData || persistedFlow?.userData || null;
  const paymentAccounts = location.state?.paymentAccounts || persistedFlow?.paymentAccounts || null;
  const emailVerificationToken = location.state?.emailVerificationToken || persistedFlow?.emailVerificationToken || null;

  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const initialSendTriggeredRef = useRef(false);

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
    if (!cooldownSeconds && !expiresInSeconds) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
      setExpiresInSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [cooldownSeconds, expiresInSeconds]);

  const extractErrorMessage = (apiError, fallbackMessage) => {
    return apiError?.response?.data?.detail || apiError?.message || fallbackMessage;
  };

  const isEmailAlreadyUsedMessage = (message = '') => message.toLowerCase().includes('déjà utilisée') || message.toLowerCase().includes('already used');

  const handleSendCode = async (mode = 'send') => {
    if (!userData?.email) {
      return;
    }

    setSendingCode(true);
    setError('');

    try {
      const payload = {
        email: userData.email,
        purpose: 'signup'
      };

      const response = mode === 'resend'
        ? await authAPI.resendEmailOtp(payload)
        : await authAPI.sendEmailOtp(payload);

      setMaskedEmail(response.masked_email || userData.email);
      setCooldownSeconds(response.cooldown_seconds || 0);
      setExpiresInSeconds(response.expires_in_seconds || 0);
      setOtp('');

      toast.success(mode === 'resend' ? pageT('codeResentToast') : pageT('codeSentToast'));
      devLog.info(`📧 Code Gmail ${mode === 'resend' ? 'renvoyé' : 'envoyé'} avec succès`);
    } catch (apiError) {
      const message = extractErrorMessage(apiError, pageT('genericError'));
      setError(message);
      toast.error(message);
      safeLog.error('❌ Erreur envoi OTP Gmail:', apiError);

      if (isEmailAlreadyUsedMessage(message)) {
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
      toast.error(message);
      return;
    }

    setVerifying(true);
    setError('');

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
      const message = extractErrorMessage(apiError, pageT('genericError'));
      setError(message);
      toast.error(message);
      safeLog.error('❌ Erreur vérification email Gmail:', apiError);
    } finally {
      setVerifying(false);
    }
  };

  if (!userData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500 mx-auto"></div>
          <div className="mt-4 text-orange-600 font-medium">{pageT('redirecting')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-3xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">📧 {pageT('title')}</h1>
          <p className="text-gray-600 max-w-2xl mx-auto">{pageT('subtitle')}</p>
        </div>

        <div className="mb-8 flex items-center justify-center space-x-4">
          <StepDot number="✓" label={pageT('stepPersonal')} bg="bg-green-500" text="text-green-600" />
          <div className="w-16 h-1 bg-orange-200"></div>
          <StepDot number="2" label={pageT('stepEmail')} bg="bg-orange-500" text="text-orange-600" />
          <div className="w-16 h-1 bg-gray-200"></div>
          <StepDot number="3" label={pageT('stepPayments')} bg="bg-gray-300" text="text-gray-500" textColor="text-gray-600" />
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-orange-100 overflow-hidden">
          <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-6 text-white">
            <p className="text-sm uppercase tracking-wide opacity-90">KOJO Gmail OTP</p>
            <h2 className="text-2xl font-semibold mt-1">{pageT('sentTo', { email: maskedDestination })}</h2>
            <p className="text-sm mt-2 opacity-90">{pageT('otpHelp')}</p>
          </div>

          <div className="p-6 md:p-8">
            {error && (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-6">
              <div>
                <label htmlFor="email-otp" className="block text-sm font-semibold text-gray-800 mb-3">{pageT('otpLabel')}</label>
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
                  className="w-full rounded-2xl border border-gray-300 px-5 py-4 text-center text-3xl font-semibold tracking-[0.5em] text-gray-900 shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-orange-50 border border-orange-100 px-4 py-3 text-sm text-orange-800">
                  ⏳ {cooldownSeconds > 0 ? pageT('resendIn', { time: formatTime(cooldownSeconds) }) : pageT('resend')}
                </div>
                <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800">
                  🛡️ {pageT('expiresIn', { time: formatTime(expiresInSeconds) })}
                </div>
              </div>

              <div className="flex flex-col gap-3 md:flex-row">
                <button
                  type="button"
                  onClick={() => handleSendCode('resend')}
                  disabled={sendingCode || verifying || cooldownSeconds > 0}
                  className="flex-1 rounded-xl border border-orange-200 bg-white px-4 py-3 font-medium text-orange-700 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingCode ? pageT('sendInProgress') : (cooldownSeconds > 0 ? pageT('resendIn', { time: formatTime(cooldownSeconds) }) : pageT('resend'))}
                </button>

                <button
                  type="submit"
                  disabled={sendingCode || verifying}
                  className="flex-1 rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {pageT('backToRegister')}
              </button>
              {emailVerificationToken ? (
                <button
                  type="button"
                  onClick={() => navigate('/payment-verification', { state: { userData, paymentAccounts, emailVerificationToken } })}
                  className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {pageT('backToPayments')}
                </button>
              ) : <div />}
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">🔐 {pageT('securityTitle')}</h3>
          <div className="space-y-2 text-sm text-gray-700">
            <p>{pageT('security1')}</p>
            <p>{pageT('security2')}</p>
            <p>{pageT('security3')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

function StepDot({ number, label, bg, text, textColor = 'text-white' }) {
  return (
    <div className="flex items-center">
      <div className={`w-8 h-8 ${bg} ${textColor} rounded-full flex items-center justify-center text-sm font-medium`}>
        {number}
      </div>
      <span className={`ml-2 text-sm font-medium ${text}`}>{label}</span>
    </div>
  );
}

export default EmailVerificationPage;
