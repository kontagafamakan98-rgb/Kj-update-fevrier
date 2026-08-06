import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import CommissionService from '../services/commissionService';
import { safeLog } from '../utils/env';

const COPY = {
  fr: {
    title: 'KOJO Paiements réels',
    subtitle: 'Payez en toute sécurité par Orange Money, Wave ou carte bancaire.',
    setupTitle: 'État du gateway',
    configured: 'Passerelle configurée',
    notConfigured: 'Passerelle non configurée',
    setupHelp: 'Le service de paiement est momentanément indisponible. Merci de réessayer un peu plus tard.',
    amount: 'Montant',
    country: 'Pays',
    method: 'Méthode',
    loginNeeded: 'Connecte-toi pour lancer un paiement réel.',
    loginCta: 'Se connecter',
    payNow: 'Lancer le checkout réel',
    paying: 'Redirection en cours...',
    quoteTitle: 'Répartition automatique',
    total: 'Total client',
    commission: 'Commission KOJO',
    worker: 'Montant travailleur',
    statusTitle: 'Dernier statut',
    completed: 'Paiement confirmé',
    pending: 'Paiement en attente',
    cancelled: 'Paiement annulé',
    failed: 'Paiement échoué',
    unknown: 'Statut inconnu',
    refreshStatus: 'Actualiser le statut',
    backendSetup: 'Variables backend à renseigner',
    backendItems: [
      'PAYDUNYA_MASTER_KEY',
      'PAYDUNYA_PRIVATE_KEY',
      'PAYDUNYA_TOKEN',
      'PAYDUNYA_MODE=test ou live',
      'PAYDUNYA_STORE_NAME',
      'FRONTEND_APP_URL',
      'BACKEND_PUBLIC_URL'
    ],
    supportTitle: 'Canaux confirmés par la doc officielle',
    supportText: 'PayDunya documente Orange Money Sénégal / Mali / Burkina / Côte d’Ivoire, Wave Sénégal / Côte d’Ivoire, et le paiement carte. Le check status se fait avec le token de facture et l’IPN confirme les paiements.',
    myPayments: 'Mes paiements récents',
    noPayments: 'Aucun paiement enregistré pour ce compte.',
    openCheckout: 'Ouvrir le checkout',
    needAccounts: 'Pense aussi à lier les comptes de paiement côté profil pour les encaissements.',
    countries: { senegal: 'Sénégal', mali: 'Mali', burkina_faso: 'Burkina Faso', ivory_coast: 'Côte d’Ivoire' },
    methods: { orange_money: 'Orange Money', wave: 'Wave', bank_card: 'Carte bancaire' }
  },
  en: {
    title: 'KOJO Real Payments',
    subtitle: 'Pay securely with Orange Money, Wave, or bank card.',
    setupTitle: 'Gateway status',
    configured: 'Gateway configured',
    notConfigured: 'Gateway not configured',
    setupHelp: 'The payment service is temporarily unavailable. Please try again shortly.',
    amount: 'Amount',
    country: 'Country',
    method: 'Method',
    loginNeeded: 'Log in to launch a real payment.',
    loginCta: 'Log in',
    payNow: 'Start real checkout',
    paying: 'Redirecting...',
    quoteTitle: 'Automatic split',
    total: 'Client total',
    commission: 'KOJO commission',
    worker: 'Worker amount',
    statusTitle: 'Latest status',
    completed: 'Payment confirmed',
    pending: 'Payment pending',
    cancelled: 'Payment cancelled',
    failed: 'Payment failed',
    unknown: 'Unknown status',
    refreshStatus: 'Refresh status',
    backendSetup: 'Backend variables to set',
    backendItems: ['PAYDUNYA_MASTER_KEY','PAYDUNYA_PRIVATE_KEY','PAYDUNYA_TOKEN','PAYDUNYA_MODE=test or live','PAYDUNYA_STORE_NAME','FRONTEND_APP_URL','BACKEND_PUBLIC_URL'],
    supportTitle: 'Officially documented channels',
    supportText: 'PayDunya officially documents Orange Money for Senegal / Mali / Burkina / Côte d’Ivoire, Wave for Senegal / Côte d’Ivoire, plus card payments. Invoice tokens are used for status checks and IPN confirms payments.',
    myPayments: 'My recent payments',
    noPayments: 'No payments recorded for this account yet.',
    openCheckout: 'Open checkout',
    needAccounts: 'Also link payment accounts in the profile for future collections and payouts.',
    countries: { senegal: 'Senegal', mali: 'Mali', burkina_faso: 'Burkina Faso', ivory_coast: 'Ivory Coast' },
    methods: { orange_money: 'Orange Money', wave: 'Wave', bank_card: 'Bank card' }
  },
  wo: {
    title: 'KOJO Fay yu dëgg',
    subtitle: 'Fey ci kaaraange ak Orange Money, Wave walla kart bank.',
    setupTitle: 'Tolluwaay bi',
    configured: 'Gateway bi set na',
    notConfigured: 'Gateway bi setuwoonul',
    setupHelp: 'Service wanewu bii dafa ñàkk ci waxtu bii. Ndeysaan delluwaatal ci kaw.',
    amount: 'Monto',
    country: 'Réew',
    method: 'Yoonu fey',
    loginNeeded: 'Duggal ngir tàmbali fey gu dëgg.',
    loginCta: 'Dugg',
    payNow: 'Tàmbali checkout bu dëgg',
    paying: 'Mi ngi jëm ci checkout...',
    quoteTitle: 'Séddoo otomatik',
    total: 'Lëppu klient bi',
    commission: 'Commission KOJO',
    worker: 'Waalu liggéeykat bi',
    statusTitle: 'Status bu mujj',
    completed: 'Fey gi am na',
    pending: 'Fey gi ngiy xaar',
    cancelled: 'Fey gi neenal na',
    failed: 'Fey gi antuwul',
    unknown: 'Status xamul',
    refreshStatus: 'Yeesal status',
    backendSetup: 'Variables backend yi',
    backendItems: ['PAYDUNYA_MASTER_KEY','PAYDUNYA_PRIVATE_KEY','PAYDUNYA_TOKEN','PAYDUNYA_MODE=test walla live','PAYDUNYA_STORE_NAME','FRONTEND_APP_URL','BACKEND_PUBLIC_URL'],
    supportTitle: 'Canaux yi doc bi wone',
    supportText: 'PayDunya wax na Orange Money Sénégal / Mali / Burkina / Côte d’Ivoire, Wave Sénégal / Côte d’Ivoire ak kart bank. Tokenu invoice mooy seetal status, IPN mooy dëggal fey gi.',
    myPayments: 'Samay paiements yu mujj',
    noPayments: 'Amul paiement bu ñu bindal account bii.',
    openCheckout: 'Ubbi checkout',
    needAccounts: 'Bul fàtte boole comptes de paiement yi ci profil bi.',
    countries: { senegal: 'Senegaal', mali: 'Mali', burkina_faso: 'Burkina Faso', ivory_coast: 'Kot Divwaar' },
    methods: { orange_money: 'Orange Money', wave: 'Wave', bank_card: 'Kart bank' }
  },
  bm: {
    title: 'KOJO Sariya-faga yatiyalen',
    subtitle: 'Sara ka lakana ni Orange Money, Wave walima bank karti ye.',
    setupTitle: 'Gateway jɔyɔrɔ',
    configured: 'Gateway labɛnnen don',
    notConfigured: 'Gateway ma labɛnnen tɛ',
    setupHelp: 'Wari sarali kɛlan tɛ se sisan. I ka segin ka a lajɛ dɔɔni kɔfɛ.',
    amount: 'Jate',
    country: 'Jamana',
    method: 'Sariya-faga fɛɛrɛ',
    loginNeeded: 'I ka don ka sariya-faga yatiyalen daminɛ.',
    loginCta: 'Don',
    payNow: 'Checkout yatiyalen daminɛ',
    paying: 'Bɛ taa checkout la...',
    quoteTitle: 'Jɛgɛnsira otomatik',
    total: 'Kiliyan ka bɛɛ',
    commission: 'KOJO commission',
    worker: 'Barakɛla jate',
    statusTitle: 'Status laban',
    completed: 'Sariya-faga bɛɛlen',
    pending: 'Sariya-faga bɛ kɔnɔ',
    cancelled: 'Sariya-faga bali',
    failed: 'Sariya-faga ma se ka kɛ',
    unknown: 'Status min tɛ se ka dɔn',
    refreshStatus: 'Status kura',
    backendSetup: 'Backend variables',
    backendItems: ['PAYDUNYA_MASTER_KEY','PAYDUNYA_PRIVATE_KEY','PAYDUNYA_TOKEN','PAYDUNYA_MODE=test walima live','PAYDUNYA_STORE_NAME','FRONTEND_APP_URL','BACKEND_PUBLIC_URL'],
    supportTitle: 'Canaux minnu bɛ doc la',
    supportText: 'PayDunya bɛ Orange Money Sénégal / Mali / Burkina / Côte d’Ivoire, Wave Sénégal / Côte d’Ivoire ani bank karti jira. Invoice token bɛ status lajɛ, IPN bɛ sariya-faga tabali kɔrɔsiya.',
    myPayments: 'Ne ka paiements kura',
    noPayments: 'Paiement si tɛ account nin kama fɔlɔ.',
    openCheckout: 'Checkout da yɔrɔ',
    needAccounts: 'Payment accounts fara profil la fana.',
    countries: { senegal: 'Senegal', mali: 'Mali', burkina_faso: 'Burkina Faso', ivory_coast: 'Côte d’Ivoire' },
    methods: { orange_money: 'Orange Money', wave: 'Wave', bank_card: 'Bank karti' }
  },
  mos: {
    title: 'KOJO paoongo yel-kɩɩm',
    subtitle: 'Yao ne bãane ne Orange Money, Wave bɩ bank carte.',
    setupTitle: 'Gateway bãngre',
    configured: 'Gateway sigd n be',
    notConfigured: 'Gateway sigd ka beoogre',
    setupHelp: 'Yaool-yaoolem koɛɛg-koɛɛgo ka be zĩ-zãnga. Y sã n maan sõma, y le maane a poore.',
    amount: 'Sõor',
    country: 'Tẽng',
    method: 'Paoongo sõngre',
    loginNeeded: 'Lʋ yinga n paoongo yel-kɩɩm taaba.',
    loginCta: 'Lʋ',
    payNow: 'Checkout yel-kɩɩm taaba',
    paying: 'Bɛ yiki checkout...',
    quoteTitle: 'Yidg otomatik',
    total: 'Client bɛɛga',
    commission: 'KOJO commission',
    worker: 'Barakɛda sõor',
    statusTitle: 'Status kɩtã',
    completed: 'Paoongo sõama',
    pending: 'Paoongo yã yĩnga',
    cancelled: 'Paoongo ka yẽ',
    failed: 'Paoongo ka paam',
    unknown: 'Status ka dɔk ye',
    refreshStatus: 'Status taaba',
    backendSetup: 'Backend variables',
    backendItems: ['PAYDUNYA_MASTER_KEY','PAYDUNYA_PRIVATE_KEY','PAYDUNYA_TOKEN','PAYDUNYA_MODE=test bɩ live','PAYDUNYA_STORE_NAME','FRONTEND_APP_URL','BACKEND_PUBLIC_URL'],
    supportTitle: 'Canaux doc yeta',
    supportText: 'PayDunya goma Orange Money Sénégal / Mali / Burkina / Côte d’Ivoire, Wave Sénégal / Côte d’Ivoire la bank carte. Invoice token nonga status yɩɩme, IPN paamda paoongo tabga.',
    myPayments: 'Mam paiements kɩtã',
    noPayments: 'Paiement baa ka be account yɩnga ye.',
    openCheckout: 'Checkout yɔk',
    needAccounts: 'Tɩ payment accounts profile pʋgẽ fana.',
    countries: { senegal: 'Senegal', mali: 'Mali', burkina_faso: 'Burkina Faso', ivory_coast: 'Côte d’Ivoire' },
    methods: { orange_money: 'Orange Money', wave: 'Wave', bank_card: 'Bank carte' }
  }
};

const getCopy = (lang) => COPY[lang] || COPY.fr;

const Payment = () => {
  const { currentLanguage } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const copy = useMemo(() => getCopy(currentLanguage), [currentLanguage]);

  // Contexte optionnel transmis depuis la page d'un job (juste apres
  // l'acceptation d'un travailleur) : job_id, worker_id, et le montant
  // convenu. Quand ce contexte est present, le paiement est directement
  // rattache a ce job au lieu d'etre un paiement libre/demo.
  const jobPaymentContext = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('job_id');
    const workerId = params.get('worker_id');
    const amountParam = params.get('amount');
    const jobTitle = params.get('job_title');
    if (!jobId) return null;
    return {
      jobId,
      workerId: workerId || null,
      amount: amountParam ? Number(amountParam) : null,
      jobTitle: jobTitle ? decodeURIComponent(jobTitle) : null,
    };
  }, []);

  const [providerConfig, setProviderConfig] = useState(null);
  const [quote, setQuote] = useState(null);
  const [payments, setPayments] = useState([]);
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    // Plus de valeur "démo" (25000) codée en dur : sans contexte de mission,
    // le montant part de 0 plutôt que de suggérer un chiffre arbitraire qui
    // n'a de sens pour personne.
    amount: jobPaymentContext?.amount || 0,
    country: 'senegal',
    method: 'orange_money'
  });

  const loadBase = async () => {
    setLoading(true);
    setError('');
    try {
      const [config, liveQuote] = await Promise.all([
        CommissionService.getProviderConfig(),
        CommissionService.getQuote({ amount: form.amount, paymentMethod: form.method, country: form.country })
      ]);
      setProviderConfig(config);
      setQuote(liveQuote);

      if (user) {
        const myPayments = await CommissionService.getMyPayments();
        setPayments(myPayments);
      } else {
        setPayments([]);
      }
    } catch (err) {
      safeLog.error('Payment page load error', err);
      setError(err?.response?.data?.detail || err.message || 'Erreur paiement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    const refreshQuote = async () => {
      try {
        const liveQuote = await CommissionService.getQuote({ amount: form.amount, paymentMethod: form.method, country: form.country });
        if (!cancelled) setQuote(liveQuote);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.detail || err.message || 'Erreur paiement');
      }
    };
    refreshQuote();
    return () => { cancelled = true; };
  }, [form.amount, form.country, form.method]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentId = params.get('payment_id');
    const token = params.get('token');

    const loadStatus = async () => {
      if (!user) return;
      try {
        if (token) {
          const status = await CommissionService.getPaymentStatusByToken(token);
          setStatusData(status);
        } else if (paymentId) {
          const status = await CommissionService.getPaymentStatus(paymentId);
          setStatusData(status);
        }
      } catch (err) {
        safeLog.error('Status load error', err);
      }
    };

    loadStatus();
  }, [user]);

  const launchCheckout = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    setProcessing(true);
    setError('');
    try {
      const checkout = await CommissionService.createCheckout({
        amount: Number(form.amount),
        paymentMethod: form.method,
        country: form.country,
        jobId: jobPaymentContext?.jobId || null,
        workerId: jobPaymentContext?.workerId || null,
        returnUrl: `${window.location.origin}/payment`,
        cancelUrl: `${window.location.origin}/payment`
      });
      window.location.href = checkout.checkout_url;
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Erreur paiement');
      setProcessing(false);
    }
  };

  const refreshStatus = async () => {
    if (!statusData?.id) return;
    try {
      const nextStatus = await CommissionService.getPaymentStatus(statusData.id);
      setStatusData(nextStatus);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Erreur paiement');
    }
  };

  const statusLabel = (status) => copy[status] || copy.unknown;

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{copy.title}</h1>
          <p className="text-gray-600">{copy.subtitle}</p>
          {jobPaymentContext && (
            <div className="mt-4 rounded-xl bg-orange-50 border border-orange-200 px-4 py-3 text-sm text-orange-800">
              💼 Paiement pour la mission{jobPaymentContext.jobTitle ? ` « ${jobPaymentContext.jobTitle} »` : ''} — le montant a été rempli automatiquement suite à l'attribution du travailleur.
            </div>
          )}
        </div>

        {statusData && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{copy.statusTitle}</h2>
                <p className="text-sm text-gray-600 mt-1">ID: {statusData.id}</p>
              </div>
              <span className="inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold bg-blue-50 text-blue-700">
                {statusLabel(statusData.status)}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 text-sm">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-gray-500">{copy.total}</div>
                <div className="font-semibold text-gray-900">{Number(statusData.amount || 0).toLocaleString()} XOF</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-gray-500">{copy.commission}</div>
                <div className="font-semibold text-green-700">{Number(statusData.commission_amount || 0).toLocaleString()} XOF</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-gray-500">{copy.worker}</div>
                <div className="font-semibold text-blue-700">{Number(statusData.worker_amount || 0).toLocaleString()} XOF</div>
              </div>
            </div>
            <button onClick={refreshStatus} className="mt-4 px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-black">
              {copy.refreshStatus}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
              <h2 className="text-xl font-semibold text-gray-900">{copy.quoteTitle}</h2>
              <span className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold ${providerConfig?.configured ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                {providerConfig?.configured ? copy.configured : copy.notConfigured}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="block">
                <label htmlFor="payment_amount" className="text-sm font-medium text-gray-700">{copy.amount}</label>
                <input
                  id="payment_amount"
                  name="payment_amount"
                  type="number"
                  autoComplete="off"
                  min="500"
                  step="500"
                  value={form.amount}
                  readOnly={Boolean(jobPaymentContext?.amount)}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: Number(e.target.value) || 0 }))}
                  className={`mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500 ${jobPaymentContext?.amount ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                />
              </div>

              <div className="block">
                <label htmlFor="payment_country" className="text-sm font-medium text-gray-700">{copy.country}</label>
                <select
                  id="payment_country"
                  name="payment_country"
                  autoComplete="off"
                  value={form.country}
                  onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
                  className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  {Object.entries(copy.countries).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="block">
                <label htmlFor="payment_method_select" className="text-sm font-medium text-gray-700">{copy.method}</label>
                <select
                  id="payment_method_select"
                  name="payment_method_select"
                  autoComplete="off"
                  value={form.method}
                  onChange={(e) => setForm((prev) => ({ ...prev, method: e.target.value }))}
                  className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  {Object.entries(copy.methods).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            {quote && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-sm text-gray-500">{copy.total}</div>
                  <div className="text-xl font-bold text-gray-900 mt-1">{Number(quote.total_amount || 0).toLocaleString()} XOF</div>
                </div>
                <div className="bg-green-50 rounded-xl p-4">
                  <div className="text-sm text-green-700">{copy.commission}</div>
                  <div className="text-xl font-bold text-green-800 mt-1">{Number(quote.commission_amount || 0).toLocaleString()} XOF</div>
                </div>
                <div className="bg-blue-50 rounded-xl p-4">
                  <div className="text-sm text-blue-700">{copy.worker}</div>
                  <div className="text-xl font-bold text-blue-800 mt-1">{Number(quote.worker_amount || 0).toLocaleString()} XOF</div>
                </div>
              </div>
            )}

            {!user ? (
              <div className="mt-6 rounded-xl border border-orange-200 bg-orange-50 p-4">
                <p className="text-orange-800 mb-3">{copy.loginNeeded}</p>
                <Link to="/login" className="inline-flex items-center rounded-lg bg-orange-600 px-4 py-2 text-white hover:bg-orange-700">
                  {copy.loginCta}
                </Link>
              </div>
            ) : (
              <button
                onClick={launchCheckout}
                disabled={processing || !providerConfig?.configured || loading}
                className={`mt-6 inline-flex items-center rounded-xl px-5 py-3 font-semibold text-white ${processing || !providerConfig?.configured ? 'bg-gray-400 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700'}`}
              >
                {processing ? copy.paying : copy.payNow}
              </button>
            )}

            {!providerConfig?.configured && (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
                {/* Message générique pour les utilisateurs : les noms de
                    variables d'environnement backend (PAYDUNYA_MASTER_KEY,
                    etc.) ne doivent jamais apparaître dans une UI destinée
                    aux clients/travailleurs - ça n'a de sens que pour
                    l'équipe technique, qui a de toute façon accès aux logs
                    et à la config Render directement. */}
                <h3 className="font-semibold text-amber-900 mb-2">{copy.notConfigured}</h3>
                <p className="text-sm text-amber-700">{copy.setupHelp}</p>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">{copy.supportTitle}</h3>
              <p className="text-sm text-gray-600">{copy.supportText}</p>
              <p className="text-sm text-gray-500 mt-3">{copy.needAccounts}</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">{copy.myPayments}</h3>
              {payments.length === 0 ? (
                <p className="text-sm text-gray-500">{copy.noPayments}</p>
              ) : (
                <div className="space-y-3">
                  {payments.slice(0, 5).map((payment) => (
                    <div key={payment.id} className="rounded-xl border border-gray-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-gray-900">{Number(payment.amount || 0).toLocaleString()} XOF</span>
                        <span className="text-xs rounded-full bg-gray-100 px-3 py-1 text-gray-700">{statusLabel(payment.status)}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-2">{payment.payment_method} • {payment.id}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
            {error}
          </div>
        )}

        {loading && (
          <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 text-gray-500">
            Loading...
          </div>
        )}
      </div>
    </div>
  );
};

export default Payment;
