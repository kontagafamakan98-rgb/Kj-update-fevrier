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

// ── LE PREMIER PAINT DE LA COQUILLE PRÉCÈDE LE MONTAGE DE REACT ──────────────
// La coquille pré-rendue publie le titre du héros de l'accueil — l'élément LCP
// de « / ». Mais createRoot() EFFACE #root au montage : si le montage a lieu
// avant le premier paint du navigateur, le titre de la coquille n'est jamais
// peint, et l'élément LCP devient celui que React reconstruit, c'est-à-dire une
// peinture DÉCLENCHÉE PAR LE JAVASCRIPT — exactement ce que « le LCP peint
// avant le JavaScript » interdit.
//
// Mesuré (Lighthouse 12.6.1, pile de la CI, Chrome 152, 9 runs) : quand le nœud
// LCP appartient à l'arbre React (chemin ...MAIN...), il est peint 110 à 215 ms
// APRÈS le FCP, toute la chaîne JS tombe avant ce cutoff dans le graphe LCP de
// Lantern, et le LCP simulé explose — 1481 / 2974 / 3199 ms, scores 93 / 94 /
// 95. Quand le nœud LCP appartient à la coquille, LCP = FCP (1089-1560 ms),
// scores 99-100. La cause est une course : le script d'entrée s'exécute au plus
// tard au DOMContentLoaded, alors que le premier paint attend le style et la
// mise en page d'un document de 108 Ko.
//
// Le montage attend donc que le navigateur ait PEINT — pas une frame de plus :
// mesuré, deux requestAnimationFrame ne suffisent pas (le premier paint de ce
// document de 108 Ko arrive après elles, et React montait encore avant lui).
// Le signal utilisé est l'entry `first-contentful-paint` : c'est la preuve que
// le navigateur a effectivement peint quelque chose. Il coûte une frame, pas
// une seconde : tant que le fil principal est occupé, ni le paint ni le montage
// ne peuvent avoir lieu — attendre le paint ne retarde donc que le montage qui,
// de toute façon, aurait écrasé une page encore jamais affichée.
//
// Une fois la coquille peinte, le repaint de React est identique au pixel —
// mêmes clés i18n et mêmes classes, déclarées une fois dans
// src/config/page-sections.js — et Chrome ne ré-élit PAS d'élément LCP :
// vérifié par la trace (un remplacement de même taille n'ajoute aucun
// `largestContentfulPaint::Candidate`) et par la mesure (dans les runs où la
// coquille gagne, React peint pourtant son héros plus tard, sans conséquence).
// Rien n'est retardé côté réseau : le script d'entrée et les `modulepreload`
// restent ceux d'aujourd'hui.
const monter = () => root.render(<App />);
let monte = false;
const monterApresLePremierPaint = () => {
  if (monte) return;
  monte = true;
  monter();
};

let attenteDUnPaint = false;
if (typeof window !== "undefined" && typeof window.PerformanceObserver === "function") {
  try {
    const observateur = new window.PerformanceObserver((liste) => {
      if (!liste.getEntries().some((entree) => entree.name === "first-contentful-paint")) return;
      observateur.disconnect();
      monterApresLePremierPaint();
    });
    // `buffered` : si le paint a déjà eu lieu, l'entry est livrée tout de suite.
    observateur.observe({ type: "paint", buffered: true });
    attenteDUnPaint = true;
  } catch (erreur) {
    attenteDUnPaint = false;
  }
}

if (!attenteDUnPaint) {
  // Pas d'observateur de paint : on ne peut attendre un signal qui n'arrivera pas.
  monterApresLePremierPaint();
} else {
  // Filet : un onglet en ARRIÈRE-PLAN ne peint pas (aucun FCP). Le montage ne peut
  // donc pas dépendre du seul FCP — mais il ne peut pas non plus se contenter du
  // premier signal venu : mesuré sur cet arbre, un filet armé sur `load` montait
  // React AVANT que l'entry du paint ne soit livrée, et la coquille n'était
  // jamais peinte. On attend donc le paint, borné dans le temps.
  window.setTimeout(monterApresLePremierPaint, 1000);
}

// Disable service worker for now to avoid production cache/runtime issues
serviceWorkerRegistration.unregister();

// Filet de securite : purge aussi le Cache Storage directement, differe hors
// du chemin critique (temps mort ou setTimeout) pour ne pas bloquer le main thread au boot.
// Utile pour les navigateurs qui gardent des caches "kojo-*" orphelins
// (crees par d'anciennes versions du service worker) meme une fois
// celui-ci desinscrit. Sans effet si aucun cache n'existe.
if (typeof window !== 'undefined' && window.caches && window.caches.keys) {
  const purgeCaches = () => {
    window.caches
      .keys()
      .then((names) => Promise.all(names.map((name) => window.caches.delete(name))))
      .catch(() => {});
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(purgeCaches, { timeout: 3000 });
  } else {
    window.setTimeout(purgeCaches, 1500);
  }
}

