import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { isPWA } from '../utils/pwa';
import LanguageSelector from './LanguageSelector';
import NotificationBell from './NotificationBell';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // ── Le menu se ferme quand sa barre cesse d'être AFFICHÉE ─────────────────
  // Le menu mobile n'existe qu'en dessous du point de rupture (`md:hidden`),
  // comme le bouton qui l'ouvre. Or une ROTATION d'écran ou un
  // redimensionnement le franchit pendant qu'il est ouvert — un téléphone en
  // portrait (412 px) passe à 823 px de large en paysage, et 768 px suffisent.
  //
  // MESURÉ (Chromium, 25/09/2026, `e2e/barres-rupture.spec.js`) avant ce
  // correctif : le menu restait OUVERT dans une barre `display:none` — le
  // hamburger et son fond de fermeture étaient invisibles — pendant que
  // `document.body.style.overflow` restait à `hidden`. Conséquence non
  // négociable : sur la barre devenue desktop, 900 px de molette ne faisaient
  // défiler la page que de 0 px, et AUCUNE commande visible ne pouvait la
  // débloquer (`window.scrollTo` reste possible : il est programmatique, donc
  // une sonde qui défilerait ainsi croirait la page saine).
  //
  // La vérification est celle du centre de notifications (`NotificationPanel`),
  // et pour la même raison : elle lit l'AFFICHAGE RÉEL (`getClientRects()`), pas
  // la condition CSS qui devrait le produire — donc elle reste vraie si une
  // autre cause masque la barre (classe changée, conteneur caché), sans
  // recopier ici les 768 px de Tailwind ni deviner ce que le thème fait.
  // Fermer est l'état vrai : plus rien n'est ouvert.
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const verifierAffichage = () => {
      if (menuRef.current && menuRef.current.getClientRects().length === 0) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', verifierAffichage);
    return () => window.removeEventListener('resize', verifierAffichage);
  }, [isMobileMenuOpen]);

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

  // L'entrée de menu est SOULIGNÉE quand on est déjà dessus : sans ce repère, un
  // visiteur qui navigue ne sait pas où il se trouve. Le soulignement reprend la
  // règle de survol des liens (même épaisseur, même couleur).
  const estActif = (chemin) =>
    chemin === '/' ? location.pathname === '/' : location.pathname.startsWith(chemin);
  const lienDesktop = (chemin) =>
    `text-gray-700 hover:text-orange-600 px-3 py-2 text-sm font-medium transition-colors border-b-2 ${
      estActif(chemin) ? 'border-orange-600 text-orange-600' : 'border-transparent'
    }`;

  return (
    <nav className={navbarClass}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className="flex-shrink-0 flex items-center" onClick={closeMobileMenu}>
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center">
                  <span className="text-white text-lg font-bold">{t('brandMark')}</span>
                </div>
                <div className="text-xl font-bold text-orange-600">Kojo</div>
              </div>
            </Link>
          </div>

          <div className="hidden md:flex items-center space-x-6">
            {user ? (
              <>
                <Link to="/dashboard" className={lienDesktop('/dashboard')}>
                  {t('dashboard')}
                </Link>
                <Link to="/jobs" className={lienDesktop('/jobs')}>
                  {t('jobs')}
                </Link>
                <Link to="/messages" className={lienDesktop('/messages')}>
                  {t('messages')}
                </Link>
                <Link to="/support" className={lienDesktop('/support')}>
                  {t('support')}
                </Link>
              </>
            ) : (
              /* Visiteur NON connecté : la navigation publique. Sans elle, un
                 premier visiteur ne voyait que « Connexion » / « Inscription »
                 et ne pouvait atteindre les emplois, la page « Comment ça
                 marche ? » ou le contact que par le bas de page. */
              <>
                <Link to="/jobs" className={lienDesktop('/jobs')}>
                  {t('jobs')}
                </Link>
                <Link to="/how-it-works" className={lienDesktop('/how-it-works')}>
                  {t('howItWorksTitle')}
                </Link>
                <Link to="/about" className={lienDesktop('/about')}>
                  {t('aboutTitle')}
                </Link>
                <Link to="/contact" className={lienDesktop('/contact')}>
                  {t('contactTitle')}
                </Link>
              </>
            )}
          </div>

          <div className="hidden md:flex items-center space-x-4">
            <LanguageSelector showDropdown={true} showFlags={true} className="mr-4" />

            {user ? (
              <div className="flex items-center space-x-4">
                {/* Cloche notifications — le BOUTON seulement : le panneau du
                    centre de notifications est monté une seule fois pour tout
                    le site (App.js) et se rend dans le conteneur de la cloche
                    qui l'ouvre. Il n'existe donc plus un panneau par barre,
                    chacun avec son écouteur de clic extérieur — c'est ce
                    nombre qui faisait disparaître l'appui avant le `click`. */}
                <NotificationBell />
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
            {/* Pas de cloche ICI : sur mobile, le centre de notifications est
                porté par la barre de navigation BASSE (`MobileBottomNav.js`),
                celle qui est sous le pouce — deux cloches affichées à la fois
                feraient deux points d'entrée pour un seul panneau. Le header
                mobile garde donc le hamburger seul, et la barre du haut garde
                sa cloche pour la disposition desktop. */}
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
          <div ref={menuRef} id="mobile_menu" className="relative z-50 md:hidden border-t border-gray-200 bg-white shadow-xl">
            <div className="max-h-[calc(100vh-4rem)] overflow-y-auto px-3 pt-3 pb-6 space-y-2">
              <div className="rounded-2xl border border-gray-200 px-3 py-3">
                {/* Le tiroir mobile ne porte PLUS son propre sélecteur : il monte
                    le MÊME composant que la barre du haut (`LanguageSelector`),
                    donc le même menu, la même liste et le même comportement
                    d'appui extérieur. Un `<select>` natif d'un côté et un menu
                    déroulant de l'autre donnaient deux contrôles de formes
                    différentes pour un seul choix, et la liste du `<select>` a
                    été un fait à deux endroits jusqu'à son unification dans
                    `src/config/languages.js`. */}
                <span className="block text-xs font-medium text-gray-500 mb-2">{t('languageLabel')}</span>
                <LanguageSelector
                  showDropdown={true}
                  showFlags={true}
                  className="w-full"
                  buttonClassName="w-full min-h-[44px]"
                />
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
                  <Link to="/support" className="block rounded-2xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('support')}
                  </Link>
                  <div className="pt-2">
                    <button onClick={handleLogout} className="w-full rounded-2xl bg-orange-600 hover:bg-orange-700 text-white px-4 py-3 text-base font-medium transition-colors">
                      {t('logout')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Les mêmes entrées publiques que sur grand écran : le menu
                      mobile d'un visiteur non connecté ne doit pas être plus
                      pauvre que la barre du haut. */}
                  <Link to="/jobs" className="block rounded-2xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('jobs')}
                  </Link>
                  <Link to="/how-it-works" className="block rounded-2xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('howItWorksTitle')}
                  </Link>
                  <Link to="/about" className="block rounded-2xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('aboutTitle')}
                  </Link>
                  <Link to="/contact" className="block rounded-2xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('contactTitle')}
                  </Link>
                  <Link to="/privacy" className="block rounded-2xl text-gray-700 hover:text-orange-600 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('privacyTitle')}
                  </Link>
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
