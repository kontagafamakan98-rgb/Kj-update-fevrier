import React, { useMemo, useState } from 'react';
import PaymentSelector, { PaymentSummary, PaymentProcess } from '../components/PaymentSelector';
import LanguageSelector from '../components/LanguageSelector';
import { useLanguage } from '../contexts/LanguageContext';
import { usePayment } from '../contexts/PaymentContext';
import { makeScopedTranslator, normalizeCountryCode } from '../utils/pack2PageI18n';
import { devLog } from '../utils/env';

const PaymentDemo = () => {
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'paymentDemo');
  const { processPaymentWithCommission } = usePayment();

  const [paymentAmount, setPaymentAmount] = useState(25000);
  const [selectedCountry, setSelectedCountry] = useState('senegal');
  const [showCommissionDemo, setShowCommissionDemo] = useState(false);
  const [commissionResult, setCommissionResult] = useState(null);
  const [processing, setProcessing] = useState(false);

  const supportedCountries = useMemo(
    () => ['senegal', 'mali', 'burkina_faso', 'ivory_coast'],
    []
  );

  const getCountryLabel = (countryCode) => {
    const translated = t(normalizeCountryCode(countryCode));
    return typeof translated === 'string' ? translated : countryCode;
  };

  const handlePaymentSuccess = (result) => {
    alert(pageT('paymentAlertSuccess', { id: result.transactionId }));
  };

  const handlePaymentError = (error) => {
    alert(pageT('paymentAlertError', { error }));
  };

  const simulateUberStylePayment = async () => {
    setProcessing(true);
    setCommissionResult(null);

    try {
      const result = await processPaymentWithCommission(
        paymentAmount,
        'XOF',
        'worker_123',
        'job_uber_demo_456'
      );
      setCommissionResult(result);
    } catch (error) {
      setCommissionResult({
        success: false,
        error: error.message
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4 gap-4 flex-wrap">
            <h1 className="text-3xl font-bold text-gray-900">{pageT('title')}</h1>
            <LanguageSelector showDropdown={true} showFlags={true} />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h2 className="font-medium text-blue-900 mb-2">{pageT('newFeatures')}</h2>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>{pageT('feat1')}</li>
              <li>{pageT('feat2')}</li>
              <li>{pageT('feat3')}</li>
              <li>{pageT('feat4')}</li>
              <li>{pageT('feat5')}</li>
            </ul>
          </div>
        </div>

        <div className="mb-8 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="text-xl font-semibold text-green-900">{pageT('commissionTitle')}</h2>
            <button
              onClick={() => setShowCommissionDemo(!showCommissionDemo)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              {showCommissionDemo ? pageT('hideCommission') : pageT('showCommission')}
            </button>
          </div>

          <div className="text-sm text-green-800 mb-4">
            <p>
              <strong>{pageT('howItWorks')}:</strong> {pageT('howItWorksText')}
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>{pageT('ownerShare')}</li>
              <li>{pageT('workerShare')}</li>
              <li>{pageT('autoTransfer')}</li>
            </ul>
          </div>

          {showCommissionDemo && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {pageT('serviceAmount')}
                  </label>
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    min="1000"
                    step="1000"
                  />
                </div>

                <div className="bg-white p-4 rounded-lg">
                  <div className="text-sm">
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-600">{pageT('totalAmount')}:</span>
                      <span className="font-semibold">{paymentAmount.toLocaleString()} XOF</span>
                    </div>
                    <div className="flex justify-between mb-2 text-green-600">
                      <span>{pageT('yourCommission')}:</span>
                      <span className="font-semibold">{Math.round(paymentAmount * 0.14).toLocaleString()} XOF</span>
                    </div>
                    <div className="flex justify-between text-blue-600">
                      <span>{pageT('toWorker')}:</span>
                      <span className="font-semibold">{Math.round(paymentAmount * 0.86).toLocaleString()} XOF</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-lg flex items-center">
                  <button
                    onClick={simulateUberStylePayment}
                    disabled={processing}
                    className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {processing ? pageT('processing') : pageT('simulatePayment')}
                  </button>
                </div>
              </div>

              {commissionResult && (
                <div
                  className={`p-4 rounded-lg ${
                    commissionResult.success
                      ? 'bg-green-100 border border-green-200'
                      : 'bg-red-100 border border-red-200'
                  }`}
                >
                  {commissionResult.success ? (
                    <div>
                      <h3 className="font-semibold text-green-800 mb-2">{pageT('paymentSuccess')}</h3>
                      <div className="text-sm text-green-700 space-y-1">
                        <p>
                          <strong>{pageT('transactionId')}:</strong> {commissionResult.transactionId}
                        </p>
                        <p>
                          <strong>{pageT('message')}:</strong> {commissionResult.message}
                        </p>
                        {commissionResult.commission && (
                          <div className="mt-2 p-2 bg-white rounded">
                            <p>
                              <strong>{pageT('commissionDetails')}:</strong>
                            </p>
                            <p>• {pageT('totalAmount')}: {commissionResult.commission.totalAmount.toLocaleString()} XOF</p>
                            <p>• {pageT('yourCommission')}: {commissionResult.commission.ownerCommission.toLocaleString()} XOF</p>
                            <p>• {pageT('toWorker')}: {commissionResult.commission.workerAmount.toLocaleString()} XOF</p>
                          </div>
                        )}
                        <p className="mt-3 text-xs">
                          🔗{' '}
                          <a href="/commission-dashboard" className="text-green-600 hover:underline">
                            {pageT('seeCommissionDashboard')}
                          </a>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <h3 className="font-semibold text-red-800 mb-2">{pageT('paymentError')}</h3>
                      <p className="text-sm text-red-700">{commissionResult.error}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{pageT('languageSelector')}</h2>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">{pageT('dropdownVersion')}:</h3>
                <LanguageSelector showDropdown={true} />
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">{pageT('buttonVersion')}:</h3>
                <LanguageSelector showDropdown={false} />
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-medium text-gray-900 mb-2">{pageT('translationExamples')}:</h4>
                <div className="text-sm space-y-1">
                  <div><strong>{pageT('exampleHomeKey')}:</strong> {t('home')}</div>
                  <div><strong>{pageT('exampleJobsKey')}:</strong> {t('jobs')}</div>
                  <div><strong>{pageT('examplePaymentKey')}:</strong> {t('payment')}</div>
                  <div><strong>{pageT('exampleBankCardKey')}:</strong> {t('bankCard')}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{pageT('paymentMethodsTitle')}</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{pageT('countryLabel')}:</label>
                <select
                  value={selectedCountry}
                  onChange={(e) => setSelectedCountry(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  {supportedCountries.map((country) => (
                    <option key={country} value={country}>
                      {getCountryLabel(country)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{pageT('amountLabel')}:</label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(parseInt(e.target.value, 10) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  min="500"
                  step="500"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">{pageT('noCommissionTitle')}</h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <PaymentSelector
                userCountry={selectedCountry}
                onMethodSelected={(method) => {
                  devLog.info('Selected payment method:', method);
                }}
              />
            </div>

            <div className="space-y-4">
              <PaymentSummary amount={paymentAmount} currency="XOF" />

              <PaymentProcess
                amount={paymentAmount}
                currency="XOF"
                jobId="demo_job_123"
                onSuccess={handlePaymentSuccess}
                onError={handlePaymentError}
              />
            </div>
          </div>
        </div>

        <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-yellow-800 mb-3">{pageT('technicalInfo')}</h2>
          <div className="text-sm text-yellow-700 space-y-2">
            <p><strong>{pageT('supportedLanguages')}:</strong> {pageT('supportedLanguagesValue', { french: t('french'), english: t('english'), wolof: t('wolof'), bambara: t('bambara'), moore: t('moore') })}</p>
            <p><strong>{pageT('supportedMethods')}:</strong> {pageT('supportedMethodsValue', { bankCard: t('bankCard'), orangeMoney: t('orangeMoney'), wave: t('wave') })}</p>
            <p><strong>{pageT('supportedCountries')}:</strong> {supportedCountries.map(getCountryLabel).join(', ')}</p>
            <p><strong>{pageT('currency')}:</strong> {pageT('currencyValue')}</p>
            <p><strong>{pageT('automaticCommission')}:</strong> {pageT('automaticCommissionValue')}</p>
            <p><strong>{pageT('note')}:</strong> {pageT('noteText')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentDemo;
