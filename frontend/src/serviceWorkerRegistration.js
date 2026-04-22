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
  // Create a custom notification element
  const notification = document.createElement('div');
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
  
  notification.innerHTML = `
    <div style="flex: 1;">
      <div style="font-weight: 600; margin-bottom: 4px;">Mise à jour disponible</div>
      <div style="font-size: 14px; opacity: 0.9;">Une nouvelle version est prête</div>
    </div>
    <button 
      id="sw-update-btn"
      style="
        background: white;
        color: #ea580c;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        font-weight: 600;
        cursor: pointer;
        font-size: 14px;
      "
    >
      Actualiser
    </button>
    <button 
      id="sw-dismiss-btn"
      style="
        background: transparent;
        color: white;
        border: 1px solid rgba(255,255,255,0.5);
        padding: 8px 16px;
        border-radius: 6px;
        font-weight: 600;
        cursor: pointer;
        font-size: 14px;
      "
    >
      Plus tard
    </button>
  `;

  // Add animation keyframes
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
  
  document.body.appendChild(notification);

  // Update button click handler
  document.getElementById('sw-update-btn')?.addEventListener('click', () => {
    window.location.reload();
  });

  // Dismiss button click handler
  document.getElementById('sw-dismiss-btn')?.addEventListener('click', () => {
    notification.remove();
  });

  // Auto-dismiss after 10 seconds
  setTimeout(() => {
    if (document.body.contains(notification)) {
      notification.remove();
    }
  }, 10000);
}
