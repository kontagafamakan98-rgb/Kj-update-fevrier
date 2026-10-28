import { Suspense, lazy, useEffect, useState } from 'react';
// Le lien interne AVEC la transition de vue native (components/LienVue.js).
import Link from '../components/LienVue';
// Le CADRE de la page : son pas, sa largeur et sa gouttière sont déclarés une
// fois (src/config/app-cadres.js), pas écrits ici — la page ne connaît plus
// qu'un chemin et son corps.
import CadrePage from '../components/CadrePage';
import {
  Briefcase,
  ClipboardList,
  GraduationCap,
  Hammer,
  Leaf,
  LifeBuoy,
  MessageSquare,
  Monitor,
  PlusCircle,
  Sparkles,
  Wrench,
  Zap,
  PanelsTopLeft,
  Crown,
  Smartphone,
  Rocket,
  Camera,
  CreditCard,
  Wallet,
  Banknote,
  CalendarDays,
  UserPlus,
  ShieldCheck
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import OwnerService from '../services/ownerService';
const PreciseLocationDemo = lazy(() => import('../components/PreciseLocationDemo'));
import { jobsAPI } from '../services/apiEndpoints';
import { makeScopedTranslator } from '../utils/pack2PageI18n/dashboard';
import { safeLog } from '../utils/env';
// LE squelette du tableau de bord, partagé par le repli Suspense de la route
// (App.js) et par l'état de chargement des données ci-dessous. Cette page en
// portait une SECONDE copie locale (`SkeletonDashboardShell`) : c'est ELLE qui
// était peinte pendant le chargement des données, donc une correction portée au
// propriétaire n'aurait rien changé — exactement le défaut qui a coûté 0,1010 de
// CLS sur /profile (mesuré le 07/10/2026). Une seule définition, donc les deux
// phases ne peuvent plus diverger.
import { DashboardSkeleton } from '../components/SkeletonLoader';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalJobs: 0,
    activeJobs: 0,
    completedJobs: 0
  });
  const [recentJobs, setRecentJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFamakan, setIsFamakan] = useState(false);
  // ── L'ÉCHEC SE DIT, IL NE SE DÉGUISE PAS EN ZÉRO (20/10/2026) ────────────
  // `loadDashboardData` n'écrivait qu'un log en cas de panne : l'écran
  // affichait alors 0 / 0 / 0, c'est-à-dire « vous n'avez aucune mission »
  // pour une simple coupure réseau. Le drapeau porte l'état réel de la
  // lecture, et `reloadToken` est ce qui relance une tentative.
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  // Ce que la page sait des OFFRES reçues (le travailleur n'a pas de compteur
  // de missions dans cette réponse : afficher 0 pour lui était un mensonge).
  const [availableCount, setAvailableCount] = useState(0);
  // ── CE QUE LE PROPRIÉTAIRE GAGNE, ET RIEN D'AUTRE (23/10/2026) ───────────
  // Le compte owner n'est pas un client ni un travailleur : ses tuiles de
  // missions n'avaient aucun sens (elles tombaient dans la branche travailleur
  // et comptaient les offres du marché). Sa seule mesure est ce qu'il a encaissé
  // en commissions, lue à sa propre route (`/owner/commission-stats`).
  // `null` = pas encore lu, `Number` = mesure, `NaN` refusé par le rendu.
  const [ownerEarnings, setOwnerEarnings] = useState(null);
  const [ownerEarningsError, setOwnerEarningsError] = useState(false);

  const { user } = useAuth();
  const { t, currentLanguage } = useLanguage();
  const pageT = makeScopedTranslator(currentLanguage, t);

  // ── L'ÉQUIPE SUPPORT A SON PROPRE ÉCRAN (24/10/2026) ─────────────────────
  // Une personne ajoutée au service clientèle n'est ni cliente ni travailleuse :
  // la page tombait dans la branche travailleur et lui proposait de parcourir
  // le marché, de remplir un profil et de publier une mission — trois gestes
  // qui ne lui appartiennent pas. Son périmètre tient en une phrase : les
  // demandes des clients. Ce drapeau juge un FAIT publié par /auth/me
  // (`support_role`), jamais une déduction. Le propriétaire n'est pas concerné :
  // il a ses gains, et il compose l'équipe depuis /support-admin.
  const estEquipeSupport = !user?.is_owner && user?.support_role === 'agent';

  useEffect(() => {
    loadDashboardData();
    // `reloadToken` est la seule dépendance voulue : il ne change qu'au clic
    // sur « Réessayer », donc ce chargement ne repart pas à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  useEffect(() => {
    setIsFamakan(OwnerService.isOwnerSessionValid(user));
  }, [user]);

  useEffect(() => {
    if (!user?.is_owner) {
      setOwnerEarnings(null);
      setOwnerEarningsError(false);
      return;
    }
    let annule = false;
    setOwnerEarningsError(false);
    OwnerService.getCommissionStats()
      .then((reponse) => {
        if (!annule) setOwnerEarnings(reponse?.stats || {});
      })
      .catch(() => {
        if (!annule) setOwnerEarningsError(true);
      });
    return () => {
      annule = true;
    };
  }, [user?.is_owner, reloadToken]);

  const loadDashboardData = async () => {
    try {
      setLoadError(false);
      const jobs = await jobsAPI.getAll();
      const jobsList = Array.isArray(jobs) ? jobs : jobs?.data || [];

      if (user?.user_type === 'client') {
        const clientJobs = jobsList.filter((job) => job.client_id === user?.id);
        setStats({
          totalJobs: clientJobs.length,
          activeJobs: clientJobs.filter((job) => job.status === 'open' || job.status === 'in_progress').length,
          completedJobs: clientJobs.filter((job) => job.status === 'completed').length
        });
        setRecentJobs(clientJobs.slice(0, 5));
      } else {
        setAvailableCount(jobsList.length);
        setRecentJobs(jobsList.slice(0, 5));
      }
    } catch (error) {
      // La panne est VISIBLE. Les mesures ne sont plus affichées du tout (cf.
      // `masquer`) : un tiret dit « je ne sais pas », un zéro dit « rien ».
      safeLog.error('Error loading dashboard data:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  /** Relance la lecture : le squelette revient le temps de la réponse. */
  const recharger = () => {
    setLoading(true);
    setReloadToken((jeton) => jeton + 1);
  };

  const translateStatus = (status) => {
    if (status === 'in_progress') return pageT('status_in_progress');
    return pageT(`status_${status}`) || t(status) || status;
  };

  const translateCategory = (category) => t(category) || category;

  // Une mesure NON LUE n'est pas une mesure à zéro : tant que la lecture a
  // échoué, la tuile dit « je ne sais pas » (—). Et un travailleur n'a aucun
  // compteur de missions dans cette réponse : ses trois anciennes tuiles
  // affichaient 0 en permanence, ce qui était faux dans tous les cas. Il ne
  // reste donc chez lui que la mesure que la page sait vraiment — le nombre
  // d'offres reçues. La tuile « gains » a disparu pour tout le monde : aucun
  // de ces chiffres n'était alimenté, et un « 0 XOF » se lit comme un revenu.
  const masquer = (valeur) => (loadError ? '—' : valeur);
  // Gains du propriétaire : un montant en FCFA, lu sur SA route. Une lecture
  // en panne affiche « — » (je ne sais pas), jamais 0 FCFA (je n'ai rien gagné).
  const montant = (valeur) => {
    if (ownerEarningsError) return '—';
    if (ownerEarnings === null) return '…';
    return `${Math.round(Number(valeur) || 0).toLocaleString('fr-FR')} FCFA`;
  };
  // Aucune tuile pour l'équipe support : les compteurs de cette page sont ceux
  // des missions (client / travailleur) ou des gains (propriétaire). Un chiffre
  // inventé vaudrait moins que pas de tuile — la grille disparaît donc.
  const statCards = estEquipeSupport
    ? []
    : user?.is_owner
    ? [
        { label: t('ownerEarnings'), value: montant(ownerEarnings?.total_commission_earned), icon: Wallet },
        { label: t('ownerEarningsMonth'), value: montant(ownerEarnings?.monthly_commission), icon: Banknote },
        { label: t('ownerEarningsToday'), value: montant(ownerEarnings?.daily_commission), icon: CalendarDays }
      ]
    : user?.user_type === 'client'
    ? [
        { label: t('activeJobs'), value: masquer(stats.activeJobs), icon: ClipboardList },
        { label: t('completedJobs'), value: masquer(stats.completedJobs), icon: Sparkles },
        { label: t('totalJobs'), value: masquer(stats.totalJobs), icon: Briefcase }
      ]
    : [
        { label: t('availableJobs'), value: masquer(availableCount), icon: Briefcase }
      ];

  // Le dessin d'une action (fond, glyphe, levée) appartient à `.tuile-action`
  // (src/index.css) : ces objets ne portent donc plus de teinte ni de classe,
  // seulement ce qu'ils DÉSIGNENT. La première entrée est l'action principale.
  const quickActions = (() => {
    // Le propriétaire n'a rien à « chercher » ni à « postuler » : ses seules
    // actions sont ses gains et le support. Y laisser les tuiles client ou
    // travailleur lui proposait de publier une mission et de remplir un profil
    // de travailleur — deux gestes qui ne lui appartiennent pas.
    if (user?.is_owner) {
      return [
        // L'ADMINISTRATION EN PREMIER : le propriétaire se plaignait de n'avoir
        // « aucun contrôle » alors que les gains étaient la seule tuile en
        // tête. Les comptes, les sanctions et les messages sont ce qu'il
        // ouvre en arrivant ; les gains restent juste derrière.
        { to: '/administration', label: t('administration'), icon: ShieldCheck },
        { to: '/commission-dashboard', label: t('commissionDashboard'), icon: Monitor },
        { to: '/support-admin', label: t('supportRequestsTitle'), icon: LifeBuoy },
        { to: '/support-admin', label: t('supportTeamTitle'), subtitle: t('supportTeamIntro'), icon: UserPlus }
      ];
    }
    // L'équipe support ne fait qu'une chose : répondre aux clients. Lui donner
    // les tuiles du marché ou du profil travailleur reviendrait à lui proposer
    // des écrans que son rôle n'ouvre pas.
    if (estEquipeSupport) {
      return [
        { to: '/support-admin', label: t('supportRequestsTitle'), icon: LifeBuoy },
        { to: '/messages', label: t('messages'), icon: MessageSquare }
      ];
    }
    const baseActions = user?.user_type === 'client'
      ? [
          { to: '/create-job', label: t('postJob'), icon: PlusCircle },
          { to: '/jobs', label: t('myJobs'), icon: Briefcase },
          { to: '/messages', label: t('messages'), icon: MessageSquare }
        ]
      : [
          { to: '/jobs', label: `${t('searchJobs')} ${t('jobs')}`, icon: Briefcase },
          { to: '/profile', label: t('workerProfile'), icon: Wrench },
          { to: '/messages', label: t('messages'), icon: MessageSquare }
        ];

    if (isFamakan) {
      baseActions.push({
        to: '/payment',
        label: t('languagesPayments'),
        subtitle: t('publicFeature'),
        icon: Monitor
      });
      baseActions.push({
        to: '/support-admin',
        label: t('supportRequestsTitle'),
        subtitle: t('supportAdminSubtitle'),
        icon: LifeBuoy
      });
    }

    return baseActions;
  })();

  // Catégories canoniques du backend (kojo_routers_jobs.py) : general,
  // plumbing, electrical, construction, cleaning, gardening, tutoring,
  // mechanics. « carpentry »/« computing » n'existent pas côté serveur (ils
  // seraient normalisés en « general ») — cliquer menait vers un filtre vide.
  const popularCategories = [
    { key: 'plumbing', icon: Wrench },
    { key: 'electrical', icon: Zap },
    { key: 'mechanics', icon: Briefcase },
    { key: 'construction', icon: Hammer },
    { key: 'general', icon: PanelsTopLeft },
    { key: 'cleaning', icon: Sparkles },
    { key: 'gardening', icon: Leaf },
    { key: 'tutoring', icon: GraduationCap }
  ];

  // Squelette de chargement : reproduit la STRUCTURE EXACTE de la page (mêmes
  // conteneurs, paddings, grilles et hauteurs) pour que le passage aux données
  // réelles ne déplace AUCUN élément → réduit le CLS (mesuré 0.149 avant).
  // Le bloc bannière/quick-actions/catégories est statique (aucune donnée) :
  // seul le header d'accueil + les 4 cartes + la liste récente dépendent des
  // jobs API. On reserve donc leur hauteur.
  if (loading) {
    // Le propriétaire unique (cf. l'import) — et il RÉSERVE l'écran, parce que
    // la hauteur de cette page dépend des données (cf. src/config/app-cadres.js).
    return <DashboardSkeleton />;
  }

  return (
    <CadrePage chemin="/dashboard" classeCorps="">
      {/* LE BANDEAU D'ACCUEIL — ce que l'utilisateur lit en premier, et qui doit
          dire « vous êtes ici » avant de dire quoi que ce soit. Le titre garde
          `.titre-page` (l'échelle serif du site) : c'est la page d'arrivée d'un
          utilisateur connecté, elle ne peut pas être typographiée comme un
          gabarit d'administration. */}
      <section className="bande-app bloc-app">
        <div>
          <p className="sur-titre">{t('dashboard')}</p>
          <h1 className="titre-page mt-3">
            {t('welcomeUser')} {user?.first_name || 'User'}!
          </h1>
          {/* La phrase de tête reste sur UNE ligne à 412 px : le bandeau lui
              retire la gouttière qu'elle avait avant (2 × `--rythme-carte`), et
              la même phrase passait de une à deux lignes — c'est-à-dire que
              l'ÉLÉMENT LCP de la route changeait de main (h1 → paragraphe,
              8 626 → 12 188 px², mesuré par `e2e/lcp-app.spec.js`). Le corps
              plus petit sur téléphone la ramène sur une ligne, et la mesure du
              bandeau d'aire reste donc celle du titre. */}
          <p className="mt-2 text-sm text-stone-600 sm:max-w-2xl sm:text-base">
            {estEquipeSupport
              ? t('supportAgentDashboardIntro')
              : user?.is_owner
              ? t('ownerDashboardIntro')
              : user?.user_type === 'client'
              ? t('manageProjectsClient')
              : t('discoverOpportunitiesWorker')}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {/* L'étiquette dit le RÔLE du compte ; elle ne peint aucun ÉTAT de
                mission (c'est `.pastille-statut[data-statut]`, un seul
                propriétaire). */}
            <span className="etiquette-app etiquette-app-orange">
              {estEquipeSupport
                ? t('supportTeamTitle')
                : user?.is_owner
                ? t('ownerRole')
                : user?.user_type === 'client'
                ? t('client')
                : t('worker')}
            </span>
            {/* CE QUE L'ÉTIQUETTE DIT, ET SEULEMENT ÇA : `is_verified` est posé
                par l'ajout des comptes de paiement (`kojo_validation.py`), pas
                par un contrôle d'identité — l'email a son propre
                `email_verified`. Un bouclier coché disait « identité
                vérifiée » à la place, et c'était faux (audit du 20/10/2026,
                prop. 6). La carte de paiement dit ce qui est mesuré. */}
            {/* Un propriétaire n'a AUCUN moyen de paiement à renseigner : son
                argent part directement sur son compte PayDunya. L'étiquette
                « moyens de paiement renseignés » lui annoncerait une condition
                qu'il n'a pas à remplir. */}
            {user?.is_verified && !user?.is_owner && !estEquipeSupport && (
              <span className="etiquette-app etiquette-app-vert">
                <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                {t('paymentMethodsOnFile')}
              </span>
            )}
            {isFamakan && (
              <span className="etiquette-app">
                <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                {t('famakanAccess')}
              </span>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {/* L'action principale DIT le rôle : un propriétaire n'a rien à
                chercher ni à publier, il ouvre ses gains. L'ancien
                `user_type === 'client' ? … : /jobs` l'envoyait parcourir le
                marché — le parcours d'un travailleur. */}
            <Link
              to={
                estEquipeSupport
                  ? '/support-admin'
                  : user?.is_owner
                  ? '/commission-dashboard'
                  : user?.user_type === 'client'
                  ? '/create-job'
                  : '/jobs'
              }
              className="bouton bouton-encre"
            >
              {estEquipeSupport
                ? t('supportRequestsTitle')
                : user?.is_owner
                ? t('commissionDashboard')
                : user?.user_type === 'client'
                ? t('postJob')
                : `${t('searchJobs')} ${t('jobs')}`}
            </Link>
            <Link to="/messages" className="bouton bouton-clair">
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              {t('messages')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── LA LECTURE A ÉCHOUÉ : on le DIT, et on propose de réessayer ────
          Avant, l'échec ne produisait qu'un log : l'écran restait avec des
          zéros, donc une coupure réseau se lisait « aucune mission ». Le
          bandeau est `role="alert"` (annoncé), et le bouton relance la lecture
          au lieu de demander à l'utilisateur de recharger la page entière. */}
      {loadError && (
        <div
          role="alert"
          className="carte-editoriale carte-cotes bloc-app flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm text-stone-700">{t('networkConnectionError')}</p>
          <button type="button" onClick={recharger} className="bouton bouton-clair shrink-0">
            {t('retry')}
          </button>
        </div>
      )}

      {/* ── LES COMPTES DE PAIEMENT NE BLOQUENT PLUS L'INSCRIPTION, DONC ILS
          SE RAPPELLENT ICI (22/10/2026) ─────────────────────────────────
          Un compte créé sans compte de paiement est VALIDE : ce bandeau n'est
          pas un avertissement d'erreur (pas de `role="alert"`, pas de rouge),
          c'est une occasion à saisir quand elle servira. Il disparaît dès le
          premier compte ajouté (`is_verified`), et la contrainte d'argent
          reste où elle vit : le backend refuse un décaissement sans compte. */}
      {user && !user.is_verified && !user.is_owner && !estEquipeSupport && (
        <div className="carte-editoriale bloc-app flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-stone-700">
            <CreditCard className="inline h-4 w-4 mr-1 align-[-0.15em] text-orange-700" aria-hidden="true" />
            {pageT('addPaymentAccountHint')}
          </p>
          <Link to="/profile" className="bouton bouton-clair shrink-0">
            {pageT('addPaymentAccountAction')}
          </Link>
        </div>
      )}

      {/* LES MESURES — une tuile dit un chiffre, pas une carte : le
          libellé en petites capitales, le chiffre en serif tabulaire, et rien
          d'autre. Le glyphe du bloc au-dessus rappelle à quoi la mesure se
          rapporte, il ne décore pas le chiffre. Le nombre de colonnes suit le
          nombre de tuiles (trois, ou une seule pour un travailleur). */}
      {statCards.length > 0 && (
      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${statCards.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} bloc-app`}
      >
        {statCards.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="tuile-mesure">
              <div className="flex items-start justify-between gap-4">
                <p className="tuile-mesure-libelle">{item.label}</p>
                <div className="pastille-rond pastille-rond-large">
                  <Icon className="w-6 h-6" aria-hidden="true" />
                </div>
              </div>
              <p className="tuile-mesure-chiffre">{item.value}</p>
            </div>
          );
        })}
      </div>
      )}

      {/* L'ENCART du site (filet gauche orange, fond sable) à la place du
          dégradé orange → ROUGE : c'était le dernier dégradé vers le rouge du
          site, et il ne disait rien de plus que « voici un bloc à part » — ce
          que l'encart dit mieux, avec une seule teinte. */}
      {isFamakan && (
        <div className="encart bloc-app">
          <div className="flex items-center mb-4">
            <Crown className="h-6 w-6 mr-3 text-orange-500" aria-hidden="true" />
            <h2 className="titre-section">{t('famakanAccess')}</h2>
          </div>
          <p className="text-sm text-orange-800 mb-4">{t('famakanDescription')}</p>

          <div className="flex flex-wrap gap-3">
            {/* Liens de test réservés au dev : les routes /mobile-test et
                /photo-test ne sont enregistrées qu'en développement
                (import.meta.env.DEV dans App.js) — en prod elles 404.
                Il n'existe PLUS de jumeau de production depuis le 28/10/2026 :
                `/photo-debug` a été retiré du routage (une route de diagnostic
                n'a pas à voyager dans le binaire servi). */}
            {import.meta.env.DEV && (
              <Link to="/mobile-test" className="bouton bouton-clair">
                <Smartphone className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" /> {t('testMobileFeatures')}
              </Link>
            )}
            <Link to="/create-job" className="bouton bouton-encre">
              <Rocket className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" /> {t('createJobGPS')}
            </Link>
            {import.meta.env.DEV && (
              /* La branche DEV est ÉLIMINÉE du bundle de production : Tailwind, lui,
                 génère quand même les utilitaires qu'il lit ici. Ce lien de test ne
                 reçoit donc AUCUNE teinte propre — il emprunte le gris neutre que le
                 reste du tableau de bord pose déjà, ce qui ne coûte aucune règle au
                 CSS servi (mesuré le 27/09/2026 : plus aucune teinte pourpre n'est
                 générée, son dernier porteur ayant disparu avec ce lot).
                 PIÈGE MESURÉ : nommer une classe d'une teinte retirée, même en
                 commentaire, la RESSUSCITE — Tailwind lit le TEXTE BRUT des sources,
                 prose comprise, et régénère l'utilitaire qu'on vient de retirer. */
              <Link to="/photo-test" className="bouton bouton-clair">
                <Camera className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" /> {t('debugPhotos')}
              </Link>
            )}
            <Link to="/commission-dashboard" className="bouton bouton-clair">
              <Briefcase className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" /> {t('commissionDashboard')}
            </Link>
            <Link to="/administration" className="bouton bouton-clair">
              <ShieldCheck className="inline h-4 w-4 mr-1 align-[-0.15em]" aria-hidden="true" /> {t('administration')}
            </Link>
          </div>

          <div className="mt-6">
            <Suspense fallback={<div className="rounded-xl border border-orange-100 bg-white/70 px-4 py-3 text-sm text-orange-700">{pageT('loading')}</div>}>
              <PreciseLocationDemo />
            </Suspense>
          </div>
        </div>
      )}

      {/* LES ACTIONS — des tuiles, pas une carte qui contient trois cartes.
          La première est l'action PRINCIPALE de l'écran (fond de marque) :
          elle répond à la question que l'utilisateur se pose en arrivant, et
          elle le fait sans qu'aucune phrase n'ait à la désigner. */}
      <section className="bloc-app">
        <div className="mb-4">
          <h2 className="titre-carte-app">{t('quickActions')}</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {quickActions.map((action, index) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.to + action.label}
                to={action.to}
                className={`tuile-action ${index === 0 ? 'tuile-action-principale' : ''}`}
              >
                <span className="tuile-action-icone">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-base font-semibold">{action.label}</span>
                  {action.subtitle ? (
                    <span className={`mt-1 block text-xs ${index === 0 ? 'text-orange-100' : 'text-stone-500'}`}>
                      {action.subtitle}
                    </span>
                  ) : null}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* LES CATÉGORIES : les puces de FILTRE du site (`./jobs?category=…`),
          donc le même contrôle que la page qu'elles ouvrent. Le glyphe reste
          devant le mot — c'est ce qui rend la rangée balayable sans la lire.
          Masquées chez le propriétaire : son écran dit ce qu'il a GAGNÉ, il
          ne l'invite pas à parcourir le marché. */}
      {!user?.is_owner && !estEquipeSupport && (
      <section className="bloc-app">
        <div className="mb-4">
          <h2 className="titre-carte-app">{t('popularCategories')}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {popularCategories.map((category) => {
            const Icon = category.icon;
            return (
              <Link
                key={category.key}
                to={`/jobs?category=${category.key}`}
                className="puce-filtre inline-flex items-center gap-2"
              >
                <Icon className="h-4 w-4 text-orange-600" aria-hidden="true" />
                {t(category.key)}
              </Link>
            );
          })}
        </div>
      </section>
      )}

      {/* LES MISSIONS RÉCENTES : une liste qui se lit ligne à ligne, dans la
          carte à filet du site. La gouttière de chaque ligne est portée par
          `.ligne-app` — la page n'écrit plus ni rembourrage ni fond de survol,
          donc les trois gouttières différentes du même écran disparaissent. */}
      {/* Pas de carte « missions » sur une lecture échouée : sa liste vide
          dirait « aucune mission », exactement le mensonge du bandeau. */}
      {!loadError && !user?.is_owner && !estEquipeSupport && (
      <div className="carte-editoriale overflow-hidden">
        <div className="carte-cotes border-b border-stone-200 py-4">
          <h2 className="titre-carte-app">
            {user?.user_type === 'client' ? t('myRecentJobs') : t('availableJobs')}
          </h2>
        </div>
        <div className="divide-y divide-stone-100">
          {recentJobs.length > 0 ? (
            recentJobs.map((job) => (
              <Link key={job.id} to={`/jobs/${job.id}`} className="ligne-app">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-stone-900">{job.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-stone-600">{job.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="text-xs text-stone-500">{translateCategory(job.category)}</span>
                    <span className="text-xs text-stone-500">
                      {pageT('recentBudget', { min: job.budget_min, max: job.budget_max })}
                    </span>
                    {/* Le STATUT garde son propriétaire unique : une couleur
                        d'état lit `data-statut`, jamais une classe par cas. */}
                    <span
                      className="pastille-statut inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs font-semibold"
                      data-statut={job.status}
                    >
                      <span className="pastille-statut-point h-1.5 w-1.5 rounded-full" aria-hidden="true" />
                      {translateStatus(job.status)}
                    </span>
                  </div>
                </div>
                <span className="text-stone-400" aria-hidden="true">→</span>
              </Link>
            ))
          ) : (
            <div className="carte-cotes py-8 text-center text-stone-500">
              {user?.user_type === 'client' ? t('noJobsPosted') : t('noJobsAvailable')}
            </div>
          )}
        </div>
      </div>
      )}
    </CadrePage>
  );
}
