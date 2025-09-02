import React, { useState, useEffect } from 'react';
import CommissionService from '../services/commissionService';
import OwnerService from '../services/ownerService';
import { useAuth } from '../contexts/AuthContext';

const CommissionDashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [ownerAccounts, setOwnerAccounts] = useState({});
  const [editingAccounts, setEditingAccounts] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serverStats, setServerStats] = useState(null);

  useEffect(() => {
    checkOwnerAccessAndLoadData();
  }, []);

  const checkOwnerAccessAndLoadData = async () => {
    setLoading(true);
    
    // Vérifier si l'utilisateur est le propriétaire
    const ownerAccess = OwnerService.isOwnerLoggedIn();
    setIsOwner(ownerAccess);
    
    if (ownerAccess) {
      await loadOwnerData();
    }
    
    setLoading(false);
  };

  const loadOwnerData = async () => {
    try {
      // Charger les données locales (commission service)
      CommissionService.loadOwnerAccounts();
      setStats(CommissionService.getCommissionStats());
      setTransactions(CommissionService.getStoredTransactions());
      setOwnerAccounts(CommissionService.getOwnerAccounts());
      
      // Charger les vraies statistiques du serveur
      try {
        const serverData = await OwnerService.getCommissionStats();
        setServerStats(serverData.stats);
        console.log('📊 Vraies stats serveur chargées:', serverData.stats);
      } catch (error) {
        console.log('📊 Utilisation des stats locales (serveur indisponible)');
      }
      
    } catch (error) {
      console.error('Erreur chargement données propriétaire:', error);
    }
  };

  const loadData = () => {
    if (isOwner) {
      loadOwnerData();
    }
  };

  const handleAccountUpdate = (method, field, value) => {
    const newAccounts = {
      ...ownerAccounts,
      [method]: {
        ...ownerAccounts[method],
        [field]: value
      }
    };
    setOwnerAccounts(newAccounts);
  };

  const saveAccounts = () => {
    CommissionService.updateOwnerAccounts(ownerAccounts);
    setEditingAccounts(false);
    alert('✅ Comptes mis à jour avec succès!');
  };

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('fr-FR').format(amount || 0);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getMethodIcon = (method) => {
    switch (method) {
      case 'orange_money': return '🧡';
      case 'wave': return '🌊';
      case 'bank_card': return '💳';
      default: return '💰';
    }
  };

  // Utiliser les stats serveur si disponibles, sinon les stats locales
  const displayStats = serverStats || stats;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500 mx-auto"></div>
          <div className="mt-4 text-orange-600 font-medium">Vérification des accès...</div>
        </div>
      </div>
    );
  }

  // Affichage pour utilisateurs non-propriétaires
  if (!isOwner) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="bg-red-50 border border-red-200 rounded-lg p-8">
            <div className="text-6xl mb-4">🚫</div>
            <h1 className="text-2xl font-bold text-red-800 mb-4">
              Accès Interdit
            </h1>
            <p className="text-red-700 mb-6">
              Cette section est réservée exclusivement au propriétaire de l'application.
            </p>
            <div className="bg-red-100 border border-red-300 rounded-lg p-4 mb-6">
              <p className="text-sm text-red-800">
                <strong>Note de sécurité:</strong> Le tableau de bord des commissions contient des informations 
                financières sensibles et n'est accessible qu'avec les permissions appropriées.
              </p>
            </div>
            <div className="space-y-2 text-sm text-red-600">
              <p>👤 Utilisateur connecté: {user?.first_name} {user?.last_name}</p>
              <p>📧 Email: {user?.email}</p>
              <p>🔐 Niveau d'accès: Utilisateur standard</p>
            </div>
            <button 
              onClick={() => window.history.back()} 
              className="mt-6 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              ← Retour
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            💼 Tableau de Bord - Commissions Propriétaire
          </h1>
          <p className="text-gray-600">
            Suivi de vos commissions automatiques de 14% sur tous les paiements
          </p>
        </div>

        {/* Statistiques */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-green-100 mr-4">
                <span className="text-2xl">💰</span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Total Commissions</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatMoney(displayStats.total_commission_earned || displayStats.totalCommissions)} XOF
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-blue-100 mr-4">
                <span className="text-2xl">📊</span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Volume Total</p>
                <p className="text-2xl font-bold text-blue-600">
                  {formatMoney(displayStats.total_volume || displayStats.totalVolume)} XOF
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-purple-100 mr-4">
                <span className="text-2xl">🔢</span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Transactions</p>
                <p className="text-2xl font-bold text-purple-600">
                  {stats.totalTransactions}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-orange-100 mr-4">
                <span className="text-2xl">📅</span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Aujourd'hui</p>
                <p className="text-2xl font-bold text-orange-600">
                  {formatMoney(stats.todayCommissions)} XOF
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Comptes du propriétaire */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900">
              🏦 Vos Comptes de Réception
            </h2>
            <button
              onClick={() => editingAccounts ? saveAccounts() : setEditingAccounts(true)}
              className={`px-4 py-2 rounded-lg font-medium ${
                editingAccounts
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {editingAccounts ? '✅ Sauvegarder' : '✏️ Modifier'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Orange Money */}
            <div className="border border-orange-200 rounded-lg p-4">
              <div className="flex items-center mb-3">
                <span className="text-2xl mr-2">🧡</span>
                <h3 className="font-semibold text-gray-900">Orange Money</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Numéro de téléphone:
                  </label>
                  {editingAccounts ? (
                    <input
                      type="text"
                      value={ownerAccounts.orange_money?.phoneNumber || ''}
                      onChange={(e) => handleAccountUpdate('orange_money', 'phoneNumber', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                      placeholder="+221701234567"
                    />
                  ) : (
                    <p className="font-mono text-sm bg-gray-50 p-2 rounded">
                      {ownerAccounts.orange_money?.phoneNumber || 'Non configuré'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nom du compte:
                  </label>
                  {editingAccounts ? (
                    <input
                      type="text"
                      value={ownerAccounts.orange_money?.accountName || ''}
                      onChange={(e) => handleAccountUpdate('orange_money', 'accountName', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                      placeholder="VOTRE NOM"
                    />
                  ) : (
                    <p className="text-sm bg-gray-50 p-2 rounded">
                      {ownerAccounts.orange_money?.accountName || 'Non configuré'}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Wave */}
            <div className="border border-blue-200 rounded-lg p-4">
              <div className="flex items-center mb-3">
                <span className="text-2xl mr-2">🌊</span>
                <h3 className="font-semibold text-gray-900">Wave</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Numéro de téléphone:
                  </label>
                  {editingAccounts ? (
                    <input
                      type="text"
                      value={ownerAccounts.wave?.phoneNumber || ''}
                      onChange={(e) => handleAccountUpdate('wave', 'phoneNumber', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="+221701234567"
                    />
                  ) : (
                    <p className="font-mono text-sm bg-gray-50 p-2 rounded">
                      {ownerAccounts.wave?.phoneNumber || 'Non configuré'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nom du compte:
                  </label>
                  {editingAccounts ? (
                    <input
                      type="text"
                      value={ownerAccounts.wave?.accountName || ''}
                      onChange={(e) => handleAccountUpdate('wave', 'accountName', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="VOTRE NOM"
                    />
                  ) : (
                    <p className="text-sm bg-gray-50 p-2 rounded">
                      {ownerAccounts.wave?.accountName || 'Non configuré'}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Carte Bancaire */}
            <div className="border border-green-200 rounded-lg p-4">
              <div className="flex items-center mb-3">
                <span className="text-2xl mr-2">💳</span>
                <h3 className="font-semibold text-gray-900">Carte Bancaire</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Numéro de compte:
                  </label>
                  {editingAccounts ? (
                    <input
                      type="text"
                      value={ownerAccounts.bank_card?.accountNumber || ''}
                      onChange={(e) => handleAccountUpdate('bank_card', 'accountNumber', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="1234567890123456"
                    />
                  ) : (
                    <p className="font-mono text-sm bg-gray-50 p-2 rounded">
                      {ownerAccounts.bank_card?.accountNumber || 'Non configuré'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Banque:
                  </label>
                  {editingAccounts ? (
                    <input
                      type="text"
                      value={ownerAccounts.bank_card?.bank || ''}
                      onChange={(e) => handleAccountUpdate('bank_card', 'bank', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      placeholder="Banque Atlantique"
                    />
                  ) : (
                    <p className="text-sm bg-gray-50 p-2 rounded">
                      {ownerAccounts.bank_card?.bank || 'Non configuré'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Historique des transactions */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900">
              📋 Historique des Commissions
            </h2>
            <button
              onClick={loadData}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              🔄 Actualiser
            </button>
          </div>

          {transactions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <span className="text-4xl block mb-4">💼</span>
              <p>Aucune transaction avec commission pour le moment</p>
              <p className="text-sm mt-2">Les commissions apparaîtront ici après les premiers paiements</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Transaction
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Montant Total
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Votre Commission (14%)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Travailleur (86%)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Méthode
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {transactions.slice(0, 10).map((transaction) => (
                    <tr key={transaction.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                        {transaction.id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <span className="font-semibold">{formatMoney(transaction.totalAmount)} XOF</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className="font-semibold text-green-600">
                          {formatMoney(transaction.ownerCommission)} XOF
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className="font-semibold text-blue-600">
                          {formatMoney(transaction.workerAmount)} XOF
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <span className="inline-flex items-center">
                          {getMethodIcon(transaction.paymentMethod)}
                          <span className="ml-2 capitalize">{transaction.paymentMethod.replace('_', ' ')}</span>
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(transaction.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommissionDashboard;