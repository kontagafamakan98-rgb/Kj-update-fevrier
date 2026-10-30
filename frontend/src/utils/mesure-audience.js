// LA MESURE D'AUDIENCE — ce qui est CONFIGURÉ, et rien de ce qui est CHARGÉ.
//
// ── Pourquoi ce module existe (30/10/2026) ───────────────────────────────────
// Deux lecteurs très différents posaient la même question à
// `utils/analytics.js` :
//   • le BANDEAU de consentement (`ConsentBanner.js`, monté par `App.js`, donc
//     dans le JS initial) demande « y a-t-il un fournisseur à proposer ? » pour
//     savoir s'il s'affiche ;
//   • `initAnalytics` demande les mêmes valeurs pour savoir quoi injecter.
// Le premier n'a besoin que de LIRE trois variables d'environnement du build ;
// le second porte toute la machinerie d'injection. Comme le bandeau faisait un
// import STATIQUE, la machinerie entière partait dans le JS initial — y compris
// pour un visiteur qui n'a jamais accepté la mesure.
//
// Ce module ne contient donc que des LECTURES : aucune injection, aucun script,
// aucun état. `analytics.js` l'importe pour décider, `ConsentBanner.js` pour
// afficher — et `analytics.js` n'est plus chargé qu'au moment de l'injection.
//
// Rien de ce qui est ici ne connaît la forme d'une clé : c'est `estClePosthog`
// (`config/posthog.js`) qui décide si une clé est utilisable, au même endroit
// que la CSP — une clé mal formée ne doit ni ouvrir d'origine, ni charger de
// script.

import { estClePosthog } from '../config/posthog';

const normalize = (value) => String(value || '').trim();

/** Une valeur d'environnement non vide (donc une mesure configurée) ? */
export const isEnabled = (value) => normalize(value).length > 0;

/** L'identifiant de mesure GA4 lu au build, ou `''`. */
export const getGaMeasurementId = () =>
  normalize(import.meta.env?.VITE_GA_MEASUREMENT_ID);

/** Le domaine Plausible lu au build, ou `''`. */
export const getPlausibleDomain = () =>
  normalize(import.meta.env?.VITE_PLAUSIBLE_DOMAIN);

/**
 * La clé de projet PostHog lue au build, ou `''`.
 *
 * Rendue BRUTE (normalisée) et non validée : c'est `estClePosthog` qui décide
 * si elle est utilisable, au même endroit que la CSP — une clé mal formée ne
 * doit ni ouvrir d'origine, ni charger de script.
 */
export const getPosthogKey = () => normalize(import.meta.env?.VITE_POSTHOG_KEY);

/**
 * L'éditeur a-t-il configuré une mesure d'audience ?
 *
 * Sert au BANDEAU de consentement : sans fournisseur configuré, il n'y a rien
 * à demander, donc rien à afficher. Ne dit pas si le chargement est autorisé —
 * c'est `hasAnalyticsConsent()` (utils/consent.js) qui le décide.
 */
export const isAnalyticsConfigured = () =>
  isEnabled(getPlausibleDomain()) ||
  isEnabled(getGaMeasurementId()) ||
  estClePosthog(getPosthogKey());
