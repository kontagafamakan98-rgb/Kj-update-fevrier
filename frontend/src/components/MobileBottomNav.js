import { useLocation } from 'react-router-dom';
import Link from './LienVue';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import NotificationBell from './NotificationBell';
import { VERS_LE_HAUT } from './notificationPanelPlacement';
import { Icone } from './chrome-icons';

const HIDDEN_PATHS = ['/login', '/register', '/forgot-password', '/email-verification'];

export default function MobileBottomNav() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  if (HIDDEN_PATHS.includes(location.pathname)) {
    return null;
  }

  // VISITEUR ANONYME : la barre du bas sert la DÉCOUVERTE. Avant, elle
  // disparaissait complètement pour un visiteur non connecté : sur mobile — le
  // support principal du site — il ne restait que le menu ☰ pour atteindre les
  // emplois, le contact ou la connexion. Les libellés sont courts et sortent du
  // dictionnaire existant (pas de clé nouvelle à traduire dans cinq langues).
  const navItems = !user
    ? [
        {
          path: '/',
          icon: (active) => (
            <Icone
              nom="accueil"
              classe={`w-6 h-6 ${active ? 'text-orange-600' : 'text-gray-400'}`}
            />
          ),
          label: t('home'),
        },
        {
          path: '/jobs',
          icon: (active) => (
            <Icone
              nom="valise"
              classe={`w-6 h-6 ${active ? 'text-orange-600' : 'text-gray-400'}`}
            />
          ),
          label: t('jobs'),
        },
        {
          path: '/support',
          icon: (active) => (
            <Icone
              nom="casque"
              classe={`w-6 h-6 ${active ? 'text-orange-600' : 'text-gray-400'}`}
            />
          ),
          label: t('support'),
        },
        {
          path: '/login',
          icon: (active) => (
            <Icone
              nom="entree"
              classe={`w-6 h-6 ${active ? 'text-orange-600' : 'text-gray-400'}`}
            />
          ),
          label: t('login'),
        },
      ]
    : [
    {
      path: '/dashboard',
      icon: (active) => (
        <Icone
              nom="tableau"
              classe={`w-6 h-6 ${active ? 'text-orange-600' : 'text-gray-400'}`}
            />
      ),
      label: t('dashboard')
    },
    {
      path: '/jobs',
      icon: (active) => (
        <Icone
              nom="valise"
              classe={`w-6 h-6 ${active ? 'text-orange-600' : 'text-gray-400'}`}
            />
      ),
      label: t('jobs')
    },
    {
      path: '/messages',
      icon: (active) => (
        <Icone
              nom="messages"
              classe={`w-6 h-6 ${active ? 'text-orange-600' : 'text-gray-400'}`}
            />
      ),
      label: t('messages')
    },
    {
      path: '/profile',
      icon: (active) => (
        <Icone
              nom="profil"
              classe={`w-6 h-6 ${active ? 'text-orange-600' : 'text-gray-400'}`}
            />
      ),
      label: t('profile')
    }
  ];

  const isActivePath = (path) => {
    if (path === '/dashboard' || path === '/') {
      return location.pathname === path;
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  // ── Le centre de notifications est ici, dans la barre du BAS ───────────────
  // Sur mobile, c'est cette barre qui est sous le pouce : la cloche y est donc
  // un CINQUIÈME item pour un visiteur connecté, au lieu de rester seule dans
  // le coin de la barre du haut. C'est le MÊME panneau unique qui s'ouvre (il
  // n'y en a qu'un, monté dans App.js) : la cloche ne fait que déclarer qu'elle
  // ouvre VERS LE HAUT — sous une barre collée au bas de l'écran, un panneau
  // qui descendrait sortirait de la fenêtre.
  //
  // Le visiteur ANONYME n'en a pas : rien à lire pour lui, et ses quatre items
  // de découverte gardent leur place (la grille suit le nombre d'items, et les
  // deux classes sont écrites en clair pour que Tailwind les serve).
  const caseDeCloche =
    'flex w-full min-h-[64px] flex-col items-center justify-center rounded-2xl px-1 py-2 text-[11px] font-medium text-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500';

  return (
    <div
      data-mobile-bottom-nav="true"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 pb-[max(env(safe-area-inset-bottom),0.5rem)] md:hidden"
    >
      <div className={`grid ${user ? 'grid-cols-5' : 'grid-cols-4'} gap-1 px-2 pt-2`}>
        {navItems.map((item) => {
          const isActive = isActivePath(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex min-h-[64px] flex-col items-center justify-center rounded-2xl px-1 py-2 text-[11px] font-medium transition-colors ${
                isActive ? 'bg-orange-50 text-orange-600' : 'text-gray-500'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {item.icon(isActive)}
              <span className={`mt-1 text-center leading-tight ${isActive ? 'text-orange-600' : 'text-gray-500'}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
        {user && (
          <NotificationBell
            sens={VERS_LE_HAUT}
            className="flex"
            buttonClassName={caseDeCloche}
            iconClassName="w-6 h-6 text-gray-400"
            label={t('notificationsTitle')}
          />
        )}
      </div>
    </div>
  );
}
