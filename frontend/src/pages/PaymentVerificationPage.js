import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import PaymentAccountSetup from '../components/PaymentAccountSetup';
import CountryDisplay from '../components/CountryDisplay';
import PaymentAccountService from '../services/paymentAccountService';
import { detectUserCountry } from '../services/geolocationService';
import { makeScopedTranslator } from '../utils/pack2PageI18n';
import { clearRegistrationFlow, loadRegistrationFlow, mergeRegistrationFlow } from '../utils/registrationFlowStorage';
import { devLog, safeLog } from '../utils/env';

const PaymentVerificationPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { autoLoginAfterRegistration } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'paymentVerification');
  const toast = useToast();

  const getUserTypeLabel = (userType) => t(userType) || userType;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detectedCountry, setDetectedCountry] = useState(null);
  const [geoLoading, setGeoLoading] = useState(true);

  const persistedFlow = loadRegistrationFlow();
  const userData = location.state?.userData || persistedFlow?.userData || null;
  const prefilledPaymentAccounts = location.state?.paymentAccounts || persistedFlow?.paymentAccounts || null;
  const emailVerificationToken = location.state?.emailVerificationToken || persistedFlow?.emailVerificationToken || null;

  useEffect(() => {
    if (!userData) {
      navigate('/register');
      return;
    }

    if (!emailVerificationToken) {
      navigate('/email-verification', {
        state: {
          userData,
          paymentAccounts: prefilledPaymentAccounts
        }
      });
      return;
    }

    mergeRegistrationFlow({
      userData,
      paymentAccounts: prefilledPaymentAccounts,
      emailVerificationToken,
      currentStep: 'payment-verification'
    });

    detectUserLocationForPayments();
  }, [emailVerificationToken, navigate, prefilledPaymentAccounts, userData]);

  const detectUserLocationForPayments = async () => {
    try {
      const country = await detectUserCountry();
      if (country) {
        setDetectedCountry(country);
        devLog.info(`📍 Pays détecté pour paiements: ${country.nameFrench} ${country.flag}`);
      }
    } catch (geoError) {
      safeLog.error('Erreur détection pays pour paiements:', geoError);
    } finally {
      setGeoLoading(false);
    }
  };

  const handlePaymentAccountsComplete = async (paymentAccounts) => {
    setLoading(true);
    setError(null);

    try {
      devLog.info('🏦 Finalisation du compte après email vérifié...');

      mergeRegistrationFlow({
        userData,
        paymentAccounts,
        emailVerificationToken,
        currentStep: 'payment-verification'
      });

      const result = await PaymentAccountService.registerWithPaymentVerification(
        userData,
        paymentAccounts,
        emailVerificationToken
      );

      if (!result.success) {
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
      const errorMsg = registrationError.message || pageT('genericError');
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
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
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">{t('paymentVerification')}</h1>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 max-w-2xl mx-auto">
            <div className="flex items-center justify-center mb-4">
              <span className="text-4xl mr-4">👋</span>
              <div className="text-left">
                <p className="text-lg font-semibold text-blue-900">
                  {pageT('welcome', { firstName: userData.first_name, lastName: userData.last_name })}
                </p>
                <p className="text-blue-700">
                  {pageT('accountType')}: <span className="font-medium">{getUserTypeLabel(userData.user_type)}</span>
                </p>
              </div>
            </div>

            {geoLoading ? (
              <div className="mb-4 p-3 bg-blue-100 border border-blue-300 rounded text-center">
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
                  <span className="text-sm text-blue-800">{pageT('geoDetecting')}</span>
                </div>
              </div>
            ) : detectedCountry ? (
              <div className="mb-4 p-3 bg-green-100 border border-green-300 rounded text-center">
                <p className="text-sm text-green-800">
                  <span className="font-medium">{pageT('position')}:</span> <CountryDisplay countryCode={detectedCountry.code} className="inline-flex align-middle" />
                </p>
                <p className="text-xs text-green-600 mt-1">{pageT('examplesAdjusted')}</p>
              </div>
            ) : (
              <div className="mb-4 p-3 bg-yellow-100 border border-yellow-300 rounded text-center">
                <p className="text-xs text-yellow-700">{pageT('positionNotDetected')}</p>
              </div>
            )}

            <div className="text-sm text-blue-800 space-y-2">
              <p>
                <strong>{t('lastStep')}:</strong> {t('linkAccountsToComplete')}
              </p>
              <p>
                🎯 {userData.user_type === 'worker' ? t('workerPaymentRequirement') : t('clientPaymentRequirement')}
              </p>
              <p>
                📧 {pageT('emailStepNotice')}
              </p>
            </div>
          </div>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-center space-x-4">
            <StepDot number="✓" label={pageT('stepPersonal')} bg="bg-green-500" text="text-green-600" />
            <div className="w-16 h-1 bg-green-200"></div>
            <StepDot number="✓" label={pageT('stepAccess')} bg="bg-green-500" text="text-green-600" />
            <div className="w-16 h-1 bg-orange-200"></div>
            <StepDot number="3" label={pageT('stepPayments')} bg="bg-orange-500" text="text-orange-600" />
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center">
              <span className="text-red-500 text-xl mr-3">❌</span>
              <div>
                <h3 className="font-semibold text-red-800">{pageT('registrationErrorTitle')}</h3>
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-lg text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto"></div>
              <div className="mt-4 text-gray-700 font-medium">{pageT('finalizing')}</div>
              <div className="text-sm text-gray-500 mt-2">{pageT('checkingAccounts')}</div>
            </div>
          </div>
        )}

        <PaymentAccountSetup
          userType={userData.user_type}
          isRegistration={true}
          initialAccounts={prefilledPaymentAccounts}
          onComplete={handlePaymentAccountsComplete}
        />

        <div className="mt-8 text-center">
          <button
            onClick={() => navigate('/email-verification', { state: { userData, paymentAccounts: prefilledPaymentAccounts, emailVerificationToken } })}
            disabled={loading}
            className="text-orange-600 hover:text-orange-700 text-sm font-medium disabled:opacity-50"
          >
            {pageT('backToRegister')}
          </button>
        </div>

        <div className="mt-12 bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
            <span className="text-xl mr-2">🔐</span>
            {pageT('securityTitle')}
          </h3>
          <div className="text-sm text-gray-700 space-y-2">
            <p>{pageT('security1')}</p>
            <p>{pageT('security2')}</p>
            <p>{pageT('security3')}</p>
            <p>{pageT('security4')}</p>
            <p>{pageT('security5')}</p>
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

export default PaymentVerificationPage;
