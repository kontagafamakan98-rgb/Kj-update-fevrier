import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../contexts/NotificationContext';
import { useLanguage } from '../contexts/LanguageContext';

// Icônes SVG inline pour ne pas ajouter de dépendance
const BellIcon = ({ className = 'w-6 h-6' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);

const CheckAllIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

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

export default function NotificationDropdown() {
  const {
    notifications,
    unreadCount,
    loading,
    isOpen,
    togglePanel,
    closePanel,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteAll,
  } = useNotifications();

  const navigate = useNavigate();
  const panelRef = useRef(null);
  const buttonRef = useRef(null);
  const { t } = useLanguage();

  // Fermer en cliquant en dehors
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      // La Navbar rend DEUX instances du dropdown (desktop + mobile, l'une
      // masquée par CSS). Chaque instance écoute mousedown sur le document :
      // quand on clique la cloche de l'instance VISIBLE, le mousedown de
      // l'instance CACHÉE considérait la cible comme extérieure et fermait
      // le panneau (isOpen=false), puis le click de l'instance visible
      // exécutait togglePanel avec isOpen désormais false → réouverture
      // immédiate : impossible de fermer le panneau. On ignore donc tout
      // clic dont la cible est une cloche de notifications, quelle que soit
      // l'instance.
      const isBellClick = !!(
        e.target && e.target.closest && e.target.closest('button[aria-label^="Notifications"]')
      );
      if (
        !isBellClick &&
        panelRef.current && !panelRef.current.contains(e.target) &&
        buttonRef.current && !buttonRef.current.contains(e.target)
      ) {
        closePanel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, closePanel]);

  // Fermer avec Échap
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') closePanel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, closePanel]);

  const handleNotificationClick = (notif) => {
    if (!notif.is_read) markAsRead(notif.id);
    if (notif.related_id && notif.related_type === 'job') {
      navigate(`/jobs/${notif.related_id}`);
      closePanel();
    }
  };

  return (
    <div className="relative">
      {/* Bouton cloche */}
      <button
        ref={buttonRef}
        onClick={togglePanel}
        aria-label={unreadCount > 0 ? `${t('notificationsTitle')} — ${t('notifUnreadCount').replace('{count}', String(unreadCount))}` : t('notificationsTitle')}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="relative p-2 rounded-xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-colors"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full leading-none"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panneau déroulant */}
      {isOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t('notifCenterAria')}
          className="absolute right-0 mt-2 w-[340px] sm:w-[380px] max-h-[520px] flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden"
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
                  onClick={deleteAll}
                  title={t('deleteAll')}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <TrashIcon />
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

                      {/* Bouton supprimer */}
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteNotification(notif.id); }}
                        aria-label={t('deleteNotification')}
                        className="flex-shrink-0 p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all focus:opacity-100"
                      >
                        <XIcon />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
