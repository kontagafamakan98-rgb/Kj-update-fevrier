import { paymentAPI } from './apiEndpoints';
import { devLog, safeLog } from '../utils/env';

class CommissionService {
  constructor() {
    // Taux par DÉFAUT (14%) — le taux EFFECTIF est chargé depuis le backend
    // (/payments/config → commission_rate_percent) via refreshCommissionRate()
    // et peut être modifié en base (db.settings type=commission) ou par env.
    // Le backend recalcule TOUJOURS le vrai montant : ce taux ne sert qu'à
    // l'affichage local (stats / simulation) et doit donc rester synchronisé.
    this.DEFAULT_COMMISSION_RATE = 0.14;
    this.COMMISSION_RATE = this.DEFAULT_COMMISSION_RATE;
    this.WORKER_RATE = 1 - this.DEFAULT_COMMISSION_RATE;
    // Promesse mémoïsée du chargement du taux (évite un fetch à chaque appel).
    this._ratePromise = null;
    this.OWNER_ACCOUNTS = {
      bank_card: {
        accountNumber: '1234567890123456',
        accountName: 'PROPRIETAIRE KOJO',
        bank: 'Banque Atlantique'
      },
      orange_money: {
        phoneNumber: '+221701234567',
        accountName: 'PROPRIETAIRE KOJO'
      },
      wave: {
        phoneNumber: '+221701234567',
        accountName: 'PROPRIETAIRE KOJO'
      }
    };
  }

  /** @returns {Promise<{totalAmount, ownerCommission, workerAmount, commissionRate}>} */
  async calculateCommissions(totalAmount) {
    // Le taux EFFECTIF est toujours chargé avant le calcul (plus jamais le
    // 14% codé en dur si le backend en expose un autre).
    await this.refreshCommissionRate();
    const ownerCommission = Math.round(totalAmount * this.COMMISSION_RATE);
    const workerAmount = Math.round(totalAmount - ownerCommission);

    return {
      totalAmount: Math.round(totalAmount),
      ownerCommission,
      workerAmount,
      // Arrondi à 2 décimales comme le backend (round(rate*100, 2)) : évite
      // l'affichage 14.000000000000002 pour 0.14*100.
      commissionRate: Number((this.COMMISSION_RATE * 100).toFixed(2))
    };
  }

  /** @returns {Promise<object>} Config fournisseur (fallback local si échec). */
  async getProviderConfig() {
    try {
      return await paymentAPI.getConfig();
    } catch (error) {
      safeLog.error('❌ Erreur config paiements:', error);
      return { provider: 'paydunya', configured: false, mode: 'test', commission_rate_percent: 14 };
    }
  }

  /**
   * Charge le taux de commission EFFECTIF depuis le backend (/payments/config)
   * et met à jour COMMISSION_RATE / WORKER_RATE (cache). Fail-safe : si la
   * lecture échoue ou que la valeur est invalide, on garde le taux courant.
   *
   * @returns {Promise<number>} Taux en fraction (ex: 0.2 = 20%).
   */
  async refreshCommissionRate() {
    // Mémoïsation : le taux n'est chargé qu'une fois (un seul fetch pour N
    // calculs successifs). En cas d'échec réseau, la promesse est remise à
    // zéro pour tenter à nouveau au prochain appel — le taux courant (défaut
    // 14%) sert de fallback.
    if (!this._ratePromise) {
      this._ratePromise = this._fetchRate();
    }
    return this._ratePromise;
  }

  async _fetchRate() {
    try {
      const config = await this.getProviderConfig();
      const percent = Number(config?.commission_rate_percent);
      if (Number.isFinite(percent) && percent > 0 && percent <= 50) {
        const rate = percent / 100;
        this.COMMISSION_RATE = rate;
        this.WORKER_RATE = 1 - rate;
      } else {
        safeLog.warn(`⚠️ Taux de commission backend invalide (${config?.commission_rate_percent}), garde ${this.COMMISSION_RATE * 100}%`);
      }
    } catch (error) {
      // Échec réseau : on réessaiera au prochain appel.
      safeLog.error('❌ Erreur chargement taux commission:', error);
      this._ratePromise = null;
    }
    return this.COMMISSION_RATE;
  }

  /** @returns {Promise<object>} Devis de paiement (montant, commission...). */
  async getQuote({ amount, paymentMethod, country = 'senegal', workerId = null, jobId = null }) {
    try {
      return await paymentAPI.getQuote({
        amount,
        payment_method: paymentMethod?.id || paymentMethod,
        country,
        worker_id: workerId,
        job_id: jobId
      });
    } catch (error) {
      safeLog.error('❌ Erreur quote paiement:', error);
      throw error;
    }
  }

  /** @returns {Promise<object>} Checkout créé (payment_id, checkout_url...). */
  async createCheckout({ amount, paymentMethod, country = 'senegal', workerId = null, jobId = null, returnUrl = null, cancelUrl = null }) {
    try {
      return await paymentAPI.createCheckout({
        amount,
        payment_method: paymentMethod?.id || paymentMethod,
        country,
        worker_id: workerId,
        job_id: jobId,
        return_url: returnUrl,
        cancel_url: cancelUrl
      });
    } catch (error) {
      safeLog.error('❌ Erreur création checkout:', error);
      throw error;
    }
  }

  /** @returns {Promise<object>} Statut du paiement (status, payout_status...). */
  async getPaymentStatus(paymentId) {
    return paymentAPI.getPaymentStatus(paymentId);
  }

  /** @returns {Promise<object>} Statut du paiement via token d'invoice. */
  async getPaymentStatusByToken(invoiceToken) {
    return paymentAPI.getPaymentStatusByToken(invoiceToken);
  }

  /** @returns {Promise<Array<object>>} Historique des paiements ([] si échec). */
  async getMyPayments() {
    try {
      const response = await paymentAPI.getMyPayments();
      return response.payments || [];
    } catch (error) {
      safeLog.error('❌ Erreur historique paiements:', error);
      return [];
    }
  }

  /** @returns {Array<object>} Transactions stockées en localStorage. */
  getStoredTransactions() {
    try {
      const stored = localStorage.getItem('kojo_commission_transactions');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      return [];
    }
  }

  /** @returns {void} Transactions stockées en localStorage. */
  setStoredTransactions(transactions) {
    localStorage.setItem('kojo_commission_transactions', JSON.stringify(transactions || []));
  }

  /** @returns {void} Transaction ajoutée (100 max conservées). */
  appendStoredTransaction(transaction) {
    const transactions = this.getStoredTransactions();
    transactions.unshift(transaction);
    this.setStoredTransactions(transactions.slice(0, 100));
  }

  /** @returns {Promise<object>} {totalTransactions, totalCommissions, ...}. */
  async getCommissionStats() {
    // Rafraîchit le taux effectif avant de calculer (affichage local exact).
    await this.refreshCommissionRate();
    const transactions = this.getStoredTransactions();

    const totalCommissions = transactions.reduce((sum, tx) => sum + (tx.ownerCommission || 0), 0);
    const totalWorkerPayments = transactions.reduce((sum, tx) => sum + (tx.workerAmount || 0), 0);
    const totalVolume = transactions.reduce((sum, tx) => sum + (tx.totalAmount || 0), 0);

    const today = new Date().toDateString();
    const todayTransactions = transactions.filter((tx) => new Date(tx.timestamp).toDateString() === today);
    const todayCommissions = todayTransactions.reduce((sum, tx) => sum + (tx.ownerCommission || 0), 0);

    return {
      totalTransactions: transactions.length,
      totalCommissions,
      totalWorkerPayments,
      totalVolume,
      todayTransactions: todayTransactions.length,
      todayCommissions,
      averageCommission: transactions.length > 0 ? totalCommissions / transactions.length : 0,
      commissionRate: Number((this.COMMISSION_RATE * 100).toFixed(2))
    };
  }

  /** @returns {object} Comptes de paiement du propriétaire. */
  getOwnerAccounts() {
    return this.OWNER_ACCOUNTS;
  }

  /** @returns {void} Comptes propriétaire mis à jour (localStorage). */
  updateOwnerAccounts(newAccounts) {
    this.OWNER_ACCOUNTS = { ...this.OWNER_ACCOUNTS, ...newAccounts };
    localStorage.setItem('owner_accounts', JSON.stringify(this.OWNER_ACCOUNTS));
    devLog.info('✅ Comptes propriétaire mis à jour');
  }

  /** @returns {void} Comptes propriétaire rechargés depuis localStorage. */
  loadOwnerAccounts() {
    try {
      const stored = localStorage.getItem('owner_accounts');
      if (stored) {
        this.OWNER_ACCOUNTS = JSON.parse(stored);
      }
    } catch (error) {
      safeLog.error('Erreur chargement comptes:', error);
    }
  }

  /** @returns {string} Identifiant de transaction unique. */
  generateTransactionId(prefix = 'TXN') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7).toUpperCase()}`;
  }

  /** @returns {Promise<object>} {success, transactionId, redirectUrl...}. */
  async simulateFullPayment(amount, paymentMethod, workerId, jobId = null, country = 'senegal') {
    const checkout = await this.createCheckout({
      amount,
      paymentMethod: paymentMethod?.id || paymentMethod,
      workerId,
      jobId,
      country,
      returnUrl: `${window.location.origin}/payment`,
      cancelUrl: `${window.location.origin}/payment`
    });

    const commission = this.calculateCommissions(amount);
    return {
      success: true,
      transactionId: checkout.payment_id,
      paymentId: checkout.payment_id,
      invoiceToken: checkout.invoice_token,
      redirectUrl: checkout.checkout_url,
      commission,
      message: 'Redirection vers la page de paiement réel',
      mode: 'redirect'
    };
  }
}

export default new CommissionService();
