import React, { useEffect, useState } from 'react';
import CommissionService from '../services/commissionService';
import OwnerService from '../services/ownerService';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { makeScopedTranslator } from '../utils/pack2PageI18n';
import { devLog, safeLog } from '../utils/env';

const CommissionDashboard = () => {
  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t, 'commissionDashboard');

  const [stats, setStats] = useState(() => ({}));
  const [transactions, setTransactions] = useState([]);
  const [ownerAccounts, setOwnerAccounts] = useState(() => ({}));
  const [editingAccounts, setEditingAccounts] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serverStats, setServerStats] = useState(null);

  useEffect(() => {
    checkOwnerAccessAndLoadData();
  }, []);

  const checkOwnerAccessAndLoadData = async () => {
    setLoading(true);
    const famakanAccess = OwnerService.isFamakanLoggedIn();
    setIsOwner(famakanAccess);

    if (famakanAccess) {
      await loadOwnerData();
    }

    setLoading(false);
  };

  const loadOwnerData = async () => {
    try {
      CommissionService.loadOwnerAccounts();
      setStats(CommissionService.getCommissionStats());
      setTransactions(CommissionService.getStoredTransactions());
      setOwnerAccounts(CommissionService.getOwnerAccounts());

      try {
        const serverData = await OwnerService.getCommissionStats();
        setServerStats(serverData.stats);
        if ((serverData.stats?.recent_transactions || []).length > 0) {
          setTransactions(serverData.stats.recent_transactions.map((tx) => ({
            id: tx.id,
            totalAmount: tx.amount,
            ownerCommission: tx.commission,
            workerAmount: tx.worker_amount,
            paymentMethod: tx.paymentMethod || tx.method,
            timestamp: tx.timestamp || tx.date
          })));
        }
        devLog.info('📊 Vraies stats serveur chargées:', serverData.stats);
      } catch {
        devLog.info('📊 Utilisation des stats locales (serveur indisponible)');
      }
    } catch (error) {
      safeLog.error('Erreur chargement données propriétaire:', error);
    }
  };

  const handleAccountUpdate = (method, field, value) => {
    setOwnerAccounts((prev) => ({
      ...prev,
      [method]: {
        ...prev[method],
        [field]: value
      }
    }));
  };

  const saveAccounts = () => {
    CommissionService.updateOwnerAccounts(ownerAccounts);
    setEditingAccounts(false);
    alert(pageT('updatedSuccess'));
  };

  const formatMoney = (amount) => new Intl.NumberFormat(currentLanguage === 'en' ? 'en-US' : 'fr-FR').format(amount || 0);
  const formatDate = (dateString) =>
    new Date(dateString).toLocaleDateString(currentLanguage === 'en' ? 'en-US' : 'fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

  const getMethodIcon = (method) => {
    switch (method) {
      case 'orange_money':
        return '🧡';
      case 'wave':
        return '🌊';
      case 'bank_card':
        return '💳';
      default:
        return '💰';
    }
  };

  const displayStats = serverStats || stats;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-500 mx-auto"></div>
          <div className="mt-4 text-orange-600 font-medium">{pageT('checkingAccess')}</div>
        </div>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="bg-red-50 border border-red-200 rounded-lg p-8">
            <div className="text-6xl mb-4">🚫</div>
            <h1 className="text-2xl font-bold text-red-800 mb-4">{pageT('accessReserved')}</h1>
            <p className="text-red-700 mb-6">{pageT('accessMessage')}</p>
            <div className="bg-red-100 border border-red-300 rounded-lg p-4 mb-6">
              <p className="text-sm text-red-800">{pageT('securityNote')}</p>
            </div>
            <div className="space-y-2 text-sm text-red-600">
              <p>{pageT('connectedUser')}: {user?.first_name} {user?.last_name}</p>
              <p>{pageT('email')}: {user?.email}</p>
              <p>{pageT('accessLevel')}: {pageT('standardUser')}</p>
            </div>
            <button onClick={() => window.history.back()} className="mt-6 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
              {pageT('back')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{pageT('title')}</h1>
          <p className="text-gray-600">{pageT('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard icon="💰" bg="bg-green-100" title={pageT('totalCommissions')} value={`${formatMoney(displayStats.total_commission_earned || displayStats.totalCommissions)} XOF`} valueColor="text-green-600" />
          <StatCard icon="📊" bg="bg-blue-100" title={pageT('totalVolume')} value={`${formatMoney(displayStats.total_volume || displayStats.totalVolume)} XOF`} valueColor="text-blue-600" />
          <StatCard icon="🔢" bg="bg-purple-100" title={pageT('transactions')} value={displayStats.total_transactions || displayStats.totalTransactions || 0} valueColor="text-purple-600" />
          <StatCard icon="📅" bg="bg-orange-100" title={pageT('today')} value={`${formatMoney(displayStats.daily_commission || displayStats.todayCommissions)} XOF`} valueColor="text-orange-600" />
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex justify-between items-center mb-6 gap-4 flex-wrap">
            <h2 className="text-xl font-semibold text-gray-900">{pageT('receptionAccounts')}</h2>
            <button
              onClick={() => (editingAccounts ? saveAccounts() : setEditingAccounts(true))}
              className={`px-4 py-2 rounded-lg font-medium ${editingAccounts ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
            >
              {editingAccounts ? pageT('saveAccounts') : pageT('editAccounts')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <AccountCard
              title="Orange Money"
              emoji="🧡"
              editing={editingAccounts}
              primaryLabel={pageT('phoneNumber')}
              secondaryLabel={pageT('accountName')}
              primaryValue={ownerAccounts.orange_money?.phoneNumber || ''}
              secondaryValue={ownerAccounts.orange_money?.accountName || ''}
              primaryPlaceholder="+221701234567"
              secondaryPlaceholder="VOTRE NOM"
              notConfigured={pageT('notConfigured')}
              onPrimaryChange={(value) => handleAccountUpdate('orange_money', 'phoneNumber', value)}
              onSecondaryChange={(value) => handleAccountUpdate('orange_money', 'accountName', value)}
              primaryName="commission_orange_money_phone"
              secondaryName="commission_orange_money_account_name"
            />

            <AccountCard
              title="Wave"
              emoji="🌊"
              editing={editingAccounts}
              primaryLabel={pageT('phoneNumber')}
              secondaryLabel={pageT('accountName')}
              primaryValue={ownerAccounts.wave?.phoneNumber || ''}
              secondaryValue={ownerAccounts.wave?.accountName || ''}
              primaryPlaceholder="+221701234567"
              secondaryPlaceholder="VOTRE NOM"
              notConfigured={pageT('notConfigured')}
              onPrimaryChange={(value) => handleAccountUpdate('wave', 'phoneNumber', value)}
              onSecondaryChange={(value) => handleAccountUpdate('wave', 'accountName', value)}
              primaryName="commission_wave_phone"
              secondaryName="commission_wave_account_name"
            />

            <AccountCard
              title={pageT('bankCard')}
              emoji="💳"
              editing={editingAccounts}
              primaryLabel={pageT('accountNumber')}
              secondaryLabel={pageT('bank')}
              primaryValue={ownerAccounts.bank_card?.accountNumber || ''}
              secondaryValue={ownerAccounts.bank_card?.bank || ''}
              primaryPlaceholder="1234567890123456"
              secondaryPlaceholder="Banque Atlantique"
              notConfigured={pageT('notConfigured')}
              onPrimaryChange={(value) => handleAccountUpdate('bank_card', 'accountNumber', value)}
              onSecondaryChange={(value) => handleAccountUpdate('bank_card', 'bank', value)}
              primaryName="commission_bank_card_number"
              secondaryName="commission_bank_card_bank"
            />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-6 gap-4 flex-wrap">
            <h2 className="text-xl font-semibold text-gray-900">{pageT('history')}</h2>
            <button onClick={loadOwnerData} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
              {pageT('refresh')}
            </button>
          </div>

          {transactions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <span className="text-4xl block mb-4">💼</span>
              <p>{pageT('noTransactions')}</p>
              <p className="text-sm mt-2">{pageT('noTransactionsHelp')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{pageT('transaction')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{pageT('totalAmount')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{pageT('yourCommission')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{pageT('workerAmount')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{pageT('method')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{pageT('date')}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {transactions.slice(0, 10).map((transaction) => (
                    <tr key={transaction.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">{transaction.id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"><span className="font-semibold">{formatMoney(transaction.totalAmount)} XOF</span></td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm"><span className="font-semibold text-green-600">{formatMoney(transaction.ownerCommission)} XOF</span></td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm"><span className="font-semibold text-blue-600">{formatMoney(transaction.workerAmount)} XOF</span></td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <span className="inline-flex items-center">{getMethodIcon(transaction.paymentMethod)}<span className="ml-2 capitalize">{transaction.paymentMethod.replace('_', ' ')}</span></span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(transaction.timestamp)}</td>
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

function StatCard({ icon, bg, title, value, valueColor }) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center">
        <div className={`p-3 rounded-full ${bg} mr-4`}><span className="text-2xl">{icon}</span></div>
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

function AccountCard({ title, emoji, editing, primaryLabel, secondaryLabel, primaryValue, secondaryValue, primaryPlaceholder, secondaryPlaceholder, notConfigured, onPrimaryChange, onSecondaryChange, primaryName, secondaryName }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-center mb-3">
        <span className="text-2xl mr-2">{emoji}</span>
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="space-y-3">
        <div>
          <label htmlFor={primaryName} className="block text-sm font-medium text-gray-700 mb-1">{primaryLabel}</label>
          {editing ? (
            <input id={primaryName} name={primaryName} type="text" autoComplete="off" value={primaryValue} onChange={(e) => onPrimaryChange(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500" placeholder={primaryPlaceholder} />
          ) : (
            <p className="font-mono text-sm bg-gray-50 p-2 rounded">{primaryValue || notConfigured}</p>
          )}
        </div>
        <div>
          <label htmlFor={secondaryName} className="block text-sm font-medium text-gray-700 mb-1">{secondaryLabel}</label>
          {editing ? (
            <input id={secondaryName} name={secondaryName} type="text" autoComplete="off" value={secondaryValue} onChange={(e) => onSecondaryChange(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500" placeholder={secondaryPlaceholder} />
          ) : (
            <p className="text-sm bg-gray-50 p-2 rounded">{secondaryValue || notConfigured}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default CommissionDashboard;
