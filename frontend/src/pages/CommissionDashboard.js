import React, { useEffect, useState } from 'react';
import CommissionService from '../services/commissionService';
import OwnerService from '../services/ownerService';
import Link from '../components/LienVue';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../contexts/ToastContext';
import { makeScopedTranslator } from '../utils/pack2PageI18n/commissionDashboard';
import { devLog, safeLog } from '../utils/env';
import { Banknote, BarChart3, Hash, CalendarDays, Ban, Briefcase, Wallet, Waves, CreditCard } from 'lucide-react';
import OwnerMissionEvents from '../components/OwnerMissionEvents';
// LITIGE TRACÉ : la file d'arbitrage (kojo_job_disputes). Sans elle, une
// contestation resterait ouverte sans qu'aucun écran ne la montre, et l'échéance
// déciderait à la place du propriétaire.
import OwnerDisputes from '../components/OwnerDisputes';
// PALIERS DE COMMISSION : le barème (lancement / standard / fidélité) se règle
// ici et nulle part ailleurs — sans écran, la route propriétaire serait un
// réglage que seul un appel manuel pourrait changer.
import OwnerCommissionTiers from '../components/OwnerCommissionTiers';

const CommissionDashboard = () => {
  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const toast = useToast();
  const pageT = makeScopedTranslator(currentLanguage, t);

  const [stats, setStats] = useState(() => ({}));
  const [transactions, setTransactions] = useState([]);
  const [ownerAccounts, setOwnerAccounts] = useState(() => ({}));
  const [editingAccounts, setEditingAccounts] = useState(false);
  // `null` = pas encore jugé (le profil de session n'est pas chargé). L'écran
  // affiche alors la vérification d'accès, jamais un refus : un refus rendu
  // avant d'avoir lu le profil est un refus qui n'a rien mesuré.
  const [isOwner, setIsOwner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serverStats, setServerStats] = useState(null);

  // LE PROPRIÉTAIRE SE JUGE SUR LE PROFIL VIVANT, PAS SUR LE STOCKAGE
  // (24/10/2026). `localStorage['user']` n'existe PLUS sur le web depuis le
  // 20/10/2026 : le profil ne vit qu'en mémoire (cf.
  // `AuthContext.purgerProfilWebPersistant`) pour ne pas laisser de données
  // personnelles au repos. Juger `OwnerService.isFamakanLoggedIn()` sans
  // argument relisait donc ce stockage disparu, rendait TOUJOURS faux côté
  // web, et le propriétaire — dont `/auth/me` répond pourtant `is_owner:true`,
  // `user_type:'owner'` — lisait « Accès réservé » sur sa propre page. Le
  // profil de session est passé explicitement, et on attend qu'il soit là.
  useEffect(() => {
    if (!user) return;
    checkOwnerAccessAndLoadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const checkOwnerAccessAndLoadData = async () => {
    setLoading(true);
    const famakanAccess = OwnerService.isOwnerSessionValid(user);
    setIsOwner(famakanAccess);

    if (famakanAccess) {
      await loadOwnerData();
    }

    setLoading(false);
  };

  const loadOwnerData = async () => {
    try {
      CommissionService.loadOwnerAccounts();
      setStats(await CommissionService.getCommissionStats());
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
    toast.success(pageT('updatedSuccess'));
  };

  const formatMoney = (amount) => new Intl.NumberFormat(currentLanguage === 'en' ? 'en-US' : 'fr-FR').format(amount || 0);
  // Garde-fou anti-crash : un timestamp absent/invalide ne doit pas lever de
  // RangeError (new Date(invalide).toLocaleDateString) qui ferait planter
  // tout le tableau de bord.
  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString(currentLanguage === 'en' ? 'en-US' : 'fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  };

  const getMethodIcon = (method) => {
    switch (method) {
      case 'orange_money':
        return <Wallet className="h-4 w-4" aria-hidden="true" />;
      case 'wave':
        return <Waves className="h-4 w-4" aria-hidden="true" />;
      case 'bank_card':
        return <CreditCard className="h-4 w-4" aria-hidden="true" />;
      default:
        return <Banknote className="h-4 w-4" aria-hidden="true" />;
    }
  };

  const displayStats = serverStats || stats;

  if (loading || isOwner === null) {
    return (
      <div className="min-h-full cadre-page flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 animate-spin rounded-full border-b-2 border-orange-500"></div>
          <div className="mt-4 font-semibold text-stone-600">{pageT('checkingAccess')}</div>
        </div>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="min-h-full cadre-page max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="carte-editoriale carte-publique text-center">
          <Ban className="mx-auto mb-4 h-14 w-14 text-rose-600" aria-hidden="true" />
          <h1 className="titre-page">{pageT('accessReserved')}</h1>
          <p className="mt-2 text-sm text-stone-600 sm:text-base">{pageT('accessMessage')}</p>
          <div className="mt-6 rounded-[3px] border border-stone-200 fond-sable p-4">
            <p className="text-sm text-stone-600">{pageT('securityNote')}</p>
          </div>
          <div className="mt-6 space-y-2 text-sm text-stone-600">
            <p>{pageT('connectedUser')} : {user?.first_name} {user?.last_name}</p>
            <p>{pageT('email')} : {user?.email}</p>
            <p>{pageT('accessLevel')} : {pageT('standardUser')}</p>
          </div>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="bouton bouton-clair mt-6"
          >
            {pageT('back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full cadre-page max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="space-y-6">
        {/* LE BANDEAU D'ÉCRAN (17/10/2026) : le titre et son chapeau étaient
            posés à même le fond, en teinte douce, et s'espaçaient d'une marge
            écrite à la main. Ils ouvrent maintenant la bande crème que portent
            les autres écrans, et son pas vient de `.space-y-6` (l'écran perd
            donc son rembourrage vertical fixe, remplacé par `cadre-page`).
            Aucun nom d'utilitaire n'est écrit ici, même pour mémoire : Tailwind
            lit le texte des sources. */}
        <section className="bande-app" data-section="bande-commissions">
          <h1 className="titre-page">{pageT('title')}</h1>
          <p className="mt-2 text-sm text-stone-600 sm:max-w-2xl sm:text-base">{pageT('subtitle')}</p>
          {/* La modération n'est pas de l'argent : elle a son écran, et ce
              lien l'ouvre depuis celui où le propriétaire travaille déjà. */}
          <Link to="/administration" className="bouton bouton-clair mt-4">
            {t('administration')}
          </Link>
        </section>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<Banknote className="h-4 w-4" aria-hidden="true" />} titre={pageT('totalCommissions')} valeur={`${formatMoney(displayStats.total_commission_earned || displayStats.totalCommissions)} XOF`} />
          <StatCard icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />} titre={pageT('totalVolume')} valeur={`${formatMoney(displayStats.total_volume || displayStats.totalVolume)} XOF`} />
          {/* Le nombre de transactions est une MESURE comme les trois autres : les
              quatre tuiles lisent `.tuile-mesure`, donc elles s'alignent au
              chiffre près (chiffres tabulaires) au lieu de porter quatre pavés
              de couleur qui faisaient ressembler la grille à quatre cartes. */}
          <StatCard icon={<Hash className="h-4 w-4" aria-hidden="true" />} titre={pageT('transactions')} valeur={displayStats.total_transactions || displayStats.totalTransactions || 0} />
          <StatCard icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />} titre={pageT('today')} valeur={`${formatMoney(displayStats.daily_commission || displayStats.todayCommissions)} XOF`} />
        </div>

        <div className="carte-editoriale carte-publique" data-section="comptes-encaissement">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <h2 className="titre-carte-app">{pageT('receptionAccounts')}</h2>
            <button
              type="button"
              onClick={() => (editingAccounts ? saveAccounts() : setEditingAccounts(true))}
              className={`bouton ${editingAccounts ? 'bouton-encre' : 'bouton-clair'}`}
            >
              {editingAccounts ? pageT('saveAccounts') : pageT('editAccounts')}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <AccountCard
              title="Orange Money"
              icone={<Wallet className="h-5 w-5" aria-hidden="true" />}
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
              icone={<Waves className="h-5 w-5" aria-hidden="true" />}
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
              icone={<CreditCard className="h-5 w-5" aria-hidden="true" />}
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

        <OwnerCommissionTiers />

        <OwnerDisputes />

        <OwnerMissionEvents />

        <div className="carte-editoriale carte-publique" data-section="historique-commissions">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <h2 className="titre-carte-app">{pageT('history')}</h2>
            <button type="button" onClick={loadOwnerData} className="bouton bouton-clair">
              {pageT('refresh')}
            </button>
          </div>

          {transactions.length === 0 ? (
            <div className="py-8 text-center text-stone-600">
              <Briefcase className="mx-auto mb-4 h-12 w-12 text-stone-400" aria-hidden="true" />
              <p>{pageT('noTransactions')}</p>
              <p className="mt-2 text-sm">{pageT('noTransactionsHelp')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              {/* Le tableau garde sa forme (six colonnes se comparent mieux en
                  tableau qu'en lignes empilées) mais lit les teintes du site :
                  filet et fond de tête viennent des jetons, et les deux montants
                  de commission/part ouvrier ne sont plus deux couleurs inventées
                  — la commission est la part du site (orange), la part ouvrier
                  reste l'encre. */}
              <table className="min-w-full divide-y divide-stone-200">
                <thead className="fond-sable">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-500">{pageT('transaction')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-500">{pageT('totalAmount')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-500">{pageT('yourCommission')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-500">{pageT('workerAmount')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-500">{pageT('method')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-500">{pageT('date')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 bg-white">
                  {transactions.slice(0, 10).map((transaction) => (
                    <tr key={transaction.id} className="hover:bg-stone-50">
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-sm text-stone-900">{transaction.id}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm text-stone-900"><span className="font-semibold">{formatMoney(transaction.totalAmount)} XOF</span></td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm"><span className="font-semibold text-orange-700">{formatMoney(transaction.ownerCommission)} XOF</span></td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm"><span className="font-semibold text-stone-900">{formatMoney(transaction.workerAmount)} XOF</span></td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm text-stone-900">
                        <span className="inline-flex items-center">{getMethodIcon(transaction.paymentMethod)}<span className="ml-2 capitalize">{String(transaction.paymentMethod || '—').replace(/_/g, ' ')}</span></span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm text-stone-600">{formatDate(transaction.timestamp)}</td>
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

// La TUILE DE MESURE (vocabulaire d'écran, 17/10/2026) : un libellé et un
// chiffre, rien d'autre. Les quatre pavés de couleur qui entouraient chaque
// icône ont disparu — ils donnaient quatre teintes de sens à quatre mesures qui
// n'en portent pas, et empêchaient les chiffres de s'aligner.
function StatCard({ icon, titre, valeur }) {
  return (
    <div className="tuile-mesure">
      <p className="tuile-mesure-libelle flex items-center gap-2">
        <span className="text-orange-600">{icon}</span>
        {titre}
      </p>
      <p className="tuile-mesure-chiffre">{valeur}</p>
    </div>
  );
}

function AccountCard({ title, icone, editing, primaryLabel, secondaryLabel, primaryValue, secondaryValue, primaryPlaceholder, secondaryPlaceholder, notConfigured, onPrimaryChange, onSecondaryChange, primaryName, secondaryName }) {
  return (
    <div className="rounded-[3px] border border-stone-200 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-orange-600">{icone}</span>
        <h3 className="titre-carte-app">{title}</h3>
      </div>
      <div className="space-y-3">
        <div>
          <label htmlFor={primaryName} className="block text-sm font-medium text-stone-700">{primaryLabel}</label>
          {editing ? (
            <input id={primaryName} name={primaryName} type="text" autoComplete="off" value={primaryValue} onChange={(e) => onPrimaryChange(e.target.value)} className="mt-2 w-full px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-orange-500" placeholder={primaryPlaceholder} />
          ) : (
            <p className="fond-sable mt-2 rounded-[3px] px-2 py-1.5 font-mono text-sm text-stone-900">{primaryValue || notConfigured}</p>
          )}
        </div>
        <div>
          <label htmlFor={secondaryName} className="block text-sm font-medium text-stone-700">{secondaryLabel}</label>
          {editing ? (
            <input id={secondaryName} name={secondaryName} type="text" autoComplete="off" value={secondaryValue} onChange={(e) => onSecondaryChange(e.target.value)} className="mt-2 w-full px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-orange-500" placeholder={secondaryPlaceholder} />
          ) : (
            <p className="fond-sable mt-2 rounded-[3px] px-2 py-1.5 text-sm text-stone-900">{secondaryValue || notConfigured}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default CommissionDashboard;
