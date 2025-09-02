// Service de gestion des commissions et transferts automatiques
class CommissionService {
  constructor() {
    this.COMMISSION_RATE = 0.14; // 14% pour le propriétaire
    this.WORKER_RATE = 0.86; // 86% pour le travailleur
    
    // Comptes du propriétaire de l'application (VOUS)
    this.OWNER_ACCOUNTS = {
      bank_card: {
        accountNumber: '1234567890123456', // Remplacez par votre vraie carte
        accountName: 'PROPRIETAIRE KOJO',
        bank: 'Banque Atlantique'
      },
      orange_money: {
        phoneNumber: '+221701234567', // Remplacez par votre vrai numéro Orange Money
        accountName: 'PROPRIETAIRE KOJO'
      },
      wave: {
        phoneNumber: '+221701234567', // Remplacez par votre vrai numéro Wave
        accountName: 'PROPRIETAIRE KOJO'
      }
    };
  }

  // Calculer les montants de commission
  calculateCommissions(totalAmount) {
    const ownerCommission = Math.round(totalAmount * this.COMMISSION_RATE);
    const workerAmount = totalAmount - ownerCommission;
    
    return {
      totalAmount,
      ownerCommission, // 14%
      workerAmount,    // 86%
      commissionRate: this.COMMISSION_RATE * 100 // 14%
    };
  }

  // Traiter le paiement avec distribution automatique
  async processPaymentWithCommission(paymentData) {
    const {
      amount,
      paymentMethod,
      workerId,
      workerAccount,
      jobId,
      clientId
    } = paymentData;

    try {
      console.log('🏦 Début du traitement avec commission...');
      
      // 1. Calculer les commissions
      const commission = this.calculateCommissions(amount);
      console.log('💰 Commission calculée:', commission);

      // 2. Effectuer le paiement principal
      const paymentResult = await this.processMainPayment(paymentData);
      
      if (!paymentResult.success) {
        throw new Error('Échec du paiement principal');
      }

      // 3. Distribuer automatiquement les fonds
      const distributionResult = await this.distributeFunds({
        ...commission,
        paymentMethod,
        workerId,
        workerAccount,
        transactionId: paymentResult.transactionId,
        jobId
      });

      // 4. Enregistrer la transaction
      const transactionRecord = await this.recordTransaction({
        ...commission,
        paymentMethod,
        workerId,
        clientId,
        jobId,
        mainTransactionId: paymentResult.transactionId,
        ownerTransferId: distributionResult.ownerTransferId,
        workerTransferId: distributionResult.workerTransferId,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        transactionId: paymentResult.transactionId,
        commission,
        distribution: distributionResult,
        message: `Paiement effectué! ${commission.ownerCommission.toLocaleString()} XOF → Propriétaire, ${commission.workerAmount.toLocaleString()} XOF → Travailleur`
      };

    } catch (error) {
      console.error('❌ Erreur traitement commission:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Traitement du paiement principal (simulation)
  async processMainPayment(paymentData) {
    // Simuler le paiement principal
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      success: true,
      transactionId: this.generateTransactionId('MAIN'),
      amount: paymentData.amount,
      method: paymentData.paymentMethod
    };
  }

  // Distribution automatique des fonds
  async distributeFunds(data) {
    const {
      ownerCommission,
      workerAmount,
      paymentMethod,
      workerId,
      workerAccount,
      transactionId
    } = data;

    console.log('📤 Distribution des fonds en cours...');

    try {
      // 1. Transfert vers le propriétaire (14%)
      const ownerTransfer = await this.transferToOwner({
        amount: ownerCommission,
        method: paymentMethod,
        reference: transactionId
      });

      // 2. Transfert vers le travailleur (86%)
      const workerTransfer = await this.transferToWorker({
        amount: workerAmount,
        method: paymentMethod,
        workerId,
        workerAccount,
        reference: transactionId
      });

      return {
        ownerTransferId: ownerTransfer.transferId,
        workerTransferId: workerTransfer.transferId,
        ownerAmount: ownerCommission,
        workerAmount: workerAmount
      };

    } catch (error) {
      console.error('❌ Erreur distribution:', error);
      throw new Error('Échec de la distribution des fonds');
    }
  }

  // Transfert automatique vers le propriétaire
  async transferToOwner({ amount, method, reference }) {
    const ownerAccount = this.OWNER_ACCOUNTS[method];
    
    console.log(`💼 Transfert de ${amount} XOF vers propriétaire via ${method}`);
    console.log('🏦 Compte propriétaire:', ownerAccount);

    // Simulation du transfert automatique
    await new Promise(resolve => setTimeout(resolve, 800));

    const transferId = this.generateTransactionId('OWNER');
    
    // Dans un vrai système, ici vous feriez l'appel API vers:
    // - Orange Money API si method === 'orange_money'
    // - Wave API si method === 'wave'  
    // - API bancaire si method === 'bank_card'
    
    return {
      transferId,
      amount,
      destinationAccount: ownerAccount,
      status: 'completed',
      timestamp: new Date().toISOString()
    };
  }

  // Transfert automatique vers le travailleur
  async transferToWorker({ amount, method, workerId, workerAccount, reference }) {
    console.log(`👷 Transfert de ${amount} XOF vers travailleur ${workerId} via ${method}`);
    console.log('💳 Compte travailleur:', workerAccount);

    // Simulation du transfert automatique
    await new Promise(resolve => setTimeout(resolve, 800));

    const transferId = this.generateTransactionId('WORKER');
    
    return {
      transferId,
      amount,
      workerId,
      destinationAccount: workerAccount,
      status: 'completed',
      timestamp: new Date().toISOString()
    };
  }

  // Enregistrer la transaction complète
  async recordTransaction(transactionData) {
    const record = {
      id: this.generateTransactionId('TXN'),
      ...transactionData,
      status: 'completed'
    };

    // Sauvegarder dans localStorage pour la démo
    const transactions = this.getStoredTransactions();
    transactions.unshift(record);
    localStorage.setItem('kojo_commission_transactions', JSON.stringify(transactions));

    console.log('📊 Transaction enregistrée:', record.id);
    return record;
  }

  // Obtenir l'historique des transactions
  getStoredTransactions() {
    try {
      const stored = localStorage.getItem('kojo_commission_transactions');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      return [];
    }
  }

  // Statistiques des commissions
  getCommissionStats() {
    const transactions = this.getStoredTransactions();
    
    const totalCommissions = transactions.reduce((sum, tx) => sum + (tx.ownerCommission || 0), 0);
    const totalWorkerPayments = transactions.reduce((sum, tx) => sum + (tx.workerAmount || 0), 0);
    const totalVolume = transactions.reduce((sum, tx) => sum + (tx.totalAmount || 0), 0);
    
    const today = new Date().toDateString();
    const todayTransactions = transactions.filter(tx => 
      new Date(tx.timestamp).toDateString() === today
    );
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

  // Obtenir les comptes du propriétaire
  getOwnerAccounts() {
    return this.OWNER_ACCOUNTS;
  }

  // Mettre à jour les comptes du propriétaire
  updateOwnerAccounts(newAccounts) {
    this.OWNER_ACCOUNTS = { ...this.OWNER_ACCOUNTS, ...newAccounts };
    localStorage.setItem('owner_accounts', JSON.stringify(this.OWNER_ACCOUNTS));
    console.log('✅ Comptes propriétaire mis à jour');
  }

  // Charger les comptes depuis le stockage
  loadOwnerAccounts() {
    try {
      const stored = localStorage.getItem('owner_accounts');
      if (stored) {
        this.OWNER_ACCOUNTS = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Erreur chargement comptes:', error);
    }
  }

  // Générer un ID de transaction unique
  generateTransactionId(prefix = 'TXN') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7).toUpperCase()}`;
  }

  // Simuler paiement complet avec commission (méthode principale)
  async simulateFullPayment(amount, paymentMethod, workerId, jobId = null) {
    const mockWorkerAccount = {
      orange_money: { phoneNumber: '+221777123456', name: 'Jean Travailleur' },
      wave: { phoneNumber: '+221777123456', name: 'Jean Travailleur' },
      bank_card: { accountNumber: '9876543210987654', name: 'Jean Travailleur' }
    };

    return await this.processPaymentWithCommission({
      amount,
      paymentMethod: paymentMethod.id || paymentMethod,
      workerId,
      workerAccount: mockWorkerAccount[paymentMethod.id || paymentMethod],
      jobId,
      clientId: 'client_123'
    });
  }
}

export default new CommissionService();