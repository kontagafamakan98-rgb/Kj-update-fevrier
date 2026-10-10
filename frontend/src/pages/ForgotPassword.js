import { IconePage } from '../config/page-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
// Le lien interne AVEC la transition de vue native (components/LienVue.js).
import Link from '../components/LienVue';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import LoadingButton from '../components/LoadingButton';
import { authAPI, handleApiError } from '../services/api';
import { safeLog } from '../utils/env';
import { usePageMeta } from '../utils/seo';
import { PAGE_SECTIONS } from '../config/page-sections';

const ForgotPassword = () => {
  const { t } = useLanguage();
  usePageMeta();
  const toast = useToast();
  const navigate = useNavigate();
  const pagePlan = PAGE_SECTIONS['/forgot-password'];

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
  const cooldownDeadlineRef = useRef(0);
  const expiryDeadlineRef = useRef(0);
  const countdownFrameRef = useRef(null);

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

    if (!normalized) return t('forgotPasswordErrorGeneric');
    if (normalized.includes('aucun code actif') || normalized.includes('aucun code otp actif') || normalized.includes('no active code')) return t('forgotPasswordErrorNoActiveCode');
    if (normalized.includes('code a expiré') || normalized.includes('code expired')) return t('forgotPasswordErrorCodeExpired');
    if (normalized.includes('trop de tentatives') || normalized.includes('too many attempts')) return t('forgotPasswordErrorTooManyAttempts');
    if (normalized.includes('code invalide') || normalized.includes('incorrect code') || normalized.includes('invalid code')) return t('forgotPasswordErrorInvalidCode');
    if (normalized.includes('jeton de vérification') || normalized.includes('verification token') || normalized.includes('reset session')) return t('forgotPasswordErrorInvalidResetSession');
    if (normalized.includes('gmail') || normalized.includes('oauth') || normalized.includes('email send failed')) return t('forgotPasswordErrorDeliveryError');
    if (normalized.includes('introuvable') || normalized.includes('not found')) return t('forgotPasswordErrorUnknownEmail');

    return rawMessage;
  };

  const handleRequestCode = async (mode = 'send') => {
    if (!email.trim()) {
      setError(t('forgotPasswordEmailLabel'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const payload = { email: email.trim().toLowerCase(), purpose: 'password_reset' };
      const response = mode === 'resend'
        ? await authAPI.resendPasswordResetOtp(payload)
        : await authAPI.requestPasswordResetOtp(payload);

      const nextCooldownSeconds = response.cooldown_seconds || 0;
      const nextExpiresInSeconds = response.expires_in_seconds || 0;

      setMaskedEmail(response.masked_email || email.trim().toLowerCase());
      cooldownDeadlineRef.current = nextCooldownSeconds > 0 ? Date.now() + (nextCooldownSeconds * 1000) : 0;
      expiryDeadlineRef.current = nextExpiresInSeconds > 0 ? Date.now() + (nextExpiresInSeconds * 1000) : 0;
      setCooldownSeconds(nextCooldownSeconds);
      setExpiresInSeconds(nextExpiresInSeconds);
      setStep('code');
      setOtp('');

      toast.success(mode === 'resend' ? t('forgotPasswordCodeResent') : t('forgotPasswordCodeSent'));
    } catch (apiError) {
      const rawMessage = handleApiError(apiError, t('forgotPasswordErrorGeneric'));
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
      setError(t('forgotPasswordInvalidOtpLength'));
      toast.error(t('forgotPasswordInvalidOtpLength'));
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
      toast.success(t('forgotPasswordCodeVerified'));
    } catch (apiError) {
      const rawMessage = handleApiError(apiError, t('forgotPasswordErrorGeneric'));
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

    if (newPassword.length < 8) {
      setError(t('passwordTooShort'));
      toast.error(t('passwordTooShort'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('passwordsDontMatch'));
      toast.error(t('passwordsDontMatch'));
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

      toast.success(t('forgotPasswordResetSuccess'));
      navigate('/login');
    } catch (apiError) {
      const rawMessage = handleApiError(apiError, t('forgotPasswordErrorGeneric'));
      const message = translateApiMessage(rawMessage);
      setError(message);
      toast.error(message);
      safeLog.error('Forgot password reset error:', apiError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={pagePlan.frameClass}>
      <div className={pagePlan.colonneClass}>
        <div className={pagePlan.enteteClass}>
          <div className={pagePlan.badgeClass}>
            <span className={pagePlan.badgeTexteClass}><IconePage nom={pagePlan.badgeIcon} role="badgeEtape" /></span>
          </div>
          {/* Titre de PAGE en h1 (voir Login.js) : un h1 par page, identique au
              shell statique du build (forgot-password.html). Classes inchangées. */}
          {/* Voir src/pages/Register.js : le titre garde sa taille sans 30 px.
              Le passer au serif du site faisait élire ce `<h1>` comme élément
              LCP (mesuré : 18 576 px² en desktop contre 16 021 px² pour le
              sous-titre que le plan déclare), et les deux tailles n'élisent pas
              le même élément — une déclaration ne peut en décrire qu'un. Seule
              la TEINTE change (encre chaude). */}
          <h1 className={pagePlan.titleClass}>{t(pagePlan.titleKey)}</h1>
          <p className={pagePlan.subtitleClass}>{t(pagePlan.subtitleKey)}</p>
        </div>

        <div className={pagePlan.carteClass}>
          <div className={pagePlan.etapesClass}>
            <span className={step === 'email' ? pagePlan.etapeActiveClass : 'text-green-600'}>1. {t(pagePlan.stepEmailKey)}</span>
            <span className={step === 'code' ? pagePlan.etapeActiveClass : step === 'password' ? 'text-green-600' : pagePlan.etapeAttenteClass}>2. {t(pagePlan.stepCodeKey)}</span>
            <span className={step === 'password' ? pagePlan.etapeActiveClass : pagePlan.etapeAttenteClass}>3. {t(pagePlan.stepPasswordKey)}</span>
          </div>

          {displayedEmail && step !== 'email' && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
              {interpolate(t('forgotPasswordSentTo'), { email: displayedEmail })}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {step === 'email' && (
            <form className={pagePlan.formClass} onSubmit={(e) => { e.preventDefault(); handleRequestCode('send'); }}>
              <div>
                <label htmlFor="reset-email" className={pagePlan.labelClass}>{t('forgotPasswordEmailLabel')}</label>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  className={pagePlan.champClass}
                  placeholder={t('email')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <p className={pagePlan.aideClass}>{t(pagePlan.requestMessageKey)}</p>

              <LoadingButton
                type="submit"
                loading={loading}
                className={pagePlan.boutonClass}
              >
                {t(pagePlan.sendCodeKey)}
              </LoadingButton>
            </form>
          )}

          {step === 'code' && (
            <form className={pagePlan.formClass} onSubmit={handleVerifyCode}>
              <div>
                <label htmlFor="reset-otp" className={pagePlan.labelClass}>{t('forgotPasswordCodeLabel')}</label>
                <input
                  id="reset-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-center text-lg tracking-[0.35em] focus:border-orange-500 focus:outline-none focus:ring-orange-500"
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <p className="mt-2 text-xs text-gray-500">{t('forgotPasswordCodeHelp')}</p>
              </div>

              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{cooldownSeconds > 0 ? interpolate(t('forgotPasswordResendIn'), { time: formatTime(cooldownSeconds) }) : t('forgotPasswordResendCode')}</span>
                <span>{expiresInSeconds > 0 ? interpolate(t('forgotPasswordExpiresIn'), { time: formatTime(expiresInSeconds) }) : ''}</span>
              </div>

              <LoadingButton
                type="submit"
                loading={loading}
                className={pagePlan.boutonClass}
              >
                {t('forgotPasswordVerifyCode')}
              </LoadingButton>

              <button
                type="button"
                disabled={loading || cooldownSeconds > 0}
                onClick={() => handleRequestCode('resend')}
                className="w-full rounded-lg border border-orange-200 px-4 py-2 text-sm font-medium text-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('forgotPasswordResendCode')}
              </button>
            </form>
          )}

          {step === 'password' && (
            <form className={pagePlan.formClass} onSubmit={handleResetPassword}>
              <div>
                <label htmlFor="new-password" className={pagePlan.labelClass}>{t('forgotPasswordStepPassword')}</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className={pagePlan.champClass}
                  placeholder={t('forgotPasswordStepPassword')}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className={pagePlan.labelClass}>{t('forgotPasswordConfirmPasswordLabel')}</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className={pagePlan.champClass}
                  placeholder={t('forgotPasswordConfirmPasswordLabel')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              <LoadingButton
                type="submit"
                loading={loading}
                className={pagePlan.boutonClass}
              >
                {t('forgotPasswordResetPassword')}
              </LoadingButton>
            </form>
          )}

          <div className={pagePlan.retourClass}>
            <Link to="/login" className={pagePlan.lienRetourClass}>
              {t(pagePlan.backToLoginKey)}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
