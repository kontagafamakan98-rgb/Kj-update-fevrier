import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import { initSentry } from './utils/sentry';

// Initialiser Sentry en premier (si activé)
initSentry();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <App />,
);

// Register service worker for offline support
serviceWorkerRegistration.register({
  onSuccess: () => console.log('Service Worker: App is cached for offline use'),
  onUpdate: () => console.log('Service Worker: New content available')
});
