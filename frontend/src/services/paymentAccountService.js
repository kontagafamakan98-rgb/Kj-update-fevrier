import { authAPI, api } from './api';
import { devLog, safeLog } from '../utils/env';

// Service de gestion des comptes de paiement pour la vérification
class PaymentAccountService {
  /** @returns {Promise<{success: boolean, data?: object, error?: string}>} */
  async registerWithPaymentVerification(userData, paymentAccounts, emailVerificationToken) {
    try {
      devLog.info('🏦📧 Finalisation inscription avec vérification paiement et email...');
      
      const registrationData = {
        ...userData,
        payment_accounts: paymentAccounts,
        email_verification_token: emailVerificationToken
      };

      const responseData = await (authAPI.registerVerified
        ? authAPI.registerVerified(registrationData)
        : api.post('/auth/register-verified', registrationData));

      devLog.info('✅ Inscription avec paiement + email réussie:', responseData);
      
      return {
        success: true,
        data: responseData
      };

    } catch (error) {
      safeLog.error('❌ Erreur inscription finale:', error);
      return {
        success: false,
        error: error?.response?.data?.detail || error.message
      };
    }
  }

  /** @returns {Promise<{success: boolean, data?: object, error?: string}>} */
  async getUserPaymentAccounts() {
    try {
      devLog.info('📋 Récupération comptes de paiement...');

      const result = await api.get('/users/payment-accounts');
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

  /** @returns {Promise<{success: boolean, data?: object, error?: string}>} */
  async updatePaymentAccounts(paymentAccounts) {
    try {
      devLog.info('🔄 Mise à jour comptes de paiement...');

      const result = await api.put('/users/payment-accounts', paymentAccounts);
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

  /** @returns {Promise<{success: boolean, data?: object, error?: string}>} */
  async verifyPaymentAccess() {
    try {
      devLog.info('🔐 Vérification accès paiement...');

      const result = await api.post('/users/verify-payment-access');
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

  /** @returns {boolean} true si le numéro Orange Money est valide. */
  validateOrangeMoneyNumber(number) {
    const cleanNumber = number.replace(/[\s\-\+]/g, '');
    const validPrefixes = ['223', '221', '226', '225']; // Mali, Sénégal, Burkina Faso, Côte d'Ivoire
    
    if (cleanNumber.length < 11) return false;
    
    const prefix = cleanNumber.substring(0, 3);
    return validPrefixes.includes(prefix) && cleanNumber.length <= 12;
  }

  /** @returns {boolean} true si le numéro Wave est valide. */
  validateWaveNumber(number) {
    const cleanNumber = number.replace(/[\s\-\+]/g, '');
    const validPrefixes = ['221', '225']; // Sénégal, Côte d'Ivoire
    
    if (cleanNumber.length < 11) return false;
    
    const prefix = cleanNumber.substring(0, 3);
    return validPrefixes.includes(prefix) && cleanNumber.length <= 12;
  }

  /** @returns {boolean} true si le numéro de carte est valide. */
  validateBankCard(cardNumber) {
    const cleanCard = cardNumber.replace(/[\s\-]/g, '');
    return cleanCard.length >= 15 && cleanCard.length <= 16 && /^\d+$/.test(cleanCard);
  }

  /** @returns {string} Numéro formaté (+indicatif si possible). */
  formatPhoneNumber(number) {
    const cleanNumber = number.replace(/[\s\-]/g, '');
    if (cleanNumber.startsWith('+')) return cleanNumber;
    if (cleanNumber.length >= 11) {
      const prefix = cleanNumber.substring(0, 3);
      return `+${prefix}${cleanNumber.substring(3)}`;
    }
    return number;
  }

  /** @returns {string} Carte formatée en groupes de 4. */
  formatBankCard(cardNumber) {
    const cleanCard = cardNumber.replace(/[\s\-]/g, '');
    return cleanCard.replace(/(.{4})/g, '$1-').slice(0, -1);
  }

  /** @returns {string} Carte masquée (****-****-****-1234). */
  maskBankCard(cardNumber) {
    const cleanCard = cardNumber.replace(/[\s\-]/g, '');
    if (cleanCard.length >= 16) {
      return `****-****-****-${cleanCard.slice(-4)}`;
    } else if (cleanCard.length >= 15) {
      return `****-****-***-${cleanCard.slice(-4)}`;
    }
    return '****-****-****';
  }

  /** @returns {object|null} Statut de vérification stocké, ou null. */
  getStoredVerificationStatus() {
    try {
      const stored = localStorage.getItem('payment_verification_status');
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      safeLog.error('Erreur lecture statut vérification:', error);
      return null;
    }
  }

  /** @returns {void} Statut sauvegardé dans localStorage. */
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

  /** @returns {void} Cache de vérification nettoyé. */
  clearVerificationCache() {
    try {
      localStorage.removeItem('payment_verification_status');
      devLog.info('🗑️ Cache vérification nettoyé');
    } catch (error) {
      safeLog.error('Erreur nettoyage cache:', error);
    }
  }

  /** @returns {boolean} true si des comptes de paiement manquent. */
  needsPaymentSetup(userType, paymentAccountsCount) {
    if (userType === 'client') {
      return paymentAccountsCount < 1;
    } else if (userType === 'worker') {
      return paymentAccountsCount < 2;
    }
    return false;
  }

  /** @returns {object} {minimum, description, purpose} exigences par rôle. */
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