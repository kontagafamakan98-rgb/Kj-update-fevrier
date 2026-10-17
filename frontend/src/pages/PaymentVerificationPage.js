import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import PaymentAccountSetup from '../components/PaymentAccountSetup';
import CountryDisplay from '../components/CountryDisplay';
import PaymentAccountService from '../services/paymentAccountService';
import { handleApiError } from '../services/api';
import { detectUserCountry } from '../services/geolocationService';
import { mapPaymentAccountErrorToField } from '../utils/paymentAccountErrors';
import { makeScopedTranslator } from '../utils/pack2PageI18n/paymentVerification';
import { clearRegistrationFlow, loadRegistrationFlow, mergeRegistrationFlow } from '../utils/registrationFlowStorage';
import { devLog, safeLog } from '../utils/env';
import { Target, Mail, XCircle, Lock, MapPin } from 'lucide-react';

const PaymentVerificationPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { autoLoginAfterRegistration, loadUser, user: authUser } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t);
  const toast = useToast();

  const getUserTypeLabel = (userType) => t(userType) || userType;
  const isEmailAlreadyUsedMessage = (message = '') => message.toLowerCase().includes('déjà utilisée') || message.toLowerCase().includes('already used');
  const translateApiMessage = (message = '') => isEmailAlreadyUsedMessage(message) ? pageT('duplicateEmailError') : message;

  const persistedFlow = loadRegistrationFlow();
  const routedUserData = location.state?.userData || persistedFlow?.userData || null;
  const emailVerificationToken = location.state?.emailVerificationToken || persistedFlow?.emailVerificationToken || null;
  const effectiveUser = routedUserData || authUser || null;

  const [prefilledPaymentAccounts, setPrefilledPaymentAccounts] = useState(
    () => location.state?.paymentAccounts || persistedFlow?.paymentAccounts || null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorKey, setErrorKey] = useState('');
  // Erreurs de champ renvoyées par le backend, transmises au formulaire pour
  // un affichage sous le champ concerné (ex: « Numéro Orange Money invalide »).
  const [serverFieldErrors, setServerFieldErrors] = useState(null);
  const displayedError = errorKey ? pageT(errorKey) : error;
  const [detectedCountry, setDetectedCountry] = useState(null);
  const [geoLoading, setGeoLoading] = useState(true);

  const isRegistrationFlow = Boolean(emailVerificationToken);
  const isAccountCompletionMode = !isRegistrationFlow && Boolean(authUser?.id);

  useEffect(() => {
    if (!effectiveUser) {
      navigate('/register');
      return;
    }

    if (!isRegistrationFlow && routedUserData && !authUser?.id) {
      navigate('/email-verification', {
        state: {
          userData: routedUserData,
          paymentAccounts: prefilledPaymentAccounts
        }
      });
      return;
    }

    if (isRegistrationFlow) {
      mergeRegistrationFlow({
        userData: routedUserData,
        paymentAccounts: prefilledPaymentAccounts,
        emailVerificationToken,
        currentStep: 'payment-verification'
      });
    }

    detectUserLocationForPayments();
  }, [authUser?.id, emailVerificationToken, effectiveUser, isRegistrationFlow, navigate, prefilledPaymentAccounts, routedUserData]);

  useEffect(() => {
    let isMounted = true;

    const hydrateExistingAccounts = async () => {
      if (!isAccountCompletionMode) {
        return;
      }

      const result = await PaymentAccountService.getUserPaymentAccounts();
      if (isMounted && result.success) {
        setPrefilledPaymentAccounts(result.data?.payment_accounts || null);
      }
    };

    hydrateExistingAccounts();

    return () => {
      isMounted = false;
    };
  }, [isAccountCompletionMode]);

  const detectUserLocationForPayments = async () => {
    try {
      const country = await detectUserCountry();
      // detected:false = échec de détection (objet neutre, jamais null) : on
      // ne sélectionne pas un pays dont le code est vide.
      if (country && country.detected !== false) {
        setDetectedCountry(country);
        devLog.info(`📍 Pays détecté pour paiements: ${country.nameFrench}`);
      }
    } catch (geoError) {
      safeLog.error('Erreur détection pays pour paiements:', geoError);
    } finally {
      setGeoLoading(false);
    }
  };

  const handleRegistrationCompletion = async (paymentAccounts) => {
    setLoading(true);
    setError(null);
    setErrorKey('');
    setServerFieldErrors(null);

    try {
      devLog.info('🏦 Finalisation du compte après email vérifié...');

      mergeRegistrationFlow({
        userData: routedUserData,
        paymentAccounts,
        emailVerificationToken,
        currentStep: 'payment-verification'
      });

      const result = await PaymentAccountService.registerWithPaymentVerification(
        routedUserData,
        paymentAccounts,
        emailVerificationToken
      );

      if (!result.success) {
        // Erreur de validation d'un compte précis (ex: « Numéro Orange Money
        // invalide ») : on la transmet au formulaire pour l'afficher sous le
        // champ concerné, sans bannière générale dupliquée.
        const fieldError = mapPaymentAccountErrorToField(result.error);
        if (fieldError) {
          setServerFieldErrors({ [fieldError.field]: fieldError.message });
          return;
        }
        throw new Error(result.error);
      }

      const autoLoginResult = autoLoginAfterRegistration(result.data.user, result.data.access_token);
      if (!autoLoginResult.success) {
        throw new Error(pageT('autoLoginError'));
      }

      clearRegistrationFlow();

      PaymentAccountService.storeVerificationStatus({
        is_verified: result.data.user.is_verified,
        payment_accounts_count: result.data.user.payment_accounts_count,
        user_type: result.data.user.user_type,
        email_verified: result.data.user.email_verified
      });

      toast.success(pageT('welcomeToast', { firstName: result.data.user.first_name }));

      // Confirmation du code de parrainage appliqué à l'inscription :
      // le bonus de bienvenue (FCFA) est mentionné s'il a été crédité.
      if (result.data.referral_applied) {
        const welcomeBonus = Number(result.data.referral_welcome_bonus || 0);
        toast.success(welcomeBonus > 0
          ? pageT('referralAppliedWithBonusToast', { amount: welcomeBonus })
          : pageT('referralAppliedToast'));
      }

      navigate('/dashboard', {
        state: {
          message: pageT('dashboardMessage', {
            firstName: result.data.user.first_name,
            count: result.data.payment_verification?.linked_accounts || 0
          }),
          type: 'success'
        }
      });
    } catch (registrationError) {
      safeLog.error('❌ Erreur de finalisation du compte:', registrationError);
      const rawErrorMsg = handleApiError(registrationError, pageT('genericError'));
      const errorMsg = translateApiMessage(rawErrorMsg);
      const nextErrorKey = isEmailAlreadyUsedMessage(rawErrorMsg) ? 'duplicateEmailError' : '';

      if (isEmailAlreadyUsedMessage(rawErrorMsg)) {
        clearRegistrationFlow();
        setError(errorMsg);
        setErrorKey(nextErrorKey);
        toast.error({ messageKey: 'duplicateEmailError', scope: 'paymentVerification' });
        navigate('/register', { replace: true });
        return;
      }

      setError(errorMsg);
      setErrorKey(nextErrorKey);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleExistingAccountCompletion = async (result) => {
    setLoading(true);
    setError(null);
    setErrorKey('');

    try {
      await loadUser();
      clearRegistrationFlow();

      PaymentAccountService.storeVerificationStatus({
        is_verified: result?.payment_verification?.is_verified ?? true,
        payment_accounts_count: result?.payment_verification?.linked_accounts ?? 0,
        user_type: effectiveUser?.user_type,
        email_verified: authUser?.email_verified ?? true
      });

      toast.success(pageT('step3DoneToast'));
      navigate('/dashboard', {
        state: {
          message: pageT('dashboardReadyMessage'),
          type: 'success'
        }
      });
    } catch (completionError) {
      safeLog.error('❌ Erreur finalisation étape 3:', completionError);
      const message = handleApiError(completionError, pageT('genericError'));
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (!effectiveUser) {
    return (
      <div className="min-h-full bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500 mx-auto"></div>
          <div className="mt-4 text-orange-600 font-medium">{pageT('redirecting')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 cadre-page max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="space-y-6">
        {/* LE BANDEAU D'ÉCRAN (17/10/2026) : la carte bleue ombrée disait un état
            d'alerte là où la page accueille. Elle appartenait à une gamme froide
            qu'aucun autre écran du site n'emploie, et isolait ses trois
            informations dans trois pavés de couleur. Le bandeau porte maintenant
            la crème du site, les états sont des ÉTIQUETTES carrées
            (`.etiquette-app`, la verte et l'orange étant les seules à dire un
            état), et les phrases sont du texte de lecture.

            Aucun nom d'utilitaire n'est écrit plus haut, même pour mémoire :
            Tailwind lit le TEXTE des sources, et une règle générée qu'aucun
            porteur ne pose est refusée par `check-css-selecteurs-morts.js`. */}
        <section className="bande-app" data-section="bande-inscription">
          <h1 className="titre-page">{t('paymentVerification')}</h1>
          <p className="mt-2 text-sm text-stone-600 sm:max-w-2xl sm:text-base">
            {pageT('welcome', { firstName: effectiveUser.first_name, lastName: effectiveUser.last_name })}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="etiquette-app">
              {pageT('accountType')} · {getUserTypeLabel(effectiveUser.user_type)}
            </span>
            {geoLoading ? (
              <span className="etiquette-app">
                <span className="h-3 w-3 animate-spin rounded-full border-b-2 border-orange-500" aria-hidden="true"></span>
                {pageT('geoDetecting')}
              </span>
            ) : detectedCountry ? (
              <span className="etiquette-app etiquette-app-vert">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {pageT('position')} :{' '}
                <CountryDisplay countryCode={detectedCountry.code} className="inline-flex align-middle" />
              </span>
            ) : (
              <span className="etiquette-app etiquette-app-orange">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {pageT('positionNotDetected')}
              </span>
            )}
          </div>
          {detectedCountry && (
            <p className="mt-2 text-sm text-stone-600">{pageT('examplesAdjusted')}</p>
          )}

          <div className="mt-4 space-y-2 text-sm text-stone-600">
            <p>
              <strong className="font-semibold text-stone-900">{t('lastStep')} :</strong>{' '}
              {isAccountCompletionMode ? t('completePaymentSetupToUnlock') : t('linkAccountsToComplete')}
            </p>
            <p className="flex items-start gap-2">
              <Target className="mt-0.5 h-4 w-4 flex-none text-orange-600" aria-hidden="true" />
              {effectiveUser.user_type === 'worker' ? t('workerPaymentRequirement') : t('clientPaymentRequirement')}
            </p>
            {!isAccountCompletionMode && (
              <p className="flex items-start gap-2">
                <Mail className="mt-0.5 h-4 w-4 flex-none text-orange-600" aria-hidden="true" />
                {pageT('emailStepNotice')}
              </p>
            )}
          </div>
        </section>

        {/* LES TROIS ÉTAPES : les pastilles colorées (vert/orange) et leurs
            traits de liaison peignaient l'AVANCEMENT en couleur d'état, alors
            que la page n'a qu'un état — l'étape 3. Deux étiquettes vertes et une
            orange disent la même chose, avec le vocabulaire du site. */}
        <ol className="flex flex-wrap items-center gap-2" data-section="etapes-inscription">
          {[pageT('stepPersonal'), pageT('stepAccess'), pageT('stepPayments')].map((etape, index) => (
            <li
              key={etape}
              className={`etiquette-app ${index < 2 ? 'etiquette-app-vert' : 'etiquette-app-orange'}`}
            >
              <span aria-hidden="true">{index < 2 ? '✓' : '3'}</span> {etape}
            </li>
          ))}
        </ol>

        {displayedError && (
          <div className="carte-editoriale carte-publique" data-section="erreur-inscription">
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 h-5 w-5 flex-none text-rose-600" aria-hidden="true" />
              <div>
                <h2 className="titre-carte-app">{pageT('registrationErrorTitle')}</h2>
                <p className="mt-2 text-sm text-stone-600">{displayedError}</p>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50">
            <div className="carte-editoriale carte-publique text-center">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-orange-500"></div>
              <div className="mt-4 font-semibold text-stone-900">{pageT('finalizing')}</div>
              <div className="mt-2 text-sm text-stone-600">{pageT('checkingAccounts')}</div>
            </div>
          </div>
        )}

        <PaymentAccountSetup
          userType={effectiveUser.user_type}
          isRegistration={isRegistrationFlow}
          initialAccounts={prefilledPaymentAccounts}
          serverFieldErrors={serverFieldErrors}
          onComplete={isRegistrationFlow ? handleRegistrationCompletion : handleExistingAccountCompletion}
        />

        {isRegistrationFlow && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => navigate('/email-verification', { state: { userData: routedUserData, paymentAccounts: prefilledPaymentAccounts, emailVerificationToken } })}
              disabled={loading}
              className="bouton bouton-clair disabled:opacity-50"
            >
              {pageT('backToRegister')}
            </button>
          </div>
        )}

        <section className="carte-editoriale carte-publique" data-section="securite-inscription">
          <h2 className="titre-carte-app flex items-center gap-2">
            <Lock className="h-5 w-5 flex-none text-orange-600" aria-hidden="true" />
            {pageT('securityTitle')}
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-stone-600">
            <li>{pageT('security1')}</li>
            <li>{pageT('security2')}</li>
            <li>{pageT('security3')}</li>
            <li>{pageT('security4')}</li>
            <li>{pageT('security5')}</li>
          </ul>
        </section>
      </div>
    </div>
  );
};

export default PaymentVerificationPage;
