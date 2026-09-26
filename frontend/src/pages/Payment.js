import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import CommissionService from '../services/commissionService';
import { safeLog } from '../utils/env';
import { handleApiError } from '../services/api';
// Squelette des cartes de paiement : défini dans SkeletonLoader (et non plus
// ici) pour que le fallback Suspense de /payment (PaymentSkeleton) et l'état
// de chargement des données partagent EXACTEMENT les mêmes hauteurs.
import { PaymentContentSkeleton } from '../components/SkeletonLoader';
import { usePageMeta } from '../utils/seo';
import { PAGE_SECTIONS } from '../config/page-sections';
import { IconePage, CLASSES_ICONE } from '../config/page-icons';

// Pays proposés, statuts de paiement et méthodes : des CODES, jamais du texte.
// Les libellés appartiennent aux dictionnaires — la clé est le code lui-même
// pour les pays, et un mapping explicite là où le nom de clé diffère du code.
const PAYABLE_COUNTRIES = ['senegal', 'mali', 'burkina_faso', 'ivory_coast'];
const PAYMENT_METHOD_KEYS = { orange_money: 'orangeMoney', wave: 'wave', bank_card: 'bankCard' };
const PAYMENT_STATUS_KEYS = { completed: 'paymentStatusCompleted', pending: 'paymentStatusPending', cancelled: 'paymentStatusCancelled', failed: 'paymentFailed' };

const Payment = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const pagePlan = PAGE_SECTIONS['/payment'];
  usePageMeta();

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
  // État séparé pour les erreurs de checkout — protège le message contre
  // l'écrasement par les appels refresh/quote qui réinitialisent error=''.
  const [checkoutError, setCheckoutError] = useState('');
  // Retour depuis PayDunya (payment_id/token) : la page affiche alors le
  // statut même sans contexte de mission — on ne remplace ce mode que pour
  // un checkout "libre" (aucune mission, aucun retour de payeur).
  const statusParams = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('payment_id') || params.get('token'));
  }, []);

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
      // Sans montant valide (> 0), on n'appelle pas le quote (le backend
      // rejette un montant nul en 422) : la répartition n'apparaît qu'une
      // fois un montant saisi.
      const [config, liveQuote] = await Promise.all([
        CommissionService.getProviderConfig(),
        form.amount > 0
          ? CommissionService.getQuote({ amount: form.amount, paymentMethod: form.method, country: form.country })
          : Promise.resolve(null)
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
      setError(handleApiError(err, t('paymentError')));
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
      // Montant nul (page ouverte sans contexte de mission) : pas d'appel
      // quote, la répartition reste masquée plutôt que d'afficher une erreur.
      if (!form.amount || form.amount <= 0) {
        if (!cancelled) setQuote(null);
        return;
      }
      try {
        const liveQuote = await CommissionService.getQuote({ amount: form.amount, paymentMethod: form.method, country: form.country });
        if (!cancelled) setQuote(liveQuote);
      } catch (err) {
        if (!cancelled) setError(handleApiError(err, t('paymentError')));
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
    setCheckoutError('');

    // Sans mission rattachée, un paiement "libre" n'a ni destinataire, ni
    // escrow, ni chemin de versement : le backend le rejette (400). On garde
    // le même message côté client pour ne pas faire d'aller-retour inutile.
    if (!jobPaymentContext) {
      setCheckoutError(t(pagePlan.noJobTitleKey));
      setProcessing(false);
      return;
    }

    // Validation client — évite un aller-retour API inutile et donne
    // un retour immédiat si le montant est trop faible.
    if (!form.amount || form.amount < 200) {
      setCheckoutError(t('minPaymentAmount'));
      setProcessing(false);
      return;
    }

    try {
      // Re-fetch du quote à jour AVANT le checkout : si le taux de commission
      // a changé en base depuis l'affichage, la répartition affichée est mise
      // à jour et l'utilisateur doit confirmer AVANT la redirection (sinon il
      // verrait l'ancienne répartition alors que le checkout applique la
      // nouvelle — incohérence d'affichage). Le 2ème clic confirme : le quote
      // affiché est alors à jour et le checkout se lance.
      const freshQuote = await CommissionService.getQuote({
        amount: Number(form.amount),
        paymentMethod: form.method,
        country: form.country,
      });
      const previousCommission = quote?.commission_amount;
      setQuote(freshQuote);
      if (
        previousCommission !== undefined &&
        Number(freshQuote?.commission_amount) !== Number(previousCommission)
      ) {
        setCheckoutError(t('paymentRateChanged'));
        setProcessing(false);
        return;
      }

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
      const msg = handleApiError(err, t('paymentError'));
      setCheckoutError(msg);
      setProcessing(false);
    }
  };

  const refreshStatus = async () => {
    if (!statusData?.id) return;
    try {
      const nextStatus = await CommissionService.getPaymentStatus(statusData.id);
      setStatusData(nextStatus);
    } catch (err) {
      setError(handleApiError(err, t('paymentError')));
    }
  };

  const statusLabel = (status) => t(PAYMENT_STATUS_KEYS[status] || 'paymentStatusUnknown');

  return (
    <div className="min-h-full bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{t(pagePlan.titleKey)}</h1>
          <p className="text-gray-600">{t(pagePlan.subtitleKey)}</p>
          {jobPaymentContext && (
            <div className="mt-4 rounded-xl bg-orange-50 border border-orange-200 px-4 py-3 text-sm text-orange-800">
              {t('paymentForMissionDetail').replace('{jobTitle}', jobPaymentContext.jobTitle ? ` « ${jobPaymentContext.jobTitle} »` : '')}
            </div>
          )}
        </div>

        {statusData && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{t('paymentStatusTitle')}</h2>
                <p className="text-sm text-gray-600 mt-1">ID: {statusData.id}</p>
              </div>
              <span className="inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold bg-blue-50 text-blue-700">
                {statusLabel(statusData.status)}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 text-sm">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-gray-500">{t('paymentTotalClient')}</div>
                <div className="font-semibold text-gray-900">{Number(statusData.amount || 0).toLocaleString()} XOF</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-gray-500">{t('paymentCommission')}</div>
                <div className="font-semibold text-green-700">{Number(statusData.commission_amount || 0).toLocaleString()} XOF</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-gray-500">{t('paymentWorkerAmount')}</div>
                <div className="font-semibold text-blue-700">{Number(statusData.worker_amount || 0).toLocaleString()} XOF</div>
              </div>
            </div>
            <button onClick={refreshStatus} className="mt-4 px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-black">
              {t('paymentRefreshStatus')}
            </button>
          </div>
        )}

        {!jobPaymentContext && !statusParams ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
            <div className="text-4xl mb-3"><IconePage nom={pagePlan.noJobIcon} classe={CLASSES_ICONE.carteVide} /></div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">{t(pagePlan.noJobTitleKey)}</h2>
            <p className="text-gray-600 max-w-lg mx-auto mb-5">{t(pagePlan.noJobTextKey)}</p>
            <Link to="/jobs" className="inline-flex items-center rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white hover:bg-orange-700">
              {t(pagePlan.noJobCtaKey)}
            </Link>
          </div>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
              <h2 className="text-xl font-semibold text-gray-900">{t('automaticDistribution')}</h2>
              <span className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold ${providerConfig?.configured ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                {providerConfig?.configured ? t('paymentGatewayConfigured') : t('paymentGatewayNotConfigured')}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="block">
                <label htmlFor="payment_amount" className="text-sm font-medium text-gray-700">{t('paymentAmount')}</label>
                <input
                  id="payment_amount"
                  name="payment_amount"
                  type="number"
                  autoComplete="off"
                  min="200"
                  step="500"
                  value={form.amount}
                  readOnly={Boolean(jobPaymentContext?.amount)}
                  onChange={(e) => {
                    setCheckoutError('');
                    setForm((prev) => ({ ...prev, amount: Number(e.target.value) || 0 }));
                  }}
                  className={`mt-2 w-full rounded-xl border ${form.amount > 0 && form.amount < 200 ? 'border-red-400 ring-1 ring-red-400' : 'border-gray-300'} px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500 ${jobPaymentContext?.amount ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                />
                {form.amount > 0 && form.amount < 200 && (
                  <p className="mt-1 text-sm text-red-600">
                    {t('minPaydunyaAmount')}
                  </p>
                )}
              </div>

              <div className="block">
                <label htmlFor="payment_country" className="text-sm font-medium text-gray-700">{t('country')}</label>
                <select
                  id="payment_country"
                  name="payment_country"
                  autoComplete="off"
                  value={form.country}
                  onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
                  className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  {PAYABLE_COUNTRIES.map((value) => (
                    <option key={value} value={value}>{t(value)}</option>
                  ))}
                </select>
              </div>

              <div className="block">
                <label htmlFor="payment_method_select" className="text-sm font-medium text-gray-700">{t('paymentMethod')}</label>
                <select
                  id="payment_method_select"
                  name="payment_method_select"
                  autoComplete="off"
                  value={form.method}
                  onChange={(e) => setForm((prev) => ({ ...prev, method: e.target.value }))}
                  className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  {Object.entries(PAYMENT_METHOD_KEYS).map(([value, key]) => (
                    <option key={value} value={value}>{t(key)}</option>
                  ))}
                </select>
              </div>
            </div>

            {quote && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-sm text-gray-500">{t('paymentTotalClient')}</div>
                  <div className="text-xl font-bold text-gray-900 mt-1">{Number(quote.total_amount || 0).toLocaleString()} XOF</div>
                </div>
                <div className="bg-green-50 rounded-xl p-4">
                  <div className="text-sm text-green-700">{t('paymentCommission')}</div>
                  <div className="text-xl font-bold text-green-800 mt-1">{Number(quote.commission_amount || 0).toLocaleString()} XOF</div>
                </div>
                <div className="bg-blue-50 rounded-xl p-4">
                  <div className="text-sm text-blue-700">{t('paymentWorkerAmount')}</div>
                  <div className="text-xl font-bold text-blue-800 mt-1">{Number(quote.worker_amount || 0).toLocaleString()} XOF</div>
                </div>
              </div>
            )}

            {!user ? (
              <div className="mt-6 rounded-xl border border-orange-200 bg-orange-50 p-4">
                <p className="text-orange-800 mb-3">{t('paymentLoginNeeded')}</p>
                <Link to="/login" className="inline-flex items-center rounded-lg bg-orange-600 px-4 py-2 text-white hover:bg-orange-700">
                  {t('signIn')}
                </Link>
              </div>
            ) : (
              <button
                onClick={launchCheckout}
                disabled={processing || !providerConfig?.configured || loading}
                className={`mt-6 inline-flex items-center rounded-xl px-5 py-3 font-semibold text-white ${processing || !providerConfig?.configured ? 'bg-gray-400 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700'}`}
              >
                {processing ? t('paymentRedirecting') : t('payNow')}
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
                <h3 className="font-semibold text-amber-900 mb-2">{t('paymentGatewayNotConfigured')}</h3>
                <p className="text-sm text-amber-700">{t('paymentGatewayHelp')}</p>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('paymentMyPayments')}</h3>
              {payments.length === 0 ? (
                <p className="text-sm text-gray-500">{t('paymentNoPayments')}</p>
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
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-700">
            {error}
          </div>
        )}

        {checkoutError && (
          <div className="rounded-2xl border border-red-300 bg-red-100 px-5 py-4 text-red-800 font-medium">
            ⚠️ {checkoutError}
          </div>
        )}

        {/* État de chargement : skeleton structuré répliquant la hauteur du
            layout réel (carte titre + formulaire quote + carte paiements)
            pour que l'arrivée des données async (providerConfig, quote,
            payments) ne fasse pas bouger le footer — anti-CLS uniforme. */}
        {loading && <PaymentContentSkeleton />}
      </div>
    </div>
  );
};

export default Payment;
