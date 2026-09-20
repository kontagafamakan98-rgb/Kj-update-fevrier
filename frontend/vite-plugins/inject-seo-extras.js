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

      // Google Analytics 4 : l'adresse du tag est DÉCLARÉE dans le HTML
      // statique (`data-kojo-ga-src`) mais le script n'y est PAS exécuté.
      //
      // ── Pourquoi pas `<script async src=…>` ────────────────────────────
      // Une balise `async` se charge PENDANT le chargement de la page : sous
      // bridage 4G elle occupait une connexion et retardait le chunk critique,
      // au point d'être la requête la plus lente de chaque page et de décider
      // du LCP (mesuré le 20/09/2026, cf. CI-COVERAGE.md F6). Le script est
      // donc chargé APRÈS `load`, au premier temps mort, par le module bundlé
      // src/utils/analytics.js — qui lit cette déclaration, donc une seule
      // source pour l'adresse.
      //
      // ── Pourquoi une déclaration et pas une injection au runtime ────────
      // Un `type="text/plain"` n'est PAS exécuté par le navigateur (donc pas
      // concerné par la CSP `script-src 'self'`), mais l'adresse reste dans le
      // HTML SERVI : la sonde SEO de production et un audit « no-JS » la
      // détectent toujours. Le `gtag('config')` et les `page_view` sont émis
      // par le module bundlé (pas de script inline).
      const gaId = String(env.VITE_GA_MEASUREMENT_ID || '').trim();
      if (/^G-[A-Z0-9]+$/i.test(gaId)) {
        tags.push({
          tag: 'script',
          attrs: {
            type: 'text/plain',
            'data-kojo-ga-src': `https://www.googletagmanager.com/gtag/js?id=${gaId}`,
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
