/**
 * Config Lighthouse CI — garde-fou performance du frontend.
 *
 * Audite plusieurs pages :
 *   • l'accueil (/) — publique
 *   • les pages PROTÉGÉES /dashboard, /jobs, /profile — authentifiées via un
 *     token Bearer obtenu par le job CI (login avec le COMPTE CLIENT DÉDIÉ CI
 *     stocké dans les secrets GitHub LHCI_CI_EMAIL / LHCI_CI_PASSWORD). Ce
 *     compte est isolé des comptes e2e partagés : jamais touché à la main,
 *     donc des budgets Lighthouse déterministes d'un run à l'autre.
 *
 * Cible (URL de base) : le DÉPLOIEMENT VERCEL réel quand LHCI_URL est fournie
 * (résolue par le job CI depuis le commentaire Vercel de la PR, ou l'URL de
 * prod sur main), sinon le build local servi statiquement (contenu identique).
 *
 * Condition mobile simulée (Slow 4G + CPU 4x, défaut Lighthouse), et BLOQUE
 * le job si un budget est dépassé.
 *
 * Budgets calibrés sur les mesures locales (runs Lighthouse, médianes) :
 *   Accueil : score ~0.95-0.96 · FCP ~1,8 s · LCP ~2,5 s · TBT ~10 ms · CLS 0
 *   Pages protégées (Dashboard/Jobs/Profile, réseau backend réel) :
 *     score ~0.88-0.92 · LCP ~3-3,6 s · CLS ~0.03 (après correctif)
 * Les marges absorbent la variance du runner CI sans laisser passer une vraie
 * régression.
 *
 * Note : détecter une « régression » relative nécessiterait un serveur LHCI ;
 * sans infrastructure, les budgets absolus jouent ce rôle : tout run sous les
 * seuils fait échouer la PR.
 *
 * Variables d'env injectées par le job CI :
 *   LHCI_URL           base (ex https://x.vercel.app ou http://localhost)
 *   LHCI_AUTH_HEADER   JSON {"Authorization": "Bearer <token>"} pour les pages
 *                      protégées (les pages /dashboard,/jobs,/profile). Vide
 *                      si non fourni.
 */
const baseUrl = (process.env.LHCI_URL || '').trim().replace(/\/$/, '');
const authHeader = (process.env.LHCI_AUTH_HEADER || '').trim();

// Pages à auditer : l'accueil est public ; les 3 pages protégées reçoivent
// l'en-tête d'authentification (Bearer) fourni par le job CI.
const urls = [baseUrl ? `${baseUrl}/` : 'http://localhost/'];
for (const path of ['dashboard', 'jobs', 'profile']) {
  urls.push(baseUrl ? `${baseUrl}/${path}` : `http://localhost/${path}`);
}

// En-têtes à appliquer lors du collect (couvert par l'audit des pages
// protégées). Un seul jeu d'headers s'applique à toutes les URLs : l'accueil
// les ignore sans incidence (Bearer inoffensif sur une route publique).
const extraHeaders = authHeader
  ? (() => { try { return JSON.parse(authHeader); } catch (_e) { return {}; } })()
  : {};

module.exports = {
  ci: {
    collect: {
      // URL de base (déploiement Vercel réel) sinon build local servi statiquement.
      ...(baseUrl
        ? { url: urls, numberOfRuns: 2 }
        : { staticDistDir: './build', url: urls, numberOfRuns: 2 }),
      settings: {
        chromeFlags: '--no-sandbox --headless=new --disable-gpu --disable-dev-shm-usage',
        extraHeaders,
      },
    },
    assert: {
      assertions: {
        // Score global : >= 0.85 (accueil 0.95-0.96, pages protégées 0.88+
        // avec backend réel en 4G simulée). Assez haut pour attraper une
        // vraie régression, assez bas pour ne pas échouer en chaîne sur la
        // variance réseau du runner CI vers le backend prod.
        'categories:performance': ['error', { minScore: 0.85 }],
        // LCP : accueil ~2,5 s, pages protégées ~3,5 s → marge large.
        'largest-contentful-paint': ['error', { maxNumericValue: 5000 }],
        // TBT : interactivité — accueil ~10 ms, Profile pouvant atteindre
        // quelques centaines de ms ponctuellement → marge conservatrice.
        'total-blocking-time': ['error', { maxNumericValue: 500 }],
        // CLS : le correctif a ramené les pages protégées sous 0.05 ; on reste
        // sous le seuil de passage (0.1) pour ne pénaliser prématurément.
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        // FCP : accueil ~1,8 s, pages protégées ~1,8-2,5 s.
        'first-contentful-paint': ['error', { maxNumericValue: 4000 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './lhci-reports',
    },
  },
};