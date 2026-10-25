// LA CSP DU SITE — déclarée UNE fois, pour les pages du build ET pour les
// documents pré-rendus du backend.
//
// POURQUOI CE MODULE EXISTE : la politique vivait dans le plugin Vite, donc
// dans le seul artefact du build. Les documents `/jobs/:id` et `/workers/:id`
// sont écrits par le BACKEND (`kojo_job_og.py`, `kojo_worker_og.py`) et
// n'en portaient aucune : un visiteur arrivé par un lien partagé recevait une
// page qui démarre l'application sans la politique que le reste du site
// applique — exactement la surface que la CSP existe pour fermer. Recopier la
// politique en Python aurait fait deux déclarations à garder d'accord ; elle
// est donc déclarée ICI, à la forme près, et `backend/kojo_csp.py` en est la
// copie confrontée OCTET POUR OCTET par `scripts/check-csp-contract.js`.
//
// CE QUI N'EST PAS ICI, ET POURQUOI : `frame-ancestors` est ignoré dans une
// balise `<meta>` (les navigateurs l'avertissent en console). Il reste l'
// en-tête HTTP de `frontend/vercel.json`, et il est refusé ici par un test.
//
// Les domaines d'analytique sont CONDITIONNELS : une origine tierce ouverte
// sans besoin est une surface d'attaque gratuite. Le backend reçoit donc les
// mêmes réglages (`PLAUSIBLE_DOMAIN`, `GA_MEASUREMENT_ID`) et les deux
// calculs doivent rendre la MÊME chaîne pour les mêmes entrées — c'est ce que
// le contrat hors ligne exige, et la sonde de production refuse la divergence
// entre ce que le site sert et ce que les documents pré-rendus servent.

/** Forme d'un identifiant GA4 utilisable — un `UA-…` n'ouvre RIEN. */
export const GA_MOTIF = /^G-[A-Z0-9]+$/i;

/**
 * Normalise une origine : sans espaces ni barres finales.
 *
 * @param {string} valeur Origine déclarée.
 * @returns {string} Origine utilisable, ou ''.
 */
export const normaliserOrigine = (valeur) =>
  String(valeur ?? '')
    .trim()
    .replace(/\/+$/, '');

/**
 * Compose la politique du site.
 *
 * L'ORDRE des directives et des sources est significatif : c'est une chaîne
 * comparée octet pour octet avec la copie Python (`kojo_csp.construire_csp`).
 * Un tri « plus joli » d'un seul côté ferait rougir le contrat — et c'est
 * voulu, parce que la sonde de production compare ces mêmes octets.
 *
 * @param {object} [options]
 * @param {string} [options.apiOrigin] Origine du backend (`connect-src`).
 * @param {string} [options.plausibleDomain] Domaine Plausible déclaré, ou ''.
 * @param {string} [options.gaMeasurementId] Identifiant GA4 (`G-…`), ou ''.
 * @returns {string} Politique prête pour `content` d'une meta CSP.
 */
export function construireCsp({ apiOrigin = '', plausibleDomain = '', gaMeasurementId = '' } = {}) {
  const origine = normaliserOrigine(apiOrigin);
  const plausible = String(plausibleDomain ?? '').trim();
  const ga = String(gaMeasurementId ?? '').trim();
  const gaActif = GA_MOTIF.test(ga);

  // Le SDK Google Identity Services (bouton SSO) est chargé depuis
  // accounts.google.com/gsi/client : sans cette entrée, le bouton Google
  // échoue avec « Impossible de charger le SDK Google » (script.onerror).
  const scriptSrc = ["'self'", 'https://accounts.google.com'];
  // Plausible n'ouvre script-src que si son domaine est réellement configuré.
  if (plausible) scriptSrc.push('https://plausible.io');
  // GA4 : `googletagmanager.com` sert gtag.js ; les collectes partent vers
  // google-analytics.com ET www.google.com (connect-src), et une balise de
  // repli `img` existe (img-src) — sans ces entrées, GA serait bloqué en
  // silence, par NOTRE politique.
  //
  // `www.google.com` est MESURÉ, pas supposé (24/10/2026, console de
  // production) : gtag émet une partie de ses balises vers
  // `https://www.google.com/g/collect`, et la CSP la refusait — « Refused to
  // connect because it violates the document's Content Security Policy ». La
  // sonde de production ne pouvait pas le voir : elle compare le site et les
  // documents, et les deux étaient d'accord pour bloquer.
  if (gaActif) scriptSrc.push('https://www.googletagmanager.com');

  // Géolocalisation 100 % centralisée derrière le backend Kojo : détection IP,
  // reverse geocoding et base villes passent toutes par l'origine de l'API.
  // L'origine est un REPLI (le proxy Vercel sert `/api/*` en même-origine) :
  // utile au mode direct (natif Capacitor, débogage, proxy désactivé).
  const connectSrc = ["'self'"];
  if (origine) connectSrc.push(origine);
  connectSrc.push('https://accounts.google.com');
  if (gaActif) {
    connectSrc.push(
      'https://www.google-analytics.com',
      'https://region1.google-analytics.com',
      'https://www.google.com',
    );
  }

  const imgSrc = [
    "'self'",
    'data:',
    'blob:',
    'https://res.cloudinary.com',
    'https://tile.openstreetmap.org',
  ];
  if (gaActif) imgSrc.push('https://www.google-analytics.com');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(' ')}`,
    `connect-src ${connectSrc.join(' ')}`,
    // Cartes : les aperçus de localisation sont des iframes (CreateJob /
    // JobCreateModal → buildMapEmbedUrl) Google Maps ou OpenStreetMap. Sans
    // frame-src, `default-src 'self'` les bloque (« Refused to frame »).
    // accounts.google.com est nécessaire au sélecteur de compte du SSO.
    "frame-src 'self' https://www.google.com https://www.openstreetmap.org https://accounts.google.com",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    // `frame-ancestors` est IGNORÉ dans une balise <meta> et provoque un
    // avertissement console : il vit dans l'en-tête HTTP de vercel.json.
    "worker-src 'self'",
    "manifest-src 'self'",
  ].join('; ');
}
