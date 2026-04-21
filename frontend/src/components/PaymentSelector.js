import React, { useState, useEffect } from 'react';
import { usePayment } from '../contexts/PaymentContext';
import { useLanguage } from '../contexts/LanguageContext';
import CommissionService from '../services/commissionService';

const PaymentSelector = ({ 
  userCountry = 'senegal', 
  onMethodSelected = null,
  showTitle = true,
  className = ""
}) => {
  const { 
    selectedMethod, 
    selectPaymentMethod, 
    getAvailableMethodsForCountry,
    calculateFees,
    PAYMENT_METHODS 
  } = usePayment();
  
  const { t, currentLanguage } = useLanguage();
  const [availableMethods, setAvailableMethods] = useState([]);

  useEffect(() => {
    const methods = getAvailableMethodsForCountry(userCountry);
    setAvailableMethods(methods);
  }, [userCountry, getAvailableMethodsForCountry]);

  const handleMethodSelect = (methodId) => {
    selectPaymentMethod(methodId);
    if (onMethodSelected) {
      onMethodSelected(PAYMENT_METHODS[methodId.toUpperCase()]);
    }
  };

  const getMethodName = (method) => {
    switch (currentLanguage) {
      case 'en': return method.nameEn;
      case 'wo': return method.nameWo;
      case 'bm': return method.nameBm;
      default: return method.name;
    }
  };

  const getMethodDescription = (method) => {
    switch (method.id) {
      case 'bank_card': return t('visaMastercard');
      case 'orange_money': return t('orangeMobileMoney');
      case 'wave': return t('waveFreeTransfers');
      default: return method.description;
    }
  };

  const getMethodProcessingTime = () => t('instantLabel');

  return (
    <div className={`payment-selector ${className}`}>
      {showTitle && (
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {t('paymentMethods')}
        </h3>
      )}
      
      <div className="space-y-3">
        {availableMethods.map((method) => (
          <div
            key={method.id}
            onClick={() => handleMethodSelect(method.id)}
            className={`
              payment-method-card cursor-pointer p-4 border-2 rounded-lg transition-all
              ${selectedMethod?.id === method.id 
                ? 'border-orange-500 bg-orange-50' 
                : 'border-gray-200 hover:border-gray-300'
              }
            `}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{method.icon}</span>
                <div>
                  <div className="font-medium text-gray-900">
                    {getMethodName(method)}
                  </div>
                  <div className="text-sm text-gray-500">
                    {getMethodDescription(method)}
                  </div>
                </div>
              </div>
              
              <div className="text-right">
                <div className="text-sm font-medium text-green-600">
                  {method.fees === '0%' ? t('free') : `${t('feesLabel')}: ${method.fees}`}
                </div>
                <div className="text-xs text-gray-500">
                  {getMethodProcessingTime()}
                </div>
              </div>
            </div>
            
            {method.phonePrefix && (
              <div className="mt-2 text-xs text-gray-600">
                {t('ussdCode')}: {method.phonePrefix}
              </div>
            )}
            
            {selectedMethod?.id === method.id && (
              <div className="mt-2 flex items-center text-sm text-orange-600">
                <span className="w-2 h-2 bg-orange-500 rounded-full mr-2"></span>
                {t('methodSelected')}
              </div>
            )}
          </div>
        ))}
      </div>
      
      {availableMethods.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <span className="text-2xl">💳</span>
          <p className="mt-2">{t('noPaymentMethodsRegion')}</p>
        </div>
      )}
      
      {selectedMethod && (
        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <div className="flex items-center text-sm text-blue-800">
            <span className="mr-2">ℹ️</span>
            {t('youSelected') } {getMethodName(selectedMethod)}
          </div>
        </div>
      )}
    </div>
  );
};

// Composant pour afficher les détails de paiement AVEC commission
export const PaymentSummary = ({ amount, currency = 'XOF' }) => {
  const { selectedMethod, calculateFees } = usePayment();
  const { t } = useLanguage();

  if (!selectedMethod) return null;

  const fees = calculateFees(amount, selectedMethod);
  const commissionData = CommissionService.calculateCommissions(amount);
  const total = amount + fees;

  return (
    <div className="payment-summary bg-gray-50 p-4 rounded-lg">
      <h4 className="font-medium text-gray-900 mb-3">{t('paymentSummary')}</h4>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span>{t('serviceAmountLabel')}:</span>
          <span>{amount.toLocaleString()} {currency}</span>
        </div>
        
        <div className="flex justify-between">
          <span>{t('transactionFees')} ({selectedMethod.fees}):</span>
          <span>{fees.toLocaleString()} {currency}</span>
        </div>
        
        <div className="border-t pt-2 flex justify-between font-medium">
          <span>{t('totalToPay')}:</span>
          <span>{total.toLocaleString()} {currency}</span>
        </div>
        
        <div className="bg-blue-50 p-3 rounded-lg mt-3">
          <p className="text-xs text-blue-800 font-medium mb-2">💰 {t('automaticDistribution')}:</p>
          <div className="space-y-1 text-xs text-blue-700">
            <div className="flex justify-between">
              <span>• {t('workerLabel')} (86%):</span>
              <span className="font-medium">{commissionData.workerAmount.toLocaleString()} {currency}</span>
            </div>
            <div className="flex justify-between">
              <span>• {t('platformCommission')} (14%):</span>
              <span className="font-medium">{commissionData.ownerCommission.toLocaleString()} {currency}</span>
            </div>
          </div>
        </div>
        
        <div className="mt-3 flex items-center text-xs text-gray-600">
          <span className="mr-1">{selectedMethod.icon}</span>
          {t('viaMethodAutomaticTransfer', { method: getMethodName(selectedMethod) })}
        </div>
      </div>
    </div>
  );
};

// Composant pour le processus de paiement AVEC commission automatique
export const PaymentProcess = ({ 
  amount, 
  currency = 'XOF', 
  jobId = null, 
  workerId = 'worker_demo_123',
  onSuccess = null, 
  onError = null 
}) => {
  const { selectedMethod } = usePayment();
  const { t } = useLanguage();
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);

  const handlePayment = async () => {
    if (!selectedMethod) {
      alert(t('selectPaymentMethodPrompt'));
      return;
    }

    setIsProcessing(true);
    setResult(null);

    try {
      // Utiliser le service de commission pour traiter le paiement
      const paymentResult = await CommissionService.simulateFullPayment(
        amount, 
        selectedMethod, 
        workerId, 
        jobId
      );
      
      setResult(paymentResult);
      
      if (paymentResult.success && onSuccess) {
        onSuccess(paymentResult);
      } else if (!paymentResult.success && onError) {
        onError(paymentResult.error);
      }
    } catch (error) {
      const errorResult = { success: false, error: error.message };
      setResult(errorResult);
      if (onError) onError(error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="payment-process">
      <button
        onClick={handlePayment}
        disabled={!selectedMethod || isProcessing}
        className={`
          w-full py-3 px-4 rounded-lg font-medium transition-colors
          ${selectedMethod && !isProcessing
            ? 'bg-orange-600 hover:bg-orange-700 text-white'
            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }
        `}
      >
        {isProcessing ? (
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
            {t('processingDistribution')}
          </div>
        ) : (
          `💰 ${t('payAmount')} ${amount?.toLocaleString()} ${currency}`
        )}
      </button>

      {result && (
        <div className={`mt-4 p-4 rounded-lg ${
          result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <div className={`flex items-center ${
            result.success ? 'text-green-800' : 'text-red-800'
          }`}>
            <span className="mr-2">{result.success ? '✅' : '❌'}</span>
            <div className="w-full">
              <p className="font-medium">
                {result.success ? t('paymentSucceededDistribution') : t('paymentFailed')}
              </p>
              <p className="text-sm mt-1">
                {result.success ? result.message : result.error}
              </p>
              {result.transactionId && (
                <p className="text-xs mt-1 font-mono">
                  {t('transactionIdLabel')}: {result.transactionId}
                </p>
              )}
              {result.commission && (
                <div className="mt-2 text-xs space-y-1">
                  <div className="bg-white bg-opacity-50 p-2 rounded">
                    <p className="font-medium">💰 {t('automaticDistribution')}:</p>
                    <p>• {t('ownerLabel')}: {result.commission.ownerCommission.toLocaleString()} {currency} (14%)</p>
                    <p>• {t('workerLabel')}: {result.commission.workerAmount.toLocaleString()} {currency} (86%)</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentSelector;