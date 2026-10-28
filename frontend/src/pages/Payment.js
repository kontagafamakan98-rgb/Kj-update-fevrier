import { IconePage } from '../config/page-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
// Le lien interne AVEC la transition de vue native (components/LienVue.js).
import Link from '../components/LienVue';
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
import { carteMissionRequise, retourDuPayeur } from '../utils/paymentBranche';
import { EVENEMENTS_FUNNEL, trackFunnel } from '../utils/funnel';
import { AlertTriangle } from 'lucide-react';

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
  // un checkout "libre" (aucune mission, aucun retour de payeur). Cette
  // décision-là, comme son contraire, vit dans `carteMissionRequise()` (cf. son
  // import et `cartesDePaiementAttendues` plus bas) : la page et le repli de
  // `<Suspense>` doivent lire la MÊME définition, et il n'y en a donc qu'une.

  // ── LA BRANCHE DÉCIDE DE CE QU'IL FAUT RÉSERVER (mesuré le 09/10/2026) ────
  // La carte « mission requise » (ni mission, ni retour de payeur) ne contient
  // AUCUNE carte de paiement : réserver leur hauteur pendant le chargement
  // peignait donc ~630 px (mobile) / ~450 px (desktop) de cartes qui
  // n'apparaissent JAMAIS, et c'est la destination qui en payait le prix.
  // Relevé à la sonde navigateur (chunk de la route retenu puis relâché,
  // 412×823 et 1350×940) : l'état de chargement valait 1 376,4 px de `main` en
  // mobile pour une destination de 700,4 — le pied de page remontait donc DANS
  // l'écran (y=765,4) alors qu'il était resté au-dessus (y=1019) pendant tout
  // le chargement : CLS 0,0579, nommé sur `<footer>`. En desktop le même écart
  // valait 1 028,1 contre 794 (CLS 0,0447, trois décalages, tous sur le pied de
  // page). Le squelette est donc peint LÀ OÙ SA BRANCHE LE MONTRE — les deux
  // branches de la page restent couvertes, et la règle ne change pas : ce qui
  // est réservé est ce qui apparaîtra.
  //
  // ET LA BRANCHE A UN SEUL PROPRIÉTAIRE : `src/utils/paymentBranche.js`, lu
  // ici ET par `PaymentSkeleton`. Une règle écrite deux fois divergerait —
  // c'est exactement le défaut que ce relevé a mis au jour.
  const cartesDePaiementAttendues = !carteMissionRequise();
  // ── LE SQUELETTE REMPLACE LA GRILLE, IL NE S'AJOUTE PAS À ELLE (28/10/2026)
  // Il était peint À LA SUITE du formulaire réel : l'état de chargement doublait
  // donc le contenu qu'il représente, et la branche « mission » valait 1 174,31 px
  // de `main` pendant le chargement pour une destination de 682 px — le pied de
  // page (193 px) entrait dans l'écran à l'arrivée des données (CLS 0,0909
  // desktop, plafond relevé à 0,10 faute d'avoir réduit cette réserve). Le
  // squelette tient maintenant la place de la grille : l'un OU l'autre, jamais
  // les deux (cf. `PaymentContentSkeleton`).
  const paiementEnChargement = loading && cartesDePaiementAttendues;
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
          ? CommissionService.getQuote({
            amount: form.amount,
            paymentMethod: form.method,
            country: form.country,
            // La mission porte le TRAVAILLEUR dont dépend le palier de
            // commission : sans ces deux identifiants, le devis afficherait le
            // taux standard alors que la facture applique le tarif de
            // lancement — et le client lirait une répartition fausse.
            workerId: jobPaymentContext?.workerId,
            jobId: jobPaymentContext?.jobId,
          })
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
        const liveQuote = await CommissionService.getQuote({
          amount: form.amount,
          paymentMethod: form.method,
          country: form.country,
          workerId: jobPaymentContext?.workerId,
          jobId: jobPaymentContext?.jobId,
        });
        if (!cancelled) setQuote(liveQuote);
      } catch (err) {
        if (!cancelled) setError(handleApiError(err, t('paymentError')));
      }
    };
    refreshQuote();
    return () => { cancelled = true; };
  }, [form.amount, form.country, form.method]);

  useEffect(() => {
    // Les identifiants du retour du payeur sont lus chez leur propriétaire
    // (`src/utils/paymentBranche.js`), pas relus ici : la branche et les
    // identifiants qui la composent n'ont qu'une définition.
    const { paymentId, token } = retourDuPayeur();

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
        workerId: jobPaymentContext?.workerId || null,
        jobId: jobPaymentContext?.jobId || null,
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
      // Étape du funnel : le paiement est LANCÉ (une session de paiement
      // existe). Émise juste avant la sortie du site : au-delà, la page ne
      // s'exécute plus. Le montant n'est pas transmis — un montant exact est un
      // identifiant de transaction à peu de choses près, et GA n'en a pas
      // besoin pour dire où l'entonnoir s'arrête.
      trackFunnel(EVENEMENTS_FUNNEL.paiementLance, { payment_method: form.method });
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
    <div className={pagePlan.frameClass}>
      <div className={pagePlan.corpsClass}>
        {/* LE BANDEAU D'IDENTITÉ — le même que le tableau de bord et le profil :
            la crème du site, le filet chaud, le titre en `.titre-page`. Il
            remplace la carte blanche ombrée qui ouvrait la page. Il n'ajoute
            AUCUN sur-titre : le repli de `<Suspense>` ne réserve que deux blocs
            (titre + sous-titre), et un troisième le ferait diverger de l'état de
            chargement qu'il doit égaler (voir `PaymentSkeleton`). */}
        <section className={pagePlan.bandeClass} data-section="bande-paiement">
          <h1 className={pagePlan.titleClass}>{t(pagePlan.titleKey)}</h1>
          <p className={pagePlan.subtitleClass}>{t(pagePlan.subtitleKey)}</p>
          {jobPaymentContext && (
            <p className="mt-4 text-sm text-stone-700">
              {t('paymentForMissionDetail').replace('{jobTitle}', jobPaymentContext.jobTitle ? ` « ${jobPaymentContext.jobTitle} »` : '')}
            </p>
          )}
        </section>

        {statusData && (
          // LE DERNIER STATUT : trois MESURES (ce que le client paie, la part de
          // KOJO, celle du travailleur) et l'état en étiquette. Il n'y a plus de
          // tuile verte ni bleue : une teinte d'état ne se lit pas dans une
          // mesure — le vert reste aux étiquettes (payé, fournisseur configuré).
          <section className={pagePlan.carteClass} data-section="statut-paiement">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className={pagePlan.carteTitreClass}>{t('paymentStatusTitle')}</h2>
                <p className="mt-1 text-sm text-stone-500">ID: {statusData.id}</p>
              </div>
              <span className={`etiquette-app ${statusData.status === 'completed' ? 'etiquette-app-vert' : 'etiquette-app-orange'}`}>
                {statusLabel(statusData.status)}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="tuile-mesure">
                <p className="tuile-mesure-libelle">{t('paymentTotalClient')}</p>
                <p className="tuile-mesure-chiffre">{Number(statusData.amount || 0).toLocaleString()} XOF</p>
              </div>
              <div className="tuile-mesure">
                <p className="tuile-mesure-libelle">{t('paymentCommission')}</p>
                <p className="tuile-mesure-chiffre">{Number(statusData.commission_amount || 0).toLocaleString()} XOF</p>
              </div>
              <div className="tuile-mesure">
                <p className="tuile-mesure-libelle">{t('paymentWorkerAmount')}</p>
                <p className="tuile-mesure-chiffre">{Number(statusData.worker_amount || 0).toLocaleString()} XOF</p>
              </div>
            </div>
            <button onClick={refreshStatus} className="bouton bouton-clair mt-4">
              {t('paymentRefreshStatus')}
            </button>
          </section>
        )}

        {carteMissionRequise() ? (
          // LA CARTE « MISSION REQUISE » : la même carte à filet que les autres
          // écrans, son titre d'écran, et le CTA du site. La coquille pré-rendue
          // peint EXACTEMENT ces classes (elles sont déclarées dans le plan).
          <section className={`${pagePlan.carteClass} text-center`} data-section="mission-requise">
            <div className="mb-3 text-4xl"><IconePage nom={pagePlan.noJobIcon} role="carteVide" /></div>
            <h2 className={`${pagePlan.carteTitreClass} mb-2`}>{t(pagePlan.noJobTitleKey)}</h2>
            <p className={pagePlan.noJobTextClass}>{t(pagePlan.noJobTextKey)}</p>
            <Link to="/jobs" className={pagePlan.ctaClass}>
              {t(pagePlan.noJobCtaKey)}
            </Link>
          </section>
        ) : paiementEnChargement ? (
          // L'ÉTAT DE CHARGEMENT DE LA BRANCHE « mission » : le squelette tient
          // la grille de la destination (même grille, mêmes cartes, même boîte),
          // donc l'arrivée des données ne déplace que le contenu À L'INTÉRIEUR.
          <PaymentContentSkeleton />
        ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className={`${pagePlan.carteClass} lg:col-span-2`} data-section="formulaire-paiement">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className={pagePlan.carteTitreClass}>{t('automaticDistribution')}</h2>
              <span className={`etiquette-app ${providerConfig?.configured ? 'etiquette-app-vert' : 'etiquette-app-orange'}`}>
                {providerConfig?.configured ? t('paymentGatewayConfigured') : t('paymentGatewayNotConfigured')}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="block">
                <label htmlFor="payment_amount" className="text-sm font-medium text-stone-700">{t('paymentAmount')}</label>
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
                  className={`mt-2 w-full px-4 py-3 focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${form.amount > 0 && form.amount < 200 ? 'border-red-400 ring-1 ring-red-400' : ''} ${jobPaymentContext?.amount ? 'fond-sable cursor-not-allowed' : ''}`}
                />
                {form.amount > 0 && form.amount < 200 && (
                  <p className="mt-1 text-sm text-red-600">
                    {t('minPaydunyaAmount')}
                  </p>
                )}
              </div>

              <div className="block">
                <label htmlFor="payment_country" className="text-sm font-medium text-stone-700">{t('country')}</label>
                <select
                  id="payment_country"
                  name="payment_country"
                  autoComplete="off"
                  value={form.country}
                  onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
                  className="mt-2 w-full px-4 py-3 focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                >
                  {PAYABLE_COUNTRIES.map((value) => (
                    <option key={value} value={value}>{t(value)}</option>
                  ))}
                </select>
              </div>

              <div className="block">
                <label htmlFor="payment_method_select" className="text-sm font-medium text-stone-700">{t('paymentMethod')}</label>
                <select
                  id="payment_method_select"
                  name="payment_method_select"
                  autoComplete="off"
                  value={form.method}
                  onChange={(e) => setForm((prev) => ({ ...prev, method: e.target.value }))}
                  className="mt-2 w-full px-4 py-3 focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                >
                  {Object.entries(PAYMENT_METHOD_KEYS).map(([value, key]) => (
                    <option key={value} value={value}>{t(key)}</option>
                  ))}
                </select>
              </div>
            </div>

            {quote && (
              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3" data-section="repartition-paiement">
                <div className="tuile-mesure">
                  <p className="tuile-mesure-libelle">{t('paymentTotalClient')}</p>
                  <p className="tuile-mesure-chiffre">{Number(quote.total_amount || 0).toLocaleString()} XOF</p>
                </div>
                <div className="tuile-mesure">
                  <p className="tuile-mesure-libelle">{t('paymentCommission')}</p>
                  <p className="tuile-mesure-chiffre">{Number(quote.commission_amount || 0).toLocaleString()} XOF</p>
                </div>
                <div className="tuile-mesure">
                  <p className="tuile-mesure-libelle">{t('paymentWorkerAmount')}</p>
                  <p className="tuile-mesure-chiffre">{Number(quote.worker_amount || 0).toLocaleString()} XOF</p>
                </div>
              </div>
            )}

            {/* Le PALIER se dit sous la répartition : une remise que la
                personne qui la reçoit ne peut pas lire n'existe pas. Le
                standard ne dit rien — ce n'est pas une nouvelle. */}
            {quote?.commission_tier === 'lancement' && (
              <p className="mt-3 text-sm text-stone-700" data-section="palier-commission">
                {t('commissionTierLancement')}
              </p>
            )}
            {quote?.commission_tier === 'recurrent' && (
              <p className="mt-3 text-sm text-stone-700" data-section="palier-commission">
                {t('commissionTierRecurrent')}
              </p>
            )}

            {!user ? (
              <div className="bande-app mt-6">
                <p className="text-stone-700">{t('paymentLoginNeeded')}</p>
                <Link to="/login" className="bouton bouton-encre mt-3">
                  {t('signIn')}
                </Link>
              </div>
            ) : (
              <button
                onClick={launchCheckout}
                disabled={processing || !providerConfig?.configured || loading}
                className={`bouton mt-6 ${processing || !providerConfig?.configured ? 'bouton-clair cursor-not-allowed' : 'bouton-encre'}`}
              >
                {processing ? t('paymentRedirecting') : t('payNow')}
              </button>
            )}

            {!providerConfig?.configured && (
              <div className="mt-6 rounded-[3px] border border-amber-200 bg-amber-50 p-5">
                {/* Message générique pour les utilisateurs : les noms de
                    variables d'environnement backend (PAYDUNYA_MASTER_KEY,
                    etc.) ne doivent jamais apparaître dans une UI destinée
                    aux clients/travailleurs - ça n'a de sens que pour
                    l'équipe technique, qui a de toute façon accès aux logs
                    et à la config Render directement. */}
                <h3 className="mb-2 font-semibold text-amber-900">{t('paymentGatewayNotConfigured')}</h3>
                <p className="text-sm text-amber-700">{t('paymentGatewayHelp')}</p>
              </div>
            )}
          </section>

          <section className={pagePlan.carteClass} data-section="paiements-recents">
            <h2 className={pagePlan.carteTitreClass}>{t('paymentMyPayments')}</h2>
            {payments.length === 0 ? (
              <p className="mt-3 text-sm text-stone-500">{t('paymentNoPayments')}</p>
            ) : (
              <ul className="mt-3">
                {payments.slice(0, 5).map((payment) => (
                  <li key={payment.id} className="ligne-app justify-between border-t border-stone-100 first:border-t-0">
                    <div className="min-w-0">
                      <p className="font-semibold tabular-nums text-stone-900">{Number(payment.amount || 0).toLocaleString()} XOF</p>
                      <p className="mt-1 text-xs text-stone-500">{payment.payment_method} · {payment.id}</p>
                    </div>
                    <span className="etiquette-app">{statusLabel(payment.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        )}

        {error && (
          <div className="rounded-[3px] border border-red-200 bg-red-50 px-5 py-4 text-red-700">
            {error}
          </div>
        )}

        {checkoutError && (
          <div className="rounded-[3px] border border-red-300 bg-red-100 px-5 py-4 font-medium text-red-800">
            <AlertTriangle className="mr-1 inline h-5 w-5 align-[-0.15em]" aria-hidden="true" /> {checkoutError}
          </div>
        )}

      </div>
    </div>
  );
};

export default Payment;
