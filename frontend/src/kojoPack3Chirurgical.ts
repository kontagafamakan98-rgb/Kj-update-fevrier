import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

function markScreenByPath() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const p = window.location.pathname.toLowerCase();
  const root = document.querySelector('#root') || document.body;
  const map = [
    ['login', ['login','signin','connexion']],
    ['register', ['register','signup','inscription']],
    ['forgot-password', ['forgot','reset','password']],
    ['dashboard', ['dashboard']],
    ['home', ['home','accueil']],
    ['jobs', ['job','jobs','missions']],
    ['orders', ['order','orders','commandes']],
    ['tracking', ['tracking','track','suivi']],
    ['navigation', ['navigation','nav','itineraire','itinéraire']],
    ['profile', ['profile','profil','account']],
    ['settings', ['settings','parametres','paramètres']]
  ] as const;
  for (const [name, keys] of map) {
    if (keys.some(k => p.includes(k))) {
      root.setAttribute('data-screen', name);
      return;
    }
  }
}

export async function applyKojoPack3Chirurgical() {
  if (typeof document !== 'undefined') {
    document.body.classList.add('kojo-pack3');
    markScreenByPath();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#070b16');
  }
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#070b16' });
  } catch {}
}
