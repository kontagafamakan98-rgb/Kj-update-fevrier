/* eslint-disable no-restricted-globals */
// ============================================================
// KOJO — Service Worker : Push Notifications (VAPID) + cache offline
// - Push : recevoir les notifications et les afficher.
// - Cache : app shell + assets statiques pour un mode hors-ligne lisible
//   (connexions instables en Afrique de l'Ouest). Les requêtes API ne sont
//   JAMAIS mises en cache (données utilisateur sensibles).
// ============================================================

const CACHE_NAME = 'kojo-shell-v1';
const APP_SHELL_URLS = ['/', '/index.html', '/manifest.json', '/icons/icon-192x192.png', '/icons/icon-512x512.png'];

self.addEventListener('install', (event) => {
  // Prise de contrôle immédiate sans attendre les onglets ouverts
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache stratégie :
//  - Navigation (document) : réseau d'abord, repli sur l'app shell cachée.
//  - Assets statiques same-origin (js/css/icônes) : cache d'abord, puis
//    mise à jour en arrière-plan (stale-while-revalidate).
//  - API (/api) : réseau uniquement (données sensibles, jamais en cache).
//  - Cross-origin : laisser passer.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigation → réseau d'abord, fallback offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Assets statiques → cache d'abord, mise à jour en arrière-plan
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// ------ Réception d'un push ------
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: 'Kojo', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Kojo';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: payload.data || {},
    // Regrouper les notifications Kojo sous un même tag pour éviter le spam
    tag: payload.data?.job_id ? `kojo-job-${payload.data.job_id}` : 'kojo-notification',
    renotify: true,
  };

  // Si un onglet Kojo est au premier plan (visibleState = 'visible'),
  // on envoie le payload en message sans afficher le toast système.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const visibleClient = clientList.find((c) => c.visibilityState === 'visible');
      if (visibleClient) {
        visibleClient.postMessage({ type: 'KOJO_PUSH_FOREGROUND', payload });
        return Promise.resolve();
      }
      return self.registration.showNotification(title, options);
    })
  );
});

// ------ Clic sur une notification ------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const jobId = data.job_id;
  const targetUrl = jobId ? `/jobs/${jobId}` : '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Chercher un onglet Kojo déjà ouvert
      for (const client of clientList) {
        try {
          const url = new URL(client.url);
          if (url.pathname.startsWith('/')) {
            client.focus();
            client.navigate(targetUrl);
            return;
          }
        } catch (_) {}
      }
      // Aucun onglet ouvert → ouvrir un nouveau
      return self.clients.openWindow(targetUrl);
    })
  );
});

// Ne pas intercepter les requêtes réseau
self.addEventListener('fetch', () => {});
