import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { isPWA } from '../utils/pwa';
import LanguageSelector from './LanguageSelector';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { t, changeLanguage, currentLanguage } = useLanguage();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      document.body.style.overflow = '';
      return;
    }

    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  const handleLogout = () => {
    logout();
    navigate('/');
    setIsMobileMenuOpen(false);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  const navbarClass = isPWA()
    ? 'sticky top-0 z-50 border-b bg-white/95 shadow-sm backdrop-blur pt-safe-area-inset-top'
    : 'sticky top-0 z-50 border-b bg-white/95 shadow-sm backdrop-blur';

  return (
    <nav className={navbarClass}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className="flex-shrink-0 flex items-center" onClick={closeMobileMenu}>
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center">
                  <span className="text-white text-lg font-bold">K</span>
                </div>
                <div className="text-xl font-bold text-orange-600">Kojo</div>
              </div>
            </Link>
          </div>

          <div className="hidden md:flex items-center space-x-8">
            {user && (
              <>
                <Link to="/dashboard" className="text-gray-700 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  {t('dashboard')}
                </Link>
                <Link to="/jobs" className="text-gray-700 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  {t('jobs')}
                </Link>
                <Link to="/messages" className="text-gray-700 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  {t('messages')}
                </Link>
              </>
            )}
          </div>

          <div className="hidden md:flex items-center space-x-4">
            <LanguageSelector showDropdown={true} showFlags={true} className="mr-4" />

            {user ? (
              <div className="flex items-center space-x-4">
                <Link to="/profile" className="text-gray-700 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  {t('profile')}
                </Link>
                <button onClick={handleLogout} className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
                  {t('logout')}
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                <Link to="/login" className="text-gray-700 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  {t('login')}
                </Link>
                <Link to="/register" className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
                  {t('register')}
                </Link>
              </div>
            )}
          </div>

          <div className="md:hidden flex items-center">
            <button
              aria-label={isMobileMenuOpen ? t('closeMenu') : t('openMenu')}
              aria-expanded={isMobileMenuOpen}
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="min-h-[44px] min-w-[44px] text-gray-700 hover:text-orange-600 p-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isMobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path>
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {isMobileMenuOpen && (
        <>
          <button type="button" aria-label={t('closeMenu')} className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={closeMobileMenu} />
          <div className="relative z-50 md:hidden border-t border-gray-200 bg-white shadow-xl">
            <div className="max-h-[calc(100vh-4rem)] overflow-y-auto px-3 pt-3 pb-6 space-y-2">
              <div className="rounded-2xl border border-gray-200 px-3 py-3">
                <label htmlFor="mobile_language_selector" className="block text-xs font-medium text-gray-500 mb-2">{t('languageLabel')}</label>
                <select
                  id="mobile_language_selector"
                  name="mobile_language_selector"
                  autoComplete="off"
                  value={currentLanguage}
                  onChange={(e) => changeLanguage(e.target.value)}
                  className="w-full min-h-[44px] text-sm border border-gray-300 rounded-xl px-3 py-2 bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                  <option value="wo">Wolof</option>
                  <option value="bm">Bambara</option>
                  <option value="mos">Mooré</option>
                </select>
              </div>

              {user ? (
                <>
                  <Link to="/dashboard" className="block rounded-2xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('dashboard')}
                  </Link>
                  <Link to="/jobs" className="block rounded-2xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('jobs')}
                  </Link>
                  <Link to="/messages" className="block rounded-2xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('messages')}
                  </Link>
                  <Link to="/profile" className="block rounded-2xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('profile')}
                  </Link>
                  <div className="pt-2">
                    <button onClick={handleLogout} className="w-full rounded-2xl bg-orange-600 hover:bg-orange-700 text-white px-4 py-3 text-base font-medium transition-colors">
                      {t('logout')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Link to="/login" className="block rounded-2xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('login')}
                  </Link>
                  <Link to="/register" className="block rounded-2xl bg-orange-600 hover:bg-orange-700 text-white px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('register')}
                  </Link>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
