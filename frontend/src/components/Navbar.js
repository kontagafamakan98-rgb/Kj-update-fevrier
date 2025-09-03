import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { isPWA } from '../utils/pwa';
import LanguageSelector from './LanguageSelector';
import logger from '../utils/logger';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { t, changeLanguage, currentLanguage } = useLanguage();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
    setIsMobileMenuOpen(false);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  // Add extra padding for PWA status bar on iOS
  const navbarClass = isPWA() 
    ? "bg-white shadow-sm border-b pt-safe-area-inset-top" 
    : "bg-white shadow-sm border-b";

  return (
    <nav className={navbarClass}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo */}
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

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center space-x-8">
            {user && (
              <>
                <Link 
                  to="/dashboard" 
                  className="text-gray-700 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  {t('dashboard')}
                </Link>
                <Link 
                  to="/jobs" 
                  className="text-gray-700 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  {t('jobs')}
                </Link>
                <Link 
                  to="/messages" 
                  className="text-gray-700 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  {t('messages')}
                </Link>
              </>
            )}
          </div>

          {/* Right side - Desktop */}
          <div className="hidden md:flex items-center space-x-4">
            {/* Language Selector */}
            <LanguageSelector 
              showDropdown={true} 
              showFlags={true}
              className="mr-4"
            />

            {user ? (
              <div className="flex items-center space-x-4">
                <Link 
                  to="/profile"
                  className="text-gray-700 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  {t('profile')}
                </Link>
                <button
                  onClick={handleLogout}
                  className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  {t('logout')}
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                <Link 
                  to="/login"
                  className="text-gray-700 hover:text-orange-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  {t('login')}
                </Link>
                <Link 
                  to="/register"
                  className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  {t('register')}
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="text-gray-700 hover:text-orange-600 p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
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

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-white border-t border-gray-200 shadow-lg">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {/* Language selector mobile */}
            <div className="px-3 py-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Langue</label>
              <select 
                value={currentLanguage}
                onChange={(e) => changeLanguage(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-2 bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              >
                <option value="fr">Français</option>
                <option value="wo">Wolof</option>
                <option value="bm">Bambara</option>
              </select>
            </div>

            {user ? (
              <>
                <Link 
                  to="/dashboard" 
                  className="block text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-3 py-2 rounded-md text-base font-medium transition-colors"
                  onClick={closeMobileMenu}
                >
                  {t('dashboard')}
                </Link>
                <Link 
                  to="/jobs" 
                  className="block text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-3 py-2 rounded-md text-base font-medium transition-colors"
                  onClick={closeMobileMenu}
                >
                  {t('jobs')}
                </Link>
                <Link 
                  to="/messages" 
                  className="block text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-3 py-2 rounded-md text-base font-medium transition-colors"
                  onClick={closeMobileMenu}
                >
                  {t('messages')}
                </Link>
                <Link 
                  to="/profile" 
                  className="block text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-3 py-2 rounded-md text-base font-medium transition-colors"
                  onClick={closeMobileMenu}
                >
                  {t('profile')}
                </Link>
                <div className="border-t border-gray-200 pt-3 mt-3">
                  <button
                    onClick={handleLogout}
                    className="w-full text-left bg-orange-600 hover:bg-orange-700 text-white px-3 py-2 rounded-md text-base font-medium transition-colors"
                  >
                    {t('logout')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <Link 
                  to="/login"
                  className="block text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-3 py-2 rounded-md text-base font-medium transition-colors"
                  onClick={closeMobileMenu}
                >
                  {t('login')}
                </Link>
                <Link 
                  to="/register"
                  className="block bg-orange-600 hover:bg-orange-700 text-white px-3 py-2 rounded-md text-base font-medium transition-colors"
                  onClick={closeMobileMenu}
                >
                  {t('register')}
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}