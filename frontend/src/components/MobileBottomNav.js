import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';

const HIDDEN_PATHS = ['/login', '/register', '/forgot-password', '/email-verification'];

export default function MobileBottomNav() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  if (!user || HIDDEN_PATHS.includes(location.pathname)) {
    return null;
  }

  const navItems = [
    {
      path: '/dashboard',
      icon: (active) => (
        <svg className={`w-6 h-6 ${active ? 'text-orange-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z"></path>
        </svg>
      ),
      label: t('dashboard')
    },
    {
      path: '/jobs',
      icon: (active) => (
        <svg className={`w-6 h-6 ${active ? 'text-orange-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m8 0V6a2 2 0 012 2v6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m-8 0h8"></path>
        </svg>
      ),
      label: t('jobs')
    },
    {
      path: '/messages',
      icon: (active) => (
        <svg className={`w-6 h-6 ${active ? 'text-orange-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
        </svg>
      ),
      label: t('messages')
    },
    {
      path: '/profile',
      icon: (active) => (
        <svg className={`w-6 h-6 ${active ? 'text-orange-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
        </svg>
      ),
      label: t('profile')
    }
  ];

  const isActivePath = (path) => {
    if (path === '/dashboard') {
      return location.pathname === '/dashboard';
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 pb-[max(env(safe-area-inset-bottom),0.5rem)] md:hidden">
      <div className="grid grid-cols-4 gap-1 px-2 pt-2">
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
      </div>
    </div>
  );
}
