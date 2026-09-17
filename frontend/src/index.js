import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import * as serviceWorkerRegistration from "./serviceWorkerRegistration";
import { initSentryOnInteraction } from "./utils/sentry";
import { initAnalytics } from "./utils/analytics";

// Sentry : armé tout de suite (tampon des erreurs précoces + écouteurs
// passifs) mais le SDK n'est TÉLÉCHARGÉ qu'à la première interaction, pour ne
// pas concurrencer le premier rendu. No-op si VITE_SENTRY_ENABLED != 'true'.
// Détail et contreparties : utils/sentry.js.
initSentryOnInteraction();
// Analytics (no-op si VITE_PLAUSIBLE_DOMAIN non défini — script externe
// chargé via src, compatible CSP script-src 'self')
initAnalytics();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <App />,
);

// Disable service worker for now to avoid production cache/runtime issues
serviceWorkerRegistration.unregister();

// Filet de securite : purge aussi le Cache Storage directement.
// Utile pour les navigateurs qui gardent des caches "kojo-*" orphelins
// (crees par d'anciennes versions du service worker) meme une fois
// celui-ci desinscrit. Sans effet si aucun cache n'existe.
if (typeof window !== 'undefined' && window.caches && window.caches.keys) {
  window.caches
    .keys()
    .then((names) => Promise.all(names.map((name) => window.caches.delete(name))))
    .catch(() => {});
}

