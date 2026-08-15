/* eslint-disable no-restricted-globals */
// ============================================================
// KOJO — Service Worker dédié aux Push Notifications (VAPID)
// Ce fichier NE gère PAS le cache de l'application.
// Son seul rôle : recevoir les push et les afficher.
// ============================================================

self.addEventListener('install', (event) => {
  // Prise de contrôle immédiate sans attendre les onglets ouverts
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
