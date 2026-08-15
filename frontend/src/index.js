import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import * as serviceWorkerRegistration from "./serviceWorkerRegistration";

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

