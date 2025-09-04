const CACHE_NAME = 'kojo-pwa-v2-fixed';
const urlsToCache = [
  '/',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Install Service Worker
self.addEventListener('install', (event) => {
    //  // Removed console.log
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
    //  // Removed console.log
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('Cache installation failed:', error);
      })
  );
});

// Fetch event
self.addEventListener('fetch', (event) => {
  // Only handle GET requests for caching
  if (event.request.method !== 'GET') {
    // For non-GET requests (POST, PUT, DELETE), just fetch normally
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        if (response) {
          return response;
        }
        
        return fetch(event.request).then((response) => {
          // Check if valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clone the response
          const responseToCache = response.clone();

          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            })
            .catch((error) => {
            });

          return response;
        }).catch(() => {
          // Return offline fallback for navigation requests
          if (event.request.destination === 'document') {
            return caches.match('/');
          }
        });
      })
  );
});

// Activate Service Worker
self.addEventListener('activate', (event) => {
    //  // Removed console.log
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
    //  // Removed console.log
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Push notification handling
self.addEventListener('push', (event) => {
    //  // Removed console.log
  
  let notificationData = {};
  
  try {
    notificationData = event.data ? event.data.json() : {};
  } catch (e) {
    notificationData = {
      title: 'Kojo',
      body: 'Vous avez reçu une nouvelle notification',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png'
    };
  }

  const options = {
    body: notificationData.body || 'Nouvelle notification',
    icon: notificationData.icon || '/icons/icon-192x192.png',
    badge: notificationData.badge || '/icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: notificationData.data || {},
    actions: [
      {
        action: 'view',
        title: 'Voir'
      },
      {
        action: 'dismiss',
        title: 'Ignorer'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(
      notificationData.title || 'Kojo',
      options
    )
  );
});

// Notification click handling
self.addEventListener('notificationclick', (event) => {
    //  // Removed console.log
  
  event.notification.close();
  
  if (event.action === 'view') {
    event.waitUntil(
      self.clients.openWindow(event.notification.data.url || '/')
    );
  } else if (event.action === 'dismiss') {
    // Do nothing, notification is already closed
  } else {
    event.waitUntil(
      self.clients.openWindow('/')
    );
  }
});