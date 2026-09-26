import { useRef } from 'react';
import { useNotifications } from '../contexts/NotificationContext';
import { useLanguage } from '../contexts/LanguageContext';
import { BellIcon } from './notificationIcons';
import { VERS_LE_BAS } from './notificationPanelPlacement';

/**
 * Le BOUTON cloche — un déclencheur, rien d'autre.
 *
 * Il n'y a plus de panneau ici : le centre de notifications est monté UNE fois
 * pour tout le site (`<NotificationPanel />` dans src/App.js) et se rend, par
 * portail React, DANS le conteneur de la cloche qui l'a ouvert. C'est ce
 * conteneur (`relative`) qui donne au panneau son ancrage CSS et son bord droit
 * (`absolute right-0`) : la barre qui a ouvert le panneau est donc toujours
 * celle sous laquelle il s'affiche, sans mesure de coordonnées.
 *
 * ── Pourquoi cette séparation ──────────────────────────────────────────────
 * La barre de navigation existe en DEUX dispositions (desktop et mobile) et la
 * cloche doit exister dans les deux. Quand la cloche ET le panneau vivaient
 * dans le même composant, la barre en montait donc DEUX exemplaires, chacun
 * avec son propre panneau et son propre écouteur `mousedown` sur le document :
 * l'instance masquée refermait le panneau PENDANT l'appui de l'instance
 * visible, ce qui démontait le bouton et faisait disparaître le `click` qui
 * suit — supprimer une notification ou « tout marquer comme lu » ne partait
 * jamais (symptôme mesuré : « la notification montre toujours 1 et refuse de
 * disparaître »). Déplacer le panneau ne suffisait pas : il fallait qu'il n'y
 * en ait qu'UN. La cloche, elle, peut être multiple sans danger — c'est un
 * déclencheur sans état propre, qui transmet simplement sa cible.
 *
 * ── Une cloche, trois bars, deux sens ──────────────────────────────────────
 * Trois barres portent une cloche : la barre du haut (disposition desktop), la
 * barre du haut (disposition mobile, tant qu'elle en avait une) et la barre de
 * navigation BASSE (`MobileBottomNav.js`, l'endroit où le pouce se pose). Elles
 * partagent le même panneau, et c'est le sens DÉCLARÉ par la cloche qui décide
 * de quel côté il s'ouvre : la barre du haut ouvre vers le BAS (`VERS_LE_BAS`,
 * le défaut — la disposition historique, où la page est sous la cloche) et la
 * barre du bas vers le HAUT, sinon le panneau sortirait par le bas de la
 * fenêtre, la barre étant collée au bas de l'écran. Le propriétaire de ce fait
 * est `notificationPanelPlacement.js` ; la cloche ne fait que le transmettre,
 * et le panneau ne mesure rien.
 *
 * `className`, `buttonClassName` et `iconClassName` existent pour la même
 * raison que celles de `LanguageSelector` : la cloche doit pouvoir porter
 * l'habit de la barre qui l'accueille — une pastille ronde dans la barre du
 * haut, une case de navigation (icône au-dessus d'un libellé) dans la barre du
 * bas — sans que deux bouts de DOM soient écrits pour le même déclencheur.
 * `label` n'est posé que là où la barre en veut un.
 */
export default function NotificationBell({
  sens = VERS_LE_BAS,
  className = '',
  buttonClassName = '',
  iconClassName = '',
  label = null,
}) {
  const { unreadCount, isOpen, togglePanel } = useNotifications();
  const conteneurRef = useRef(null);
  const { t } = useLanguage();

  const habillage = buttonClassName
    || 'relative p-2 rounded-xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-colors';

  return (
    <div ref={conteneurRef} className={`relative ${className}`}>
      <button
        onClick={() => togglePanel(conteneurRef.current, sens)}
        aria-label={unreadCount > 0 ? `${t('notificationsTitle')} — ${t('notifUnreadCount').replace('{count}', String(unreadCount))}` : t('notificationsTitle')}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className={habillage}
      >
        {/* La pastille est ancrée à l'ICÔNE, pas au bouton : dans une case de
            navigation (icône au-dessus d'un libellé, donc plus large que
            haute), un compteur posé au coin du bouton s'en détacherait de
            plusieurs dizaines de pixels et ne se lirait plus comme « la
            pastille de la cloche ». */}
        <span className="relative inline-flex">
          <BellIcon className={iconClassName} />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full leading-none"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </span>
        {label && <span className="mt-1 text-center leading-tight">{label}</span>}
        {/* Le compteur change tout seul (polling, push) : annoncé aux lecteurs
            d'écran, qui ne voient pas le badge apparaître. */}
        <span className="sr-only" aria-live="polite">
          {unreadCount > 0 ? t('notifUnreadCount').replace('{count}', String(unreadCount)) : ''}
        </span>
      </button>
    </div>
  );
}
