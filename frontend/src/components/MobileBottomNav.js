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

  // ── LES DEUX MENUS NE PARTAGENT PAS LEURS NŒUDS, ET C'EST UNE MESURE ──────
  //
  // La disposition DÉCOUVERTE (4 items) et la disposition APPLICATION (4 items
  // + la cloche) sont deux navigations DIFFÉRENTES, mais elles se ressemblent :
  // « Emplois » est au même rang dans les deux, et React lui rendait donc le
  // MÊME nœud (`key={item.path}`) — le navigateur voyait alors un élément SE
  // DÉPLACER de la colonne 2/4 à la colonne 2/5 (96 px de large à x=108 → 76 px
  // à x=88) et le comptait comme un décalage de mise en page.
  //
  // MESURÉ (Chromium 412×823, 09/10/2026) : 0,0009 de CLS, nommé par la sonde
  // `<a.flex.min-h-[72px]…> « Emplois » : 96×72 px à (108, 743) → 76×72 px à
  // (88, 743)`, APRÈS que la hauteur de la barre ait été rendue constante (sans
  // ce premier correctif, le même run valait 0,0039).
  //
  // Le préfixe de disposition rend les deux menus distincts pour React : les
  // items sont alors REMONTÉS au changement de session, et un nœud remonté est
  // une insertion (aucun rectangle précédent, donc aucun décalage), au lieu d'un
  // même nœud qui glisse d'une grille à l'autre.
  const cle = (path) => `${user ? 'app' : 'decouverte'}-${path}`;

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
  // ── LA HAUTEUR D'UNE CASE EST FIXE, ET C'EST CE QUI FERME UN CLS ──────────
  //
  // La session n'est connue qu'APRÈS le tour de `/auth/me` (`AuthContext` part
  // de `user = null`), donc le PREMIER rendu de cette barre est celui du
  // VISITEUR : `grid-cols-4`, libellés courts, une ligne — la barre fait alors
  // 81 px. Quand la session se résout (~15 ms plus tard), elle passe à
  // `grid-cols-5` (la cloche est un cinquième item) : les cases rétrécissent de
  // 96 à 76,8 px et « Tableau de bord » tient désormais sur DEUX lignes — la
  // barre grandit à 88,5 px, et comme elle est `fixed bottom-0`, elle grandit
  // VERS LE HAUT (y 742 → 734,5).
  //
  // MESURÉ (Chromium 412×823, 09/10/2026, sonde `e2e/` rejouée) : 0,0039 de CLS
  // sur 3 runs sur 4, et le navigateur NOMME la source — `div.fixed.bottom-0`
  // 412×81 px à (0, 741.5) → 412×88.5 px à (0, 734.5). Le run où la barre se
  // peint directement à cinq colonnes vaut 0,0000 : c'est bien le CHANGEMENT de
  // hauteur qui est compté, pas le contenu.
  //
  // Ce que ça coûte si on ne fait rien : la hauteur de la barre dépend d'un
  // CHOIX DE MISE EN PAGE (le nombre de colonnes), c'est-à-dire d'une course
  // entre deux rendus — l'artefact évitable, pas la page.
  //
  // Le remède est de fixer la hauteur d'une CASE à celle que prend un libellé
  // sur DEUX lignes (icône 24 + `mt-1` 4 + 2 × 13,75 + `py-2` 16 = 71,5 → 72),
  // pour toutes les cases et dans les deux dispositions : la rangée fait alors
  // la même hauteur que les libellés tiennent sur une ligne ou sur deux, et que
  // la barre porte quatre ou cinq items. La barre devient constante à 89 px
  // (72 + `pt-2` 8 + `pb` 8 + bordure 1), ce qui reste SOUS les 96 px que `main`
  // réserve déjà (`pb-24`, `src/App.js`).
  //
  // Le plancher est un `min-h` et non une hauteur fixe : un libellé qui
  // déborderait sur une troisième ligne resterait lisible (la rangée grandirait)
  // au lieu d'être coupé. Le jeu de libellés est figé (cinq dictionnaires) et le
  // plus long — « Tableau de bord », « Notifications » — tient sur deux lignes
  // dans une case de 76,8 px.
  const caseDeNav =
    'flex min-h-[72px] flex-col items-center justify-center rounded-2xl px-1 py-2 text-[11px] font-medium transition-colors';
  const caseDeCloche = `${caseDeNav} w-full text-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500`;

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
              key={cle(item.path)}
              to={item.path}
              className={`${caseDeNav} ${isActive ? 'bg-orange-50 text-orange-600' : 'text-gray-500'}`}
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
