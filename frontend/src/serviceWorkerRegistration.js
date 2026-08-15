// Service Worker Registration for Kojo PWA
// Optimized for West African networks with offline support
import { devLog } from './utils/env';

const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
    window.location.hostname === '[::1]' ||
    window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/)
);

export function register(config) {
  if ('serviceWorker' in navigator) {
    // Wait for the page to load before registering
    window.addEventListener('load', () => {
      const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

      if (isLocalhost) {
        // Check if a service worker exists in localhost
        checkValidServiceWorker(swUrl, config);
      } else {
        // Register service worker in production
        registerValidSW(swUrl, config);
      }
    });
  }
}

function registerValidSW(swUrl, config) {
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      devLog.info('Service Worker registered successfully:', registration);

      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (installingWorker == null) {
          return;
        }

        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              // New content available
              devLog.info('New content is available; please refresh.');

              if (config && config.onUpdate) {
                config.onUpdate(registration);
              }

              // Show update notification
              showUpdateNotification();
            } else {
              // Content cached for offline use
              devLog.info('Content is cached for offline use.');

              if (config && config.onSuccess) {
                config.onSuccess(registration);
              }
            }
          }
        };
      };
    })
    .catch((error) => {
      devLog.error('Error during service worker registration:', error);
    });
}

function checkValidServiceWorker(swUrl, config) {
  // Check if the service worker can be found
  fetch(swUrl, {
    headers: { 'Service-Worker': 'script' },
  })
    .then((response) => {
      const contentType = response.headers.get('content-type');
      if (
        response.status === 404 ||
        (contentType != null && contentType.indexOf('javascript') === -1)
      ) {
        // No service worker found, reload the page
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister().then(() => {
            window.location.reload();
          });
        });
      } else {
        // Service worker found, proceed as normal
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => {
      devLog.info('No internet connection found. App is running in offline mode.');
    });
}

export function unregister() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch((error) => {
        devLog.error(error.message);
      });
  }
}

// Show update notification to user
function showUpdateNotification() {
  const existingNotification = document.getElementById('kojo-sw-update-notification');
  if (existingNotification) {
    return;
  }

  const notification = document.createElement('div');
  notification.id = 'kojo-sw-update-notification';
  notification.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: #ea580c;
    color: white;
    padding: 16px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    font-family: system-ui, -apple-system, sans-serif;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 90%;
    animation: slideUp 0.3s ease-out;
  `;

  const content = document.createElement('div');
  content.style.flex = '1';

  const title = document.createElement('div');
  title.style.fontWeight = '600';
  title.style.marginBottom = '4px';
  title.textContent = 'Mise à jour disponible';

  const description = document.createElement('div');
  description.style.fontSize = '14px';
  description.style.opacity = '0.9';
  description.textContent = 'Une nouvelle version est prête';

  content.appendChild(title);
  content.appendChild(description);

  const refreshButton = document.createElement('button');
  refreshButton.type = 'button';
  refreshButton.style.cssText = `
    background: white;
    color: #ea580c;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    font-size: 14px;
  `;
  refreshButton.textContent = 'Actualiser';
  refreshButton.addEventListener('click', () => {
    window.location.reload();
  });

  const dismissButton = document.createElement('button');
  dismissButton.type = 'button';
  dismissButton.style.cssText = `
    background: transparent;
    color: white;
    border: 1px solid rgba(255,255,255,0.5);
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    font-size: 14px;
  `;
  dismissButton.textContent = 'Plus tard';
  dismissButton.addEventListener('click', () => {
    notification.remove();
  });

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideUp {
      from {
        transform: translate(-50%, 100px);
        opacity: 0;
      }
      to {
        transform: translateX(-50%);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);

  notification.appendChild(content);
  notification.appendChild(refreshButton);
  notification.appendChild(dismissButton);
  document.body.appendChild(notification);
}
