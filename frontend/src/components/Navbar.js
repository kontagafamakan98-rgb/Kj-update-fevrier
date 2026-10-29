import { useNavigate, useLocation } from 'react-router-dom';
// Le lien interne passe par la transition de vue native (un seul propriétaire
// pour les trois surfaces du chrome : voir components/LienVue.js).
import Link from './LienVue';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { isPWA } from '../utils/pwa';
import LanguageSelector from './LanguageSelector';
import NotificationBell from './NotificationBell';
import { Icone } from './chrome-icons';
import { MarqueKojo } from '../config/marque-kojo';
// Les CLASSES du chrome : UN propriétaire (src/config/classes-chrome.js), lu par
// cette barre ET par le placeholder des coquilles pré-rendues
// (vite-plugins/prerender/app-chrome.js) — c'est la hauteur (border-b + h-16 =
// 65 px mesurés) qui décide où tombe le contenu des deux peintures.
import {
  CONTENEUR_CLASS,
  NAV_RANGEE_CLASS,
  NAV_CLASS,
  NAV_PWA_SUFFIXE,
} from '../config/classes-chrome';

// ── LE SURVOL DE LA BARRE VA JUSQU'AU BRUN, ET C'EST MESURÉ (26/10/2026) ────
// La barre est du VERRE (`.verre-barre` : rgba(253, 250, 244, 0.78) + flou) : la
// surface qu'un lien peint dépend donc de ce qui défile DERRIÈRE. Mesuré sur les
// deux fonds de référence que le dépôt emploie déjà pour une vitre
// (`scripts/verre-contraste.js`) : le sable de l'application (composé → #fcf8f2)
// et l'encre du site (#ccc9c3, le pire cas plausible). Le survol était
// `orange-600` (#ea580c) : **3,36:1** sur le verre posé sur le sable, **2,15:1**
// sur le pire cas — sous le 4,5:1 du texte courant (WCAG 1.4.3). `orange-700`
// (#c2410c) tenait le premier (4,89:1) mais pas le second (3,13:1), donc le
// survol des entrées de bureau est monté avec les autres. `orange-900`
// (#7c2d12, le brun de la marque) tient les deux : 8,86:1 et 5,67:1. Le lien de
// profil, celui de connexion, le hamburger et les entrées du tiroir mobile
// (posées sur `hover:bg-orange-50`, opaque : 8,83:1) portent le même jeton —
// une seule encre de survol pour la barre, mesurée sur LES DEUX composites.
// L'icône de la cloche garde `orange-700` : c'est un OBJET GRAPHIQUE (seuil
// WCAG 1.4.11 de 3:1), et 3,13:1 sur le pire cas suffit là où du texte échoue.
// Les deux boutons PLEINS de la barre (inscription, déconnexion) portaient du
// texte BLANC sur `orange-600`, soit 3,56:1 — sous le seuil au repos. Ils sont
// passés au jeton des autres boutons pleins du site le 26/10/2026 (`orange-700`
// avec un survol `orange-800`) : 5,18:1 et 7,31:1. Ils sont donc MESURÉS comme
// les autres entrées du tiroir, et non plus écartés.
// Garde : `src/components/__tests__/Navbar.test.jsx` (la barre) et
// `src/__tests__/boutons-pleins.test.js` (tout le site).

/**
 * Une entrée du menu de bureau, dans ses deux états.
 *
 * Le composant existe pour que les classes des DEUX variantes soient écrites
 * dans une position de classe — celles du `className` du `<Link>` — plutôt que
 * rendues par une fonction : `scripts/check-css-selecteurs-morts.js` lit les
 * positions de classe, pas la valeur de retour d'un appel, et la variante
 * inactive n'avait donc aucun porteur dès que la coquille de /register a cessé
 * de l'écrire (13 pages servaient `.border-transparent` sans porteur).
 */
function LienDesktop({ to, actif, children }) {
  return (
    <Link
      to={to}
      className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 ${
        actif
          ? 'border-orange-600 bg-orange-50 text-orange-700'
          : 'border-transparent text-stone-700 hover:text-orange-900'
      }`}
    >
      {children}
    </Link>
  );
}

export default function Navbar() {
  const { user, logout, loading, sessionProbable } = useAuth();
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

  // La base vient du domicile partagé ; le seul ajout propre à React est le
  // retrait d'encoche (PWA), et il est DÉCLARÉ dans le domicile plutôt que
  // retapé ici.
  const navbarClass = isPWA() ? `${NAV_CLASS} ${NAV_PWA_SUFFIXE}` : NAV_CLASS;

  // ── « SUPPORT » MÈNE AUX DEMANDES POUR QUI LES TRAITE (24/10/2026) ────────
  // Le propriétaire et l'équipe support voyaient le formulaire client, donc le
  // guichet où l'on dépose une demande — jamais la file où on la traite. Leur
  // entrée pointe désormais sur /support-admin ; tous les autres gardent le
  // formulaire. Le fait est lu sur le profil de session (is_owner,
  // support_role), jamais deviné.
  const versSupport = user?.is_owner || user?.support_role === 'agent' ? '/support-admin' : '/support';

  // ── LA BARRE RÉSERVE LA DISPOSITION DE LA SESSION PENDANT L'AMORÇAGE ──────
  // (29/10/2026) Une session est PROBABLE (trace locale, `AuthContext`) mais son
  // profil n'est pas encore arrivé : la barre peignait alors les deux groupes
  // d'un VISITEUR, puis les remplaçait par ceux d'un utilisateur connecté. Le
  // second groupe passait de 365 à 406 px et la navigation de 0 à 451 px, donc
  // les deux se déplaçaient SOUS le curseur du visiteur — mesuré à la sonde des
  // cadres en 1350×940 : c'était la source des 0,0039 de CLS qui restaient sur
  // /payment après le réglage de son cadre.
  //
  // Le remède est de peindre la disposition CONNECTÉE tout de suite, invisible :
  // `visibility: hidden` occupe sa place sans se peindre, donc l'arrivée du
  // profil ne fait que la RÉVÉLER — aucun déplacement, et rien à réécrire dans
  // la géométrie quand un libellé change de langue. Les deux groupes sont
  // réservés en même temps parce que les deux bougent.
  //
  // Ce que la réserve ne fait pas : elle ne clique pas (`visibility: hidden` sort
  // du parcours de focus et des lecteurs d'écran, d'où l'`aria-hidden` qui dit
  // la même chose en clair) et elle n'appelle rien — la cloche lit un contexte
  // qui ne sonde le serveur QUE pour un utilisateur connu
  // (`NotificationContext` : `if (!user) return`).
  //
  // Cas assumé, et c'est le seul : une trace qui ne vaut plus rien (session
  // expirée, 401). La disposition réservée devient alors celle du visiteur, et
  // ce remplacement-là est un DÉCALAGE RÉEL de l'état — le taire aurait voulu
  // dire peindre un visiteur connecté.
  const reserveLaBarreConnectee = !user && sessionProbable;
  const commeConnecte = Boolean(user) || reserveLaBarreConnectee;
  // ── UNE CLASSE COLLÉE À `${}` DISPARAÎT DE LA FEUILLE (mesuré le 29/10/2026) ──
  // Tailwind lit le TEXTE des sources pour décider quels utilitaires émettre.
  // Écrite `...space-x-6${sansPeinture}`, la classe devenait le candidat
  // `space-x-6${sansPeinture}` — invalide — et `.space-x-6` n'était plus émise :
  // les quatre entrées de la navigation se touchaient (379 px au lieu de
  // 451 px, mesuré à la sonde des cadres) sans qu'aucun test de CLS ne le voie,
  // puisque le CLS, lui, était parfaitement vert. D'où l'écriture en littéral
  // COMPLET suivi d'une concaténation : le candidat reste `… space-x-6`.
  // Garde : `scripts/check-classes-sans-regle.js` (une classe employée sans
  // règle dans la feuille rougit) — il faut le lancer APRÈS le build.
  const sansPeinture = reserveLaBarreConnectee ? ' invisible' : '';

  // L'entrée de menu est SOULIGNÉE quand on est déjà dessus : sans ce repère, un
  // visiteur qui navigue ne sait pas où il se trouve. Le soulignement reprend la
  // règle de survol des liens (même épaisseur, même couleur).
  const estActif = (chemin) =>
    chemin === '/' ? location.pathname === '/' : location.pathname.startsWith(chemin);
  // Le dessin d'une entrée de barre reste un UTILITAIRE (px-3 py-2, 14 px,
  // filet de 2 px) ; l'entrée courante prend en plus un fond de crème, pour
  // qu'on sache où l'on est sans lire le soulignement. Aucune hauteur ne bouge :
  // la barre fait 65 px dans les deux canaux, et la coquille pré-rendue publie
  // une barre VIDE.
  //
  // Les deux variantes sont écrites DANS la position de classe, par
  // `LienDesktop` ci-dessous — plus dans une fonction qui les rendait :
  // `className={lienDesktop('/jobs')}` n'est pas une position de classe que
  // `scripts/check-css-selecteurs-morts.js` sache suivre, donc la variante
  // inactive n'avait de porteur QUE la coquille pré-rendue de /register, qui a
  // cessé de l'écrire le 26/10/2026 — et le garde a alors mesuré 13 pages
  // servant une règle sans porteur. Le porteur doit être là où la classe est
  // PEINTE, pas chez une page qui ne s'en sert pas.

  return (
    <nav className={navbarClass}>
      <div className={CONTENEUR_CLASS}>
        {/* La rangée intérieure est lue dans le domicile (NAV_RANGEE_CLASS,
            src/config/classes-chrome.js) : la coquille la publie avec la même
            classe, donc les deux peintures portent le même porteur de hauteur. */}
        <div className={NAV_RANGEE_CLASS}>
          <div className="flex items-center">
            {/* ── Le verrou de marque ────────────────────────────────────────────
                Il n'y a plus QU'UNE chose à gauche : la marque. Le mot « Kojo »
                qui l'accompagnait depuis l'origine a été retiré le 28/09/2026 —
                il redisait ce que le dessin disait, et il occupait 64 px de la
                barre à côté d'une pastille de 36 px : le symbole avait l'air
                d'une puce devant un titre, alors que c'est la marque du site.

                Ce que la disparition du mot oblige à faire, et qui n'est pas
                facultatif : le dessin est `aria-hidden` (un tracé n'a pas de
                nom à annoncer), donc c'est LE LIEN qui porte le nom — sans cet
                `aria-label`, le retour à l'accueil devenait le seul lien sans
                nom du site. Il est écrit en clair et non par `t()` : « Kojo »
                est un nom propre, il s'écrit « Kojo » dans les cinq dictionnaires
                (voir `homeMetaTitle`, « Kojo · Services et travailleurs en
                Afrique de l'Ouest ») et ne se traduit pas.

                Le symbole, lui, n'est pas dessiné ici : c'était un CARACTÈRE
                (`t('brandMark')`) dans un carré, recopié à six endroits du site.
                Il vient de src/config/marque-kojo.js, avec les deux canaux — voir
                l'en-tête de ce module. */}
            <Link
              to="/"
              aria-label="Kojo"
              className="shrink-0 flex items-center"
              onClick={closeMobileMenu}
            >
              <MarqueKojo emplacement="barre" />
            </Link>
          </div>

          <div className={'hidden md:flex items-center space-x-6' + sansPeinture} aria-hidden={reserveLaBarreConnectee || undefined}>
            {commeConnecte ? (
              <>
                <LienDesktop to="/dashboard" actif={estActif('/dashboard')}>
                  {t('dashboard')}
                </LienDesktop>
                <LienDesktop to="/jobs" actif={estActif('/jobs')}>
                  {t('jobs')}
                </LienDesktop>
                <LienDesktop to="/messages" actif={estActif('/messages')}>
                  {t('messages')}
                </LienDesktop>
                <LienDesktop to={versSupport} actif={estActif('/support')}>
                  {t('support')}
                </LienDesktop>
              </>
            ) : (
              /* Visiteur NON connecté : la navigation publique. Sans elle, un
                 premier visiteur ne voyait que « Connexion » / « Inscription »
                 et ne pouvait atteindre les emplois, la page « Comment ça
                 marche ? » ou le contact que par le bas de page. */
              <>
                <LienDesktop to="/jobs" actif={estActif('/jobs')}>
                  {t('jobs')}
                </LienDesktop>
                <LienDesktop to="/how-it-works" actif={estActif('/how-it-works')}>
                  {t('howItWorksTitle')}
                </LienDesktop>
                <LienDesktop to="/about" actif={estActif('/about')}>
                  {t('aboutTitle')}
                </LienDesktop>
                <LienDesktop to="/contact" actif={estActif('/contact')}>
                  {t('contactTitle')}
                </LienDesktop>
              </>
            )}
          </div>

          <div className="hidden md:flex items-center space-x-4">
            <LanguageSelector showDropdown={true} showFlags={true} className="mr-4" />

            {commeConnecte ? (
              <div className={'flex items-center space-x-4' + sansPeinture} aria-hidden={reserveLaBarreConnectee || undefined}>
                {/* Cloche notifications — le BOUTON seulement : le panneau du
                    centre de notifications est monté une seule fois pour tout
                    le site (App.js) et se rend dans le conteneur de la cloche
                    qui l'ouvre. Il n'existe donc plus un panneau par barre,
                    chacun avec son écouteur de clic extérieur — c'est ce
                    nombre qui faisait disparaître l'appui avant le `click`. */}
                <NotificationBell />
                <Link to="/profile" className="text-gray-700 hover:text-orange-900 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  {t('profile')}
                </Link>
                <button onClick={handleLogout} className="bg-orange-700 hover:bg-orange-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
                  {t('logout')}
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                <Link to="/login" className="text-gray-700 hover:text-orange-900 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  {t('login')}
                </Link>
                <Link to="/register" className="bg-orange-700 hover:bg-orange-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
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
              /* `relative z-50` : le fond de fermeture est un `fixed inset-0 z-40`
                 monté À CÔTÉ de cette barre, donc au-dessus d'elle dans l'ordre
                 de peinture. Sans cette élévation, le hamburger devenu CROIX
                 était recouvert par le voile : mesuré le 23/10/2026 en
                 production, l'élément touché à son centre était le bouton du
                 fond, et le seul moyen de refermer le menu était de toucher une
                 zone grise sans commande. Le bouton reste sous le tiroir
                 (`z-50` tous les deux) : il ne passe pas devant son contenu. */
              className="relative z-50 min-h-[44px] min-w-[44px] text-gray-700 hover:text-orange-900 p-2 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-orange-500"
            >
              {/* Le dessin vient du registre du chrome : c'est lui qui porte les
                  jointures, les bouts et `aria-hidden`. Deux tracés écrits ici
                  auraient été deux occasions d'oublier `linejoin`. */}
              <Icone nom={isMobileMenuOpen ? 'fermer' : 'menu'} classe="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>

      {isMobileMenuOpen && (
        <>
          <button type="button" aria-label={t('closeMenu')} className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={closeMobileMenu} />
          <div ref={menuRef} id="mobile_menu" className="relative z-50 md:hidden border-t verre-barre">
            {/* `overscroll-contain` : arrivé au bout du tiroir, un geste de plus ne
                doit pas faire défiler la PAGE derrière lui — le corps est déjà gelé
                (`overflow: hidden`), mais la chaîne de défilement remonte quand
                même au document sur iOS sans cette borne. */}
            <div className="max-h-[calc(100vh-4rem)] overflow-y-auto overscroll-contain px-3 pt-3 pb-6 space-y-2">
              <div className="rounded-xl border border-gray-200 px-3 py-3">
                {/* Le tiroir mobile ne porte PLUS son propre contrôle : il monte le
                    MÊME composant que la barre du haut (`LanguageSelector`), donc
                    le même menu, la même liste et le même comportement d'appui
                    extérieur. Un `<select>` natif d'un côté et un menu déroulant
                    de l'autre donnaient deux contrôles de formes différentes pour
                    un seul choix — et deux comportements à tenir d'accord. */}
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
                  <Link to="/dashboard" className="block rounded-xl text-gray-700 hover:text-orange-900 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('dashboard')}
                  </Link>
                  <Link to="/jobs" className="block rounded-xl text-gray-700 hover:text-orange-900 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('jobs')}
                  </Link>
                  <Link to="/messages" className="block rounded-xl text-gray-700 hover:text-orange-900 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('messages')}
                  </Link>
                  <Link to="/profile" className="block rounded-xl text-gray-700 hover:text-orange-900 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('profile')}
                  </Link>
                  <Link to={versSupport} className="block rounded-xl text-gray-700 hover:text-orange-900 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('support')}
                  </Link>
                  <div className="pt-2">
                    <button onClick={handleLogout} className="w-full rounded-xl bg-orange-700 hover:bg-orange-800 text-white px-4 py-3 text-base font-medium transition-colors">
                      {t('logout')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Les mêmes entrées publiques que sur grand écran : le menu
                      mobile d'un visiteur non connecté ne doit pas être plus
                      pauvre que la barre du haut. */}
                  <Link to="/jobs" className="block rounded-xl text-gray-700 hover:text-orange-900 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('jobs')}
                  </Link>
                  <Link to="/how-it-works" className="block rounded-xl text-gray-700 hover:text-orange-900 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('howItWorksTitle')}
                  </Link>
                  <Link to="/about" className="block rounded-xl text-gray-700 hover:text-orange-900 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('aboutTitle')}
                  </Link>
                  <Link to="/contact" className="block rounded-xl text-gray-700 hover:text-orange-900 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('contactTitle')}
                  </Link>
                  <Link to="/privacy" className="block rounded-xl text-gray-700 hover:text-orange-900 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('privacyTitle')}
                  </Link>
                  <Link to="/login" className="block rounded-xl text-gray-700 hover:text-orange-900 hover:bg-orange-50 px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
                    {t('login')}
                  </Link>
                  <Link to="/register" className="block rounded-xl bg-orange-700 hover:bg-orange-800 text-white px-4 py-3 text-base font-medium transition-colors" onClick={closeMobileMenu}>
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
