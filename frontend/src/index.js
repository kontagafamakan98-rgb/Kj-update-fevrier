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

