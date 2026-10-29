// Injecte la CSP stricte dans le HTML de production.

import { construireCsp } from '../src/config/csp.js';

export function injectProductionCspPlugin({ env, mode, apiOrigin }) {
  return {
    // CSP injectée UNIQUEMENT en build de production (le dev Vite a besoin
    // de scripts inline/HMR). Durcissement XSS : bloque les scripts
    // externes injectés et eval, sans casser le bundling Vite.
    name: 'inject-production-csp',
    transformIndexHtml(html) {
      if (mode !== 'production') return html
      // LA POLITIQUE EST DÉCLARÉE AILLEURS (`src/config/csp.js`), pas ici : le
      // backend écrit les documents pré-rendus `/jobs/:id` et `/workers/:id`,
      // et il doit servir la MÊME politique que les pages du build. Une seule
      // déclaration, deux lecteurs — la copie Python (`backend/kojo_csp.py`)
      // est confrontée octet pour octet à ce module par
      // `scripts/check-csp-contract.js`, et la sonde de production refuse la
      // divergence entre les deux documents servis.
      //
      // Les domaines d'analytique suivent la configuration : une origine
      // tierce ouverte sans besoin est une surface d'attaque gratuite. PostHog
      // en ouvre DEUX (SDK + ingestion) et seulement si une clé de projet de la
      // bonne forme est posée au build.
      const csp = construireCsp({
        apiOrigin,
        plausibleDomain: env.VITE_PLAUSIBLE_DOMAIN,
        gaMeasurementId: env.VITE_GA_MEASUREMENT_ID,
        posthogKey: env.VITE_POSTHOG_KEY,
      })
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}
