import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../contexts/NotificationContext';
import { useLanguage } from '../contexts/LanguageContext';
import { BellIcon, CheckAllIcon, TrashIcon, XIcon } from './notificationIcons';
import { ancrageDe } from './notificationPanelPlacement';

// Le message d'un échec d'action, par action : la copie du produit, jamais le
// statut brut du serveur. Une action qui échoue doit se VOIR — c'est la moitié
// du défaut signalé (« ça refuse de supprimer » sans rien dire).
const MESSAGE_ECHEC = {
  delete: 'notifDeleteFailed',
  deleteAll: 'notifDeleteAllFailed',
  markAllRead: 'notifMarkAllFailed',
};

// Icône selon le type de notification
const typeIcon = (type) => {
  const icons = {
    proposal_received:  '📋',
    proposal_accepted:  '🎉',
    job_in_progress:    '🔧',
    payment_received:   '💰',
    payment_confirmed:  '✅',
    job_completed:      '🏁',
    new_message:        '💬',
    general:            '🔔',
  };
  return icons[type] || '🔔';
};

// Formater la date relative (ex: "il y a 3 min") — traduit selon la langue
const relativeTime = (isoDate, t) => {
  if (!isoDate) return '';
  const diff = (Date.now() - new Date(isoDate).getTime()) / 1000;
  const interpolate = (template, vars = {}) => String(template || '').replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
  if (diff < 60)    return t('notifJustNow');
  if (diff < 3600)  return interpolate(t('notifMinAgo'), { n: Math.floor(diff / 60) });
  if (diff < 86400) return interpolate(t('notifHourAgo'), { n: Math.floor(diff / 3600) });
  if (diff < 604800)return interpolate(t('notifDayAgo'), { n: Math.floor(diff / 86400) });
  return new Date(isoDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

/**
 * LE panneau du centre de notifications — monté UNE fois pour tout le site.
 *
 * Il est rendu par `<NotificationPanel />` dans `AppRoutes` (src/App.js), à
 * côté de la navbar, et son DOM va, par portail React, DANS le conteneur de la
 * cloche qui l'a ouvert (l'`ancre` du contexte). Deux propriétés en découlent,
 * et ce sont elles qui décident de l'architecture :
 *
 *   1. il n'existe qu'UN panneau, donc UN seul écouteur `mousedown` sur le
 *      document. Le défaut d'origine venait de leur nombre : la barre desktop et
 *      la barre mobile montaient chacune le leur, l'instance dont le conteneur
 *      était `display:none` recevait le `mousedown` d'un appui fait dans l'autre,
 *      ne le reconnaissait pas comme « intérieur », et refermait le panneau
 *      PENDANT l'appui — le bouton était démonté avant le `click`, donc
 *      supprimer ou marquer lu ne partait jamais, sans requête et sans message ;
 *   2. il s'affiche là où la cloche qui l'a ouvert vit, sans mesurer un seul
 *      pixel : le conteneur de la cloche est `relative`, le panneau y garde son
 *      `absolute right-0`, et de quel CÔTÉ il s'ouvre (sous la barre du haut,
 *      au-dessus de la barre du bas) est DÉCLARÉ par la cloche — elle transmet
 *      son `sens` avec son conteneur, et `notificationPanelPlacement.js` en
 *      est l'unique propriétaire. La cloche est un simple déclencheur
 *      (`NotificationBell.js`), elle n'a aucun état à elle.
 */
export default function NotificationPanel() {
  const {
    notifications,
    unreadCount,
    loading,
    isOpen,
    ancre,
    sens,
    closePanel,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteAll,
    actionError,
    clearActionError,
    retryLastAction,
  } = useNotifications();

  const navigate = useNavigate();
  const panelRef = useRef(null);
  const { t } = useLanguage();
  // « Tout supprimer » est destructeur et sans retour : le premier appui ARME,
  // le second exécute. L'état retombe dès que le panneau se ferme, pour qu'un
  // appui armé ne survive pas à un autre écran.
  const [confirmeToutSupprimer, setConfirmeToutSupprimer] = useState(false);

  useEffect(() => {
    if (!isOpen) setConfirmeToutSupprimer(false);
  }, [isOpen]);

  // Le panneau s'annonce comme un dialogue : on lui donne le focus à
  // l'ouverture, sinon la tabulation suivante repart de la cloche et traverse
  // la page « derrière » un contenu qui vient de s'ouvrir.
  useEffect(() => {
    if (isOpen) panelRef.current?.focus();
  }, [isOpen]);

  // Fermer en cliquant en dehors.
  //
  // « Dedans » se lit sur l'ANCRE, pas sur une référence d'instance : le
  // panneau est un descendant DOM du conteneur de la cloche (c'est le portail
  // qui l'y place), donc `ancre.contains(cible)` couvre exactement les deux
  // choses qu'un appui ne doit pas refermer — le panneau lui-même et la cloche
  // qui l'a ouvert. Un appui plus loin (un lien de la barre, le fond du menu
  // mobile) ferme, ce qui est le comportement attendu.
  //
  // La cloche n'est pas exclue à part : un appui dessus ne doit pas fermer ici,
  // sinon le `click` qui suit exécuterait `togglePanel` sur un panneau déjà
  // fermé — il le ROUVRIRAIT, et le panneau semblerait insensible au clic.
  useEffect(() => {
    if (!isOpen || !ancre) return;
    const handler = (e) => {
      if (ancre.contains(e.target)) return;
      closePanel();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, ancre, closePanel]);

  // Fermer avec Échap
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') closePanel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, closePanel]);

  // La barre qui héberge le panneau peut cesser d'être affichée pendant qu'il
  // est ouvert : les deux barres vivent dans le même DOM, séparées par un
  // point de rupture CSS (`hidden md:flex` / `md:hidden`), et une rotation
  // d'écran le franchit dans les deux sens. Sans cette vérification, le
  // panneau resterait porté par un conteneur `display:none` — invisible, mais
  // `isOpen` vrai : la cloche redevenue visible semblait alors ne rien faire
  // (son premier appui ne faisait que refermer un panneau que personne ne
  // voyait). On ferme, ce qui est l'état vrai : plus rien n'est ouvert.
  useEffect(() => {
    if (!isOpen || !ancre) return;
    const verifierAncrage = () => {
      if (ancre.getClientRects().length === 0) closePanel();
    };
    window.addEventListener('resize', verifierAncrage);
    return () => window.removeEventListener('resize', verifierAncrage);
  }, [isOpen, ancre, closePanel]);

  const handleNotificationClick = (notif) => {
    if (!notif.is_read) markAsRead(notif.id);
    if (notif.related_id && notif.related_type === 'job') {
      navigate(`/jobs/${notif.related_id}`);
      closePanel();
    }
  };

  if (!isOpen || !ancre) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      tabIndex={-1}
      data-notification-panel="true"
      aria-label={t('notifCenterAria')}
      className={`absolute right-0 ${ancrageDe(sens)} w-[340px] sm:w-[380px] max-h-[520px] flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden outline-none`}
      style={{ maxHeight: 'calc(100vh - 80px)' }}
    >
      {/* En-tête */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <BellIcon className="w-5 h-5 text-orange-600" />
          <span className="font-semibold text-gray-800 text-sm">{t('notificationsTitle')}</span>
          {unreadCount > 0 && (
            <span className="bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-0.5 rounded-full">
              {t('notifUnreadCount').replace('{count}', String(unreadCount))}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              title={t('markAllRead')}
              className="p-1.5 rounded-lg text-gray-500 hover:text-orange-600 hover:bg-orange-50 transition-colors"
            >
              <CheckAllIcon />
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={() => {
                if (confirmeToutSupprimer) {
                  setConfirmeToutSupprimer(false);
                  deleteAll();
                  return;
                }
                setConfirmeToutSupprimer(true);
              }}
              title={confirmeToutSupprimer ? t('confirmDeleteAll') : t('deleteAll')}
              aria-label={confirmeToutSupprimer ? t('confirmDeleteAll') : t('deleteAll')}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                confirmeToutSupprimer
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'text-gray-500 hover:text-red-500 hover:bg-red-50'
              }`}
            >
              <TrashIcon />
              {confirmeToutSupprimer && <span>{t('confirmDeleteAll')}</span>}
            </button>
          )}
          <button
            onClick={closePanel}
            aria-label={t('closeNotif')}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <XIcon />
          </button>
        </div>
      </div>

      {/* Corps — liste */}
      <div className="flex-1 overflow-y-auto">
        {actionError && (
          <div
            role="alert"
            className="flex items-start gap-2 px-4 py-3 bg-red-50 border-b border-red-100 text-red-700"
          >
            <span className="text-sm flex-1">
              {t(MESSAGE_ECHEC[actionError.action] || 'notifDeleteFailed')}
            </span>
            <button
              onClick={retryLastAction}
              className="text-sm font-semibold underline decoration-red-300 hover:decoration-red-600 whitespace-nowrap"
            >
              {t('retry')}
            </button>
            <button
              onClick={clearActionError}
              aria-label={t('closeNotif')}
              className="p-1 rounded-lg text-red-400 hover:text-red-700 hover:bg-red-100 transition-colors"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {loading && notifications.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="text-4xl mb-3">🔔</div>
            <p className="text-gray-500 text-sm font-medium">{t('noNotifications')}</p>
            <p className="text-gray-500 text-xs mt-1">{t('notifEmptyHint')}</p>
          </div>
        ) : (
          <ul role="list" className="divide-y divide-gray-50">
            {notifications.map((notif) => (
              <li key={notif.id}>
                <div
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors group ${
                    notif.is_read
                      ? 'hover:bg-gray-50'
                      : 'bg-orange-50/60 hover:bg-orange-50'
                  }`}
                  onClick={() => handleNotificationClick(notif)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleNotificationClick(notif); }}
                  aria-label={`${notif.title}: ${notif.body}`}
                >
                  {/* Indicateur non-lu */}
                  <div className="flex-shrink-0 mt-1">
                    {!notif.is_read && (
                      <span className="block w-2 h-2 rounded-full bg-orange-500" aria-hidden="true" />
                    )}
                    {notif.is_read && (
                      <span className="block w-2 h-2" aria-hidden="true" />
                    )}
                  </div>

                  {/* Icône type */}
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-white border border-gray-100 shadow-sm flex items-center justify-center text-lg">
                    {typeIcon(notif.type)}
                  </div>

                  {/* Contenu */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${notif.is_read ? 'text-gray-700' : 'text-gray-900'}`}>
                      {notif.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">
                      {notif.body}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1">
                      {relativeTime(notif.created_at, t)}
                    </p>
                  </div>

                  {/* Bouton supprimer.
                      Il était `opacity-0` jusqu'au survol : sur un écran
                      TACTILE il n'existe pas — le doigt ne survole pas, et
                      une cible de 24 px est hors de portée. Il est donc
                      toujours visible sous `sm`, où il fait 44 px ; au-delà
                      il garde l'apparition au survol (souris) sans jamais
                      être inaccessible au clavier (`focus:opacity-100`). */}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteNotification(notif.id); }}
                    aria-label={t('deleteNotification')}
                    className="flex-shrink-0 inline-flex items-center justify-center w-11 h-11 -my-2 -mr-2 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 active:bg-red-100 transition-all focus:outline-none focus:ring-2 focus:ring-red-400 sm:w-9 sm:h-9 sm:-my-1 sm:-mr-1 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                  >
                    <XIcon className="w-5 h-5 sm:w-4 sm:h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    ancre,
  );
}
