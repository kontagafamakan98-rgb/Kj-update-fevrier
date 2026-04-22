import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import LoadingButton from '../components/LoadingButton';
import { authAPI } from '../services/api';
import { safeLog } from '../utils/env';

const COPY = {
  fr: {
    title: 'Mot de passe oublié',
    subtitle: 'Recevez un code par email pour sécuriser votre compte et définir un nouveau mot de passe.',
    stepEmail: 'Email',
    stepCode: 'Code',
    stepPassword: 'Nouveau mot de passe',
    emailLabel: 'Adresse email',
    sendCode: 'Envoyer le code',
    resendCode: 'Renvoyer le code',
    codeSent: 'Code envoyé',
    codeResent: 'Code renvoyé',
    codeVerified: 'Code vérifié',
    codeLabel: 'Code reçu par email',
    codeHelp: 'Entrez le code à 6 chiffres reçu par email.',
    verifyCode: 'Vérifier le code',
    newPasswordLabel: 'Nouveau mot de passe',
    confirmPasswordLabel: 'Confirmer le nouveau mot de passe',
    resetPassword: 'Changer le mot de passe',
    resetSuccess: 'Mot de passe modifié avec succès. Connectez-vous avec le nouveau mot de passe.',
    backToLogin: 'Retour à la connexion',
    sentTo: 'Code envoyé à {email}',
    resendIn: 'Renvoyer dans {time}',
    expiresIn: 'Expire dans {time}',
    genericRequestMessage: 'Si cette adresse email existe, un code de réinitialisation a été envoyé.',
    invalidOtpLength: 'Le code doit contenir 6 chiffres.',
    passwordsDontMatch: 'Les mots de passe ne correspondent pas.',
    passwordTooShort: 'Le mot de passe doit contenir au moins 6 caractères.',
    errors: {
      noActiveCode: 'Aucun code actif. Demandez un nouveau code.',
      codeExpired: 'Le code a expiré. Demandez un nouveau code.',
      tooManyAttempts: 'Trop de tentatives. Demandez un nouveau code.',
      invalidCode: 'Code incorrect.',
      invalidResetSession: 'La session de réinitialisation a expiré. Recommencez.',
      deliveryError: 'Impossible d’envoyer l’email pour le moment. Réessayez plus tard.',
      unknownEmail: 'Adresse email introuvable.',
      generic: 'Une erreur est survenue. Réessayez.'
    }
  },
  en: {
    title: 'Forgot password',
    subtitle: 'Receive an email code to secure your account and choose a new password.',
    stepEmail: 'Email',
    stepCode: 'Code',
    stepPassword: 'New password',
    emailLabel: 'Email address',
    sendCode: 'Send code',
    resendCode: 'Resend code',
    codeSent: 'Code sent',
    codeResent: 'Code resent',
    codeVerified: 'Code verified',
    codeLabel: 'Code received by email',
    codeHelp: 'Enter the 6-digit code sent to your email.',
    verifyCode: 'Verify code',
    newPasswordLabel: 'New password',
    confirmPasswordLabel: 'Confirm new password',
    resetPassword: 'Change password',
    resetSuccess: 'Password updated successfully. Sign in with your new password.',
    backToLogin: 'Back to login',
    sentTo: 'Code sent to {email}',
    resendIn: 'Resend in {time}',
    expiresIn: 'Expires in {time}',
    genericRequestMessage: 'If this email exists, a reset code has been sent.',
    invalidOtpLength: 'The code must contain 6 digits.',
    passwordsDontMatch: 'Passwords do not match.',
    passwordTooShort: 'Password must be at least 6 characters long.',
    errors: {
      noActiveCode: 'No active code. Request a new code.',
      codeExpired: 'The code expired. Request a new one.',
      tooManyAttempts: 'Too many attempts. Request a new code.',
      invalidCode: 'Incorrect code.',
      invalidResetSession: 'Reset session expired. Start again.',
      deliveryError: 'Unable to send email right now. Please try again later.',
      unknownEmail: 'Email address not found.',
      generic: 'Something went wrong. Please try again.'
    }
  },
  wo: {
    title: 'Fàtte nga sa baatu jàll',
    subtitle: 'Jot code ci email ngir aar sa compte te sosaat sa baatu jàll bu bees.',
    stepEmail: 'Email',
    stepCode: 'Code',
    stepPassword: 'Baatu jàll bu bees',
    emailLabel: 'Adresse email',
    sendCode: 'Yónnee code bi',
    resendCode: 'Yónnee koaat',
    codeSent: 'Code bi yegg na',
    codeResent: 'Code bi yónnee nañu koaat',
    codeVerified: 'Code bi dëgg na',
    codeLabel: 'Code bi nga jote ci email',
    codeHelp: 'Dugal 6 chiffres yi nga jote ci email.',
    verifyCode: 'Wóor code bi',
    newPasswordLabel: 'Baatu jàll bu bees',
    confirmPasswordLabel: 'Dëggal baatu jàll bu bees',
    resetPassword: 'Soppi baatu jàll bi',
    resetSuccess: 'Baatu jàll bi soppi na. Duggal ak bu bees bi.',
    backToLogin: 'Dellusi ci dugg',
    sentTo: 'Code bi yónnee na ca {email}',
    resendIn: 'Yónnee koaat ci {time}',
    expiresIn: 'Mujj ci {time}',
    genericRequestMessage: 'Su email bii amee, yónnee nañu code bu reset.',
    invalidOtpLength: 'Code bi dafa wara am 6 chiffres.',
    passwordsDontMatch: 'Baatu jàll yi bokkul.',
    passwordTooShort: 'Baatu jàll bi war na am lu néew néew 6 caractères.',
    errors: {
      noActiveCode: 'Amul code buy dox. Laajal beneen code.',
      codeExpired: 'Code bi jeex na. Laajal beneen code.',
      tooManyAttempts: 'Nga jéem lool. Laajal beneen code.',
      invalidCode: 'Code bi jubul.',
      invalidResetSession: 'Session bi jeex na. Tambaleesaat.',
      deliveryError: 'Mënunuñu yónnee email leegi. Jéemaat ci kanam.',
      unknownEmail: 'Adresse email bii amul.',
      generic: 'Am na njumte. Jéemaat.'
    }
  },
  bm: {
    title: 'Mot de passe ɲinɛna',
    subtitle: 'Code dɔ sɔrɔ email la walasa ka i compte lakana ani ka mot de passe kura sigi.',
    stepEmail: 'Email',
    stepCode: 'Code',
    stepPassword: 'Mot de passe kura',
    emailLabel: 'Adresse email',
    sendCode: 'Code ci',
    resendCode: 'Code ci kokura',
    codeSent: 'Code ciyɔrɔla',
    codeResent: 'Code ci kokura',
    codeVerified: 'Code labɛnna',
    codeLabel: 'Code min sɔrɔra email la',
    codeHelp: 'Chiffres 6 minnu nana email la, olu don.',
    verifyCode: 'Code lajɛ',
    newPasswordLabel: 'Mot de passe kura',
    confirmPasswordLabel: 'Mot de passe kura segin',
    resetPassword: 'Mot de passe yɛlɛma',
    resetSuccess: 'Mot de passe yɛlɛmana. Aw ka don ni a kura ye.',
    backToLogin: 'Segin ka don',
    sentTo: 'Code ciyɔrɔla {email} ma',
    resendIn: 'A bɛ ci kokura kɔnɔ {time}',
    expiresIn: 'A bɛ ban kɔnɔ {time}',
    genericRequestMessage: 'Ni email in bɛ yen, reset code dɔ ciyɔrɔra.',
    invalidOtpLength: 'Code ka kan ka kɛ chiffres 6.',
    passwordsDontMatch: 'Mot de passew ma kelen ye.',
    passwordTooShort: 'Mot de passe ka kan ka bɔ caractères 6 kan.',
    errors: {
      noActiveCode: 'Code ka tɛ sen. Code kura dɔ ɲini.',
      codeExpired: 'Code banna. Code kura dɔ ɲini.',
      tooManyAttempts: 'I ka jɛgɛya kosɛbɛ. Code kura dɔ ɲini.',
      invalidCode: 'Code tɛ se.',
      invalidResetSession: 'Session banna. A daminɛ kokura.',
      deliveryError: 'An tɛ se ka email ci sisan. Aw ka segin ka jɛɛsi kɔfɛ.',
      unknownEmail: 'Adresse email ma yen.',
      generic: 'Fili dɔ bɔra. Aw ka segin ka jɛɛsi.'
    }
  },
  mos: {
    title: 'Mot de passe wã yɩɩda',
    subtitle: 'Paam code email pʋgẽ n gʋls fo compte la a taaba, n maana mot de passe wã beogo.',
    stepEmail: 'Email',
    stepCode: 'Code',
    stepPassword: 'Mot de passe beogo',
    emailLabel: 'Adresse email',
    sendCode: 'Tʋms code',
    resendCode: 'Tʋmsd-a taaba',
    codeSent: 'Code tʋmsa',
    codeResent: 'Code tʋmsa taaba',
    codeVerified: 'Code wilga',
    codeLabel: 'Code ning sẽn paama email pʋgẽ',
    codeHelp: 'Gʋls chiffres 6 ning sẽn paama email pʋgẽ.',
    verifyCode: 'Wilg code',
    newPasswordLabel: 'Mot de passe beogo',
    confirmPasswordLabel: 'Yõk mot de passe beogo',
    resetPassword: 'Toeem mot de passe',
    resetSuccess: 'Mot de passe toeema. Pẽesg n tʋ beogo wã.',
    backToLogin: 'Lebg n pẽesg',
    sentTo: 'Code tʋmsa n yɩ {email}',
    resendIn: 'Tʋmsda taaba n yɩ {time}',
    expiresIn: 'A saame n yɩ {time}',
    genericRequestMessage: 'Bala email kaya be, reset code tʋmsa n yɩta.',
    invalidOtpLength: 'Code wã moet n be chiffres 6.',
    passwordsDontMatch: 'Mot de passe yaa ka kẽnd ye.',
    passwordTooShort: 'Mot de passe wã moet n bɔr karakter 6.',
    errors: {
      noActiveCode: 'Code sẽn be n tʋʋm ka be ye. Sõsg code beogo.',
      codeExpired: 'Code saame. Sõsg code beogo.',
      tooManyAttempts: 'F jɛɛsa bɛɛga. Sõsg code beogo.',
      invalidCode: 'Code wã ka tõe ye.',
      invalidResetSession: 'Session saame. Sɩng taaba.',
      deliveryError: 'An ka tõe n tʋms email la sisan ye. Gese taaba kãsem.',
      unknownEmail: 'Adresse email ka be ye.',
      generic: 'Tudgr n wa. Gese taaba.'
    }
  }
};

const ForgotPassword = () => {
  const { currentLanguage, t } = useLanguage();
  const toast = useToast();
  const navigate = useNavigate();
  const copy = COPY[currentLanguage] || COPY.fr;

  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [step, setStep] = useState('email');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);

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

  const formatTime = (totalSeconds) => {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const interpolate = (template, vars = {}) => String(template || '').replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));

  const displayedEmail = useMemo(() => maskedEmail || email, [maskedEmail, email]);

  const translateApiMessage = (rawMessage = '') => {
    const normalized = String(rawMessage || '').toLowerCase();

    if (!normalized) return copy.errors.generic;
    if (normalized.includes('aucun code actif') || normalized.includes('aucun code otp actif') || normalized.includes('no active code')) return copy.errors.noActiveCode;
    if (normalized.includes('code a expiré') || normalized.includes('code expired')) return copy.errors.codeExpired;
    if (normalized.includes('trop de tentatives') || normalized.includes('too many attempts')) return copy.errors.tooManyAttempts;
    if (normalized.includes('code invalide') || normalized.includes('incorrect code') || normalized.includes('invalid code')) return copy.errors.invalidCode;
    if (normalized.includes('jeton de vérification') || normalized.includes('verification token') || normalized.includes('reset session')) return copy.errors.invalidResetSession;
    if (normalized.includes('gmail') || normalized.includes('oauth') || normalized.includes('email send failed')) return copy.errors.deliveryError;
    if (normalized.includes('introuvable') || normalized.includes('not found')) return copy.errors.unknownEmail;

    return rawMessage;
  };

  const handleRequestCode = async (mode = 'send') => {
    if (!email.trim()) {
      setError(copy.emailLabel);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const payload = { email: email.trim().toLowerCase(), purpose: 'password_reset' };
      const response = mode === 'resend'
        ? await authAPI.resendPasswordResetOtp(payload)
        : await authAPI.requestPasswordResetOtp(payload);

      setMaskedEmail(response.masked_email || email.trim().toLowerCase());
      setCooldownSeconds(response.cooldown_seconds || 0);
      setExpiresInSeconds(response.expires_in_seconds || 0);
      setStep('code');
      setOtp('');

      toast.success(mode === 'resend' ? copy.codeResent : copy.codeSent);
    } catch (apiError) {
      const rawMessage = apiError?.response?.data?.detail || apiError?.message || copy.errors.generic;
      const message = translateApiMessage(rawMessage);
      setError(message);
      toast.error(message);
      safeLog.error('Forgot password request error:', apiError);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (event) => {
    event.preventDefault();

    if (otp.trim().length !== 6) {
      setError(copy.invalidOtpLength);
      toast.error(copy.invalidOtpLength);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authAPI.verifyPasswordResetOtp({
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
        purpose: 'password_reset'
      });

      setVerificationToken(response.verification_token);
      setStep('password');
      toast.success(copy.codeVerified);
    } catch (apiError) {
      const rawMessage = apiError?.response?.data?.detail || apiError?.message || copy.errors.generic;
      const message = translateApiMessage(rawMessage);
      setError(message);
      toast.error(message);
      safeLog.error('Forgot password verify error:', apiError);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();

    if (newPassword.length < 6) {
      setError(copy.passwordTooShort);
      toast.error(copy.passwordTooShort);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(copy.passwordsDontMatch);
      toast.error(copy.passwordsDontMatch);
      return;
    }

    setLoading(true);
    setError('');

    try {
      await authAPI.resetPassword({
        email: email.trim().toLowerCase(),
        verification_token: verificationToken,
        new_password: newPassword
      });

      toast.success(copy.resetSuccess);
      navigate('/login');
    } catch (apiError) {
      const rawMessage = apiError?.response?.data?.detail || apiError?.message || copy.errors.generic;
      const message = translateApiMessage(rawMessage);
      setError(message);
      toast.error(message);
      safeLog.error('Forgot password reset error:', apiError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-14 w-14 flex items-center justify-center rounded-full bg-blue-600 shadow-lg">
            <span className="text-white text-2xl font-bold">✉️</span>
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">{copy.title}</h2>
          <p className="mt-3 text-sm text-gray-600">{copy.subtitle}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-md p-6 space-y-6">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500">
            <span className={step === 'email' ? 'text-blue-600' : 'text-green-600'}>1. {copy.stepEmail}</span>
            <span className={step === 'code' ? 'text-blue-600' : step === 'password' ? 'text-green-600' : 'text-gray-400'}>2. {copy.stepCode}</span>
            <span className={step === 'password' ? 'text-blue-600' : 'text-gray-400'}>3. {copy.stepPassword}</span>
          </div>

          {displayedEmail && step !== 'email' && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              {interpolate(copy.sentTo, { email: displayedEmail })}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {step === 'email' && (
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); handleRequestCode('send'); }}>
              <div>
                <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700">{copy.emailLabel}</label>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder={t('email')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <p className="text-xs text-gray-500">{copy.genericRequestMessage}</p>

              <LoadingButton
                type="submit"
                loading={loading}
                className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {copy.sendCode}
              </LoadingButton>
            </form>
          )}

          {step === 'code' && (
            <form className="space-y-5" onSubmit={handleVerifyCode}>
              <div>
                <label htmlFor="reset-otp" className="block text-sm font-medium text-gray-700">{copy.codeLabel}</label>
                <input
                  id="reset-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-center text-lg tracking-[0.35em] focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <p className="mt-2 text-xs text-gray-500">{copy.codeHelp}</p>
              </div>

              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{cooldownSeconds > 0 ? interpolate(copy.resendIn, { time: formatTime(cooldownSeconds) }) : copy.resendCode}</span>
                <span>{expiresInSeconds > 0 ? interpolate(copy.expiresIn, { time: formatTime(expiresInSeconds) }) : ''}</span>
              </div>

              <LoadingButton
                type="submit"
                loading={loading}
                className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {copy.verifyCode}
              </LoadingButton>

              <button
                type="button"
                disabled={loading || cooldownSeconds > 0}
                onClick={() => handleRequestCode('resend')}
                className="w-full rounded-md border border-blue-200 px-4 py-2 text-sm font-medium text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {copy.resendCode}
              </button>
            </form>
          )}

          {step === 'password' && (
            <form className="space-y-5" onSubmit={handleResetPassword}>
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">{copy.newPasswordLabel}</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder={copy.newPasswordLabel}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">{copy.confirmPasswordLabel}</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder={copy.confirmPasswordLabel}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              <LoadingButton
                type="submit"
                loading={loading}
                className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {copy.resetPassword}
              </LoadingButton>
            </form>
          )}

          <div className="text-center">
            <Link to="/login" className="text-sm font-medium text-orange-600 hover:text-orange-500">
              {copy.backToLogin}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
