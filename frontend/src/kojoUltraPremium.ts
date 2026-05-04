import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export async function applyKojoUltraPremium() {
  if (typeof document !== 'undefined') {
    document.body.classList.add('kojo-ultra-premium');
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', '#070b16');
    } else {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = '#070b16';
      document.head.appendChild(meta);
    }
  }
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#070b16' });
  } catch {}
}
