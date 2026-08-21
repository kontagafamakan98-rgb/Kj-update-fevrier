import { paymentAPI } from './api';
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
   * Retourne le taux en fraction (ex: 0.2 = 20%).
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

  async getPaymentStatus(paymentId) {
    return paymentAPI.getPaymentStatus(paymentId);
  }

  async getPaymentStatusByToken(invoiceToken) {
    return paymentAPI.getPaymentStatusByToken(invoiceToken);
  }

  async getMyPayments() {
    try {
      const response = await paymentAPI.getMyPayments();
      return response.payments || [];
    } catch (error) {
      safeLog.error('❌ Erreur historique paiements:', error);
      return [];
    }
  }

  getStoredTransactions() {
    try {
      const stored = localStorage.getItem('kojo_commission_transactions');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      return [];
    }
  }

  setStoredTransactions(transactions) {
    localStorage.setItem('kojo_commission_transactions', JSON.stringify(transactions || []));
  }

  appendStoredTransaction(transaction) {
    const transactions = this.getStoredTransactions();
    transactions.unshift(transaction);
    this.setStoredTransactions(transactions.slice(0, 100));
  }

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

  getOwnerAccounts() {
    return this.OWNER_ACCOUNTS;
  }

  updateOwnerAccounts(newAccounts) {
    this.OWNER_ACCOUNTS = { ...this.OWNER_ACCOUNTS, ...newAccounts };
    localStorage.setItem('owner_accounts', JSON.stringify(this.OWNER_ACCOUNTS));
    devLog.info('✅ Comptes propriétaire mis à jour');
  }

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

  generateTransactionId(prefix = 'TXN') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7).toUpperCase()}`;
  }

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
