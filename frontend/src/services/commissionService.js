import { paymentAPI } from './api';
import { devLog, safeLog } from '../utils/env';

class CommissionService {
  constructor() {
    this.COMMISSION_RATE = 0.14;
    this.WORKER_RATE = 0.86;
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

  calculateCommissions(totalAmount) {
    const ownerCommission = Math.round(totalAmount * this.COMMISSION_RATE);
    const workerAmount = Math.round(totalAmount - ownerCommission);

    return {
      totalAmount: Math.round(totalAmount),
      ownerCommission,
      workerAmount,
      commissionRate: this.COMMISSION_RATE * 100
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

  getCommissionStats() {
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
      commissionRate: this.COMMISSION_RATE * 100
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
      returnUrl: `${window.location.origin}/payment-demo`,
      cancelUrl: `${window.location.origin}/payment-demo`
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
