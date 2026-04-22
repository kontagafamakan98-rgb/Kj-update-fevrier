import { devLog, safeLog } from '../utils/env';

// Service de gestion des comptes de paiement pour la vérification
class PaymentAccountService {
  constructor() {
    this.API_BASE = process.env.REACT_APP_BACKEND_URL + '/api';
  }

  // Obtenir les headers d'autorisation
  getAuthHeaders() {
    const token = localStorage.getItem('token');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  // Inscription finale avec vérification email + comptes de paiement
  async registerWithPaymentVerification(userData, paymentAccounts, emailVerificationToken) {
    try {
      devLog.info('🏦📧 Finalisation inscription avec vérification paiement et email...');
      
      const registrationData = {
        ...userData,
        payment_accounts: paymentAccounts,
        email_verification_token: emailVerificationToken
      };

      const response = await fetch(`${this.API_BASE}/auth/register-verified`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(registrationData)
      });

      let responseData = null;
      try {
        responseData = await response.json();
      } catch (parseError) {
        responseData = null;
      }

      if (!response.ok) {
        throw new Error(responseData?.detail || 'Erreur lors de la finalisation de l\'inscription');
      }

      devLog.info('✅ Inscription avec paiement + email réussie:', responseData);
      
      return {
        success: true,
        data: responseData
      };

    } catch (error) {
      safeLog.error('❌ Erreur inscription finale:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Obtenir les comptes de paiement de l'utilisateur
  async getUserPaymentAccounts() {
    try {
      devLog.info('📋 Récupération comptes de paiement...');

      const response = await fetch(`${this.API_BASE}/users/payment-accounts`, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Erreur lors de la récupération');
      }

      const result = await response.json();
      devLog.info('✅ Comptes de paiement récupérés:', result);
      
      return {
        success: true,
        data: result
      };

    } catch (error) {
      safeLog.error('❌ Erreur récupération comptes:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Mettre à jour les comptes de paiement
  async updatePaymentAccounts(paymentAccounts) {
    try {
      devLog.info('🔄 Mise à jour comptes de paiement...');

      const response = await fetch(`${this.API_BASE}/users/payment-accounts`, {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(paymentAccounts)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Erreur lors de la mise à jour');
      }

      const result = await response.json();
      devLog.info('✅ Comptes de paiement mis à jour:', result);
      
      return {
        success: true,
        data: result
      };

    } catch (error) {
      safeLog.error('❌ Erreur mise à jour comptes:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Vérifier l'accès aux fonctionnalités de paiement
  async verifyPaymentAccess() {
    try {
      devLog.info('🔐 Vérification accès paiement...');

      const response = await fetch(`${this.API_BASE}/users/verify-payment-access`, {
        method: 'POST',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Erreur lors de la vérification');
      }

      const result = await response.json();
      devLog.info('✅ Vérification accès:', result);
      
      return {
        success: true,
        data: result
      };

    } catch (error) {
      safeLog.error('❌ Erreur vérification accès:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Valider un numéro Orange Money côté client
  validateOrangeMoneyNumber(number) {
    const cleanNumber = number.replace(/[\s\-\+]/g, '');
    const validPrefixes = ['223', '221', '226', '225']; // Mali, Sénégal, Burkina Faso, Côte d'Ivoire
    
    if (cleanNumber.length < 11) return false;
    
    const prefix = cleanNumber.substring(0, 3);
    return validPrefixes.includes(prefix) && cleanNumber.length <= 12;
  }

  // Valider un numéro Wave côté client
  validateWaveNumber(number) {
    const cleanNumber = number.replace(/[\s\-\+]/g, '');
    const validPrefixes = ['221', '225']; // Sénégal, Côte d'Ivoire
    
    if (cleanNumber.length < 11) return false;
    
    const prefix = cleanNumber.substring(0, 3);
    return validPrefixes.includes(prefix) && cleanNumber.length <= 12;
  }

  // Valider une carte bancaire côté client
  validateBankCard(cardNumber) {
    const cleanCard = cardNumber.replace(/[\s\-]/g, '');
    return cleanCard.length >= 15 && cleanCard.length <= 16 && /^\d+$/.test(cleanCard);
  }

  // Formater un numéro de téléphone
  formatPhoneNumber(number) {
    const cleanNumber = number.replace(/[\s\-]/g, '');
    if (cleanNumber.startsWith('+')) return cleanNumber;
    if (cleanNumber.length >= 11) {
      const prefix = cleanNumber.substring(0, 3);
      return `+${prefix}${cleanNumber.substring(3)}`;
    }
    return number;
  }

  // Formater un numéro de carte bancaire
  formatBankCard(cardNumber) {
    const cleanCard = cardNumber.replace(/[\s\-]/g, '');
    return cleanCard.replace(/(.{4})/g, '$1-').slice(0, -1);
  }

  // Masquer un numéro de carte bancaire
  maskBankCard(cardNumber) {
    const cleanCard = cardNumber.replace(/[\s\-]/g, '');
    if (cleanCard.length >= 16) {
      return `****-****-****-${cleanCard.slice(-4)}`;
    } else if (cleanCard.length >= 15) {
      return `****-****-***-${cleanCard.slice(-4)}`;
    }
    return '****-****-****';
  }

  // Obtenir le statut de vérification depuis localStorage
  getStoredVerificationStatus() {
    try {
      const stored = localStorage.getItem('payment_verification_status');
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      safeLog.error('Erreur lecture statut vérification:', error);
      return null;
    }
  }

  // Sauvegarder le statut de vérification dans localStorage
  storeVerificationStatus(status) {
    try {
      localStorage.setItem('payment_verification_status', JSON.stringify({
        ...status,
        timestamp: Date.now()
      }));
      devLog.info('✅ Statut vérification sauvegardé');
    } catch (error) {
      safeLog.error('Erreur sauvegarde statut:', error);
    }
  }

  // Nettoyer le cache de vérification
  clearVerificationCache() {
    try {
      localStorage.removeItem('payment_verification_status');
      devLog.info('🗑️ Cache vérification nettoyé');
    } catch (error) {
      safeLog.error('Erreur nettoyage cache:', error);
    }
  }

  // Vérifier si l'utilisateur a besoin de configurer ses comptes
  needsPaymentSetup(userType, paymentAccountsCount) {
    if (userType === 'client') {
      return paymentAccountsCount < 1;
    } else if (userType === 'worker') {
      return paymentAccountsCount < 2;
    }
    return false;
  }

  // Obtenir les informations sur les exigences de paiement
  getPaymentRequirements(userType) {
    if (userType === 'client') {
      return {
        minimum: 1,
        description: 'Les clients doivent lier au moins 1 moyen de paiement pour effectuer des paiements',
        purpose: 'Paiements futurs aux travailleurs'
      };
    } else if (userType === 'worker') {
      return {
        minimum: 2,
        description: 'Les travailleurs doivent lier au minimum 2 moyens de paiement pour recevoir leurs paiements',
        purpose: 'Réception des paiements des clients'
      };
    }
    return { minimum: 0, description: '', purpose: '' };
  }
}

export default new PaymentAccountService();