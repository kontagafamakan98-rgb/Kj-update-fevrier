import React, { useState, useEffect } from 'react';
import { usePayment } from '../contexts/PaymentContext';
import { useLanguage } from '../contexts/LanguageContext';

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
                    {method.description}
                  </div>
                </div>
              </div>
              
              <div className="text-right">
                <div className="text-sm font-medium text-green-600">
                  {method.fees === '0%' ? 'Gratuit' : `Frais: ${method.fees}`}
                </div>
                <div className="text-xs text-gray-500">
                  {method.processingTime}
                </div>
              </div>
            </div>
            
            {method.phonePrefix && (
              <div className="mt-2 text-xs text-gray-600">
                Code USSD: {method.phonePrefix}
              </div>
            )}
            
            {selectedMethod?.id === method.id && (
              <div className="mt-2 flex items-center text-sm text-orange-600">
                <span className="w-2 h-2 bg-orange-500 rounded-full mr-2"></span>
                Méthode sélectionnée
              </div>
            )}
          </div>
        ))}
      </div>
      
      {availableMethods.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <span className="text-2xl">💳</span>
          <p className="mt-2">Aucune méthode de paiement disponible pour votre région</p>
        </div>
      )}
      
      {selectedMethod && (
        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <div className="flex items-center text-sm text-blue-800">
            <span className="mr-2">ℹ️</span>
            Vous avez sélectionné {getMethodName(selectedMethod)}
          </div>
        </div>
      )}
    </div>
  );
};

// Composant pour afficher les détails de paiement
export const PaymentSummary = ({ amount, currency = 'XOF' }) => {
  const { selectedMethod, calculateFees } = usePayment();
  const { t } = useLanguage();

  if (!selectedMethod) return null;

  const fees = calculateFees(amount, selectedMethod);
  const total = amount + fees;

  return (
    <div className="payment-summary bg-gray-50 p-4 rounded-lg">
      <h4 className="font-medium text-gray-900 mb-3">Résumé du paiement</h4>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span>Montant:</span>
          <span>{amount.toLocaleString()} {currency}</span>
        </div>
        
        <div className="flex justify-between">
          <span>Frais ({selectedMethod.fees}):</span>
          <span>{fees.toLocaleString()} {currency}</span>
        </div>
        
        <div className="border-t pt-2 flex justify-between font-medium">
          <span>Total:</span>
          <span>{total.toLocaleString()} {currency}</span>
        </div>
        
        <div className="mt-3 flex items-center text-xs text-gray-600">
          <span className="mr-1">{selectedMethod.icon}</span>
          Via {selectedMethod.name}
        </div>
      </div>
    </div>
  );
};

// Composant pour le processus de paiement
export const PaymentProcess = ({ amount, currency = 'XOF', jobId = null, onSuccess = null, onError = null }) => {
  const { selectedMethod, processPayment } = usePayment();
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);

  const handlePayment = async () => {
    if (!selectedMethod) {
      alert('Veuillez sélectionner une méthode de paiement');
      return;
    }

    setIsProcessing(true);
    setResult(null);

    try {
      const paymentResult = await processPayment(amount, currency, jobId);
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
            Traitement en cours...
          </div>
        ) : (
          `Payer ${amount?.toLocaleString()} ${currency}`
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
            <div>
              <p className="font-medium">
                {result.success ? 'Paiement réussi!' : 'Paiement échoué'}
              </p>
              <p className="text-sm mt-1">
                {result.success ? result.message : result.error}
              </p>
              {result.transactionId && (
                <p className="text-xs mt-1 font-mono">
                  ID: {result.transactionId}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentSelector;