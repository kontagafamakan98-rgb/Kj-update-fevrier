// Injecte les balises SEO/vérification dans le HTML statique du build.

import fs from 'node:fs'
import path from 'node:path'

export function injectSeoExtrasPlugin({ env }) {
  return {
    // ── SEO : extras injectés dans le HTML STATIQUE (build seulement) ──
    // Ces balises doivent être présentes dans le HTML **servi**, pas
    // ajoutées par le bundle : un crawler qui n'exécute pas JavaScript
    // (c'est le cas de tous les analyseurs SEO « no-JS ») ne verrait
    // jamais un script injecté au runtime. Chaque élément ne s'active que
    // si sa variable d'environnement est définie — aucune valeur par
    // défaut, aucun identifiant codé en dur.
    name: 'inject-seo-extras',
    apply: 'build',
    transformIndexHtml(html) {
      const tags = [];

      // Google Analytics 4 : la balise EXTERNE est statique (détectable
      // par les outils d'audit) ; le `gtag('config')` est émis par le
      // module bundlé src/utils/analytics.js — pas de script inline, qui
      // serait bloqué par la CSP `script-src 'self'` et afficherait une
      // erreur console à chaque chargement.
      const gaId = String(env.VITE_GA_MEASUREMENT_ID || '').trim();
      if (/^G-[A-Z0-9]+$/i.test(gaId)) {
        tags.push({
          tag: 'script',
          attrs: {
            async: true,
            src: `https://www.googletagmanager.com/gtag/js?id=${gaId}`,
          },
          injectTo: 'head',
        });
      }

      // Vérification Google Search Console : le jeton est propre à chaque
      // propriété, il ne peut donc venir que des variables d'environnement.
      const gscVerification = String(env.VITE_GSC_VERIFICATION || '').trim();
      if (gscVerification) {
        tags.push({
          tag: 'meta',
          attrs: {
            name: 'google-site-verification',
            content: gscVerification,
          },
          injectTo: 'head',
        });
      }

      // `sameAs` du LocalBusiness : profils sociaux réellement déclarés.
      let output = html;
      try {
        const networks = JSON.parse(
          fs.readFileSync(
            path.join(process.cwd(), 'src/config/social-networks.json'),
            'utf8'
          )
        );
        const declared = networks
          .map(({ env: envName }) => String(env[envName] || '').trim())
          .filter((url) => /^https:\/\//.test(url));
        if (declared.length > 0) {
          output = output.replace(
            '"sameAs": []',
            `"sameAs": ${JSON.stringify(declared)}`
          );
        }
      } catch (error) {
        throw new Error(
          `inject-seo-extras : social-networks.json illisible (${error.message})`
        );
      }

      return { html: output, tags };
    },
  }
}
