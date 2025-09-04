import {  createContext, useContext, useState , useMemo } from 'react';
import CommissionService from '../services/commissionService';
import { devLog, safeLog } from '../utils/env';

const PaymentContext = createContext();

export function usePayment() {
  return useContext(PaymentContext);
}

// Méthodes de paiement disponibles en Afrique de l'Ouest
export const PAYMENT_METHODS = {
  BANK_CARD: {
    id: 'bank_card',
    name: 'Carte bancaire',
    nameEn: 'Bank Card',
    nameWo: 'Kart bank',
    nameBm: 'Bank karti',
    icon: '💳',
    description: 'Visa, Mastercard',
    countries: ['mali', 'senegal', 'burkina_faso', 'ivory_coast'],
    fees: '2.5%',
    processingTime: 'Instantané'
  },
  ORANGE_MONEY: {
    id: 'orange_money',
    name: 'Orange Money',
    nameEn: 'Orange Money', 
    nameWo: 'Orange Money',
    nameBm: 'Orange Money',
    icon: '🧡',
    description: 'Mobile Money Orange',
    countries: ['mali', 'senegal', 'burkina_faso', 'ivory_coast'],
    fees: '1%',
    processingTime: 'Instantané',
    phonePrefix: '#144#'
  },
  WAVE: {
    id: 'wave',
    name: 'Wave',
    nameEn: 'Wave',
    nameWo: 'Wave',
    nameBm: 'Wave',
    icon: '🌊',
    description: 'Transferts gratuits Wave',
    countries: ['senegal', 'ivory_coast', 'mali'],
    fees: '0%',
    processingTime: 'Instantané',
    phonePrefix: '*144#'
  }
};

export function PaymentProvider({ children }) {
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [defaultMethod, setDefaultMethod] = useState(null);

  // Obtenir les méthodes disponibles pour un pays
  const getAvailableMethodsForCountry = (country) => {
    return Object.values(PAYMENT_METHODS).filter(method => 
      method.countries.includes(country)
    );
  };

  // Sélectionner une méthode de paiement
  const selectPaymentMethod = (methodId) => {
    const method = PAYMENT_METHODS[methodId.toUpperCase()];
    if (method) {
      setSelectedMethod(method);
      localStorage.setItem('preferred_payment_method', methodId);
    }
  };

  // Définir la méthode par défaut
  const setDefaultPaymentMethod = (methodId) => {
    const method = PAYMENT_METHODS[methodId.toUpperCase()];
    if (method) {
      setDefaultMethod(method);
      localStorage.setItem('default_payment_method', methodId);
    }
  };

  // Traiter un paiement avec commission automatique (comme Uber)
  const processPaymentWithCommission = async (amount, currency = 'XOF', workerId, jobId = null) => {
    if (!selectedMethod) {
      throw new Error('Aucune méthode de paiement sélectionnée');
    }

    try {
      devLog.info('🚗 Traitement paiement avec commission Uber-style...');
      
      // Utiliser le service de commission pour le traitement complet
      const result = await CommissionService.simulateFullPayment(
        amount,
        selectedMethod,
        workerId,
        jobId
      );

      if (result.success) {
        // Ajouter à l'historique avec détails de commission
        const paymentData = {
          id: result.transactionId,
          method: selectedMethod,
          amount,
          currency,
          jobId,
          workerId,
          status: 'success',
          timestamp: new Date().toISOString(),
          fees: calculateFees(amount, selectedMethod),
          commission: result.commission,
          ownerCommission: result.commission.ownerCommission,
          workerAmount: result.commission.workerAmount
        };
        
        setPaymentHistory(prev => [paymentData, ...prev]);
        
        return {
          success: true,
          transactionId: result.transactionId,
          commission: result.commission,
          message: result.message
        };
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      safeLog.error('❌ Erreur paiement avec commission:', error);
      return {
        success: false,
        error: error.message
      };
    }
  };

  // Simuler un paiement (version originale sans commission)
  const processPaymentSimple = async (amount, currency = 'XOF', jobId = null) => {
    if (!selectedMethod) {
      throw new Error('Aucune méthode de paiement sélectionnée');
    }

    // Simulation d'un paiement simple
    const paymentData = {
      id: Date.now().toString(),
      method: selectedMethod,
      amount,
      currency,
      jobId,
      status: 'pending',
      timestamp: new Date().toISOString(),
      fees: calculateFees(amount, selectedMethod)
    };

    try {
      // Simuler un délai de traitement
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Simuler succès (90% de chance de succès)
      if (Math.random() > 0.1) {
        paymentData.status = 'success';
        paymentData.transactionId = generateTransactionId();
        
        // Ajouter à l'historique
        setPaymentHistory(prev => [paymentData, ...prev]);
        
        return {
          success: true,
          transactionId: paymentData.transactionId,
          message: `Paiement de ${amount} ${currency} effectué avec succès via ${selectedMethod.name}`
        };
      } else {
        paymentData.status = 'failed';
        paymentData.error = 'Paiement refusé';
        
        setPaymentHistory(prev => [paymentData, ...prev]);
        
        return {
          success: false,
          error: 'Paiement refusé. Veuillez vérifier vos informations.'
        };
      }
    } catch (error) {
      paymentData.status = 'error';
      paymentData.error = error.message;
      
      setPaymentHistory(prev => [paymentData, ...prev]);
      
      return {
        success: false,
        error: 'Erreur lors du traitement du paiement'
      };
    }
  };

  // Calculer les frais
  const calculateFees = (amount, method) => {
    const feePercent = parseFloat(method.fees.replace('%', '')) / 100;
    return Math.round(amount * feePercent);
  };

  // Générer un ID de transaction
  const generateTransactionId = () => {
    return 'TXN_' + Date.now() + '_' + Math.random().toString(36).substring(7);
  };

  // Obtenir l'historique des paiements
  const getPaymentHistory = () => {
    return paymentHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  };

  // Obtenir les statistiques de paiement
  const getPaymentStats = () => {
    const total = paymentHistory.length;
    const successful = paymentHistory.filter(p => p.status === 'success').length;
    const totalAmount = paymentHistory
      .filter(p => p.status === 'success')
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      total,
      successful,
      successRate: total > 0 ? (successful / total * 100).toFixed(1) : 0,
      totalAmount
    };
  };

  // Initiliser les méthodes sauvegardées
  const initializePaymentMethods = () => {
    const savedDefault = localStorage.getItem('default_payment_method');
    const savedPreferred = localStorage.getItem('preferred_payment_method');
    
    if (savedDefault) {
      const method = PAYMENT_METHODS[savedDefault.toUpperCase()];
      if (method) setDefaultMethod(method);
    }
    
    if (savedPreferred) {
      const method = PAYMENT_METHODS[savedPreferred.toUpperCase()];
      if (method) setSelectedMethod(method);
    }
  };

  const value = {
    // State
    selectedMethod,
    paymentHistory,
    defaultMethod,
    
    // Methods
    selectPaymentMethod,
    setDefaultPaymentMethod,
    processPayment: processPaymentWithCommission, // Méthode principale avec commission
    processPaymentSimple, // Méthode simple sans commission (pour backward compatibility)
    processPaymentWithCommission, // Méthode explicite avec commission
    calculateFees,
    getAvailableMethodsForCountry,
    getPaymentHistory,
    getPaymentStats,
    initializePaymentMethods,
    
    // Constants
    PAYMENT_METHODS,
    
    // Commission service access
    CommissionService
  };

  return (
    <PaymentContext.Provider value={value}>
      {children}
    </PaymentContext.Provider>
  );
}